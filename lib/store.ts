import {
  groupParcels,
  trackingNumbers,
  trackingQueryNumber,
} from './shipments';
import fs from 'node:fs';
import path from 'node:path';
import { Parcel, fetchCainiaoTracking, fetchCainiaoBatch } from './tracking';

declare const __UNTERWEGS_PARCEL_BOOTSTRAP__: Parcel[];

const DATA_DIR = path.resolve(process.env.UNTERWEGS_DATA_DIR || 'data');
const DATA_FILE = path.join(DATA_DIR, 'parcels.json');

function makeInitialTracking(
  number: string,
): import('./tracking').TrackingData {
  return {
    number,
    origin: 'China',
    destination: 'Deutschland',
    status: 'ORDER_PROCESSING',
    carrier: 'Cainiao',
    checkedAt: '',
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

const DEFAULT_PARCELS: Parcel[] = [];

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
        if (Array.isArray(list)) {
          for (const p of list) {
            if (p && p.number) {
              const trackingData =
                p.data &&
                p.data.events &&
                p.data.events.length > 0 &&
                p.data.status !== 'UNKNOWN'
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

    const saved =
      typeof __UNTERWEGS_PARCEL_BOOTSTRAP__ !== 'undefined'
        ? __UNTERWEGS_PARCEL_BOOTSTRAP__
        : [];
    for (const p of saved.length ? saved : DEFAULT_PARCELS) {
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
      lastAttemptAt: new Date().toISOString(),
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
      previousNumbers: [
        ...new Set([
          ...trackingNumbers(existing),
          ...(data.previousNumbers || []),
        ]),
      ],
      internationalNumber:
        internationalNumber || currentData.internationalNumber,
      checkedAt:
        data.checkedAt ||
        (data.events?.length
          ? new Date().toISOString()
          : currentData.checkedAt),
    };
    existing.lastAttemptAt = new Date().toISOString();
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
        ? groupParcels(this.getAll()).find((g) =>
            g.items.some((p) => p.number === number.trim().toUpperCase()),
          )?.items || []
        : this.getAll();
      const attemptedAt = new Date().toISOString();

      if (targets.length === 0) {
        return { updated: 0, errors };
      }

      const numbers = targets.map(trackingQueryNumber);
      try {
        const batchResults = await fetchCainiaoBatch(numbers, true);
        for (const p of targets) {
          const freshData = batchResults.get(trackingQueryNumber(p));
          if (freshData) {
            this.parcels.set(p.number, {
              ...p,
              data: {
                ...freshData,
                previousNumbers: [
                  ...new Set([
                    ...trackingNumbers(p),
                    ...(freshData.previousNumbers || []),
                  ]),
                ],
                number: p.number,
                internationalNumber:
                  freshData.internationalNumber || p.data?.internationalNumber,
              },
              error: undefined,
              lastAttemptAt: attemptedAt,
              updatedAt: new Date().toISOString(),
            });
            updated++;
          } else {
            errors[p.number] = 'Noch keine Trackingdaten verfügbar';
            this.parcels.set(p.number, {
              ...p,
              error: 'Noch keine Trackingdaten verfügbar',
              lastAttemptAt: attemptedAt,
              updatedAt: new Date().toISOString(),
            });
          }
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Verbindungsfehler';
        for (const p of targets) {
          errors[p.number] = errMsg;
          this.parcels.set(p.number, {
            ...p,
            error: errMsg,
            lastAttemptAt: attemptedAt,
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
