// Types the web app and the Worker both speak.

export const REQUEST_STATUSES = ['draft', 'calling', 'bargaining', 'done', 'approved'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Bolna's execution statuses (GET /executions/{id}). */
export const CALL_STATUSES = [
  'scheduled',
  'queued',
  'rescheduled',
  'initiated',
  'ringing',
  'in-progress',
  'call-disconnected',
  'completed',
  'balance-low',
  'busy',
  'no-answer',
  'canceled',
  'failed',
  'stopped',
  'error',
] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

/** A call is over only at one of these; `call-disconnected` still waits for `completed`. */
export const FINAL_CALL_STATUSES: readonly CallStatus[] = [
  'completed',
  'balance-low',
  'busy',
  'no-answer',
  'canceled',
  'failed',
  'stopped',
  'error',
];

export const EVENT_TYPES = [
  'blocked',
  'tool_blocked',
  'tool_call',
  'model_switch',
  'upstream_down',
  'status',
  'error',
  'approved',
  'do_not_call',
  'practice_started',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Units a quote or an order can be in. A pack is priced per pack of packSize packUnit. */
export const UNITS = [
  'kg',
  'g',
  'quintal',
  'tonne',
  'litre',
  'ml',
  'piece',
  'dozen',
  'pack',
] as const;
export type Unit = (typeof UNITS)[number];

export const LANGUAGES = ['hi', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export interface Order {
  quantity: number;
  unit: Unit;
  /** ISO date, YYYY-MM-DD */
  deliverBy: string;
}

export interface QuoteTerms {
  supplierId: string;
  price: number;
  unit: Unit;
  packSize?: number | null;
  packUnit?: Unit | null;
  /** Rupees for the whole order, not per unit. */
  deliveryCharge?: number | null;
  minQuantity?: number | null;
  /** ISO date, YYYY-MM-DD */
  deliveryDate?: string | null;
  /** Epoch ms; later quotes from the same supplier replace earlier ones. */
  createdAt: number;
}

// ---- What GET /api/requests/:id returns -------------------------------------------------

export interface OrderDto {
  id: string;
  buyerName: string | null;
  item: string | null;
  quantity: number | null;
  unit: Unit | null;
  quality: string | null;
  deliverBy: string | null;
  area: string | null;
  status: RequestStatus;
  approvedQuoteId: string | null;
  isPractice: boolean;
  createdAt: number;
}

export interface SupplierDto {
  id: string;
  name: string;
  phone: string;
  language: string;
  consentNote: string | null;
  doNotCall: boolean;
}

export interface CallDto {
  id: string;
  supplierId: string;
  round: number;
  channel: 'phone' | 'web';
  status: CallStatus;
  bestOfferSaid: string | null;
  recordingUrl: string | null;
  transcript: string | null;
  createdAt: number;
  endedAt: number | null;
}

export interface QuoteDto {
  id: string;
  supplierId: string;
  callId: string;
  price: number;
  unit: Unit;
  packSize: number | null;
  packUnit: Unit | null;
  minQuantity: number | null;
  deliveryDate: string | null;
  deliveryCharge: number | null;
  paymentTerms: string | null;
  landedPricePerUnit: number | null;
  supplierWords: string;
  createdAt: number;
}

export interface EventDto {
  id: string;
  callId: string | null;
  type: EventType;
  detail: Record<string, unknown> | null;
  createdAt: number;
}

export interface RankedQuote {
  quoteId: string;
  supplierId: string;
  perUnit: number | null;
  /** Why it can't win: units don't compare, minimum quantity too high, or delivery too late. */
  reasons: Array<'unit' | 'min_quantity' | 'late'>;
}

export interface OrderView {
  order: OrderDto;
  suppliers: SupplierDto[];
  calls: CallDto[];
  quotes: QuoteDto[];
  events: EventDto[];
  /** Each supplier's newest quote, cheapest landed price first. */
  ranking: RankedQuote[];
  bestQuoteId: string | null;
  /** Landed price of the costliest comparable quote heard, to show what calling around saved. */
  highestPerUnit: number | null;
  /** What still stops calls from starting. Empty when ready. */
  missing: string[];
}

export interface Persona {
  id: string;
  supplierName: string;
  item: string;
  quantity: number;
  unit: Unit;
  /** What the judge starts at, in the persona's own words. */
  opening: string;
  /** The judge's private floor. */
  floor: string;
  /** The pretend competing offer Bhaav is allowed to use. */
  bestOffer: string;
  tip: string;
}

// ---- Test bench (bench/run.ts writes it, the /bench screen reads it) --------------------

export interface BenchTurn {
  role: 'bhaav' | 'supplier';
  text: string;
  /** Set on a Bhaav turn the lie-catcher replaced with its safe line. */
  blocked?: number[];
}

export interface BenchRun {
  id: string;
  persona: string;
  style: string;
  turns: BenchTurn[];
  /** Numbers Bhaav actually spoke that nothing backs. Must be empty. */
  unbacked: number[];
  /** Sentences the lie-catcher stopped before they were spoken. */
  blocked: number;
  /** Prices passed to save_quote, and whether each matches something the supplier said. */
  saved: Array<{ price: number; backed: boolean }>;
  /** Counter-offers Bhaav made (at most one is allowed). */
  counters: number;
  error?: string;
}

export interface BenchResults {
  generatedAt: string | null;
  models: string[];
  runs: BenchRun[];
}
