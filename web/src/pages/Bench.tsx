// The test bench's latest results, bundled into the app by `npm run bench`.

import type { BenchResults, BenchRun } from '@bhaav/shared';
import data from '../bench-results.json';
import { CaretDown, Flask } from '../icons';
import { Card, EmptyState, PageTitle, Pill, Stat } from '../ui';

const results = data as BenchResults;

function pct(n: number, d: number) {
  return d === 0 ? '—' : `${Math.round((n / d) * 100)}%`;
}

export function BenchPage() {
  const runs = results.runs.filter((r) => !r.error);
  const failed = results.runs.length - runs.length;
  const unbacked = runs.reduce((n, r) => n + r.unbacked.length, 0);
  const blocked = runs.reduce((n, r) => n + r.blocked, 0);
  const saves = runs.flatMap((r) => r.saved);
  const backedSaves = saves.filter((s) => s.backed).length;
  const tooManyCounters = runs.filter((r) => r.counters > 1).length;

  return (
    <>
      <PageTitle
        eyebrow="Test bench"
        title="Simulated bargaining chats"
        sub="An AI plays the supplier in text, and Bhaav answers through the same lie-catcher it uses on real calls."
      />
      {results.runs.length === 0 ? (
        <EmptyState icon={Flask} title="No results yet">
          Run <code className="rounded bg-muted px-1.5 py-0.5">npm run bench</code> with a Groq key,
          then rebuild the app.
        </EmptyState>
      ) : (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Unbacked numbers spoken"
              value={String(unbacked)}
              note={`in ${runs.length} chats`}
              tone={unbacked === 0 ? 'success' : undefined}
            />
            <Stat
              label="Saved quotes the supplier said"
              value={pct(backedSaves, saves.length)}
              note={`${backedSaves} of ${saves.length}`}
              tone={saves.length > 0 && backedSaves === saves.length ? 'success' : undefined}
            />
            <Stat
              label="Sentences stopped before speaking"
              value={String(blocked)}
              note="replaced by the safe line"
            />
            <Stat
              label="Chats with more than one counter-offer"
              value={String(tooManyCounters)}
              note="the rule is one"
              tone={tooManyCounters === 0 ? 'success' : undefined}
            />
          </div>
          <p className="mb-4 text-sm text-muted-fg">
            Run {results.generatedAt ? new Date(results.generatedAt).toLocaleString('en-IN') : ''}{' '}
            with {results.models.join(', ')}
            {failed > 0 ? `. ${failed} chats failed to run and are not counted.` : '.'}
          </p>
          <Card title="Chats">
            <ul className="divide-y divide-border">
              {results.runs.map((r) => (
                <RunRow key={r.id} run={r} />
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}

function RunRow({ run }: { run: BenchRun }) {
  return (
    <li>
      <details className="group py-1">
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 py-2">
          <span className="flex items-center gap-2">
            <CaretDown
              size={16}
              className="transition-transform group-open:rotate-180"
              aria-hidden
            />
            <span className="font-medium">{run.persona}</span>
            <span className="text-sm text-muted-fg">{run.style}</span>
          </span>
          <span className="flex flex-wrap gap-1.5">
            {run.error ? (
              <Pill tone="warn">Did not run</Pill>
            ) : (
              <>
                <Pill tone={run.unbacked.length ? 'danger' : 'success'}>
                  {run.unbacked.length} unbacked
                </Pill>
                {run.blocked > 0 && <Pill>{run.blocked} stopped</Pill>}
                <Pill>{run.saved.length} saved</Pill>
              </>
            )}
          </span>
        </summary>
        <ol className="mb-2 flex flex-col gap-1.5 rounded-xl bg-muted p-3 text-sm">
          {run.error && <li className="text-danger">{run.error}</li>}
          {run.turns.map((t, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a transcript's turns never reorder
            <li key={`${run.id}-${i}`} className={t.role === 'bhaav' ? 'text-fg' : 'text-muted-fg'}>
              <span className="font-semibold">{t.role === 'bhaav' ? 'Bhaav' : 'Supplier'}:</span>{' '}
              {t.text}
              {t.blocked && t.blocked.length > 0 && (
                <span className="text-danger"> (stopped: {t.blocked.join(', ')})</span>
              )}
            </li>
          ))}
        </ol>
      </details>
    </li>
  );
}
