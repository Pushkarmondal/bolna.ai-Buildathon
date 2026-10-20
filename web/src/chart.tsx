// A small line chart of the best price on each order, drawn in SVG (no chart library). Following
// the skill's chart guidance: a line for a trend, a direct label on the latest point, and a text
// summary for screen readers. Callers show a stat card instead when there are fewer than 4 points.

import type { PricePoint } from '@bhaav/shared';
import { useEffect, useRef, useState } from 'react';
import { rupees } from './format';

const H = 200;
const PAD = { top: 16, right: 52, bottom: 28, left: 48 };

/**
 * Orders are spaced evenly, oldest on the left: the chart reads "order by order", and orders placed
 * minutes apart would otherwise sit on top of each other.
 */
export function scalePoints(points: readonly PricePoint[], width: number) {
  const values = points.map((p) => p.perUnit);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(1, max * 0.1);
  const lo = min - span * 0.15;
  const hi = max + span * 0.15;
  const inner = Math.max(1, width - PAD.left - PAD.right);
  const x = (i: number) =>
    PAD.left + (points.length < 2 ? inner / 2 : (i / (points.length - 1)) * inner);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  return { x, y, lo, hi };
}

/** The element's own width in CSS pixels, so the SVG draws at 1:1 and its text stays 12px. */
function useWidth<T extends Element>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const short = (ms: number) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(ms));

export function PriceChart({
  points,
  unit,
  label,
}: {
  points: readonly PricePoint[];
  unit: string;
  label: string;
}) {
  const [ref, W] = useWidth<HTMLDivElement>(560);
  const { x, y, lo, hi } = scalePoints(points, W);
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return null;
  const end = points.length - 1;
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.perUnit).toFixed(1)}`)
    .join(' ');
  const ticks = [hi, (hi + lo) / 2, lo];
  return (
    <div ref={ref} className="w-full min-w-0">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto max-w-full"
        role="img"
        aria-label={label}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--border)"
              strokeDasharray="2 4"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 8}
              y={y(t) + 4}
              textAnchor="end"
              fontSize="12"
              fill="var(--muted-fg)"
              className="tabular"
            >
              {rupees(Math.round(t))}
            </text>
          </g>
        ))}
        <path
          d={path}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p, i) => (
          <circle
            key={p.requestId}
            cx={x(i)}
            cy={y(p.perUnit)}
            r="4"
            fill="var(--card)"
            stroke="var(--accent)"
            strokeWidth="2"
          >
            <title>{`${short(p.date)}: ${rupees(p.perUnit)} per ${unit}, ${p.supplierName}`}</title>
          </circle>
        ))}
        <text
          x={x(end) + 10}
          y={y(last.perUnit) + 5}
          fontSize="14"
          fontWeight="600"
          fill="var(--fg)"
          className="tabular"
        >
          {rupees(last.perUnit)}
        </text>
        <text x={x(0)} y={H - 6} fontSize="12" fill="var(--muted-fg)">
          {short(first.date)}
        </text>
        <text x={x(end)} y={H - 6} fontSize="12" textAnchor="end" fill="var(--muted-fg)">
          {short(last.date)}
        </text>
      </svg>
    </div>
  );
}

/** A one-line reading of the trend, used under the chart and as its screen-reader label. */
export function trendSentence(points: readonly PricePoint[], unit: string): string {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return 'No prices yet.';
  if (points.length === 1) return `One order so far: ${rupees(last.perUnit)} per ${unit}.`;
  const change = last.perUnit - first.perUnit;
  const pct = first.perUnit ? Math.abs((change / first.perUnit) * 100).toFixed(1) : '0';
  const direction = change === 0 ? 'unchanged' : change < 0 ? `down ${pct}%` : `up ${pct}%`;
  return `${points.length} orders: from ${rupees(first.perUnit)} to ${rupees(last.perUnit)} per ${unit}, ${direction}.`;
}
