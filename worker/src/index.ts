// The Bhaav Worker: one Hono app for the screens' API, Bolna's custom LLM, tools and webhook,
// plus a cron that catches calls whose webhook never arrived. The built web app is served from
// the same Worker as static assets.

import { LANGUAGES } from '@bhaav/shared';
import { zValidator } from '@hono/zod-validator';
import { and, eq, gte, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { type Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import {
  endSession,
  hasSession,
  requireBearer,
  requireSession,
  safeEqual,
  startSession,
} from './auth';
import { type Execution, findCallRef, getExecution, mintWebSession } from './bolna';
import { allowedNumbersFor, type Db, recordEvent } from './db/context';
import { calls, events, loginAttempts, quotes, requests, suppliers, turns } from './db/schema';
import {
  advance,
  advanceWaiting,
  applyExecution,
  callerUserData,
  confirmChoice,
  diallerEnv,
  failOrphanedCalls,
  giveUpOnStuckCalls,
  inCallHours,
  mayCall,
  parseAllowlist,
  staleCalls,
  waitingReason,
} from './dialler';
import { newId } from './ids';
import { type CatcherDeps, type ChatRequest, catchLies, readCompletion } from './llm';
import {
  approveQuote,
  isPastDate,
  normalizeDate,
  normalizePhone,
  normalizeUnit,
  orderView,
} from './orders';
import { approveByVoice, callOwnerToOrder, deskUserData, ownerEnv, ownerResultsDue } from './owner';
import {
  createPractice,
  PERSONAS,
  personaCards,
  WEB_CALLS_PER_HOUR,
  webCallsLastHour,
} from './practice';
import { historyFor, priceSeries } from './prices';
import { breakStats, proofStats } from './proof';
import { listSchedules, pauseSchedule, repeatOrder, runSchedules, setSchedule } from './schedule';
import { createSimulation, simulationStep } from './simulate';
import { callBackLater, doNotCall, type Params, saveQuote, startOrder, updateOrder } from './tools';

type Env = { Bindings: Cloudflare.Env };
const dbOf = (c: Context<Env>): Db => drizzle(c.env.DB);

/** The lie-catcher's settings for one request: Groq, its models, and the database. */
function catcherDeps(c: Context<Env>, db: Db): CatcherDeps {
  return {
    upstream: (body, signal) =>
      fetch(`${c.env.GROQ_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${c.env.GROQ_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      }),
    models: c.env.GROQ_MODELS.split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    allowedFor: (ref) => allowedNumbersFor(db, ref),
    record: (event) => recordEvent(db, event),
    waitUntil: (promise) => c.executionCtx.waitUntil(promise),
  };
}

/** An order for the screens, with why it is waiting (calling hours, another call, a retry). */
async function viewOf(c: Context<Env>, db: Db, id: string) {
  const view = await orderView(db, id);
  if (!view) return null;
  const dialler = diallerEnv(c.env);
  view.waitingFor = await waitingReason(dialler, db, view.order, view.calls);
  view.callHours = dialler.callHours;
  return view;
}

/** Wrong passcodes allowed per address, and from everyone together, in each window. */
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_TRIES_PER_ADDRESS = 5;
const LOGIN_TRIES_IN_ALL = 500;

/** A salted hash of the caller's address: enough to count tries, useless for finding anyone. */
async function addressHash(c: Context<Env>): Promise<string> {
  const address = c.req.header('cf-connecting-ip') ?? 'unknown';
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${c.env.COOKIE_SECRET}|${address}`),
  );
  return [...new Uint8Array(bytes).slice(0, 12)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Bolna's webhook addresses (BOLNA_WEBHOOK_IPS); "*" or empty accepts any. */
function webhookFromBolna(c: Context<Env>): boolean {
  const allowed = (c.env.BOLNA_WEBHOOK_IPS ?? '')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
  if (allowed.length === 0 || allowed.includes('*')) return true;
  return allowed.includes(c.req.header('cf-connecting-ip') ?? '');
}

/** Turns a failed zod check into a plain 400 the screens can show. */
const json = <T extends z.ZodType>(schema: T) =>
  zValidator('json', schema, (result, c) => {
    if (!result.success) {
      const first = result.error.issues[0];
      return c.json(
        {
          error: first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request.',
        },
        400,
      );
    }
  });

const app = new Hono<Env>();

// The pages get the same headers from web/public/_headers. Bolna's server-to-server calls ignore them.
app.use('*', secureHeaders({ crossOriginResourcePolicy: 'same-origin' }));

// Every error answers in JSON, so the screens can always show a sentence (malformed JSON included).
app.onError((error, c) => {
  if (error instanceof HTTPException)
    return c.json({ error: error.message || 'That request could not be read.' }, error.status);
  console.error(error);
  return c.json({ error: 'Something went wrong on our side. Please try again.' }, 500);
});

app.get('/api/health', (c) => c.json({ ok: true }));

// ---- Passcode session -------------------------------------------------------------------

app.get('/api/auth', async (c) => c.json({ authenticated: await hasSession(c) }));

app.post('/api/auth', json(z.object({ passcode: z.string().max(200) })), async (c) => {
  if (!c.env.APP_PASSCODE || !c.env.COOKIE_SECRET) {
    return c.json(
      { error: 'The app has no passcode yet: set APP_PASSCODE and COOKIE_SECRET.' },
      503,
    );
  }
  // Guessing is slowed down: a few wrong tries per address, and a ceiling for everyone together,
  // in each 15 minutes. While either is reached, even the right passcode waits.
  const db = dbOf(c);
  const ipHash = await addressHash(c);
  const recent = await db
    .select({ ipHash: loginAttempts.ipHash })
    .from(loginAttempts)
    .where(gte(loginAttempts.createdAt, new Date(Date.now() - LOGIN_WINDOW_MS)))
    .all();
  if (
    recent.filter((r) => r.ipHash === ipHash).length >= LOGIN_TRIES_PER_ADDRESS ||
    recent.length >= LOGIN_TRIES_IN_ALL
  ) {
    return c.json({ error: 'Too many wrong passcodes. Try again in 15 minutes.' }, 429);
  }
  if (!safeEqual(c.req.valid('json').passcode.trim(), c.env.APP_PASSCODE)) {
    await db.insert(loginAttempts).values({ id: newId('evt'), ipHash });
    return c.json({ error: 'That passcode is not right.' }, 401);
  }
  await startSession(c);
  return c.json({ authenticated: true });
});

app.delete('/api/auth', (c) => {
  endSession(c);
  return c.json({ authenticated: false });
});

// ---- The screens' API (passcode session required) ---------------------------------------

const api = new Hono<Env>();
api.use('*', requireSession);

api.post(
  '/requests',
  json(z.object({ buyerName: z.string().trim().min(1).max(80) })),
  async (c) => {
    const id = newId('req');
    await dbOf(c)
      .insert(requests)
      .values({ id, buyerName: c.req.valid('json').buyerName });
    return c.json({ id }, 201);
  },
);

api.get('/requests/:id', async (c) => {
  const view = await viewOf(c, dbOf(c), c.req.param('id'));
  return view ? c.json(view) : c.json({ error: 'No such order.' }, 404);
});

/** Edits are allowed only before calls start. */
async function draftOr409(c: Context<Env>, db: Db, id: string) {
  const request = await db.select().from(requests).where(eq(requests.id, id)).get();
  if (!request) return c.json({ error: 'No such order.' }, 404);
  if (request.status !== 'draft')
    return c.json({ error: 'Calls have started; the order can no longer change.' }, 409);
  return null;
}

api.patch(
  '/requests/:id',
  json(
    z.object({
      buyerName: z.string().trim().min(1).max(80).optional(),
      item: z.string().trim().max(120).nullable().optional(),
      quantity: z.number().positive().max(1_000_000).nullable().optional(),
      unit: z.string().nullable().optional(),
      quality: z.string().trim().max(120).nullable().optional(),
      deliverBy: z.string().nullable().optional(),
      area: z.string().trim().max(120).nullable().optional(),
    }),
  ),
  async (c) => {
    const db = dbOf(c);
    const id = c.req.param('id');
    const blocked = await draftOr409(c, db, id);
    if (blocked) return blocked;
    const body = c.req.valid('json');
    const patch: Partial<typeof requests.$inferInsert> = {};
    if (body.buyerName !== undefined) patch.buyerName = body.buyerName;
    if (body.item !== undefined) patch.item = body.item || null;
    if (body.quantity !== undefined) patch.quantity = body.quantity;
    if (body.quality !== undefined) patch.quality = body.quality || null;
    if (body.area !== undefined) patch.area = body.area || null;
    if (body.unit !== undefined) {
      const unit = body.unit === null ? null : normalizeUnit(body.unit);
      if (body.unit !== null && !unit)
        return c.json({ error: `"${body.unit}" is not a unit Bhaav knows.` }, 400);
      patch.unit = unit;
    }
    if (body.deliverBy !== undefined) {
      const date = body.deliverBy === null ? null : normalizeDate(body.deliverBy);
      if (body.deliverBy !== null && !date)
        return c.json({ error: 'Give the delivery date as YYYY-MM-DD.' }, 400);
      if (date && isPastDate(date))
        return c.json({ error: 'That date has passed. Pick today or a later date.' }, 400);
      patch.deliverBy = date;
    }
    if (Object.keys(patch).length > 0)
      await db.update(requests).set(patch).where(eq(requests.id, id));
    return c.json(await viewOf(c, db, id));
  },
);

api.post(
  '/requests/:id/suppliers',
  json(
    z.object({
      name: z.string().trim().min(1).max(80),
      phone: z.string().trim().min(6).max(20),
      language: z.enum(LANGUAGES).default('hi'),
      consentNote: z.string().trim().min(1, 'Note how the supplier agreed to be called.').max(200),
    }),
  ),
  async (c) => {
    const db = dbOf(c);
    const id = c.req.param('id');
    const blocked = await draftOr409(c, db, id);
    if (blocked) return blocked;
    const body = c.req.valid('json');
    const phone = normalizePhone(body.phone);
    if (!phone)
      return c.json(
        { error: 'Use a 10-digit Indian mobile number, or +country code and number.' },
        400,
      );
    // Only numbers on the approved list, and none at all until the owner makes one: the
    // passcode is shared with judges, so it must never let anyone dial a stranger.
    const allowlist = parseAllowlist(c.env.SUPPLIER_ALLOWLIST);
    if (!mayCall(allowlist, phone)) {
      return c.json(
        {
          error:
            allowlist !== 'any' && allowlist.size === 0
              ? 'No numbers are approved for calls yet. The owner adds them in SUPPLIER_ALLOWLIST.'
              : 'Bhaav may only call numbers on its approved list. Ask the owner to add this one.',
        },
        403,
      );
    }
    const existing = await db.select().from(suppliers).where(eq(suppliers.requestId, id)).all();
    if (existing.some((s) => s.phone === phone))
      return c.json({ error: 'That number is already on the list.' }, 409);
    const refused = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.phone, phone), eq(suppliers.doNotCall, true)))
      .get();
    if (refused) return c.json({ error: 'This number asked Bhaav never to call again.' }, 409);
    await db.insert(suppliers).values({
      id: newId('sup'),
      requestId: id,
      name: body.name,
      phone,
      language: body.language,
      consentNote: body.consentNote,
    });
    return c.json(await viewOf(c, db, id), 201);
  },
);

api.delete('/requests/:id/suppliers/:supplierId', async (c) => {
  const db = dbOf(c);
  const id = c.req.param('id');
  const blocked = await draftOr409(c, db, id);
  if (blocked) return blocked;
  await db
    .delete(suppliers)
    .where(and(eq(suppliers.id, c.req.param('supplierId')), eq(suppliers.requestId, id)));
  return c.json(await viewOf(c, db, id));
});

api.post('/requests/:id/start', async (c) => {
  const db = dbOf(c);
  const id = c.req.param('id');
  const result = await startOrder(db, id, c.env.BOLNA_CALLER_AGENT_ID);
  if (!result.ok)
    return c.json(
      { error: result.message, missing: result.missing ?? [] },
      result.notFound ? 404 : 409,
    );
  const step = await advance(diallerEnv(c.env), db, id);
  return c.json({ step, view: await viewOf(c, db, id) });
});

api.post('/requests/:id/approve', json(z.object({ quoteId: z.string() })), async (c) => {
  const db = dbOf(c);
  const id = c.req.param('id');
  const result = await approveQuote(db, id, c.req.valid('json').quoteId, 'screen');
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(await viewOf(c, db, id));
});

// Round 3, only when the buyer presses it: Bhaav tells the chosen supplier.
api.post('/requests/:id/confirm', async (c) => {
  const db = dbOf(c);
  const id = c.req.param('id');
  const result = await confirmChoice(diallerEnv(c.env), db, id);
  if (!result.ok) return c.json({ error: result.message }, result.notFound ? 404 : 409);
  return c.json({ message: result.message, view: await viewOf(c, db, id) });
});

// Price memory: each item's best price per past order.
api.get('/prices', async (c) => c.json(await priceSeries(dbOf(c))));

// One order's "last time" prices. Asked for once by the results page, never polled.
api.get('/requests/:id/history', async (c) => {
  const db = dbOf(c);
  const request = await db
    .select()
    .from(requests)
    .where(eq(requests.id, c.req.param('id')))
    .get();
  if (!request) return c.json({ error: 'No such order.' }, 404);
  return c.json(request.isPractice || request.isSimulation ? [] : await historyFor(db, request));
});

api.post(
  '/web-session',
  json(
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('desk'), requestId: z.string() }),
      z.object({ kind: z.literal('practice'), personaId: z.string() }),
    ]),
  ),
  async (c) => {
    const db = dbOf(c);
    const body = c.req.valid('json');
    const bolna = { apiKey: c.env.BOLNA_API_KEY, baseUrl: c.env.BOLNA_BASE_URL };
    // Set once a practice call is saved, so a failed start can mark it failed, not leave it queued.
    let practiceCallId: string | null = null;
    // Browser calls spend Bolna's credit like phone calls, and the passcode is shared with
    // judges, so Desk and practice calls share one hourly ceiling.
    const busy = () =>
      c.json(
        {
          error: `Browser calls are busy right now (at most ${WEB_CALLS_PER_HOUR} an hour). Try again in a few minutes.`,
        },
        429,
      );
    try {
      if (body.kind === 'desk') {
        if (!c.env.BOLNA_DESK_AGENT_ID)
          return c.json({ error: 'The Desk agent is not set up (BOLNA_DESK_AGENT_ID).' }, 503);
        const request = await db
          .select()
          .from(requests)
          .where(eq(requests.id, body.requestId))
          .get();
        if (!request) return c.json({ error: 'No such order.' }, 404);
        if ((await webCallsLastHour(db)) >= WEB_CALLS_PER_HOUR) return busy();
        const session = await mintWebSession(bolna, {
          agentId: c.env.BOLNA_DESK_AGENT_ID,
          userData: deskUserData(request),
        });
        await db.insert(events).values({
          id: newId('evt'),
          requestId: request.id,
          type: 'desk_started',
          detail: {},
        });
        return c.json({ session });
      }

      // A practice call runs on its own agent, which Bolna cuts off at 2 minutes; without one
      // it falls back to the Caller (4 minutes) and only the browser's timer stops it at 2.
      const practiceAgent = c.env.BOLNA_PRACTICE_AGENT_ID || c.env.BOLNA_CALLER_AGENT_ID;
      if (!practiceAgent)
        return c.json({ error: 'The Caller agent is not set up (BOLNA_CALLER_AGENT_ID).' }, 503);
      const persona = PERSONAS.find((p) => p.id === body.personaId);
      if (!persona) return c.json({ error: 'No such practice supplier.' }, 404);
      if ((await webCallsLastHour(db)) >= WEB_CALLS_PER_HOUR) return busy();
      const practice = await createPractice(db, persona);
      practiceCallId = practice.call.id;
      const session = await mintWebSession(bolna, {
        agentId: practiceAgent,
        userData: callerUserData(
          practice.request,
          practice.supplier,
          practice.call,
          practice.bestText,
        ),
      });
      if (typeof session.run_id === 'string') {
        await db
          .update(calls)
          .set({ bolnaExecutionId: session.run_id })
          .where(eq(calls.id, practice.call.id));
      }
      return c.json({ session, requestId: practice.request.id, callId: practice.call.id });
    } catch (error) {
      if (practiceCallId) {
        await db
          .update(calls)
          .set({ status: 'failed', endedAt: new Date() })
          .where(eq(calls.id, practiceCallId));
      }
      return c.json(
        { error: 'Bolna would not start the browser call.', detail: String(error) },
        502,
      );
    }
  },
);

