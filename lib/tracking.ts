import fs from 'node:fs';
import path from 'node:path';

export type TrackingEvent = {
  time: number;
  description: string;
  code: string;
  location?: string;
};

export type TrackingData = {
  number: string;
  internationalNumber?: string;
  origin: string;
  destination: string;
  status: string;
  carrier: string;
  checkedAt: string;
  events: TrackingEvent[];
};

export type Parcel = {
  number: string;
  name: string;
  note: string;
  data?: TrackingData;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CainiaoItem = {
  mailNo: string;
  copyRealMailNo?: string;
  originCountry?: string;
  destCountry?: string;
  status?: string;
  destCpInfo?: { cpName?: string };
  latestTrace?: unknown;
  detailList?: Record<string, unknown>[];
};

export const EVENT_CODES_DE: Record<string, string> = {
  ORDER_PROCESSING: 'Bestellung wird vorbereitet',
  WAITING_FOR_DELIVERY: 'Wartet auf Versand',
  CW_INBOUND: 'Im Versandlager angekommen',
  CW_OUTBOUND: 'Versandlager verlassen',
  SC_INBOUND_SUCCESS: 'Im Sortierzentrum bearbeitet',
  SC_OUTBOUND_SUCCESS: 'Sortierzentrum verlassen',
  SC_ARRIVE: 'Im Sortierzentrum eingetroffen',
  PU_PICKUP_SUCCESS: 'Vom Versandpartner übernommen',
  CC_EX_START: 'Ausfuhrzoll gestartet',
  CC_EX_SUCCESS: 'Ausfuhrzoll abgeschlossen',
  LH_HO_IN_SUCCESS: 'Am Transportknoten angekommen',
  LH_HO_AIRLINE: 'Für den Weiterflug bereit',
  LH_DEPART: 'Abgangsland verlassen',
  LH_ARRIVE: 'Im Zielland angekommen',
  LH_LINEHAUL_ARRIVE: 'Am Zielflughafen angekommen',
  CC_IM_START: 'Einfuhrzoll gestartet',
  CC_IM_SUCCESS: 'Einfuhrzoll abgeschlossen',
  GTMS_DELIVERING: 'In Zustellung',
  GTMS_SIGNED: 'Zugestellt',
  SIGN_SUCCESS: 'Zugestellt',
  DELIVERY_FAILED: 'Zustellung fehlgeschlagen',
  EXCEPTION: 'Sendungsverzögerung / Zollprüfung',
};

export function formatStatusLabel(event?: TrackingEvent): string {
  if (!event) return 'Status wird abgerufen';
  return EVENT_CODES_DE[event.code] || event.description || 'Status unbekannt';
}

export function isDelivered(parcel: Parcel): boolean {
  if (parcel.data?.status === 'DELIVERED') return true;
  const latestCode = parcel.data?.events?.[0]?.code;
  return latestCode === 'GTMS_SIGNED' || latestCode === 'SIGN_SUCCESS';
}

export function formatDateDe(t: number | string): string {
  try {
    return new Intl.DateTimeFormat('de-DE', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Berlin',
    }).format(new Date(t));
  } catch {
    return String(t);
  }
}

// In-memory cache for Cainiao requests (15 min TTL)
const cainiaoCache = new Map<string, { at: number; data: TrackingData }>();

function getCainiaoCookieHeader(): string | null {
  const possiblePaths = [
    path.join(
      process.env.HOME || '/home/lukheinbach',
      '.local/share/unterwegs',
      'cainiao_cookies.json',
    ),
    path.join(
      process.env.HOME || '/home/lukheinbach',
      '.local/share/unterwegs',
      'cookies.txt',
    ),
    path.join(process.cwd(), 'data', 'cookies.txt'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf-8').trim();
        if (p.endsWith('.json')) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            return parsed
              .map((c: { name: string; value: string }) => `${c.name}=${c.value}`)
              .join('; ');
          }
        }
        if (raw) return raw;
      } catch {}
    }
  }
  return null;
}

export function parseCainiaoItem(item: CainiaoItem): TrackingData {
  const events: TrackingEvent[] = (item.detailList || []).map(
    (e: Record<string, unknown>) => {
      const rawTime = e.time;
      const timeNum =
        typeof rawTime === 'number'
          ? rawTime
          : Date.parse(typeof rawTime === 'string' ? rawTime : '');
      const desc =
        typeof e.standerdDesc === 'string'
          ? e.standerdDesc
          : typeof e.desc === 'string'
            ? e.desc
            : 'Keine Beschreibung';
      const code = typeof e.actionCode === 'string' ? e.actionCode : 'UNKNOWN';

      return {
        time: isNaN(timeNum) ? Date.now() : timeNum,
        description: desc,
        code,
      };
    },
  );

  return {
    number: item.mailNo,
    internationalNumber: item.copyRealMailNo || undefined,
    origin: item.originCountry || 'China',
    destination: item.destCountry || 'Deutschland',
    status: item.status || 'UNKNOWN',
    carrier: item.destCpInfo?.cpName || 'Cainiao',
    checkedAt: new Date().toISOString(),
    events,
  };
}

