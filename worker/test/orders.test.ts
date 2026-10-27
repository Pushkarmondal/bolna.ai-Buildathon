import { describe, expect, it } from 'vitest';
import { normalizeUnit, todayWords } from '../src/orders';

describe('normalizeUnit', () => {
  it('reads the ways a unit gets written, in a tool call or on screen', () => {
    for (const [said, unit] of [
      ['kg', 'kg'],
      ['Kilo', 'kg'],
      ['किलो', 'kg'],
      ['per kg', 'kg'],
      ['Per Quintal', 'quintal'],
      ['/kg', 'kg'],
      ['1 kg', 'kg'],
      ['kg.', 'kg'],
      ['ek litre', 'litre'],
      ['प्रति किलो', 'kg'],
      ['tin', 'pack'],
    ] as const)
      expect(normalizeUnit(said), said).toBe(unit);
  });

  it('knows nothing it cannot read for sure', () => {
    for (const said of ['handful', 'per bori of 50', '15 litre tin', '', '   '])
      expect(normalizeUnit(said), said).toBeNull();
  });
});

describe('todayWords', () => {
  it("names today in India with its weekday, even when it's still yesterday in UTC", () => {
    // 20:00 UTC on Monday 26 October is 01:30 on Tuesday 27 October in India.
    expect(todayWords(Date.UTC(2026, 9, 26, 20, 0))).toBe('Tuesday 27 October 2026 (2026-10-27)');
  });
});
