// Finds every number a sentence states, written in digits or in Hindi or English words.
// The lie-catcher checks each one against the numbers Bhaav is allowed to say, so this
// errs towards finding too many numbers rather than too few.

export interface FoundNumber {
  value: number;
  /** The digits or words as written. */
  text: string;
  /** True when a currency or "per unit" marker sits next to the number. */
  price: boolean;
}

/** Hindi (romanised and Devanagari) and English spellings for 0 to 99. */
const UNIT_SPELLINGS: Array<[number, string]> = [
  [0, 'zero shunya shoonya शून्य'],
  [1, 'one ek एक'],
  [2, 'two do दो'],
  [3, 'three teen तीन'],
  [4, 'four char chaar चार'],
  [5, 'five paanch panch paach पाँच पांच'],
  [6, 'six chhah chhe chah chhai छह छः छे'],
  [7, 'seven saat सात'],
  [8, 'eight aath आठ'],
  [9, 'nine nau नौ'],
  [10, 'ten das दस'],
  [11, 'eleven gyarah gyaarah gyaara ग्यारह'],
  [12, 'twelve barah baarah baara बारह'],
  [13, 'thirteen terah तेरह'],
  [14, 'fourteen chaudah chaudha चौदह'],
  [15, 'fifteen pandrah pandra पंद्रह पन्द्रह'],
  [16, 'sixteen solah sola सोलह'],
  [17, 'seventeen satrah satra सत्रह'],
  [18, 'eighteen atharah athara athaarah अठारह'],
  [19, 'nineteen unnis unnees उन्नीस'],
  [20, 'twenty bees bis बीस'],
  [21, 'ikkis ikkees इक्कीस'],
  [22, 'baais bais baees बाईस'],
  [23, 'teis teyis teees तेईस'],
  [24, 'chaubis chaubees चौबीस'],
  [25, 'pachchis pachis pachees pacchees pachchees पच्चीस'],
  [26, 'chhabbis chabbis chhabbees छब्बीस'],
  [27, 'sattais sattaees सत्ताईस'],
  [28, 'atthais athais atthaees अट्ठाईस'],
  [29, 'untis untees उनतीस'],
  [30, 'thirty tees tis तीस'],
  [31, 'iktis iktees ikattis इकतीस'],
  [32, 'battis battees batis बत्तीस'],
  [33, 'taintis taintees tetis tentis तैंतीस'],
  [34, 'chauntis chauntees chautis चौंतीस'],
  [35, 'paintis paintees pentis पैंतीस'],
  [36, 'chhattis chattis chhattees छत्तीस'],
  [37, 'saintis saintees sentis सैंतीस'],
  [38, 'adtis adtees artis artees अड़तीस'],
  [39, 'untalis untaalis untaalees उनतालीस'],
  [40, 'forty chalis chaalis chalees chaalees चालीस'],
  [41, 'iktalis iktaalis iktaalees इकतालीस'],
  [42, 'bayalis bayaalis bayalees beyalis बयालीस'],
  [43, 'taintalis taintaalis tentalis तैंतालीस'],
  [44, 'chavalis chavaalis chawalis chauvalis चवालीस चौवालीस'],
  [45, 'paintalis paintaalis pentalis पैंतालीस'],
  [46, 'chhiyalis chhiyaalis chiyalis छियालीस'],
  [47, 'saintalis saintaalis sentalis सैंतालीस'],
  [48, 'adtalis adtaalis artalis अड़तालीस'],
  [49, 'unchas unchaas उनचास'],
  [50, 'fifty pachas pachaas पचास'],
  [51, 'ikyavan ikyaavan ekyavan इक्यावन'],
  [52, 'bavan baavan बावन'],
  [53, 'tirepan tirpan तिरेपन तिरपन'],
  [54, 'chauvan chauwan चौवन'],
  [55, 'pachpan पचपन'],
  [56, 'chhappan chappan छप्पन'],
  [57, 'sattavan sattaavan सत्तावन'],
  [58, 'atthavan athavan atthaavan अट्ठावन'],
  [59, 'unsath उनसठ'],
  [60, 'sixty saath sath साठ'],
  [61, 'iksath इकसठ'],
  [62, 'basath baasath बासठ'],
  [63, 'tirsath tiresath तिरसठ'],
  [64, 'chaunsath chausath चौंसठ'],
  [65, 'painsath pensath पैंसठ'],
  [66, 'chhiyasath chhiyaasath छियासठ'],
  [67, 'sadsath sarsath सड़सठ'],
  [68, 'adsath arsath अड़सठ'],
  [69, 'unhattar उनहत्तर'],
  [70, 'seventy sattar सत्तर'],
  [71, 'ikhattar ikahattar इकहत्तर'],
  [72, 'bahattar बहत्तर'],
  [73, 'tihattar तिहत्तर'],
  [74, 'chauhattar चौहत्तर'],
  [75, 'pachhattar pachattar pachahattar पचहत्तर'],
  [76, 'chhihattar chihattar छिहत्तर'],
  [77, 'sathattar satattar सतहत्तर'],
  [78, 'athhattar athattar अठहत्तर'],
  [79, 'unyasi unasi unaasi उन्यासी उनासी'],
  [80, 'eighty assi asi अस्सी'],
  [81, 'ikyasi ikyaasi इक्यासी'],
  [82, 'bayasi bayaasi बयासी'],
  [83, 'tirasi tiraasi तिरासी'],
  [84, 'chaurasi chauraasi चौरासी'],
  [85, 'pachasi pachaasi पचासी'],
  [86, 'chhiyasi chhiyaasi छियासी'],
  [87, 'sattasi sattaasi सत्तासी'],
  [88, 'atthasi athasi atthaasi अट्ठासी'],
  [89, 'navasi navaasi नवासी'],
  [90, 'ninety nabbe नब्बे'],
  [91, 'ikyanve ikyaanve इक्यानवे'],
  [92, 'banve baanve बानवे'],
  [93, 'tiranve tiraanve तिरानवे'],
  [94, 'chauranve chauraanve चौरानवे'],
  [95, 'pachanve pachaanve पचानवे'],
  [96, 'chhiyanve chhiyaanve छियानवे'],
  [97, 'sattanve sattaanve सत्तानवे'],
  [98, 'atthanve athanve अट्ठानवे'],
  [99, 'ninyanve ninyaanve निन्यानवे'],
  // Whole fractions act like a unit: "dedh sau" is 150.
  [0.5, 'half aadha adha आधा'],
  [1.5, 'dedh derh डेढ़ डेढ'],
  [2.5, 'dhai dhaai adhai ढाई'],
];

