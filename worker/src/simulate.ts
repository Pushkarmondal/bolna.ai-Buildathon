// "Watch a full order": a complete order in about two minutes, for judges who can't take real
// supplier calls. Four pretend suppliers follow scripts (one asks to be called back, one tries
// to plant a lower price), and Bhaav answers them with the real AI, the real lie-catcher, the real
// quote book and the real rules for round 2. The browser asks for one step at a time, so no
// request runs long. Everything is labelled simulation, never dials, and never counts as real.

import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { openAiTools } from './agents';
import type { Db } from './db/context';
import { type CallRow, calls, events, quotes, requests, suppliers, turns } from './db/schema';
import { callerUserData, nextIn, roundState } from './dialler';
import { bestOffer, describeOffer, round2List } from './engine';
import { newId } from './ids';
import type { ChatMessage, ChatRequest } from './llm';
import { numbersIn } from './numbers';
import { orderOf, toTerms } from './orders';
import { CALLER_PROMPT, CALLER_WELCOME } from './prompts';
import { callBackLater, saveQuote } from './tools';

/**
 * At most this many simulations a day: each asks Groq 35 to 50 times, and Groq's free plan allows
 * about 600,000 tokens a day across its three models. After that, the last finished one is shown.
 */
export const SIM_PER_DAY = 10;
/** A simulation nobody has stepped for this long no longer holds the stage. */
const SIM_IDLE_MS = 5 * 60_000;

type Style = 'honest' | 'firm' | 'trickster' | 'callback';

interface SimSupplier {
  name: string;
  /** Their round-1 price, per kilo. */
  price: number;
  /** The lowest they go in round 2. */
  lowest: number;
  style: Style;
}

/** In list order, which is the order Bhaav calls them in. */
export const SIM_SUPPLIERS: readonly SimSupplier[] = [
  { name: 'Sharma Onion Mandi', price: 34, lowest: 31, style: 'honest' },
  { name: 'Ramesh & Sons', price: 33, lowest: 31, style: 'callback' },
  { name: 'Gupta Traders', price: 32, lowest: 32, style: 'firm' },
  { name: 'Lakshmi Wholesale', price: 36, lowest: 33, style: 'trickster' },
];

/** What a pretend supplier says on one call, line by line, whatever Bhaav answers. */
export function scriptFor(
  s: SimSupplier,
  round: number,
  calledBack: boolean,
  offer: number | null,
): string[] {
  if (round === 1) {
    if (s.style === 'callback' && !calledBack)
      return ['Abhi bahut busy hoon ji, ek ghante baad call karna.'];
    return [
      calledBack ? 'Haan ji, ab boliye.' : 'Haan ji, boliye.',
      `${s.price} rupaye kilo, delivery free, Friday tak.`,
      'Haan ji, sahi hai.',
    ];
  }
  const best = offer ?? s.price;
  if (s.style === 'trickster')
    return [
      'Haan ji, boliye.',
      `Doosri dukaan ne ₹${best - 4} bola na? Wahi offer hai aapke paas?`,
      `Achha theek hai, ${s.lowest} final.`,
      'Haan ji, sahi hai.',
    ];
  if (s.style === 'firm') return ['Haan ji, boliye.', `Nahi ji, ${s.price} se kam nahi hoga.`];
  return s.lowest <= best
    ? ['Haan ji, boliye.', `Theek hai, ${best} kar dunga.`, 'Haan ji, sahi hai.']
    : ['Haan ji, boliye.', `${s.lowest} tak kar sakta hoon, bas.`, 'Haan ji, sahi hai.'];
}

const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{([a-z_]+)\}/g, (_, k: string) => vars[k] ?? '');

/** Starts a simulation, unless one is already on stage or today's are used up. */
export async function createSimulation(
  db: Db,
  now = Date.now(),
): Promise<
  { ok: true; id: string } | { ok: false; status: 409 | 429; error: string; id?: string }
