// Orders as the screens see them, plus the small parsers that turn spoken or typed values
// (units, phone numbers, dates) into what the database stores.

import type { OrderView, QuoteTerms, RankedQuote, Unit } from '@bhaav/shared';
import { asc, desc, eq } from 'drizzle-orm';
import type { Db } from './db/context';
import {
  calls,
  events,
  type QuoteRow,
  quotes,
  type RequestRow,
  requests,
  suppliers,
} from './db/schema';
import { landedPrice, UNIT_WORDS } from './engine';

const UNIT_SYNONYMS: Record<string, Unit> = {};
const synonyms: Array<[Unit, string]> = [
  ['kg', 'kg kgs kilo kilos kilogram kilograms किलो'],
  ['g', 'g gm gms gram grams ग्राम'],
  ['quintal', 'quintal quintals qtl क्विंटल'],
  ['tonne', 'tonne tonnes ton tons टन'],
  ['litre', 'l ltr litre litres liter liters लीटर'],
  ['ml', 'ml'],
  ['piece', 'piece pieces pc pcs nos unit units पीस'],
  ['dozen', 'dozen dz दर्जन'],
  ['pack', 'pack packs packet packets bag bags tin tins box boxes carton cartons sack sacks bori'],
];
for (const [unit, words] of synonyms) for (const w of words.split(' ')) UNIT_SYNONYMS[w] = unit;

/**
 * "Kilo", "kgs", "किलो", "per kg", "/kg" and "1 kg" all become kg; null when the word is not a
 * unit we know.
 */
export function normalizeUnit(value: string | null | undefined): Unit | null {
  if (!value) return null;
  const word = value
    .trim()
    .toLowerCase()
    .normalize('NFC')
    .replace(/^(?:per|prati|प्रति|a|an|one|1|ek|एक)\s+/u, '')
    .replace(/^\/\s*/, '')
    .replace(/[.\s]+$/, '');
  return UNIT_SYNONYMS[word] ?? null;
}

/** Indian mobile numbers become E.164 (+91…); anything else must already start with +. */
export function normalizePhone(value: string): string | null {
  const digits = value.replace(/[^\d+]/g, '');
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^0[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  return null;
}

/** A real calendar date as YYYY-MM-DD, from YYYY-MM-DD or DD/MM/YYYY; null otherwise. */
export function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  let iso: string | null = null;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v);
  if (ymd) iso = v;
  else if (dmy) iso = `${dmy[3]}-${dmy[2]?.padStart(2, '0')}-${dmy[1]?.padStart(2, '0')}`;
  if (!iso) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

/** Today's date in India as YYYY-MM-DD; the buyers and suppliers are all on IST. */
export function indiaToday(now = Date.now()): string {
  return new Date(now + 330 * 60_000).toISOString().slice(0, 10);
}

/** True when a YYYY-MM-DD delivery date is before today in India. */
export const isPastDate = (iso: string, now = Date.now()) => iso < indiaToday(now);

/**
 * Today in India for the Desk's prompt, with the weekday, so "Friday tak" becomes a real date:
 * "Tuesday 27 October 2026 (2026-10-27)".
 */
export function todayWords(now = Date.now()): string {
  const words = new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  })
    .format(new Date(now))
    .replace(/,/g, '');
  return `${words} (${indiaToday(now)})`;
}

/** "Friday, 23 October" for prompts and screens. */
export function dateWords(iso: string | null): string {
  if (!iso) return 'as soon as possible';
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}

export function quantityWords(quantity: number | null, unit: Unit | null): string {
  if (quantity == null) return 'some';
  return unit ? `${quantity} ${UNIT_WORDS[unit]}` : String(quantity);
}

export function toTerms(q: QuoteRow): QuoteTerms {
  return {
    supplierId: q.supplierId,
    price: q.price,
    unit: q.unit,
    packSize: q.packSize,
    packUnit: q.packUnit,
    deliveryCharge: q.deliveryCharge,
    minQuantity: q.minQuantity,
    deliveryDate: q.deliveryDate,
    createdAt: q.createdAt.getTime(),
  };
}

export function orderOf(r: RequestRow) {
  if (r.quantity == null || !r.unit || !r.deliverBy) return null;
  return { quantity: r.quantity, unit: r.unit, deliverBy: r.deliverBy };
}

/** What still stops an order from being called. */
export function missingFor(r: RequestRow, callableSuppliers: number): string[] {
  const missing: string[] = [];
  if (!r.item) missing.push('what to buy');
  if (r.quantity == null) missing.push('how much');
  if (!r.unit) missing.push('the unit (kilo, litre, piece…)');
  if (!r.deliverBy) missing.push('the delivery date');
  else if (isPastDate(r.deliverBy)) missing.push('a delivery date from today on');
  if (callableSuppliers === 0) missing.push('at least one supplier');
  return missing;
}

