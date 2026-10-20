// The WhatsApp-ready summary of an order's results: plain text the buyer can forward or keep.

import type { OrderView } from '@bhaav/shared';
import { choiceOf } from './choice';
import { dateLabel, quoteTerms, rupees, unitWord } from './format';

export function whatsappSummary(view: OrderView): string {
  const o = view.order;
  const unit = unitWord(o.unit);
  const name = (id: string) => view.suppliers.find((s) => s.id === id)?.name ?? 'Supplier';
  const choice = choiceOf(view);
  const lines = [
    `Bhaav quotes for ${o.quantity ?? ''} ${unit} ${o.item ?? ''}`.replace(/\s+/g, ' ').trim(),
    `Deliver by ${dateLabel(o.deliverBy)}${o.area ? `, ${o.area}` : ''}`,
    '',
  ];
  view.ranking.forEach((r, i) => {
    const price =
      r.perUnit != null ? `${rupees(r.perUnit)}/${unit} delivered` : 'price not comparable';
    const tags = [
      r.quoteId === view.bestQuoteId ? 'best' : '',
      r.supplierId === choice?.supplierId ? 'chosen' : '',
    ]
      .filter(Boolean)
      .join(', ');
    lines.push(`${i + 1}. ${name(r.supplierId)}: ${price}${tags ? ` (${tags})` : ''}`);
  });
  const best = view.ranking.find((r) => r.quoteId === view.bestQuoteId);
  if (
    best?.perUnit != null &&
    view.highestPerUnit != null &&
    o.quantity != null &&
    view.highestPerUnit > best.perUnit
  ) {
    lines.push(
      '',
      `Saved ${rupees((view.highestPerUnit - best.perUnit) * o.quantity)} against the costliest quote.`,
    );
  }
  if (choice?.changed) {
    lines.push(
      '',
      `${name(choice.supplierId)} changed their quote on the confirmation call: now ${quoteTerms(choice.changed)} (chosen at ${quoteTerms(choice.approved)}).`,
    );
  }
  lines.push('', 'Every price was read back to the supplier and recorded.');
  return lines.join('\n');
}

/** Opens WhatsApp with the text filled in; the buyer picks who to send it to. */
export const whatsappLink = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
