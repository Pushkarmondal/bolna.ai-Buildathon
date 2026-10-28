// What the lie-catcher needs from the database: the numbers a call may state, and a place to log.
// A reference is either a Caller's call id (call_…) or the Desk's order id (req_…).

import { eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { newId } from '../ids';
import type { CatcherEvent } from '../llm';
import { numbersIn } from '../numbers';
import { calls, events, quotes, requests, turns } from './schema';

export type Db = DrizzleD1Database<Record<string, unknown>>;

const dateParts = (iso: string | null | undefined): number[] =>
  iso ? iso.split('-').map(Number).filter(Number.isFinite) : [];

async function orderNumbers(db: Db, requestId: string): Promise<number[]> {
  const [request, book] = await Promise.all([
    db.select().from(requests).where(eq(requests.id, requestId)).get(),
    db.select().from(quotes).where(eq(quotes.requestId, requestId)).all(),
  ]);
  const values: number[] = [];
  if (request?.quantity != null) values.push(request.quantity);
  values.push(...dateParts(request?.deliverBy));
  for (const q of book) {
    values.push(q.price);
    for (const v of [q.packSize, q.minQuantity, q.deliveryCharge, q.landedPricePerUnit]) {
      if (v != null) values.push(v);
    }
    values.push(...dateParts(q.deliveryDate), ...numbersIn(q.supplierWords));
  }
  return values;
}

/**
 * Every number a call may say out loud: the order's quantity and date, every figure in the
 * order's quote book, and (for a Caller call) the best offer it was given.
 */
export async function allowedNumbersFor(db: Db, ref: string | null): Promise<number[]> {
  if (!ref) return [];
  if (ref.startsWith('req_')) return orderNumbers(db, ref);

  const call = await db.select().from(calls).where(eq(calls.id, ref)).get();
  if (!call) return [];
  const values = await orderNumbers(db, call.requestId);
  if (call.bestOfferSaid) values.push(...numbersIn(call.bestOfferSaid));
  return values;
}

/**
 * Appends a lie-catcher event; a reference that matches nothing is kept in the detail only. A
 * turn goes to the transcript (`turns`) instead of the events log.
 */
type Resolved = { requestId: string | null; callId: string | null };

/** The order and call a reference names; null for one that matches nothing. */
async function resolve(db: Db, ref: string | null | undefined): Promise<Resolved> {
  if (ref?.startsWith('req_')) {
    const request = await db
      .select({ id: requests.id })
      .from(requests)
      .where(eq(requests.id, ref))
      .get();
    return { requestId: request?.id ?? null, callId: null };
  }
  if (ref) {
    const call = await db
      .select({ id: calls.id, requestId: calls.requestId })
      .from(calls)
      .where(eq(calls.id, ref))
      .get();
    return { requestId: call?.requestId ?? null, callId: call?.id ?? null };
  }
  return { requestId: null, callId: null };
}

/**
 * Records events for one request, looking each reference up once: a busy Groq can bring several
 * events in one turn, and every query counts toward Cloudflare's 50 subrequests a request.
 */
export function eventRecorder(db: Db) {
  const seen = new Map<string, Promise<Resolved>>();
  return (event: CatcherEvent) => {
    const key = event.callRef ?? '';
    if (!seen.has(key)) seen.set(key, resolve(db, event.callRef));
    return recordEvent(db, event, seen.get(key));
  };
}

export async function recordEvent(
  db: Db,
  event: CatcherEvent,
  resolved: Promise<Resolved> = resolve(db, event.callRef),
): Promise<void> {
  const { requestId, callId } = await resolved;
  if (event.type === 'turn') {
    await db.insert(turns).values({
      id: newId('turn'),
      requestId,
      callId,
      heard: event.heard,
      said: event.said,
      stopped: event.stopped,
      numbers: event.numbers,
      thinkMs: event.thinkMs,
    });
    return;
  }
  const { type, ...detail } = event;
  await db.insert(events).values({ id: newId('evt'), type, requestId, callId, detail });
}
