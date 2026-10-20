// The test bench's latest results, bundled into the app by `npm run bench`.

import type { BenchResults, BenchRun } from '@bhaav/shared';
import { useState } from 'react';
import data from '../bench-results.json';
import { Card, Notice, PageTitle, Pill } from '../ui';

const results = data as BenchResults;

function pct(n: number, d: number) {
  return d === 0 ? '—' : `${Math.round((n / d) * 100)}%`;
}

export function BenchPage() {
  const [open, setOpen] = useState<string | null>(null);
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
        title="Test bench"
        sub="Simulated bargaining chats in text: an AI plays the supplier, and Bhaav answers through the same lie-catcher it uses on real calls."
      />
      {results.runs.length === 0 ? (
        <Notice>
          No results yet. Run <code>npm run bench</code> with a Groq key, then rebuild the app.
        </Notice>
      ) : (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Unbacked numbers spoken"
              value={String(unbacked)}
              good={unbacked === 0}
              note={`in ${runs.length} chats`}
            />
            <Stat
              label="Saved quotes the supplier said"
              value={pct(backedSaves, saves.length)}
              good={saves.length > 0 && backedSaves === saves.length}
              note={`${backedSaves} of ${saves.length}`}
            />
            <Stat
              label="Sentences stopped before speaking"
              value={String(blocked)}
              note="replaced by the safe line"
            />
            <Stat
              label="Chats with more than one counter-offer"
              value={String(tooManyCounters)}
              good={tooManyCounters === 0}
              note="the rule is one"
            />
          </div>
          <p className="mb-4 text-sm text-stone-500">
            Run {results.generatedAt ? new Date(results.generatedAt).toLocaleString('en-IN') : ''}{' '}
            with {results.models.join(', ')}
            {failed > 0 ? `. ${failed} chats failed to run and are not counted.` : '.'}
          </p>
          <Card title="Chats">
            <ul className="divide-y divide-stone-100 dark:divide-stone-800">
              {results.runs.map((r) => (
                <RunRow
                  key={r.id}
                  run={r}
                  open={open === r.id}
                  toggle={() => setOpen(open === r.id ? null : r.id)}
                />
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  note,
  good,
}: {
  label: string;
  value: string;
  note?: string;
  good?: boolean;
}) {
  return (
    <Card>
      <div className="text-sm text-stone-500">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold ${good === true ? 'text-emerald-700 dark:text-emerald-400' : ''}`}
      >
        {value}
      </div>
      {note && <div className="text-sm text-stone-500">{note}</div>}
    </Card>
  );
}

function RunRow({ run, open, toggle }: { run: BenchRun; open: boolean; toggle: () => void }) {
  return (
    <li className="py-2">
      <button
        type="button"
        className="flex w-full flex-wrap items-center justify-between gap-2 text-left text-sm"
        onClick={toggle}
      >
        <span>
          <span className="font-medium">{run.persona}</span>{' '}
          <span className="text-stone-500">· {run.style}</span>
        </span>
        <span className="flex flex-wrap gap-1.5">
          {run.error ? (
            <Pill tone="warn">Did not run</Pill>
          ) : (
            <>
              <Pill tone={run.unbacked.length ? 'bad' : 'good'}>
                {run.unbacked.length} unbacked
              </Pill>
              {run.blocked > 0 && <Pill tone="neutral">{run.blocked} stopped</Pill>}
              <Pill>{run.saved.length} saved</Pill>
            </>
          )}
        </span>
      </button>
      {open && (
        <ol className="mt-2 flex flex-col gap-1 rounded-lg bg-stone-50 p-3 text-sm dark:bg-stone-900">
          {run.error && <li className="text-red-700">{run.error}</li>}
          {run.turns.map((t, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a transcript's turns never reorder
            <li key={`${run.id}-${i}`} className={t.role === 'bhaav' ? '' : 'text-stone-500'}>
              <span className="font-medium">{t.role === 'bhaav' ? 'Bhaav' : 'Supplier'}:</span>{' '}
              {t.text}
              {t.blocked && t.blocked.length > 0 && (
                <span className="ml-1 text-red-600">(stopped: {t.blocked.join(', ')})</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}