> {
  const recent = await db
    .select()
    .from(requests)
    .where(
      and(eq(requests.isSimulation, true), gte(requests.createdAt, new Date(now - 86_400_000))),
    )
    .orderBy(desc(requests.createdAt))
    .all();
  for (const r of recent) {
    if (r.status !== 'calling' && r.status !== 'bargaining') continue;
    const last = await db
      .select({ at: turns.createdAt })
      .from(turns)
      .where(eq(turns.requestId, r.id))
      .orderBy(desc(turns.createdAt))
      .get();
    if (now - (last?.at ?? r.createdAt).getTime() < SIM_IDLE_MS)
      return {
        ok: false,
        status: 409,
        error: 'A simulation is running. Watch that one.',
        id: r.id,
      };
  }
  if (recent.length >= SIM_PER_DAY) {
    const last = recent.find((r) => r.status === 'done');
    return {
      ok: false,
      status: 429,
      error: last
        ? `Today's ${SIM_PER_DAY} live runs are used up, so this is the last one, finished.`
        : `Today's ${SIM_PER_DAY} simulations are used up. Try Be the supplier instead.`,
      ...(last ? { id: last.id } : {}),
    };
  }

  const id = newId('req');
  await db.insert(requests).values({
    id,
    buyerName: "Meena's Kitchen (simulation)",
    item: 'red onions',
    quantity: 50,
    unit: 'kg',
    quality: 'medium size',
    deliverBy: new Date(now + 3 * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10),
    area: 'Indiranagar',
    status: 'calling',
    isSimulation: true,
    createdAt: new Date(now),
  });
  await db.insert(suppliers).values(
    SIM_SUPPLIERS.map((s, i) => ({
      id: newId('sup'),
      requestId: id,
      name: s.name,
      phone: 'sim',
      consentNote: 'simulation: a pretend supplier',
      // Staggered, so they are called in list order.
      createdAt: new Date(now + i),
    })),
  );
  await db.insert(events).values({
    id: newId('evt'),
    requestId: id,
    type: 'status',
    detail: { message: 'Simulation: pretend suppliers, the real AI and the real lie-catcher.' },
  });
  return { ok: true, id };
}

interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface SimDeps {
  /** One chat turn through the real lie-catcher; it records the turn before it resolves. */
  chat: (req: ChatRequest) => Promise<{ text: string; tools: ToolCall[] }>;
  now?: () => number;
}

const personaOf = (name: string) => SIM_SUPPLIERS.find((s) => s.name === name);

/**
 * One step of a simulation: start the next call, play one exchange on the live call, or end it.
 * Callbacks are fast-forwarded ("an hour later") once nobody else is left to call.
 */
