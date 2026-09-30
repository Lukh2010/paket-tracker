import type { Parcel } from './tracking';

export function shipmentNumber(p: Parcel): string {
  return (p.data?.internationalNumber || p.number)
    .replace(/\s/g, '')
    .toUpperCase();
}

export function trackingQueryNumber(p: Parcel): string {
  if (!p.number.startsWith('307')) return p.number;
  // Keep using the established Cainiao number after a last-mile number appears.
  return (
    p.data?.previousNumbers?.find((n) => !n.startsWith('307')) ||
    p.data?.internationalNumber ||
    p.number
  );
}

export function trackingNumbers(p: Parcel): string[] {
  return [
    ...new Set(
      [p.number, shipmentNumber(p), ...(p.data?.previousNumbers || [])].map(
        (n) => n.replace(/\s/g, '').toUpperCase(),
      ),
    ),
  ];
}

export function groupParcels(parcels: Parcel[]) {
  const groups: Parcel[][] = [];
  for (const parcel of parcels) {
    const ids = trackingNumbers(parcel);
    const matches = groups.filter((g) =>
      g.some((p) => trackingNumbers(p).some((n) => ids.includes(n))),
    );
    if (!matches.length) groups.push([parcel]);
    else {
      matches[0].push(parcel);
      for (const other of matches.slice(1)) {
        matches[0].push(...other);
        groups.splice(groups.indexOf(other), 1);
      }
    }
  }
  return groups.map((items) => {
    const representative = [...items].sort(
      (a, b) =>
        (Date.parse(b.data?.checkedAt || '') || 0) -
        (Date.parse(a.data?.checkedAt || '') || 0),
    )[0];
    return {
      ...representative,
      error: items.find((p) => p.error)?.error,
      id: shipmentNumber(representative),
      items,
      name:
        items.length > 1
          ? `Gemeinsames Paket · ${items.length} Artikel`
          : representative.name,
    };
  });
}

export type CarrierInfo = {
  name: string;
  number: string;
  inferred: boolean;
  url: string;
};

