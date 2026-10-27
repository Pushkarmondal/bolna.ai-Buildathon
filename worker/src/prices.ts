// Price memory: every past order's best landed price per item, so a buyer sees whether today's
// bhaav is good. Practice and simulated orders never count.

import type { PricePoint, PriceSeries, Unit } from '@bhaav/shared';
import { and, desc, eq, isNotNull, lt, type SQL, sql } from 'drizzle-orm';
import type { Db } from './db/context';
import { quotes, requests, suppliers } from './db/schema';
import { bestOffer } from './engine';

/** "Red  Onions " and "red onions" are the same item. */
export const itemKey = (item: string) => item.trim().toLowerCase().replace(/\s+/g, ' ');

/** The newest quotes win when there are more than this; the oldest drop off the chart. */
const MAX_ROWS = 5000;

async function rowsWhere(db: Db, extra?: SQL) {
  const rows = await db
    .select({
      requestId: quotes.requestId,
      supplierId: quotes.supplierId,
      price: quotes.price,
      unit: quotes.unit,
      packSize: quotes.packSize,
      packUnit: quotes.packUnit,
      minQuantity: quotes.minQuantity,
      deliveryDate: quotes.deliveryDate,
      deliveryCharge: quotes.deliveryCharge,
      createdAt: quotes.createdAt,
      item: requests.item,
      orderUnit: requests.unit,
      orderQuantity: requests.quantity,
      deliverBy: requests.deliverBy,
      supplierName: suppliers.name,
    })
    .from(quotes)
    .innerJoin(requests, eq(quotes.requestId, requests.id))
    .innerJoin(suppliers, eq(quotes.supplierId, suppliers.id))
    .where(
      and(
        eq(requests.isPractice, false),
        eq(requests.isSimulation, false),
        isNotNull(requests.item),
        isNotNull(requests.unit),
        extra,
      ),
    )
    .orderBy(desc(quotes.createdAt))
    .limit(MAX_ROWS)
    .all();
  return rows.reverse();
}

type Row = Awaited<ReturnType<typeof rowsWhere>>[number];

/**
 * One point per order: its best quote by the same rule as the results page (each supplier's
 * newest quote, cheapest landed price that fits the order, ties to the earlier delivery and then
 * the earlier quote), so price memory never disagrees with what the buyer was shown.
 */
function group(rows: Row[]): PriceSeries[] {
  const byOrder = new Map<string, Row[]>();
  for (const r of rows) byOrder.set(r.requestId, [...(byOrder.get(r.requestId) ?? []), r]);

  const series = new Map<
    string,
    { item: string; unit: Unit; points: PricePoint[]; quotes: number }
  >();
  for (const [requestId, orderRows] of byOrder) {
    const first = orderRows[0];
    if (!first?.item || !first.orderUnit) continue;
    const item = itemKey(first.item);
    const key = `${item}|${first.orderUnit}`;
    const entry = series.get(key) ?? { item, unit: first.orderUnit, points: [], quotes: 0 };
    entry.quotes += orderRows.length;
    series.set(key, entry);

    if (first.orderQuantity == null || !first.deliverBy) continue;
    const order = {
      quantity: first.orderQuantity,
      unit: first.orderUnit,
      deliverBy: first.deliverBy,
    };
    const best = bestOffer(
      orderRows.map((r) => ({
        supplierId: r.supplierId,
        price: r.price,
        unit: r.unit,
        packSize: r.packSize,
        packUnit: r.packUnit,
        minQuantity: r.minQuantity,
        deliveryDate: r.deliveryDate,
        deliveryCharge: r.deliveryCharge,
        createdAt: r.createdAt.getTime(),
      })),
      order,
    );
    if (best?.perUnit == null) continue;
    entry.points.push({
      requestId,
      date: best.quote.createdAt,
      perUnit: best.perUnit,
      supplierName:
        orderRows.find((r) => r.supplierId === best.quote.supplierId)?.supplierName ?? '',
    });
  }

  return [...series.values()]
    .map((s) => ({ ...s, points: s.points.sort((a, b) => a.date - b.date) }))
    .filter((s) => s.points.length > 0)
    .sort((a, b) => (b.points.at(-1)?.date ?? 0) - (a.points.at(-1)?.date ?? 0));
}

/** Every item ever bought, most recently quoted first. */
export async function priceSeries(db: Db): Promise<PriceSeries[]> {
  return group(await rowsWhere(db));
}

/**
 * Orders of the same item and unit placed before this one, each with its best price, oldest
 * first. Later orders are left out, so an old result never calls a newer order "last time".
 */
export async function historyFor(
  db: Db,
  request: { id: string; item: string | null; unit: Unit | null; createdAt: Date },
): Promise<PricePoint[]> {
  if (!request.item || !request.unit) return [];
  const key = itemKey(request.item);
  const rows = await rowsWhere(
    db,
    and(
      eq(requests.unit, request.unit),
      sql`lower(trim(${requests.item})) = ${key}`,
      lt(requests.createdAt, request.createdAt),
    ),
  );
  const [match] = group(rows).filter((s) => s.item === key);
  return match ? match.points.filter((p) => p.requestId !== request.id) : [];
}
