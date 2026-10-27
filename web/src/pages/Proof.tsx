// The proof page: what Bhaav did, straight from the database. Real orders' savings and calls,
// every number the lie-catcher checked on every call, how fast Bhaav answered, and the test
// bench. An honest zero shows as zero, and possible slips are counted, not hidden.

import type { BenchResults } from '@bhaav/shared';
import { useProof } from '../api';
import bench from '../bench-results.json';
import { rupees } from '../format';
import { Flask, Gauge, Medal, ShieldCheck, Trophy } from '../icons';
import { Card, MoreLink, Notice, PageTitle, Stat, useDocumentTitle } from '../ui';

const results = bench as BenchResults;

const percent = (part: number, whole: number) =>
  whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`;

/** Under a second in milliseconds, so a fast answer never reads as "0.0 s". */
const seconds = (ms: number | null) =>
  ms == null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;

export function ProofPage() {
  useDocumentTitle('Proof');
  const proof = useProof();
  const p = proof.data;
  const unbacked = results.runs.reduce((n, r) => n + r.unbacked.length, 0);

  return (
    <>
      <PageTitle
        eyebrow="Proof"
        title="What Bhaav did, in numbers"
        sub="Read from the database as you open this page. Nothing is estimated, and practice and simulated orders never count as savings."
      />
      {proof.isPending && <p className="text-muted-fg">Counting…</p>}
      {proof.error && <Notice tone="danger">{proof.error.message}</Notice>}
      {p && (
        <div className="flex flex-col gap-4">
          {p.orders === 0 && (
            <Notice tone="info" title="No real order has finished yet">
              The savings and call numbers fill in after the first real order. The lie-catcher
              numbers below already count every call, practice and simulations included.
            </Notice>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat
              label="Saved on real orders"
              value={rupees(p.savedRupees)}
              tone={p.savedRupees > 0 ? 'success' : undefined}
              note={
                p.savedPercent == null
                  ? `${p.orders} order${p.orders === 1 ? '' : 's'}`
                  : `${p.savedPercent}% on average, against the costliest quote heard`
              }
            />
            <Stat
              label="Calls that ended with a quote"
              value={percent(p.calls.withQuote, p.calls.answered)}
              note={`${p.calls.withQuote} of ${p.calls.answered} answered, ${p.calls.placed} placed`}
            />
            <Stat
              label="Prices found in the supplier's own words"
              value={percent(p.quotes.inTheirWords, p.quotes.total)}
              note={`${p.quotes.inTheirWords} of ${p.quotes.total} quotes`}
            />
          </div>

          <Card title="The lie-catcher, on every call" icon={ShieldCheck}>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                { label: 'Numbers checked', value: p.numbers.checked, tone: '' },
                { label: 'From the quote book', value: p.numbers.fromBook, tone: 'text-success' },
                { label: 'Their own, read back', value: p.numbers.readBack, tone: 'text-info' },
                { label: 'Stopped before spoken', value: p.numbers.stopped, tone: 'text-danger' },
                {
                  label: 'Possible slips',
                  value: p.numbers.possibleSlips,
                  tone: p.numbers.possibleSlips ? 'text-warn' : 'text-success',
                },
              ].map((n) => (
                <div key={n.label} className="rounded-2xl bg-bg p-4">
                  <dt className="text-sm text-muted-fg">{n.label}</dt>
                  <dd className={`tabular text-[28px] font-bold ${n.tone}`}>{n.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-sm text-muted-fg">
              A possible slip is Bhaav stating, not asking, a number only the other person said. The
              lie-catcher stops offers it can't prove; a slip like "ठीक है, ₹140" can still pass, so
              every one is counted here for a person to check.
            </p>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="How fast Bhaav answers" icon={Gauge}>
              <p className="tabular text-[28px] font-bold">
                {seconds(p.thinkMs.median)}{' '}
                <span className="text-[17px] font-normal text-muted-fg">typical</span>
              </p>
              <p className="text-muted-fg">
                {seconds(p.thinkMs.p90)} for 9 in 10 turns, over {p.thinkMs.turns} turns. Measured
                on the server, from the question to Bhaav's first words; the voice adds its own time
                on top.
              </p>
            </Card>
            <Card title="Test bench" icon={Flask}>
              {results.runs.length === 0 ? (
                <p className="text-muted-fg">The bench has not been run yet.</p>
              ) : (
                <p>
                  <span className="tabular text-[28px] font-bold">{unbacked}</span>{' '}
                  <span className="text-muted-fg">
                    unproven numbers in {results.runs.length} simulated chats, graded by a stricter
                    rule than the lie-catcher's own.
                  </span>
                </p>
              )}
              <MoreLink to="/bench">Open the test bench</MoreLink>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card title="Try to break it" icon={Medal}>
              <p className="text-muted-fg">
                Take Bhaav's call as a supplier and try to make it lie. Every try is on the
                scoreboard.
              </p>
              <MoreLink to="/play">Be the supplier</MoreLink>
            </Card>
            <Card title="Price memory" icon={Trophy}>
              <p className="text-muted-fg">Every past order's best price, item by item.</p>
              <MoreLink to="/prices">Open price memory</MoreLink>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
