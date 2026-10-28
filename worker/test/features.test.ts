// The features around the core loop, through the real routes: "Watch a full order", the owner
// line, repeat and weekly orders, the proof page and "Break Bhaav". Bolna is faked at
// https://bolna.test and Groq by a scripted Bhaav that answers like the real one would, and lies
// once on purpose, so the lie-catcher has something to stop.

import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import type { BreakStats, OrderView, PricePoint, ProofStats, ScheduleDto } from '@bhaav/shared';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { calls, events, requests, schedules } from '../src/db/schema';
import { diallerEnv } from '../src/dialler';
import worker, { sweep } from '../src/index';
import { ownerEnv } from '../src/owner';
import { runSchedules } from '../src/schedule';

const db = drizzle(env.DB);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

type Message = { role: string; content?: unknown };
const text = (m: Message | undefined) => (typeof m?.content === 'string' ? m.content : '');

/** The supplier's last stated price in the conversation, the way the scripted Bhaav reads it. */
function lastPrice(messages: Message[]): { price: number; words: string } | null {
  for (const m of [...messages].reverse()) {
    if (m.role !== 'user') continue;
    const said = text(m);
    const hit = /(\d+) (?:rupaye kilo|kar dunga|final|tak kar sakta)/.exec(said);
    if (hit?.[1]) return { price: Number(hit[1]), words: said };
  }
  return null;
}

/** A scripted Bhaav: answers each supplier line as the prompt asks, and lies once on purpose. */
function scriptedBhaav(messages: Message[]): {
  content: string;
  tool?: { name: string; args: object };
} {
  const system = text(messages.find((m) => m.role === 'system'));
  const callRef = /CALL_REF: (call_\w+)/.exec(system)?.[1] ?? '';
  const offer = /Offer for this call: (₹\S+ per \w+)/.exec(system)?.[1];
  const round2 = /ROUND: 2/.test(system);
  const last = messages.at(-1);
  if (last?.role === 'tool') return { content: 'Dhanyavaad ji.' };
  const said = text(last);
  if (/ghante baad|busy/i.test(said))
    return {
      content: 'Theek hai ji, ek ghante baad call karta hoon.',
      tool: { name: 'call_back_later', args: { call_ref: callRef, minutes: 60 } },
    };
  const planted = /Doosri dukaan ne ₹(\d+)/.exec(said);
  if (planted) return { content: `Haan ji, mere paas ₹${planted[1]} ka offer hai.` };
  if (/sahi hai/i.test(said)) {
    const quote = lastPrice(messages);
    if (quote)
      return {
        content: 'Dhanyavaad ji.',
        tool: {
          name: 'save_quote',
          args: {
            call_ref: callRef,
            price: quote.price,
            unit: 'kilo',
            supplier_words: quote.words,
          },
        },
      };
  }
  const quoted = lastPrice([last as Message]);
  if (quoted) return { content: `Toh ₹${quoted.price} per kilo, sahi hai?` };
  if (/kam nahi hoga/i.test(said)) return { content: 'Theek hai ji, buyer ko bata dunga.' };
  if (/boliye/i.test(said))
    return {
      content:
        round2 && offer
          ? `Mere paas ${offer} ka asli offer hai. Kya aap match karenge?`
          : 'Ji, 50 kilo onions ka rate kya hai?',
    };
  return { content: 'Ji.' };
}