const ms = (d: Date | null) => (d ? d.getTime() : null);

export async function orderView(db: Db, requestId: string): Promise<OrderView | null> {
  const request = await db.select().from(requests).where(eq(requests.id, requestId)).get();
  if (!request) return null;

  const [supplierRows, callRows, quoteRows, eventRows] = await Promise.all([
    db
      .select()
      .from(suppliers)
      .where(eq(suppliers.requestId, requestId))
      .orderBy(asc(suppliers.createdAt))
      .all(),
    db
      .select()
      .from(calls)
      .where(eq(calls.requestId, requestId))
      .orderBy(asc(calls.createdAt))
      .all(),
    db
      .select()
      .from(quotes)
      .where(eq(quotes.requestId, requestId))
      .orderBy(asc(quotes.createdAt))
      .all(),
    db
      .select()
      .from(events)
      .where(eq(events.requestId, requestId))
      .orderBy(desc(events.createdAt))
      .limit(200)
      .all(),
  ]);

  const order = orderOf(request);
  let ranking: RankedQuote[] = [];
  let highestPerUnit: number | null = null;
  if (order) {
    // Rows are oldest first, so the last one per supplier is their newest quote.
    const latest = new Map<string, QuoteRow>();
    for (const q of quoteRows) latest.set(q.supplierId, q);
    const rank = (r: RankedQuote) => (r.perUnit === null ? 2 : r.reasons.length > 0 ? 1 : 0);
    ranking = [...latest.values()]
      .map((q) => {
        const landed = landedPrice(toTerms(q), order);
        return {
          entry: {
            quoteId: q.id,
            supplierId: q.supplierId,
            perUnit: landed.perUnit,
            reasons: landed.reasons,
          },
          delivery: q.deliveryDate ?? order.deliverBy,
          at: q.createdAt.getTime(),
        };
      })
      // The same order as bestOffer (engine.ts), so "Best" here is the offer Bhaav bargained
      // with: cheapest, then the earlier delivery, then whoever quoted that price first.
      .sort(
        (a, b) =>
          rank(a.entry) - rank(b.entry) ||
          (a.entry.perUnit ?? 0) - (b.entry.perUnit ?? 0) ||
          a.delivery.localeCompare(b.delivery) ||
          a.at - b.at,
      )
      .map((r) => r.entry);
    // Every quote ever heard counts here, including ones bargained down since.
    for (const q of quoteRows) {
      const perUnit = landedPrice(toTerms(q), order).perUnit;
      if (perUnit !== null && (highestPerUnit === null || perUnit > highestPerUnit))
        highestPerUnit = perUnit;
    }
  }
  const best = ranking[0];

  return {
    order: {
      id: request.id,
      buyerName: request.buyerName,
      item: request.item,
      quantity: request.quantity,
      unit: request.unit,
      quality: request.quality,
      deliverBy: request.deliverBy,
      area: request.area,
      status: request.status,
      approvedQuoteId: request.approvedQuoteId,
      isPractice: request.isPractice,
      createdAt: request.createdAt.getTime(),
    },
    suppliers: supplierRows.map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      language: s.language,
      consentNote: s.consentNote,
      doNotCall: s.doNotCall,
    })),
    calls: callRows.map((c) => ({
      id: c.id,
      supplierId: c.supplierId,
      round: c.round,
      channel: c.channel,
      status: c.status,
      bestOfferSaid: c.bestOfferSaid,
      recordingUrl: c.recordingUrl,
      transcript: c.transcript,
      createdAt: c.createdAt.getTime(),
      endedAt: ms(c.endedAt),
      attempt: c.attempt,
      retryable: c.retryable,
    })),
    quotes: quoteRows.map((q) => ({
      id: q.id,
      supplierId: q.supplierId,
      callId: q.callId,
      price: q.price,
      unit: q.unit,
      packSize: q.packSize,
      packUnit: q.packUnit,
      minQuantity: q.minQuantity,
      deliveryDate: q.deliveryDate,
      deliveryCharge: q.deliveryCharge,
      paymentTerms: q.paymentTerms,
      landedPricePerUnit: q.landedPricePerUnit,
      supplierWords: q.supplierWords,
      createdAt: q.createdAt.getTime(),
    })),
    events: eventRows.map((e) => ({
      id: e.id,
      callId: e.callId,
      type: e.type,
      detail: e.detail ?? null,
      createdAt: e.createdAt.getTime(),
    })),
    ranking,
    bestQuoteId: best && best.perUnit !== null && best.reasons.length === 0 ? best.quoteId : null,
    highestPerUnit,
    missing:
      request.status === 'draft'
        ? missingFor(request, supplierRows.filter((s) => !s.doNotCall).length)
        : [],
    // The routes fill these in from the dialler's settings (index.ts, viewOf).
    waitingFor: null,
    callHours: { from: 10, to: 19 },
  };
}
