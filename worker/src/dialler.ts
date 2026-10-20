// The dialler: after the buyer says go, and after every call ends, `advance` decides the one next
// step for an order. Round 1 asks each supplier in turn; round 2 calls back the costlier ones with
// the best real offer; then the order is done. Calls go one at a time (Bolna's trial allows two,
// and the buyer's browser call may hold one).

import { type CallStatus, FINAL_CALL_STATUSES } from '@bhaav/shared';
import { and, eq, gte, inArray, isNotNull, isNull } from 'drizzle-orm';
import { type BolnaConfig, type Execution, placeCall } from './bolna';
import type { Db } from './db/context';
import {
  type CallRow,
  calls,
  events,
  quotes,
  type RequestRow,
  requests,
  type SupplierRow,
  suppliers,
} from './db/schema';
import { bestOffer, describeOffer, describeQuote, round2List } from './engine';
import { newId } from './ids';
import { dateWords, orderOf, quantityWords, toTerms } from './orders';

const LIVE: CallStatus[] = [
  'scheduled',
  'queued',
  'rescheduled',
  'initiated',
  'ringing',
  'in-progress',
  'call-disconnected',
];

const LANGUAGE_NAMES: Record<string, string> = { hi: 'Hindi', en: 'English', kn: 'Kannada' };

export const isFinal = (status: string) =>
  (FINAL_CALL_STATUSES as readonly string[]).includes(status);

export interface DiallerEnv {
  bolna: BolnaConfig;
  callerAgentId: string;
  fromNumber?: string;
  /** Numbers Bhaav may call; empty means any. */
  allowlist: ReadonlySet<string>;
  maxCallsPerDay: number;
}

/** Parses SUPPLIER_ALLOWLIST ("+91…,+91…") into a set of E.164 numbers. */
export function parseAllowlist(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean),
  );
}

export function diallerEnv(env: Cloudflare.Env): DiallerEnv {
  const cap = Number(env.MAX_CALLS_PER_DAY);
  return {
    bolna: { apiKey: env.BOLNA_API_KEY, baseUrl: env.BOLNA_BASE_URL },
    callerAgentId: env.BOLNA_CALLER_AGENT_ID,
    fromNumber: env.BOLNA_FROM_NUMBER || undefined,
    allowlist: parseAllowlist(env.SUPPLIER_ALLOWLIST),
    maxCallsPerDay: Number.isFinite(cap) && cap >= 0 ? cap : 60,
  };
}

/** Phone calls placed in the last 24 hours, across every order. */
async function callsInLastDay(db: Db, now = Date.now()): Promise<number> {
  const rows = await db
    .select({ id: calls.id })
    .from(calls)
    .where(and(eq(calls.channel, 'phone'), gte(calls.createdAt, new Date(now - 86_400_000))))
    .all();
  return rows.length;
}

/** The variables the Caller's prompt is filled with (Bolna substitutes them from user_data). */
export function callerUserData(
  request: RequestRow,
  supplier: SupplierRow,
  call: { id: string; round: number },
  bestOfferText: string | null,
): Record<string, string> {
  return {
    call_ref: call.id,
    buyer_name: request.buyerName || 'our customer',
    supplier_name: supplier.name,
    item: request.item ?? 'the item',
    quantity: quantityWords(request.quantity, request.unit),
    quality: request.quality || 'standard quality',
    area: request.area || 'the shop',
    deliver_by: dateWords(request.deliverBy),
    round: String(call.round),
    best_offer: bestOfferText ?? 'none',
    language: LANGUAGE_NAMES[supplier.language] ?? 'Hindi',
    // Starts a multilingual Bolna agent in the supplier's language.
    agent_language: supplier.language in LANGUAGE_NAMES ? supplier.language : 'hi',
  };
}

async function logEvent(
  db: Db,
  requestId: string,
  callId: string | null,
  type: 'error' | 'status',
  detail: Record<string, unknown>,
) {
  await db.insert(events).values({ id: newId('evt'), requestId, callId, type, detail });
}

/** Inserts the call row first: the unique indexes make a racing second dialler fail here, not dial. */
async function dial(
  env: DiallerEnv,
  db: Db,
  request: RequestRow,
  supplier: SupplierRow,
  round: number,
  bestOfferText: string | null,
): Promise<'dialled' | 'raced' | 'failed'> {
  const call = { id: newId('call'), round };
  try {
    await db.insert(calls).values({
      id: call.id,
      requestId: request.id,
      supplierId: supplier.id,
      round,
      channel: 'phone',
      status: 'queued',
      bestOfferSaid: bestOfferText,
    });
  } catch {
    return 'raced';
  }

  try {
    const placed = await placeCall(env.bolna, {
      agentId: env.callerAgentId,
      phone: supplier.phone,
      fromNumber: env.fromNumber,
      userData: callerUserData(request, supplier, call, bestOfferText),
    });
    await db
      .update(calls)
      .set({ bolnaExecutionId: placed.execution_id, startedAt: new Date() })
      .where(eq(calls.id, call.id));
    return 'dialled';
  } catch (error) {
    await db
      .update(calls)
      .set({ status: 'failed', endedAt: new Date() })
      .where(eq(calls.id, call.id));
    await logEvent(db, request.id, call.id, 'error', {
      message: 'Bolna would not place the call',
      error: error instanceof Error ? error.message : String(error),
      body: (error as { body?: string }).body?.slice(0, 500),
    });
    return 'failed';
  }
}

