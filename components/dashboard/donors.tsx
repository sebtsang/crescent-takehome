'use client';

import { useQuery } from 'convex/react';
import { useState } from 'react';
import { api } from '@/convex/_generated/api';
import {
  RANGES,
  type Preset,
  type Scope,
} from '@/components/dashboard/panels';
import {
  Card,
  EmptyState,
  SegmentedControl,
  Skeleton,
} from '@/components/ui/primitives';

const SORTS = [
  { value: 'lifetime', label: 'Total' },
  { value: 'giftCount', label: 'Gifts' },
  { value: 'lastGift', label: 'Recent' },
] as const;

type Sort = (typeof SORTS)[number]['value'];

const PAGE = 50;

export function Donors() {
  const [preset, setPreset] = useState<Preset>('all_time');
  const [sortBy, setSortBy] = useState<Sort>('lifetime');
  const [search, setSearch] = useState('');
  const [repeatOnly, setRepeatOnly] = useState(false);

  const scope: Scope = { range: { preset } };
  const result = useQuery(api.reporting.topDonors, {
    ...scope,
    sortBy,
    limit: PAGE,
    search: search.trim() || undefined,
    minGiftCount: repeatOnly ? 2 : undefined,
  } as never);

  const loading = result === undefined;

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-[1.6rem] leading-[1.1]">Donors</h1>
          <div className="mt-1 flex h-3 items-center text-xs leading-none text-txt3">
            {loading ? (
              <Skeleton className="h-3 w-48" />
            ) : (
              <span className="num">
                {result.totalMatched} {result.totalMatched === 1 ? 'donor' : 'donors'}
                {result.truncated && ` · showing first ${result.limit}`}
                {' · succeeded gifts only'}
              </span>
            )}
          </div>
        </div>
        <SegmentedControl label="Date range" value={preset} options={RANGES} onChange={setPreset} />
      </header>

      <Card
        title="All donors"
        actions={
          <SegmentedControl label="Sort by" value={sortBy} options={SORTS} onChange={setSortBy} />
        }
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email"
            aria-label="Search donors"
            className="min-w-0 flex-1 rounded-[0.375rem] border border-line bg-[var(--bg)] px-2.5 py-1.5 text-sm text-txt placeholder:text-txt3"
          />
          <label className="flex cursor-pointer items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-txt3">
            <input
              type="checkbox"
              checked={repeatOnly}
              onChange={(e) => setRepeatOnly(e.target.checked)}
              className="cursor-pointer accent-[var(--accent)]"
            />
            Repeat only
          </label>
        </div>

        <div className="min-h-[24rem]">
          {loading ? (
            <TableSkeleton />
          ) : result.donors.length === 0 ? (
            <EmptyState
              headline={search ? 'No donors match that search' : 'No donors in this period'}
              detail={
                search
                  ? 'Try a partial name or email. Anonymous donors cannot be found by name.'
                  : undefined
              }
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="eyebrow px-4 py-2 text-left font-semibold">Donor</th>
                  <th className="eyebrow px-4 py-2 text-right font-semibold">Total</th>
                  <th className="eyebrow px-4 py-2 text-right font-semibold">Gifts</th>
                  <th className="eyebrow px-4 py-2 text-right font-semibold">Last gift</th>
                </tr>
              </thead>
              <tbody>
                {result.donors.map((d) => (
                  <tr key={d.email} className="border-b border-line last:border-0">
                    <td className="max-w-0 px-4 py-2.5">
                      <div className="truncate text-txt">
                        {d.isAnonymous ? (
                          <span className="italic text-txt3">{d.displayName}</span>
                        ) : (
                          d.displayName
                        )}
                      </div>
                      {/* An anonymous donor's email is never rendered. */}
                      <div className="num truncate text-[0.6875rem] text-txt3">
                        {d.isAnonymous ? 'identity withheld' : d.email}
                        {d.campaignCount > 1 && ` · ${d.campaignCount} campaigns`}
                      </div>
                    </td>
                    <td className="num px-4 py-2.5 text-right align-top font-medium">
                      {d.lifetime.formatted}
                      <div className="num mt-0.5 text-[0.6875rem] font-normal text-txt3">
                        {d.averageGift?.formatted ?? '—'} avg
                      </div>
                    </td>
                    <td className="num px-4 py-2.5 text-right align-top">{d.giftCount}</td>
                    <td className="num px-4 py-2.5 text-right align-top text-txt2">
                      {d.lastGiftISO.slice(0, 10)}
                      <div className="num mt-0.5 text-[0.6875rem] text-txt3">
                        first {d.firstGiftISO.slice(0, 10)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!loading && result.truncated && (
          <div className="border-t border-line px-4 py-2 text-[0.6875rem] text-txt3">
            Showing the top {result.limit} of {result.totalMatched}. Narrow with search or a
            shorter range.
          </div>
        )}
      </Card>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="px-4 py-2">
      {Array.from({ length: 10 }).map((_, r) => (
        <div key={r} className="flex items-center justify-between gap-4 py-3">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-8" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}