// ---- The owner line: Bhaav phones the owner -------------------------------------------

/** The owner's number and whether to call them with the result; allowed at any stage. */
api.post(
  '/requests/:id/owner',
  json(
    z.object({
      buyerPhone: z.string().trim().max(20).nullable().optional(),
      ownerUpdates: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const db = dbOf(c);
    const id = c.req.param('id');
    const request = await db.select().from(requests).where(eq(requests.id, id)).get();
    if (!request) return c.json({ error: 'No such order.' }, 404);
    if (request.isPractice || request.isSimulation)
      return c.json({ error: 'Practice and simulated orders never call anyone.' }, 400);
    const body = c.req.valid('json');
    const patch: Partial<typeof requests.$inferInsert> = {};
    if (body.buyerPhone !== undefined) {
      if (body.buyerPhone === null || body.buyerPhone === '') patch.buyerPhone = null;
      else {
        const phone = normalizePhone(body.buyerPhone);
        if (!phone)
          return c.json({ error: 'Use a 10-digit Indian mobile number, or +country code.' }, 400);
        // The owner is called like a supplier, so the same approved list guards it.
        if (!mayCall(parseAllowlist(c.env.SUPPLIER_ALLOWLIST), phone))
          return c.json(
            {
              error:
                'Bhaav may only call numbers on its approved list. Add yours to SUPPLIER_ALLOWLIST.',
            },
            403,
          );
        patch.buyerPhone = phone;
      }
    }
    if (body.ownerUpdates !== undefined) patch.ownerUpdates = body.ownerUpdates;
    if (Object.keys(patch).length > 0)
      await db.update(requests).set(patch).where(eq(requests.id, id));
    return c.json(await viewOf(c, db, id));
  },
);

// "Call me": Bhaav phones the owner to take the order by voice.
api.post('/requests/:id/call-me', async (c) => {
  const db = dbOf(c);
  const id = c.req.param('id');
  const result = await callOwnerToOrder(ownerEnv(c.env), db, id);
  if (!result.ok) return c.json({ error: result.message }, 409);
  return c.json({ message: result.message, view: await viewOf(c, db, id) });
});

// ---- Repeat orders and weekly orders -----------------------------------------------------

api.post('/requests/:id/repeat', async (c) => {
  const result = await repeatOrder(dbOf(c), c.req.param('id'));
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ id: result.id }, 201);
});

