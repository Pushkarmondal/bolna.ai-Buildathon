// The whole order flow through the real routes, with Bolna faked at https://bolna.test.

import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import type { OrderView } from '@bhaav/shared';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { allowedNumbersFor } from '../src/db/context';
import { calls, events, requests } from '../src/db/schema';
import worker, { sweep } from '../src/index';

const db = drizzle(env.DB);

/** A date n days from today, so no test goes stale when its written date passes. */
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const SOON = inDays(5);

interface FakeBolna {
  placed: Array<{
    agent_id: string;
    recipient_phone_number: string;
    user_data: Record<string, string>;
  }>;
  executions: Map<string, Record<string, unknown>>;
  failNextCall: () => void;
  failNextMint: () => void;
  /** The execution id Bolna gave the nth placed call (1-based); unique across tests. */
  exec: (n: number) => string;
  runId: string;
}

function fakeBolna(): FakeBolna {
  const placed: FakeBolna['placed'] = [];
  const executions = new Map<string, Record<string, unknown>>();
  // Storage outlives a test, so ids must not repeat between tests.
  const prefix = crypto.randomUUID().slice(0, 8);
  const exec = (n: number) => `exec_${prefix}_${n}`;
  const runId = `run_${prefix}`;
  let failNext = false;
  let failMint = false;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === 'https://bolna.test/call') {
      if (failNext) {
        failNext = false;
        return new Response('carrier error', { status: 500 });
      }
      placed.push(JSON.parse(String(init?.body)));
      return Response.json({
        message: 'done',
        status: 'queued',
        execution_id: exec(placed.length),
      });
    }
    if (url === 'https://bolna.test/web-call/session') {
      if (failMint) {
        failMint = false;
        return new Response('no capacity', { status: 503 });
      }
      return Response.json({ run_id: runId, agent_id: 'agent-caller', expires_in: 120 });
    }
    const execution = /^https:\/\/bolna\.test\/executions\/(.+)$/.exec(url);
    if (execution?.[1]) {
      return Response.json(
        executions.get(execution[1]) ?? { id: execution[1], status: 'in-progress' },
      );
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
  return {
    placed,
    executions,
    failNextCall: () => (failNext = true),
    failNextMint: () => (failMint = true),
    exec,
    runId,
  };
}

afterEach(() => vi.restoreAllMocks());

let cookie = '';

