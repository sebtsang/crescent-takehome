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
  const scope: Scope = { range: { preset }, campaignIds: [campaignId] };

  const campaigns = useQuery(api.reporting.campaigns, {});
  const breakdown = useQuery(api.reporting.breakdown, {
    ...scope,
    dimension: 'campaign',
  } as never);

  const campaign = campaigns?.find((c) => c._id === campaignId);
  const group = breakdown?.groups[0];

  // An unknown id is a real case (stale link, deleted campaign), not a crash.
  if (campaigns !== undefined && !campaign) {
    return (
      <div className="card min-h-[16rem]">
        <EmptyState
          headline="Campaign not found"
          detail="This campaign may have been removed, or the link may be out of date."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Link
          href="/dashboard"
          className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-txt3 hover:text-txt"
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
                <div className="num text-[1.75rem] font-medium leading-none tracking-tighter">
                  {group?.goalProgressPct ?? 0}%
                </div>
                <div className="h-1.5 w-full bg-bar-muted">
                  <div
                    className="h-full bg-bar"
                    style={{ width: `${Math.min(100, group?.goalProgressPct ?? 0)}%` }}
                  />
                </div>
                <div className="num text-xs text-txt3">
                  {group?.raised.formatted} of {group?.goal?.formatted}
                  {(group?.goalProgressPct ?? 0) > 100 && (
                    <span className="ml-1 text-txt2">· over goal</span>
                  )}
                </div>
                <div className="num text-[0.6875rem] text-txt3">
                  Goal progress uses money raised in the selected range.
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