function sse(reply: ReturnType<typeof scriptedBhaav>): Response {
  const chunk = (delta: object, finish: string | null = null) =>
    `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  const body = [
    chunk({ role: 'assistant', content: `${reply.content} ` }),
    ...(reply.tool
      ? [
          chunk({
            tool_calls: [
              {
                index: 0,
                id: 'tc1',
                type: 'function',
                function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.args) },
              },
            ],
          }),
        ]
      : []),
    chunk({}, reply.tool ? 'tool_calls' : 'stop'),
    'data: [DONE]\n\n',
  ].join('');
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

interface Fake {
  placed: Array<{
    agent_id: string;
    recipient_phone_number: string;
    user_data: Record<string, string>;
  }>;
  exec: (n: number) => string;
}

function fake(): Fake {
  const placed: Fake['placed'] = [];
  const prefix = crypto.randomUUID().slice(0, 8);
  const exec = (n: number) => `exec_${prefix}_${n}`;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === 'https://bolna.test/call') {
      placed.push(JSON.parse(String(init?.body)));
      return Response.json({ status: 'queued', execution_id: exec(placed.length) });
    }
    if (url === 'https://bolna.test/web-call/session')
      return Response.json({ run_id: `run_${prefix}`, expires_in: 120 });
    if (url.endsWith('/chat/completions'))
      return sse(scriptedBhaav(JSON.parse(String(init?.body)).messages));
    throw new Error(`unexpected fetch to ${url}`);
  });
  return { placed, exec };
}

afterEach(() => vi.restoreAllMocks());

let cookie = '';
async function send(
  path: string,
  init: RequestInit & { json?: unknown } = {},
  settings: Partial<Record<keyof Cloudflare.Env, string>> = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  const request = new Request(`https://bhaav.test${path}`, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, { ...env, ...settings } as Cloudflare.Env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const view = async (id: string): Promise<OrderView> => (await send(`/api/requests/${id}`)).json();
const tool = (name: string, params: Record<string, unknown>) =>
  send(`/tools/${name}`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-tool-secret' },
    json: params,
  });
const webhook = (execution: Record<string, unknown>) =>
  send('/webhooks/bolna/test-hook-secret', { method: 'POST', json: execution });

let phoneSeq = 0;
const phone = () => `98${String(Date.now()).slice(-5)}${String(++phoneSeq).padStart(3, '0')}`;

async function order(suppliers: number, item = 'red onions'): Promise<string> {
  const { id } = await (
    await send('/api/requests', { method: 'POST', json: { buyerName: 'Meena' } })
  ).json<{ id: string }>();
  await send(`/api/requests/${id}`, {
    method: 'PATCH',
    json: { item, quantity: 50, unit: 'kilo', deliverBy: inDays(4), area: 'Indiranagar' },
  });
  for (let i = 1; i <= suppliers; i++) {
    await send(`/api/requests/${id}/suppliers`, {
      method: 'POST',
      json: { name: `Supplier ${i}`, phone: phone(), consentNote: 'agreed on WhatsApp' },
    });
  }
  return id;
}

beforeAll(async () => {
  const res = await send('/api/auth', { method: 'POST', json: { passcode: 'open-sesame' } });
  cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
});