const MULTIPLIER_SPELLINGS: Array<[number, string]> = [
  [100, 'hundred sau सौ'],
  [1_000, 'thousand hazaar hazar hajar हज़ार हजार'],
  [100_000, 'lakh lakhs laakh lac लाख'],
  [1_000_000, 'million'],
  [10_000_000, 'crore crores karod karor करोड़ करोड'],
];

/** Words that add to the number after them: "saade chaalis" is 40.5, "paune do sau" is 175. */
const PREFIX_SPELLINGS: Array<[number, string]> = [
  [0.5, 'saade sade saadhe sadhe साढ़े साढे'],
  [0.25, 'sava savaa सवा'],
  [-0.25, 'paune pone पौने'],
];

/** "saath" is 60 but also "with" ("aapke saath"); it counts only beside another number or a unit. */
const AMBIGUOUS = new Set(['saath', 'sath']);

const CURRENCY_WORDS = new Set(
  'rupaye rupaiye rupaya rupay rupees rupee rs inr रुपये रुपए रुपया per prati प्रति'
    .split(' ')
    .map((w) => w.normalize('NFC')),
);

const QUANTITY_WORDS = new Set(
  'kilo kilos kg kgs kilogram gram grams litre litres liter liters ltr quintal quintals ton tons tonne tonnes piece pieces dozen पीस किलो लीटर क्विंटल टन दर्जन'
    .split(' ')
    .map((w) => w.normalize('NFC')),
);

function spellingMap(entries: Array<[number, string]>): Map<string, number> {
  const map = new Map<string, number>();
  for (const [value, spellings] of entries) {
    for (const word of spellings.split(' ')) map.set(word.normalize('NFC'), value);
  }
  return map;
}

const UNITS = spellingMap(UNIT_SPELLINGS);
const MULTIPLIERS = spellingMap(MULTIPLIER_SPELLINGS);
const PREFIXES = spellingMap(PREFIX_SPELLINGS);

const round2 = (n: number) => Math.round(n * 100) / 100;

interface Token {
  text: string;
  start: number;
  end: number;
  /** Set for digit tokens; more than one value when commas separate a list ("30,32"). */
  values?: number[];
}

const TOKEN = /\d[\d,]*(?:\.\d+)?|[\p{L}\p{M}]+/gu;

function toAsciiDigits(text: string): string {
  return text.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966));
}

/** "1,600" and "1,00,000" are one number; "30,32" is two. */
function digitValues(raw: string): number[] {
  const t = raw.replace(/,+$/, '');
  if (!t.includes(',')) return [Number(t)];
  const western = /^\d{1,3}(,\d{3})+(\.\d+)?$/;
  const indian = /^\d{1,2}(,\d{2})*,\d{3}(\.\d+)?$/;
  if (western.test(t) || indian.test(t)) return [Number(t.replaceAll(',', ''))];
  return t
    .split(',')
    .filter(Boolean)
    .map((part) => Number(part));
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const raw = m[0];
    const start = m.index;
    const token: Token = { text: raw, start, end: start + raw.length };
    if (/^\d/.test(raw)) token.values = digitValues(raw);
    tokens.push(token);
  }
  return tokens;
}

