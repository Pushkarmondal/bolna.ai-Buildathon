import type { PricePoint } from '@bhaav/shared';
import { describe, expect, it } from 'vitest';
import { scalePoints, trendSentence } from '../src/chart';

const day = 86_400_000;
const series = (...prices: number[]): PricePoint[] =>
  prices.map((perUnit, i) => ({
    requestId: `req_${i}`,
    date: 1_790_000_000_000 + i * day,
    perUnit,
    supplierName: 'Gupta Traders',
  }));

describe('scalePoints', () => {
  it('spaces orders evenly between the margins, whatever their dates', () => {
    // The last order came a minute after the one before it.
    const points = series(32, 35, 29, 33).map((p, i) =>
      i === 3 ? { ...p, date: p.date - day + 60_000 } : p,
    );
    const { x } = scalePoints(points, 400);
    const [a, b, c, d] = points.map((_, i) => x(i)) as [number, number, number, number];
    expect(a).toBe(48);
    expect(d).toBe(400 - 52);
    expect(b - a).toBeCloseTo(d - c);
  });

  it('draws higher prices nearer the top', () => {
    const { y } = scalePoints(series(32, 35), 400);
    expect(y(35)).toBeLessThan(y(32));
  });

  it('keeps every point inside the plot', () => {
    const points = series(32, 35, 29, 33);
    const { y, lo, hi } = scalePoints(points, 400);
    expect(lo).toBeLessThan(29);
    expect(hi).toBeGreaterThan(35);
    for (const p of points) {
      expect(y(p.perUnit)).toBeGreaterThan(0);
      expect(y(p.perUnit)).toBeLessThan(200);
    }
  });

  it('handles a flat series and a single point without dividing by zero', () => {
    const flat = scalePoints(series(34, 34, 34, 34), 400);
    expect(Number.isFinite(flat.y(34))).toBe(true);
    const one = scalePoints(series(34), 400);
    expect(one.x(0)).toBe(48 + (400 - 48 - 52) / 2);
  });
});

describe('trendSentence', () => {
  it('reads the change from the first order to the last', () => {
    expect(trendSentence(series(32, 35, 29, 33), 'kilo')).toBe(
      '4 orders: from ₹32 to ₹33 per kilo, up 3.1%.',
    );
    expect(trendSentence(series(40, 30), 'litre')).toBe(
      '2 orders: from ₹40 to ₹30 per litre, down 25.0%.',
    );
    expect(trendSentence(series(34, 34), 'kilo')).toBe(
      '2 orders: from ₹34 to ₹34 per kilo, unchanged.',
    );
  });

  it('describes one order or none plainly', () => {
    expect(trendSentence(series(34), 'kilo')).toBe('One order so far: ₹34 per kilo.');
    expect(trendSentence([], 'kilo')).toBe('No prices yet.');
  });
});
