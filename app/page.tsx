'use client';
import {
  useEffect,
  useState,
  useRef,
  useCallback,
  useSyncExternalStore,
} from 'react';
import Link from 'next/link';
import {
  Package,
  ArrowUpRight,
  RefreshCw,
  Plus,
  Plane,
  Check,
  ChevronDown,
  Trash2,
  Truck,
  MapPin,
  Sparkles,
  CheckCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Event = { time: number; description: string; code: string };
type Data = {
  number: string;
  internationalNumber?: string;
  origin: string;
  destination: string;
  status: string;
  carrier: string;
  checkedAt: string;
  events: Event[];
};
type Parcel = {
  number: string;
  name: string;
  note: string;
  data?: Data;
  error?: string;
};

const defaults: Parcel[] = [
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

const words: Record<string, string> = {
  CW_INBOUND: 'Im Versandlager angekommen',
  LH_DEPART: 'Abgangsland verlassen',
  LH_HO_AIRLINE: 'Für den Weiterflug bereit',
  CC_EX_SUCCESS: 'Ausfuhrzoll abgeschlossen',
  CC_EX_START: 'Ausfuhrzoll gestartet',
  LH_HO_IN_SUCCESS: 'Am Transportknoten angekommen',
  SC_OUTBOUND_SUCCESS: 'Sortierzentrum verlassen',
  SC_INBOUND_SUCCESS: 'Im Sortierzentrum bearbeitet',
  PU_PICKUP_SUCCESS: 'Vom Versandpartner übernommen',
  LH_ARRIVE: 'Im Zielland angekommen',
  CC_IM_SUCCESS: 'Einfuhrzoll abgeschlossen',
  CC_IM_START: 'Einfuhrzoll gestartet',
  GTMS_SIGNED: 'Zugestellt',
  GTMS_DELIVERING: 'In Zustellung',
};

function label(e?: Event) {
  return e ? words[e.code] || e.description : 'Status wird abgerufen';
}

function delivered(p: Parcel) {
  return (
    p.data?.status === 'DELIVERED' ||
    p.data?.events?.[0]?.code === 'GTMS_SIGNED'
  );
}

function date(t: number | string) {
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

const KEY = 'unterwegs.parcels.v1';

const noopSubscribe = () => () => {};
const getIsDesktopSnapshot = () =>
  typeof window !== 'undefined' &&
  Boolean((window as unknown as { isDesktopApp?: boolean }).isDesktopApp);
const getServerIsDesktopSnapshot = () => false;

export default function Home() {
  const [parcels, setParcels] = useState<Parcel[]>(defaults);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [copiedAi, setCopiedAi] = useState(false);
  const isDesktop = useSyncExternalStore(
    noopSubscribe,
    getIsDesktopSnapshot,
    getServerIsDesktopSnapshot,
  );
  const [expanded, setExpanded] = useState<string | null>(defaults[0].number);
  const lock = useRef(false);
  const parcelsRef = useRef(parcels);
  useEffect(() => {
    parcelsRef.current = parcels;
  }, [parcels]);

  // Initial load from backend API with localStorage fallback
  useEffect(() => {
    async function loadInitial() {
      try {
        const res = await fetch('/api/parcels');
        if (res.ok) {
          const json = (await res.json()) as { parcels?: Parcel[] };
          if (Array.isArray(json.parcels) && json.parcels.length > 0) {
            setParcels(json.parcels);
            setReady(true);
            return;
          }
        }
      } catch {}

      // Fallback: localStorage
      try {
        const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (Array.isArray(saved) && saved.length > 0) {
          setParcels(
            saved.filter(
              (p) => typeof p.number === 'string' && typeof p.name === 'string',
            ),
          );
          // Sync client list to backend
          fetch('/api/parcels', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ syncParcels: saved }),
          }).catch(() => {});
        }
      } catch {}

      setReady(true);
    }

    void loadInitial();
  }, []);

  // Keep localStorage in sync as a local backup
  useEffect(() => {
    if (ready) {
      try {
        localStorage.setItem(KEY, JSON.stringify(parcels));
      } catch {}
    }
  }, [parcels, ready]);

  const refresh = useCallback(async (targetNumber?: string) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);

    try {
      const res = await fetch('/api/parcels/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(targetNumber ? { number: targetNumber } : {}),
      });

      if (res.ok) {
        const data = (await res.json()) as { parcels?: Parcel[] };
        if (Array.isArray(data.parcels)) {
          setParcels(data.parcels);
          return;
        }
      }

      // Fallback: per-item fetch
      const targets = targetNumber
        ? parcelsRef.current.filter((p) => p.number === targetNumber)
        : parcelsRef.current;
      await Promise.all(
        targets.map(async (p) => {
          try {
            const r = await fetch(
              '/api/track?number=' + encodeURIComponent(p.number),
            );
            const data = (await r.json()) as Data & { error?: string };
            setParcels((old) =>
              old.map((x) =>
                x.number === p.number
                  ? {
                      ...x,
                      ...(r.ok
                        ? { data, error: undefined }
                        : { error: data.error || 'Abruf fehlgeschlagen.' }),
                    }
                  : x,
              ),
            );
          } catch {
            setParcels((old) =>
              old.map((x) =>
                x.number === p.number
                  ? {
                      ...x,
                      error:
                        'Verbindung fehlgeschlagen. Bitte erneut versuchen.',
                    }
                  : x,
              ),
            );
          }
        }),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, []);

  // Refresh on initial ready
  useEffect(() => {
    if (ready) void refresh();
  }, [ready, refresh]);

  async function add(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    let n = number.trim().toUpperCase().replace(/\s/g, '');
    if (
      n.length % 2 === 0 &&
      n.slice(0, n.length / 2) === n.slice(n.length / 2)
    ) {
      n = n.slice(0, n.length / 2);
    }

    if (!/^[A-Z0-9]{8,40}$/.test(n)) {
      setMessage('Bitte eine gültige Sendungsnummer eingeben (8–40 Zeichen).');
      return;
    }

    if (parcels.some((p) => p.number === n)) {
      setMessage('Dieses Paket ist schon in der Liste.');
      return;
    }

    const parcelName = name.trim() || 'Neues Paket';
    const parcelNote = note.trim() || 'Manuell hinzugefügt';

    setBusy(true);
    try {
      const res = await fetch('/api/parcels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: n, name: parcelName, note: parcelNote }),
      });

      if (res.ok) {
        const added = (await res.json()) as Parcel;
        setParcels((old) => [...old.filter((x) => x.number !== n), added]);
      } else {
        const fallback: Parcel = {
          number: n,
          name: parcelName,
          note: parcelNote,
        };
        setParcels((old) => [...old, fallback]);
        void refresh(n);
      }

      setAdding(false);
      setName('');
      setNumber('');
      setNote('');
      setMessage('');
      setExpanded(n);
    } catch {
      setMessage('Fehler beim Speichern. Bitte Verbindung prüfen.');
    } finally {
      setBusy(false);
    }
  }

  async function removeParcel(targetNumber: string) {
    setParcels((old) => old.filter((x) => x.number !== targetNumber));
    setMessage('Paket aus der Übersicht entfernt.');

    try {
      await fetch('/api/parcels?number=' + encodeURIComponent(targetNumber), {
        method: 'DELETE',
      });
    } catch {}
  }

  async function copyAiSummary() {
    try {
      const res = await fetch('/api/ai/summary');
      const data = (await res.json()) as { markdownSummary?: string };
      const text = data.markdownSummary || 'Keine Zusammenfassung verfügbar.';
      await navigator.clipboard.writeText(text);
      setCopiedAi(true);
      setTimeout(() => setCopiedAi(false), 3000);
    } catch {
      setMessage(
        'Konnte Zusammenfassung nicht in die Zwischenablage kopieren.',
      );
    }
  }

  // OpenAI Sites modelContext hook
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => unknown;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();

    try {
      Promise.resolve(
        context.registerTool(
          {
            name: 'get_package_statuses',
            description:
              'Read the currently displayed parcel statuses and their last successful fetch time.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: () =>
              parcels.map((p) => ({
                name: p.name,
                number: p.number,
                status: label(p.data?.events[0]),
                checkedAt: p.data?.checkedAt,
                error: p.error,
              })),
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});

      Promise.resolve(
        context.registerTool(
          {
            name: 'refresh_package_statuses',
            description:
              'Refresh the parcel statuses from Cainiao and update the visible overview. Recent results may be cached for 15 minutes.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: true },
            execute: async () => {
              if (lock.current) return { status: 'already_refreshing' };
              await refresh();
              return {
                status: 'refresh_completed',
                note: 'Read get_package_statuses for individual results and errors.',
              };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}

    return () => lifecycle.abort();
  }, [parcels, refresh]);

  const active = parcels.filter((p) => !delivered(p)).length;

  return (
    <main className="workspace">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-icon">
            <Package size={22} />
          </span>
          unterwegs<span className="brand-dot">.</span>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {isDesktop && (
            <span
              style={{
                fontSize: '12px',
                fontWeight: 600,
                background: '#e8f3de',
                color: '#284e23',
                padding: '4px 10px',
                borderRadius: '8px',
              }}
            >
              Desktop App
            </span>
          )}
          <span className="local">
            <span />
            Hintergrund & KI aktiv
          </span>
        </div>
      </header>

      <section className="heading">
        <div>
          <p className="eyebrow">ALLES IM BLICK</p>
          <h1>Deine Pakete.</h1>
          <p className="subline">
            {active} unterwegs <span>·</span> {parcels.length - active}{' '}
            angekommen
          </p>
        </div>
        <div className="actions">
          <Button
            variant="outline"
            onClick={copyAiSummary}
            className="action"
            title="Kopiert die aktuelle Status-Übersicht formatiert für Chat-Modelle wie ChatGPT, Claude oder Antigravity"
          >
            {copiedAi ? (
              <CheckCheck size={16} style={{ color: '#2d6a4f' }} />
            ) : (
              <Sparkles size={16} />
            )}
            {copiedAi ? 'KI-Text kopiert!' : 'KI-Zusammenfassung'}
          </Button>

          <Button
            variant="outline"
            disabled={busy}
            onClick={() => refresh()}
            className="action"
          >
            <RefreshCw size={16} className={busy ? 'spin' : ''} />
            {busy ? 'Wird aktualisiert' : 'Aktualisieren'}
          </Button>

          <Button className="action primary" onClick={() => setAdding(!adding)}>
            <Plus size={18} />
            Paket hinzufügen
          </Button>
        </div>
      </section>

      {adding && (
        <form className="add-form" onSubmit={add}>
          <label htmlFor="parcel-name-input">
            Name / Artikel
            <Input
              id="parcel-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Zum Beispiel: Ersatzteile oder Hinterradmotor"
              maxLength={100}
            />
          </label>
          <label htmlFor="parcel-number-input">
            Sendungsnummer
            <Input
              id="parcel-number-input"
              required
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="Sendungsnummer (z. B. 0034... oder AP...)"
              maxLength={80}
            />
          </label>
          <label htmlFor="parcel-note-input">
            Notiz (optional)
            <Input
              id="parcel-note-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="z. B. 850 W · AliExpress"
              maxLength={100}
            />
          </label>
          <Button disabled={busy} type="submit" className="action primary">
            Hinzufügen
          </Button>
        </form>
      )}

      {message && (
        <p role="alert" className="notice">
          {message}
        </p>
      )}

      <div className="parcel-list" aria-busy={busy}>
        {!parcels.length && (
          <div className="empty">
            <Package size={36} />
            <h2>Noch nichts unterwegs.</h2>
            <p>Füge dein erstes Paket mit seiner Sendungsnummer hinzu.</p>
          </div>
        )}

        {parcels.map((p, i) => {
          const open = expanded === p.number;
          const e = p.data?.events?.[0];
          const done = delivered(p);

          return (
            <article
              className={
                'parcel ' +
                (i === 0 ? 'featured ' : '') +
                (done ? 'delivered' : '')
              }
              key={p.number}
            >
              <button
                className="parcel-head"
                aria-expanded={open}
                onClick={() => setExpanded(open ? null : p.number)}
              >
                <span className="parcel-icon">
                  {done ? (
                    <Check size={24} />
                  ) : i === 0 ? (
                    <Plane size={24} />
                  ) : (
                    <Package size={24} />
                  )}
                </span>
                <span className="parcel-name">
                  <strong>{p.name}</strong>
                  <span>{p.note}</span>
                </span>
                <span className={'status ' + (done ? 'done' : '')}>
                  {done
                    ? 'Angekommen'
                    : p.data
                      ? 'Unterwegs'
                      : p.error
                        ? 'Kein aktueller Status'
                        : 'Wird geprüft'}
                </span>
                <ChevronDown
                  size={20}
                  className={open ? 'chevron open' : 'chevron'}
                />
              </button>

              <div className="latest">
                <span className="latest-dot" />
                <div>
                  <strong>{label(e)}</strong>
                  <p>
                    {e
                      ? date(e.time)
                      : p.error
                        ? 'Noch kein Verlauf verfügbar.'
                        : 'Cainiao wird abgefragt …'}
                  </p>
                </div>
                {p.data && (
                  <span className="route">
                    {p.data.origin === 'Mainland China'
                      ? 'China'
                      : p.data.origin}
                    <ArrowUpRight size={16} />
                    {p.data.destination === 'Germany'
                      ? 'Deutschland'
                      : p.data.destination}
                  </span>
                )}
              </div>

              {p.error && (
                <div
                  style={{
                    margin: '8px 16px 12px 16px',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: '#fff8e6',
                    border: '1px solid #f6e05e',
                    color: '#744210',
                    fontSize: '13px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>⚠️ {p.error}</div>
                  <div
                    style={{
                      display: 'flex',
                      gap: '10px',
                      flexWrap: 'wrap',
                      marginTop: '2px',
                    }}
                  >
                    <a
                      href={`https://global.cainiao.com/newDetail.htm?mailNoList=${p.number}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: '#c53030',
                        textDecoration: 'underline',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <ArrowUpRight size={14} />
                      Auf Cainiao öffnen
                    </a>
                    <span style={{ color: '#aaa' }}>·</span>
                    <a
                      href={`https://t.17track.net/en#nums=${p.number}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: '#2b6cb0',
                        textDecoration: 'underline',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <ArrowUpRight size={14} />
                      Auf 17TRACK öffnen
                    </a>
                  </div>
                </div>
              )}

              {open && (
                <div className="details">
                  <div className="detail-meta">
                    <div>
                      <small>SENDUNGSNUMMER</small>
                      <span>{p.number}</span>
                      {p.data?.internationalNumber &&
                        p.data.internationalNumber !== p.number && (
                          <span className="secondary-number">
                            International: {p.data.internationalNumber}
                          </span>
                        )}
                    </div>
                    <div>
                      <small>LETZTER ABRUF</small>
                      <span>
                        {p.data
                          ? date(p.data.checkedAt)
                          : 'Noch nicht verfügbar'}
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      gap: '8px',
                      flexWrap: 'wrap',
                      margin: '12px 0 16px 0',
                    }}
                  >
                    <a
                      href={`https://global.cainiao.com/newDetail.htm?mailNoList=${p.number}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '12px',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        background: '#e02424',
                        color: '#ffffff',
                        textDecoration: 'none',
                        fontWeight: 500,
                      }}
                    >
                      <ArrowUpRight size={14} />
                      Bei Cainiao Global öffnen
                    </a>
                    <a
                      href={`https://t.17track.net/en#nums=${p.number}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '12px',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        background: '#0284c7',
                        color: '#ffffff',
                        textDecoration: 'none',
                        fontWeight: 500,
                      }}
                    >
                      <ArrowUpRight size={14} />
                      Bei 17TRACK prüfen
                    </a>
                  </div>

                  <h3>Versandverlauf</h3>
                  <ol className="timeline">
                    {p.data?.events.map((event, index) => (
                      <li key={event.time + '-' + index}>
                        <span
                          className={
                            'timeline-dot ' + (!index ? 'current' : '')
                          }
                        />
                        <div>
                          <strong>{label(event)}</strong>
                          {words[event.code] &&
                            event.description !== label(event) && (
                              <p>{event.description}</p>
                            )}
                          <time>{date(event.time)}</time>
                        </div>
                      </li>
                    ))}
                  </ol>

                  {!p.data && (
                    <p className="muted">
                      Der Verlauf erscheint nach dem ersten erfolgreichen Abruf.
                    </p>
                  )}

                  <div className="detail-footer">
                    <span>
                      <MapPin size={14} />
                      Zeiten in Deutschland · Quelle: Cainiao
                    </span>
                    <Button
                      variant="ghost"
                      onClick={() => removeParcel(p.number)}
                    >
                      <Trash2 size={15} />
                      Entfernen
                    </Button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <footer className="footer">
        <span>
          <Truck size={16} />
          Vom ersten Scan bis vor deine Tür · KI-Schnittstelle & Desktop-Dienst
          aktiv
        </span>
        <span>
          Aktualisierung beim Öffnen · Abrufe 15 Minuten zwischengespeichert
        </span>
      </footer>
    </main>
  );
}