api.post(
  '/requests/:id/schedule',
  json(
    z.object({
      weekday: z.number().int().min(0).max(6),
      hour: z.number().int().min(0).max(23),
      callOwnerFirst: z.boolean().default(false),
    }),
  ),
  async (c) => {
    const db = dbOf(c);
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const { from, to } = diallerEnv(c.env).callHours;
    if (body.hour < from || body.hour >= to)
      return c.json(
        { error: `Pick an hour between ${from}:00 and ${to - 1}:00, when suppliers are called.` },
        400,
      );
    if (body.callOwnerFirst) {
      const request = await db.select().from(requests).where(eq(requests.id, id)).get();
      if (!request?.buyerPhone)
        return c.json(
          { error: 'Add your mobile number on the order first, so Bhaav can call you.' },
          400,
        );
    }
    const schedule = await setSchedule(db, id, body);
    if (!schedule) return c.json({ error: 'Only a real order can repeat every week.' }, 400);
    return c.json(await viewOf(c, db, id));
  },
);

api.get('/schedules', async (c) => c.json(await listSchedules(dbOf(c))));

api.post('/schedules/:id/active', json(z.object({ active: z.boolean() })), async (c) => {
  const done = await pauseSchedule(dbOf(c), c.req.param('id'), c.req.valid('json').active);
  return done ? c.json({ ok: true }) : c.json({ error: 'No such weekly order.' }, 404);
});

