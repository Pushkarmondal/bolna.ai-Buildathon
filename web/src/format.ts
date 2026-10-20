import type { CallStatus, Unit } from '@bhaav/shared';

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
