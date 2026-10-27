// The owner line: Bhaav phones the owner, not just the suppliers. Before the calls, to take the
// order by voice (the Desk agent, over the phone); after them, with the result, so the owner can
// approve by voice (the owner agent). The owner's number must be on the approved list like any
// other, and the owner's yes is read back first, exactly as a supplier's quote is.

import { and, eq, gte, isNotNull } from 'drizzle-orm';
import { placeCall } from './bolna';
import type { Db } from './db/context';
import { events, type RequestRow, requests } from './db/schema';
import { confirmChoice, type DiallerEnv, diallerEnv, inCallHours, mayCall } from './dialler';
import { formatRupees, UNIT_WORDS } from './engine';
import { newId } from './ids';
import { approveQuote, dateWords, orderView, quantityWords, todayWords } from './orders';
import { type Params, param, type ToolResult } from './tools';

export interface OwnerEnv {
  dialler: DiallerEnv;
  deskAgentId: string;
  ownerAgentId: string;
}

export function ownerEnv(env: Cloudflare.Env): OwnerEnv {
  return {
    dialler: diallerEnv(env),
    deskAgentId: env.BOLNA_DESK_AGENT_ID,
    ownerAgentId: env.BOLNA_OWNER_AGENT_ID,
  };
}

/** The order as the Desk should read it back, or "nothing yet". */
function orderNote(r: RequestRow): string {
  if (!r.item || r.quantity == null || !r.unit || !r.deliverBy) return 'nothing yet';
  const quality = r.quality ? ` (${r.quality})` : '';
  const area = r.area ? `, to ${r.area}` : '';
  return `${quantityWords(r.quantity, r.unit)} of ${r.item}${quality}, by ${dateWords(r.deliverBy)}${area}.`;
}

/** What the Desk is told when a conversation starts, in the browser or on the phone. */
export function deskUserData(r: RequestRow): Record<string, string> {
  return {
    request_ref: r.id,
    buyer_name: r.buyerName || 'there',
    // The Desk turns "Friday tak" into a date, so it needs today's (Bolna's own {current_date}
    // follows the caller's timezone, which a browser call may not have).
    today: todayWords(),
    timezone: 'Asia/Kolkata',
    order_note: orderNote(r),
  };
}

/** Whether the owner can be phoned: a number given, and on the approved list. */
function ownerNumber(env: OwnerEnv, r: RequestRow): string | null {
  return r.buyerPhone && mayCall(env.dialler.allowlist, r.buyerPhone) ? r.buyerPhone : null;
}

async function logOwnerCall(
  db: Db,
  requestId: string,
  kind: 'order' | 'result',
  executionId: string,
) {
  await db.insert(events).values({
    id: newId('evt'),
    requestId,
    type: 'owner_call',
    detail: { kind, executionId },
  });
}

/** Bhaav phones the owner to take today's order by voice (the "Call me" button, or a schedule). */
export async function callOwnerToOrder(
  env: OwnerEnv,
  db: Db,
  requestId: string,
): Promise<{ ok: boolean; message: string }> {
  const r = await db.select().from(requests).where(eq(requests.id, requestId)).get();
  if (!r) return { ok: false, message: 'No such order.' };
  if (r.status !== 'draft') return { ok: false, message: 'Calls have started already.' };
  if (!env.deskAgentId)
    return { ok: false, message: 'The Desk agent is not set up (BOLNA_DESK_AGENT_ID).' };
  const phone = ownerNumber(env, r);
  if (!phone)
    return {
      ok: false,
      message: r.buyerPhone
        ? 'Your number is not on the approved list yet. The owner adds it in SUPPLIER_ALLOWLIST.'
        : 'Add your mobile number first.',
    };
  try {
    const placed = await placeCall(env.dialler.bolna, {
      agentId: env.deskAgentId,
      phone,
      fromNumber: env.dialler.fromNumber,
      userData: deskUserData(r),
    });
    await logOwnerCall(db, r.id, 'order', placed.execution_id);
    return { ok: true, message: 'Bhaav is calling you now.' };
  } catch {
    return { ok: false, message: 'Bolna would not place the call. Try again in a minute.' };
  }
}

