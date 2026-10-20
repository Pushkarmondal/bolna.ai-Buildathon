// The ranked quotes, what bargaining saved, the proof behind each price, and Approve.

import type { OrderView } from '@bhaav/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, useOrder } from '../api';
import { dateLabel, rupees, unitWord } from '../format';
import { Button, Card, Notice, PageTitle, Pill } from '../ui';

const REASONS: Record<string, string> = {
  unit: "priced in a unit that can't be compared",
  min_quantity: 'minimum order is above yours',
  late: 'delivers after your date',
};

export function ResultPage() {
  const { id = '' } = useParams();
  const order = useOrder(id);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (order.isPending) return <p className="text-stone-500">Loading the results…</p>;
  if (order.error || !order.data)
    return <Notice tone="bad">{order.error?.message ?? 'Could not load the order.'}</Notice>;
  const view = order.data;
  const o = view.order;
  const supplier = (sid: string) => view.suppliers.find((s) => s.id === sid);
  const quote = (qid: string) => view.quotes.find((q) => q.id === qid);
  const best = view.ranking.find((r) => r.quoteId === view.bestQuoteId);
  const finished = o.status === 'done' || o.status === 'approved';
  const saving =
    best?.perUnit != null && view.highestPerUnit != null
      ? view.highestPerUnit - best.perUnit
      : null;
  const approved = o.approvedQuoteId ? quote(o.approvedQuoteId) : undefined;

  async function approve(quoteId: string) {
    setBusy(quoteId);
    setError(null);
    try {
      const next = await api<OrderView>(`/api/requests/${o.id}/approve`, { json: { quoteId } });
      queryClient.setQueryData(['order', o.id], next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not approve.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageTitle
        title="Results"
        sub={`${o.quantity ?? ''} ${unitWord(o.unit)} ${o.item ?? ''} for ${o.buyerName ?? 'you'}, by ${dateLabel(o.deliverBy)}`}
        aside={
          <Link className="text-sm underline underline-offset-4" to={`/r/${o.id}`}>
            See the calls
          </Link>
        }
      />

      {!finished && (
        <div className="mb-4">
          <Notice>Bhaav is still calling. These results update as quotes come in.</Notice>
        </div>
      )}
      {approved && (
        <div className="mb-4">
          <Notice tone="good">
            You approved {supplier(approved.supplierId)?.name} at{' '}
            {rupees(approved.landedPricePerUnit)} per {unitWord(o.unit)}, delivered. Call them to
            confirm the order; Bhaav does not place orders.
          </Notice>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Card>
          <div className="text-sm text-stone-500">Best price</div>
          <div className="mt-1 text-2xl font-semibold">
            {best ? `${rupees(best.perUnit)} / ${unitWord(o.unit)}` : '—'}
          </div>
          <div className="text-sm text-stone-600 dark:text-stone-400">
            {best ? supplier(best.supplierId)?.name : 'No usable quote yet'}
          </div>
        </Card>
        <Card>
          <div className="text-sm text-stone-500">Saved against the costliest quote</div>
          <div className="mt-1 text-2xl font-semibold">
            {saving != null && o.quantity != null ? rupees(Math.max(0, saving) * o.quantity) : '—'}
          </div>
          <div className="text-sm text-stone-600 dark:text-stone-400">
            {saving != null && view.highestPerUnit
              ? `${((Math.max(0, saving) / view.highestPerUnit) * 100).toFixed(1)}% less than ${rupees(view.highestPerUnit)} / ${unitWord(o.unit)}`
              : 'Needs two or more quotes'}
          </div>
        </Card>
        <Card>
          <div className="text-sm text-stone-500">Order total at best price</div>
          <div className="mt-1 text-2xl font-semibold">
            {best?.perUnit != null && o.quantity != null ? rupees(best.perUnit * o.quantity) : '—'}
          </div>
          <div className="text-sm text-stone-600 dark:text-stone-400">
            Delivery included where quoted
          </div>
        </Card>
      </div>

      <Card title="Every supplier's latest quote, cheapest first">
        {view.ranking.length === 0 ? (
          <p className="text-sm text-stone-500">No quotes yet.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {view.ranking.map((r, i) => {
              const q = quote(r.quoteId);
              const s = supplier(r.supplierId);
              const call = q ? view.calls.find((c) => c.id === q.callId) : undefined;
              const isBest = r.quoteId === view.bestQuoteId;
              const isApproved = r.quoteId === o.approvedQuoteId;
              return (
                <li
                  key={r.quoteId}
                  className={`rounded-lg border p-3 ${isBest ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20' : 'border-stone-200 dark:border-stone-800'}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-stone-500">#{i + 1}</span>
                        <span className="font-medium">{s?.name ?? 'Supplier'}</span>
                        {isBest && <Pill tone="good">Best</Pill>}
                        {isApproved && <Pill tone="good">Approved</Pill>}
                      </div>
                      <div className="mt-1 text-sm">
                        <span className="text-lg font-semibold">{rupees(r.perUnit)}</span>
                        <span className="text-stone-500"> per {unitWord(o.unit)}, delivered</span>
                      </div>
                      {q && (
                        <div className="mt-1 text-sm text-stone-600 dark:text-stone-400">
                          Quoted {rupees(q.price)} per{' '}
                          {q.packSize ? `${q.packSize} ${unitWord(q.packUnit)}` : unitWord(q.unit)}
                          {q.deliveryCharge ? `, ${rupees(q.deliveryCharge)} delivery` : ''}
                          {q.deliveryDate ? `, by ${dateLabel(q.deliveryDate)}` : ''}
                          {q.paymentTerms ? `, ${q.paymentTerms}` : ''}
                        </div>
                      )}
                      {r.reasons.length > 0 && (
                        <div className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                          Not eligible: {r.reasons.map((x) => REASONS[x] ?? x).join('; ')}
                        </div>
                      )}
                      {q && (
                        <div className="mt-1 text-sm text-stone-500">
                          Their words: "{q.supplierWords}"
                        </div>
                      )}
                      {call?.recordingUrl && (
                        // biome-ignore lint/a11y/useMediaCaption: call recordings have no caption file; the words are shown above
                        <audio
                          className="mt-2 w-full max-w-sm"
                          controls
                          preload="none"
                          src={call.recordingUrl}
                        >
                          <a href={call.recordingUrl}>Recording</a>
                        </audio>
                      )}
                    </div>
                    {o.status === 'done' && r.reasons.length === 0 && r.perUnit !== null && (
                      <Button
                        variant={isBest ? 'primary' : 'secondary'}
                        busy={busy === r.quoteId}
                        onClick={() => approve(r.quoteId)}
                      >
                        Approve
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </>
  );
}