export type Step = 'not-calling' | 'waiting' | 'dialled' | 'done';

/** Takes the one next step for an order. Safe to run any number of times, from anywhere. */
export async function advance(
  env: DiallerEnv,
  db: Db,
  requestId: string,
  depth = 0,
): Promise<Step> {
  const request = await db.select().from(requests).where(eq(requests.id, requestId)).get();
  if (!request || (request.status !== 'calling' && request.status !== 'bargaining'))
    return 'not-calling';
  const order = orderOf(request);
  if (!order) return 'not-calling';

  const [supplierRows, callRows, quoteRows] = await Promise.all([
    db.select().from(suppliers).where(eq(suppliers.requestId, requestId)).all(),
    db
      .select()
      .from(calls)
      .where(and(eq(calls.requestId, requestId), eq(calls.channel, 'phone')))
      .all(),
    db.select().from(quotes).where(eq(quotes.requestId, requestId)).all(),
  ]);
  if (callRows.some((c) => LIVE.includes(c.status))) return 'waiting';

  const callable = supplierRows
    .filter((s) => !s.doNotCall && s.phone !== 'web')
    .filter((s) => env.allowlist.size === 0 || env.allowlist.has(s.phone))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const calledIn = (round: number) =>
    new Set(callRows.filter((c) => c.round === round).map((c) => c.supplierId));

  if ((await callsInLastDay(db)) >= env.maxCallsPerDay) {
    await logEvent(db, requestId, null, 'error', {
      reason: 'daily_limit',
      message: `Stopped: the daily limit of ${env.maxCallsPerDay} calls is reached (MAX_CALLS_PER_DAY).`,
    });
    await db.update(requests).set({ status: 'done' }).where(eq(requests.id, requestId));
    return 'done';
  }

  let outcome: 'dialled' | 'raced' | 'failed' | null = null;

  if (request.status === 'calling') {
    const next = callable.find((s) => !calledIn(1).has(s.id));
    if (next) outcome = await dial(env, db, request, next, 1, null);
    else {
      await db
        .update(requests)
        .set({ status: 'bargaining' })
        .where(and(eq(requests.id, requestId), eq(requests.status, 'calling')));
      return depth < 20 ? advance(env, db, requestId, depth + 1) : 'waiting';
    }
  } else {
    // Bargaining: recomputed every time, so a better round-2 quote becomes the next best offer.
    const terms = quoteRows.map(toTerms);
    const round2 = calledIn(2);
    const states = callable.map((s) => ({
      id: s.id,
      doNotCall: s.doNotCall,
      round2Calls: round2.has(s.id) ? 1 : 0,
    }));
    const nextId = round2List(terms, order, states)[0];
    const best = bestOffer(terms, order);
    const next = callable.find((s) => s.id === nextId);
    if (next && best) outcome = await dial(env, db, request, next, 2, describeOffer(best, order));
    else {
      await db
        .update(requests)
        .set({ status: 'done' })
        .where(and(eq(requests.id, requestId), eq(requests.status, 'bargaining')));
      return 'done';
    }
  }

  if (outcome === 'failed' && depth < 20) return advance(env, db, requestId, depth + 1);
  return outcome === 'dialled' ? 'dialled' : 'waiting';
}

/**
 * Round 3, only when the buyer asks: after they approve a quote, Bhaav calls that supplier to say
 * the buyer has chosen them and will call to place the order. It never places the order itself.
 */
