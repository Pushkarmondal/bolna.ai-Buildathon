// The five tables. `quotes` and `events` are append-only: triggers in the migrations refuse
// UPDATE and DELETE, so the record of what Bhaav heard and said can be trusted.

import { CALL_STATUSES, EVENT_TYPES, REQUEST_STATUSES, UNITS } from '@bhaav/shared';
import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const id = () => text('id').primaryKey();
const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date());

export const requests = sqliteTable('requests', {
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
  createdAt: createdAt(),
});

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
    channel: text('channel', { enum: ['phone', 'web'] })
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
    createdAt: createdAt(),
  },
  (t) => [
    index('calls_request_idx').on(t.requestId),
    index('calls_execution_idx').on(t.bolnaExecutionId),
    // One call per supplier per round, and one live phone call per order at a time: two
    // dialler runs racing each other cannot both dial.
    uniqueIndex('calls_one_per_round').on(t.requestId, t.supplierId, t.round),
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

export type RequestRow = typeof requests.$inferSelect;
export type SupplierRow = typeof suppliers.$inferSelect;
export type CallRow = typeof calls.$inferSelect;
export type QuoteRow = typeof quotes.$inferSelect;
export type EventRow = typeof events.$inferSelect;
