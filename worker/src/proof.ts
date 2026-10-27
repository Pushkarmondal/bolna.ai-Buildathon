// The numbers that prove Bhaav works, read straight from the database: what real orders saved,
// how calls went, and what the lie-catcher did with every number on every call. Plus "Break
// Bhaav": what judges tried on practice calls. Nothing here is estimated; an honest zero shows as
// zero, and possible slips are counted, not hidden.

import type { BreakStats, ProofStats, SpokenNumber } from '@bhaav/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from './db/context';
import { calls, quotes, requests, suppliers, turns } from './db/schema';
import { bestOffer, landedPrice } from './engine';
import { numbersIn } from './numbers';
import { orderOf, toTerms } from './orders';

const round2 = (n: number) => Math.round(n * 100) / 100;

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? null;
}

/** A number spoken as a statement that only the other person had said: worth a human's look. */
const isSlip = (n: SpokenNumber) => n.source === 'heard' && !n.question;

export async function proofStats(db: Db): Promise<ProofStats> {
  // Joined, never "request_id IN (…every order…)": D1 allows 100 bound values in a query.
  const realOrder = and(
    inArray(requests.status, ['done', 'approved']),
    eq(requests.isPractice, false),
    eq(requests.isSimulation, false),
  );
  const [real, quoteRows, callRows, turnRows] = await Promise.all([
    db.select().from(requests).where(realOrder).all(),
    db
      .select({ quote: quotes })
      .from(quotes)
      .innerJoin(requests, eq(quotes.requestId, requests.id))
      .where(realOrder)
      .all()
      .then((rows) => rows.map((r) => r.quote)),
    db
      .select({ call: calls })
      .from(calls)
      .innerJoin(requests, eq(calls.requestId, requests.id))
      .where(and(realOrder, eq(calls.channel, 'phone')))
      .all()
      .then((rows) => rows.map((r) => r.call)),
    db.select({ numbers: turns.numbers, thinkMs: turns.thinkMs }).from(turns).all(),
  ]);

  // Saving: the costliest comparable quote heard against the best, per order, in rupees.
  let savedRupees = 0;
  const percents: number[] = [];
  for (const r of real) {
    const order = orderOf(r);
    if (!order) continue;
    const terms = quoteRows.filter((q) => q.requestId === r.id).map(toTerms);
    const best = bestOffer(terms, order)?.perUnit;
    const highest = Math.max(
      ...terms.map((t) => landedPrice(t, order).perUnit ?? Number.NEGATIVE_INFINITY),
    );
    if (best == null || !Number.isFinite(highest) || highest <= best) continue;
    savedRupees += (highest - best) * order.quantity;
    percents.push(((highest - best) / highest) * 100);
  }

  const quoted = new Set(quoteRows.map((q) => q.callId));
  const numbers = turnRows.flatMap((t) => t.numbers as SpokenNumber[]);
  const thinks = turnRows
    .map((t) => t.thinkMs)
    .filter((ms): ms is number => ms !== null)
    .sort((a, b) => a - b);

  return {
    orders: real.length,
    savedRupees: round2(savedRupees),
    savedPercent: percents.length
      ? round2(percents.reduce((a, b) => a + b, 0) / percents.length)
      : null,
    calls: {
      placed: callRows.filter((c) => c.bolnaExecutionId).length,
      answered: callRows.filter((c) => c.status === 'completed').length,
      withQuote: callRows.filter((c) => quoted.has(c.id)).length,
    },
    quotes: {
      total: quoteRows.length,
      inTheirWords: quoteRows.filter((q) => numbersIn(q.supplierWords).includes(round2(q.price)))
        .length,
    },
    numbers: {
      checked: numbers.length,
      fromBook: numbers.filter((n) => n.source === 'book').length,
      readBack: numbers.filter((n) => n.source === 'heard' && n.question).length,
      stopped: numbers.filter((n) => n.source === 'stopped').length,
      possibleSlips: numbers.filter(isSlip).length,
    },
    thinkMs: {
      median: percentile(thinks, 0.5),
      p90: percentile(thinks, 0.9),
      turns: thinks.length,
    },
  };
}

/** What judges tried on practice calls, newest first. */
export async function breakStats(db: Db): Promise<BreakStats> {
  const rows = await db
    .select({
      callId: turns.callId,
      heard: turns.heard,
      said: turns.said,
      stopped: turns.stopped,
      numbers: turns.numbers,
      createdAt: turns.createdAt,
      persona: suppliers.name,
    })
    .from(turns)
    .innerJoin(calls, eq(turns.callId, calls.id))
    .innerJoin(suppliers, eq(calls.supplierId, suppliers.id))
    .where(eq(calls.channel, 'web'))
    .orderBy(desc(turns.createdAt))
    .all();

  const slips = (numbers: unknown) => (numbers as SpokenNumber[]).filter(isSlip).length;
  return {
    calls: new Set(rows.map((r) => r.callId)).size,
    turns: rows.length,
    stopped: rows.filter((r) => r.stopped).length,
    possibleSlips: rows.reduce((n, r) => n + slips(r.numbers), 0),
    tricks: rows
      .filter((r) => r.stopped || slips(r.numbers) > 0)
      .slice(0, 12)
      .map((r) => ({
        callId: r.callId ?? '',
        persona: r.persona,
        heard: r.heard,
        stopped: r.stopped,
        said: r.said,
        slip: slips(r.numbers) > 0,
        createdAt: r.createdAt.getTime(),
      })),
  };
}
