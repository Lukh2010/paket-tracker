import { parcelStore } from '@/lib/store';
import { isDelivered } from '@/lib/tracking';

export const dynamic = 'force-dynamic';

export async function GET() {
  const parcels = parcelStore.getAll();
  const activeCount = parcels.filter((p) => !isDelivered(p)).length;
  const deliveredCount = parcels.filter((p) => isDelivered(p)).length;

  return Response.json(
    {
      parcels,
      totalCount: parcels.length,
      activeCount,
      deliveredCount,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    },
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      number?: string;
      name?: string;
      note?: string;
      syncParcels?: unknown[];
      updateTracking?: unknown;
      internationalNumber?: string;
    };

    // Client bulk sync support
    if (Array.isArray(body.syncParcels)) {
      parcelStore.setParcelsFromClient(
        body.syncParcels as unknown as import('@/lib/tracking').Parcel[],
      );
      return Response.json({
        success: true,
        count: parcelStore.getAll().length,
      });
    }

    // Direct tracking update (e.g. from live AliExpress desktop sync)
    if (body.updateTracking && body.number) {
      const ok = parcelStore.updateTracking(
        body.number,
        body.updateTracking as Partial<import('@/lib/tracking').TrackingData>,
        (body as { internationalNumber?: string }).internationalNumber,
      );
      return Response.json({ success: ok, updated: body.number });
    }

    if (!body.number) {
      return Response.json(
        { error: 'Sendungsnummer erforderlich.' },
        { status: 400 },
      );
    }

    const parcel = await parcelStore.add({
      number: body.number,
      name: body.name || 'Neues Paket',
      note: body.note,
    });

    return Response.json(parcel, { status: 201 });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Fehler beim Hinzufügen des Pakets';
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  let number = url.searchParams.get('number');

  if (!number) {
    try {
      const body = (await request.json()) as { number?: string };
      number = body.number || null;
    } catch {}
  }

  if (!number) {
    return Response.json(
      { error: 'Sendungsnummer erforderlich.' },
      { status: 400 },
    );
  }

  const removed = parcelStore.remove(number);
  if (!removed) {
    return Response.json({ error: 'Paket nicht gefunden.' }, { status: 404 });
  }

  return Response.json({ success: true, message: `Paket ${number} gelöscht.` });
}