// ---- Proof, Break Bhaav and the simulation ------------------------------------------------

api.get('/proof', async (c) => c.json(await proofStats(dbOf(c))));
api.get('/break-bhaav', async (c) => c.json(await breakStats(dbOf(c))));

api.post('/simulations', async (c) => {
  const result = await createSimulation(dbOf(c));
  if (!result.ok) return c.json({ error: result.error, id: result.id ?? null }, result.status);
  return c.json({ id: result.id }, 201);
});

// One step: start the next call, play one exchange, or end a call. The browser repeats it.
api.post('/simulations/:id/step', async (c) => {
  const db = dbOf(c);
  const id = c.req.param('id');
  const deps = catcherDeps(c, db);
  const step = await simulationStep(
    {
      chat: async (req) => {
        // The turn is written before the step answers, so the screen shows it at once.
        const pending: Promise<unknown>[] = [];
        const res = await catchLies(req, { ...deps, waitUntil: (p) => pending.push(p) });
        const reply = await readCompletion(res);
        await Promise.all(pending);
        return reply;
      },
    },
    db,
    id,
  );
  if (step === 'not-a-simulation') return c.json({ error: 'No such simulation.' }, 404);
  return c.json({ step, view: await viewOf(c, db, id) });
});

api.get('/practice/personas', (c) => c.json(personaCards()));

