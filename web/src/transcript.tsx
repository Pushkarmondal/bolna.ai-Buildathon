// The live transcript: each turn of a call as the lie-catcher saw it. Every number Bhaav said is
// marked by where it came from: green from the quote book, blue the other person's own number
// read back to them, amber a number only they said that Bhaav stated (worth a look), and a red
// box for a sentence the lie-catcher stopped before it was spoken.

import type { SpokenNumber, TurnDto } from '@bhaav/shared';
import { type ReactNode, useEffect, useRef } from 'react';
import { timeLabel } from './format';

type Mark = 'book' | 'readback' | 'slip';

const MARK_CLASS: Record<Mark, string> = {
  book: 'bg-success-soft text-success',
  readback: 'bg-info-soft text-info',
  slip: 'bg-warn-soft text-warn',
};

/** Solid dots for the legend: the soft mark colours are too pale to see at dot size. */
const DOT_CLASS: Record<Mark, string> = {
  book: 'bg-success',
  readback: 'bg-info',
  slip: 'bg-warn',
};

const MARK_TITLE: Record<Mark, string> = {
  book: 'In the quote book',
  readback: 'Their own number, read back to them',
  slip: 'A number only they said, stated by Bhaav: worth a look',
};

const markOf = (n: SpokenNumber): Mark | null =>
  n.source === 'book' ? 'book' : n.source === 'heard' ? (n.question ? 'readback' : 'slip') : null;

/** The sentence with each tagged number wrapped in its mark, matched in order. */
function marked(text: string, numbers: SpokenNumber[]): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  numbers.forEach((n) => {
    const mark = markOf(n);
    if (!mark || !n.text) return;
    const found = text.indexOf(n.text, at);
    if (found < 0) return;
    // A rupee sign just before the number belongs inside the mark.
    const start = found > 0 && text[found - 1] === '₹' ? found - 1 : found;
    if (start > at) out.push(text.slice(at, start));
    out.push(
      <mark
        key={`${start}-${n.text}`}
        className={`tabular rounded-md px-1 py-px font-semibold ${MARK_CLASS[mark]}`}
        title={MARK_TITLE[mark]}
      >
        {text.slice(start, found + n.text.length)}
      </mark>,
    );
    at = found + n.text.length;
  });
  if (at < text.length) out.push(text.slice(at));
  return out;
}

export function TranscriptLegend() {
  return (
    <p className="mb-3 flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-fg">
      {(['book', 'readback', 'slip'] as const).map((m) => (
        <span key={m} className="inline-flex items-center gap-1.5">
          <span className={`inline-block size-2.5 rounded-full ${DOT_CLASS[m]}`} aria-hidden />
          {MARK_TITLE[m]}
        </span>
      ))}
    </p>
  );
}

/**
 * One call's turns, oldest first. `live` keeps the newest turn in view and announces new turns to
 * screen readers.
 */
export function Transcript({
  turns,
  otherName,
  live = false,
}: {
  turns: TurnDto[];
  otherName: string;
  live?: boolean;
}) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (live && turns.length > 0) end.current?.scrollIntoView({ block: 'nearest' });
  }, [live, turns.length]);

  if (turns.length === 0)
    return <p className="text-muted-fg">The conversation appears here as it happens.</p>;

  return (
    <ol
      className="flex max-h-[28rem] flex-col gap-2.5 overflow-y-auto overscroll-contain pr-1"
      aria-live={live ? 'polite' : undefined}
      aria-label={`Conversation with ${otherName}`}
    >
      {turns.map((t, i) => (
        <li
          key={t.id}
          className="flex flex-col gap-2"
          ref={i === turns.length - 1 ? end : undefined}
        >
          {t.heard && (
            <div className="mr-8 self-start rounded-2xl rounded-tl-md bg-muted px-4 py-2.5 sm:mr-16">
              <p className="text-xs font-semibold text-muted-fg">{otherName}</p>
              <p className="text-[15px]">{t.heard}</p>
            </div>
          )}
          {t.stopped && (
            <div className="ml-8 self-end rounded-2xl bg-danger-soft px-4 py-2.5 text-danger sm:ml-16">
              <p className="text-xs font-semibold">Stopped before it was spoken</p>
              <p className="text-[15px] line-through decoration-2">{t.stopped}</p>
            </div>
          )}
          {t.said && (
            <div className="ml-8 self-end rounded-2xl rounded-tr-md border border-border bg-card px-4 py-2.5 sm:ml-16">
              <p className="flex justify-between gap-3 text-xs font-semibold text-muted-fg">
                <span>Bhaav</span>
                <span className="tabular font-normal">{timeLabel(t.createdAt)}</span>
              </p>
              <p className="text-[15px]">{marked(t.said, t.numbers)}</p>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
