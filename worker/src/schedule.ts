// Repeat orders: "the same as last time" in one tap, or "every Monday at 10" by itself. A weekly
// order copies the item, quantity and suppliers (with their consent notes) of a past order, gets
// a fresh delivery date, and either starts its calls in calling hours or, if the owner asked,
// Bhaav phones the owner first to confirm by voice.

import type { ScheduleDto } from '@bhaav/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from './db/context';
import { events, requests, schedules, suppliers } from './db/schema';
import { advance, type DiallerEnv } from './dialler';
import { newId } from './ids';
import { indiaToday, nextRun, scheduleDto, scheduleDue } from './orders';
import { callOwnerToOrder, type OwnerEnv } from './owner';
import { startOrder } from './tools';

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * A new draft order copying a past one: same item, quantity, quality, area and suppliers (except
 * any who asked not to be called), delivered as far ahead as last time (at least tomorrow).
 */
export async function repeatOrder(
  db: Db,
  templateId: string,
  now = Date.now(),
): Promise<{ ok: true; id: string } | { ok: false; status: 400 | 404; error: string }> {
  const template = await db.select().from(requests).where(eq(requests.id, templateId)).get();
  if (!template) return { ok: false, status: 404, error: 'No such order.' };
  if (template.isPractice || template.isSimulation)
    return { ok: false, status: 400, error: 'Practice and simulated orders cannot be repeated.' };

  const lead = template.deliverBy
    ? Math.round(
        (Date.parse(template.deliverBy) -
          Date.parse(isoDay(template.createdAt.getTime() + 330 * 60_000))) /
          DAY_MS,
      )
    : 3;
  const deliverBy = isoDay(Date.parse(indiaToday(now)) + Math.max(1, lead) * DAY_MS);

  const id = newId('req');
  await db.insert(requests).values({
    id,
    buyerName: template.buyerName,
    item: template.item,
    quantity: template.quantity,
    unit: template.unit,
    quality: template.quality,
    deliverBy,
    area: template.area,
    buyerPhone: template.buyerPhone,
    ownerUpdates: template.ownerUpdates,
  });
  const list = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.requestId, templateId), eq(suppliers.doNotCall, false)))
    .all();
  for (const [i, s] of list.entries()) {
    await db.insert(suppliers).values({
      id: newId('sup'),
      requestId: id,
      name: s.name,
      phone: s.phone,
      language: s.language,
      consentNote: s.consentNote,
      // Same calling order as last time.
      createdAt: new Date(now + i),
    });
  }
  return { ok: true, id };
}

/** Sets an order to repeat every week; a slot already past today waits for next week. */
export async function setSchedule(
  db: Db,
  requestId: string,
  { weekday, hour, callOwnerFirst }: { weekday: number; hour: number; callOwnerFirst: boolean },
  now = Date.now(),
): Promise<ScheduleDto | null> {
  const request = await db.select().from(requests).where(eq(requests.id, requestId)).get();
  if (!request || request.isPractice || request.isSimulation) return null;
  const existing = await db
    .select()
    .from(schedules)
    .where(eq(schedules.requestId, requestId))
    .get();
  const slot = { weekday, hour, active: true, lastRunOn: null };
  const today = indiaToday(now);
  // Set on the day itself after the hour: the first run is next week, not a minute from now. An
  // edit on a day it already ran keeps that mark, so moving the hour later never runs it twice.
  const passed = (nextRun(slot, now) ?? Number.POSITIVE_INFINITY) < now;
  const lastRunOn = passed || existing?.lastRunOn === today ? today : (existing?.lastRunOn ?? null);
  if (existing) {
    await db
      .update(schedules)
      .set({ weekday, hour, callOwnerFirst, active: true, lastRunOn })
      .where(eq(schedules.id, existing.id));
  } else {
    await db
      .insert(schedules)
      .values({ id: newId('sch'), requestId, weekday, hour, callOwnerFirst, lastRunOn });
  }
  const row = await db.select().from(schedules).where(eq(schedules.requestId, requestId)).get();
  return row ? scheduleDto(row, request.item) : null;
}

export async function pauseSchedule(db: Db, scheduleId: string, active: boolean): Promise<boolean> {
  const row = await db.select().from(schedules).where(eq(schedules.id, scheduleId)).get();
  if (!row) return false;
  await db.update(schedules).set({ active }).where(eq(schedules.id, scheduleId));
  return true;
}

export async function listSchedules(db: Db): Promise<ScheduleDto[]> {
  const rows = await db
    .select({ schedule: schedules, item: requests.item })
    .from(schedules)
    .innerJoin(requests, eq(schedules.requestId, requests.id))
    .all();
  return rows.map((r) => scheduleDto(r.schedule, r.item));
}

/**
 * The cron's part: each weekly order that is due becomes this week's order, and then either its
 * calls start (in calling hours, one at a time, like any order) or Bhaav phones the owner first.
 */
export async function runSchedules(
  dialler: DiallerEnv,
  owner: OwnerEnv,
  db: Db,
  now = Date.now(),
): Promise<string[]> {
  const started: string[] = [];
  for (const s of await db.select().from(schedules).where(eq(schedules.active, true)).all()) {
    if (!scheduleDue(s, now)) continue;
    // Marked first, so a slow run can never make two orders for one day.
    await db
      .update(schedules)
      .set({ lastRunOn: indiaToday(now) })
      .where(eq(schedules.id, s.id));
    const made = await repeatOrder(db, s.requestId, now);
    if (!made.ok) continue;
    started.push(made.id);
    await db.insert(events).values({
      id: newId('evt'),
      requestId: made.id,
      type: 'schedule_run',
      detail: { scheduleId: s.id, from: s.requestId },
    });
    if (s.callOwnerFirst) {
      await callOwnerToOrder(owner, db, made.id);
    } else {
      const go = await startOrder(db, made.id, dialler.callerAgentId);
      if (go.ok) await advance(dialler, db, made.id).catch(() => undefined);
    }
  }
  return started;
}
