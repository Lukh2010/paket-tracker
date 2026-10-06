import { groupParcels, carrierTracking } from './shipments';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export type TrackingEvent = {
  time: number;
  description: string;
  code: string;
  location?: string;
};

export type TrackingData = {
  number: string;
  internationalNumber?: string;
  previousNumbers?: string[];
  origin: string;
  destination: string;
  status: string;
  carrier: string;
  checkedAt: string;
  events: TrackingEvent[];
  estimatedDeliveryTime?: string | number;
};

export type Parcel = {
  number: string;
  name: string;
  note: string;
  data?: TrackingData;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
  lastAttemptAt?: string;
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
  estimatedDeliveryTime?: string | number;
  promiseDeliveryTime?: string | number;
  estimatedDeliveryTimeDesc?: string;
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
  CC_HO_OUT_SUCCESS: 'Zollabfertigung abgeschlossen',
  TD_TRANS_ARRIVE_C: 'Im Transitland angekommen',
  LH_HO_OUT_SUCCESS: 'Vom Transportknoten weitergeleitet',
  GTMS_ACCEPT: 'Vom lokalen Zustelldienst übernommen',
  GTMS_SC_ARRIVE: 'Im Zustellzentrum eingetroffen',
  GTMS_DO_DEPART: 'In Zustellung',
  GTMS_RE_DELIVERING: 'Zustellversuch läuft',
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

declare global {
  // eslint-disable-next-line no-var
  var __unterwegsCainiaoCookie: string | undefined;
  // eslint-disable-next-line no-var
  var __unterwegsCainiaoUserAgent: string | undefined;
}

export function setCainiaoCookie(cookie: string | null, userAgent?: string) {
  globalThis.__unterwegsCainiaoCookie = cookie || undefined;
  if (userAgent) {
    globalThis.__unterwegsCainiaoUserAgent = userAgent;
  }
  if (cookie) {
    cainiaoCache.clear();
  }
}

export function getCainiaoCookie(): string | null {
  if (globalThis.__unterwegsCainiaoCookie) {
    return globalThis.__unterwegsCainiaoCookie;
  }
  return getCainiaoCookieHeader();
}

export function getCainiaoUserAgent(): string {
  return (
    globalThis.__unterwegsCainiaoUserAgent ||
    'Mozilla/5.0 (X11; Linux x86_64; rv:156.0) Gecko/20100101 Firefox/156.0'
  );
}

function getCainiaoCookieHeader(): string | null {
  const possiblePaths = [
    path.join(
      process.env.UNTERWEGS_DATA_DIR || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'unterwegs'),
      'cainiao_cookies.json',
    ),
    path.join(
      process.env.UNTERWEGS_DATA_DIR || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'unterwegs'),
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
              .map(
                (c: { name: string; value: string }) => `${c.name}=${c.value}`,
              )
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

  const finalEvents =
    events.length > 0
      ? events
      : [
          {
            time: Date.now(),
            description:
              "Bestellung wird vorbereitet (Your order's processing and will update soon)",
            code: 'ORDER_PROCESSING',
          },
        ];

  const status =
    item.status && item.status !== 'UNKNOWN'
      ? item.status
      : events.length > 0
        ? 'DELIVERING'
        : 'ORDER_PROCESSING';

  // Feature 5: Parse estimated delivery time from fields or traces
  let estimatedDeliveryTime: string | number | undefined =
    item.estimatedDeliveryTime ||
    item.promiseDeliveryTime ||
    item.estimatedDeliveryTimeDesc;

  if (!estimatedDeliveryTime && Array.isArray(item.detailList)) {
    for (const d of item.detailList) {
      const desc =
        typeof d.standerdDesc === 'string'
          ? d.standerdDesc
          : typeof d.desc === 'string'
            ? d.desc
            : '';
      const match = desc.match(
        /(?:estimated delivery(?: time)?|voraussichtliche(?:r)? (?:liefer(?:termin|ung|zeit)|zustellung)|expected delivery|delivery by|zustellung voraussichtlich)[:\s]+([A-Za-z0-9,.\s\-:]+)/i,
      );
      if (match) {
        estimatedDeliveryTime = match[1].trim();
        break;
      }
    }
  }

  // Feature 8: Automatic DHL handover detection for Cainiao shipments to Germany
  const isGermany =
    item.destCountry === 'DE' ||
    item.destCountry === 'Deutschland' ||
    item.destCountry === 'Germany';

  let carrier = item.destCpInfo?.cpName || 'Cainiao';
  let internationalNumber = item.copyRealMailNo || undefined;

  if (isGermany) {
    if (internationalNumber?.startsWith('0034')) {
      carrier = 'DHL';
    } else {
      for (const e of item.detailList || []) {
        const desc =
          typeof e.standerdDesc === 'string'
            ? e.standerdDesc
            : typeof e.desc === 'string'
              ? e.desc
              : '';
        if (/dhl|deutsche post/i.test(desc)) {
          carrier = 'DHL';
          if (!internationalNumber) {
            const m = desc.match(/\b(0034\d{16}|\d{10,20})\b/);
            if (m) internationalNumber = m[1];
          }
          break;
        }
      }
    }
  }

  return {
    number: item.mailNo,
    internationalNumber,
    origin: item.originCountry || 'China',
    destination: item.destCountry || 'Deutschland',
    status,
    carrier,
    checkedAt: new Date().toISOString(),
    events: finalEvents,
    estimatedDeliveryTime: estimatedDeliveryTime || undefined,
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
  const ua = getCainiaoUserAgent();
  const headers: Record<string, string> = {
    'User-Agent': ua,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
    Referer: 'https://global.cainiao.com/',
  };
  if (!ua.includes('Firefox')) {
    headers['Sec-Ch-Ua'] =
      '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"';
    headers['Sec-Ch-Ua-Mobile'] = '?0';
    headers['Sec-Ch-Ua-Platform'] = '"Linux"';
  }

  const cookie = getCainiaoCookie();
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
  const shipments = groupParcels(parcels);
  const activeShipments = shipments.filter((p) => !isDelivered(p));
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
      previousNumbers: p.data?.previousNumbers,
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
      lastAttemptAt: p.lastAttemptAt,
      carrierTracking: carrierTracking(p),
      estimatedDeliveryTime: p.data?.estimatedDeliveryTime,
    };
  });

  const lines: string[] = [
    `📦 **AliExpress / Cainiao Paketübersicht**`,
    `Gesamt: ${shipments.length} Pakete mit ${parcels.length} Artikeln (${activeShipments.length} unterwegs, ${shipments.length - activeShipments.length} angekommen)`,
    '',
  ];

  if (activeParcels.length > 0) {
    lines.push('### 🚀 Unterwegs:');
    for (const p of activeShipments) {
      const e = p.data?.events?.[0];
      const lbl = formatStatusLabel(e);
      const time = e?.time ? formatDateDe(e.time) : '';
      lines.push(
        `- **${p.name}** (\`${p.number}\`${p.data?.internationalNumber ? ` / Int: \`${p.data.internationalNumber}\`` : ''})`,
      );
      lines.push(`  - Status: **${lbl}** ${time ? `(${time})` : ''}`);
      if (p.note) lines.push(`  - Notiz: ${p.note}`);
      if (p.data?.estimatedDeliveryTime) {
        const etaStr =
          typeof p.data.estimatedDeliveryTime === 'number'
            ? formatDateDe(p.data.estimatedDeliveryTime)
            : String(p.data.estimatedDeliveryTime);
        lines.push(`  - Voraussichtliche Lieferung: ${etaStr}`);
      }
      lines.push(
        `  - Letzter erfolgreicher Abruf: ${p.data?.checkedAt ? formatDateDe(p.data.checkedAt) : 'Noch nicht verfügbar'}`,
      );
      if (p.items.length > 1)
        lines.push(`  - Artikel: ${p.items.map((i) => i.name).join(', ')}`);
      if (p.error)
        lines.push(`  - ⚠️ Aktualisierung fehlgeschlagen: ${p.error}`);
    }
    lines.push('');
  }

  if (deliveredParcels.length > 0) {
    lines.push('### ✅ Zugestellt:');
    for (const p of shipments.filter(isDelivered)) {
      const e = p.data?.events?.[0];
      const time = e?.time ? formatDateDe(e.time) : '';
      lines.push(
        `- **${p.name}** (\`${p.number}\`): Zugestellt ${time ? `am ${time}` : ''}`,
      );
      lines.push(
        `  - Letzter erfolgreicher Abruf: ${p.data?.checkedAt ? formatDateDe(p.data.checkedAt) : 'Noch nicht verfügbar'}`,
      );
      if (p.error)
        lines.push(`  - ⚠️ Aktualisierung fehlgeschlagen: ${p.error}`);
    }
    lines.push('');
  }

  lines.push(
    '_Quelle: Cainiao · Prüfzeiten stehen bei den jeweiligen Paketen._',
  );

  return {
    markdownSummary: lines.join('\n'),
    totalCount: shipments.length,
    articleCount: parcels.length,
    activeCount: activeShipments.length,
    deliveredCount: shipments.length - activeShipments.length,
    shipments: shipments.map((p) => ({
      id: p.id,
      name: p.name,
      numbers: p.items.map((i) => i.number),
      articleNames: p.items.map((i) => i.name),
      status: isDelivered(p)
        ? 'Zugestellt'
        : formatStatusLabel(p.data?.events?.[0]),
      checkedAt: p.data?.checkedAt,
      error: p.error,
      event: p.data?.events?.[0],
      carrierTracking: carrierTracking(p),
      estimatedDeliveryTime: p.data?.estimatedDeliveryTime,
    })),
    items: itemsSummary,
  };
}
