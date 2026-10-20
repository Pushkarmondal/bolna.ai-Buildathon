import type { Order, QuoteTerms } from '@bhaav/shared';
import { describe, expect, it } from 'vitest';
import {
  bestOffer,
  describeOffer,
  formatRupees,
  landedPrice,
  latestPerSupplier,
  round2List,
  toBase,
} from '../src/engine';

const onions: Order = { quantity: 50, unit: 'kg', deliverBy: '2026-10-23' };

const quote = (q: Partial<QuoteTerms> & Pick<QuoteTerms, 'supplierId' | 'price'>): QuoteTerms => ({
  unit: 'kg',
  createdAt: 1,
  ...q,
});

describe('toBase', () => {
  it('sizes a 15-litre tin', () => {
    expect(toBase('pack', 15, 'litre')).toEqual({ base: 'litre', factor: 15 });
  });

  it('refuses a pack with no size', () => {
    expect(toBase('pack')).toBeNull();
    expect(toBase('pack', 15, 'pack')).toBeNull();
  });
});

describe('landedPrice', () => {
  it('converts a quintal price and spreads the delivery charge', () => {
    const l = landedPrice(
      quote({ supplierId: 'a', price: 1600, unit: 'quintal', deliveryCharge: 150 }),
      onions,
    );
    expect(l.perUnit).toBe(19); // 16 a kilo + 150 / 50 kilo
    expect(l.reasons).toEqual([]);
  });

  it('prices oil sold in 15-litre tins per litre', () => {
    const oil: Order = { quantity: 30, unit: 'litre', deliverBy: '2026-10-23' };
    const l = landedPrice(
      quote({ supplierId: 'a', price: 2250, unit: 'pack', packSize: 15, packUnit: 'litre' }),
      oil,
    );
    expect(l.perUnit).toBe(150);
  });

  it('marks kilos against litres as not comparable', () => {
    const l = landedPrice(quote({ supplierId: 'a', price: 100, unit: 'litre' }), onions);
    expect(l).toMatchObject({ perUnit: null, reasons: ['unit'] });
  });

  it('flags a minimum quantity above the order', () => {
    const l = landedPrice(
      quote({ supplierId: 'a', price: 30, minQuantity: 1, unit: 'quintal' }),
      onions,
    );
    expect(l.reasons).toContain('min_quantity');
  });

  it('flags delivery after the deadline', () => {
    const l = landedPrice(
      quote({ supplierId: 'a', price: 30, deliveryDate: '2026-10-24' }),
      onions,
    );
    expect(l.reasons).toEqual(['late']);
  });
});

describe('latestPerSupplier', () => {
  it('keeps each supplier newest quote', () => {
    const quotes = [
      quote({ supplierId: 'a', price: 34, createdAt: 1 }),
      quote({ supplierId: 'a', price: 31, createdAt: 5 }),
      quote({ supplierId: 'b', price: 32, createdAt: 2 }),
    ];
    expect(
      latestPerSupplier(quotes)
        .map((q) => q.price)
        .sort(),
    ).toEqual([31, 32]);
  });
});

describe('bestOffer', () => {
  it('picks the lowest eligible landed price', () => {
    const quotes = [
      quote({ supplierId: 'a', price: 34 }),
      quote({ supplierId: 'b', price: 30, deliveryDate: '2026-10-25' }), // cheapest, but late
      quote({ supplierId: 'c', price: 32 }),
    ];
    expect(bestOffer(quotes, onions)?.quote.supplierId).toBe('c');
  });

  it('breaks a tie on the earlier delivery, then the earlier quote', () => {
    const quotes = [
      quote({ supplierId: 'a', price: 32, deliveryDate: '2026-10-22', createdAt: 3 }),
      quote({ supplierId: 'b', price: 32, deliveryDate: '2026-10-21', createdAt: 4 }),
      quote({ supplierId: 'c', price: 32, deliveryDate: '2026-10-21', createdAt: 2 }),
    ];
    expect(bestOffer(quotes, onions)?.quote.supplierId).toBe('c');
  });

  it('returns null when nothing fits', () => {
    expect(bestOffer([quote({ supplierId: 'a', price: 30, unit: 'litre' })], onions)).toBeNull();
  });
});

describe('round2List', () => {
  const quotes = [
    quote({ supplierId: 'a', price: 34 }),
    quote({ supplierId: 'b', price: 32 }),
    quote({ supplierId: 'c', price: 35 }),
    quote({ supplierId: 'd', price: 36 }),
    quote({ supplierId: 'e', price: 40 }),
  ];
  const suppliers = [
    { id: 'a', doNotCall: false, round2Calls: 0 },
    { id: 'b', doNotCall: false, round2Calls: 0 },
    { id: 'c', doNotCall: false, round2Calls: 0 },
    { id: 'd', doNotCall: true, round2Calls: 0 },
    { id: 'e', doNotCall: false, round2Calls: 1 },
  ];

  it('calls back costlier suppliers, cheapest first, skipping do-not-call and already asked', () => {
    expect(round2List(quotes, onions, suppliers)).toEqual(['a', 'c']);
  });

  it('is empty when there is no best offer', () => {
    expect(round2List([], onions, suppliers)).toEqual([]);
  });
});

describe('describeOffer', () => {
  it('states the landed price per order unit', () => {
    const best = landedPrice(
      quote({ supplierId: 'a', price: 1600, unit: 'quintal', deliveryCharge: 150 }),
      onions,
    );
    expect(describeOffer(best, onions)).toBe('₹19 per kilo including delivery');
  });

  it('never claims free delivery when no charge was quoted', () => {
    const best = landedPrice(quote({ supplierId: 'a', price: 30 }), onions);
    expect(describeOffer(best, onions)).toBe('₹30 per kilo');
  });

  it('formats rupees in Indian grouping', () => {
    expect(formatRupees(100000)).toBe('₹1,00,000');
    expect(formatRupees(19.333)).toBe('₹19.33');
  });
});
