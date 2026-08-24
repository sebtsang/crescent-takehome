'use client';

import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { BarChart, type Bucket } from '@/components/dashboard/chart';
import {
  Card,
  EmptyState,
  Figure,
  SegmentedControl,
  Skeleton,
} from '@/components/ui/primitives';

/**
 * Panels shared by the overview and the campaign detail view.
 *
 * Both surfaces render the same shapes over the same queries; the only
 * difference is whether `campaignIds` is set. Duplicating these would be a
 * second place for the presentation of a number to drift.
 */

export const RANGES = [
  { value: 'all_time', label: 'All' },
  { value: 'this_year', label: 'YTD' },
  { value: 'last_90_days', label: '90D' },
  { value: 'last_30_days', label: '30D' },
] as const;

export const GRAINS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
] as const;

export type Preset = (typeof RANGES)[number]['value'];
export type Grain = (typeof GRAINS)[number]['value'];

export type Scope = { range: { preset: Preset }; campaignIds?: string[] };

export function RangeHeader({
  title,
  scope,
  onPresetChange,
  subtitleExtra,
}: {
  title: string;
  scope: Scope;
  onPresetChange: (p: Preset) => void;
  subtitleExtra?: React.ReactNode;
}) {
  const stats = useQuery(api.reporting.stats, scope as never);
  const loading = stats === undefined;
  const window = stats?.scope.range;
  const coverage = stats?.coverage;

  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-[1.375rem] font-medium leading-[1.15] tracking-tighter">
          {title}
        </h1>
        {/* Prints the requested window AND the dataset coverage, so an empty
            period explains itself instead of reading as a broken build. */}
        <div className="mt-1 flex h-3 items-center gap-2 text-xs leading-none text-txt3">
          {loading ? (
            <Skeleton className="h-3 w-64" />
          ) : (
            <>
              <span className="num">
                {window?.startISO ? `${window.startISO} → ${window.endISO}` : 'All time'}
              </span>
              {coverage?.datasetMinISO && (
                <span className="num">
                  · data covers {coverage.datasetMinISO.slice(0, 10)} →{' '}
                  {coverage.datasetMaxISO?.slice(0, 10)} · UTC
                </span>
              )}
              {subtitleExtra}
            </>
          )}
        </div>
      </div>
      <SegmentedControl
        label="Date range"
        value={scope.range.preset}
        options={RANGES}
        onChange={onPresetChange}
      />
    </header>
  );
}

export function KpiRow({ scope }: { scope: Scope }) {
  const stats = useQuery(api.reporting.stats, scope as never);
  const loading = stats === undefined;

  return (
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
        note={stats ? `succeeded, of ${stats.rowsInScope} records in range` : undefined}
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
      {/* Fixed-height note row, present even when empty, so the cards cannot
          differ in height and the row cannot reflow as values land. */}
      <div className="num mt-1 h-3.5 truncate text-[0.6875rem] leading-none text-txt3">
        {loading ? <Skeleton className="h-2.5 w-24" /> : (note ?? '')}
      </div>
    </div>
  );
}

export function ChartCard({
  scope,
  grain,
  onGrainChange,
}: {
  scope: Scope;
  grain: Grain;
  onGrainChange: (g: Grain) => void;
}) {
  const series = useQuery(api.reporting.timeseries, {
    ...scope,
    granularity: grain,
  } as never);

  return (
    <Card
      title="Money raised over time"
      actions={
        <SegmentedControl
          label="Granularity"
          value={grain}
          options={GRAINS}
          onChange={onGrainChange}
        />
      }
    >
      {series !== undefined && series.buckets.length === 0 ? (
        <div style={{ height: 232 }}>
          <EmptyState
            headline="No donations in this period"
            detail={
              series.coverage.datasetMaxISO
                ? `The most recent gift on record is ${series.coverage.datasetMaxISO.slice(0, 10)}.`
                : 'There are no donations on record yet.'
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
  );
}

export function RecentDonationsCard({
  scope,
  showCampaign = true,
  limit = 8,
}: {
  scope: Scope;
  showCampaign?: boolean;
  limit?: number;
}) {
  const recent = useQuery(api.reporting.recentDonations, { ...scope, limit } as never);
  const campaigns = useQuery(api.reporting.campaigns, {});
  const campaignName = (id: string) => campaigns?.find((c) => c._id === id)?.name ?? '—';

  return (
    <Card
      title="Recent donations"
      meta={recent ? `${recent.totalMatched} total` : undefined}
    >
      <div className="min-h-[16rem]">
        {recent === undefined ? (
          <ListSkeleton rows={limit} />
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
                    {/* Anonymous gifts are counted but never named. */}
                    {d.donorName ?? <span className="italic text-txt3">Anonymous</span>}
                  </div>
                  <div className="num truncate text-[0.6875rem] text-txt3">
                    {showCampaign && `${campaignName(d.campaignId)} · `}
                    {d.createdAtISO.slice(0, 10)}
                    {d.frequency === 'monthly' && ' · monthly'}
                  </div>
                </div>
                <span className="num shrink-0 text-sm font-medium">{d.amount.formatted}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="px-4 py-2">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center justify-between gap-4 py-2.5">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}
