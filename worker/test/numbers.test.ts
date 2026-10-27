import { describe, expect, it } from 'vitest';
import { allowedSet, findNumbers, numbersIn, parseAmount, unbackedNumbers } from '../src/numbers';

describe('findNumbers: digits', () => {
  it('reads a rupee price and marks it as a price', () => {
    expect(findNumbers('Mere paas ₹32 per kilo ka offer hai')).toEqual([
      { value: 32, text: '32', price: true, time: false },
    ]);
  });

  it('reads western and Indian digit grouping as one number', () => {
    expect(numbersIn('₹1,600 per quintal')).toEqual([1600]);
    expect(numbersIn('₹1,00,000 ka order')).toEqual([100000]);
    expect(numbersIn('12,50,000')).toEqual([1250000]);
  });

  it('splits a comma list that is not digit grouping', () => {
    expect(numbersIn('30,32 dono chalega')).toEqual([30, 32]);
  });

  it('keeps decimals and ignores a sentence-ending full stop', () => {
    expect(numbersIn('Rate ₹32.50 hai.')).toEqual([32.5]);
    expect(numbersIn('Rate 32.')).toEqual([32]);
  });

  it('treats the Indian /- notation and per-unit slashes as prices', () => {
    expect(findNumbers('32/- final')[0]?.price).toBe(true);
    expect(findNumbers('32/kg')[0]?.price).toBe(true);
    expect(findNumbers('Rs. 45')[0]?.price).toBe(true);
  });

  it('reads Devanagari digits', () => {
    expect(numbersIn('₹३२ प्रति किलो')).toEqual([32]);
  });

  it('joins digits with a multiplier word', () => {
    expect(numbersIn('2 lakh ka maal')).toEqual([200000]);
    expect(numbersIn('1.5 hazaar')).toEqual([1500]);
  });

  it('reads a time as two numbers', () => {
    expect(numbersIn('10:30 tak')).toEqual([10, 30]);
  });
});

describe('findNumbers: Hindi words', () => {
  it('reads romanised Hindi prices', () => {
    expect(findNumbers('battees rupaye kilo')).toEqual([
      { value: 32, text: 'battees', price: true, time: false },
    ]);
    expect(numbersIn('chhiyaalis rupaye')).toEqual([46]);
  });

  it('handles saade, sava, paune, dedh and dhai', () => {
    expect(numbersIn('saade chaalis')).toEqual([40.5]);
    expect(numbersIn('saade teen sau')).toEqual([350]);
    expect(numbersIn('sava sau')).toEqual([125]);
    expect(numbersIn('paune do sau')).toEqual([175]);
    expect(numbersIn('dedh sau')).toEqual([150]);
    expect(numbersIn('dhai hazaar')).toEqual([2500]);
  });

  it('builds large numbers from hazaar, lakh and sau', () => {
    expect(numbersIn('ek hazaar chhe sau')).toEqual([1600]);
    expect(numbersIn('solah sau')).toEqual([1600]);
    expect(numbersIn('do lakh pachaas hazaar')).toEqual([250000]);
    expect(numbersIn('ek sau saath')).toEqual([160]);
  });

  it('reads Devanagari words', () => {
    expect(numbersIn('बत्तीस रुपये किलो')).toEqual([32]);
    expect(numbersIn('डेढ़ सौ')).toEqual([150]);
    expect(numbersIn('साढ़े चालीस')).toEqual([40.5]);
  });

  it('keeps "do teen" as two numbers', () => {
    expect(numbersIn('do teen din lagenge')).toEqual([2, 3]);
  });

  it('reads saath as 60 only beside a unit, a price or a multiplier', () => {
    expect(numbersIn('aapke saath baat karke accha laga')).toEqual([]);
    expect(numbersIn('sab ek saath bhej dijiye')).toEqual([1]);
    expect(numbersIn('saath rupaye kilo')).toEqual([60]);
    expect(numbersIn('saath kilo')).toEqual([60]);
  });
});

describe('findNumbers: English words', () => {
  it('reads tens and units, spaced or hyphenated', () => {
    expect(numbersIn('thirty two rupees')).toEqual([32]);
    expect(numbersIn('thirty-two')).toEqual([32]);
  });

  it('reads "two hundred and fifty"', () => {
    expect(numbersIn('two hundred and fifty rupees')).toEqual([250]);
  });

  it('does not join two tens', () => {
    expect(numbersIn('thirty forty')).toEqual([30, 40]);
  });
});

