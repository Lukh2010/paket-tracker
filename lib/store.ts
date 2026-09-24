import { Parcel, fetchCainiaoTracking } from './tracking';

const DEFAULT_PARCELS: Parcel[] = [
  {
    number: '00340435069718576091',
    name: 'G3 Max · Hinterradmotor',
    note: '850 W · AliExpress',
    data: {
      number: '00340435069718576091',
      internationalNumber: 'CNG00845096928460',
      origin: 'Mainland China',
      destination: 'Germany',
      status: 'DELIVERING',
      carrier: 'Cainiao',
      checkedAt: '2026-09-24T07:00:00.000Z',
      events: [
        { time: 1790193900000, description: 'Departed from departure country/region', code: 'LH_DEPART' },
        { time: 1790172000000, description: 'Leaving from departure country/region', code: 'LH_HO_AIRLINE' },
        { time: 1790083381000, description: 'Export customs clearance complete', code: 'CC_EX_SUCCESS' },
      ],
    },
  },
  {
    number: '00340435069718399393',
    name: 'Motorrad-Lenkerteil · 22 mm',
    note: 'Bestellt am 14. September · AliExpress',
    data: {
      number: '00340435069718399393',
      origin: 'Mainland China',
      destination: 'Germany',
      status: 'DELIVERING',
      carrier: 'Cainiao',
      checkedAt: '2026-09-24T07:00:00.000Z',
      events: [
        { time: 1789920000000, description: 'Departed from departure country/region', code: 'LH_DEPART' },
        { time: 1789885000000, description: 'Leaving from departure country/region', code: 'LH_HO_AIRLINE' },
      ],
    },
  },
  {
    number: 'AP00844166750486',
    name: 'Gashebel & Kleinteile',
    note: '2 × WUXING · M5×30 · D8×M5 · NFOX',
    data: {
      number: 'AP00844166750486',
      origin: 'Mainland China',
      destination: 'Germany',
      status: 'DELIVERING',
      carrier: 'Cainiao',
      checkedAt: '2026-09-24T07:00:00.000Z',
      events: [
        { time: 1790134508000, description: 'Received by warehouse', code: 'CW_INBOUND' },
      ],
    },
  },
  {
    number: '00340435069718665368',
    name: 'Motorrad-Lenkerteil · 22 mm',
    note: 'Bestellt am 22. September · AliExpress',
    data: {
      number: '00340435069718665368',
      origin: 'Mainland China',
      destination: 'Germany',
      status: 'DELIVERING',
      carrier: 'Cainiao',
      checkedAt: '2026-09-24T07:00:00.000Z',
      events: [
        { time: 1790185373000, description: '[Dongguan] Departed from sorting center', code: 'SC_OUTBOUND_SUCCESS' },
      ],
    },
  },
];

// In-memory module storage that persists across requests in the server runtime
class ParcelStore {
  private parcels: Map<string, Parcel> = new Map();
  private initialized = false;
  private isRefreshing = false;

  constructor() {
    this.init();
  }

  private init() {
    if (this.initialized) return;
    for (const p of DEFAULT_PARCELS) {
      this.parcels.set(p.number, {
        ...p,
        createdAt: new Date().toISOString(),
      });
    }
    this.initialized = true;
  }

  public getAll(): Parcel[] {
    return Array.from(this.parcels.values());
  }

  public get(number: string): Parcel | undefined {
    return this.parcels.get(number.trim().toUpperCase());
  }

  public async add(data: {
    number: string;
    name: string;
    note?: string;
  }): Promise<Parcel> {
    let cleanNumber = data.number.trim().toUpperCase().replace(/\s/g, '');
    if (
      cleanNumber.length % 2 === 0 &&
      cleanNumber.slice(0, cleanNumber.length / 2) ===
        cleanNumber.slice(cleanNumber.length / 2)
    ) {
      cleanNumber = cleanNumber.slice(0, cleanNumber.length / 2);
    }

    if (!/^[A-Z0-9]{8,40}$/.test(cleanNumber)) {
      throw new Error('Ungültige Sendungsnummer (8-40 Zeichen).');
    }

    const parcel: Parcel = {
      number: cleanNumber,
      name: data.name.trim() || 'Neues Paket',
      note: data.note?.trim() || 'Hinzugefügt',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Try fetching immediate tracking
    try {
      parcel.data = await fetchCainiaoTracking(cleanNumber);
    } catch (err: unknown) {
      parcel.error =
        err instanceof Error
          ? err.message
          : 'Konnte Trackingdaten nicht abrufen';
    }

    this.parcels.set(cleanNumber, parcel);
    return parcel;
  }

  public remove(number: string): boolean {
    const cleanNumber = number.trim().toUpperCase();
    return this.parcels.delete(cleanNumber);
  }

  public async refresh(
    number?: string,
  ): Promise<{ updated: number; errors: Record<string, string> }> {
    if (this.isRefreshing) {
      return { updated: 0, errors: { global: 'Aktualisierung läuft bereits' } };
    }

    this.isRefreshing = true;
    const errors: Record<string, string> = {};
    let updated = 0;

    try {
      const targets = number
        ? ([this.parcels.get(number.trim().toUpperCase())].filter(
            Boolean,
          ) as Parcel[])
        : Array.from(this.parcels.values());

      for (let i = 0; i < targets.length; i++) {
        const p = targets[i];
        if (i > 0) {
          // Delay 250ms between requests to prevent Cainiao upstream rate limits
          await new Promise((r) => setTimeout(r, 250));
        }

        try {
          const data = await fetchCainiaoTracking(p.number, true);
          this.parcels.set(p.number, {
            ...p,
            data,
            error: undefined,
            updatedAt: new Date().toISOString(),
          });
          updated++;
        } catch (err: unknown) {
          const errMsg =
            err instanceof Error ? err.message : 'Verbindungsfehler';
          errors[p.number] = errMsg;
          this.parcels.set(p.number, {
            ...p,
            error: p.data ? undefined : errMsg,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    } finally {
      this.isRefreshing = false;
    }

    return { updated, errors };
  }

  public setParcelsFromClient(clientParcels: Parcel[]) {
    if (!Array.isArray(clientParcels)) return;
    for (const cp of clientParcels) {
      if (cp.number && !this.parcels.has(cp.number)) {
        this.parcels.set(cp.number, cp);
      }
    }
  }
}

// Global singleton
declare global {
  // eslint-disable-next-line no-var
  var __parcelStoreInstance: ParcelStore | undefined;
}

export const parcelStore: ParcelStore =
  globalThis.__parcelStoreInstance ??
  (globalThis.__parcelStoreInstance = new ParcelStore());
