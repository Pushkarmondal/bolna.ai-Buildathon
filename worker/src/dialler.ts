// The dialler: after the buyer says go, and after every call ends, `advance` decides the one next
// step for an order. Round 1 asks each supplier in turn; round 2 calls back the costlier ones with
// the best real offer; then the order is done. Calls go one at a time across every order (Bolna's
// trial allows two, and the buyer's browser call may hold one), only in calling hours, and a call
// Bolna refuses for a passing reason (busy, at its call limit) is tried again a minute later.

import { type CallStatus, FINAL_CALL_STATUSES } from '@bhaav/shared';
import { and, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { type BolnaConfig, BolnaError, type Execution, placeCall } from './bolna';
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

/** Tries per supplier per round when Bolna refuses for a passing reason. */
export const MAX_ATTEMPTS = 3;
/** How long after a passing refusal the same supplier is tried again. */
export const RETRY_AFTER_MS = 60_000;
/** A placed call Bolna has still not finished after this long is given up on (calls stop at 4 minutes). */
export const GIVE_UP_AFTER_MS = 15 * 60_000;

export const isFinal = (status: string) =>
  (FINAL_CALL_STATUSES as readonly string[]).includes(status);

/** Numbers Bhaav may call: a list, or any number (SUPPLIER_ALLOWLIST="*", for local fakes only). */
export type Allowlist = ReadonlySet<string> | 'any';

export interface DiallerEnv {
  bolna: BolnaConfig;
  callerAgentId: string;
  fromNumber?: string;
  /** An empty list allows no number at all. */
  allowlist: Allowlist;
  maxCallsPerDay: number;
  /** Phone calls live at once across every order. */
  maxLiveCalls: number;
  /** India-time hours when suppliers may be called: from 10 to 19 is 10:00 to 18:59. */
  callHours: { from: number; to: number };
  /** The clock, so tests can be any time of day. */
  now?: () => number;
}

/** Parses SUPPLIER_ALLOWLIST ("+91…,+91…") into a set of E.164 numbers; "*" allows any. */
export function parseAllowlist(value: string | undefined): Allowlist {
  if (value?.trim() === '*') return 'any';
  return new Set(
    (value ?? '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean),
  );
}

export const mayCall = (allowlist: Allowlist, phone: string) =>
  allowlist === 'any' || allowlist.has(phone);

/** "10-19" is 10:00 to 19:00 India time; "0-24" is any time. Anything else keeps 10 to 19. */
export function parseCallHours(value: string | undefined): { from: number; to: number } {
  const match = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(value ?? '');
  const from = Number(match?.[1]);
  const to = Number(match?.[2]);
  return match && from >= 0 && from < to && to <= 24 ? { from, to } : { from: 10, to: 19 };
}

/** Whether `now` falls in the calling hours, in India time. */
export function inCallHours(hours: { from: number; to: number }, now = Date.now()): boolean {
  const hour = new Date(now + 330 * 60_000).getUTCHours();
  return hour >= hours.from && hour < hours.to;
}

export function diallerEnv(env: Cloudflare.Env): DiallerEnv {
  const cap = Number(env.MAX_CALLS_PER_DAY);
  const live = Number(env.MAX_LIVE_CALLS);
  return {
    bolna: { apiKey: env.BOLNA_API_KEY, baseUrl: env.BOLNA_BASE_URL },
    callerAgentId: env.BOLNA_CALLER_AGENT_ID,
    fromNumber: env.BOLNA_FROM_NUMBER || undefined,
    allowlist: parseAllowlist(env.SUPPLIER_ALLOWLIST),
    maxCallsPerDay: Number.isFinite(cap) && cap >= 0 ? cap : 60,
    maxLiveCalls: Number.isInteger(live) && live >= 1 ? live : 1,
    callHours: parseCallHours(env.CALL_HOURS),
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

/**
 * Phone calls live right now, across every order. Written to match the partial index
 * calls_one_live_per_order word for word, so SQLite reads only the live rows.
 */
export async function liveCallCount(db: Db): Promise<number> {
  const rows = await db
    .select({ id: calls.id })
    .from(calls)
    .where(
      sql`${calls.channel} = 'phone' and ${calls.status} in ('scheduled', 'queued', 'rescheduled', 'initiated', 'ringing', 'in-progress', 'call-disconnected')`,
    )
    .all();
  return rows.length;
}

/**
 * A refusal that may pass: Bolna busy or at its call limit, a server error, or no answer at all.
 * A refusal about the number itself (unverified on a trial account, malformed) will not pass.
 */
export function isPassingRefusal(error: unknown): boolean {
  if (!(error instanceof BolnaError)) return true;
  if (error.status === 0) return false; // no API key: trying again changes nothing
  if ([408, 425, 429].includes(error.status) || error.status >= 500) return true;
  return /concurren|capacity|limit|busy|try again/i.test(error.body);
}

type RoundState =
  | { kind: 'new' }
  | { kind: 'done' }
  | { kind: 'retry'; attempt: number }
  | { kind: 'wait' };

/**
 * Where a supplier stands in a round: not called yet, done with (called, or given up on after
 * three passing refusals), due another try, or waiting out the minute after a passing refusal.
 */
export function roundState(
  callRows: readonly CallRow[],
  supplierId: string,
  round: number,
  now: number,
): RoundState {
  const own = callRows.filter((c) => c.supplierId === supplierId && c.round === round);
  if (own.length === 0) return { kind: 'new' };
  if (own.some((c) => !(c.status === 'failed' && c.retryable))) return { kind: 'done' };
  if (own.length >= MAX_ATTEMPTS) return { kind: 'done' };
  const last = Math.max(...own.map((c) => c.createdAt.getTime()));
  return now - last < RETRY_AFTER_MS
    ? { kind: 'wait' }
    : { kind: 'retry', attempt: own.length + 1 };
}

const attemptOf = (state: RoundState) => (state.kind === 'retry' ? state.attempt : 1);

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

/**
 * Inserts the call row first: the unique indexes make a racing second dialler fail here, not dial.
 * 'busy' is a passing refusal, tried again later; 'failed' is final for this supplier and round.
 */
async function dial(
  env: DiallerEnv,
  db: Db,
  request: RequestRow,
  supplier: SupplierRow,
  round: number,
  bestOfferText: string | null,
  attempt: number,
): Promise<'dialled' | 'raced' | 'busy' | 'failed'> {
  const call = { id: newId('call'), round };
  try {
    await db.insert(calls).values({
      id: call.id,
      requestId: request.id,
      supplierId: supplier.id,
      round,
      attempt,
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
    const passing = isPassingRefusal(error) && attempt < MAX_ATTEMPTS;
    await db
      .update(calls)
      .set({ status: 'failed', endedAt: new Date(), retryable: passing })
      .where(eq(calls.id, call.id));
    await logEvent(db, request.id, call.id, 'error', {
      message: passing
        ? `Bolna could not place the call to ${supplier.name} just now; Bhaav will try again in a minute.`
        : `Bolna would not place the call to ${supplier.name}.`,
      error: error instanceof Error ? error.message : String(error),
      body: (error as { body?: string }).body?.slice(0, 500),
    });
    return passing ? 'busy' : 'failed';
  }
}

export type Step = 'not-calling' | 'waiting' | 'dialled' | 'done';

type Next =
  | { supplier: SupplierRow; round: number; attempt: number; bestOfferText: string | null }
  | 'wait'
  | 'none';

/**
 * The first supplier due a call in this round, in list order. A supplier waiting out a busy
 * Bolna holds the round ('wait'): Bolna's being busy is no reason to skip to someone else.
 */
function nextIn(
  candidates: readonly SupplierRow[],
  callRows: readonly CallRow[],
  round: number,
  now: number,
  bestOfferText: string | null,
): Next {
  for (const supplier of candidates) {
    const state = roundState(callRows, supplier.id, round, now);
    if (state.kind === 'new' || state.kind === 'retry')
      return { supplier, round, attempt: attemptOf(state), bestOfferText };
    if (state.kind === 'wait') return 'wait';
  }
  return 'none';
}

/** Takes the one next step for an order. Safe to run any number of times, from anywhere. */
export async function advance(
  env: DiallerEnv,
  db: Db,
  requestId: string,
  depth = 0,
): Promise<Step> {
  const now = env.now?.() ?? Date.now();
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
    .filter((s) => !s.doNotCall && s.phone !== 'web' && mayCall(env.allowlist, s.phone))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  let next: Next;
  if (request.status === 'calling') {
    next = nextIn(callable, callRows, 1, now, null);
  } else {
    // Bargaining: recomputed every time, so a better round-2 quote becomes the next best offer.
    const terms = quoteRows.map(toTerms);
    const best = bestOffer(terms, order);
    const states = callable.map((s) => ({
      id: s.id,
      doNotCall: s.doNotCall,
      round2Calls: roundState(callRows, s.id, 2, now).kind === 'done' ? 1 : 0,
    }));
    const ids = round2List(terms, order, states);
    const due = ids.flatMap((id) => callable.filter((s) => s.id === id));
    next = best ? nextIn(due, callRows, 2, now, describeOffer(best, order)) : 'none';
  }

  if (next === 'wait') return 'waiting';
  if (next === 'none') {
    if (request.status === 'calling') {
      await db
        .update(requests)
        .set({ status: 'bargaining' })
        .where(and(eq(requests.id, requestId), eq(requests.status, 'calling')));
      return depth < 20 ? advance(env, db, requestId, depth + 1) : 'waiting';
    }
    await db
      .update(requests)
      .set({ status: 'done' })
      .where(and(eq(requests.id, requestId), eq(requests.status, 'bargaining')));
    return 'done';
  }

  if ((await callsInLastDay(db, now)) >= env.maxCallsPerDay) {
    await logEvent(db, requestId, null, 'error', {
      reason: 'daily_limit',
      message: `Stopped: the daily limit of ${env.maxCallsPerDay} calls is reached (MAX_CALLS_PER_DAY).`,
    });
    await db.update(requests).set({ status: 'done' }).where(eq(requests.id, requestId));
    return 'done';
  }
  // Not now: outside calling hours, or another order's call holds the line. The cron, or the
  // end of that call, brings the order back here.
  if (!inCallHours(env.callHours, now)) return 'waiting';
  if ((await liveCallCount(db)) >= env.maxLiveCalls) return 'waiting';

  const outcome = await dial(
    env,
    db,
    request,
    next.supplier,
    next.round,
    next.bestOfferText,
    next.attempt,
  );
  // A refusal about this number moves on to the next supplier; a busy Bolna is waited out.
  if (outcome === 'failed' && depth < 20) return advance(env, db, requestId, depth + 1);
  return outcome === 'dialled' ? 'dialled' : 'waiting';
}

/**
 * Advances one order, then every other order left waiting (for calling hours, for another
 * order's call to end, or to retry). Run when a call ends and from the cron.
 */
export async function advanceWaiting(
  env: DiallerEnv,
  db: Db,
  first: string | null = null,
): Promise<void> {
  if (first) await advance(env, db, first).catch(() => undefined);
  for (const requestId of await stalledRequests(db)) {
    if (requestId === first) continue;
    try {
      await advance(env, db, requestId);
    } catch {
      // Try again next time.
    }
  }
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
  if (!mayCall(env.allowlist, supplier.phone)) {
    return { ok: false, message: 'This number is not on the approved list.' };
  }
  if (!env.callerAgentId)
    return { ok: false, message: 'The Caller agent is not set up (BOLNA_CALLER_AGENT_ID).' };
  const now = env.now?.() ?? Date.now();
  const earlier = await db
    .select()
    .from(calls)
    .where(
      and(eq(calls.requestId, requestId), eq(calls.supplierId, supplier.id), eq(calls.round, 3)),
    )
    .all();
  const state = roundState(earlier, supplier.id, 3, now);
  if (state.kind === 'done')
    return { ok: false, message: `Bhaav has already called ${supplier.name} to confirm.` };
  if (state.kind === 'wait')
    return { ok: false, message: 'Bolna was busy a moment ago. Try again in a minute.' };
  if (!inCallHours(env.callHours, now)) {
    const { from, to } = env.callHours;
    return {
      ok: false,
      message: `Bhaav calls suppliers only between ${from}:00 and ${to}:00 India time. Try again then.`,
    };
  }
  if ((await liveCallCount(db)) >= env.maxLiveCalls)
    return { ok: false, message: 'Bhaav is on another call. Try again in a minute.' };
  if ((await callsInLastDay(db, now)) >= env.maxCallsPerDay) {
    return { ok: false, message: `The daily limit of ${env.maxCallsPerDay} calls is reached.` };
  }

  const outcome = await dial(
    env,
    db,
    request,
    supplier,
    3,
    describeQuote(toTerms(quote)),
    attemptOf(state),
  );
  if (outcome === 'dialled') return { ok: true, message: `Calling ${supplier.name} to confirm.` };
  if (outcome === 'raced')
    return { ok: false, message: `Bhaav is already calling ${supplier.name}.` };
  if (outcome === 'busy')
    return { ok: false, message: 'Bolna is busy right now. Try again in a minute.' };
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
    // Never placed, so nobody was called: it may be tried again like a busy Bolna.
    await db
      .update(calls)
      .set({ status: 'failed', endedAt: new Date(now), retryable: call.attempt < MAX_ATTEMPTS })
      .where(eq(calls.id, call.id));
    await logEvent(db, call.requestId, call.id, 'error', {
      message: 'The call was never placed with Bolna.',
    });
  }
  return orphans.length;
}

/**
 * Placed calls Bolna still calls live long after any call can last (a lost webhook and an
 * execution that never settles). Left alone, one would hold the line for every order forever.
 */
export async function giveUpOnStuckCalls(
  db: Db,
  olderThanMs = GIVE_UP_AFTER_MS,
  now = Date.now(),
): Promise<number> {
  const rows = await db
    .select()
    .from(calls)
    .where(
      and(
        eq(calls.channel, 'phone'),
        inArray(calls.status, LIVE),
        isNotNull(calls.bolnaExecutionId),
      ),
    )
    .all();
  const stuck = rows.filter((c) => now - c.createdAt.getTime() > olderThanMs);
  for (const call of stuck) {
    await db
      .update(calls)
      .set({ status: 'failed', endedAt: new Date(now) })
      .where(eq(calls.id, call.id));
    await logEvent(db, call.requestId, call.id, 'error', {
      message: 'Bolna never said this call ended, so Bhaav moved on.',
    });
  }
  return stuck.length;
}

/** Why an order that is mid-call has no live call, for the screen; null when one is on its way. */
export async function waitingReason(
  env: DiallerEnv,
  db: Db,
  request: Pick<RequestRow, 'status'>,
  callRows: readonly Pick<CallRow, 'channel' | 'status' | 'retryable'>[],
): Promise<'hours' | 'another_call' | 'retry' | null> {
  if (request.status !== 'calling' && request.status !== 'bargaining') return null;
  const phone = callRows.filter((c) => c.channel === 'phone');
  if (phone.some((c) => LIVE.includes(c.status))) return null;
  // Rows are oldest first: a busy Bolna on the latest try means a retry is coming.
  const latest = phone.at(-1);
  if (latest?.status === 'failed' && latest.retryable) return 'retry';
  if (!inCallHours(env.callHours, env.now?.() ?? Date.now())) return 'hours';
  if ((await liveCallCount(db)) >= env.maxLiveCalls) return 'another_call';
  return null;
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
