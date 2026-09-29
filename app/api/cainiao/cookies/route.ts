import { getCainiaoCookie, setCainiaoCookie } from '@/lib/tracking';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      cookie?: string;
      cookies?: Array<{ name: string; value: string }>;
    };

    let cookieStr = '';
    if (typeof body.cookie === 'string' && body.cookie.trim()) {
      cookieStr = body.cookie.trim();
    } else if (Array.isArray(body.cookies)) {
      cookieStr = body.cookies
        .filter(
          (c) =>
            c && typeof c.name === 'string' && typeof c.value === 'string',
        )
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');
    }

    if (!cookieStr) {
      return Response.json(
        { error: 'Keine gültigen Cookies übergeben.' },
        { status: 400 },
      );
    }

    setCainiaoCookie(cookieStr);

    try {
      const diskPaths = [
        path.join(process.cwd(), 'data', 'cookies.txt'),
        path.join(
          process.env.UNTERWEGS_DATA_DIR ||
            path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'unterwegs'),
          'cookies.txt',
        ),
      ];
      for (const p of diskPaths) {
        try {
          fs.mkdirSync(path.dirname(p), { recursive: true });
          fs.writeFileSync(p, cookieStr, 'utf-8');
        } catch {}
      }
    } catch {}

    return Response.json({
      success: true,
      hasCookie: true,
      length: cookieStr.length,
    });
  } catch (err: unknown) {
    const error =
      err instanceof Error ? err.message : 'Fehler beim Speichern der Cookies';
    return Response.json({ error }, { status: 500 });
  }
}

export async function GET() {
  const cookie = getCainiaoCookie();
  return Response.json({
    hasCookie: Boolean(cookie),
    length: cookie ? cookie.length : 0,
  });
}