export async function confirmChoice(
  env: DiallerEnv,
  db: Db,
  requestId: string,
): Promise<{ ok: boolean; message: string; notFound?: boolean }> {
  const request = await db.select().from(requests).where(eq(requests.id, requestId)).get();
  if (!request) return { ok: false, notFound: true, message: 'No such order.' };
  if (request.status !== 'approved' || !request.approvedQuoteId) {
    return { ok: false, message: 'Approve a quote first.' };
  }
  const quote = await db.select().from(quotes).where(eq(quotes.id, request.approvedQuoteId)).get();
  const supplier = quote
    ? await db.select().from(suppliers).where(eq(suppliers.id, quote.supplierId)).get()
    : undefined;
  if (!quote || !supplier) return { ok: false, message: 'The approved quote is missing.' };
  if (supplier.phone === 'web')
    return { ok: false, message: 'Practice suppliers cannot be called.' };
  if (supplier.doNotCall)
    return { ok: false, message: `${supplier.name} asked not to be called again.` };
  if (env.allowlist.size > 0 && !env.allowlist.has(supplier.phone)) {
    return { ok: false, message: 'This number is not on the approved list.' };
  }
  if (!env.callerAgentId)
    return { ok: false, message: 'The Caller agent is not set up (BOLNA_CALLER_AGENT_ID).' };
  const already = await db
    .select({ id: calls.id })
    .from(calls)
    .where(
      and(eq(calls.requestId, requestId), eq(calls.supplierId, supplier.id), eq(calls.round, 3)),
    )
    .get();
  if (already)
    return { ok: false, message: `Bhaav has already called ${supplier.name} to confirm.` };
  if ((await callsInLastDay(db)) >= env.maxCallsPerDay) {
    return { ok: false, message: `The daily limit of ${env.maxCallsPerDay} calls is reached.` };
  }

  const outcome = await dial(env, db, request, supplier, 3, describeQuote(toTerms(quote)));
  if (outcome === 'dialled') return { ok: true, message: `Calling ${supplier.name} to confirm.` };
  if (outcome === 'raced')
    return { ok: false, message: `Bhaav is already calling ${supplier.name}.` };
  return { ok: false, message: 'Bolna would not place the call. See Problems on the calls page.' };
}

/**
 * Applies a Bolna execution (from a webhook or a poll) to its call. Returns the call when it has
 * just finished (so the caller can advance its order), otherwise null.
 */
export async function applyExecution(
  db: Db,
  execution: Execution,
  callRef: string | null,
): Promise<CallRow | null> {
  // Our own call id first (from user_data, or passed by the cron); Bolna's id as the fallback.
  const byRef = callRef
    ? await db.select().from(calls).where(eq(calls.id, callRef)).get()
    : undefined;
  const call =
    byRef ??
    (execution.id
      ? await db.select().from(calls).where(eq(calls.bolnaExecutionId, execution.id)).get()
      : undefined);
  if (!call) return null;

  const incoming = execution.status as CallStatus;
  const known = (LIVE as string[]).includes(incoming) || isFinal(incoming);
  // Webhooks can arrive out of order: never move a finished call back to a live status.
  const status = isFinal(call.status) || !known ? call.status : incoming;
  const finishedNow = !isFinal(call.status) && isFinal(status);

  await db
    .update(calls)
    .set({
      status,
      bolnaExecutionId: call.bolnaExecutionId ?? execution.id ?? null,
      transcript: execution.transcript || call.transcript,
      recordingUrl: execution.telephony_data?.recording_url || call.recordingUrl,
      ...(finishedNow ? { endedAt: new Date() } : {}),
    })
    .where(eq(calls.id, call.id));

  if (finishedNow && execution.error_message) {
    await logEvent(db, call.requestId, call.id, 'status', {
      status,
      error: execution.error_message,
    });
  }
  return finishedNow ? { ...call, status } : null;
}

/** Phone calls still live after `olderThanMs`, for the cron to check with Bolna. */
export function staleCalls(db: Db, olderThanMs: number, now = Date.now()) {
  return db
    .select()
    .from(calls)
    .where(
      and(
        eq(calls.channel, 'phone'),
        inArray(calls.status, LIVE),
        isNotNull(calls.bolnaExecutionId),
      ),
    )
    .all()
    .then((rows) => rows.filter((c) => now - c.createdAt.getTime() > olderThanMs));
}

/**
 * Phone calls saved but never handed to Bolna (the Worker stopped between the two steps). Left
 * alone they would hold their order's one live-call slot forever, so they are marked failed.
 */
export async function failOrphanedCalls(
  db: Db,
  olderThanMs: number,
  now = Date.now(),
): Promise<number> {
  const rows = await db
    .select()
    .from(calls)
    .where(
      and(eq(calls.channel, 'phone'), inArray(calls.status, LIVE), isNull(calls.bolnaExecutionId)),
    )
    .all();
  const orphans = rows.filter((c) => now - c.createdAt.getTime() > olderThanMs);
  for (const call of orphans) {
    await db
      .update(calls)
      .set({ status: 'failed', endedAt: new Date(now) })
      .where(eq(calls.id, call.id));
    await logEvent(db, call.requestId, call.id, 'error', {
      message: 'The call was never placed with Bolna.',
    });
  }
  return orphans.length;
}

/** Orders mid-call with no live call: a lost webhook would otherwise leave them stuck. */
export async function stalledRequests(db: Db): Promise<string[]> {
  const active = await db
    .select()
    .from(requests)
    .where(inArray(requests.status, ['calling', 'bargaining']))
    .all();
  const stalled: string[] = [];
  for (const r of active) {
    const live = await db
      .select({ id: calls.id })
      .from(calls)
      .where(
        and(eq(calls.requestId, r.id), eq(calls.channel, 'phone'), inArray(calls.status, LIVE)),
      )
      .get();
    if (!live) stalled.push(r.id);
  }
  return stalled;
}