const lower = (t: Token | undefined) => t?.text.toLowerCase() ?? '';

/** "saath kilo", "saath rupaye", "saath hazaar", "ek sau saath" are numbers; "ek saath", "ke saath" are not. */
function hasNumericNeighbour(tokens: Token[], i: number): boolean {
  const next = lower(tokens[i + 1]);
  return (
    MULTIPLIERS.has(next) ||
    CURRENCY_WORDS.has(next) ||
    QUANTITY_WORDS.has(next) ||
    MULTIPLIERS.has(lower(tokens[i - 1]))
  );
}

/** Whether a unit word may join the number built so far ("thirty two", "ek sau saath"). */
function canAdd(total: number, current: number, unit: number): boolean {
  if (current === 0) return total > 0;
  if (current % 100 === 0) return unit < 100;
  if (current < 100 && current % 10 === 0) return unit < 10;
  return false;
}

function isPriceContext(text: string, tokens: Token[], first: number, last: number): boolean {
  const firstToken = tokens[first];
  const lastToken = tokens[last];
  if (!firstToken || !lastToken) return false;
  const before = text.slice(Math.max(0, firstToken.start - 6), firstToken.start);
  const after = text.slice(lastToken.end, lastToken.end + 4);
  return (
    /(₹|\brs\.?|\binr)\s*$/i.test(before) ||
    /^\s*\/\s*(-|[\p{L}])/u.test(after) ||
    CURRENCY_WORDS.has(lower(tokens[last + 1]))
  );
}

/** Every number in the text, in order. */
export function findNumbers(input: string): FoundNumber[] {
  const text = toAsciiDigits(input.normalize('NFC'));
  const tokens = tokenize(text);
  const out: FoundNumber[] = [];

  let total = 0;
  let current = 0;
  let prefix = 0;
  let prefixAt = -1;
  let first = -1;
  let last = -1;

  const flush = () => {
    if (first >= 0) {
      const from = tokens[first];
      const to = tokens[last];
      if (from && to) {
        out.push({
          value: round2(total + current),
          text: text.slice(from.start, to.end),
          price: isPriceContext(text, tokens, first, last),
        });
      }
    }
    total = 0;
    current = 0;
    prefix = 0;
    prefixAt = -1;
    first = -1;
    last = -1;
  };
  const take = (i: number) => {
    if (first < 0) first = prefixAt >= 0 ? prefixAt : i;
    last = i;
    prefix = 0;
    prefixAt = -1;
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;

    if (token.values) {
      if (token.values.length > 1) {
        flush();
        const price = isPriceContext(text, tokens, i, i);
        for (const value of token.values)
          out.push({ value: round2(value), text: String(value), price });
        continue;
      }
      if (first >= 0) flush();
      current = (token.values[0] ?? 0) + prefix;
      take(i);
      continue;
    }

    const word = lower(token);

    const unit = UNITS.get(word);
    if (unit !== undefined && !(AMBIGUOUS.has(word) && !hasNumericNeighbour(tokens, i))) {
      if (first >= 0 && !canAdd(total, current, unit)) flush();
      current += unit + prefix;
      take(i);
      continue;
    }

    const multiplier = MULTIPLIERS.get(word);
    if (multiplier !== undefined) {
      const base = first < 0 ? 1 + prefix : current === 0 ? 1 : current;
      if (multiplier === 100) current = base * 100;
      else {
        total += base * multiplier;
        current = 0;
      }
      take(i);
      continue;
    }

    const add = PREFIXES.get(word);
    if (add !== undefined) {
      flush();
      prefix = add;
      prefixAt = i;
      continue;
    }

    // "two hundred and fifty"
    if (word === 'and' && first >= 0 && current >= 100 && current % 100 === 0) {
      const next = tokens[i + 1];
      if (next && UNITS.has(lower(next))) continue;
    }

    flush();
  }
  flush();
  return out;
}

export function numbersIn(text: string): number[] {
  return findNumbers(text).map((n) => n.value);
}

/** A set of allowed numbers, rounded the way findNumbers rounds. */
export function allowedSet(values: Iterable<number>): Set<number> {
  const set = new Set<number>();
  for (const v of values) if (Number.isFinite(v)) set.add(round2(v));
  return set;
}

/**
 * Numbers in a sentence that Bhaav may not say: not in `allowed`, and not a small count.
 * Counts from 0 to 10 pass ("do minute"), unless they sit next to a price marker ("₹8").
 */
export function unbackedNumbers(sentence: string, allowed: ReadonlySet<number>): FoundNumber[] {
  return findNumbers(sentence).filter((n) => {
    if (allowed.has(n.value)) return false;
    const smallCount = !n.price && n.value >= 0 && n.value <= 10;
    return !smallCount;
  });
}
