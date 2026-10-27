// One order: while it's a draft, the buyer talks to the Desk (or types) and lists suppliers;
// once calls start, the same page shows each call live, the quote book and the lie-catcher.

import type { LANGUAGES, OrderView, SupplierDto, Unit } from '@bhaav/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { OrderUnavailable } from '../App';
import { api, lastOrder, useApplyOrder, useOrder } from '../api';
import {
  callLabel,
  dateLabel,
  indiaToday,
  isLive,
  ORDER_UNITS,
  phoneLabel,
  rupees,
  timeLabel,
  unitWord,
} from '../format';
import {
  ArrowRight,
  ListChecks,
  Microphone,
  PhoneCall,
  PhoneDisconnect,
  Receipt,
  ShieldCheck,
  Trash,
  UserPlus,
  UsersThree,
  WarningCircle,
} from '../icons';
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Field,
  fieldProps,
  inputClass,
  Notice,
  PageTitle,
  Pill,
  Steps,
  type Tone,
  useDocumentTitle,
  VoiceMeter,
} from '../ui';
import { useWebCall } from '../webcall';

type WebCall = ReturnType<typeof useWebCall>;

export function OrderPage() {
  const { id = '' } = useParams();
  const order = useOrder(id);
  // Lives here, not in the Talk card, so the Desk call survives the switch to the live view
  // when the buyer says "start" mid-conversation.
  const desk = useWebCall();

  useEffect(() => {
    if (id) lastOrder.set(id);
  }, [id]);

  const o = order.data?.order;
  useDocumentTitle(
    !o
      ? 'Order'
      : o.status === 'draft'
        ? 'New order'
        : `Calls: ${[o.quantity, unitWord(o.unit), o.item].filter((x) => x != null && x !== '').join(' ')}`,
  );

  if (order.isPending) return <p className="text-muted-fg">Loading the order…</p>;
  if (order.error || !order.data) {
    return <OrderUnavailable error={order.error} retry={() => order.refetch()} />;
  }
  const view = order.data;
  return view.order.status === 'draft' ? (
    <DraftOrder view={view} desk={desk} />
  ) : (
    <LiveCalls view={view} desk={desk} />
  );
}

// ---- Draft: talk, edit, add suppliers, start ----------------------------------------------

const useSetView = useApplyOrder;

const LANGUAGE_LABELS: Record<(typeof LANGUAGES)[number], string> = {
  hi: 'Hindi or Hinglish',
  kn: 'Kannada',
  en: 'English',
};

function DraftOrder({ view, desk }: { view: OrderView; desk: WebCall }) {
  const o = view.order;
  const orderReady = Boolean(o.item && o.quantity != null && o.unit && o.deliverBy);
  const suppliersReady = view.suppliers.some((s) => !s.doNotCall);
  return (
    <>
      <PageTitle
        eyebrow="New order"
        title={`Order for ${o.buyerName ?? 'you'}`}
        sub="Tell Bhaav what you need, or type it. Then add the suppliers Bhaav should call."
      />
      <Steps
        steps={[
          { label: 'What you need', done: orderReady },
          { label: 'Who to call', done: suppliersReady },
          { label: 'Start calling', done: false },
        ]}
      />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <TalkCard requestId={o.id} call={desk} />
          <OrderCard view={view} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <SuppliersCard view={view} />
          <StartCard view={view} />
        </div>
      </div>
    </>
  );
}

function TalkCard({ requestId, call }: { requestId: string; call: WebCall }) {
  const label = {
    idle: 'Talk to Bhaav',
    connecting: 'Connecting…',
    ringing: 'Connecting…',
    active: 'End the conversation',
    ended: 'Talk again',
  }[call.state];
  return (
    <Card
      title="Talk to Bhaav"
      icon={Microphone}
      aside={
        call.state === 'active' ? (
          <Pill tone="info" pulse>
            Listening
          </Pill>
        ) : null
      }
    >
      <p className="mb-4 text-muted-fg">
        Say it in Hindi, Kannada or English, for example "50 kilo pyaaz chahiye, Friday tak,
        Indiranagar". The order card fills in as you speak.
      </p>
      <div className="flex flex-col gap-3">
        <Button
          variant={call.active ? 'danger' : 'primary'}
          size="lg"
          icon={call.active ? PhoneDisconnect : Microphone}
          busy={call.state === 'connecting' || call.state === 'ringing'}
          onClick={() =>
            call.state === 'active' ? call.stop() : call.start({ kind: 'desk', requestId })
          }
        >
          {label}
        </Button>
        {call.state === 'active' && <VoiceMeter level={call.volume} />}
        {call.error && <Notice tone="danger">{call.error}</Notice>}
      </div>
    </Card>
  );
}