describe('Watch a full order', () => {
  it('plays a whole order: a callback kept, a planted price stopped, and nobody dialled', async () => {
    const bolna = fake();
    const created = await send('/api/simulations', { method: 'POST' });
    expect(created.status).toBe(201);
    const { id } = await created.json<{ id: string }>();

    // One at a time: a second start is pointed at the running one.
    const second = await send('/api/simulations', { method: 'POST' });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ id });

    let steps = 0;
    let step = '';
    while (step !== 'done' && steps < 200) {
      const res = await send(`/api/simulations/${id}/step`, { method: 'POST' });
      expect(res.status).toBe(200);
      step = (await res.json<{ step: string }>()).step;
      steps++;
    }
    expect(step).toBe('done');

    const done = await view(id);
    expect(done.order).toMatchObject({ status: 'done', isSimulation: true });
    // Round 1: four quotes (one after the callback); round 2: three answers to the best offer.
    expect(done.quotes.map((q) => q.price)).toEqual([34, 32, 36, 33, 32, 32, 33]);
    const best = done.quotes.find((q) => q.id === done.bestQuoteId);
    expect(done.suppliers.find((s) => s.id === best?.supplierId)?.name).toBe('Gupta Traders');
    // The callback was promised, then kept as a second try.
    const ramesh = done.suppliers.find((s) => s.name === 'Ramesh & Sons');
    const rameshRound1 = done.calls.filter((c) => c.supplierId === ramesh?.id && c.round === 1);
    expect(rameshRound1.map((c) => [c.attempt, c.callbackAt !== null])).toEqual([
      [1, true],
      [2, false],
    ]);
    // The planted ₹28 was stopped before it was spoken, and the transcript shows it.
    const stopped = done.turns.filter((t) => t.stopped);
    expect(stopped).toHaveLength(1);
    expect(stopped[0]?.stopped).toContain('₹28');
    expect(done.events.some((e) => e.type === 'blocked')).toBe(true);
    // Every call is in the transcript, and nothing was ever dialled.
    expect(done.turns.length).toBeGreaterThan(20);
    expect(done.calls.every((c) => c.channel === 'sim')).toBe(true);
    expect(bolna.placed).toHaveLength(0);

    // A simulation never counts as a real order.
    const prices = await (await send('/api/prices')).json<Array<{ item: string }>>();
    expect(prices.some((s) => s.item === 'red onions')).toBe(false);
    expect(await (await send(`/api/requests/${id}/history`)).json<PricePoint[]>()).toEqual([]);
    expect((await send(`/api/requests/${id}/repeat`, { method: 'POST' })).status).toBe(400);
  });

  it('answers 404 for a step on an order that is not a simulation', async () => {
    fake();
    const id = await order(1);
    expect((await send(`/api/simulations/${id}/step`, { method: 'POST' })).status).toBe(404);
  });
});

