// The custom functions Bolna calls mid-call. Bolna fills each parameter from a Python-style
// template (%(price)f), so every value may arrive as a string, and an unfilled optional one may
// arrive as "None", "" or the raw template. Each handler returns a short `message` that Bolna
// hands back to the LLM to say.

import type { Unit } from '@bhaav/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from './db/context';
import { calls, events, quotes, requests, suppliers } from './db/schema';
import { landedPrice } from './engine';
import { newId } from './ids';
import { parseAmount } from './numbers';
import { isPastDate, normalizeDate, normalizeUnit, orderOf } from './orders';

export type Params = Record<string, unknown>;

/** A parameter as a trimmed string, or undefined when Bolna left it unfilled. */
export function param(params: Params, name: string): string | undefined {
  const raw = params[name];
  if (raw == null) return undefined;
  const value = String(raw).trim();
  if (value === '' || /^(none|null|undefined|nan)$/i.test(value) || value.startsWith('%('))
    return undefined;
  return value;
}

export function numberParam(params: Params, name: string): number | undefined {
  const value = param(params, name);
  return value === undefined ? undefined : parseAmount(value);
}

export interface ToolResult {
  ok: boolean;
  message: string;
  [key: string]: unknown;
}

export async function updateOrder(db: Db, params: Params): Promise<ToolResult> {
  const requestId = param(params, 'request_ref');
  const request = requestId
    ? await db.select().from(requests).where(eq(requests.id, requestId)).get()
    : undefined;
  if (!request)
    return {
      ok: false,
      message: 'I could not find this order. Please ask the buyer to refresh the page.',
    };
  if (request.status !== 'draft')
    return { ok: false, message: 'Calls have already started; the order can no longer change.' };

  const patch: Partial<typeof requests.$inferInsert> = {};
  const problems: string[] = [];
  const item = param(params, 'item');
  if (item) patch.item = item;
  const quality = param(params, 'quality');
  if (quality) patch.quality = quality;
  const area = param(params, 'area');
  if (area) patch.area = area;
  const quantity = numberParam(params, 'quantity');
  if (quantity !== undefined) {
    if (quantity > 0) patch.quantity = quantity;
    else problems.push('the quantity must be more than zero');
  }
  const unitWord = param(params, 'unit');
  if (unitWord) {
    const unit = normalizeUnit(unitWord);
    if (unit) patch.unit = unit;
    else
      problems.push(
        `"${unitWord}" is not a unit I know; ask for kilo, litre, piece, dozen, quintal or pack`,
      );
  }
  const dateWord = param(params, 'deliver_by');
  if (dateWord) {
    const date = normalizeDate(dateWord);
    if (!date) problems.push('send the delivery date as YYYY-MM-DD');
    else if (isPastDate(date)) problems.push('that delivery date has passed; ask for a later one');
    else patch.deliverBy = date;
  }

  if (Object.keys(patch).length > 0)
    await db.update(requests).set(patch).where(eq(requests.id, request.id));
  const merged = { ...request, ...patch };
  const stillMissing: string[] = [];
  if (!merged.item) stillMissing.push('item');
  if (merged.quantity == null) stillMissing.push('quantity');
  if (!merged.unit) stillMissing.push('unit');
  if (!merged.deliverBy) stillMissing.push('delivery date');
  const parts = [Object.keys(patch).length > 0 ? 'Saved.' : 'Nothing new to save.'];
  if (problems.length) parts.push(`Problem: ${problems.join('; ')}.`);
  if (stillMissing.length) parts.push(`Still missing: ${stillMissing.join(', ')}.`);
  return { ok: problems.length === 0, message: parts.join(' '), missing: stillMissing };
}

