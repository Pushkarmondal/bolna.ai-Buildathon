// The dialler's safety limits, driven directly against the local D1.

import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BolnaError } from '../src/bolna';
import { calls, events, requests, suppliers } from '../src/db/schema';
import {
  advance,
  type DiallerEnv,
  failOrphanedCalls,
  giveUpOnStuckCalls,
  inCallHours,
  isPassingRefusal,
  liveCallCount,
  nextCallingTime,
  parseAllowlist,
  parseCallHours,
} from '../src/dialler';
import { newId } from '../src/ids';
import { callBackLater } from '../src/tools';

const db = drizzle(env.DB);
afterEach(() => vi.restoreAllMocks());

/** Bolna's POST /call, answering each number with `answer` (a status code to refuse with). */
function fakeBolna(answer: (phone: string) => number | 'ok' = () => 'ok') {
  const dialled: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    const phone: string = body.recipient_phone_number;
    dialled.push(phone);
    const result = answer(phone);
    if (result !== 'ok') return new Response('refused', { status: result });
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

const callsOf = (id: string) => db.select().from(calls).where(eq(calls.requestId, id)).all();

/** 10:30 in India on some day, as epoch ms. */
const indiaTime = (hour: number, minute = 0) => Date.UTC(2026, 9, 27, hour, minute) - 330 * 60_000;

const dialler = (over: Partial<DiallerEnv> = {}): DiallerEnv => ({
  bolna: { apiKey: 'bn-test', baseUrl: 'https://bolna.test' },
  callerAgentId: 'agent-caller',
  allowlist: 'any',
  maxCallsPerDay: 1000,
  maxLiveCalls: 1000,
  callHours: { from: 0, to: 24 },
  ...over,
});

describe('dialler limits', () => {
  it('parses the allowlist: a list, "*" for any, and nothing for none', () => {
    expect(parseAllowlist(' +919800000001, +919800000002 ,')).toEqual(
      new Set(['+919800000001', '+919800000002']),
    );
    expect(parseAllowlist('*')).toBe('any');
    expect(parseAllowlist('')).toEqual(new Set());
    expect(parseAllowlist(undefined)).toEqual(new Set());
  });

  it('never dials a number outside the allowlist', async () => {
    const dialled = fakeBolna();
    const id = await orderWith(['+919811111111', '+919822222222']);
    await advance(dialler({ allowlist: new Set(['+919822222222']) }), db, id);
    expect(dialled).toEqual(['+919822222222']);
  });

  it('dials nobody while the approved list is empty', async () => {
    const dialled = fakeBolna();
    const id = await orderWith(['+919811111112']);
    expect(await advance(dialler({ allowlist: new Set() }), db, id)).toBe('done');
    expect(dialled).toEqual([]);
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
    const live = await callsOf(id);
    expect(live).toHaveLength(1);
    expect(dialled).toHaveLength(1);
  });

  it('frees an order whose call was saved but never placed, to be tried again', async () => {
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
    expect(call?.retryable).toBe(true);
  });

  it('gives up on a placed call Bolna never finishes, so it stops holding the line', async () => {
    const id = await orderWith(['+919866666667']);
    const [supplier] = await db.select().from(suppliers).where(eq(suppliers.requestId, id)).all();
    const callId = newId('call');
    await db.insert(calls).values({
      id: callId,
      requestId: id,
      supplierId: supplier?.id ?? '',
      round: 1,
      status: 'in-progress',
      bolnaExecutionId: 'exec-stuck',
      createdAt: new Date(Date.now() - 20 * 60_000),
    });
    expect(await giveUpOnStuckCalls(db)).toBeGreaterThanOrEqual(1);
    const [call] = await db.select().from(calls).where(eq(calls.id, callId)).all();
    expect(call?.status).toBe('failed');
    const logged = await db.select().from(events).where(eq(events.callId, callId)).all();
    expect(String(logged[0]?.detail?.message)).toMatch(/never said this call ended/);
  });
});

describe('calling hours', () => {
  it('reads CALL_HOURS, keeping 10 to 19 for anything it cannot read', () => {
    expect(parseCallHours('10-19')).toEqual({ from: 10, to: 19 });
    expect(parseCallHours(' 0 - 24 ')).toEqual({ from: 0, to: 24 });
    expect(parseCallHours('19-10')).toEqual({ from: 10, to: 19 });
    expect(parseCallHours('')).toEqual({ from: 10, to: 19 });
    expect(parseCallHours(undefined)).toEqual({ from: 10, to: 19 });
  });

  it('counts the hours in India time', () => {
    const hours = { from: 10, to: 19 };
    expect(inCallHours(hours, indiaTime(9, 59))).toBe(false);
    expect(inCallHours(hours, indiaTime(10, 0))).toBe(true);
    expect(inCallHours(hours, indiaTime(18, 59))).toBe(true);
    expect(inCallHours(hours, indiaTime(19, 0))).toBe(false);
  });

  it('holds calls outside the hours and makes them once the hours open', async () => {
    const dialled = fakeBolna();
    const id = await orderWith(['+919877777771']);
    const hours = { from: 10, to: 19 };
    expect(await advance(dialler({ callHours: hours, now: () => indiaTime(21) }), db, id)).toBe(
      'waiting',
    );
    expect(dialled).toEqual([]);
    expect(await advance(dialler({ callHours: hours, now: () => indiaTime(10, 30) }), db, id)).toBe(
      'dialled',
    );
    expect(dialled).toEqual(['+919877777771']);
  });
});

describe('one call at a time across orders', () => {
  it("holds a second order's call until the first order's call ends", async () => {
    const dialled = fakeBolna();
    const first = await orderWith(['+919877777772']);
    const second = await orderWith(['+919877777773']);
    // Other tests in this file leave calls live; the limit is set one above them.
    const limit = { maxLiveCalls: (await liveCallCount(db)) + 1 };
    expect(await advance(dialler(limit), db, first)).toBe('dialled');
    expect(await advance(dialler(limit), db, second)).toBe('waiting');
    expect(dialled).toEqual(['+919877777772']);

    await db.update(calls).set({ status: 'completed' }).where(eq(calls.requestId, first));
    expect(await advance(dialler(limit), db, second)).toBe('dialled');
    expect(dialled).toEqual(['+919877777772', '+919877777773']);
  });
});

describe('when Bolna refuses a call', () => {
  it('tells a passing refusal from one about the number', () => {
    expect(isPassingRefusal(new BolnaError('x', 429, ''))).toBe(true);
    expect(isPassingRefusal(new BolnaError('x', 503, ''))).toBe(true);
    expect(isPassingRefusal(new BolnaError('x', 400, 'Concurrency limit reached'))).toBe(true);
    expect(isPassingRefusal(new TypeError('network'))).toBe(true);
    expect(isPassingRefusal(new BolnaError('x', 400, 'number is not verified'))).toBe(false);
    expect(isPassingRefusal(new BolnaError('BOLNA_API_KEY is not set', 0, ''))).toBe(false);
  });

  it('waits out a busy Bolna on the same supplier, and moves on only after three tries', async () => {
    const busy = '+919888888881';
    const dialled = fakeBolna((phone) => (phone === busy ? 429 : 'ok'));
    const id = await orderWith([busy, '+919888888882']);
    const at = (seconds: number) => dialler({ now: () => Date.now() + seconds * 1000 });

    // A busy Bolna is not the supplier's fault: nobody else is tried in the meantime.
    expect(await advance(at(0), db, id)).toBe('waiting');
    expect(dialled).toEqual([busy]);
    expect(await advance(at(10), db, id)).toBe('waiting');
    expect(dialled).toEqual([busy]);

    // A minute later, the same supplier again.
    expect(await advance(at(61), db, id)).toBe('waiting');
    expect(dialled).toEqual([busy, busy]);

    // The third refusal is the last: the next supplier is called.
    expect(await advance(at(122), db, id)).toBe('dialled');
    expect(dialled).toEqual([busy, busy, busy, '+919888888882']);
    const tries = (await callsOf(id)).filter((c) => c.status === 'failed');
    expect(tries.map((c) => [c.attempt, c.retryable])).toEqual([
      [1, true],
      [2, true],
      [3, false],
    ]);
  });

  it('skips at once a number Bolna refuses outright', async () => {
    const refused = '+919888888883';
    const dialled = fakeBolna((phone) => (phone === refused ? 400 : 'ok'));
    const id = await orderWith([refused, '+919888888884']);
    expect(await advance(dialler(), db, id)).toBe('dialled');
    expect(dialled).toEqual([refused, '+919888888884']);
    const [failed] = (await callsOf(id)).filter((c) => c.status === 'failed');
    expect(failed?.retryable).toBe(false);
  });
});

describe('call me back later', () => {
  it('moves a callback into calling hours', () => {
    const hours = { from: 10, to: 19 };
    expect(nextCallingTime(hours, indiaTime(15))).toBe(indiaTime(15));
    expect(nextCallingTime(hours, indiaTime(20))).toBe(indiaTime(10) + 86_400_000);
    expect(nextCallingTime(hours, indiaTime(7))).toBe(indiaTime(10));
  });

  it('calls the others meanwhile, keeps the round open, and calls back when it promised', async () => {
    const dialled = fakeBolna();
    const busy = '+919899999991';
    const id = await orderWith([busy, '+919899999992']);
    const t0 = Date.now();
    const at = (minutes: number) => dialler({ now: () => t0 + minutes * 60_000 });

    expect(await advance(at(0), db, id)).toBe('dialled');
    const [first] = await callsOf(id);
    // The supplier asks for an hour; the call ends.
    const promised = await callBackLater(
      db,
      { call_ref: first?.id ?? '', minutes: '60' },
      { from: 0, to: 24 },
      t0,
    );
    expect(promised.ok).toBe(true);
    await db
      .update(calls)
      .set({ status: 'completed' })
      .where(eq(calls.id, first?.id ?? ''));

    // The next supplier is called meanwhile.
    expect(await advance(at(1), db, id)).toBe('dialled');
    expect(dialled).toEqual([busy, '+919899999992']);
    await db.update(calls).set({ status: 'completed' }).where(eq(calls.requestId, id));

    // Round 1 stays open for the promise: no bargaining yet, nobody dialled.
    expect(await advance(at(30), db, id)).toBe('waiting');
    const [still] = await db.select().from(requests).where(eq(requests.id, id)).all();
    expect(still?.status).toBe('calling');

    // An hour later, the supplier is called back, and the Caller is told why.
    const bodies: Array<{ user_data: Record<string, string> }> = [];
    vi.mocked(globalThis.fetch).mockImplementation(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ status: 'queued', execution_id: newId('call') });
    });
    expect(await advance(at(61), db, id)).toBe('dialled');
    expect(bodies[0]?.user_data.callback_note).toMatch(/call back at this time/);
    const tries = (await callsOf(id)).filter((c) => c.supplierId === first?.supplierId);
    expect(tries.map((c) => c.attempt)).toEqual([1, 2]);
  });

  it('promises a callback only once per supplier per round', async () => {
    fakeBolna();
    const id = await orderWith(['+919899999993']);
    await advance(dialler(), db, id);
    const [call] = await callsOf(id);
    const hours = { from: 0, to: 24 };
    expect((await callBackLater(db, { call_ref: call?.id ?? '', minutes: 30 }, hours)).ok).toBe(
      true,
    );
    const again = await callBackLater(db, { call_ref: call?.id ?? '', minutes: 30 }, hours);
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/already promised/);
  });
});