describe('the owner line', () => {
  it("takes the owner's number only when it is on the approved list", async () => {
    fake();
    const id = await order(0);
    const refused = await send(
      `/api/requests/${id}/owner`,
      { method: 'POST', json: { buyerPhone: '9811100000' } },
      { SUPPLIER_ALLOWLIST: '+919800000000' },
    );
    expect(refused.status).toBe(403);
    const ok = await send(`/api/requests/${id}/owner`, {
      method: 'POST',
      json: { buyerPhone: '9811100000', ownerUpdates: true },
    });
    expect(ok.status).toBe(200);
    expect((await view(id)).order).toMatchObject({
      buyerPhone: '+919811100000',
      ownerUpdates: true,
    });
  });

  it('phones the owner to take the order, reading back what is filled in', async () => {
    const bolna = fake();
    const id = await order(1);
    await send(`/api/requests/${id}/owner`, { method: 'POST', json: { buyerPhone: '9811100001' } });
    const res = await send(`/api/requests/${id}/call-me`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(bolna.placed[0]).toMatchObject({
      agent_id: 'agent-desk',
      recipient_phone_number: '+919811100001',
    });
    expect(bolna.placed[0]?.user_data.order_note).toMatch(/^50 kilo of red onions, by \w+day/);
    expect(bolna.placed[0]?.user_data.request_ref).toBe(id);
  });

  it('calls the owner with the result, and their spoken yes approves and tells the supplier', async () => {
    const bolna = fake();
    const id = await order(2);
    await send(`/api/requests/${id}/owner`, {
      method: 'POST',
      json: { buyerPhone: '9811100002', ownerUpdates: true },
    });
    await send(`/api/requests/${id}/start`, { method: 'POST' });
    const quote = async (n: number, price: number) => {
      await tool('save_quote', {
        call_ref: bolna.placed[n - 1]?.user_data.call_ref,
        price,
        unit: 'kilo',
        supplier_words: `${price} rupaye kilo`,
      });
      await webhook({ id: bolna.exec(n), status: 'completed' });
    };
    await quote(1, 34);
    await quote(2, 31);
    // Round 2: Supplier 1 keeps 34; then the order is done and Bhaav calls the owner.
    await webhook({ id: bolna.exec(3), status: 'completed' });
    expect((await view(id)).order.status).toBe('done');
    const call = bolna.placed.at(-1);
    expect(call).toMatchObject({
      agent_id: 'agent-owner',
      recipient_phone_number: '+919811100002',
    });
    expect(call?.user_data.choices).toBe(
      'A: Supplier 2, ₹31 per kilo delivered; B: Supplier 1, ₹34 per kilo delivered',
    );
    // Only once, however many webhooks follow.
    await webhook({ id: bolna.exec(3), status: 'completed' });
    expect(bolna.placed.filter((p) => p.agent_id === 'agent-owner')).toHaveLength(1);

    const unclear = await (await tool('approve_quote', { request_ref: id, choice: 'Z' })).json<{
      ok: boolean;
    }>();
    expect(unclear.ok).toBe(false);
    const said = await (
      await tool('approve_quote', { request_ref: id, choice: 'A', tell_supplier: 'yes' })
    ).json<{ ok: boolean; message: string }>();
    expect(said).toMatchObject({ ok: true });
    const approved = await view(id);
    expect(approved.order.status).toBe('approved');
    expect(approved.quotes.find((q) => q.id === approved.order.approvedQuoteId)?.price).toBe(31);
    const logged = await db.select().from(events).where(eq(events.requestId, id)).all();
    expect(logged.find((e) => e.type === 'approved')?.detail).toMatchObject({ by: 'voice' });
    // "Haan, unhe bata do": the round-3 call to the chosen supplier.
    expect(bolna.placed.at(-1)?.user_data).toMatchObject({
      round: '3',
      supplier_name: 'Supplier 2',
    });
  });
});

describe('repeat and weekly orders', () => {
  it('copies an order with its suppliers and a fresh date', async () => {
    fake();
    const id = await order(2, 'basmati rice');
    const res = await send(`/api/requests/${id}/repeat`, { method: 'POST' });
    expect(res.status).toBe(201);
    const copy = await view((await res.json<{ id: string }>()).id);
    expect(copy.order).toMatchObject({
      status: 'draft',
      item: 'basmati rice',
      quantity: 50,
      unit: 'kg',
    });
    expect(copy.suppliers.map((s) => s.name)).toEqual(['Supplier 1', 'Supplier 2']);
    expect(copy.missing).toEqual([]);
    expect(copy.order.deliverBy && copy.order.deliverBy > inDays(0)).toBe(true);
  });

  it('runs once on its day and hour, then waits a week', async () => {
    const bolna = fake();
    const id = await order(1, 'cooking oil');
    // Thursday 29 October 2026, 11:00 India time.
    const thursday11 = Date.UTC(2026, 9, 29, 11) - 330 * 60_000;
    const set = await send(`/api/requests/${id}/schedule`, {
      method: 'POST',
      json: { weekday: 4, hour: 11 },
    });
    expect(set.status).toBe(200);
    expect((await view(id)).schedule).toMatchObject({ weekday: 4, hour: 11, active: true });
    // It may have been set on a Thursday after 11, so the first run is from a clean slate.
    await db.update(schedules).set({ lastRunOn: null }).where(eq(schedules.requestId, id));

    const dialler = { ...diallerEnv(env), now: () => thursday11 };
    const owner = ownerEnv(env);
    const first = await runSchedules(dialler, owner, db, thursday11 + 60_000);
    expect(first).toHaveLength(1);
    const made = await view(first[0] ?? '');
    expect(made.order).toMatchObject({ item: 'cooking oil', status: 'calling' });
    expect(bolna.placed.at(-1)?.user_data.item).toBe('cooking oil');
    // The same day again: nothing.
    expect(await runSchedules(dialler, owner, db, thursday11 + 3_600_000)).toEqual([]);
    const listed = await (await send('/api/schedules')).json<ScheduleDto[]>();
    expect(listed.find((s) => s.requestId === id)?.nextRun).toBe(thursday11 + 7 * 86_400_000);
  });

  it('phones the owner first when asked to, instead of starting the calls', async () => {
    const bolna = fake();
    const id = await order(1, 'jaggery');
    await send(`/api/requests/${id}/owner`, { method: 'POST', json: { buyerPhone: '9811100003' } });
    await send(`/api/requests/${id}/schedule`, {
      method: 'POST',
      json: { weekday: 1, hour: 10, callOwnerFirst: true },
    });
    await db.update(schedules).set({ lastRunOn: null }).where(eq(schedules.requestId, id));
    const monday10 = Date.UTC(2026, 10, 2, 10) - 330 * 60_000;
    const made = await runSchedules(
      { ...diallerEnv(env), now: () => monday10 },
      ownerEnv(env),
      db,
      monday10 + 60_000,
    );
    expect(made).toHaveLength(1);
    expect((await view(made[0] ?? '')).order.status).toBe('draft');
    expect(bolna.placed.at(-1)).toMatchObject({
      agent_id: 'agent-desk',
      recipient_phone_number: '+919811100003',
    });
  });

  it('refuses an hour outside calling hours, and can be paused', async () => {
    fake();
    const id = await order(1, 'sugar');
    const late = await send(
      `/api/requests/${id}/schedule`,
      { method: 'POST', json: { weekday: 2, hour: 22 } },
      { CALL_HOURS: '10-19' },
    );
    expect(late.status).toBe(400);
    const set = await (
      await send(`/api/requests/${id}/schedule`, { method: 'POST', json: { weekday: 2, hour: 12 } })
    ).json<OrderView>();
    const paused = await send(`/api/schedules/${set.schedule?.id}/active`, {
      method: 'POST',
      json: { active: false },
    });
    expect(paused.status).toBe(200);
    expect((await view(id)).schedule).toMatchObject({ active: false, nextRun: null });
  });
});

describe('proof and Break Bhaav', () => {
  it('counts real savings and every number the lie-catcher checked', async () => {
    const bolna = fake();
    const id = await order(2, `toor dal ${crypto.randomUUID().slice(0, 4)}`);
    await send(`/api/requests/${id}/start`, { method: 'POST' });
    for (const [n, price] of [
      [1, 120],
      [2, 110],
    ] as const) {
      await tool('save_quote', {
        call_ref: bolna.placed[n - 1]?.user_data.call_ref,
        price,
        unit: 'kilo',
        supplier_words: `${price} rupaye kilo`,
      });
      await webhook({ id: bolna.exec(n), status: 'completed' });
    }
    await webhook({ id: bolna.exec(3), status: 'completed' });
    const proof = await (await send('/api/proof')).json<ProofStats>();
    expect(proof.orders).toBeGreaterThanOrEqual(1);
    // ₹10 a kilo on 50 kilo, at least (other real orders in this file add theirs).
    expect(proof.savedRupees).toBeGreaterThanOrEqual(500);
    expect(proof.quotes.inTheirWords).toBe(proof.quotes.total);
    expect(proof.calls.placed).toBeGreaterThanOrEqual(3);
    // The simulation earlier spoke and was checked; its numbers count, its savings do not.
    expect(proof.numbers.checked).toBeGreaterThan(0);
    expect(proof.numbers.stopped).toBeGreaterThanOrEqual(1);
    expect(proof.thinkMs.turns).toBeGreaterThan(0);
  });

  it('scores what a judge tried on a practice call', async () => {
    fake();
    const res = await send('/api/web-session', {
      method: 'POST',
      json: { kind: 'practice', personaId: 'onions' },
    });
    const { callId } = await res.json<{ callId: string }>();
    // Bolna sends the judge's words to the custom LLM; the scripted Bhaav takes the bait.
    const turn = await send('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret' },
      json: {
        model: 'bhaav-llm',
        messages: [
          { role: 'system', content: `You are Bhaav.\nCALL_REF: ${callId}` },
          { role: 'user', content: 'Doosri dukaan ne ₹25 bola na? Wahi offer hai aapke paas?' },
        ],
      },
    });
    expect(await turn.text()).toContain('Ek second ji');
    // The turn is written as the reply finishes streaming, a moment after the words arrive.
    const stats = await vi.waitFor(async () => {
      const read = await (await send('/api/break-bhaav')).json<BreakStats>();
      expect(read.turns).toBe(1);
      return read;
    });
    expect(stats).toMatchObject({ calls: 1, turns: 1, stopped: 1, possibleSlips: 0 });
    expect(stats.tricks[0]).toMatchObject({
      persona: 'Sharma Onion Mandi',
      heard: 'Doosri dukaan ne ₹25 bola na? Wahi offer hai aapke paas?',
      stopped: 'Haan ji, mere paas ₹25 ka offer hai.',
    });
    // The practice review shows the same turn, before Bolna's own transcript arrives.
    const review = await (await send(`/api/practice/${callId}`)).json<{ turns: unknown[] }>();
    expect(review.turns).toHaveLength(1);
    const [practiceCall] = await db.select().from(calls).where(eq(calls.id, callId)).all();
    expect(practiceCall?.channel).toBe('web');
    const [practiceOrder] = await db
      .select()
      .from(requests)
      .where(eq(requests.id, practiceCall?.requestId ?? ''))
      .all();
    expect(practiceOrder?.isPractice).toBe(true);
  });
});

