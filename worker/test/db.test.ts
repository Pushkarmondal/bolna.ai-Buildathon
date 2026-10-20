import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { beforeAll, describe, expect, it } from 'vitest';
import { allowedNumbersFor, recordEvent } from '../src/db/context';
import { calls, events, quotes, requests, suppliers } from '../src/db/schema';

const db = drizzle(env.DB);

/** Drizzle wraps D1's error, so the trigger's message is on the cause chain. */
async function expectAppendOnlyRefusal(query: PromiseLike<unknown>) {
  const error = await Promise.resolve(query).then(
    () => null,
    (e: unknown) => e,
  );
  const messages: string[] = [];
  for (let e = error; e instanceof Error; e = e.cause) messages.push(e.message);
  expect(messages.join(' | ')).toMatch(/append-only/);
}

async function seedOrder() {
  await db.insert(requests).values({
    id: 'req_1',
    buyerName: "Meena's Kitchen",
    item: 'onions',
    quantity: 50,
    unit: 'kg',
    deliverBy: '2026-10-23',
  });
  await db.insert(suppliers).values([
    { id: 'sup_a', requestId: 'req_1', name: 'Gupta Traders', phone: '+919800000001' },
    { id: 'sup_b', requestId: 'req_1', name: 'Sharma Mandi', phone: '+919800000002' },
  ]);
  await db.insert(calls).values([
    { id: 'call_a1', requestId: 'req_1', supplierId: 'sup_a', round: 1, status: 'completed' },
    {
      id: 'call_b2',
      requestId: 'req_1',
      supplierId: 'sup_b',
      round: 2,
      bestOfferSaid: '₹31.5 per kilo',
    },
  ]);
  await db.insert(quotes).values({
    id: 'q_1',
    requestId: 'req_1',
    supplierId: 'sup_a',
    callId: 'call_a1',
    price: 1600,
    unit: 'quintal',
    deliveryCharge: 150,
    deliveryDate: '2026-10-22',
    landedPricePerUnit: 19,
    supplierWords: 'solah sau quintal, delivery 150 extra',
    readBackConfirmed: true,
  });
}

describe('database', () => {
  // Storage persists across tests in a file, and the quote book cannot be wiped, so seed once.
  beforeAll(seedOrder);

  it('lists the numbers a call may say', async () => {
    const allowed = await allowedNumbersFor(db, 'call_b2');
    for (const n of [50, 23, 1600, 150, 19, 22, 31.5]) expect(allowed).toContain(n);
    expect(allowed).not.toContain(27);
  });

  it('allows nothing for an unknown call', async () => {
    expect(await allowedNumbersFor(db, 'call_nope')).toEqual([]);
    expect(await allowedNumbersFor(db, null)).toEqual([]);
  });

  it('refuses to edit or delete the quote book', async () => {
    await expectAppendOnlyRefusal(db.update(quotes).set({ price: 1 }).where(eq(quotes.id, 'q_1')));
    await expectAppendOnlyRefusal(db.delete(quotes).where(eq(quotes.id, 'q_1')));
    const [row] = await db.select().from(quotes).where(eq(quotes.id, 'q_1')).all();
    expect(row?.price).toBe(1600);
  });

  it('logs an event against its call, and keeps an unknown ref in the detail', async () => {
    await recordEvent(db, { type: 'blocked', callRef: 'call_b2', sentence: '₹27', unbacked: [27] });
    await recordEvent(db, {
      type: 'blocked',
      callRef: 'call_ghost',
      sentence: '₹27',
      unbacked: [27],
    });
    const rows = await db.select().from(events).all();
    expect(rows.map((r) => [r.requestId, r.callId])).toEqual([
      ['req_1', 'call_b2'],
      [null, null],
    ]);
    expect(rows[1]?.detail).toMatchObject({ callRef: 'call_ghost', unbacked: [27] });
    await expectAppendOnlyRefusal(db.delete(events));
  });
});

describe('POST /v1/chat/completions', () => {
  const post = (body: unknown, auth?: string) =>
    exports.default.fetch('https://bhaav.test/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
      body: JSON.stringify(body),
    });
  const valid = { model: 'bhaav-llm', stream: true, messages: [{ role: 'user', content: 'hi' }] };

  it('refuses a request without the shared secret', async () => {
    expect((await post(valid)).status).toBe(401);
    expect((await post(valid, 'Bearer wrong-secret')).status).toBe(401);
  });

  it('refuses a malformed request', async () => {
    expect((await post({ messages: [] }, 'Bearer test-secret')).status).toBe(400);
  });
});

describe('GET /api/health', () => {
  it('answers', async () => {
    const res = await exports.default.fetch('https://bhaav.test/api/health');
    expect(await res.json()).toEqual({ ok: true });
  });
});
