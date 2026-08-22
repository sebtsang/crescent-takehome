'use client';

import { useQuery } from 'convex/react';
import { useState } from 'react';
import { api } from '@/convex/_generated/api';
import { BarChart, type Bucket } from '@/components/dashboard/chart';
import {
  Card,
  EmptyState,
  Figure,
  SegmentedControl,
  Skeleton,
  StatusPill,
} from '@/components/ui/primitives';

/**
 * Default range is ALL TIME, deliberately.
 *
 * The seeded data ends 2026-06-29 and "today" is well past it, so a
 * conventional 30-day default renders a completely empty dashboard that reads
 * as a broken build. Defaulting to the range that actually contains data, and
 * printing the covered window in the header, is the honest presentation.
 */
const RANGES = [
  { value: 'all_time', label: 'All' },
  { value: 'this_year', label: 'YTD' },
  { value: 'last_90_days', label: '90D' },
  { value: 'last_30_days', label: '30D' },
] as const;

const GRAINS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
] as const;

type Preset = (typeof RANGES)[number]['value'];
type Grain = (typeof GRAINS)[number]['value'];

export function Overview() {
  const [preset, setPreset] = useState<Preset>('all_time');
  const [grain, setGrain] = useState<Grain>('month');

  const range = { preset };
  const stats = useQuery(api.reporting.stats, { range });
  const series = useQuery(api.reporting.timeseries, { range, granularity: grain });
  const breakdown = useQuery(api.reporting.breakdown, { range, dimension: 'campaign' });
  const recent = useQuery(api.reporting.recentDonations, { range, limit: 8 });
  const campaigns = useQuery(api.reporting.campaigns, {});

  const loading = stats === undefined;
  const campaignName = (id: string) =>
    campaigns?.find((c) => c._id === id)?.name ?? '—';

  const coverage = stats?.coverage;
  const window = stats?.scope.range;

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[1.375rem] font-medium leading-[1.15] tracking-tighter">
            Overview
          </h1>
          <div className="mt-1 flex h-3 items-center text-xs leading-none text-txt3">
            {loading ? (
              <Skeleton className="h-3 w-64" />
            ) : (
              <>
                {window?.startISO
                  ? `${window.startISO} → ${window.endISO}`
                  : 'All time'}
                {coverage?.datasetMinISO && (
                  <span className="text-txt3">
                    {' · data covers '}
                    {coverage.datasetMinISO.slice(0, 10)} → {coverage.datasetMaxISO?.slice(0, 10)}
                    {' · UTC'}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        <SegmentedControl
          label="Date range"
          value={preset}
          options={RANGES}
          onChange={setPreset}
        />
      </header>

      {/* KPIs ------------------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Total raised"
          value={stats?.raised.formatted ?? null}
          loading={loading}
          note={stats ? `${stats.charged.formatted} charged incl. fees` : undefined}
        />
        <Kpi
          label="Donations"
          value={stats ? String(stats.donationCount) : null}
          loading={loading}
          note={stats ? `${stats.rowsInScope} records, succeeded only` : undefined}
        />
        <Kpi
          label="Unique donors"
          value={stats ? String(stats.uniqueDonorCount) : null}
          loading={loading}
          note={stats ? `${stats.repeatDonorCount} gave more than once` : undefined}
        />
        <Kpi
          label="Average gift"
          value={stats?.averageGift?.formatted ?? (stats ? '—' : null)}
          loading={loading}
          note={stats?.medianGift ? `${stats.medianGift.formatted} median` : undefined}
        />
      </div>

      {/* Chart ------------------------------------------------------------ */}
      <Card
        title="Money raised over time"
        actions={
          <SegmentedControl
            label="Granularity"
            value={grain}
            options={GRAINS}
            onChange={setGrain}
          />
        }
      >
        {series !== undefined && series.buckets.length === 0 ? (
          <div style={{ height: 232 }}>
            <EmptyState
              headline="No donations in this period"
              detail={
                coverage?.datasetMaxISO
                  ? `The most recent gift on record is ${coverage.datasetMaxISO.slice(0, 10)}.`
                  : undefined
              }
            />
          </div>
        ) : (
          <BarChart
            buckets={series?.buckets as Bucket[] | undefined}
            loading={series === undefined}
            formatLabel={(b) => b.key}
          />
        )}
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Breakdown ------------------------------------------------------ */}
        <Card title="By campaign">
          <div className="min-h-[16rem]">
            {breakdown === undefined ? (
              <TableSkeleton rows={5} cols={3} />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className="eyebrow px-4 py-2 text-left font-semibold">Campaign</th>
                    <th className="eyebrow px-4 py-2 text-right font-semibold">Raised</th>
                    <th className="eyebrow px-4 py-2 text-right font-semibold">Goal</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.groups.map((g) => (
                    <tr key={g.key} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-txt">{g.label}</span>
                          {g.campaignStatus && g.campaignStatus !== 'active' && (
                            <StatusPill status={g.campaignStatus} />
                          )}
                        </div>
                        <div className="num mt-0.5 text-[0.6875rem] text-txt3">
                          {g.donationCount} gifts · {g.uniqueDonorCount} donors
                        </div>
                      </td>
                      <td className="num px-4 py-2.5 text-right align-top font-medium">
                        {g.raised.formatted}
                        <div className="num mt-0.5 text-[0.6875rem] font-normal text-txt3">
                          {g.shareOfTotalPct === null ? '—' : `${g.shareOfTotalPct}%`}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right align-top">
                        <GoalCell pct={g.goalProgressPct ?? null} goal={g.goal?.formatted} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        {/* Recent --------------------------------------------------------- */}
        <Card title="Recent donations" meta={recent ? `${recent.totalMatched} total` : undefined}>
          <div className="min-h-[16rem]">
            {recent === undefined ? (
              <TableSkeleton rows={8} cols={2} />
            ) : recent.donations.length === 0 ? (
              <EmptyState headline="No donations in this period" />
            ) : (
              <ul>
                {recent.donations.map((d, i) => (
                  <li
                    key={`${d.createdAt}-${i}`}
                    className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2 last:border-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm text-txt">
                        {d.donorName ?? (
                          <span className="italic text-txt3">Anonymous</span>
                        )}
                      </div>
                      <div className="num truncate text-[0.6875rem] text-txt3">
                        {campaignName(d.campaignId)} · {d.createdAtISO.slice(0, 10)}
                        {d.frequency === 'monthly' && ' · monthly'}
                      </div>
                    </div>
                    <span className="num shrink-0 text-sm font-medium">
                      {d.amount.formatted}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  note,
  loading,
}: {
  label: string;
  value: string | null;
  note?: string;
  loading: boolean;
}) {
  return (
    <div className="card px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className="mt-2">
        <Figure value={value} loading={loading} />
      </div>
      {/* Fixed-height note row: present even when empty, so cards never differ
          in height and the row cannot reflow as values land. */}
      <div className="num mt-1 h-3.5 truncate text-[0.6875rem] leading-none text-txt3">
        {loading ? <Skeleton className="h-2.5 w-24" /> : (note ?? '')}
      </div>
    </div>
  );
}

function GoalCell({ pct, goal }: { pct: number | null; goal?: string }) {
  // No goal is a real state, not a zero. Never render 0% or NaN here.
  if (pct === null) {
    return <span className="text-[0.6875rem] text-txt3">No goal</span>;
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="num text-sm font-medium">{pct}%</span>
      <div className="h-1 w-16 bg-bar-muted">
        {/* Bar clamps at 100; the number above does not. Two campaigns are over goal. */}
        <div className="h-full bg-bar" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      {goal && <span className="num text-[0.625rem] text-txt3">of {goal}</span>}
    </div>
  );
}

function TableSkeleton({ rows, cols }: { rows: number; cols: number }) {
  return (
    <div className="px-4 py-2">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center justify-between gap-4 py-2.5">
          <Skeleton className="h-3 w-40" />
          {cols > 2 && <Skeleton className="h-3 w-12" />}
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}
