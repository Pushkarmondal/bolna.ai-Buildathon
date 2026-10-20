// "Be the supplier": a judge takes Bhaav's round-2 call in the browser and tries to make it lie.

import type { Persona } from '@bhaav/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, type PracticeReview, usePersonas } from '../api';
import { rupees } from '../format';
import { Button, Card, Notice, PageTitle, Pill, VoiceMeter } from '../ui';
import { useWebCall } from '../webcall';

const LIMIT_SECONDS = 120;

export function PlayPage() {
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
    refetchInterval: (q) => (q.state.data?.transcript ? false : 3000),
  });

  function take(persona: Persona) {
    setChosen(persona);
    call.start({ kind: 'practice', personaId: persona.id });
  }

  return (
    <>
      <PageTitle
        title="Be the supplier"
        sub="Pick a supplier to play. Bhaav will call you in the browser with a real competing offer. Try to make it say a price it can't prove."
        aside={<Pill tone="warn">Practice: pretend supplier</Pill>}
      />

      {chosen && (call.state !== 'idle' || call.error) && (
        <div className="mb-4">
          <Card
            title={`You are ${chosen.supplierName}`}
            aside={
              call.active ? (
                <Pill tone="live" pulse>
                  {call.state === 'active' ? `${LIMIT_SECONDS - seconds}s left` : 'Connecting…'}
                </Pill>
              ) : call.error && call.state === 'idle' ? (
                <Pill tone="bad">Did not connect</Pill>
              ) : (
                <Pill>Call ended</Pill>
              )
            }
          >
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <div className="text-stone-500">Your opening</div>
                <div className="font-medium">{chosen.opening}</div>
              </div>
              <div>
                <div className="text-stone-500">Your secret floor</div>
                <div className="font-medium">{chosen.floor}</div>
              </div>
              <div>
                <div className="text-stone-500">Bhaav's real offer</div>
                <div className="font-medium">{chosen.bestOffer}</div>
              </div>
            </div>
            <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
              Try this: {chosen.tip}
            </p>
            {call.active && (
              <div className="mt-3 flex flex-col gap-3">
                <VoiceMeter level={call.volume} />
                <Button variant="danger" onClick={call.stop}>
                  Hang up
                </Button>
              </div>
            )}
            {call.error && (
              <div className="mt-3">
                <Notice tone="bad">{call.error}</Notice>
              </div>
            )}
          </Card>
        </div>
      )}

      {call.state === 'ended' && callId && (
        <Review
          review={review.data}
          requestId={call.minted?.requestId}
          loading={!review.data?.transcript}
        />
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {personas.isPending && <p className="text-stone-500">Loading suppliers…</p>}
        {personas.error && <Notice tone="bad">{personas.error.message}</Notice>}
        {personas.data?.map((p) => (
          <Card key={p.id} title={p.supplierName}>
            <p className="text-sm text-stone-600 dark:text-stone-400">
              Bhaav wants {p.quantity} {p.unit === 'kg' ? 'kilo' : p.unit} of {p.item}.
            </p>
            <ul className="my-3 space-y-1 text-sm">
              <li>{p.opening}</li>
              <li>{p.floor}</li>
              <li className="text-stone-500">Bhaav holds a real offer of {p.bestOffer}.</li>
            </ul>
            <Button
              className="w-full"
              busy={call.active && chosen?.id === p.id}
              disabled={call.active}
              onClick={() => take(p)}
            >
              Take Bhaav's call
            </Button>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-sm text-stone-500">
        Calls stop after 2 minutes. Practice orders are labelled practice and never call anyone.
      </p>
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
    <div className="mb-6 grid gap-4 lg:grid-cols-[2fr_3fr]">
      <Card
        title="What the lie-catcher did"
        aside={<Pill tone={blocked.length ? 'bad' : 'good'}>{blocked.length} blocked</Pill>}
      >
        {blocked.length === 0 ? (
          <p className="text-sm text-stone-600 dark:text-stone-400">
            Nothing to block: every number Bhaav said came from the quote book or from you.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {blocked.map((b) => (
              <li
                key={b.createdAt}
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100"
              >
                {b.type === 'blocked'
                  ? `Stopped Bhaav from saying ${((b.detail?.unbacked as number[] | undefined) ?? []).map((n) => rupees(n)).join(', ')}.`
                  : 'Stopped Bhaav from saving a price you never said.'}
                {typeof b.detail?.sentence === 'string' && (
                  <div className="mt-0.5 opacity-80">"{b.detail.sentence}"</div>
                )}
              </li>
            ))}
          </ul>
        )}
        {review?.quotes && review.quotes.length > 0 && (
          <div className="mt-4 text-sm">
            <div className="font-medium">Quotes Bhaav saved from you</div>
            <ul className="mt-1 list-disc pl-5 text-stone-600 dark:text-stone-400">
              {review.quotes.map((q) => (
                <li key={`${q.price}-${q.supplierWords}`}>
                  {rupees(q.price)} per {q.packSize ? `${q.packSize}-unit pack` : q.unit}: "
                  {q.supplierWords}"
                </li>
              ))}
            </ul>
          </div>
        )}
        {requestId && (
          <p className="mt-4 text-sm">
            <Link className="underline underline-offset-4" to={`/r/${requestId}`}>
              Open the practice order's quote book
            </Link>
          </p>
        )}
      </Card>
      <Card title="Transcript">
        {loading ? (
          <p className="text-sm text-stone-500">
            Waiting for Bolna's transcript (usually a few seconds)…
          </p>
        ) : (
          <ol className="flex max-h-96 flex-col gap-2 overflow-y-auto text-sm">
            {lines.map((l) => (
              <li
                key={l.id}
                className={l.bhaav ? 'text-stone-900 dark:text-stone-100' : 'text-stone-500'}
              >
                <span className="font-medium">{l.bhaav ? 'Bhaav' : 'You'}:</span> {l.text}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
