import { fetchCainiaoTracking } from '@/lib/tracking';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const number =
    new URL(request.url).searchParams.get('number')?.trim().toUpperCase() || '';
  if (!number) {
    return Response.json(
      { error: 'Bitte eine Sendungsnummer angeben.' },
      { status: 400 },
    );
  }

  try {
    const data = await fetchCainiaoTracking(number);
    return Response.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Tracking-Abruf fehlgeschlagen';
    const status = message.includes('Ungültige')
      ? 400
      : message.includes('Noch keine')
        ? 404
        : 502;
    return Response.json({ error: message }, { status });
  }
}
