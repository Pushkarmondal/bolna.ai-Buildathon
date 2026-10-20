// One order: while it's a draft, the buyer talks to the Desk (or types) and lists suppliers;
// once calls start, the same page shows each call live, the quote book and the lie-catcher.

import type { LANGUAGES, OrderView, SupplierDto, Unit } from '@bhaav/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, lastOrder, useOrder } from '../api';
import { callLabel, dateLabel, isLive, ORDER_UNITS, rupees, timeLabel, unitWord } from '../format';
import { Button, Card, Field, inputClass, Notice, PageTitle, Pill, VoiceMeter } from '../ui';
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

  if (order.isPending) return <p className="text-stone-500">Loading the order…</p>;
  if (order.error || !order.data) {
    return <Notice tone="bad">{order.error?.message ?? 'This order could not be loaded.'}</Notice>;
  }
  const view = order.data;
  return view.order.status === 'draft' ? (
    <DraftOrder view={view} desk={desk} />
  ) : (
    <LiveCalls view={view} desk={desk} />
  );
}

// ---- Draft: talk, edit, add suppliers, start ----------------------------------------------

function useSetView(id: string) {
  const queryClient = useQueryClient();
  return (view: OrderView) => queryClient.setQueryData(['order', id], view);
}

function DraftOrder({ view, desk }: { view: OrderView; desk: WebCall }) {
  return (
    <>
      <PageTitle
        title={`Order for ${view.order.buyerName ?? 'you'}`}
        sub="Tell Bhaav what you need, or type it. Then add the suppliers Bhaav should call."
        aside={<Pill>Draft</Pill>}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <TalkCard requestId={view.order.id} call={desk} />
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
      aside={
        call.state === 'active' ? (
          <Pill tone="live" pulse>
            Listening
          </Pill>
        ) : null
      }
    >
      <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">
        Say it in Hindi, Hinglish or English: "50 kilo pyaaz chahiye, Friday tak, Indiranagar." The
        order card fills in as you speak.
      </p>
      <div className="flex flex-col gap-3">
        <Button
          variant={call.active ? 'danger' : 'primary'}
          busy={call.state === 'connecting' || call.state === 'ringing'}
          onClick={() =>
            call.state === 'active' ? call.stop() : call.start({ kind: 'desk', requestId })
          }
        >
          {label}
        </Button>
        {call.state === 'active' && <VoiceMeter level={call.volume} />}
        {call.error && <Notice tone="bad">{call.error}</Notice>}
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
  const o = view.order;

  const patch = (body: Record<string, unknown>) => {
    setError(null);
    api<OrderView>(`/api/requests/${o.id}`, { method: 'PATCH', json: body })
      .then(setView)
      .catch((e: Error) => setError(e.message));
  };

  const item = useLiveField(o.item ?? '', (v) => patch({ item: v.trim() || null }));
  const quantity = useLiveField(o.quantity == null ? '' : String(o.quantity), (v) => {
    const n = Number(v);
    if (v.trim() === '') patch({ quantity: null });
    else if (Number.isFinite(n) && n > 0) patch({ quantity: n });
    else setError('Quantity must be a number above zero.');
  });
  const quality = useLiveField(o.quality ?? '', (v) => patch({ quality: v.trim() || null }));
  const area = useLiveField(o.area ?? '', (v) => patch({ area: v.trim() || null }));

  return (
    <Card
      title="Order card"
      aside={view.missing.length === 0 ? <Pill tone="good">Ready</Pill> : null}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="What to buy">
            <input
              className={inputClass}
              placeholder="red onions"
              value={item.value}
              onFocus={item.onFocus}
              onBlur={item.onBlur}
              onChange={(e) => item.onChange(e.target.value)}
            />
          </Field>
        </div>
        <Field label="How much">
          <input
            className={inputClass}
            inputMode="decimal"
            placeholder="50"
            value={quantity.value}
            onFocus={quantity.onFocus}
            onBlur={quantity.onBlur}
            onChange={(e) => quantity.onChange(e.target.value)}
          />
        </Field>
        <Field label="Unit">
          <select
            className={inputClass}
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
        <Field label="Deliver by">
          <input
            className={inputClass}
            type="date"
            value={o.deliverBy ?? ''}
            onChange={(e) => patch({ deliverBy: e.target.value || null })}
          />
        </Field>
        <Field label="Area" hint="Optional">
          <input
            className={inputClass}
            placeholder="Indiranagar"
            value={area.value}
            onFocus={area.onFocus}
            onBlur={area.onBlur}
            onChange={(e) => area.onChange(e.target.value)}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Quality" hint="Optional, e.g. 'medium size, Nashik'">
            <input
              className={inputClass}
              value={quality.value}
              onFocus={quality.onFocus}
              onBlur={quality.onBlur}
              onChange={(e) => quality.onChange(e.target.value)}
            />
          </Field>
        </div>
      </div>
      {error && (
        <div className="mt-3">
          <Notice tone="bad">{error}</Notice>
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    const problems: string[] = [];
    if (!name.trim()) problems.push('a name');
    if (!phone.trim()) problems.push('a phone number');
    if (!agreed) problems.push("a tick to confirm they agreed to take Bhaav's call");
    if (problems.length) {
      setError(`Add ${problems.join(', ')}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await api<OrderView>(`/api/requests/${view.order.id}/suppliers`, {
        json: { name, phone, language, consentNote: "Agreed to take Bhaav's call" },
      });
      setView(next);
      setName('');
      setPhone('');
      setAgreed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the supplier.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(supplier: SupplierDto) {
    setError(null);
    try {
      setView(
        await api<OrderView>(`/api/requests/${view.order.id}/suppliers/${supplier.id}`, {
          method: 'DELETE',
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the supplier.');
    }
  }

  return (
    <Card
      title="Suppliers to call"
      aside={<span className="text-sm text-stone-500">{view.suppliers.length} added</span>}
    >
      {view.suppliers.length > 0 && (
        <ul className="mb-4 divide-y divide-stone-100 dark:divide-stone-800">
          {view.suppliers.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{s.name}</div>
                <div className="text-stone-500">
                  {s.phone} · {s.language === 'en' ? 'English' : 'Hindi'}
                  {s.doNotCall && ' · asked not to be called'}
                </div>
              </div>
              <Button variant="secondary" onClick={() => remove(s)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input
              className={inputClass}
              placeholder="Gupta Traders"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Mobile number">
            <input
              className={inputClass}
              inputMode="tel"
              placeholder="98765 43210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Speaks">
          <select
            className={inputClass}
            value={language}
            onChange={(e) => setLanguage(e.target.value as 'hi' | 'en')}
          >
            <option value="hi">Hindi or Hinglish</option>
            <option value="en">English</option>
          </select>
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>This supplier agreed to take a call from Bhaav, an AI assistant.</span>
        </label>
        {error && <Notice tone="bad">{error}</Notice>}
        <Button type="submit" variant="secondary" busy={busy}>
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
    <Card title="Start calling">
      <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">
        Bhaav calls one supplier at a time, then calls the costlier ones back with the best real
        offer. It never agrees to a deal: you choose at the end.
      </p>
      {view.missing.length > 0 && (
        <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">
          Still needed: {view.missing.join(', ')}.
        </p>
      )}
      {error && error.missing === missingNow && (
        <div className="mb-3">
          <Notice tone="bad">{error.text}</Notice>
        </div>
      )}
      <Button onClick={start} busy={busy} className="w-full">
        Start calling
      </Button>
    </Card>
  );
}

// ---- Live: calls, quote book, lie-catcher ----------------------------------------------------

const STAGE: Record<string, { label: string; tone: 'live' | 'good' | 'neutral' }> = {
  calling: { label: 'Round 1: asking prices', tone: 'live' },
  bargaining: { label: 'Round 2: bargaining', tone: 'live' },
  done: { label: 'All calls done', tone: 'good' },
  approved: { label: 'Approved', tone: 'good' },
};

function LiveCalls({ view, desk }: { view: OrderView; desk: WebCall }) {
  const o = view.order;
  const stage = STAGE[o.status] ?? { label: o.status, tone: 'neutral' as const };
  const working = o.status === 'calling' || o.status === 'bargaining';
  const supplierName = (id: string) => view.suppliers.find((s) => s.id === id)?.name ?? 'Supplier';

  return (
    <>
      <PageTitle
        title={`${o.quantity ?? ''} ${unitWord(o.unit)} ${o.item ?? ''}`.trim()}
        sub={`For ${o.buyerName ?? 'you'} · deliver by ${dateLabel(o.deliverBy)}${o.area ? ` · ${o.area}` : ''}${o.isPractice ? ' · practice' : ''}`}
        aside={
          <Pill tone={stage.tone} pulse={working}>
            {stage.label}
          </Pill>
        }
      />
      {desk.active && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-900">
          <Pill tone="live" pulse>
            Still talking to Bhaav
          </Pill>
          <div className="min-w-24 flex-1">
            <VoiceMeter level={desk.volume} />
          </div>
          <Button variant="secondary" onClick={desk.stop}>
            End conversation
          </Button>
        </div>
      )}
      {!working && (
        <div className="mb-4">
          <Notice tone="good">
            {o.status === 'approved' ? 'You have chosen a supplier.' : 'Every call is finished.'}{' '}
            <Link className="font-medium underline underline-offset-4" to={`/r/${o.id}/result`}>
              {o.status === 'approved'
                ? 'See the results'
                : 'See the results and choose a supplier'}
            </Link>
            .
          </Notice>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Calls">
            <ul className="divide-y divide-stone-100 dark:divide-stone-800">
              {view.suppliers
                .filter((s) => s.phone !== 'web' || view.calls.some((c) => c.supplierId === s.id))
                .map((s) => {
                  const own = view.calls.filter((c) => c.supplierId === s.id);
                  const latest = [...view.quotes].reverse().find((q) => q.supplierId === s.id);
                  return (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="font-medium">{s.name}</div>
                        <div className="text-stone-500">
                          {latest
                            ? `${rupees(latest.price)} per ${unitWord(latest.unit)}${latest.packSize ? ` (${latest.packSize} ${unitWord(latest.packUnit)})` : ''}`
                            : 'No quote yet'}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {own.length === 0 && <Pill>Not called yet</Pill>}
                        {own.map((c) => (
                          <Pill
                            key={c.id}
                            tone={
                              isLive(c.status) ? 'live' : c.status === 'completed' ? 'good' : 'warn'
                            }
                            pulse={isLive(c.status)}
                          >
                            Round {c.round}: {callLabel(c.status)}
                          </Pill>
                        ))}
                        {s.doNotCall && <Pill tone="bad">Asked not to be called</Pill>}
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
      aside={<span className="text-xs text-stone-500">Written once, never edited</span>}
    >
      {view.quotes.length === 0 ? (
        <p className="text-sm text-stone-500">
          Quotes appear here the moment a supplier confirms one.
        </p>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="text-xs text-stone-500">
              <tr>
                <th className="py-1 pr-3 font-medium">Time</th>
                <th className="py-1 pr-3 font-medium">Supplier</th>
                <th className="py-1 pr-3 font-medium">Quote</th>
                <th className="py-1 pr-3 font-medium">
                  Per {unitWord(view.order.unit)}, delivered
                </th>
                <th className="py-1 font-medium">Their words</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {view.quotes.map((q) => (
                <tr key={q.id}>
                  <td className="py-2 pr-3 whitespace-nowrap text-stone-500">
                    {timeLabel(q.createdAt)}
                  </td>
                  <td className="py-2 pr-3">{supplierName(q.supplierId)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {rupees(q.price)} /{' '}
                    {q.packSize ? `${q.packSize} ${unitWord(q.packUnit)}` : unitWord(q.unit)}
                    {q.deliveryCharge ? ` + ${rupees(q.deliveryCharge)} delivery` : ''}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap font-medium">
                    {rupees(q.landedPricePerUnit)}
                  </td>
                  <td className="py-2 text-stone-600 dark:text-stone-400">"{q.supplierWords}"</td>
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
  const errors = view.events.filter((e) => e.type === 'error' || e.type === 'upstream_down');
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card
        title="Lie-catcher"
        aside={<Pill tone={blocked.length ? 'bad' : 'good'}>{blocked.length} blocked</Pill>}
      >
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Before Bhaav says anything, every number is checked against the quote book and what the
          supplier just said. A number it can't prove is never spoken.
        </p>
        {blocked.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {blocked.map((e) => (
              <li
                key={e.id}
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100"
              >
                <div className="font-medium">
                  {e.type === 'blocked'
                    ? `Blocked ${((e.detail?.unbacked as number[] | undefined) ?? []).map((n) => rupees(n)).join(', ')}: not in the quote book`
                    : 'Blocked a quote the supplier never said'}
                </div>
                {typeof e.detail?.sentence === 'string' && (
                  <div className="mt-0.5 text-red-800/80 dark:text-red-200/80">
                    "{e.detail.sentence}"
                  </div>
                )}
                <div className="mt-0.5 text-xs text-red-700/70 dark:text-red-300/70">
                  {timeLabel(e.createdAt)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {errors.length > 0 && (
        <Card title="Problems">
          <ul className="flex flex-col gap-1 text-sm text-stone-600 dark:text-stone-400">
            {errors.slice(0, 5).map((e) => (
              <li key={e.id}>
                {timeLabel(e.createdAt)}:{' '}
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
