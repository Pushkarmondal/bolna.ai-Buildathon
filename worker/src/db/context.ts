// What the lie-catcher needs from the database: the numbers a call may state, and a place to log.
// A reference is either a Caller's call id (call_…) or the Desk's order id (req_…).

import { eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { newId } from '../ids';
import type { CatcherEvent } from '../llm';
import { numbersIn } from '../numbers';
import { calls, events, quotes, requests } from './schema';

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

/** Appends a lie-catcher event; a reference that matches nothing is kept in the detail only. */
export async function recordEvent(db: Db, event: CatcherEvent): Promise<void> {
  let requestId: string | null = null;
  let callId: string | null = null;
  if (event.callRef?.startsWith('req_')) {
    const request = await db
      .select({ id: requests.id })
      .from(requests)
      .where(eq(requests.id, event.callRef))
      .get();
    requestId = request?.id ?? null;
  } else if (event.callRef) {
    const call = await db
      .select({ id: calls.id, requestId: calls.requestId })
      .from(calls)
      .where(eq(calls.id, event.callRef))
      .get();
    requestId = call?.requestId ?? null;
    callId = call?.id ?? null;
  }
  const { type, ...detail } = event;
  await db.insert(events).values({ id: newId('evt'), type, requestId, callId, detail });
}