/** After a practice call: what Bhaav said, what it saved, and anything the lie-catcher stopped. */
api.get('/practice/:callId', async (c) => {
  const db = dbOf(c);
  let call = await db
    .select()
    .from(calls)
    .where(eq(calls.id, c.req.param('callId')))
    .get();
  if (call?.channel !== 'web') return c.json({ error: 'No such practice call.' }, 404);
  if (!call.transcript && call.bolnaExecutionId && c.env.BOLNA_API_KEY) {
    try {
      const execution = await getExecution(
        { apiKey: c.env.BOLNA_API_KEY, baseUrl: c.env.BOLNA_BASE_URL },
        call.bolnaExecutionId,
      );
      await applyExecution(db, execution, call.id);
      call = (await db.select().from(calls).where(eq(calls.id, call.id)).get()) ?? call;
    } catch {
      // The transcript can lag the call by a few seconds; the screen polls again.
    }
  }
  const [callEvents, saved, said] = await Promise.all([
    db.select().from(events).where(eq(events.callId, call.id)).all(),
    db.select().from(quotes).where(eq(quotes.callId, call.id)).all(),
    db.select().from(turns).where(eq(turns.callId, call.id)).orderBy(turns.createdAt).all(),
  ]);
  return c.json({
    callId: call.id,
    status: call.status,
    bestOffer: call.bestOfferSaid,
    transcript: call.transcript,
    // Turn by turn as the lie-catcher saw it: there as the call happens, before Bolna's transcript.
    turns: said.map((t) => ({
      id: t.id,
      callId: t.callId,
      heard: t.heard,
      said: t.said,
      stopped: t.stopped,
      numbers: t.numbers,
      thinkMs: t.thinkMs,
      createdAt: t.createdAt.getTime(),
    })),
    blocked: callEvents
      .filter((e) => e.type === 'blocked' || e.type === 'tool_blocked')
      .map((e) => ({ type: e.type, detail: e.detail, createdAt: e.createdAt.getTime() })),
    quotes: saved.map((q) => ({
      price: q.price,
      unit: q.unit,
      packSize: q.packSize,
      supplierWords: q.supplierWords,
    })),
  });
});