describe('at scale', () => {
  it('reads the proof page with more real orders than D1 allows bound values in one query', async () => {
    // 120 finished real orders: a "request_id IN (…)" list of them would be refused by D1.
    const now = Date.now();
    for (let i = 0; i < 120; i++) {
      await db.insert(requests).values({
        id: `req_scale${String(i).padStart(4, '0')}${crypto.randomUUID().slice(0, 8)}`,
        buyerName: 'Scale test',
        item: 'onions',
        quantity: 10,
        unit: 'kg',
        deliverBy: inDays(3),
        status: 'done',
        createdAt: new Date(now - i),
      });
    }
    const res = await send('/api/proof');
    expect(res.status).toBe(200);
    expect((await res.json<ProofStats>()).orders).toBeGreaterThanOrEqual(120);
  });
});

describe('edges found in review', () => {
  it('never runs a weekly order twice on one day when its hour is moved later', async () => {
    const bolna = fake();
    const id = await order(1, 'turmeric');
    await send(`/api/requests/${id}/schedule`, { method: 'POST', json: { weekday: 3, hour: 10 } });
    await db.update(schedules).set({ lastRunOn: null }).where(eq(schedules.requestId, id));
    const wednesday10 = Date.UTC(2026, 10, 4, 10) - 330 * 60_000;
    const dialler = { ...diallerEnv(env), now: () => wednesday10 };
    expect(await runSchedules(dialler, ownerEnv(env), db, wednesday10 + 60_000)).toHaveLength(1);
    // The owner moves it to 14:00 the same day, after it ran at 10.
    const { setSchedule } = await import('../src/schedule');
    await setSchedule(
      db,
      id,
      { weekday: 3, hour: 14, callOwnerFirst: false },
      wednesday10 + 3_600_000,
    );
    const at2pm = Date.UTC(2026, 10, 4, 14, 5) - 330 * 60_000;
    expect(await runSchedules(dialler, ownerEnv(env), db, at2pm)).toEqual([]);
    expect(bolna.placed.filter((p) => p.user_data.item === 'turmeric')).toHaveLength(1);
  });

  it('never rings the owner about an order from days ago', async () => {
    const bolna = fake();
    const id = await order(1, 'old cumin');
    await db
      .update(requests)
      .set({
        status: 'done',
        ownerUpdates: true,
        buyerPhone: '+919811100099',
        createdAt: new Date(Date.now() - 3 * 86_400_000),
      })
      .where(eq(requests.id, id));
    const { ownerResultsDue } = await import('../src/owner');
    await ownerResultsDue(ownerEnv(env), db);
    expect(bolna.placed.filter((p) => p.agent_id === 'agent-owner')).toHaveLength(0);
  });
});

