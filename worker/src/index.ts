// The Bhaav Worker: one Hono app for the screens' API, Bolna's custom LLM, tools and webhook,
// plus a cron that catches calls whose webhook never arrived. The built web app is served from
// the same Worker as static assets.

import { LANGUAGES } from '@bhaav/shared';
import { zValidator } from '@hono/zod-validator';
import { and, eq } from 'drizzle-orm';
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
import { calls, events, quotes, requests, suppliers } from './db/schema';
import {
  advance,
  applyExecution,
  callerUserData,
  confirmChoice,
  diallerEnv,
  failOrphanedCalls,
  parseAllowlist,
  staleCalls,
  stalledRequests,
} from './dialler';
import { newId } from './ids';
import { type ChatRequest, catchLies } from './llm';
import { isPastDate, normalizeDate, normalizePhone, normalizeUnit, orderView } from './orders';
import {
  createPractice,
  PERSONAS,
  PRACTICE_PER_HOUR,
  personaCards,
  practiceCallsLastHour,
} from './practice';
import { priceSeries } from './prices';
import { doNotCall, type Params, saveQuote, startOrder, updateOrder } from './tools';

type Env = { Bindings: Cloudflare.Env };
const dbOf = (c: Context<Env>): Db => drizzle(c.env.DB);

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
  if (!safeEqual(c.req.valid('json').passcode.trim(), c.env.APP_PASSCODE)) {
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
  const view = await orderView(dbOf(c), c.req.param('id'));
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
    return c.json(await orderView(db, id));
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
    const allowlist = parseAllowlist(c.env.SUPPLIER_ALLOWLIST);
    if (allowlist.size > 0 && !allowlist.has(phone)) {
      return c.json(
        {
          error: 'Bhaav may only call numbers on its approved list. Ask the owner to add this one.',
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
    return c.json(await orderView(db, id), 201);
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
  return c.json(await orderView(db, id));
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
  return c.json({ step, view: await orderView(db, id) });
});

api.post('/requests/:id/approve', json(z.object({ quoteId: z.string() })), async (c) => {
  const db = dbOf(c);
  const id = c.req.param('id');
  const view = await orderView(db, id);
  if (!view) return c.json({ error: 'No such order.' }, 404);
  if (view.order.status !== 'done')
    return c.json({ error: 'Approve once all calls are finished.' }, 409);
  const { quoteId } = c.req.valid('json');
  if (!view.quotes.some((q) => q.id === quoteId))
    return c.json({ error: 'That quote is not on this order.' }, 400);
  await db
    .update(requests)
    .set({ status: 'approved', approvedQuoteId: quoteId })
    .where(and(eq(requests.id, id), eq(requests.status, 'done')));
  await db
    .insert(events)
    .values({ id: newId('evt'), requestId: id, type: 'approved', detail: { quoteId } });
  return c.json(await orderView(db, id));
});

// Round 3, only when the buyer presses it: Bhaav tells the chosen supplier.
api.post('/requests/:id/confirm', async (c) => {
  const db = dbOf(c);
  const id = c.req.param('id');
  const result = await confirmChoice(diallerEnv(c.env), db, id);
  if (!result.ok) return c.json({ error: result.message }, result.notFound ? 404 : 409);
  return c.json({ message: result.message, view: await orderView(db, id) });
});

// Price memory: each item's best price per past order.
api.get('/prices', async (c) => c.json(await priceSeries(dbOf(c))));

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
        const session = await mintWebSession(bolna, {
          agentId: c.env.BOLNA_DESK_AGENT_ID,
          userData: { request_ref: request.id, buyer_name: request.buyerName || 'there' },
        });
        return c.json({ session });
      }

      if (!c.env.BOLNA_CALLER_AGENT_ID)
        return c.json({ error: 'The Caller agent is not set up (BOLNA_CALLER_AGENT_ID).' }, 503);
      const persona = PERSONAS.find((p) => p.id === body.personaId);
      if (!persona) return c.json({ error: 'No such practice supplier.' }, 404);
      if ((await practiceCallsLastHour(db)) >= PRACTICE_PER_HOUR) {
        return c.json({ error: 'Practice is busy right now. Try again in a few minutes.' }, 429);
      }
      const practice = await createPractice(db, persona);
      const session = await mintWebSession(bolna, {
        agentId: c.env.BOLNA_CALLER_AGENT_ID,
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
      return c.json(
        { error: 'Bolna would not start the browser call.', detail: String(error) },
        502,
      );
    }
  },
);

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
  const [callEvents, saved] = await Promise.all([
    db.select().from(events).where(eq(events.callId, call.id)).all(),
    db.select().from(quotes).where(eq(quotes.callId, call.id)).all(),
  ]);
  return c.json({
    callId: call.id,
    status: call.status,
    bestOffer: call.bestOfferSaid,
    transcript: call.transcript,
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

app.post('/v1/chat/completions', llmAuth, json(chatRequest), (c) => {
  const db = dbOf(c);
  return catchLies(c.req.valid('json') as ChatRequest, {
    upstream: (body) =>
      fetch(`${c.env.GROQ_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${c.env.GROQ_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
    models: c.env.GROQ_MODELS.split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    allowedFor: (ref) => allowedNumbersFor(db, ref),
    record: (event) => recordEvent(db, event),
    waitUntil: (promise) => c.executionCtx.waitUntil(promise),
  });
});

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
tools.on(['GET', 'POST'], '/start_calls', async (c) => {
  const db = dbOf(c);
  const params = await paramsOf(c);
  const requestId = typeof params.request_ref === 'string' ? params.request_ref : '';
  const result = await startOrder(db, requestId, c.env.BOLNA_CALLER_AGENT_ID);
  if (result.ok) c.executionCtx.waitUntil(advance(diallerEnv(c.env), db, requestId));
  return c.json(result);
});

app.route('/tools', tools);

// ---- Bolna: webhook ---------------------------------------------------------------------

app.post('/webhooks/bolna/:secret', async (c) => {
  if (!c.env.WEBHOOK_SECRET || !safeEqual(c.req.param('secret'), c.env.WEBHOOK_SECRET))
    return c.notFound();
  const execution = await c.req.json<Execution>().catch(() => null);
  if (!execution || typeof execution.status !== 'string') return c.json({ ok: true });
  const db = dbOf(c);
  const finished = await applyExecution(db, execution, findCallRef(execution.context_details));
  if (finished?.channel === 'phone')
    c.executionCtx.waitUntil(advance(diallerEnv(c.env), db, finished.requestId));
  return c.json({ ok: true });
});

// ---- Cron: catch up on lost webhooks ----------------------------------------------------

export async function sweep(env: Cloudflare.Env): Promise<void> {
  const db = drizzle(env.DB);
  const dialler = diallerEnv(env);
  if (env.BOLNA_API_KEY) {
    for (const call of await staleCalls(db, 3 * 60_000)) {
      try {
        const execution = await getExecution(dialler.bolna, call.bolnaExecutionId ?? '');
        const finished = await applyExecution(db, execution, call.id);
        if (finished) await advance(dialler, db, finished.requestId);
      } catch {
        // Try again next minute.
      }
    }
  }
  await failOrphanedCalls(db, 5 * 60_000);
  for (const requestId of await stalledRequests(db)) {
    try {
      await advance(dialler, db, requestId);
    } catch {
      // Try again next minute.
    }
  }
}

export default {
  fetch: app.fetch,
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(sweep(env));
  },
} satisfies ExportedHandler<Cloudflare.Env>;
