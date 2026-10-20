// The dialler's safety limits, driven directly against the local D1.

import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { calls, events, requests, suppliers } from '../src/db/schema';
import { advance, type DiallerEnv, failOrphanedCalls, parseAllowlist } from '../src/dialler';
import { newId } from '../src/ids';

const db = drizzle(env.DB);
afterEach(() => vi.restoreAllMocks());

function fakeBolna() {
  const dialled: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    dialled.push(body.recipient_phone_number);
    return Response.json({ status: 'queued', execution_id: newId('call') });
  });
  return dialled;
}

async function orderWith(phones: string[]): Promise<string> {
  const id = newId('req');
  await db.insert(requests).values({
    id,
    buyerName: 'Test',
    item: 'onions',
    quantity: 10,
    unit: 'kg',
    deliverBy: '2026-10-23',
    status: 'calling',
  });
  for (const phone of phones) {
    await db
      .insert(suppliers)
      .values({ id: newId('sup'), requestId: id, name: phone, phone, consentNote: 'test' });
  }
  return id;
}

const dialler = (over: Partial<DiallerEnv> = {}): DiallerEnv => ({
  bolna: { apiKey: 'bn-test', baseUrl: 'https://bolna.test' },
  callerAgentId: 'agent-caller',
  allowlist: new Set(),
  maxCallsPerDay: 1000,
  ...over,
});

describe('dialler limits', () => {
  it('parses the allowlist', () => {
    expect([...parseAllowlist(' +919800000001, +919800000002 ,')]).toEqual([
      '+919800000001',
      '+919800000002',
    ]);
    expect(parseAllowlist('').size).toBe(0);
  });

  it('never dials a number outside the allowlist', async () => {
    const dialled = fakeBolna();
    const id = await orderWith(['+919811111111', '+919822222222']);
    await advance(dialler({ allowlist: new Set(['+919822222222']) }), db, id);
    expect(dialled).toEqual(['+919822222222']);
  });

  it('stops for the day at the call limit and says why', async () => {
    const dialled = fakeBolna();
    const id = await orderWith(['+919833333333']);
    const step = await advance(dialler({ maxCallsPerDay: 0 }), db, id);
    expect(step).toBe('done');
    expect(dialled).toEqual([]);
    const [request] = await db.select().from(requests).where(eq(requests.id, id)).all();
    expect(request?.status).toBe('done');
    const logged = await db.select().from(events).where(eq(events.requestId, id)).all();
    expect(String(logged[0]?.detail?.message)).toMatch(/daily limit/);
  });

  it('places only one live call per order even when two runs race', async () => {
    const dialled = fakeBolna();
    const id = await orderWith(['+919844444444', '+919855555555']);
    await Promise.all([advance(dialler(), db, id), advance(dialler(), db, id)]);
    const live = await db.select().from(calls).where(eq(calls.requestId, id)).all();
    expect(live).toHaveLength(1);
    expect(dialled).toHaveLength(1);
  });

  it('frees an order whose call was saved but never placed', async () => {
    const id = await orderWith(['+919866666666']);
    const [supplier] = await db.select().from(suppliers).where(eq(suppliers.requestId, id)).all();
    const callId = newId('call');
    await db.insert(calls).values({
      id: callId,
      requestId: id,
      supplierId: supplier?.id ?? '',
      round: 1,
      createdAt: new Date(Date.now() - 10 * 60_000),
    });
    expect(await failOrphanedCalls(db, 5 * 60_000)).toBeGreaterThanOrEqual(1);
    const [call] = await db.select().from(calls).where(eq(calls.id, callId)).all();
    expect(call?.status).toBe('failed');
  });
});
