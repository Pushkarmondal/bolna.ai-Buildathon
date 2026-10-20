// The rule engine: plain code that decides which quote is best and who gets a counter-offer.
// The AI never chooses a number; it only says the ones this file produces.

import type { Order, QuoteTerms, Unit } from '@bhaav/shared';

type Base = 'kg' | 'litre' | 'piece';

const UNIT_BASE: Record<Exclude<Unit, 'pack'>, { base: Base; factor: number }> = {
  kg: { base: 'kg', factor: 1 },
  g: { base: 'kg', factor: 0.001 },
  quintal: { base: 'kg', factor: 100 },
  tonne: { base: 'kg', factor: 1000 },
  litre: { base: 'litre', factor: 1 },
  ml: { base: 'litre', factor: 0.001 },
  piece: { base: 'piece', factor: 1 },
  dozen: { base: 'piece', factor: 12 },
};

export const UNIT_WORDS: Record<Unit, string> = {
  kg: 'kilo',
  g: 'gram',
  quintal: 'quintal',
  tonne: 'tonne',
  litre: 'litre',
  ml: 'ml',
  piece: 'piece',
  dozen: 'dozen',
  pack: 'pack',
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** How many base units one `unit` holds; null for a pack with no size. */
export function toBase(
  unit: Unit,
  packSize?: number | null,
  packUnit?: Unit | null,
): { base: Base; factor: number } | null {
  if (unit !== 'pack') return UNIT_BASE[unit];
  if (!packSize || packSize <= 0 || !packUnit || packUnit === 'pack') return null;
  const inner = UNIT_BASE[packUnit];
  return { base: inner.base, factor: inner.factor * packSize };
}

export type Ineligible = 'unit' | 'min_quantity' | 'late';

export interface Landed {
  quote: QuoteTerms;
  /** Rupees per order unit, delivery included; null when the units can't be compared. */
  perUnit: number | null;
  /** Why this quote can't be the best offer; empty when it can. */
  reasons: Ineligible[];
}

/** A quote turned into rupees per order unit, delivery included, with any reason it doesn't fit the order. */
export function landedPrice(quote: QuoteTerms, order: Order): Landed {
  const q = toBase(quote.unit, quote.packSize, quote.packUnit);
  const o = toBase(order.unit);
  if (!q || !o || q.base !== o.base || order.quantity <= 0) {
    return { quote, perUnit: null, reasons: ['unit'] };
  }

  const pricePerOrderUnit = (quote.price / q.factor) * o.factor;
  const deliveryPerOrderUnit = (quote.deliveryCharge ?? 0) / order.quantity;
  const reasons: Ineligible[] = [];

  if (quote.minQuantity && order.quantity * o.factor < quote.minQuantity * q.factor) {
    reasons.push('min_quantity');
  }
  if (quote.deliveryDate && quote.deliveryDate > order.deliverBy) reasons.push('late');

  return { quote, perUnit: round2(pricePerOrderUnit + deliveryPerOrderUnit), reasons };
}

/** The quote book is append-only, so a supplier's newest quote replaces their earlier ones. */
export function latestPerSupplier(quotes: readonly QuoteTerms[]): QuoteTerms[] {
  const latest = new Map<string, QuoteTerms>();
  for (const q of quotes) {
    const seen = latest.get(q.supplierId);
    if (!seen || q.createdAt > seen.createdAt) latest.set(q.supplierId, q);
  }
  return [...latest.values()];
}

/** Lowest landed price that fits the order; ties go to the earlier delivery, then the earlier quote. */
export function bestOffer(quotes: readonly QuoteTerms[], order: Order): Landed | null {
  const candidates = latestPerSupplier(quotes)
    .map((q) => landedPrice(q, order))
    .filter((l): l is Landed & { perUnit: number } => l.perUnit !== null && l.reasons.length === 0);

  candidates.sort(
    (a, b) =>
      a.perUnit - b.perUnit ||
      (a.quote.deliveryDate ?? order.deliverBy).localeCompare(
        b.quote.deliveryDate ?? order.deliverBy,
      ) ||
      a.quote.createdAt - b.quote.createdAt,
  );
  return candidates[0] ?? null;
}

export interface SupplierState {
  id: string;
  doNotCall: boolean;
  /** Round-2 calls already placed to this supplier. */
  round2Calls: number;
}

/** Suppliers to call back with the best offer: costlier, comparable, callable, not yet asked. Cheapest first. */
export function round2List(
  quotes: readonly QuoteTerms[],
  order: Order,
  suppliers: readonly SupplierState[],
): string[] {
  const best = bestOffer(quotes, order);
  if (!best || best.perUnit === null) return [];
  const bestPrice = best.perUnit;
  const byId = new Map(suppliers.map((s) => [s.id, s]));

  return latestPerSupplier(quotes)
    .map((q) => landedPrice(q, order))
    .filter((l): l is Landed & { perUnit: number } => {
      const s = byId.get(l.quote.supplierId);
      return (
        l.quote.supplierId !== best.quote.supplierId &&
        s !== undefined &&
        !s.doNotCall &&
        s.round2Calls === 0 &&
        l.perUnit !== null &&
        l.perUnit > bestPrice
      );
    })
    .sort((a, b) => a.perUnit - b.perUnit)
    .map((l) => l.quote.supplierId);
}

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/** Rupees in Indian grouping with at most two decimals: 1600 becomes "1,600". */
export function formatRupees(n: number): string {
  return `₹${inr.format(n)}`;
}

/** A quote in the supplier's own terms: "₹2,250 per 15 litre pack, ₹100 delivery". */
export function describeQuote(quote: QuoteTerms): string {
  const per =
    quote.unit === 'pack' && quote.packSize && quote.packUnit
      ? `${quote.packSize} ${UNIT_WORDS[quote.packUnit]} pack`
      : UNIT_WORDS[quote.unit];
  const delivery = quote.deliveryCharge ? `, ${formatRupees(quote.deliveryCharge)} delivery` : '';
  return `${formatRupees(quote.price)} per ${per}${delivery}`;
}

/** The counter-offer sentence fragment the Caller is given as `best_offer`. */
export function describeOffer(best: Landed, order: Order): string {
  if (best.perUnit === null) throw new Error('describeOffer needs a comparable quote');
  // Say "including delivery" only when a charge was quoted; never claim delivery is free.
  const delivery = best.quote.deliveryCharge ? ' including delivery' : '';
  return `${formatRupees(best.perUnit)} per ${UNIT_WORDS[order.unit]}${delivery}`;
}
