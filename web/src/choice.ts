// What became of the buyer's choice. The confirmation call (round 3) can end with the supplier
// changing their quote; the Caller then records the new terms, and the buyer has to hear about it.

import type { CallDto, OrderView, QuoteDto } from '@bhaav/shared';

export interface Choice {
  supplierId: string;
  approved: QuoteDto;
  confirmCall: CallDto | undefined;
  /** A quote from the confirmation call whose terms differ from the approved one. */
  changed: QuoteDto | null;
}

const sameTerms = (a: QuoteDto, b: QuoteDto) =>
  a.landedPricePerUnit === b.landedPricePerUnit &&
  a.price === b.price &&
  a.unit === b.unit &&
  (a.packSize ?? null) === (b.packSize ?? null) &&
  (a.deliveryCharge ?? 0) === (b.deliveryCharge ?? 0) &&
  (a.deliveryDate ?? null) === (b.deliveryDate ?? null);

export function choiceOf(view: OrderView): Choice | null {
  const approved = view.quotes.find((q) => q.id === view.order.approvedQuoteId);
  if (!approved) return null;
  const confirmCall = view.calls.find((c) => c.round === 3 && c.supplierId === approved.supplierId);
  const fromCall = confirmCall
    ? view.quotes
        .filter((q) => q.callId === confirmCall.id)
        .sort((a, b) => a.createdAt - b.createdAt)
    : [];
  const last = fromCall.at(-1);
  return {
    supplierId: approved.supplierId,
    approved,
    confirmCall,
    changed: last && !sameTerms(last, approved) ? last : null,
  };
}