describe('unbackedNumbers', () => {
  it('passes a price that is in the allowed set', () => {
    expect(unbackedNumbers('Mere paas ₹30 ka asli offer hai.', allowedSet([30]))).toEqual([]);
  });

  it('flags a price that is not allowed', () => {
    const bad = unbackedNumbers('Mere paas ₹27 ka offer hai.', allowedSet([30]));
    expect(bad.map((n) => n.value)).toEqual([27]);
  });

  it('flags a price written in words', () => {
    const bad = unbackedNumbers('Sattais rupaye mein de do.', allowedSet([30]));
    expect(bad.map((n) => n.value)).toEqual([27]);
  });

  it('lets small counts through, but not small prices', () => {
    expect(unbackedNumbers('Bas do minute lagenge.', allowedSet([]))).toEqual([]);
    expect(unbackedNumbers('₹8 per piece chalega?', allowedSet([])).map((n) => n.value)).toEqual([
      8,
    ]);
  });

  it('matches allowed values after rounding', () => {
    expect(unbackedNumbers('₹19.33 per kilo', allowedSet([19.333333]))).toEqual([]);
  });
});

describe('findNumbers: Kannada', () => {
  it('reads Kannada digits', () => {
    expect(numbersIn('₹೩೨ ಕೆಜಿಗೆ')).toEqual([32]);
  });

  it('reads joined Kannada numbers in script and romanised', () => {
    expect(findNumbers('ಮೂವತ್ತೆರಡು ರೂಪಾಯಿ')).toEqual([
      { value: 32, text: 'ಮೂವತ್ತೆರಡು', price: true, time: false },
    ]);
    expect(numbersIn('ಇಪ್ಪತ್ತಮೂರು')).toEqual([23]);
    expect(numbersIn('ತೊಂಬತ್ತೊಂಬತ್ತು')).toEqual([99]);
    expect(numbersIn('moovatteradu rupayi')).toEqual([32]);
    expect(numbersIn('ippattamooru')).toEqual([23]);
  });

  it('reads Kannada teens, spaced tens and multipliers', () => {
    expect(numbersIn('ಹದಿನೈದು')).toEqual([15]);
    expect(numbersIn('moovattu eradu')).toEqual([32]);
    expect(numbersIn('ಎರಡು ನೂರು')).toEqual([200]);
    expect(numbersIn('ಒಂದು ಸಾವಿರ ಆರು ನೂರು')).toEqual([1600]);
  });

  it('flags an unbacked Kannada price', () => {
    const bad = unbackedNumbers('ಬೇರೆ ಅಂಗಡಿ ಇಪ್ಪತ್ತೆಂಟು ರೂಪಾಯಿ ಹೇಳಿದೆ', allowedSet([31]));
    expect(bad.map((n) => n.value)).toEqual([28]);
  });
});

describe('spelling variants', () => {
  it('reads romanised Hindi with either -is or -ees', () => {
    expect(numbersIn('chautees rupaye kilo')).toEqual([34]);
    expect(numbersIn('chautis rupaye kilo')).toEqual([34]);
    expect(numbersIn('battis ya taintees')).toEqual([32, 33]);
  });

  it('reads Devanagari written without its nasal or nukta mark', () => {
    expect(numbersIn('चौतीस रुपये')).toEqual([34]);
    expect(numbersIn('पैतीस रुपये')).toEqual([35]);
    expect(numbersIn('अडतीस रुपये')).toEqual([38]);
    expect(numbersIn('पाच किलो')).toEqual([5]);
  });

  it('still finds no number in everyday words', () => {
    expect(numbersIn('Haan ji, boliye, rate kya hai?')).toEqual([]);
    expect(numbersIn('ek tin ka rate')).toEqual([1]);
  });
});

describe('parseAmount', () => {
  it('reads every way a tool argument carries a rupee amount', () => {
    expect(parseAmount(34)).toBe(34);
    expect(parseAmount('34.000000')).toBe(34);
    expect(parseAmount('₹2,250')).toBe(2250);
    expect(parseAmount('Rs. 2,250')).toBe(2250);
    expect(parseAmount('34/-')).toBe(34);
    expect(parseAmount('-5')).toBe(-5);
  });

  it('refuses what is not an amount', () => {
    expect(parseAmount('thirty')).toBeUndefined();
    expect(parseAmount('%(price)f')).toBeUndefined();
    expect(parseAmount('')).toBeUndefined();
    expect(parseAmount(null)).toBeUndefined();
    expect(parseAmount(Number.NaN)).toBeUndefined();
  });
});

describe('times are not prices', () => {
  it('lets Bhaav say when it will call back, but never a price dressed as a time', () => {
    const allowed = allowedSet([]);
    expect(unbackedNumbers('ठीक है जी, 45 मिनट बाद call करता हूँ।', allowed)).toEqual([]);
    expect(unbackedNumbers('Theek hai ji, 45 minute baad call karta hoon.', allowed)).toEqual([]);
    expect(unbackedNumbers('Main 4 baje call karunga.', allowed)).toEqual([]);
    expect(unbackedNumbers('Ek ghante baad baat karte hain.', allowed)).toEqual([]);
    expect(unbackedNumbers('₹45 minute mein bata dunga.', allowed).map((n) => n.value)).toEqual([
      45,
    ]);
    expect(unbackedNumbers('45 rupaye kilo.', allowed).map((n) => n.value)).toEqual([45]);
  });
});
