// A finished order for 50 kilo red onions with three suppliers, built the way the Worker returns it.

import type { CallDto, OrderView, QuoteDto } from '@bhaav/shared';

let clock = 1_790_000_000_000;
const at = () => (clock += 60_000);

export function call(
  id: string,
  supplierId: string,
  round: number,
  status: CallDto['status'] = 'completed',
): CallDto {
  return {
    id,
    supplierId,
    round,
    channel: 'phone',
    status,
    bestOfferSaid: null,
    recordingUrl: null,
    transcript: null,
    createdAt: at(),
    endedAt: null,
  };
}

export function quote(
  id: string,
  supplierId: string,
  callId: string,
  price: number,
  extra: Partial<QuoteDto> = {},
): QuoteDto {
  return {
    id,
    supplierId,
    callId,
    price,
    unit: 'kg',
    packSize: null,
    packUnit: null,
    minQuantity: null,
    deliveryDate: null,
    deliveryCharge: null,
    paymentTerms: null,
    landedPricePerUnit: price,
    supplierWords: `${price} rupaye kilo`,
    createdAt: at(),
    ...extra,
  };
}

/** Mehta quoted ₹36 then matched ₹34 in round 2; Gupta ₹34; Lakshmi ₹35. */
export function finishedOrder(): OrderView {
  return {
    order: {
      id: 'req_1',
      buyerName: 'Sharma Dhaba',
      item: 'red onions',
      quantity: 50,
      unit: 'kg',
      quality: null,
      deliverBy: '2026-10-24',
      area: 'Indiranagar',
      status: 'done',
      approvedQuoteId: null,
      isPractice: false,
      createdAt: at(),
    },
    suppliers: [
      {
        id: 'sup_m',
        name: 'Mehta & Sons',
        phone: '+919800000003',
        language: 'hi',
        consentNote: 'yes',
        doNotCall: false,
      },
      {
        id: 'sup_g',
        name: 'Gupta Traders',
        phone: '+919800000001',
        language: 'hi',
        consentNote: 'yes',
        doNotCall: false,
      },
      {
        id: 'sup_l',
        name: 'Lakshmi Wholesale',
        phone: '+919800000002',
        language: 'kn',
        consentNote: 'yes',
        doNotCall: false,
      },
    ],
    calls: [
      call('call_m1', 'sup_m', 1),
      call('call_g1', 'sup_g', 1),
      call('call_l1', 'sup_l', 1),
      call('call_m2', 'sup_m', 2),
    ],
    quotes: [
      quote('q_m1', 'sup_m', 'call_m1', 36),
      quote('q_g1', 'sup_g', 'call_g1', 34),
      quote('q_l1', 'sup_l', 'call_l1', 35),
      quote('q_m2', 'sup_m', 'call_m2', 34, { supplierWords: 'theek hai, 34 kar denge' }),
    ],
    events: [],
    ranking: [
      { quoteId: 'q_m2', supplierId: 'sup_m', perUnit: 34, reasons: [] },
      { quoteId: 'q_g1', supplierId: 'sup_g', perUnit: 34, reasons: [] },
      { quoteId: 'q_l1', supplierId: 'sup_l', perUnit: 35, reasons: [] },
    ],
    bestQuoteId: 'q_m2',
    highestPerUnit: 36,
    missing: [],
    history: [],
  };
}

/** The buyer approved Mehta's ₹34. */
export function approvedOrder(): OrderView {
  const view = finishedOrder();
  view.order.status = 'approved';
  view.order.approvedQuoteId = 'q_m2';
  return view;
}