app.route('/api', api);

// ---- Bolna: custom LLM ------------------------------------------------------------------

const llmAuth = requireBearer((env) => env.LLM_SECRET);

// Bolna lists models when the custom LLM is saved, to check the key and the model name.
app.get('/v1/models', llmAuth, (c) =>
  c.json({ object: 'list', data: [{ id: 'bhaav-llm', object: 'model', owned_by: 'bhaav' }] }),
);

const chatRequest = z.looseObject({
  model: z.string().optional(),
  stream: z.boolean().optional(),
  messages: z.array(z.looseObject({ role: z.string(), content: z.unknown().optional() })).min(1),
});

app.post('/v1/chat/completions', llmAuth, json(chatRequest), (c) =>
  catchLies(c.req.valid('json') as ChatRequest, catcherDeps(c, dbOf(c))),
);

// ---- Bolna: custom functions ------------------------------------------------------------

const tools = new Hono<Env>();
tools.use(
  '*',
  requireBearer((env) => env.TOOL_SECRET),
);

/** Bolna may send parameters as a JSON body or a query string. */
async function paramsOf(c: Context<Env>): Promise<Params> {
  const body = await c.req.json<Params>().catch(() => ({}));
  return { ...c.req.query(), ...(body && typeof body === 'object' ? body : {}) };
}