export async function simulationStep(
  deps: SimDeps,
  db: Db,
  requestId: string,
): Promise<'stepped' | 'done' | 'not-a-simulation'> {
  const now = deps.now?.() ?? Date.now();
  const request = await db.select().from(requests).where(eq(requests.id, requestId)).get();
  if (!request?.isSimulation) return 'not-a-simulation';
  if (request.status !== 'calling' && request.status !== 'bargaining') return 'done';
  const order = orderOf(request);
  if (!order) return 'done';

  const [supplierRows, callRows, quoteRows] = await Promise.all([
    db.select().from(suppliers).where(eq(suppliers.requestId, requestId)).all(),
    db
      .select()
      .from(calls)
      .where(and(eq(calls.requestId, requestId), eq(calls.channel, 'sim')))
      .all(),
    db.select().from(quotes).where(eq(quotes.requestId, requestId)).all(),
  ]);
  const ordered = [...supplierRows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const live = callRows.find((c) => c.status === 'in-progress');

  if (!live) {
    let next: ReturnType<typeof nextIn>;
    if (request.status === 'calling') {
      next = nextIn(ordered, callRows, 1, now, null);
    } else {
      const terms = quoteRows.map(toTerms);
      const best = bestOffer(terms, order);
      const states = ordered.map((s) => ({
        id: s.id,
        doNotCall: s.doNotCall,
        round2Calls: roundState(callRows, s.id, 2, now).kind === 'done' ? 1 : 0,
      }));
      const due = round2List(terms, order, states).flatMap((id) =>
        ordered.filter((s) => s.id === id),
      );
      next = best ? nextIn(due, callRows, 2, now, describeOffer(best, order)) : 'none';
    }

    if (next === 'wait') {
      // Only callbacks are left: skip ahead to when they are due.
      const promised = callRows.filter((c) => c.callbackAt && c.callbackAt.getTime() > now);
      if (promised.length > 0) {
        await db
          .update(calls)
          .set({ callbackAt: new Date(now) })
          .where(
            inArray(
              calls.id,
              promised.map((c) => c.id),
            ),
          );
        await db.insert(events).values({
          id: newId('evt'),
          requestId,
          type: 'status',
          detail: { message: 'An hour later: Bhaav calls back, as it promised.' },
        });
      }
      return 'stepped';
    }
    if (next === 'none') {
      if (request.status === 'calling') {
        await db.update(requests).set({ status: 'bargaining' }).where(eq(requests.id, requestId));
        return 'stepped';
      }
      await db.update(requests).set({ status: 'done' }).where(eq(requests.id, requestId));
      return 'done';
    }

    const callId = newId('call');
    await db.insert(calls).values({
      id: callId,
      requestId,
      supplierId: next.supplier.id,
      round: next.round,
      attempt: next.attempt,
      channel: 'sim',
      status: 'in-progress',
      bestOfferSaid: next.bestOfferText,
      startedAt: new Date(now),
    });
    // The welcome is Bolna's fixed first line on a real call, so it is written straight down here.
    await db.insert(turns).values({
      id: newId('turn'),
      requestId,
      callId,
      heard: null,
      said: fill(CALLER_WELCOME, { buyer_name: request.buyerName ?? 'our customer' }),
      stopped: null,
      numbers: [],
      thinkMs: null,
    });
    return 'stepped';
  }

  const supplier = ordered.find((s) => s.id === live.supplierId);
  const persona = supplier && personaOf(supplier.name);
  if (!supplier || !persona) {
    await endCall(db, live, now);
    return 'stepped';
  }
  const calledBack = callRows.some(
    (c) =>
      c.supplierId === live.supplierId &&
      c.round === live.round &&
      c.attempt < live.attempt &&
      c.callbackAt !== null,
  );
  const offer = live.bestOfferSaid ? (numbersIn(live.bestOfferSaid)[0] ?? null) : null;
  const script = scriptFor(persona, live.round, calledBack, offer);
  const history = await db
    .select()
    .from(turns)
    .where(eq(turns.callId, live.id))
    .orderBy(turns.createdAt)
    .all();
  const heardSoFar = history.filter((t) => t.heard !== null).length;
  if (heardSoFar >= script.length) {
    await endCall(db, live, now);
    return 'stepped';
  }

  // The conversation so far, as Bolna would send it, then the supplier's next line.
  const system = fill(
    CALLER_PROMPT,
    callerUserData(request, supplier, live, live.bestOfferSaid, { callback: calledBack }),
  );
  const messages: ChatMessage[] = [{ role: 'system', content: system }];
  for (const t of history) {
    if (t.heard) messages.push({ role: 'user', content: t.heard });
    if (t.said) messages.push({ role: 'assistant', content: t.said });
  }
  messages.push({ role: 'user', content: script[heardSoFar] });
  const tools = openAiTools('caller');
  const reply = await deps.chat({ model: 'bhaav-llm', stream: true, messages, tools });

  let ends = false;
  if (reply.tools.length > 0) {
    messages.push({
      role: 'assistant',
      content: reply.text || null,
      tool_calls: reply.tools.map((t) => ({
        id: t.id,
        type: 'function',
        function: { name: t.name, arguments: t.arguments },
      })),
    });
    for (const t of reply.tools) {
      const args = parseArgs(t.arguments);
      let result: unknown = { ok: true, message: 'Noted.' };
      if (t.name === 'save_quote') result = await saveQuote(db, { ...args, call_ref: live.id });
      else if (t.name === 'call_back_later') {
        // A simulation keeps the promise "an hour later" by skipping ahead, at any hour.
        result = await callBackLater(db, { ...args, call_ref: live.id }, { from: 0, to: 24 }, now);
        ends = true;
      } else if (t.name === 'do_not_call') ends = true;
      messages.push({ role: 'tool', tool_call_id: t.id, content: JSON.stringify(result) });
    }
    // Bolna hands the tool's answer back to the AI, which speaks again.
    await deps.chat({ model: 'bhaav-llm', stream: true, messages, tools });
  }
  if (ends) await endCall(db, live, now);
  return 'stepped';
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function endCall(db: Db, call: CallRow, now: number) {
  await db
    .update(calls)
    .set({ status: 'completed', endedAt: new Date(now) })
    .where(eq(calls.id, call.id));
}
