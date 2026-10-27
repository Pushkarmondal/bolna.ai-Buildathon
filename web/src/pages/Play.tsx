// "Be the supplier": a judge takes Bhaav's round-2 call in the browser and tries to make it lie.

import type { Persona } from '@bhaav/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type PracticeReview, useBreakStats, usePersonas } from '../api';
import { rupees, timeLabel } from '../format';
import {
  ArrowRight,
  Lightbulb,
  Medal,
  PhoneDisconnect,
  ShieldCheck,
  Storefront,
  Timer,
} from '../icons';
import { Transcript, TranscriptLegend } from '../transcript';
import {
  Button,
  ButtonLink,
  Card,
  Notice,
  PageTitle,
  Pill,
  useDocumentTitle,
  VoiceMeter,
} from '../ui';
import { useWebCall } from '../webcall';
import { WatchButton } from './Home';

const LIMIT_SECONDS = 120;

export function PlayPage() {
  useDocumentTitle('Be the supplier');
  const personas = usePersonas();
  const call = useWebCall();
  const [chosen, setChosen] = useState<Persona | null>(null);
  const [seconds, setSeconds] = useState(0);

  // The two-minute cap: counted from when Bhaav answers.
  useEffect(() => {
    if (call.state !== 'active') return;
    setSeconds(0);
    const started = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      setSeconds(elapsed);
      if (elapsed >= LIMIT_SECONDS) call.stop();
    }, 500);
    return () => clearInterval(timer);
  }, [call.state, call.stop]);

  const callId = call.minted?.callId;
  const review = useQuery({
    queryKey: ['practice', callId],
    queryFn: () => api<PracticeReview>(`/api/practice/${callId}`),
    enabled: Boolean(callId) && call.state === 'ended',
    // Until Bolna's own transcript arrives, for two minutes at most.
    refetchInterval: (q) =>
      q.state.data?.transcript || q.state.dataUpdateCount > 40 ? false : 3000,
  });

  function take(persona: Persona) {
    setChosen(persona);
    call.start({ kind: 'practice', personaId: persona.id });
  }

  return (
    <>
      <PageTitle
        eyebrow="Practice"
        title="Be the supplier"
        sub="Pick a supplier to play. Bhaav calls you in the browser holding a real competing offer. Try to make it say a price it can't prove."
        aside={<Pill tone="warn">Pretend supplier, no real calls</Pill>}
      />

      <Scoreboard />

      {chosen && (call.state !== 'idle' || call.error) && (
        <div className="mb-6">
          <Card
            title={`You are ${chosen.supplierName}`}
            icon={Storefront}
            aside={
              call.active ? (
                <Pill tone="info" pulse icon={Timer}>
                  <span className="tabular">
                    {call.state === 'active' ? `${LIMIT_SECONDS - seconds}s left` : 'Connecting…'}
                  </span>
                </Pill>
              ) : call.error && call.state === 'idle' ? (
                <Pill tone="danger">Did not connect</Pill>
              ) : (
                <Pill>Call ended</Pill>
              )
            }
          >
            <dl className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-bg p-4">
                <dt className="text-sm text-muted-fg">Your opening</dt>
                <dd className="font-medium">{chosen.opening}</dd>
              </div>
              <div className="rounded-2xl bg-bg p-4">
                <dt className="text-sm text-muted-fg">Your secret floor</dt>
                <dd className="font-medium">{chosen.floor}</dd>
              </div>
              <div className="rounded-2xl bg-bg p-4">
                <dt className="text-sm text-muted-fg">Bhaav's real offer</dt>
                <dd className="tabular font-medium">{chosen.bestOffer}</dd>
              </div>
            </dl>
            <p className="mt-3 flex items-start gap-2 text-sm text-muted-fg">
              <Lightbulb size={18} className="mt-0.5 shrink-0 text-warn" aria-hidden />
              <span>Try this: {chosen.tip}</span>
            </p>
            {call.active && (
              <div className="mt-4 flex flex-col gap-3">
                <VoiceMeter level={call.volume} />
                <Button variant="danger" size="lg" icon={PhoneDisconnect} onClick={call.stop}>
                  Hang up
                </Button>
              </div>
            )}
            {call.error && (
              <div className="mt-4">
                <Notice tone="danger">{call.error}</Notice>
              </div>
            )}
          </Card>
        </div>
      )}

      {call.state === 'ended' && callId && (
        <Review
          review={review.data}
          requestId={call.minted?.requestId}
          loading={!review.data?.transcript && !review.data?.turns?.length}
        />
      )}

      {personas.isPending && <p className="text-muted-fg">Loading suppliers…</p>}
      {personas.error && <Notice tone="danger">{personas.error.message}</Notice>}
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {personas.data?.map((p) => (
          <li key={p.id} className="surface flex flex-col p-6">
            <h2 className="flex items-center gap-2.5 text-[21px] font-semibold leading-tight">
              <Storefront size={22} className="shrink-0 text-muted-fg" aria-hidden />
              {p.supplierName}
            </h2>
            <p className="mt-1 text-muted-fg">
              Bhaav wants {p.quantity} {p.unit === 'kg' ? 'kilo' : p.unit} of {p.item}.
            </p>
            <ul className="my-4 flex flex-col gap-1 text-sm">
              <li>{p.opening}</li>
              <li>{p.floor}</li>
              <li className="text-muted-fg">Bhaav holds a real offer of {p.bestOffer}.</li>
            </ul>
            <Button
              className="mt-auto w-full"
              variant="primary"
              busy={call.active && chosen?.id === p.id}
              onClick={() => (call.active ? undefined : take(p))}
              aria-disabled={call.active && chosen?.id !== p.id ? true : undefined}
            >
              Take Bhaav's call
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-muted-fg">
        Calls stop after 2 minutes. Practice orders are labelled practice, never call anyone, and
        never count in price memory.
      </p>
      <WatchButton className="mt-8" />
    </>
  );
}

function Review({
  review,
  requestId,
  loading,
}: {
  review?: PracticeReview;
  requestId?: string;
  loading: boolean;
}) {
  const lines = (review?.transcript ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, n) => {
      const m = /^(assistant|user|bot|agent|human)\s*:\s*(.*)$/i.exec(l);
      const who = m?.[1]?.toLowerCase() ?? '';
      return {
        id: `line-${n}`,
        bhaav: ['assistant', 'bot', 'agent'].includes(who),
        text: m?.[2] ?? l,
      };
    });
  const blocked = review?.blocked ?? [];

  return (
    <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Card
        title="What the lie-catcher did"
        icon={ShieldCheck}
        aside={<Pill tone={blocked.length ? 'danger' : 'success'}>{blocked.length} stopped</Pill>}
      >
        {blocked.length === 0 ? (
          <p className="text-muted-fg">
            Nothing to stop: every number Bhaav said came from the quote book or from you.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {blocked.map((b) => (
              <li
                key={b.createdAt}
                className="rounded-2xl bg-danger-soft px-4 py-3 text-[15px] text-danger"
              >
                <p className="font-semibold">
                  {b.type === 'blocked'
                    ? `Stopped Bhaav from saying ${((b.detail?.unbacked as number[] | undefined) ?? []).map((n) => rupees(n)).join(', ')}.`
                    : 'Stopped Bhaav from saving a price you never said.'}
                </p>
                {typeof b.detail?.sentence === 'string' && (
                  <p className="mt-0.5">“{b.detail.sentence}”</p>
                )}
              </li>
            ))}
          </ul>
        )}
        {review?.quotes && review.quotes.length > 0 && (
          <div className="mt-4 text-sm">
            <p className="font-medium">Quotes Bhaav saved from you</p>
            <ul className="mt-1 list-disc pl-5 text-muted-fg">
              {review.quotes.map((q) => (
                <li key={`${q.price}-${q.supplierWords}`} className="tabular">
                  {rupees(q.price)} per {q.packSize ? `${q.packSize}-unit pack` : q.unit}: “
                  {q.supplierWords}”
                </li>
              ))}
            </ul>
          </div>
        )}
        {requestId && (
          <ButtonLink
            to={`/r/${requestId}`}
            variant="ghost"
            className="-ml-5 mt-3"
            icon={ArrowRight}
          >
            Open the practice quote book
          </ButtonLink>
        )}
      </Card>
      <Card title="Transcript">
        {review?.turns && review.turns.length > 0 ? (
          <>
            <TranscriptLegend />
            <Transcript turns={review.turns} otherName="You" />
          </>
        ) : loading ? (
          <p className="text-muted-fg">Waiting for Bolna's transcript, usually a few seconds…</p>
        ) : (
          <ol className="flex max-h-96 flex-col gap-2 overflow-y-auto text-sm">
            {lines.map((l) => (
              <li key={l.id} className={l.bhaav ? 'text-fg' : 'text-muted-fg'}>
                <span className="font-semibold">{l.bhaav ? 'Bhaav' : 'You'}:</span> {l.text}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

/**
 * "Break Bhaav": every judge's tries and what the lie-catcher did with them, newest first. Possible
 * slips are counted and shown, not hidden: a number only the judge said, stated by Bhaav.
 */
function Scoreboard() {
  const stats = useBreakStats();
  const s = stats.data;
  if (!s) return null;
  return (
    <section
      aria-labelledby="break-bhaav"
      className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
    >
      <div className="surface p-6">
        <h2 id="break-bhaav" className="flex items-center gap-2.5 text-[21px] font-semibold">
          <Medal size={22} className="text-muted-fg" aria-hidden />
          Break Bhaav
        </h2>
        <p className="mt-1 text-muted-fg">Every judge's tries so far.</p>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-2xl bg-bg p-3">
            <dt className="text-xs text-muted-fg">Practice calls</dt>
            <dd className="tabular text-[28px] font-bold">{s.calls}</dd>
          </div>
          <div className="rounded-2xl bg-danger-soft p-3 text-danger">
            <dt className="text-xs">Lies stopped</dt>
            <dd className="tabular text-[28px] font-bold">{s.stopped}</dd>
          </div>
          <div
            className={`rounded-2xl p-3 ${s.possibleSlips ? 'bg-warn-soft text-warn' : 'bg-success-soft text-success'}`}
          >
            <dt className="text-xs">Possible slips</dt>
            <dd className="tabular text-[28px] font-bold">{s.possibleSlips}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-muted-fg">
          A possible slip is Bhaav stating a number only you said. It is counted here so a person
          can check it, never hidden.
        </p>
      </div>
      <div className="surface p-6">
        <h2 className="text-[21px] font-semibold">Hall of tricks</h2>
        {s.tricks.length === 0 ? (
          <p className="mt-2 text-muted-fg">
            Nobody has caught Bhaav out yet. Be the first to try.
          </p>
        ) : (
          <ul className="mt-3 flex max-h-80 flex-col gap-3 overflow-y-auto pr-1">
            {s.tricks.map((t) => (
              <li key={`${t.callId}-${t.createdAt}`} className="rounded-2xl bg-bg p-4 text-[15px]">
                <p className="text-xs text-muted-fg">
                  {t.persona} · <span className="tabular">{timeLabel(t.createdAt)}</span>
                </p>
                {t.heard && <p className="mt-1">Judge: “{t.heard}”</p>}
                {t.stopped && (
                  <p className="mt-1 text-danger">
                    Bhaav nearly said:{' '}
                    <span className="line-through decoration-2">“{t.stopped}”</span>
                  </p>
                )}
                <p className={`mt-1 ${t.slip ? 'text-warn' : 'text-success'}`}>
                  {t.slip ? 'Possible slip: ' : 'Said instead: '}“{t.said}”
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