export async function saveQuote(db: Db, params: Params): Promise<ToolResult> {
  const callId = param(params, 'call_ref');
  const call = callId ? await db.select().from(calls).where(eq(calls.id, callId)).get() : undefined;
  if (!call) return { ok: false, message: 'Could not save: this call is not known.' };
  const request = await db.select().from(requests).where(eq(requests.id, call.requestId)).get();
  if (!request) return { ok: false, message: 'Could not save: the order is missing.' };

  const price = numberParam(params, 'price');
  // A unit it can't read is asked about, never swapped for the order's: ₹1,600 a quintal saved
  // as ₹1,600 a kilo would be a wrong quote. Only a missing unit means the order's own.
  const unitWord = param(params, 'unit');
  const unit: Unit | null = unitWord ? normalizeUnit(unitWord) : request.unit;
  const supplierWords = param(params, 'supplier_words');
  if (price === undefined || price <= 0)
    return { ok: false, message: 'Not saved: ask for the price again.' };
  if (!unit)
    return {
      ok: false,
      message:
        'Not saved: ask which unit the price is for (kilo, litre, piece, dozen, quintal or pack).',
    };
  if (!supplierWords) return { ok: false, message: "Not saved: include the supplier's own words." };

  const packUnit = normalizeUnit(param(params, 'pack_unit'));
  const terms = {
    supplierId: call.supplierId,
    price,
    unit,
    packSize: numberParam(params, 'pack_size') ?? null,
    packUnit: packUnit && packUnit !== 'pack' ? packUnit : null,
    minQuantity: numberParam(params, 'min_quantity') ?? null,
    deliveryDate: normalizeDate(param(params, 'delivery_date')),
    deliveryCharge: numberParam(params, 'delivery_charge') ?? null,
    createdAt: Date.now(),
  };
  const order = orderOf(request);
  const landed = order ? landedPrice(terms, order) : null;

  const id = newId('q');
  await db.insert(quotes).values({
    id,
    requestId: request.id,
    supplierId: call.supplierId,
    callId: call.id,
    price: terms.price,
    unit: terms.unit,
    packSize: terms.packSize,
    packUnit: terms.packUnit,
    minQuantity: terms.minQuantity,
    deliveryDate: terms.deliveryDate,
    deliveryCharge: terms.deliveryCharge,
    paymentTerms: param(params, 'payment_terms') ?? null,
    landedPricePerUnit: landed?.perUnit ?? null,
    supplierWords,
    readBackConfirmed: true,
  });
  await db.insert(events).values({
    id: newId('evt'),
    requestId: request.id,
    callId: call.id,
    type: 'tool_call',
    detail: { tool: 'save_quote', quoteId: id, price, unit },
  });
  return {
    ok: true,
    message: 'Saved. Thank the supplier.',
    quote_id: id,
    ...(landed?.reasons.includes('unit')
      ? { note: 'Unit does not match the order; ask for the price per order unit.' }
      : {}),
  };
}

export async function doNotCall(db: Db, params: Params): Promise<ToolResult> {
  const callId = param(params, 'call_ref');
  const call = callId ? await db.select().from(calls).where(eq(calls.id, callId)).get() : undefined;
  if (!call) return { ok: false, message: 'Noted.' };
  const supplier = await db.select().from(suppliers).where(eq(suppliers.id, call.supplierId)).get();
  if (supplier) {
    // Every order that lists this number stops calling it, not just this one.
    await db.update(suppliers).set({ doNotCall: true }).where(eq(suppliers.phone, supplier.phone));
    await db.insert(events).values({
      id: newId('evt'),
      requestId: call.requestId,
      callId: call.id,
      type: 'do_not_call',
      detail: { supplierId: supplier.id },
    });
  }
  return { ok: true, message: 'Noted. Apologise, say we will not call again, and end the call.' };
}

/** The buyer said go: from the Start button or the Desk's start_calls tool. */
export async function startOrder(
  db: Db,
  requestId: string,
  callerAgentId: string,
): Promise<ToolResult> {
  const request = await db.select().from(requests).where(eq(requests.id, requestId)).get();
  if (!request) return { ok: false, notFound: true, message: 'This order does not exist.' };
  if (request.status !== 'draft') return { ok: true, message: 'Calls have already started.' };

  const list = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.requestId, requestId), eq(suppliers.doNotCall, false)))
    .all();
  const missing: string[] = [];
  if (!request.item) missing.push('what to buy');
  if (request.quantity == null) missing.push('how much');
  if (!request.unit) missing.push('the unit');
  if (!request.deliverBy) missing.push('the delivery date');
  else if (isPastDate(request.deliverBy)) missing.push('a delivery date from today on');
  if (list.length === 0) missing.push('at least one supplier on the screen');
  if (missing.length)
    return { ok: false, message: `Not started. Still needed: ${missing.join(', ')}.`, missing };
  if (!callerAgentId)
    return {
      ok: false,
      message: 'Not started: the Caller agent is not set up (BOLNA_CALLER_AGENT_ID).',
    };

  await db
    .update(requests)
    .set({ status: 'calling' })
    .where(and(eq(requests.id, requestId), eq(requests.status, 'draft')));
  const n = list.length;
  return {
    ok: true,
    message: `Started. Bhaav will call ${n} supplier${n === 1 ? '' : 's'}, one at a time.`,
  };
}