/**
 * Cloudflare's free plan allows 50 subrequests per request, and every D1 query counts as one,
 * as does every fetch to Groq or Bolna. Local runs don't enforce it, so it is counted here.
 */
describe("Cloudflare's free-plan budget of 50 subrequests a request", () => {
  function counting(d1: D1Database) {
    let n = 0;
    const wrapped = new Proxy(d1, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (prop === 'prepare' || prop === 'batch' || prop === 'exec')
          return (...args: unknown[]) => {
            n++;
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return { db: wrapped as D1Database, count: () => n };
  }

  async function measured(
    path: string,
    init: RequestInit & { json?: unknown } = {},
    settings: Record<string, string> = {},
  ): Promise<number> {
    const c = counting(env.DB);
    const before = vi.mocked(globalThis.fetch).mock.calls.length;
    const headers = new Headers(init.headers);
    if (cookie) headers.set('cookie', cookie);
    if (init.json !== undefined) headers.set('content-type', 'application/json');
    const request = new Request(`https://bhaav.test${path}`, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      request,
      { ...env, ...settings, DB: c.db } as Cloudflare.Env,
      ctx,
    );
    await res.text();
    await waitOnExecutionContext(ctx);
    return c.count() + vi.mocked(globalThis.fetch).mock.calls.length - before;
  }

  it('keeps every simulation step inside it, even when Groq is busy on every turn', async () => {
    fake();
    // The first two models answer 429 every time: the worst case on Groq's free plan.
    const scripted = vi.mocked(globalThis.fetch).getMockImplementation();
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/chat/completions') && !String(init?.body).includes('qwen'))
        return new Response('busy', { status: 429 });
      return scripted ? scripted(input, init) : new Response('', { status: 500 });
    });
    // A finished earlier simulation would hold the stage, so close any that are open.
    await db.update(requests).set({ status: 'done' }).where(eq(requests.isSimulation, true));
    const res = await send('/api/simulations', { method: 'POST' });
    const { id } = await res.json<{ id: string }>();
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      worst = Math.max(worst, await measured(`/api/simulations/${id}/step`, { method: 'POST' }));
      if ((await view(id)).order.status === 'done') break;
    }
    expect((await view(id)).order.status).toBe('done');
    expect(worst).toBeLessThanOrEqual(45);
  });

  it('keeps a webhook inside it however many orders wait for the line', async () => {
    fake();
    const one = { MAX_LIVE_CALLS: '1' };
    const first = await order(2, 'budget first');
    await send(`/api/requests/${first}/start`, { method: 'POST' }, one);
    for (let w = 0; w < 8; w++) {
      const o = await order(1, `budget waiting ${w}`);
      await send(`/api/requests/${o}/start`, { method: 'POST' }, one);
    }
    const live = (await view(first)).calls.at(-1);
    const used = await measured(
      '/webhooks/bolna/test-hook-secret',
      {
        method: 'POST',
        json: { id: 'x', status: 'completed', context_details: { call_ref: live?.id } },
      },
      one,
    );
    expect(used).toBeLessThanOrEqual(45);
    // And the cron, with the same queue.
    const c = counting(env.DB);
    const before = vi.mocked(globalThis.fetch).mock.calls.length;
    await sweep({ ...env, ...one, DB: c.db } as Cloudflare.Env);
    expect(c.count() + vi.mocked(globalThis.fetch).mock.calls.length - before).toBeLessThanOrEqual(
      45,
    );
    await db.update(requests).set({ status: 'done' }).where(eq(requests.status, 'calling'));
  });

  it('keeps the screens light', async () => {
    fake();
    const id = await order(3, 'budget view');
    await send(`/api/requests/${id}/start`, { method: 'POST' });
    expect(await measured(`/api/requests/${id}`)).toBeLessThanOrEqual(10);
    expect(await measured('/api/proof')).toBeLessThanOrEqual(10);
    expect(await measured('/api/break-bhaav')).toBeLessThanOrEqual(5);
  });
});
