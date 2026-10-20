import { describe, expect, it } from 'vitest';
import { choiceOf } from '../src/choice';
import { approvedOrder, call, finishedOrder, quote } from './fixtures';

describe('choiceOf', () => {
  it('is empty until the buyer approves a quote', () => {
    expect(choiceOf(finishedOrder())).toBeNull();
  });

  it('names the supplier and the approved quote, with no confirmation call yet', () => {
    const choice = choiceOf(approvedOrder());
    expect(choice?.supplierId).toBe('sup_m');
    expect(choice?.approved.id).toBe('q_m2');
    expect(choice?.confirmCall).toBeUndefined();
    expect(choice?.changed).toBeNull();
  });

  it('reports nothing changed when the confirmation call saved no quote', () => {
    const view = approvedOrder();
    view.calls.push(call('call_m3', 'sup_m', 3));
    const choice = choiceOf(view);
    expect(choice?.confirmCall?.id).toBe('call_m3');
    expect(choice?.changed).toBeNull();
  });

  it('reports nothing changed when the supplier repeated the same terms', () => {
    const view = approvedOrder();
    view.calls.push(call('call_m3', 'sup_m', 3));
    view.quotes.push(quote('q_m3', 'sup_m', 'call_m3', 34, { deliveryCharge: 0 }));
    expect(choiceOf(view)?.changed).toBeNull();
  });

  it('returns the new quote when the supplier changed it on the confirmation call', () => {
    const view = approvedOrder();
    view.calls.push(call('call_m3', 'sup_m', 3));
    view.quotes.push(quote('q_m3', 'sup_m', 'call_m3', 36));
    view.ranking = [
      { quoteId: 'q_g1', supplierId: 'sup_g', perUnit: 34, reasons: [] },
      { quoteId: 'q_l1', supplierId: 'sup_l', perUnit: 35, reasons: [] },
      { quoteId: 'q_m3', supplierId: 'sup_m', perUnit: 36, reasons: [] },
    ];
    const choice = choiceOf(view);
    expect(choice?.changed?.id).toBe('q_m3');
    expect(choice?.supplierId).toBe('sup_m');
  });

  it('counts a new delivery date as a change', () => {
    const view = approvedOrder();
    view.calls.push(call('call_m3', 'sup_m', 3));
    view.quotes.push(quote('q_m3', 'sup_m', 'call_m3', 34, { deliveryDate: '2026-10-28' }));
    expect(choiceOf(view)?.changed?.id).toBe('q_m3');
  });

  it("ignores another supplier's calls", () => {
    const view = approvedOrder();
    view.calls.push(call('call_g3', 'sup_g', 3));
    view.quotes.push(quote('q_g3', 'sup_g', 'call_g3', 30));
    const choice = choiceOf(view);
    expect(choice?.confirmCall).toBeUndefined();
    expect(choice?.changed).toBeNull();
  });
});
