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

export function carrierTracking(parcel: Parcel) {
  const number = shipmentNumber(parcel);
  const carrier = parcel.data?.carrier || '';
  if (number.startsWith('307') && number === parcel.number) return null;
  const encoded = encodeURIComponent(number);
  // Only infer DHL from its distinctive German parcel prefix, never from a generic numeric ID.
  if (/dhl|deutsche post/i.test(carrier) || /^0034\d{16}$/.test(number)) {
    return {
      name: 'DHL',
      number,
      inferred: !/dhl|deutsche post/i.test(carrier),
      url: `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${encoded}`,
    };
  }
  if (/\bdpd\b/i.test(carrier)) {
    return {
      name: 'DPD',
      number,
      inferred: false,
      url: `https://www.dpdgroup.com/de/mydpd/my-parcels/search?parcelNumber=${encoded}`,
    };
  }
  return null;
}
