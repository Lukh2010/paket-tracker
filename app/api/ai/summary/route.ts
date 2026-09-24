import { parcelStore } from '@/lib/store';
import { buildAiSummary } from '@/lib/tracking';

export const dynamic = 'force-dynamic';

export async function GET() {
  const parcels = parcelStore.getAll();
  const summary = buildAiSummary(parcels);

  return Response.json(
    {
      success: true,
      ...summary,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Content-Type': 'application/json; charset=utf-8',
      },
    },
  );
}
