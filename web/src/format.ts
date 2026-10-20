import type { CallStatus, QuoteDto, Unit } from '@bhaav/shared';

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

export const rupees = (n: number | null | undefined) => (n == null ? '—' : `₹${inr.format(n)}`);

const UNIT_WORDS: Record<Unit, string> = {
  kg: 'kilo',
  g: 'gram',
  quintal: 'quintal',
  tonne: 'tonne',
  litre: 'litre',
  ml: 'ml',
  piece: 'piece',
  dozen: 'dozen',
  pack: 'pack',
};

export const unitWord = (unit: Unit | null | undefined) => (unit ? UNIT_WORDS[unit] : '');

/** The units a buyer picks from, in the order a kitchen uses them. */
export const ORDER_UNITS: Unit[] = [
  'kg',
  'litre',
  'piece',
  'dozen',
  'quintal',
  'pack',
  'g',
  'ml',
  'tonne',
];

export function dateLabel(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}

export function timeLabel(ms: number): string {
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(
    new Date(ms),
  );
}

const CALL_LABELS: Partial<Record<CallStatus, string>> = {
  scheduled: 'Waiting',
  queued: 'Dialling',
  rescheduled: 'Waiting',
  initiated: 'Dialling',
  ringing: 'Ringing',
  'in-progress': 'Talking',
  'call-disconnected': 'Wrapping up',
  completed: 'Done',
  busy: 'Busy',
  'no-answer': 'No answer',
  failed: 'Could not call',
  canceled: 'Cancelled',
  stopped: 'Stopped',
  error: 'Error',
  'balance-low': 'Out of credit',
};

export const callLabel = (status: CallStatus) => CALL_LABELS[status] ?? status;

const LIVE_STATUSES: CallStatus[] = [
  'scheduled',
  'queued',
  'rescheduled',
  'initiated',
  'ringing',
  'in-progress',
  'call-disconnected',
];
export const isLive = (status: CallStatus) => LIVE_STATUSES.includes(status);

/** A quote's own terms in one line, e.g. "₹2,250 per 15 litre pack, ₹100 delivery, by Fri, 24 Oct". */
export function quoteTerms(
  q: Pick<
    QuoteDto,
    'price' | 'unit' | 'packSize' | 'packUnit' | 'deliveryCharge' | 'deliveryDate' | 'paymentTerms'
  >,
): string {
  const per = q.packSize ? `${q.packSize} ${unitWord(q.packUnit)} pack` : unitWord(q.unit);
  return [
    `${rupees(q.price)} per ${per}`,
    q.deliveryCharge ? `${rupees(q.deliveryCharge)} delivery` : '',
    q.deliveryDate ? `by ${dateLabel(q.deliveryDate)}` : '',
    q.paymentTerms ?? '',
  ]
    .filter(Boolean)
    .join(', ');
}

/** "+919876543210" reads as "+91 98765 43210"; anything else is shown as stored. */
export function phoneLabel(phone: string): string {
  if (phone === 'web') return 'browser call';
  const m = phone.match(/^\+91(\d{5})(\d{5})$/);
  return m ? `+91 ${m[1]} ${m[2]}` : phone;
}

/** Today's date in India as YYYY-MM-DD (the date picker's earliest day). */
export function indiaToday(now = Date.now()): string {
  return new Date(now + 330 * 60_000).toISOString().slice(0, 10);
}