tools.on(['GET', 'POST'], '/update_order', async (c) =>
  c.json(await updateOrder(dbOf(c), await paramsOf(c))),
);
tools.on(['GET', 'POST'], '/save_quote', async (c) =>
  c.json(await saveQuote(dbOf(c), await paramsOf(c))),
);
tools.on(['GET', 'POST'], '/do_not_call', async (c) =>
  c.json(await doNotCall(dbOf(c), await paramsOf(c))),
);
tools.on(['GET', 'POST'], '/call_back_later', async (c) =>
  c.json(await callBackLater(dbOf(c), await paramsOf(c), diallerEnv(c.env).callHours)),
);
// The owner line: the owner's spoken, read-back choice becomes the approval.
tools.on(['GET', 'POST'], '/approve_quote', async (c) =>
  c.json(await approveByVoice(ownerEnv(c.env), dbOf(c), await paramsOf(c))),
);
tools.on(['GET', 'POST'], '/start_calls', async (c) => {
  const db = dbOf(c);
  const params = await paramsOf(c);
  const requestId = typeof params.request_ref === 'string' ? params.request_ref : '';
  const result = await startOrder(db, requestId, c.env.BOLNA_CALLER_AGENT_ID);
  if (!result.ok) return c.json(result);
  const dialler = diallerEnv(c.env);
  c.executionCtx.waitUntil(advance(dialler, db, requestId));
  // So the Desk can tell the buyer, rather than leave them waiting for a call that won't come yet.
  if (!inCallHours(dialler.callHours)) {
    const { from, to } = dialler.callHours;
    result.message += ` Suppliers are called only between ${from}:00 and ${to}:00 India time, so the first call waits until ${from}:00.`;
  }
  return c.json(result);
});

app.route('/tools', tools);

// ---- Bolna: webhook ---------------------------------------------------------------------

app.post('/webhooks/bolna/:secret', async (c) => {
  if (!c.env.WEBHOOK_SECRET || !safeEqual(c.req.param('secret'), c.env.WEBHOOK_SECRET))
    return c.notFound();
  if (!webhookFromBolna(c)) {
    // Logged so `wrangler tail` shows it if Bolna ever sends from a new address; the cron still
    // reads every call's status from Bolna, so nothing is lost, only a minute.
    console.warn(`webhook refused from ${c.req.header('cf-connecting-ip') ?? 'no address'}`);
    return c.notFound();
  }
  const execution = await c.req.json<Execution>().catch(() => null);
  if (!execution || typeof execution.status !== 'string') return c.json({ ok: true });
  const db = dbOf(c);
  const finished = await applyExecution(db, execution, findCallRef(execution.context_details));
  // The line is free: this order's next call, then any order waiting for it, then any owner
  // waiting to hear a finished order's result.
  if (finished?.channel === 'phone')
    c.executionCtx.waitUntil(
      advanceWaiting(diallerEnv(c.env), db, finished.requestId).then(() =>
        ownerResultsDue(ownerEnv(c.env), db),
      ),
    );
  return c.json({ ok: true });
});

// ---- Cron: catch up on lost webhooks ----------------------------------------------------

/** How long a login attempt is kept: long enough to count, then deleted. */
const LOGIN_ATTEMPTS_KEPT_MS = 24 * 60 * 60_000;

export async function sweep(env: Cloudflare.Env): Promise<void> {
  const db = drizzle(env.DB);
  const dialler = diallerEnv(env);
  if (env.BOLNA_API_KEY) {
    for (const call of await staleCalls(db, 3 * 60_000)) {
      try {
        const execution = await getExecution(dialler.bolna, call.bolnaExecutionId ?? '');
        await applyExecution(db, execution, call.id);
      } catch {
        // Try again next minute.
      }
    }
  }
  await failOrphanedCalls(db, 5 * 60_000);
  await giveUpOnStuckCalls(db);
  // This week's orders from weekly schedules, then every order with no live call takes its next
  // step (after a lost webhook, a retry's minute, a callback's time, the start of calling hours,
  // or another order's call ending), then owners hear finished results.
  await runSchedules(dialler, ownerEnv(env), db).catch(() => undefined);
  await advanceWaiting(dialler, db);
  await ownerResultsDue(ownerEnv(env), db).catch(() => undefined);
  await db
    .delete(loginAttempts)
    .where(lt(loginAttempts.createdAt, new Date(Date.now() - LOGIN_ATTEMPTS_KEPT_MS)));
}

export default {
  fetch: app.fetch,
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(sweep(env));
  },
} satisfies ExportedHandler<Cloudflare.Env>;
