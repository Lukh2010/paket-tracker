import fs from 'node:fs';
import path from 'node:path';
import { Parcel, fetchCainiaoTracking } from './tracking';

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'parcels.json');

const DEFAULT_PARCELS: Parcel[] = [
  {
    number: '3076443058854663',
    name: 'AliExpress Paket #1',
    note: 'Sendung 3076443058854663',
  },
  {
    number: '3076443058834663',
    name: 'AliExpress Paket #2',
    note: 'Sendung 3076443058834663',
  },
  {
    number: '3076577157544663',
    name: 'AliExpress Paket #3',
    note: 'Sendung 3076577157544663',
  },
  {
    number: '3077013352504663',
    name: 'AliExpress Paket #4',
    note: 'Sendung 3077013352504663',
  },
  {
    number: '3077013352524663',
    name: 'AliExpress Paket #5',
    note: 'Sendung 3077013352524663',
  },
  {
    number: '3077013352544663',
    name: 'AliExpress Paket #6',
    note: 'Sendung 3077013352544663',
  },
  {
    number: '3076353454984663',
    name: 'AliExpress Paket #7',
    note: 'Sendung 3076353454984663',
  },
  {
    number: '3076553896584663',
    name: 'AliExpress Paket #8',
    note: 'Sendung 3076553896584663',
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
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(Array.from(this.parcels.values()), null, 2),
        'utf-8',
      );
    } catch (e) {
      console.error('[Store] Failed to write parcels.json:', e);
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
              this.parcels.set(p.number, {
                ...p,
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
