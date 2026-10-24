// The WhatsApp-ready summary of an order's results: plain text the buyer can forward or keep.

import type { OrderView } from '@bhaav/shared';
import { choiceOf } from './choice';
import { dateLabel, quoteTerms, rupees, unitWord } from './format';

/**
 * What calling around saved, per order unit and in total. Needs two or more quotes: one quote has
 * nothing to be cheaper than, so it says nothing rather than "saved ₹0".
 */
export function savingOf(
  view: OrderView,
): { perUnit: number; total: number | null; pct: number } | null {
  const best = view.ranking.find((r) => r.quoteId === view.bestQuoteId);
  const heard = view.quotes.filter((q) => q.landedPricePerUnit != null).length;
  if (heard < 2 || best?.perUnit == null || view.highestPerUnit == null) return null;
  const perUnit = Math.max(0, view.highestPerUnit - best.perUnit);
  return {
    perUnit,
    total: view.order.quantity == null ? null : perUnit * view.order.quantity,
    pct: view.highestPerUnit > 0 ? (perUnit / view.highestPerUnit) * 100 : 0,
  };
}

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
  const saving = savingOf(view);
  if (saving?.total) {
    lines.push('', `Saved ${rupees(saving.total)} against the costliest quote.`);
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
