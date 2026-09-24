import fs from 'node:fs';
import path from 'node:path';
import { Parcel, fetchCainiaoTracking, fetchCainiaoBatch } from './tracking';

const DATA_DIR = '/home/lukheinbach/.local/bin/paket-tracker/data';
const DATA_FILE = path.join(DATA_DIR, 'parcels.json');

function makeInitialTracking(number: string): import('./tracking').TrackingData {
  return {
    number,
    origin: 'China',
    destination: 'Deutschland',
    status: 'ORDER_PROCESSING',
    carrier: 'Cainiao',
    checkedAt: new Date().toISOString(),
    events: [
      {
        time: Date.now(),
        description:
          "Bestellung wird vorbereitet (Your order's processing and will update soon)",
        code: 'ORDER_PROCESSING',
      },
    ],
  };
}

const DEFAULT_PARCELS: Parcel[] = [
  {
    number: '3076443058854663',
    name: 'AliExpress Paket #1',
    note: 'Sendung 3076443058854663',
    data: makeInitialTracking('3076443058854663'),
  },
  {
    number: '3076443058834663',
    name: 'AliExpress Paket #2',
    note: 'Sendung 3076443058834663',
    data: makeInitialTracking('3076443058834663'),
  },
  {
    number: '3076577157544663',
    name: 'AliExpress Paket #3',
    note: 'Sendung 3076577157544663',
    data: makeInitialTracking('3076577157544663'),
  },
  {
    number: '3077013352504663',
    name: 'AliExpress Paket #4',
    note: 'Sendung 3077013352504663',
    data: makeInitialTracking('3077013352504663'),
  },
  {
    number: '3077013352524663',
    name: 'AliExpress Paket #5',
    note: 'Sendung 3077013352524663',
    data: makeInitialTracking('3077013352524663'),
  },
  {
    number: '3077013352544663',
    name: 'AliExpress Paket #6',
    note: 'Sendung 3077013352544663',
    data: makeInitialTracking('3077013352544663'),
  },
  {
    number: '3076353454984663',
    name: 'AliExpress Paket #7',
    note: 'Sendung 3076353454984663',
    data: makeInitialTracking('3076353454984663'),
  },
  {
    number: '3076553896584663',
    name: 'AliExpress Paket #8',
    note: 'Sendung 3076553896584663',
    data: makeInitialTracking('3076553896584663'),
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

  private persist() {
    try {
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(Array.from(this.parcels.values()), null, 2),
        'utf-8',
      );
    } catch {
      // In sandboxed worker runtimes (workerd), host filesystem writes are restricted.
      // In-memory state remains fully active and is backed up by desktop companion / MCP.
    }
  }

  private init() {
    if (this.initialized) return;

    if (fs.existsSync(DATA_FILE)) {
      try {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const list = JSON.parse(raw);
        if (Array.isArray(list) && list.length > 0) {
          for (const p of list) {
            if (p && p.number) {
              const trackingData =
                p.data && p.data.events && p.data.events.length > 0 && p.data.status !== 'UNKNOWN'
                  ? p.data
                  : makeInitialTracking(p.number);

              this.parcels.set(p.number, {
                ...p,
                data: trackingData,
                createdAt: p.createdAt || new Date().toISOString(),
                updatedAt: p.updatedAt || new Date().toISOString(),
              });
            }
          }
          this.initialized = true;
          return;
        }
      } catch (e) {
        console.error('[Store] Failed to load parcels.json:', e);
      }
    }

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
    this.persist();
    return parcel;
  }

  public remove(number: string): boolean {
    const cleanNumber = number.trim().toUpperCase();
    const ok = this.parcels.delete(cleanNumber);
    if (ok) this.persist();
    return ok;
  }

  public updateTracking(
    number: string,
    data: Partial<import('./tracking').TrackingData>,
    internationalNumber?: string,
  ): boolean {
    const cleanNumber = number.trim().toUpperCase();
    const existing = this.parcels.get(cleanNumber);
    if (!existing) return false;

    const currentData = existing.data || makeInitialTracking(cleanNumber);
    existing.data = {
      ...currentData,
      ...data,
      internationalNumber: internationalNumber || currentData.internationalNumber,
      checkedAt: new Date().toISOString(),
    };
    existing.updatedAt = new Date().toISOString();
    existing.error = undefined;
    this.parcels.set(cleanNumber, existing);
    this.persist();
    return true;
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

      if (targets.length === 0) {
        return { updated: 0, errors };
      }

      const numbers = targets.map((t) => t.number);
      try {
        const batchResults = await fetchCainiaoBatch(numbers, true);
        for (const p of targets) {
          const freshData = batchResults.get(p.number);
          if (freshData) {
            this.parcels.set(p.number, {
              ...p,
              data: freshData,
              error: undefined,
              updatedAt: new Date().toISOString(),
            });
            updated++;
          } else {
            this.parcels.set(p.number, {
              ...p,
              error: p.data ? undefined : 'Noch keine Trackingdaten verfügbar',
              updatedAt: new Date().toISOString(),
            });
          }
        }
      } catch (err: unknown) {
        const errMsg =
          err instanceof Error ? err.message : 'Verbindungsfehler';
        for (const p of targets) {
          errors[p.number] = errMsg;
          this.parcels.set(p.number, {
            ...p,
            error: p.data ? undefined : errMsg,
            updatedAt: new Date().toISOString(),
          });
        }
      }

      this.persist();
    } finally {
      this.isRefreshing = false;
    }

    return { updated, errors };
  }

  public setParcelsFromClient(clientParcels: Parcel[]) {
    if (!Array.isArray(clientParcels)) return;
    let added = false;
    for (const cp of clientParcels) {
      if (cp.number && !this.parcels.has(cp.number)) {
        this.parcels.set(cp.number, cp);
        added = true;
      }
    }
    if (added) this.persist();
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
