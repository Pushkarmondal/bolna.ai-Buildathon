// The ranked quotes, what calling around saved, the proof behind each price, Approve, and what
// comes after: the optional confirmation call, a WhatsApp summary, and how today compares.

import type { OrderView } from '@bhaav/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';
import { OrderUnavailable } from '../App';
import { api, useOrder } from '../api';
import { PriceChart, trendSentence } from '../chart';
import { type Choice, choiceOf } from '../choice';
import { callLabel, dateLabel, isLive, quoteTerms, rupees, unitWord } from '../format';
import {
  ArrowLeft,
  ChartLineUp,
  CheckCircle,
  Copy,
  PhoneCall,
  SealCheck,
  Trophy,
  WhatsappLogo,
} from '../icons';
import { whatsappLink, whatsappSummary } from '../summary';
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Notice,
  PageTitle,
  Pill,
  Stat,
  useDocumentTitle,
} from '../ui';

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

  const o0 = order.data?.order;
  useDocumentTitle(
    o0
      ? `Results: ${[o0.quantity, unitWord(o0.unit), o0.item].filter((x) => x != null && x !== '').join(' ')}`
      : 'Results',
  );

  if (order.isPending) return <p className="text-muted-fg">Loading the results…</p>;
  if (order.error || !order.data) {
    return <OrderUnavailable error={order.error} retry={() => order.refetch()} />;
  }
  const view = order.data;
  const o = view.order;
  const unit = unitWord(o.unit);
  const supplier = (sid: string) => view.suppliers.find((s) => s.id === sid);
  const quote = (qid: string) => view.quotes.find((q) => q.id === qid);
  const best = view.ranking.find((r) => r.quoteId === view.bestQuoteId);
  const finished = o.status === 'done' || o.status === 'approved';
  const saving =
    best?.perUnit != null && view.highestPerUnit != null
      ? Math.max(0, view.highestPerUnit - best.perUnit)
      : null;
  const choice = choiceOf(view);

  async function approve(quoteId: string) {
    setBusy(quoteId);
    setError(null);
    try {
      queryClient.setQueryData(
        ['order', o.id],
        await api<OrderView>(`/api/requests/${o.id}/approve`, { json: { quoteId } }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not approve.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageTitle
        eyebrow="Results"
        title={`${o.quantity ?? ''} ${unit} ${o.item ?? ''}`.trim()}
        sub={`For ${o.buyerName ?? 'you'}, delivered by ${dateLabel(o.deliverBy)}`}
        aside={
          <ButtonLink to={`/r/${o.id}`} variant="ghost" icon={ArrowLeft} className="-ml-5">
            See the calls
          </ButtonLink>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        {!finished && (
          <Notice tone="info">
            Bhaav is still calling. These results update as quotes come in.
          </Notice>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Best price, delivered"
          value={best?.perUnit != null ? `${rupees(best.perUnit)} / ${unit}` : '—'}
          note={best ? supplier(best.supplierId)?.name : 'No comparable quote yet'}
        />
        <Stat
          label="Saved against the costliest quote"
          value={saving != null && o.quantity != null ? rupees(saving * o.quantity) : '—'}
          note={
            saving != null && view.highestPerUnit
              ? `${((saving / view.highestPerUnit) * 100).toFixed(1)}% less than ${rupees(view.highestPerUnit)} / ${unit}`
              : 'Needs two or more quotes'
          }
          tone={saving ? 'success' : undefined}
        />
        <Stat
          label="Order total at best price"
          value={
            best?.perUnit != null && o.quantity != null ? rupees(best.perUnit * o.quantity) : '—'
          }
          note="Delivery included where quoted"
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card
          title="Every supplier's latest quote"
          icon={Trophy}
          aside={<span className="text-sm text-muted-fg">Cheapest first</span>}
        >
          {view.ranking.length === 0 ? (
            <EmptyState icon={Trophy} title="No quotes yet" />
          ) : (
            <ol className="flex flex-col">
              {view.ranking.map((r, i) => {
                const q = quote(r.quoteId);
                const s = supplier(r.supplierId);
                const call = q ? view.calls.find((c) => c.id === q.callId) : undefined;
                const isBest = r.quoteId === view.bestQuoteId;
                // The choice belongs to the supplier: it stays marked if they re-quote on the confirmation call.
                const isApproved = r.supplierId === choice?.supplierId;
                return (
                  <li
                    key={r.quoteId}
                    className="border-t border-border py-5 first:border-t-0 first:pt-0 last:pb-0"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="tabular text-sm text-muted-fg">#{i + 1}</span>
                          <span className="font-semibold">{s?.name ?? 'Supplier'}</span>
                          {isBest && (
                            <Pill tone="success" icon={Trophy}>
                              Best
                            </Pill>
                          )}
                          {isApproved && (
                            <Pill tone="success" icon={SealCheck}>
                              Chosen
                            </Pill>
                          )}
                        </div>
                        <p className="mt-1">
                          <span className="tabular font-display text-[28px] font-bold tracking-tight">
                            {rupees(r.perUnit)}
                          </span>
                          <span className="text-muted-fg"> per {unit}, delivered</span>
                        </p>
                        {q && (
                          <p className="tabular mt-1 text-sm text-muted-fg">
                            Quoted {quoteTerms(q)}
                          </p>
                        )}
                        {r.reasons.length > 0 && (
                          <p className="mt-1 text-sm text-warn">
                            Can't win: {r.reasons.map((x) => REASONS[x] ?? x).join('; ')}
                          </p>
                        )}
                        {q && (
                          <p className="mt-1 text-sm text-muted-fg">
                            Their words: “{q.supplierWords}”
                          </p>
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
                          variant={isBest ? 'cta' : 'secondary'}
                          busy={busy === r.quoteId}
                          icon={CheckCircle}
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

        <div className="flex min-w-0 flex-col gap-4">
          {choice && (
            <ConfirmCard
              view={view}
              choice={choice}
              supplierName={supplier(choice.supplierId)?.name ?? 'the supplier'}
            />
          )}
          {view.ranking.length > 0 && <ShareCard view={view} />}
          <MemoryCard view={view} />
        </div>
      </div>
    </>
  );
}

function ConfirmCard({
  view,
  choice,
  supplierName,
}: {
  view: OrderView;
  choice: Choice;
  supplierName: string;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirmCall, changed, approved } = choice;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ view: OrderView }>(`/api/requests/${view.order.id}/confirm`, {
        method: 'POST',
      });
      queryClient.setQueryData(['order', view.order.id], result.view);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not place the call.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={`You chose ${supplierName}`} icon={SealCheck}>
      <p className="text-muted-fg">
        Call them to place the order; Bhaav never places orders. Or let Bhaav tell them first: it
        says you accept their quote and will call to arrange payment.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        {confirmCall ? (
          <div>
            <Pill
              tone={
                isLive(confirmCall.status)
                  ? 'info'
                  : confirmCall.status === 'completed'
                    ? 'success'
                    : 'warn'
              }
              pulse={isLive(confirmCall.status)}
            >
              Confirmation call: {callLabel(confirmCall.status)}
            </Pill>
          </div>
        ) : (
          <Button variant="primary" busy={busy} icon={PhoneCall} onClick={confirm}>
            Ask Bhaav to tell {supplierName}
          </Button>
        )}
        {changed ? (
          <Notice tone="warn" title={`${supplierName} changed their quote on the call`}>
            Now {quoteTerms(changed)}. You chose {quoteTerms(approved)}. Check with them before you
            place the order.
          </Notice>
        ) : (
          confirmCall?.status === 'completed' && (
            <Notice tone="success">
              Bhaav told {supplierName} you chose their quote of {quoteTerms(approved)}. They did
              not change it on the call.
            </Notice>
          )
        )}
        {confirmCall && !isLive(confirmCall.status) && confirmCall.status !== 'completed' && (
          <p className="text-sm text-muted-fg">
            Bhaav could not reach them. Call {supplierName} yourself to place the order.
          </p>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Card>
  );
}

function ShareCard({ view }: { view: OrderView }) {
  const text = whatsappSummary(view);
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('yes');
    } catch {
      setCopied('no');
    }
  }

  return (
    <Card title="Share the results" icon={WhatsappLogo}>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-2xl bg-bg p-4 font-sans text-[15px] leading-relaxed text-fg">
        {text}
      </pre>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" icon={Copy} onClick={copy}>
          Copy text
        </Button>
        <a
          href={whatsappLink(text)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-5 text-[15px] font-medium text-link transition-colors duration-200 hover:bg-muted"
        >
          <WhatsappLogo size={18} weight="bold" aria-hidden />
          Open in WhatsApp
        </a>
      </div>
      <p className="mt-2 text-sm text-muted-fg" role="status">
        {copied === 'yes'
          ? 'Copied.'
          : copied === 'no'
            ? 'Could not copy here; select the text above instead.'
            : ''}
      </p>
    </Card>
  );
}

function MemoryCard({ view }: { view: OrderView }) {
  const o = view.order;
  const unit = unitWord(o.unit);
  const best = view.ranking.find((r) => r.quoteId === view.bestQuoteId);
  const previous = view.history.at(-1);
  const points =
    best?.perUnit != null
      ? [
          ...view.history,
          { requestId: o.id, date: Date.now(), perUnit: best.perUnit, supplierName: 'today' },
        ]
      : view.history;

  return (
    <Card title="Price memory" icon={ChartLineUp}>
      {view.history.length === 0 ? (
        <p className="text-muted-fg">
          This is the first {o.item ?? 'order'} bought through Bhaav. Next time, today's price shows
          up here to compare.
        </p>
      ) : (
        <>
          <p>
            Last time: <span className="tabular font-semibold">{rupees(previous?.perUnit)}</span> /{' '}
            {unit} from {previous?.supplierName}
            {best?.perUnit != null && previous && (
              <span className={best.perUnit <= previous.perUnit ? 'text-success' : 'text-warn'}>
                {' '}
                ({best.perUnit <= previous.perUnit ? 'today is' : 'today is not'} cheaper)
              </span>
            )}
            .
          </p>
          {points.length >= 4 && (
            <div className="mt-3">
              <PriceChart points={points} unit={unit} label={trendSentence(points, unit)} />
            </div>
          )}
          <p className="mt-2 text-sm text-muted-fg">{trendSentence(points, unit)}</p>
        </>
      )}
    </Card>
  );
}