async function send(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  const request = new Request(`https://bhaav.test${path}`, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const tool = (name: string, params: Record<string, string>) =>
  send(`/tools/${name}`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-tool-secret' },
    json: params,
  });

const webhook = (execution: Record<string, unknown>) =>
  send('/webhooks/bolna/test-hook-secret', { method: 'POST', json: execution });

async function view(id: string): Promise<OrderView> {
  return (await send(`/api/requests/${id}`)).json();
}

async function newOrder(suppliersToAdd = 3): Promise<string> {
  const { id } = await (
    await send('/api/requests', { method: 'POST', json: { buyerName: "Meena's Kitchen" } })
  ).json<{ id: string }>();
  await send(`/api/requests/${id}`, {
    method: 'PATCH',
    json: {
      item: 'red onions',
      quantity: 50,
      unit: 'kilo',
      deliverBy: SOON,
      area: 'Indiranagar',
    },
  });
  for (let i = 1; i <= suppliersToAdd; i++) {
    const res = await send(`/api/requests/${id}/suppliers`, {
      method: 'POST',
      json: {
        name: `Supplier ${i}`,
        phone: `98000${id.slice(-5, -2)}0${i}`.replace(/[^\d]/g, '7').slice(0, 10),
        consentNote: 'agreed on WhatsApp',
      },
    });
    expect(res.status).toBe(201);
  }
  return id;
}

beforeAll(async () => {
  expect((await send('/api/requests', { method: 'POST', json: { buyerName: 'x' } })).status).toBe(
    401,
  );
  expect((await send('/api/auth', { method: 'POST', json: { passcode: 'wrong' } })).status).toBe(
    401,
  );
  const res = await send('/api/auth', { method: 'POST', json: { passcode: 'open-sesame' } });
  expect(res.status).toBe(200);
  cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  expect(cookie).toMatch(/^bhaav_session=/);
});

describe('an order from start to approval', () => {
  it('calls each supplier, bargains with the best real offer, then lets the buyer approve', async () => {
    const bolna = fakeBolna();
    const id = await newOrder(3);
    expect((await view(id)).missing).toEqual([]);

    const start = await send(`/api/requests/${id}/start`, { method: 'POST' });
    expect(start.status).toBe(200);
    expect(bolna.placed).toHaveLength(1);
    expect(bolna.placed[0]?.agent_id).toBe('agent-caller');
    expect(bolna.placed[0]?.user_data).toMatchObject({
      round: '1',
      best_offer: 'none',
      quantity: '50 kilo',
    });

    // Round 1: three suppliers, one at a time.
    const prices = ['34', '32', '35'];
    for (let i = 0; i < 3; i++) {
      const placed = bolna.placed[i];
      expect(placed, `call ${i + 1} placed`).toBeDefined();
      const callRef = placed?.user_data.call_ref ?? '';
      const saved = await (
        await tool('save_quote', {
          call_ref: callRef,
          price: `${prices[i]}.000000`,
          unit: 'kilo',
          supplier_words: `${prices[i]} rupaye kilo`,
          delivery_date: 'None',
          delivery_charge: '%(delivery_charge)f',
        })
      ).json<{ ok: boolean }>();
      expect(saved.ok).toBe(true);
      await webhook({ id: bolna.exec(i + 1), status: 'call-disconnected' });
      expect(bolna.placed, 'no new call before completed').toHaveLength(i + 1);
      await webhook({
        id: bolna.exec(i + 1),
        status: 'completed',
        transcript: `call ${i + 1}`,
        telephony_data: { recording_url: `https://rec/${i + 1}` },
      });
    }

    // Round 2 starts with the costlier supplier closest to the best (34 vs best 32).
    expect(bolna.placed).toHaveLength(4);
    const firstBargain = bolna.placed[3];
    expect(firstBargain?.user_data).toMatchObject({
      round: '2',
      best_offer: '₹32 per kilo',
      supplier_name: 'Supplier 1',
    });

    // A duplicate webhook does not dial twice.
    await webhook({ id: bolna.exec(3), status: 'completed' });
    expect(bolna.placed).toHaveLength(4);

    // Supplier 1 beats the offer, so Supplier 2 is now costlier and gets the new best offer.
    await tool('save_quote', {
      call_ref: firstBargain?.user_data.call_ref ?? '',
      price: '31',
      unit: 'kg',
      supplier_words: 'theek hai, 31 kar denge',
    });
    await webhook({ id: bolna.exec(4), status: 'completed' });
    expect(bolna.placed[4]?.user_data).toMatchObject({
      round: '2',
      best_offer: '₹31 per kilo',
      supplier_name: 'Supplier 2',
    });
    await webhook({ id: bolna.exec(5), status: 'no-answer' });
    expect(bolna.placed[5]?.user_data).toMatchObject({ round: '2', supplier_name: 'Supplier 3' });
    await webhook({ id: bolna.exec(6), status: 'completed' });
    expect(bolna.placed).toHaveLength(6);

    const done = await view(id);
    expect(done.order.status).toBe('done');
    expect(done.highestPerUnit).toBe(35);
    const best = done.quotes.find((q) => q.id === done.bestQuoteId);
    expect(best?.price).toBe(31);
    expect(done.calls.find((c) => c.round === 1)?.recordingUrl).toBe('https://rec/1');

    const approved = await send(`/api/requests/${id}/approve`, {
      method: 'POST',
      json: { quoteId: done.bestQuoteId },
    });
    expect(approved.status).toBe(200);
    expect((await view(id)).order.status).toBe('approved');

    // Round 3, on request: Bhaav tells the chosen supplier, quoting their own terms.
    const confirm = await send(`/api/requests/${id}/confirm`, { method: 'POST' });
    expect(confirm.status).toBe(200);
    expect(bolna.placed).toHaveLength(7);
    expect(bolna.placed[6]?.user_data).toMatchObject({
      round: '3',
      best_offer: '₹31 per kilo',
      supplier_name: 'Supplier 1',
      agent_language: 'hi',
    });
    const again = await send(`/api/requests/${id}/confirm`, { method: 'POST' });
    expect(again.status).toBe(409);
    expect(bolna.placed).toHaveLength(7);
    // A finished confirmation call changes nothing else.
    await webhook({ id: bolna.exec(7), status: 'completed' });
    expect((await view(id)).order.status).toBe('approved');
    expect(bolna.placed).toHaveLength(7);
  });

  it('ranks a tie the way it bargained: the supplier who quoted that price first is Best', async () => {
    const bolna = fakeBolna();
    const id = await newOrder(2);
    await send(`/api/requests/${id}/start`, { method: 'POST' });
    const quote = async (n: number, price: string) => {
      await tool('save_quote', {
        call_ref: bolna.placed[n - 1]?.user_data.call_ref ?? '',
        price,
        unit: 'kilo',
        supplier_words: `${price} rupaye kilo`,
      });
      await webhook({ id: bolna.exec(n), status: 'completed' });
    };
    await quote(1, '36'); // Supplier 1
    await quote(2, '34'); // Supplier 2: the best offer
    // Round 2: Supplier 1 hears Supplier 2's ₹34 and matches it.
    expect(bolna.placed[2]?.user_data).toMatchObject({ round: '2', best_offer: '₹34 per kilo' });
    await quote(3, '34');

    const done = await view(id);
    const supplier = (quoteId: string | null) =>
      done.suppliers.find((s) => s.id === done.quotes.find((q) => q.id === quoteId)?.supplierId)
        ?.name;
    expect(supplier(done.bestQuoteId)).toBe('Supplier 2');
    expect(supplier(done.ranking[0]?.quoteId ?? null)).toBe('Supplier 2');
  });

  it('refuses a delivery date that has passed, from the screen, the Desk and at start', async () => {
    fakeBolna();
    const id = await newOrder(1);
    const yesterday = inDays(-1);
    const patched = await send(`/api/requests/${id}`, {
      method: 'PATCH',
      json: { deliverBy: yesterday },
    });
    expect(patched.status).toBe(400);
    expect((await patched.json<{ error: string }>()).error).toMatch(/passed/);

    const desk = await (
      await tool('update_order', { request_ref: id, deliver_by: yesterday })
    ).json<{ ok: boolean; message: string }>();
    expect(desk.ok).toBe(false);
    expect(desk.message).toMatch(/passed/);
    expect((await view(id)).order.deliverBy).toBe(SOON);

    // An order saved earlier whose date has since passed cannot start.
    await db.update(requests).set({ deliverBy: yesterday }).where(eq(requests.id, id));
    expect((await view(id)).missing).toContain('a delivery date from today on');
    const start = await send(`/api/requests/${id}/start`, { method: 'POST' });
    expect(start.status).toBe(409);
    expect((await start.json<{ missing: string[] }>()).missing).toContain(
      'a delivery date from today on',
    );
  });

  it('answers 404 for an order that does not exist, and JSON for a body that is not', async () => {
    fakeBolna();
    expect((await send('/api/requests/req_nope/start', { method: 'POST' })).status).toBe(404);
    expect((await send('/api/requests/req_nope/confirm', { method: 'POST' })).status).toBe(404);
    const bad = await send('/api/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: expect.any(String) });
  });

  it('refuses to start until the order and supplier list are complete', async () => {
    fakeBolna();
    const { id } = await (
      await send('/api/requests', { method: 'POST', json: { buyerName: 'Ravi' } })
    ).json<{ id: string }>();
    const res = await send(`/api/requests/${id}/start`, { method: 'POST' });
    expect(res.status).toBe(409);
    expect((await res.json<{ missing: string[] }>()).missing).toContain(
      'at least one supplier on the screen',
    );
  });

  it('skips a supplier Bolna could not dial and moves on', async () => {
    const bolna = fakeBolna();
    const id = await newOrder(2);
    bolna.failNextCall();
    await send(`/api/requests/${id}/start`, { method: 'POST' });
    expect(bolna.placed).toHaveLength(1);
    expect(bolna.placed[0]?.user_data.supplier_name).toBe('Supplier 2');
    const failed = (await view(id)).calls.find((c) => c.status === 'failed');
    expect(failed).toBeDefined();
    const errors = await db
      .select()
      .from(events)
      .where(eq(events.callId, failed?.id ?? ''))
      .all();
    expect(errors.map((e) => e.type)).toContain('error');
  });

  it('never moves a finished call back to live', async () => {
    const bolna = fakeBolna();
    const id = await newOrder(1);
    await send(`/api/requests/${id}/start`, { method: 'POST' });
    await webhook({ id: bolna.exec(1), status: 'completed' });
    await webhook({ id: bolna.exec(1), status: 'ringing' });
    const [call] = (await view(id)).calls;
    expect(call?.status).toBe('completed');
    expect(bolna.placed).toHaveLength(1);
  });

  it("matches a webhook to its call by our call_ref before Bolna's id", async () => {
    const bolna = fakeBolna();
    const id = await newOrder(1);
    await send(`/api/requests/${id}/start`, { method: 'POST' });
    const [call] = (await view(id)).calls;
    // Another call already carries the same Bolna id (e.g. a restarted test server).
    await db
      .update(calls)
      .set({ bolnaExecutionId: 'shared-id' })
      .where(eq(calls.id, call?.id ?? ''));
    await webhook({
      id: 'shared-id',
      status: 'completed',
      context_details: { user_data: { call_ref: call?.id } },
    });
    expect((await view(id)).calls[0]?.status).toBe('completed');
    expect(bolna.placed).toHaveLength(1);
  });

  it('lets the cron finish a call whose webhook never came', async () => {
    const bolna = fakeBolna();
    const id = await newOrder(2);
    await send(`/api/requests/${id}/start`, { method: 'POST' });
    const [first] = (await view(id)).calls;
    await db
      .update(calls)
      .set({ createdAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(calls.id, first?.id ?? ''));
    bolna.executions.set(bolna.exec(1), {
      id: bolna.exec(1),
      status: 'completed',
      transcript: 'polled',
    });
    await sweep(env);
    expect(bolna.placed).toHaveLength(2);
    expect((await view(id)).calls[0]?.transcript).toBe('polled');
  });
});

describe('price memory', () => {
  it("remembers each order's best price per item and shows it on the next order", async () => {
    const bolna = fakeBolna();
    const item = `basmati ${crypto.randomUUID().slice(0, 6)}`;
    const order = async (price: string) => {
      const id = await newOrder(1);
      await send(`/api/requests/${id}`, { method: 'PATCH', json: { item } });
      await send(`/api/requests/${id}/start`, { method: 'POST' });
      const callRef = bolna.placed.at(-1)?.user_data.call_ref ?? '';
      await tool('save_quote', {
        call_ref: callRef,
        price,
        unit: 'kilo',
        supplier_words: `${price} rupaye kilo`,
      });
      await webhook({ id: bolna.exec(bolna.placed.length), status: 'completed' });
      return id;
    };
    const first = await order('82');
    const second = await order('79');

    const history = (await view(second)).history;
    expect(history.map((p) => [p.requestId, p.perUnit])).toEqual([[first, 82]]);

    const series = await (await send('/api/prices')).json<
      Array<{ item: string; unit: string; points: Array<{ perUnit: number }> }>
    >();
    const mine = series.find((s) => s.item === item);
    expect(mine?.unit).toBe('kg');
    expect(mine?.points.map((p) => p.perUnit)).toEqual([82, 79]);
  });

  it('shows only earlier orders as "last time", never a later one', async () => {
    const bolna = fakeBolna();
    const item = `jeera ${crypto.randomUUID().slice(0, 6)}`;
    const order = async (price: string) => {
      const id = await newOrder(1);
      await send(`/api/requests/${id}`, { method: 'PATCH', json: { item } });
      await send(`/api/requests/${id}/start`, { method: 'POST' });
      await tool('save_quote', {
        call_ref: bolna.placed.at(-1)?.user_data.call_ref ?? '',
        price,
        unit: 'kilo',
        supplier_words: `${price} rupaye kilo`,
      });
      await webhook({ id: bolna.exec(bolna.placed.length), status: 'completed' });
      return id;
    };
    const first = await order('400');
    const second = await order('390');
    expect((await view(first)).history).toEqual([]);
    expect((await view(second)).history.map((p) => p.requestId)).toEqual([first]);
  });

  it("uses the same best quote as the results page, not a late one that couldn't win", async () => {
    const bolna = fakeBolna();
    const item = `ajwain ${crypto.randomUUID().slice(0, 6)}`;
    const id = await newOrder(2);
    await send(`/api/requests/${id}`, { method: 'PATCH', json: { item } });
    await send(`/api/requests/${id}/start`, { method: 'POST' });
    // Supplier 1 is cheaper but delivers after the order's date, so it cannot win.
    await tool('save_quote', {
      call_ref: bolna.placed[0]?.user_data.call_ref ?? '',
      price: '200',
      unit: 'kilo',
      supplier_words: '200 rupaye kilo',
      delivery_date: inDays(30),
    });
    await webhook({ id: bolna.exec(1), status: 'completed' });
    await tool('save_quote', {
      call_ref: bolna.placed[1]?.user_data.call_ref ?? '',
      price: '240',
      unit: 'kilo',
      supplier_words: '240 rupaye kilo',
    });
    await webhook({ id: bolna.exec(2), status: 'completed' });

    const done = await view(id);
    expect(done.quotes.find((q) => q.id === done.bestQuoteId)?.price).toBe(240);
    const series = await (await send('/api/prices')).json<
      Array<{ item: string; points: Array<{ perUnit: number }> }>
    >();
    expect(series.find((s) => s.item === item)?.points.map((p) => p.perUnit)).toEqual([240]);
  });

  it('never counts practice orders', async () => {
    fakeBolna();
    const res = await send('/api/web-session', {
      method: 'POST',
      json: { kind: 'practice', personaId: 'rice' },
    });
    expect(res.status).toBe(200);
    const series = await (await send('/api/prices')).json<Array<{ item: string }>>();
    expect(series.some((s) => s.item === 'basmati rice')).toBe(false);
  });
});

describe('languages', () => {
  it("starts a Kannada supplier's call in Kannada", async () => {
    const bolna = fakeBolna();
    const { id } = await (
      await send('/api/requests', { method: 'POST', json: { buyerName: 'Ravi' } })
    ).json<{ id: string }>();
    await send(`/api/requests/${id}`, {
      method: 'PATCH',
      json: { item: 'tomatoes', quantity: 20, unit: 'kg', deliverBy: SOON },
    });
    const phone = `9${String(Date.now()).slice(-9)}`;
    const added = await send(`/api/requests/${id}/suppliers`, {
      method: 'POST',
      json: { name: 'Kannada Mandi', phone, language: 'kn', consentNote: 'agreed' },
    });
    expect(added.status).toBe(201);
    await send(`/api/requests/${id}/start`, { method: 'POST' });
    expect(bolna.placed[0]?.user_data).toMatchObject({ language: 'Kannada', agent_language: 'kn' });
  });
});

describe('Bolna tools', () => {
  it('saves the order fields Bolna filled and ignores the unfilled ones', async () => {
    fakeBolna();
    const { id } = await (
      await send('/api/requests', { method: 'POST', json: { buyerName: 'Ravi' } })
    ).json<{ id: string }>();
    const res = await tool('update_order', {
      request_ref: id,
      item: 'cooking oil',
      quantity: '60.000000',
      unit: 'litres',
      quality: '%(quality)s',
      deliver_by: SOON,
      area: 'None',
    });
    const body = await res.json<{ ok: boolean; message: string }>();
    expect(body.ok).toBe(true);
    const order = (await view(id)).order;
    expect(order).toMatchObject({
      item: 'cooking oil',
      quantity: 60,
      unit: 'litre',
      deliverBy: SOON,
      quality: null,
      area: null,
    });
  });

  it('explains a bad unit or date instead of saving it', async () => {
    fakeBolna();
    const { id } = await (
      await send('/api/requests', { method: 'POST', json: { buyerName: 'Ravi' } })
    ).json<{ id: string }>();
    const body = await (
      await tool('update_order', { request_ref: id, unit: 'handful', deliver_by: 'Friday' })
    ).json<{ ok: boolean; message: string }>();
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/handful/);
    expect(body.message).toMatch(/YYYY-MM-DD/);
  });

  it('accepts the Bearer scheme in any case, but never a wrong secret', async () => {
    const lower = await send('/tools/save_quote', {
      method: 'POST',
      headers: { authorization: 'bearer test-tool-secret' },
      json: { call_ref: 'call_unknown' },
    });
    expect(lower.status).toBe(200);
    const wrong = await send('/tools/save_quote', {
      method: 'POST',
      headers: { authorization: 'Bearer test-tool-secreT' },
      json: { call_ref: 'call_unknown' },
    });
    expect(wrong.status).toBe(401);
  });

  it('refuses a tool call without the secret', async () => {
    const res = await send('/tools/save_quote', { method: 'POST', json: { call_ref: 'x' } });
    expect(res.status).toBe(401);
  });

  it('stops calling a number on every order once its owner says so', async () => {
    const bolna = fakeBolna();
    const id = await newOrder(1);
    await send(`/api/requests/${id}/start`, { method: 'POST' });
    const callRef = bolna.placed[0]?.user_data.call_ref ?? '';
    await tool('do_not_call', { call_ref: callRef });
    const phone = bolna.placed[0]?.recipient_phone_number ?? '';

    const other = await (
      await send('/api/requests', { method: 'POST', json: { buyerName: 'Ravi' } })
    ).json<{ id: string }>();
    const again = await send(`/api/requests/${other.id}/suppliers`, {
      method: 'POST',
      json: { name: 'Same person', phone, consentNote: 'agreed' },
    });
    expect(again.status).toBe(409);
  });
});

describe('webhook and LLM endpoints', () => {
  it('hides the webhook behind its secret', async () => {
    const res = await send('/webhooks/bolna/wrong', {
      method: 'POST',
      json: { id: 'x', status: 'completed' },
    });
    expect(res.status).toBe(404);
  });

  it('lists the model only with the LLM secret', async () => {
    expect((await send('/v1/models')).status).toBe(401);
    const res = await send('/v1/models', { headers: { authorization: 'Bearer test-secret' } });
    expect(await res.json()).toMatchObject({ data: [{ id: 'bhaav-llm' }] });
  });
});

describe('practice mode', () => {
  it('sets up a labelled practice order with pretend quotes and a round-2 call', async () => {
    const bolna = fakeBolna();
    const res = await send('/api/web-session', {
      method: 'POST',
      json: { kind: 'practice', personaId: 'onions' },
    });
    expect(res.status).toBe(200);
    const { callId, requestId, session } = await res.json<{
      callId: string;
      requestId: string;
      session: { run_id: string };
    }>();
    expect(session.run_id).toBe(bolna.runId);

    const practice = await view(requestId);
    expect(practice.order.isPractice).toBe(true);
    expect(practice.quotes.map((q) => q.price).sort()).toEqual([31, 33]);
    const call = practice.calls.find((c) => c.id === callId);
    expect(call).toMatchObject({ round: 2, channel: 'web', bestOfferSaid: '₹31 per kilo' });

    const allowed = await allowedNumbersFor(db, callId);
    for (const n of [31, 33, 50]) expect(allowed).toContain(n);

    bolna.executions.set(bolna.runId, {
      id: bolna.runId,
      status: 'completed',
      transcript: 'assistant: Namaste ji',
    });
    const review = await (await send(`/api/practice/${callId}`)).json<{
      transcript: string;
      bestOffer: string;
    }>();
    expect(review).toMatchObject({
      transcript: 'assistant: Namaste ji',
      bestOffer: '₹31 per kilo',
    });
  });

  it('marks the practice call failed when Bolna will not start it', async () => {
    const bolna = fakeBolna();
    bolna.failNextMint();
    const res = await send('/api/web-session', {
      method: 'POST',
      json: { kind: 'practice', personaId: 'oil' },
    });
    expect(res.status).toBe(502);
    const newest = await db.select().from(calls).where(eq(calls.channel, 'web')).all();
    const practiceCall = newest
      .filter((c) => c.round === 2)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    expect(practiceCall?.status).toBe('failed');
  });

  it('mints a Desk session for an order', async () => {
    fakeBolna();
    const { id } = await (
      await send('/api/requests', { method: 'POST', json: { buyerName: 'Ravi' } })
    ).json<{ id: string }>();
    const res = await send('/api/web-session', {
      method: 'POST',
      json: { kind: 'desk', requestId: id },
    });
    expect(res.status).toBe(200);
    const fetchSpy = vi.mocked(globalThis.fetch);
    const [, init] = fetchSpy.mock.calls.at(-1) ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      agent_id: 'agent-desk',
      user_data: { request_ref: id, buyer_name: 'Ravi' },
    });
  });
});
