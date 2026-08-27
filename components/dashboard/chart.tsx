'use client';

import { useState } from 'react';
import { Skeleton } from '@/components/ui/primitives';

export type Bucket = {
  key: string;
  startISO: string;
  raised: { cents: number; formatted: string };
  donationCount: number;
};

const CHART_H = 176;

/**
 * Bars, not a line -- on purpose.
 *
 * 47 of the 180 days in this dataset have no succeeded gift. A line chart draws
 * straight through those gaps, which invents data that is not there: the eye
 * reads a steady climb across a fortnight where nothing arrived. Bars leave the
 * gap visible, which is the honest rendering and the reason computeTimeseries
 * zero-fills in the first place.
 *
 * No gradient fill, no curve smoothing, no entry animation.
 */
export function BarChart({
  buckets,
  loading,
  formatLabel,
}: {
  buckets: Bucket[] | undefined;
  loading: boolean;
  formatLabel: (b: Bucket) => string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (loading) {
    return (
      <div className="px-4 pb-4 pt-3">
        <div className="mb-2 flex h-4 items-center">
          <Skeleton className="h-3 w-40" />
        </div>
        <Skeleton className="w-full" style={{ height: CHART_H }} />
      </div>
    );
  }

  const rows = buckets ?? [];
  const max = Math.max(1, ...rows.map((b) => b.raised.cents));
  const active = hovered !== null ? rows[hovered] : null;

  // Round the axis up to a clean figure so gridlines read as round numbers.
  const hasMoney = rows.some((b) => b.raised.cents > 0);
  const step = niceStep(max);
  const axisMax = Math.max(step, Math.ceil(max / step) * step);
  // An all-zero period gets a single baseline rather than a fabricated scale --
  // inventing a $1 axis for a period with no money reads as a rendering bug.
  const lines = hasMoney ? [0, 1, 2].map((i) => axisMax - (axisMax / 2) * i) : [0];

  return (
    <div className="px-4 pb-4 pt-3">
      {/* Readout lives here rather than in a floating tooltip: fixed height, so
          hovering never nudges the layout. */}
      <div className="mb-2 flex h-4 items-center gap-3 text-[0.6875rem] leading-none">
        {active ? (
          <>
            <span className="num text-txt">{formatLabel(active)}</span>
            <span className="num font-medium text-txt">{active.raised.formatted}</span>
            <span className="num text-txt3">
              {active.donationCount} {active.donationCount === 1 ? 'gift' : 'gifts'}
            </span>
          </>
        ) : (
          <span className="text-txt3">
            {rows.length} {rows.length === 1 ? 'period' : 'periods'}
          </span>
        )}
      </div>

      <div className="relative" style={{ height: CHART_H }}>
        {lines.map((v, i) => (
          <div
            key={i}
            className="absolute inset-x-0 flex items-center"
            style={{ top: hasMoney ? `${(i / 2) * 100}%` : '100%' }}
          >
            <span className="num w-14 shrink-0 pr-2 text-right text-[0.625rem] leading-none text-txt3">
              {compactMoney(v)}
            </span>
            <span className="h-px flex-1 bg-grid" />
          </div>
        ))}

        <div
          className="absolute inset-y-0 right-0 flex items-end"
          style={{ left: '3.5rem', gap: rows.length > 60 ? 1 : rows.length > 20 ? 2 : 4 }}
          onMouseLeave={() => setHovered(null)}
        >
          {rows.map((b, i) => {
            const pct = (b.raised.cents / axisMax) * 100;
            return (
              <button
                key={b.key}
                type="button"
                onMouseEnter={() => setHovered(i)}
                onFocus={() => setHovered(i)}
                aria-label={`${b.key}: ${b.raised.formatted}, ${b.donationCount} gifts`}
                className="group relative h-full flex-1 cursor-pointer"
              >
                <span
                  className={`absolute inset-x-0 bottom-0 block rounded-t-[2px] transition-colors ${
                    hovered === i ? 'bg-[var(--accent-hover)]' : 'bg-bar'
                  }`}
                  // min 1px keeps an empty bucket visible as a baseline tick
                  // rather than vanishing, so gaps read as "zero", not "missing".
                  style={{ height: b.raised.cents === 0 ? 1 : `max(2px, ${pct}%)` }}
                />
              </button>
            );
          })}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="mt-1.5 flex justify-between pl-14 text-[0.625rem] leading-none text-txt3">
          <span className="num">{rows[0].key}</span>
          <span className="num">{rows[rows.length - 1].key}</span>
        </div>
      )}
    </div>
  );
}

function niceStep(maxCents: number): number {
  const target = maxCents / 2;
  const mag = Math.pow(10, Math.max(0, String(Math.round(target)).length - 1));
  return Math.max(100, Math.ceil(target / mag) * mag);
}

function compactMoney(cents: number): string {
  if (cents === 0) return '$0';
  const dollars = cents / 100;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(dollars % 1000 === 0 ? 0 : 1)}k`;
  if (dollars < 1) return `$${dollars.toFixed(2)}`;
  return `$${Math.round(dollars)}`;
}