/** The quotes as the owner hears them, best first: "A: Gupta Traders, ₹31 per kilo delivered". */
export async function ownerChoices(
  db: Db,
  requestId: string,
): Promise<Array<{ letter: string; quoteId: string; supplier: string; text: string }>> {
  const view = await orderView(db, requestId);
  if (!view) return [];
  const unit = view.order.unit ? UNIT_WORDS[view.order.unit] : 'unit';
  return view.ranking
    .filter((r) => r.perUnit !== null)
    .map((r, i) => {
      const supplier = view.suppliers.find((s) => s.id === r.supplierId)?.name ?? 'a supplier';
      const letter = String.fromCharCode(65 + i);
      const late = r.reasons.length > 0 ? ' (does not fit the order)' : '';
      return {
        letter,
        quoteId: r.quoteId,
        supplier,
        text: `${letter}: ${supplier}, ${formatRupees(r.perUnit ?? 0)} per ${unit} delivered${late}`,
      };
    });
}

/**
 * Bhaav phones the owner with the result once the calls are done, if they asked for it. Once per
 * order, and only in calling hours (the cron tries again later).
 */
export async function callOwnerWithResult(
  env: OwnerEnv,
  db: Db,
  requestId: string,
): Promise<boolean> {
  const r = await db.select().from(requests).where(eq(requests.id, requestId)).get();
  if (r?.status !== 'done' || !r.ownerUpdates || !env.ownerAgentId) return false;
  const phone = ownerNumber(env, r);
  if (!phone || !inCallHours(env.dialler.callHours, env.dialler.now?.() ?? Date.now()))
    return false;
  const already = await db
    .select({ detail: events.detail })
    .from(events)
    .where(and(eq(events.requestId, r.id), eq(events.type, 'owner_call')))
    .all();
  if (already.some((e) => e.detail?.kind === 'result')) return false;
  const choices = await ownerChoices(db, r.id);
  if (choices.length === 0) return false;
  try {
    const placed = await placeCall(env.dialler.bolna, {
      agentId: env.ownerAgentId,
      phone,
      fromNumber: env.dialler.fromNumber,
      userData: {
        request_ref: r.id,
        buyer_name: r.buyerName || 'there',
        choices: choices.map((c) => c.text).join('; '),
      },
    });
    await logOwnerCall(db, r.id, 'result', placed.execution_id);
    return true;
  } catch {
    return false; // The cron tries again next minute.
  }
}

/**
 * Orders finished with a result call owed to the owner: run from a webhook and the cron. Only
 * orders from the last day: news of an old order is no reason to ring anyone.
 */
export async function ownerResultsDue(env: OwnerEnv, db: Db, now = Date.now()): Promise<void> {
  if (!env.ownerAgentId) return;
  const due = await db
    .select({ id: requests.id })
    .from(requests)
    .where(
      and(
        eq(requests.status, 'done'),
        eq(requests.ownerUpdates, true),
        isNotNull(requests.buyerPhone),
        eq(requests.isPractice, false),
        eq(requests.isSimulation, false),
        gte(requests.createdAt, new Date(now - 86_400_000)),
      ),
    )
    .all();
  for (const { id } of due) await callOwnerWithResult(env, db, id).catch(() => false);
}

/**
 * The owner's approve_quote tool: their spoken choice, read back and confirmed on the call, becomes
 * the order's approval, the same as pressing Approve. Optionally Bhaav then tells the supplier.
 */
export async function approveByVoice(env: OwnerEnv, db: Db, params: Params): Promise<ToolResult> {
  const requestId = param(params, 'request_ref') ?? '';
  const said = (param(params, 'choice') ?? '').trim().toLowerCase();
  const choices = await ownerChoices(db, requestId);
  const chosen =
    choices.find((c) => c.letter.toLowerCase() === said.replace(/^option\s+/, '')) ??
    choices.find((c) => said.length > 2 && c.supplier.toLowerCase().includes(said));
  if (!chosen) return { ok: false, message: 'Ask which one again, by its letter.' };
  const approved = await approveQuote(db, requestId, chosen.quoteId, 'voice');
  if (!approved.ok) return { ok: false, message: approved.error };
  const tell = /^(yes|haan|ha|han|ji)/i.test(param(params, 'tell_supplier') ?? '');
  const told = tell ? await confirmChoice(env.dialler, db, requestId) : null;
  return {
    ok: true,
    message: `Approved ${chosen.supplier}.${told ? ` ${told.message}` : ''} Thank the owner and say goodbye.`,
  };
}
