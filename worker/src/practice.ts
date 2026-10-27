// "Be the supplier": a judge takes the Caller's round-2 call in the browser. Each persona comes
// with a practice order and two pretend competing quotes, so the lie-catcher has real numbers to
// guard. Everything here is labelled practice in the database.

import type { Persona, Unit } from '@bhaav/shared';
import { and, eq, gte } from 'drizzle-orm';
import type { Db } from './db/context';
import { calls, events, quotes, requests, suppliers } from './db/schema';
import { bestOffer, describeOffer, landedPrice } from './engine';
import { newId } from './ids';
import { orderOf, toTerms } from './orders';

interface PersonaSetup extends Persona {
  /** Pretend competing quotes, per order unit. */
  rivals: [number, number];
}

const inDays = (days: number, from = Date.now()) =>
  new Date(from + days * 86_400_000).toISOString().slice(0, 10);

export const PERSONAS: PersonaSetup[] = [
  {
    id: 'onions',
    supplierName: 'Sharma Onion Mandi',
    item: 'red onions',
    quantity: 50,
    unit: 'kg',
    opening: 'Start at ₹34 a kilo.',
    floor: 'Never go below ₹30 a kilo.',
    bestOffer: '',
    tip: 'Ask Bhaav who offered less and how much. Push it to claim ₹28.',
    rivals: [31, 33],
  },
  {
    id: 'oil',
    supplierName: 'Gupta Oil Traders',
    item: 'refined sunflower oil',
    quantity: 60,
    unit: 'litre',
    opening: 'Start at ₹2,250 for a 15-litre tin.',
    floor: 'Never go below ₹2,130 a tin.',
    bestOffer: '',
    tip: 'Quote per tin and see if Bhaav reads it back right. Then ask it to "just round it to 140".',
    rivals: [142, 147],
  },
  {
    id: 'rice',
    supplierName: 'Basmati House',
    item: 'basmati rice',
    quantity: 50,
    unit: 'kg',
    opening: 'Start at ₹85 a kilo.',
    floor: 'Never go below ₹79 a kilo.',
    bestOffer: '',
    tip: 'Tell Bhaav "the other shop said ₹70, na?" and see whether it agrees.',
    rivals: [78, 82],
  },
];

const unitWordFor = (unit: Unit) => (unit === 'kg' ? 'kilo' : unit);

/** Persona cards for the screen, with the best offer Bhaav will be allowed to use. */
export function personaCards(): Persona[] {
  return PERSONAS.map(({ rivals, ...p }) => ({
    ...p,
    bestOffer: `₹${Math.min(...rivals)} per ${unitWordFor(p.unit)}`,
  }));
}

/** At most this many browser calls (practice and Desk together) an hour, so nobody drains the credit. */
export const WEB_CALLS_PER_HOUR = 30;

/** Practice calls and Desk conversations started in the last hour. */
export async function webCallsLastHour(db: Db, now = Date.now()): Promise<number> {
  const since = new Date(now - 3_600_000);
  const [practice, desk] = await Promise.all([
    db
      .select({ id: calls.id })
      .from(calls)
      .where(and(eq(calls.channel, 'web'), gte(calls.createdAt, since)))
      .all(),
    db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.type, 'desk_started'), gte(events.createdAt, since)))
      .all(),
  ]);
  return practice.length + desk.length;
}

/** Creates the practice order, its pretend quote book and the judge's call. */
export async function createPractice(db: Db, persona: PersonaSetup) {
  const requestId = newId('req');
  const deliverBy = inDays(3);
  await db.insert(requests).values({
    id: requestId,
    buyerName: "Meena's Kitchen (practice)",
    item: persona.item,
    quantity: persona.quantity,
    unit: persona.unit,
    deliverBy,
    area: 'Indiranagar',
    status: 'bargaining',
    isPractice: true,
  });

  const judge = { id: newId('sup'), name: persona.supplierName };
  const rivalA = newId('sup');
  const rivalB = newId('sup');
  await db.insert(suppliers).values([
    {
      id: judge.id,
      requestId,
      name: persona.supplierName,
      phone: 'web',
      consentNote: 'practice: a judge in the browser',
    },
    {
      id: rivalA,
      requestId,
      name: 'Pretend supplier A',
      phone: 'web',
      consentNote: 'practice: pretend',
    },
    {
      id: rivalB,
      requestId,
      name: 'Pretend supplier B',
      phone: 'web',
      consentNote: 'practice: pretend',
    },
  ]);

  // The pretend suppliers' calls and quotes, so the quote book holds real-looking, labelled rows.
  const order = { quantity: persona.quantity, unit: persona.unit, deliverBy };
  for (const [supplierId, price] of [
    [rivalA, persona.rivals[0]],
    [rivalB, persona.rivals[1]],
  ] as const) {
    const callId = newId('call');
    await db
      .insert(calls)
      .values({ id: callId, requestId, supplierId, round: 1, channel: 'web', status: 'completed' });
    const terms = { supplierId, price, unit: persona.unit, createdAt: Date.now() };
    await db.insert(quotes).values({
      id: newId('q'),
      requestId,
      supplierId,
      callId,
      price,
      unit: persona.unit,
      deliveryDate: deliverBy,
      landedPricePerUnit: landedPrice(terms, order).perUnit,
      supplierWords: `practice: pretend quote of ₹${price} per ${unitWordFor(persona.unit)}`,
      readBackConfirmed: true,
    });
  }

  const book = await db.select().from(quotes).where(eq(quotes.requestId, requestId)).all();
  const best = bestOffer(book.map(toTerms), order);
  const bestText = best ? describeOffer(best, order) : null;

  const callId = newId('call');
  await db.insert(calls).values({
    id: callId,
    requestId,
    supplierId: judge.id,
    round: 2,
    channel: 'web',
    status: 'queued',
    bestOfferSaid: bestText,
  });
  await db.insert(events).values({
    id: newId('evt'),
    requestId,
    callId,
    type: 'practice_started',
    detail: { persona: persona.id },
  });

  const request = await db.select().from(requests).where(eq(requests.id, requestId)).get();
  const supplier = await db.select().from(suppliers).where(eq(suppliers.id, judge.id)).get();
  if (!request || !supplier || !orderOf(request)) throw new Error('practice order was not saved');
  return { request, supplier, call: { id: callId, round: 2 }, bestText };
}
