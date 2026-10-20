// Price memory: every past order's best landed price per item, so a buyer sees whether today's
// bhaav is good. Practice orders never count.

import type { PricePoint, PriceSeries, Unit } from '@bhaav/shared';
import { and, asc, eq, isNotNull, type SQL, sql } from 'drizzle-orm';
import type { Db } from './db/context';
import { quotes, requests, suppliers } from './db/schema';

/** "Red  Onions " and "red onions" are the same item. */
export const itemKey = (item: string) => item.trim().toLowerCase().replace(/\s+/g, ' ');

async function rowsWhere(db: Db, extra?: SQL) {
  return db
    .select({
      requestId: quotes.requestId,
      perUnit: quotes.landedPricePerUnit,
      createdAt: quotes.createdAt,
      item: requests.item,
      unit: requests.unit,
      supplierName: suppliers.name,
    })
    .from(quotes)
    .innerJoin(requests, eq(quotes.requestId, requests.id))
    .innerJoin(suppliers, eq(quotes.supplierId, suppliers.id))
    .where(
      and(
        eq(requests.isPractice, false),
        isNotNull(requests.item),
        isNotNull(requests.unit),
        extra,
      ),
    )
    .orderBy(asc(quotes.createdAt))
    .limit(5000)
    .all();
}

type Row = Awaited<ReturnType<typeof rowsWhere>>[number];

function group(rows: Row[]): PriceSeries[] {
  const series = new Map<
    string,
    { item: string; unit: Unit; best: Map<string, PricePoint>; quotes: number }
  >();
  for (const r of rows) {
    if (!r.item || !r.unit) continue;
    const item = itemKey(r.item);
    const key = `${item}|${r.unit}`;
    const entry = series.get(key) ?? { item, unit: r.unit, best: new Map(), quotes: 0 };
    entry.quotes += 1;
    if (r.perUnit != null) {
      const seen = entry.best.get(r.requestId);
      if (!seen || r.perUnit < seen.perUnit) {
        entry.best.set(r.requestId, {
          requestId: r.requestId,
          date: r.createdAt.getTime(),
          perUnit: r.perUnit,
          supplierName: r.supplierName,
        });
      }
    }
    series.set(key, entry);
  }
  return [...series.values()]
    .map((s) => ({
      item: s.item,
      unit: s.unit,
      quotes: s.quotes,
      points: [...s.best.values()].sort((a, b) => a.date - b.date),
    }))
    .filter((s) => s.points.length > 0)
    .sort((a, b) => (b.points.at(-1)?.date ?? 0) - (a.points.at(-1)?.date ?? 0));
}

/** Every item ever bought, most recently quoted first. */
export async function priceSeries(db: Db): Promise<PriceSeries[]> {
  return group(await rowsWhere(db));
}

/** Earlier orders' best prices for the same item and unit as this order, oldest first. */
export async function historyFor(
  db: Db,
  request: { id: string; item: string | null; unit: Unit | null },
): Promise<PricePoint[]> {
  if (!request.item || !request.unit) return [];
  const key = itemKey(request.item);
  const rows = await rowsWhere(
    db,
    and(eq(requests.unit, request.unit), sql`lower(trim(${requests.item})) = ${key}`),
  );
  const [match] = group(rows).filter((s) => s.item === key);
  return match ? match.points.filter((p) => p.requestId !== request.id) : [];
}
