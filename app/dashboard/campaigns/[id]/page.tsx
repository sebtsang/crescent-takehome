import { CampaignDetail } from '@/components/dashboard/campaign-detail';

export const metadata = { title: 'Campaign — Crescent' };

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CampaignDetail campaignId={id} />;
}
