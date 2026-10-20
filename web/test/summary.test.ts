import { describe, expect, it } from 'vitest';
import { whatsappLink, whatsappSummary } from '../src/summary';
import { approvedOrder, call, finishedOrder, quote } from './fixtures';

describe('whatsappSummary', () => {
  it('lists every supplier cheapest first with the saving and the honesty line', () => {
    expect(whatsappSummary(finishedOrder())).toBe(
      [
        'Bhaav quotes for 50 kilo red onions',
        'Deliver by Sat, 24 Oct, Indiranagar',
        '',
        '1. Mehta & Sons: ₹34/kilo delivered (best)',
        '2. Gupta Traders: ₹34/kilo delivered',
        '3. Lakshmi Wholesale: ₹35/kilo delivered',
        '',
        'Saved ₹100 against the costliest quote.',
        '',
        'Every price was read back to the supplier and recorded.',
      ].join('\n'),
    );
  });

  it('marks the chosen supplier', () => {
    expect(whatsappSummary(approvedOrder())).toContain(
      '1. Mehta & Sons: ₹34/kilo delivered (best, chosen)',
    );
  });

  it('keeps the chosen mark and says so when the supplier changed their quote on the confirmation call', () => {
    const view = approvedOrder();
    view.calls.push(call('call_m3', 'sup_m', 3));
    view.quotes.push(quote('q_m3', 'sup_m', 'call_m3', 36));
    view.ranking = [
      { quoteId: 'q_g1', supplierId: 'sup_g', perUnit: 34, reasons: [] },
      { quoteId: 'q_l1', supplierId: 'sup_l', perUnit: 35, reasons: [] },
      { quoteId: 'q_m3', supplierId: 'sup_m', perUnit: 36, reasons: [] },
    ];
    view.bestQuoteId = 'q_g1';
    const text = whatsappSummary(view);
    expect(text).toContain('3. Mehta & Sons: ₹36/kilo delivered (chosen)');
    expect(text).toContain(
      'Mehta & Sons changed their quote on the confirmation call: now ₹36 per kilo (chosen at ₹34 per kilo).',
    );
  });

  it('says a price cannot be compared instead of inventing one', () => {
    const view = finishedOrder();
    view.ranking.push({ quoteId: 'q_x', supplierId: 'sup_x', perUnit: null, reasons: ['unit'] });
    expect(whatsappSummary(view)).toContain('4. Supplier: price not comparable');
  });

  it('claims no saving when every quote was the same', () => {
    const view = finishedOrder();
    view.highestPerUnit = 34;
    expect(whatsappSummary(view)).not.toContain('Saved');
  });
});

describe('whatsappLink', () => {
  it('encodes the text so line breaks and ampersands survive', () => {
    expect(whatsappLink('Mehta & Sons\n₹34')).toBe(
      'https://wa.me/?text=Mehta%20%26%20Sons%0A%E2%82%B934',
    );
  });
});