export async function fetchCainiaoBatch(
  rawNumbers: string[],
  bypassCache = false,
): Promise<Map<string, TrackingData>> {
  const cleanNumbers = Array.from(
    new Set(
      rawNumbers
        .map((n) => n.trim().toUpperCase().replace(/\s/g, ''))
        .filter((n) => /^[A-Z0-9]{8,40}$/.test(n)),
    ),
  );

  const results = new Map<string, TrackingData>();
  const toFetch: string[] = [];

  for (const num of cleanNumbers) {
    const hit = cainiaoCache.get(num);
    if (!bypassCache && hit && Date.now() - hit.at < 15 * 60 * 1000) {
      results.set(num, hit.data);
    } else {
      toFetch.push(num);
    }
  }

  if (toFetch.length === 0) {
    return results;
  }

  // Single batch query with comma-separated numbers (as in Home Assistant integration)
  const url = `https://global.cainiao.com/global/detail.json?mailNos=${encodeURIComponent(toFetch.join(','))}&lang=en-US`;
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,de;q=0.8',
    Referer: 'https://global.cainiao.com/',
  };

  const cookie = getCainiaoCookieHeader();
  if (cookie) {
    headers['Cookie'] = cookie;
  }

  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers,
  });

  if (!response.ok) {
    throw new Error(
      `Cainiao HTTP-Fehler: ${response.status} ${response.statusText}`,
    );
  }

  const rawText = await response.text();
  if (
    rawText.includes('sufei-punish') ||
    rawText.includes('punish?x5secdata=') ||
    rawText.includes('FAIL_SYS_USER_VALIDATE') ||
    rawText.includes('#nocaptcha')
  ) {
    throw new Error(
      'Cainiao-Sicherheitsüberprüfung aktiv (WAF/Captcha). Bitte kurz warten oder Tracking über die Schaltfläche direkt aufrufen.',
    );
  }

  let raw: { success?: boolean; module?: CainiaoItem[] };
  try {
    raw = JSON.parse(rawText);
  } catch {
    throw new Error(
      'Cainiao antwortete temporär nicht mit JSON. Bitte später erneut prüfen.',
    );
  }

  if (!raw.success || !Array.isArray(raw.module)) {
    throw new Error(
      'Noch keine Trackingdaten bei Cainiao hinterlegt. Bitte später erneut prüfen.',
    );
  }

  for (const item of raw.module) {
    if (!item.mailNo) continue;
    const data = parseCainiaoItem(item);
    results.set(item.mailNo, data);
    cainiaoCache.set(item.mailNo, { at: Date.now(), data });

    if (item.copyRealMailNo && item.copyRealMailNo !== item.mailNo) {
      results.set(item.copyRealMailNo, data);
      cainiaoCache.set(item.copyRealMailNo, { at: Date.now(), data });
    }
  }

  return results;
}

export async function fetchCainiaoTracking(
  rawNumber: string,
  bypassCache = false,
): Promise<TrackingData> {
  const cleanNumber = rawNumber.trim().toUpperCase().replace(/\s/g, '');
  const batch = await fetchCainiaoBatch([cleanNumber], bypassCache);
  const data = batch.get(cleanNumber);
  if (!data) {
    throw new Error(
      `Noch keine Trackingdaten für ${cleanNumber} verfügbar. Bitte später erneut prüfen.`,
    );
  }
  return data;
}

export function buildAiSummary(parcels: Parcel[]) {
  const activeParcels = parcels.filter((p) => !isDelivered(p));
  const deliveredParcels = parcels.filter((p) => isDelivered(p));

  const itemsSummary = parcels.map((p) => {
    const delivered = isDelivered(p);
    const latestEvent = p.data?.events?.[0];
    const statusText = delivered
      ? 'Zugestellt'
      : latestEvent
        ? formatStatusLabel(latestEvent)
        : p.error
          ? `Fehler: ${p.error}`
          : 'Wird abgerufen';
    const lastTime = latestEvent?.time
      ? formatDateDe(latestEvent.time)
      : 'Keine Zeitangabe';

    return {
      number: p.number,
      internationalNumber: p.data?.internationalNumber,
      name: p.name,
      note: p.note,
      isDelivered: delivered,
      status: statusText,
      origin: p.data?.origin,
      destination: p.data?.destination,
      carrier: p.data?.carrier,
      latestEventTime: lastTime,
      latestEventDescription: latestEvent?.description,
      checkedAt: p.data?.checkedAt,
      error: p.error,
    };
  });

  const lines: string[] = [
    `📦 **AliExpress / Cainiao Paketübersicht**`,
    `Gesamt: ${parcels.length} Pakete (${activeParcels.length} unterwegs, ${deliveredParcels.length} angekommen)`,
    '',
  ];

  if (activeParcels.length > 0) {
    lines.push('### 🚀 Unterwegs:');
    for (const p of activeParcels) {
      const e = p.data?.events?.[0];
      const lbl = formatStatusLabel(e);
      const time = e?.time ? formatDateDe(e.time) : '';
      lines.push(
        `- **${p.name}** (\`${p.number}\`${p.data?.internationalNumber ? ` / Int: \`${p.data.internationalNumber}\`` : ''})`,
      );
      lines.push(`  - Status: **${lbl}** ${time ? `(${time})` : ''}`);
      if (p.note) lines.push(`  - Notiz: ${p.note}`);
      if (p.error && !p.data) lines.push(`  - ⚠️ Hinweis: ${p.error}`);
    }
    lines.push('');
  }

  if (deliveredParcels.length > 0) {
    lines.push('### ✅ Zugestellt:');
    for (const p of deliveredParcels) {
      const e = p.data?.events?.[0];
      const time = e?.time ? formatDateDe(e.time) : '';
      lines.push(
        `- **${p.name}** (\`${p.number}\`): Zugestellt ${time ? `am ${time}` : ''}`,
      );
    }
    lines.push('');
  }

  lines.push(`_Stand: ${formatDateDe(Date.now())} · Quelle: Cainiao_`);

  return {
    markdownSummary: lines.join('\n'),
    totalCount: parcels.length,
    activeCount: activeParcels.length,
    deliveredCount: deliveredParcels.length,
    items: itemsSummary,
  };
}
