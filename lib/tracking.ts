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

export async function fetchCainiaoTracking(
  rawNumber: string,
  bypassCache = false,
): Promise<TrackingData> {
  const number = rawNumber.trim().toUpperCase().replace(/\s/g, '');
  if (!/^[A-Z0-9]{8,40}$/.test(number)) {
    throw new Error(
      'Ungültige Sendungsnummer (8-40 alphanumerische Zeichen erforderlich).',
    );
  }

  const hit = cainiaoCache.get(number);
  if (!bypassCache && hit && Date.now() - hit.at < 15 * 60 * 1000) {
    return hit.data;
  }

  const url = `https://global.cainiao.com/global/detail.json?mailNos=${encodeURIComponent(number)}&lang=en-US`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Cainiao HTTP-Fehler: ${response.status} ${response.statusText}`,
    );
  }

  const rawText = await response.text();
  let raw: { success?: boolean; module?: CainiaoItem[] };
  try {
    raw = JSON.parse(rawText);
  } catch {
    throw new Error(
      'Cainiao antwortete temporär nicht mit JSON (mögliche Ratenbegrenzung). Letzter Stand bleibt erhalten.',
    );
  }

  const item = raw.module?.find((x) => x.mailNo === number) || raw.module?.[0];

  if (
    !raw.success ||
    !item ||
    !item.latestTrace ||
    !Array.isArray(item.detailList)
  ) {
    throw new Error(
      'Noch keine Trackingdaten bei Cainiao hinterlegt. Bitte später erneut prüfen.',
    );
  }

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

  const data: TrackingData = {
    number,
    internationalNumber: item.copyRealMailNo || undefined,
    origin: item.originCountry || 'Unbekannt',
    destination: item.destCountry || 'Deutschland',
    status: item.status || 'UNKNOWN',
    carrier: item.destCpInfo?.cpName || 'Cainiao',
    checkedAt: new Date().toISOString(),
    events,
  };

  if (cainiaoCache.size > 200) cainiaoCache.clear();
  cainiaoCache.set(number, { at: Date.now(), data });

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