export function carrierTracking(
  target: Parcel | string,
  parcelContext?: Parcel,
): CarrierInfo | null {
  const parcel = typeof target === 'string' ? parcelContext : target;
  const rawNumber = typeof target === 'string' ? target : shipmentNumber(target);
  const number = rawNumber.trim().toUpperCase().replace(/\s/g, '');
  if (!number) return null;

  const carrier = parcel?.data?.carrier || '';
  const destination = parcel?.data?.destination || '';
  const isGermany = /deutschland|germany|^de$/i.test(destination);

  // 1. Automatic DHL / Hermes handover detection for German shipments:
  const dhlTrace = parcel?.data?.events?.find((e) =>
    /dhl|deutsche post/i.test(e.description),
  );
  const candidate0034 = parcel
    ? trackingNumbers(parcel).find((n) => /^0034\d{16}$/.test(n))
    : /^0034\d{16}$/.test(number)
      ? number
      : undefined;

  const candidateHermes = parcel
    ? trackingNumbers(parcel).find((n) => /^H10\d{17}$/i.test(n))
    : /^H10\d{17}$/i.test(number)
      ? number
      : undefined;

  if (candidateHermes) {
    const encoded = encodeURIComponent(candidateHermes);
    return {
      name: 'Hermes',
      number: candidateHermes,
      inferred: true,
      url: `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsdetails#${encoded}`,
    };
  }

  if (
    isGermany &&
    (candidate0034 || dhlTrace || /dhl|deutsche post/i.test(carrier))
  ) {
    let dhlNumber = candidate0034;
    if (!dhlNumber && dhlTrace) {
      const match = dhlTrace.description.match(/\b(0034\d{16}|\d{10,20})\b/);
      if (match) dhlNumber = match[1];
    }
    if (
      !dhlNumber &&
      !number.startsWith('307') &&
      !number.startsWith('AP') &&
      !number.startsWith('LP')
    ) {
      dhlNumber = number;
    }
    if (dhlNumber) {
      const encoded = encodeURIComponent(dhlNumber);
      return {
        name: 'DHL',
        number: dhlNumber,
        inferred: !/dhl|deutsche post/i.test(carrier),
        url: `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${encoded}`,
      };
    }
  }

  // Pure Cainiao number with no handover
  if (number.startsWith('307') && (!parcel || number === parcel.number)) {
    return null;
  }

  const encoded = encodeURIComponent(number);

  // 2. Explicit carrier matching (from parcel.data.carrier)
  if (/dhl|deutsche post/i.test(carrier)) {
    return {
      name: 'DHL',
      number,
      inferred: false,
      url: `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${encoded}`,
    };
  }
  if (/\bdpd\b/i.test(carrier)) {
    return {
      name: 'DPD',
      number,
      inferred: false,
      url: `https://tracking.dpd.de/status/de_DE/shipment/${encoded}`,
    };
  }
  if (/\bhermes\b/i.test(carrier)) {
    return {
      name: 'Hermes',
      number,
      inferred: false,
      url: `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsdetails#${encoded}`,
    };
  }
  if (/\bgls\b/i.test(carrier)) {
    return {
      name: 'GLS',
      number,
      inferred: false,
      url: `https://www.gls-pakete.de/sendungsverfolgung?match=${encoded}`,
    };
  }
  if (/\bups\b/i.test(carrier)) {
    return {
      name: 'UPS',
      number,
      inferred: false,
      url: `https://www.ups.com/track?loc=de_DE&tracknum=${encoded}`,
    };
  }

  // 3. Pattern-based carrier inference (when carrier is unknown or Cainiao)
  // UPS: 1Z followed by 16 alphanumeric characters
  if (/^1Z[0-9A-Z]{16}$/i.test(number)) {
    return {
      name: 'UPS',
      number,
      inferred: true,
      url: `https://www.ups.com/track?loc=de_DE&tracknum=${encoded}`,
    };
  }

  // DHL Leitcode: 0034 followed by 16 digits (total 20 digits)
  if (/^0034\d{16}$/.test(number)) {
    return {
      name: 'DHL',
      number,
      inferred: true,
      url: `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${encoded}`,
    };
  }

  // Hermes alphanumeric format: H10 followed by 17 digits (total 20 chars)
  if (/^H10\d{17}$/i.test(number)) {
    return {
      name: 'Hermes',
      number,
      inferred: true,
      url: `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsdetails#${encoded}`,
    };
  }

  // Negative exclusion: non-carrier strings like AP123456789, LP..., CN...
  // Any string containing non-digits (not matching UPS or Hermes H10) is excluded
  if (!/^\d+$/.test(number)) {
    return null;
  }

  // All-digit patterns:
  // DPD: 14 digits
  if (/^\d{14}$/.test(number)) {
    return {
      name: 'DPD',
      number,
      inferred: true,
      url: `https://tracking.dpd.de/status/de_DE/shipment/${encoded}`,
    };
  }

  // Hermes: 16 digits, or 20 digits not starting with 0034
  if (/^\d{16}$/.test(number) || (/^\d{20}$/.test(number) && !number.startsWith('0034'))) {
    return {
      name: 'Hermes',
      number,
      inferred: true,
      url: `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsdetails#${encoded}`,
    };
  }

  // DHL: German domestic 10 or 12 digits
  if (/^\d{10}$/.test(number) || /^\d{12}$/.test(number)) {
    return {
      name: 'DHL',
      number,
      inferred: true,
      url: `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${encoded}`,
    };
  }

  // GLS: 8 to 11 digits
  if (/^\d{8,11}$/.test(number)) {
    return {
      name: 'GLS',
      number,
      inferred: true,
      url: `https://www.gls-pakete.de/sendungsverfolgung?match=${encoded}`,
    };
  }

  return null;
}

