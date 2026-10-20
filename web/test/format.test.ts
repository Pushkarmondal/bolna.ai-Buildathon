import { describe, expect, it } from 'vitest';
import { dateLabel, phoneLabel, quoteTerms, rupees } from '../src/format';
import { quote } from './fixtures';

describe('rupees', () => {
  it('groups digits the Indian way', () => {
    expect(rupees(1700)).toBe('₹1,700');
    expect(rupees(225000)).toBe('₹2,25,000');
    expect(rupees(33.5)).toBe('₹33.5');
  });

  it('shows a dash when there is no number', () => {
    expect(rupees(null)).toBe('—');
    expect(rupees(undefined)).toBe('—');
  });
});

describe('dateLabel', () => {
  it('reads a date the same in every time zone', () => {
    expect(dateLabel('2026-10-24')).toBe('Sat, 24 Oct');
    expect(dateLabel(null)).toBe('—');
  });
});

describe('quoteTerms', () => {
  it('gives the price and unit alone when nothing else was quoted', () => {
    expect(quoteTerms(quote('q', 's', 'c', 34))).toBe('₹34 per kilo');
  });

  it('adds pack size, delivery charge, date and payment terms in that order', () => {
    const q = quote('q', 's', 'c', 2250, {
      unit: 'pack',
      packSize: 15,
      packUnit: 'litre',
      deliveryCharge: 100,
      deliveryDate: '2026-10-24',
      paymentTerms: 'cash on delivery',
    });
    expect(quoteTerms(q)).toBe(
      '₹2,250 per 15 litre pack, ₹100 delivery, by Sat, 24 Oct, cash on delivery',
    );
  });

  it('leaves out a delivery charge of zero', () => {
    expect(quoteTerms(quote('q', 's', 'c', 34, { deliveryCharge: 0 }))).toBe('₹34 per kilo');
  });
});

describe('phoneLabel', () => {
  it('spaces an Indian mobile number the way people say it', () => {
    expect(phoneLabel('+919800000003')).toBe('+91 98000 00003');
  });

  it('leaves other numbers as stored and names browser calls', () => {
    expect(phoneLabel('+14155550100')).toBe('+14155550100');
    expect(phoneLabel('web')).toBe('browser call');
  });
});
