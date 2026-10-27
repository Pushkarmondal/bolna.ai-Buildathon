// The tables of an order (requests, suppliers, calls, quotes, events, turns), weekly schedules,
// and wrong passcodes. `quotes`, `events` and `turns` are append-only: triggers in the migrations
// refuse UPDATE and DELETE, so the record of what Bhaav heard and said can be trusted.

import { CALL_STATUSES, EVENT_TYPES, REQUEST_STATUSES, UNITS } from '@bhaav/shared';
import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const id = () => text('id').primaryKey();
const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date());

export const requests = sqliteTable(
  'requests',
  {
    id: id(),
    buyerName: text('buyer_name'),
    item: text('item'),
    quantity: real('quantity'),
    unit: text('unit', { enum: UNITS }),
    quality: text('quality'),
    /** ISO date, YYYY-MM-DD */
    deliverBy: text('deliver_by'),
    area: text('area'),
    status: text('status', { enum: REQUEST_STATUSES }).notNull().default('draft'),
    approvedQuoteId: text('approved_quote_id'),
    isPractice: integer('is_practice', { mode: 'boolean' }).notNull().default(false),
    /** A "Watch a full order" run: pretend suppliers, the real AI and lie-catcher. */
    isSimulation: integer('is_simulation', { mode: 'boolean' }).notNull().default(false),
    /** The owner's own number (E.164), for Bhaav to call them; must be on the approved list. */
    buyerPhone: text('buyer_phone'),
    /** Call the owner with the result when the calls are done, to approve by voice. */
    ownerUpdates: integer('owner_updates', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  // Price memory finds earlier orders of the same item by this key, without reading every quote.
  (t) => [index('requests_item_key_idx').on(sql`lower(trim(${t.item}))`, t.unit)],
);

export const suppliers = sqliteTable(
  'suppliers',
  {
    id: id(),
    requestId: text('request_id')
      .notNull()
      .references(() => requests.id),
    name: text('name').notNull(),
    /** E.164, or "web" for a practice supplier reached by browser. */
    phone: text('phone').notNull(),
    language: text('language').notNull().default('hi'),
    consentNote: text('consent_note'),
    doNotCall: integer('do_not_call', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('suppliers_request_idx').on(t.requestId), index('suppliers_phone_idx').on(t.phone)],
);

export const calls = sqliteTable(
  'calls',
  {
    /** Also the CALL_REF the Caller's prompt carries. */
    id: id(),
    requestId: text('request_id')
      .notNull()
      .references(() => requests.id),
    supplierId: text('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    round: integer('round').notNull(),
    /** phone: a real supplier call; web: a judge's practice call; sim: a "Watch a full order" call. */
    channel: text('channel', { enum: ['phone', 'web', 'sim'] })
      .notNull()
      .default('phone'),
    bolnaExecutionId: text('bolna_execution_id'),
    status: text('status', { enum: CALL_STATUSES }).notNull().default('queued'),
    /** The best_offer text given to the Caller for a round-2 call. */
    bestOfferSaid: text('best_offer_said'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
    recordingUrl: text('recording_url'),
    transcript: text('transcript'),
    /** 1 for the first try; a dial Bolna refused for a passing reason is tried again, up to 3. */
    attempt: integer('attempt').notNull().default(1),
    /** Set when Bolna refused to place the call for a passing reason (busy, at its call limit). */
    retryable: integer('retryable', { mode: 'boolean' }).notNull().default(false),
    /** The supplier asked to be called back: when Bhaav promised to. */
    callbackAt: integer('callback_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('calls_request_idx').on(t.requestId),
    index('calls_execution_idx').on(t.bolnaExecutionId),
    // One call per supplier, round and attempt, and one live phone call per order at a time:
    // two dialler runs racing each other cannot both dial.
    uniqueIndex('calls_one_per_round').on(t.requestId, t.supplierId, t.round, t.attempt),
    uniqueIndex('calls_one_live_per_order')
      .on(t.requestId)
      .where(
        sql`${t.channel} = 'phone' and ${t.status} in ('scheduled', 'queued', 'rescheduled', 'initiated', 'ringing', 'in-progress', 'call-disconnected')`,
      ),
  ],
);

export const quotes = sqliteTable(
  'quotes',
  {
    id: id(),
    requestId: text('request_id')
      .notNull()
      .references(() => requests.id),
    supplierId: text('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    callId: text('call_id')
      .notNull()
      .references(() => calls.id),
    price: real('price').notNull(),
    unit: text('unit', { enum: UNITS }).notNull(),
    packSize: real('pack_size'),
    packUnit: text('pack_unit', { enum: UNITS }),
    minQuantity: real('min_quantity'),
    /** ISO date, YYYY-MM-DD */
    deliveryDate: text('delivery_date'),
    /** Rupees for the whole order. */
    deliveryCharge: real('delivery_charge'),
    paymentTerms: text('payment_terms'),
    landedPricePerUnit: real('landed_price_per_unit'),
    supplierWords: text('supplier_words').notNull(),
    readBackConfirmed: integer('read_back_confirmed', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('quotes_request_idx').on(t.requestId)],
);

export const events = sqliteTable(
  'events',
  {
    id: id(),
    requestId: text('request_id').references(() => requests.id),
    callId: text('call_id').references(() => calls.id),
    type: text('type', { enum: EVENT_TYPES }).notNull(),
    detail: text('detail', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('events_request_idx').on(t.requestId), index('events_call_idx').on(t.callId)],
);

/**
 * Every turn of a call as the lie-catcher saw it: what the other person said, what Bhaav said,
 * each number and where it came from, and any sentence it stopped. The live transcript.
 */
export const turns = sqliteTable(
  'turns',
  {
    id: id(),
    requestId: text('request_id').references(() => requests.id),
    callId: text('call_id').references(() => calls.id),
    /** The other person's latest words; null when the turn followed a tool's result. */
    heard: text('heard'),
    /** What Bolna was given to speak, after the checks. */
    said: text('said').notNull(),
    /** The sentence the lie-catcher stopped, if any. */
    stopped: text('stopped'),
    numbers: text('numbers', { mode: 'json' })
      .$type<Array<{ value: number; text: string; source: string; question: boolean }>>()
      .notNull(),
    /** Server time from the request to the first words, in ms. */
    thinkMs: integer('think_ms'),
    createdAt: createdAt(),
  },
  (t) => [index('turns_call_idx').on(t.callId), index('turns_request_idx').on(t.requestId)],
);

/** "Every Monday at 10": an order repeated each week from a past one. */
export const schedules = sqliteTable(
  'schedules',
  {
    id: id(),
    /** The order each week's order copies. */
    requestId: text('request_id')
      .notNull()
      .references(() => requests.id),
    /** 0 is Sunday, as JavaScript counts, in India time. */
    weekday: integer('weekday').notNull(),
    /** India-time hour the week's order starts. */
    hour: integer('hour').notNull(),
    /** Phone the owner to confirm first, instead of starting the calls by itself. */
    callOwnerFirst: integer('call_owner_first', { mode: 'boolean' }).notNull().default(false),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    /** YYYY-MM-DD of the last week's order, so a day never runs twice. */
    lastRunOn: text('last_run_on'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('schedules_one_per_order').on(t.requestId)],
);

/** Wrong passcodes, so guessing can be slowed down. Holds a hash of the address, never the address. */
export const loginAttempts = sqliteTable(
  'login_attempts',
  {
    id: id(),
    ipHash: text('ip_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('login_attempts_created_idx').on(t.createdAt)],
);

export type RequestRow = typeof requests.$inferSelect;
export type SupplierRow = typeof suppliers.$inferSelect;
export type CallRow = typeof calls.$inferSelect;
export type QuoteRow = typeof quotes.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type TurnRow = typeof turns.$inferSelect;
export type ScheduleRow = typeof schedules.$inferSelect;
