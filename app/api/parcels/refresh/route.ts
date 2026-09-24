import { parcelStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let targetNumber: string | undefined;

  try {
    const body = (await request.json()) as { number?: string };
    targetNumber = body.number;
  } catch {}

  const result = await parcelStore.refresh(targetNumber);

  return Response.json({
    success: true,
    updated: result.updated,
    errors: result.errors,
    parcels: parcelStore.getAll(),
  });
}