/** A text field that saves as you type and never overwrites what you're typing with a poll. */
function useLiveField(server: string, save: (value: string) => void) {
  const [value, setValue] = useState(server);
  const editing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!editing.current) setValue(server);
  }, [server]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    value,
    onFocus: () => {
      editing.current = true;
    },
    onBlur: () => {
      editing.current = false;
    },
    onChange: (next: string) => {
      setValue(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => save(next), 600);
    },
  };
}

function OrderCard({ view }: { view: OrderView }) {
  const setView = useSetView(view.order.id);
  const [error, setError] = useState<string | null>(null);
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const o = view.order;

  /** Saves a change; a refusal shows next to the field it is about, or under the card. */
  const patch = (body: Record<string, unknown>, onError: (m: string) => void = setError) => {
    setError(null);
    api<OrderView>(`/api/requests/${o.id}`, { method: 'PATCH', json: body })
      .then(setView)
      .catch((e: Error) => onError(e.message));
  };

  const item = useLiveField(o.item ?? '', (v) => patch({ item: v.trim() || null }));
  const quantity = useLiveField(o.quantity == null ? '' : String(o.quantity), (v) => {
    const n = Number(v);
    if (v.trim() === '') {
      setQuantityError(null);
      patch({ quantity: null });
    } else if (Number.isFinite(n) && n > 0) {
      setQuantityError(null);
      patch({ quantity: n });
    } else setQuantityError('Use a number above zero, like 50.');
  });
  const quality = useLiveField(o.quality ?? '', (v) => patch({ quality: v.trim() || null }));
  const area = useLiveField(o.area ?? '', (v) => patch({ area: v.trim() || null }));

  return (
    <Card
      title="Order card"
      icon={Receipt}
      aside={
        view.missing.some((m) => m !== 'at least one supplier') ? null : (
          <Pill tone="success">Complete</Pill>
        )
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field id="item" label="What to buy">
            <input
              className={inputClass}
              placeholder="e.g. red onions"
              value={item.value}
              onFocus={item.onFocus}
              onBlur={item.onBlur}
              onChange={(e) => item.onChange(e.target.value)}
              {...fieldProps('item', {})}
            />
          </Field>
        </div>
        <Field id="quantity" label="How much" error={quantityError}>
          <input
            className={`${inputClass} tabular`}
            inputMode="decimal"
            placeholder="e.g. 50"
            value={quantity.value}
            onFocus={quantity.onFocus}
            onBlur={quantity.onBlur}
            onChange={(e) => quantity.onChange(e.target.value)}
            {...fieldProps('quantity', { error: quantityError })}
          />
        </Field>
        <Field id="unit" label="Unit">
          <select
            className={inputClass}
            id="unit"
            value={o.unit ?? ''}
            onChange={(e) => patch({ unit: e.target.value || null })}
          >
            <option value="">Choose…</option>
            {ORDER_UNITS.map((u: Unit) => (
              <option key={u} value={u}>
                {unitWord(u)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="deliver-by" label="Deliver by" error={dateError}>
          <input
            className={inputClass}
            type="date"
            min={indiaToday()}
            value={o.deliverBy ?? ''}
            onChange={(e) => {
              setDateError(null);
              patch({ deliverBy: e.target.value || null }, setDateError);
            }}
            {...fieldProps('deliver-by', { error: dateError })}
          />
        </Field>
        <Field id="area" label="Area" hint="Optional">
          <input
            className={inputClass}
            placeholder="e.g. Indiranagar"
            value={area.value}
            onFocus={area.onFocus}
            onBlur={area.onBlur}
            onChange={(e) => area.onChange(e.target.value)}
            {...fieldProps('area', { hint: true })}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field id="quality" label="Quality" hint="Optional, for example 'medium size, Nashik'">
            <input
              className={inputClass}
              value={quality.value}
              onFocus={quality.onFocus}
              onBlur={quality.onBlur}
              onChange={(e) => quality.onChange(e.target.value)}
              {...fieldProps('quality', { hint: true })}
            />
          </Field>
        </div>
      </div>
      {error && (
        <div className="mt-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
    </Card>
  );
}

function SuppliersCard({ view }: { view: OrderView }) {
  const setView = useSetView(view.order.id);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [language, setLanguage] = useState<(typeof LANGUAGES)[number]>('hi');
  const [agreed, setAgreed] = useState(false);
  const [howAgreed, setHowAgreed] = useState('');
  const [errors, setErrors] = useState<{
    name?: string;
    phone?: string;
    agreed?: string;
    howAgreed?: string;
    form?: string;
  }>({});
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!name.trim()) next.name = 'Add the supplier’s name.';
    if (!phone.trim()) next.phone = 'Add a 10-digit mobile number.';
    if (!howAgreed.trim()) next.howAgreed = 'Note how they agreed, for your records.';
    if (!agreed) next.agreed = 'Bhaav only calls suppliers who agreed to take its call.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      const updated = await api<OrderView>(`/api/requests/${view.order.id}/suppliers`, {
        json: { name, phone, language, consentNote: howAgreed.trim() },
      });
      setView(updated);
      setName('');
      setPhone('');
      setHowAgreed('');
      setAgreed(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not add the supplier.';
      setErrors(/number|mobile|list/i.test(message) ? { phone: message } : { form: message });
    } finally {
      setBusy(false);
    }
  }

  async function remove(supplier: SupplierDto) {
    try {
      setView(
        await api<OrderView>(`/api/requests/${view.order.id}/suppliers/${supplier.id}`, {
          method: 'DELETE',
        }),
      );
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Could not remove the supplier.' });
    }
  }

  return (
    <Card
      title="Who to call"
      icon={UsersThree}
      aside={<span className="tabular text-sm text-muted-fg">{view.suppliers.length} added</span>}
    >
      {view.suppliers.length > 0 ? (
        <ul className="mb-5 divide-y divide-border">
          {view.suppliers.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-medium">{s.name}</p>
                <p className="tabular text-sm text-muted-fg">
                  {phoneLabel(s.phone)} ·{' '}
                  {LANGUAGE_LABELS[s.language as keyof typeof LANGUAGE_LABELS] ?? s.language}
                  {s.doNotCall && ' · asked not to be called'}
                </p>
              </div>
              <Button
                variant="ghost-danger"
                icon={Trash}
                onClick={() => remove(s)}
                aria-label={`Remove ${s.name}`}
              >
                <span className="hidden sm:inline">Remove</span>
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-muted-fg">
          Add the suppliers you already buy from. Bhaav calls them one at a time.
        </p>
      )}
      <form onSubmit={add} className="flex flex-col gap-4" noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="supplier-name" label="Name" error={errors.name}>
            <input
              className={inputClass}
              placeholder="e.g. Gupta Traders"
              value={name}
              onChange={(e) => setName(e.target.value)}
              {...fieldProps('supplier-name', { error: errors.name })}
            />
          </Field>
          <Field id="supplier-phone" label="Mobile number" error={errors.phone}>
            <input
              className={`${inputClass} tabular`}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="e.g. 98765 43210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              {...fieldProps('supplier-phone', { error: errors.phone })}
            />
          </Field>
        </div>
        <Field id="supplier-language" label="Speaks">
          <select
            className={inputClass}
            id="supplier-language"
            value={language}
            onChange={(e) => setLanguage(e.target.value as (typeof LANGUAGES)[number])}
          >
            {(Object.keys(LANGUAGE_LABELS) as Array<(typeof LANGUAGES)[number]>).map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_LABELS[code]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id="supplier-consent"
          label="How they agreed"
          hint="For your records, e.g. 'said yes on WhatsApp, 21 Oct'"
          error={errors.howAgreed}
        >
          <input
            className={inputClass}
            maxLength={200}
            value={howAgreed}
            onChange={(e) => setHowAgreed(e.target.value)}
            {...fieldProps('supplier-consent', { hint: true, error: errors.howAgreed })}
          />
        </Field>
        <div>
          <label
            className="flex min-h-11 cursor-pointer items-start gap-3 text-sm"
            htmlFor="supplier-agreed"
          >
            <input
              id="supplier-agreed"
              type="checkbox"
              className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              aria-describedby={errors.agreed ? 'supplier-agreed-error' : undefined}
              aria-invalid={errors.agreed ? true : undefined}
            />
            <span>This supplier agreed to take a call from Bhaav, an AI assistant.</span>
          </label>
          {errors.agreed && (
            <p
              id="supplier-agreed-error"
              className="mt-1 flex items-start gap-1.5 text-sm text-danger"
              role="alert"
            >
              <WarningCircle size={18} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
              {errors.agreed}
            </p>
          )}
        </div>
        {errors.form && <Notice tone="danger">{errors.form}</Notice>}
        <Button type="submit" variant="secondary" busy={busy} icon={UserPlus}>
          Add supplier
        </Button>
      </form>
    </Card>
  );
}

function StartCard({ view }: { view: OrderView }) {
  const setView = useSetView(view.order.id);
  // An error is shown only while the order is as it was when the error happened; once the
  // buyer fills in what was missing, the old message would contradict the live list.
  const missingNow = view.missing.join('|');
  const [error, setError] = useState<{ text: string; missing: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ view: OrderView }>(`/api/requests/${view.order.id}/start`, {
        method: 'POST',
      });
      setView(result.view);
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Could not start the calls.';
      setError({ text, missing: missingNow });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Start calling" icon={PhoneCall}>
      <p className="mb-4 text-muted-fg">
        Bhaav calls one supplier at a time, then calls the costlier ones back with the best real
        offer. It never agrees to a deal: you choose at the end.
      </p>
      {view.missing.length > 0 && (
        <p className="mb-4 text-sm text-muted-fg">
          <span className="font-medium text-fg">Still needed:</span> {view.missing.join(', ')}.
        </p>
      )}
      {error && error.missing === missingNow && (
        <div className="mb-4">
          <Notice tone="danger">{error.text}</Notice>
        </div>
      )}
      <Button
        onClick={start}
        busy={busy}
        variant="cta"
        size="lg"
        className="w-full"
        icon={PhoneCall}
      >
        Start calling
      </Button>
    </Card>
  );
}

// ---- Live: calls, quote book, lie-catcher ----------------------------------------------------

const STAGE: Record<string, { label: string; tone: Tone }> = {
  calling: { label: 'Round 1: asking prices', tone: 'info' },
  bargaining: { label: 'Round 2: bargaining', tone: 'info' },
  done: { label: 'All calls done', tone: 'success' },
  approved: { label: 'Supplier chosen', tone: 'success' },
};

const ROUND_NAMES: Record<number, string> = { 1: 'Ask', 2: 'Bargain', 3: 'Confirm' };

/** Each round's latest try only: a call Bolna was too busy to place is tried again. */
function latestPerRound(calls: OrderView['calls']): OrderView['calls'] {
  const byRound = new Map<number, OrderView['calls'][number]>();
  for (const c of calls) byRound.set(c.round, c);
  return [...byRound.values()];
}

/** Why no call is live while calls are under way, in one sentence. */
function waitingSentence(view: OrderView): string | null {
  const { from, to } = view.callHours;
  switch (view.waitingFor) {
    case 'hours':
      return `Suppliers are called only between ${from}:00 and ${to}:00 India time, so the next call starts at ${from}:00.`;
    case 'another_call':
      return 'Bhaav is on a call for another order. The next call here starts as soon as that one ends.';
    case 'retry':
      return 'Bolna was busy, so Bhaav will try that call again in a minute.';
    default:
      return null;
  }
}

function LiveCalls({ view, desk }: { view: OrderView; desk: WebCall }) {
  const o = view.order;
  const stage = STAGE[o.status] ?? { label: o.status, tone: 'neutral' as const };
  const working = o.status === 'calling' || o.status === 'bargaining';
  const supplierName = (id: string) => view.suppliers.find((s) => s.id === id)?.name ?? 'Supplier';
  const liveCall = view.calls.find((c) => isLive(c.status));
  const quoted = new Set(view.quotes.map((q) => q.supplierId)).size;
  const callable = view.suppliers.filter(
    (s) => s.phone !== 'web' || view.calls.some((c) => c.supplierId === s.id),
  );
  // One status sentence for screen readers, instead of every badge announcing itself.
  const status = liveCall
    ? `${callLabel(liveCall.status)}: ${supplierName(liveCall.supplierId)}, round ${liveCall.round}. ${quoted} of ${callable.length} suppliers have quoted.`
    : `${stage.label}. ${quoted} of ${callable.length} suppliers have quoted.`;

  return (
    <>
      <PageTitle
        eyebrow={`For ${o.buyerName ?? 'you'}${o.isPractice ? ' · practice' : ''}`}
        title={`${o.quantity ?? ''} ${unitWord(o.unit)} ${o.item ?? ''}`.trim()}
        sub={`Deliver by ${dateLabel(o.deliverBy)}${o.area ? ` · ${o.area}` : ''}`}
        aside={
          <Pill tone={stage.tone} pulse={working}>
            {stage.label}
          </Pill>
        }
      />
      <p className="sr-only" role="status" aria-atomic="true">
        {status}
      </p>

      {desk.active && (
        <div className="surface mb-4 flex flex-wrap items-center gap-3 px-5 py-4">
          <Pill tone="info" pulse>
            Still talking to Bhaav
          </Pill>
          <div className="min-w-24 flex-1">
            <VoiceMeter level={desk.volume} />
          </div>
          <Button variant="secondary" icon={PhoneDisconnect} onClick={desk.stop}>
            End conversation
          </Button>
        </div>
      )}

      {working && !liveCall && waitingSentence(view) && (
        <div className="mb-4">
          <Notice tone="info" title="Waiting">
            {waitingSentence(view)}
          </Notice>
        </div>
      )}

      {!working &&
        (o.status === 'done' && view.quotes.length === 0 ? (
          // Finished with nothing to choose from: say why, not "every call is finished".
          <div className="mb-4">
            <Notice tone="warn" title="No supplier gave a price">
              {view.events.some((e) => e.detail?.reason === 'daily_limit')
                ? "Bhaav stopped because today's limit of phone calls is reached. Start a new order tomorrow."
                : 'The calls ended without a quote. Problems below says what happened.'}
            </Notice>
          </div>
        ) : (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[22px] bg-success-soft px-5 py-4 text-success">
            <p className="font-medium">
              {o.status === 'approved' ? 'You have chosen a supplier.' : 'Every call is finished.'}
            </p>
            <ButtonLink to={`/r/${o.id}/result`} variant="cta" icon={ArrowRight}>
              {o.status === 'approved' ? 'See the results' : 'See results and choose'}
            </ButtonLink>
          </div>
        ))}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Calls" icon={PhoneCall}>
            <ul className="divide-y divide-border">
              {callable.map((s) => {
                const own = latestPerRound(view.calls.filter((c) => c.supplierId === s.id));
                const latest = [...view.quotes].reverse().find((q) => q.supplierId === s.id);
                return (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold">{s.name}</p>
                      <p className="tabular text-sm text-muted-fg">
                        {latest
                          ? `${rupees(latest.price)} per ${latest.packSize ? `${latest.packSize} ${unitWord(latest.packUnit)} pack` : unitWord(latest.unit)}`
                          : 'No quote yet'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {own.length === 0 && <Pill>Not called yet</Pill>}
                      {own.map((c) => (
                        <Pill
                          key={c.id}
                          tone={
                            isLive(c.status)
                              ? 'info'
                              : c.status === 'completed'
                                ? 'success'
                                : 'warn'
                          }
                          pulse={isLive(c.status)}
                        >
                          {ROUND_NAMES[c.round] ?? `Round ${c.round}`}:{' '}
                          {c.status === 'failed' && c.retryable
                            ? 'Bolna busy, trying again'
                            : callLabel(c.status)}
                        </Pill>
                      ))}
                      {s.doNotCall && <Pill tone="danger">Asked not to be called</Pill>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
          <QuoteBook view={view} supplierName={supplierName} />
        </div>
        <LieCatcher view={view} />
      </div>
    </>
  );
}

function QuoteBook({
  view,
  supplierName,
}: {
  view: OrderView;
  supplierName: (id: string) => string;
}) {
  return (
    <Card
      title="Quote book"
      icon={ListChecks}
      aside={<span className="text-sm text-muted-fg">Written once, never edited</span>}
    >
      {view.quotes.length === 0 ? (
        <EmptyState icon={ListChecks} title="No quotes yet">
          A quote appears here the moment a supplier confirms it.
        </EmptyState>
      ) : (
        // Sized to the card, not the screen: a stacked list until the card is wide enough for the
        // table, so the quote book never scrolls sideways at any width.
        <div className="@container">
          <ul className="flex flex-col @min-[32rem]:hidden">
            {view.quotes.map((q) => (
              <li
                key={q.id}
                className="border-t border-border py-4 first:border-t-0 first:pt-0 last:pb-0"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 font-semibold">{supplierName(q.supplierId)}</span>
                  <span className="shrink-0 text-right">
                    <span className="tabular text-[21px] font-bold tracking-tight">
                      {rupees(q.landedPricePerUnit)}
                    </span>
                    <span className="text-sm text-muted-fg">
                      {' '}
                      per {unitWord(view.order.unit)}, delivered
                    </span>
                  </span>
                </div>
                <p className="tabular mt-0.5 text-sm text-muted-fg">
                  {timeLabel(q.createdAt)} · quoted {rupees(q.price)} /{' '}
                  {q.packSize ? `${q.packSize} ${unitWord(q.packUnit)}` : unitWord(q.unit)}
                  {q.deliveryCharge ? ` + ${rupees(q.deliveryCharge)} delivery` : ''}
                </p>
                <p className="mt-1 text-[15px] text-muted-fg">“{q.supplierWords}”</p>
              </li>
            ))}
          </ul>
          <table className="hidden w-full text-left text-[15px] @min-[32rem]:table">
            <caption className="sr-only">Every quote suppliers confirmed, oldest first</caption>
            <thead className="text-muted-fg">
              <tr className="border-b border-border">
                <th scope="col" className="pb-3 pr-3 text-sm font-medium">
                  Time
                </th>
                <th scope="col" className="pb-3 pr-3 text-sm font-medium">
                  Supplier
                </th>
                <th scope="col" className="pb-3 pr-3 text-sm font-medium">
                  Quote
                </th>
                <th scope="col" className="pb-3 pr-3 text-sm font-medium">
                  Per {unitWord(view.order.unit)}, delivered
                </th>
                <th scope="col" className="pb-3 text-sm font-medium">
                  Their words
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {view.quotes.map((q) => (
                <tr key={q.id}>
                  <td className="tabular whitespace-nowrap py-3 pr-3 text-muted-fg">
                    {timeLabel(q.createdAt)}
                  </td>
                  <td className="py-3 pr-3">{supplierName(q.supplierId)}</td>
                  <td className="tabular py-3 pr-3">
                    {/* The price and its unit stay on one line; a delivery charge may wrap. */}
                    <span className="whitespace-nowrap">
                      {rupees(q.price)} /{' '}
                      {q.packSize ? `${q.packSize} ${unitWord(q.packUnit)}` : unitWord(q.unit)}
                    </span>
                    {q.deliveryCharge ? ` + ${rupees(q.deliveryCharge)} delivery` : ''}
                  </td>
                  <td className="tabular whitespace-nowrap py-3 pr-3 font-semibold">
                    {rupees(q.landedPricePerUnit)}
                  </td>
                  <td className="py-3 text-muted-fg">“{q.supplierWords}”</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function LieCatcher({ view }: { view: OrderView }) {
  const blocked = view.events.filter((e) => e.type === 'blocked' || e.type === 'tool_blocked');
  const problems = view.events.filter((e) => e.type === 'error' || e.type === 'upstream_down');
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card
        title="Lie-catcher"
        icon={ShieldCheck}
        aside={<Pill tone={blocked.length ? 'danger' : 'success'}>{blocked.length} stopped</Pill>}
      >
        <p className="text-muted-fg">
          Before Bhaav says anything, every number is checked. It may read back what the supplier
          said, but any offer it mentions must be in the quote book. A number it can't prove is
          never spoken.
        </p>
        {blocked.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2">
            {blocked.map((e) => (
              <li
                key={e.id}
                className="rounded-2xl bg-danger-soft px-4 py-3 text-[15px] text-danger"
              >
                <p className="font-semibold">
                  {e.type === 'blocked'
                    ? `Stopped ${((e.detail?.unbacked as number[] | undefined) ?? []).map((n) => rupees(n)).join(', ')}: not in the quote book`
                    : 'Stopped saving a price the supplier never said'}
                </p>
                {typeof e.detail?.sentence === 'string' && (
                  <p className="mt-0.5">“{e.detail.sentence}”</p>
                )}
                <p className="tabular mt-0.5 text-xs">{timeLabel(e.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {problems.length > 0 && (
        <Card title="Problems" icon={WarningCircle}>
          <ul className="flex flex-col gap-2 text-sm text-muted-fg">
            {problems.slice(0, 5).map((e) => (
              <li key={e.id}>
                <span className="tabular">{timeLabel(e.createdAt)}</span>:{' '}
                {typeof e.detail?.message === 'string'
                  ? e.detail.message
                  : 'The AI did not answer in time; Bhaav said its safe line.'}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
