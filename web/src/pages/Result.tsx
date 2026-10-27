// The ranked quotes, what calling around saved, the proof behind each price, Approve, and what
// comes after: the optional confirmation call, a WhatsApp summary, and how today compares.

import type { OrderView } from '@bhaav/shared';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { OrderUnavailable } from '../App';
import { api, useApplyOrder, useHistory, useOrder } from '../api';
import { PriceChart, trendSentence } from '../chart';
import { type Choice, choiceOf } from '../choice';
import { callLabel, dateLabel, isLive, quoteTerms, rupees, unitWord } from '../format';
import {
  ArrowLeft,
  ArrowsClockwise,
  CalendarCheck,
  ChartLineUp,
  CheckCircle,
  Copy,
  PhoneCall,
  SealCheck,
  Trophy,
  WhatsappLogo,
} from '../icons';
import { savingOf, whatsappLink, whatsappSummary } from '../summary';
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Field,
  inputClass,
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
  const applyOrder = useApplyOrder(id);
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
  const saving = savingOf(view);
  const choice = choiceOf(view);

  async function approve(quoteId: string) {
    setBusy(quoteId);
    setError(null);
    try {
      await applyOrder(
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
        title={`${o.quantity ?? ''} ${unit} ${o.item ?? ''}`.trim() || 'Order results'}
        sub={`For ${o.buyerName ?? 'you'}, delivered by ${dateLabel(o.deliverBy)}`}
        aside={
          <ButtonLink to={`/r/${o.id}`} variant="ghost" icon={ArrowLeft} className="-ml-5">
            See the calls
          </ButtonLink>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        {o.status === 'draft' ? (
          <Notice tone="info">
            Calls have not started yet. Finish the order on the calls page and press Start calling.
          </Notice>
        ) : (
          !finished && (
            <Notice tone="info">
              Bhaav is still calling. These results update as quotes come in.
            </Notice>
          )
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
          value={saving?.total != null ? rupees(saving.total) : '—'}
          note={
            saving && view.highestPerUnit
              ? `${saving.pct.toFixed(1)}% less than ${rupees(view.highestPerUnit)} / ${unit}`
              : 'Needs two or more quotes'
          }
          tone={saving?.perUnit ? 'success' : undefined}
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
          {!o.isPractice && !o.isSimulation && <NextTimeCard view={view} />}
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
  const applyOrder = useApplyOrder(view.order.id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirmCall, changed, approved } = choice;
  // Bolna was too busy to place the last try: the buyer may ask again.
  const busyEarlier = confirmCall?.status === 'failed' && confirmCall.retryable;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ view: OrderView }>(`/api/requests/${view.order.id}/confirm`, {
        method: 'POST',
      });
      await applyOrder(result.view);
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
        {confirmCall && !busyEarlier ? (
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
            {busyEarlier ? `Try again: tell ${supplierName}` : `Ask Bhaav to tell ${supplierName}`}
          </Button>
        )}
        {busyEarlier && (
          <p className="text-sm text-muted-fg">
            Bolna was busy, so the call was not placed. Try again in a minute.
          </p>
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
        {confirmCall &&
          !busyEarlier &&
          !isLive(confirmCall.status) &&
          confirmCall.status !== 'completed' && (
            <p className="text-sm text-muted-fg">
              Bhaav could not reach them. Call {supplierName} yourself to place the order.
            </p>
          )}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Card>
  );
}

/** Copies through a hidden text box and the browser's copy command; true when it worked. */
function copyWithSelection(text: string): boolean {
  const box = document.createElement('textarea');
  box.value = text;
  box.setAttribute('readonly', '');
  box.style.position = 'fixed';
  box.style.opacity = '0';
  document.body.appendChild(box);
  box.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    box.remove();
  }
}

function ShareCard({ view }: { view: OrderView }) {
  const text = whatsappSummary(view);
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('yes');
    } catch {
      // In-app browsers (WhatsApp's, Instagram's) often block the clipboard API; the older copy
      // command still works there. Only if both fail is the buyer asked to select the text.
      setCopied(copyWithSelection(text) ? 'yes' : 'no');
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
  const historyQuery = useHistory(o.id);
  const history = historyQuery.data ?? [];
  const previous = history.at(-1);
  const points =
    best?.perUnit != null
      ? [
          ...history,
          { requestId: o.id, date: Date.now(), perUnit: best.perUnit, supplierName: 'today' },
        ]
      : history;

  return (
    <Card title="Price memory" icon={ChartLineUp}>
      {historyQuery.isPending ? (
        <p className="text-muted-fg">Looking up past prices…</p>
      ) : historyQuery.isError ? (
        <p className="text-muted-fg">
          Past prices could not be loaded.{' '}
          <button
            type="button"
            className="min-h-11 font-medium text-link"
            onClick={() => historyQuery.refetch()}
          >
            Try again
          </button>
        </p>
      ) : history.length === 0 ? (
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

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** India-time weekday today, so "every week" starts on the day the buyer is ordering. */
const todayInIndia = () => new Date(Date.now() + 330 * 60_000).getUTCDay();

/** "The same next time": order again in one tap, or every week by itself. */
function NextTimeCard({ view }: { view: OrderView }) {
  const navigate = useNavigate();
  const applyOrder = useApplyOrder(view.order.id);
  const schedule = view.schedule;
  const { from, to } = view.callHours;
  const [weekday, setWeekday] = useState(schedule?.weekday ?? todayInIndia());
  const [hour, setHour] = useState(schedule?.hour ?? from);
  const [callFirst, setCallFirst] = useState(schedule?.callOwnerFirst ?? false);
  const [busy, setBusy] = useState<'again' | 'weekly' | 'pause' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function orderAgain() {
    setBusy('again');
    setError(null);
    try {
      const { id } = await api<{ id: string }>(`/api/requests/${view.order.id}/repeat`, {
        method: 'POST',
      });
      navigate(`/r/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not copy the order.');
      setBusy(null);
    }
  }

  async function everyWeek() {
    setBusy('weekly');
    setError(null);
    try {
      await applyOrder(
        await api<OrderView>(`/api/requests/${view.order.id}/schedule`, {
          json: { weekday, hour, callOwnerFirst: callFirst },
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set it up.');
    } finally {
      setBusy(null);
    }
  }

  async function setActive(active: boolean) {
    if (!schedule) return;
    setBusy('pause');
    setError(null);
    try {
      await api(`/api/schedules/${schedule.id}/active`, { json: { active } });
      await applyOrder(await api<OrderView>(`/api/requests/${view.order.id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change it.');
    } finally {
      setBusy(null);
    }
  }

  const hours = Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
  return (
    <Card title="Next time" icon={ArrowsClockwise}>
      <p className="mb-4 text-muted-fg">
        The same item, quantity and suppliers, with a new delivery date.
      </p>
      <Button
        variant="secondary"
        icon={ArrowsClockwise}
        busy={busy === 'again'}
        onClick={orderAgain}
      >
        Order this again
      </Button>

      <h3 className="mt-6 mb-3 flex items-center gap-2 font-semibold">
        <CalendarCheck size={20} className="text-muted-fg" aria-hidden />
        Every week, by itself
      </h3>
      {schedule && (
        <p className="mb-3 text-[15px]" role="status">
          {schedule.active
            ? `Repeats every ${WEEKDAYS[schedule.weekday]} at ${schedule.hour}:00. Next: ${schedule.nextRun ? new Date(schedule.nextRun).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : 'soon'}.`
            : 'Paused.'}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="schedule-day" label="Day">
          <select
            id="schedule-day"
            className={inputClass}
            value={weekday}
            onChange={(e) => setWeekday(Number(e.target.value))}
          >
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        <Field id="schedule-hour" label="Start calls at">
          <select
            id="schedule-hour"
            className={inputClass}
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
          >
            {hours.map((h) => (
              <option key={h} value={h}>
                {h}:00
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label
        className="mt-3 flex min-h-11 cursor-pointer items-start gap-3 text-sm"
        htmlFor="schedule-call-first"
      >
        <input
          id="schedule-call-first"
          type="checkbox"
          className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
          checked={callFirst}
          onChange={(e) => setCallFirst(e.target.checked)}
        />
        <span>Phone me first to confirm, instead of starting the calls by itself.</span>
      </label>
      {error && (
        <div className="mt-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" icon={CalendarCheck} busy={busy === 'weekly'} onClick={everyWeek}>
          {schedule ? 'Save' : 'Repeat every week'}
        </Button>
        {schedule && (
          <Button
            variant="ghost"
            busy={busy === 'pause'}
            onClick={() => setActive(!schedule.active)}
          >
            {schedule.active ? 'Pause' : 'Resume'}
          </Button>
        )}
      </div>
    </Card>
  );
}
