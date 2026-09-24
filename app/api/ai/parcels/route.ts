import { parcelStore } from '@/lib/store';
import { buildAiSummary } from '@/lib/tracking';

export const dynamic = 'force-dynamic';

export async function GET() {
  const parcels = parcelStore.getAll();
  const summary = buildAiSummary(parcels);

  return Response.json({
    totalCount: summary.totalCount,
    activeCount: summary.activeCount,
    deliveredCount: summary.deliveredCount,
    parcels: summary.items,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      number?: string;
      name?: string;
      note?: string;
    };

    if (!body.number) {
      return Response.json(
        { error: 'Tracking number (number) is required.' },
        { status: 400 },
      );
    }

    const parcel = await parcelStore.add({
      number: body.number,
      name: body.name || 'AliExpress Paket',
      note: body.note || 'Über KI hinzugefügt',
    });

    return Response.json(
      {
        success: true,
        message: `Paket '${parcel.name}' (${parcel.number}) erfolgreich hinzugefügt.`,
        parcel,
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Fehler beim Hinzufügen';
    return Response.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const number = url.searchParams.get('number');

  if (!number) {
    return Response.json(
      { error: 'Tracking number (number) is required in query param.' },
      { status: 400 },
    );
  }

  const ok = parcelStore.remove(number);
  if (!ok) {
    return Response.json(
      { error: `Paket mit Nummer ${number} nicht gefunden.` },
      { status: 404 },
    );
  }

  return Response.json({
    success: true,
    message: `Paket ${number} erfolgreich aus der Überwachung entfernt.`,
  });
}
