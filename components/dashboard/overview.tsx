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
import { Card, StatusPill } from '@/components/ui/primitives';

export function Overview() {
  // Default is all_time: the data ends 2026-06-29, so a 30-day default would
  // render an empty dashboard that reads as a broken build.
  const [preset, setPreset] = useState<Preset>('all_time');
  const [grain, setGrain] = useState<Grain>('month');
  const scope: Scope = { range: { preset } };

  return (
    <div className="flex flex-col gap-3">
      <RangeHeader title="Overview" scope={scope} onPresetChange={setPreset} />
      <KpiRow scope={scope} />
      <ChartCard scope={scope} grain={grain} onGrainChange={setGrain} />
      <div className="grid gap-3 lg:grid-cols-2">
        <CampaignBreakdownCard scope={scope} />
        <RecentDonationsCard scope={scope} />
      </div>
    </div>
  );
}

function CampaignBreakdownCard({ scope }: { scope: Scope }) {
  const breakdown = useQuery(api.reporting.breakdown, {
    ...scope,
    dimension: 'campaign',
  } as never);

  return (
    <Card title="By campaign">
      <div className="min-h-[16rem]">
        {breakdown === undefined ? (
          <ListSkeleton rows={5} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="px-5 py-2 text-left text-[0.6875rem] font-normal text-txt3">Campaign</th>
                <th className="px-5 py-2 text-right text-[0.6875rem] font-normal text-txt3">Raised</th>
                <th className="px-5 py-2 text-right text-[0.6875rem] font-normal text-txt3">Goal</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.groups.map((g) => (
                <tr key={g.key} className="border-b border-line/70 last:border-0">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/dashboard/campaigns/${g.key}`}
                        className="truncate text-txt underline-offset-2 hover:text-accent hover:underline"
                      >
                        {g.label}
                      </Link>
                      {g.campaignStatus && g.campaignStatus !== 'active' && (
                        <StatusPill status={g.campaignStatus} />
                      )}
                    </div>
                    <div className="num mt-0.5 text-[0.6875rem] text-txt3">
                      {g.donationCount} gifts · {g.uniqueDonorCount} donors
                    </div>
                  </td>
                  <td className="num px-5 py-3 text-right align-top font-medium">
                    {g.raised.formatted}
                    <div className="num mt-0.5 text-[0.6875rem] font-normal text-txt3">
                      {g.shareOfTotalPct === null ? '—' : `${g.shareOfTotalPct}%`}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right align-top">
                    <GoalCell pct={g.lifetimeGoalProgressPct ?? null} goal={g.goal?.formatted} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

export function GoalCell({ pct, goal }: { pct: number | null; goal?: string }) {
  // "No goal" is a real state, not a zero. Never render 0% or NaN here.
  if (pct === null) return <span className="text-[0.6875rem] text-txt3">No goal</span>;
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="num text-sm font-medium">{pct}%</span>
      <div className="h-1 w-16 rounded-full bg-bar-muted">
        {/* The bar clamps at 100; the number above does not. Two campaigns
            are over goal (171.8%, 199.0%) and that is worth seeing. */}
        <div className="h-full rounded-full bg-bar" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      {goal && <span className="num text-[0.625rem] text-txt3">of {goal}</span>}
    </div>
  );
}
