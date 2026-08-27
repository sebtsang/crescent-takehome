'use client';

import { useQuery } from 'convex/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/convex/_generated/api';
import {
  ChartCard,
  KpiRow,
  ListSkeleton,
  RangeHeader,
  RecentDonationsCard,
  type Grain,
  type Preset,
  type Scope,
} from '@/components/dashboard/panels';
import { GoalCell } from '@/components/dashboard/overview';
import { Card, EmptyState, Skeleton, StatusPill } from '@/components/ui/primitives';

/**
 * The overview's shape, scoped to one campaign. Every panel is the same
 * component over the same query -- the only difference is `campaignIds`.
 */
export function CampaignDetail({ campaignId }: { campaignId: string }) {
  const [preset, setPreset] = useState<Preset>('all_time');
  const [grain, setGrain] = useState<Grain>('month');

  /**
   * Resolve the id against the catalog BEFORE any campaign-scoped query runs.
   *
   * `campaignId` arrives straight from the URL, and the scoped queries type it
   * as `v.id('campaigns')`. Convex rejects anything that is not a real document
   * id at the argument validator, and `useQuery` surfaces that as a throw during
   * render -- which crashed the whole page and made the "not found" state below
   * unreachable. Convex ids carry a checksum, so this is not only a typo case:
   * a deleted campaign, a stale bookmark, or a link from before a re-seed all
   * fail the same way.
   *
   * `campaigns` takes no arguments and therefore cannot throw. Everything
   * scoped to a campaign passes 'skip' until the id is known to be real.
   */
  const campaigns = useQuery(api.reporting.campaigns, {});
  const campaign = campaigns?.find((c) => c._id === campaignId);
  const validId = campaign?._id;

  const breakdown = useQuery(
    api.reporting.breakdown,
    validId
      ? ({ range: { preset }, campaignIds: [validId], dimension: 'campaign' } as never)
      : 'skip'
  );

  const group = breakdown?.groups[0];

  // Catalog still loading. Reserve the page's shape rather than mounting the
  // panels, which would issue scoped queries with an unverified id.
  if (campaigns === undefined) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-64" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[5.75rem] w-full" />
          ))}
        </div>
        <Skeleton className="h-[15rem] w-full" />
      </div>
    );
  }

  // An unknown id is a real case (stale link, deleted campaign), not a crash.
  if (!validId) {
    return (
      <div className="card min-h-[16rem]">
        <EmptyState
          headline="Campaign not found"
          detail="This campaign may have been removed, or the link may be out of date."
        />
      </div>
    );
  }

  const scope: Scope = { range: { preset }, campaignIds: [validId] };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Link
          href="/dashboard"
          className="text-[0.8125rem] font-normal text-txt2 transition-colors hover:text-txt"
        >
          ← Overview
        </Link>
      </div>

      <RangeHeader
        title={campaign?.name ?? 'Campaign'}
        scope={scope}
        onPresetChange={setPreset}
        subtitleExtra={
          campaign ? (
            <span className="flex items-center gap-2">
              · <span className="num">{campaign.slug}</span>
              <StatusPill status={campaign.status} />
            </span>
          ) : undefined
        }
      />

      <KpiRow scope={scope} />

      <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <ChartCard scope={scope} grain={grain} onGrainChange={setGrain} />
        <Card title="Goal">
          <div className="flex min-h-[12rem] flex-col justify-center gap-4 px-4 py-4">
            {breakdown === undefined || campaigns === undefined ? (
              <>
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-1 w-full" />
                <Skeleton className="h-3 w-32" />
              </>
            ) : campaign?.goalCents === null ? (
              <div className="text-sm text-txt3">
                This campaign has no goal set.
                <div className="mt-1 text-[0.6875rem]">
                  Progress is intentionally blank rather than shown as 0%.
                </div>
              </div>
            ) : (
              <>
                <div className="display text-[1.75rem] leading-none">
                  {group?.lifetimeGoalProgressPct ?? 0}%
                </div>
                <div className="h-1.5 w-full rounded-full bg-bar-muted">
                  <div
                    className="h-full rounded-full bg-bar"
                    style={{ width: `${Math.min(100, group?.lifetimeGoalProgressPct ?? 0)}%` }}
                  />
                </div>
                <div className="num text-xs text-txt3">
                  {group?.lifetimeRaised?.formatted} of {group?.goal?.formatted}
                  {(group?.lifetimeGoalProgressPct ?? 0) > 100 && (
                    <span className="ml-1 text-txt2">· over goal</span>
                  )}
                </div>
                <div className="num text-[0.6875rem] text-txt3">
                  Lifetime progress — a goal is a cumulative target, so this does
                  not change with the selected range.
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="This campaign">
          <div className="min-h-[16rem]">
            {breakdown === undefined ? (
              <ListSkeleton rows={5} />
            ) : (
              <dl className="divide-y divide-line">
                <Row label="Raised" value={group?.raised.formatted ?? '—'} />
                <Row label="Charged incl. fees" value={group?.charged.formatted ?? '—'} />
                <Row label="Fees covered by donors" value={group?.feesCovered.formatted ?? '—'} />
                <Row label="Donations" value={String(group?.donationCount ?? 0)} />
                <Row label="Unique donors" value={String(group?.uniqueDonorCount ?? 0)} />
                <Row label="Average gift" value={group?.averageGift?.formatted ?? '—'} />
                {/* No "share of total" here: shareOfTotalPct is relative to the
                    SCOPED total, and the scope is this campaign, so it is always
                    100%. Showing it would look like a bug. */}
              </dl>
            )}
          </div>
        </Card>
        <RecentDonationsCard scope={scope} showCampaign={false} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="text-sm text-txt2">{label}</dt>
      <dd className="num text-sm font-medium">{value}</dd>
    </div>
  );
}
