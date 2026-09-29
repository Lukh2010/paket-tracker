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
  groupParcels,
  carrierTracking,
  trackingNumbers,
} from '@/lib/shipments';
import type {
  Parcel,
  TrackingData as Data,
  TrackingEvent as Event,
} from '@/lib/tracking';
import {
  Package,
  ArrowUpRight,
  RefreshCw,
  Plus,
  Plane,
  Check,
  ChevronRight,
  MoreHorizontal,
  X,
  Trash2,
  Truck,
  MapPin,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

const defaults: Parcel[] = [];

const words: Record<string, string> = {
  ORDER_PROCESSING: 'Bestellung wird vorbereitet',
  WAITING_FOR_DELIVERY: 'Wartet auf Versand',
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
  if (!e) return 'Status wird abgerufen';
  if (
    /arrived in transit country|arrived at transit country/i.test(e.description)
  )
    return 'Im Transitland angekommen';
  if (/arrived at linehaul office/i.test(e.description))
    return 'Am Transportknoten angekommen';
  return words[e.code] || e.description;
}

function delivered(p: Parcel) {
  return (
    p.data?.status === 'DELIVERED' ||
    ['GTMS_SIGNED', 'SIGN_SUCCESS'].includes(p.data?.events?.[0]?.code || '')
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
  const [expanded, setExpanded] = useState<string | null>(null);
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
          if (Array.isArray(json.parcels) && json.parcels.length >= 0) {
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

  useEffect(() => {
    const selectFromHash = () => {
      const value = new URLSearchParams(window.location.hash.slice(1)).get(
        'shipment',
      );
      if (value) setExpanded(value);
    };
    selectFromHash();
    window.addEventListener('hashchange', selectFromHash);
    const timer = window.setInterval(async () => {
      if (lock.current) return;
      try {
        const res = await fetch('/api/parcels');
        const json = (await res.json()) as { parcels?: Parcel[] };
        if (res.ok && Array.isArray(json.parcels) && !lock.current)
          setParcels(json.parcels);
      } catch {
        /* Existing data stays visible while offline. */
      }
    }, 30000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('hashchange', selectFromHash);
    };
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

  const shipments = groupParcels(parcels);
  const active = shipments.filter((p) => !delivered(p)).length;
  const selected =
    shipments.find(
      (p) =>
        p.id === expanded ||
        p.items.some((i) => trackingNumbers(i).includes(expanded || '')),
    ) || shipments[0];
  const carrier = selected ? carrierTracking(selected) : null;
  const latest = selected?.data?.events?.[0];
  const country = (value?: string) =>
    value === 'Mainland China'
      ? 'China'
      : value === 'Germany'
        ? 'Deutschland'
        : value || 'Noch unbekannt';
  const events = selected?.data?.events || [];
  const stages = [
    {
      name: 'Versendet',
      icon: Package,
      confirmed: events.some((e) =>
        ['PU_PICKUP_SUCCESS', 'SC_OUTBOUND_SUCCESS'].includes(e.code),
      ),
    },
    {
      name: 'Abgeflogen',
      icon: Plane,
      confirmed: events.some((e) => e.code === 'LH_DEPART'),
    },
    {
      name: 'Zielland',
      icon: MapPin,
      confirmed: events.some(
        (e) =>
          ['CC_IM_START', 'CC_IM_SUCCESS'].includes(e.code) ||
          (e.code === 'LH_ARRIVE' &&
            /destination country|destination region|Zielland/i.test(
              e.description,
            )),
      ),
    },
    {
      name: carrier ? `An ${carrier.name} übergeben` : 'An Zusteller übergeben',
      icon: Truck,
      confirmed: events.some((e) => {
        const explicitHandover =
          /(?:received|accepted|collected) by (?:dhl|dpd)|(?:handed over|delivered) to (?:dhl|dpd)|an (?:dhl|dpd) übergeben|von (?:dhl|dpd) (?:übernommen|bearbeitet)/i.test(
            e.description,
          );
        const localHandover =
          /received by (?:the )?local delivery company|(?:handed over|delivered) to (?:the )?(?:local delivery company|last.mile carrier)/i.test(
            e.description,
          );
        return (
          explicitHandover ||
          localHandover ||
          ['GTMS_DELIVERING', 'GTMS_SIGNED', 'SIGN_SUCCESS'].includes(e.code)
        );
      }),
    },
    {
      name: 'Zugestellt',
      icon: Check,
      confirmed: !!selected && delivered(selected),
    },
  ];
  return (
    <main className="desktop-workspace">
      <header className="app-toolbar">
        <Link className="brand" href="/">
          <span className="brand-icon">
            <Package size={21} />
          </span>
          unterwegs<span className="brand-dot">.</span>
        </Link>
        <span className="toolbar-context">
          {isDesktop ? 'Desktop' : 'Paketübersicht'}
        </span>
        <div className="toolbar-actions">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => refresh()}
            className="action"
          >
            <RefreshCw size={16} className={busy ? 'spin' : ''} />
            <span>{busy ? 'Aktualisieren …' : 'Aktualisieren'}</span>
          </Button>
          <Button
            className="action primary"
            onClick={() => setAdding(!adding)}
            aria-expanded={adding}
          >
            <Plus size={18} />
            <span>Paket hinzufügen</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  className="menu-trigger"
                  aria-label="Weitere Aktionen"
                />
              }
            >
              <MoreHorizontal size={21} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={copyAiSummary}>
                <Sparkles size={16} />
                {copiedAi
                  ? 'Zusammenfassung kopiert'
                  : 'KI-Zusammenfassung kopieren'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {adding && (
        <form className="add-form" onSubmit={add}>
          <label htmlFor="parcel-name-input">
            Name / Artikel
            <Input
              id="parcel-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Zum Beispiel: Hinterradmotor"
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
              placeholder="0034… oder AP…"
              maxLength={80}
            />
          </label>
          <label htmlFor="parcel-note-input">
            Notiz (optional)
            <Input
              id="parcel-note-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="850 W · AliExpress"
              maxLength={100}
            />
          </label>
          <Button disabled={busy} type="submit" className="action primary">
            Hinzufügen
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={() => setAdding(false)}
            aria-label="Formular schließen"
          >
            <X size={18} />
          </Button>
        </form>
      )}
      {message && <output className="app-message">{message}</output>}
      <div className="split-layout">
        <aside className="shipment-sidebar" aria-label="Deine Pakete">
          <div className="sidebar-heading">
            <div>
              <h1>Deine Pakete</h1>
              <p>
                {active} unterwegs <span>·</span> {shipments.length - active}{' '}
                angekommen · {parcels.length} Artikel
              </p>
            </div>
            <span className="parcel-count">{shipments.length}</span>
          </div>
          <nav
            className="shipment-list"
            aria-label="Paket auswählen"
            aria-busy={busy}
          >
            {shipments.map((p) => {
              const e = p.data?.events?.[0],
                chosen = selected?.id === p.id;
              return (
                <button
                  key={p.id}
                  className={'shipment-row ' + (chosen ? 'selected' : '')}
                  aria-current={chosen ? 'true' : undefined}
                  onClick={() => setExpanded(p.id)}
                >
                  <span
                    className={'row-icon ' + (delivered(p) ? 'arrived' : '')}
                  >
                    {delivered(p) ? <Check size={18} /> : <Package size={18} />}
                  </span>
                  <span className="row-copy">
                    <strong>{p.name}</strong>
                    <span className={p.error ? 'row-error' : ''}>
                      {e ? label(e) : 'Noch kein Versandstatus'}
                    </span>
                    {p.items.length > 1 && (
                      <span>{p.items.map((i) => i.name).join(', ')}</span>
                    )}
                    <time>
                      {p.data?.checkedAt
                        ? `Geprüft: ${date(p.data.checkedAt)}`
                        : 'Noch nicht erfolgreich geprüft'}
                    </time>
                    {p.error && (
                      <span className="row-error">
                        Aktualisierung fehlgeschlagen
                      </span>
                    )}
                  </span>
                  <ChevronRight size={16} className="row-arrow" />
                </button>
              );
            })}
            {!parcels.length && (
              <p className="sidebar-empty">Deine Pakete erscheinen hier.</p>
            )}
          </nav>
          <div className="sidebar-footer">
            <span className="connection-dot" />
            AliExpress · Cainiao
          </div>
        </aside>
        <section
          className="shipment-detail"
          aria-label="Sendungsdetails"
          key={selected?.number || 'empty'}
        >
          {!selected ? (
            <div className="empty">
              <Package size={40} />
              <h2>Noch nichts unterwegs.</h2>
              <p>Füge ein Paket hinzu, um seinen Versandweg zu verfolgen.</p>
              <Button
                className="action primary"
                onClick={() => setAdding(true)}
              >
                <Plus size={16} />
                Paket hinzufügen
              </Button>
            </div>
          ) : (
            <>
              <header className="detail-heading">
                <div>
                  <p className="detail-kicker">SENDUNGSDETAILS</p>
                  <h2>{selected.name}</h2>
                  {selected.items.length === 1 &&
                    selected.note &&
                    !/^(Sendung |AliExpress Ref:|Über KI hinzugefügt)/.test(
                      selected.note,
                    ) && <p className="detail-note">{selected.note}</p>}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        aria-label="Aktionen für dieses Paket"
                        className="menu-trigger"
                      />
                    }
                  >
                    <MoreHorizontal size={20} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {selected.items.map((item) => (
                      <DropdownMenuItem
                        key={item.number}
                        variant="destructive"
                        onClick={() => removeParcel(item.number)}
                      >
                        <Trash2 size={16} />
                        {selected.items.length > 1
                          ? `${item.name} entfernen`
                          : 'Paket entfernen'}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </header>
              <div className="status-panel">
                <div className="status-panel-top">
                  <span className="status-label">
                    <span />
                    {delivered(selected)
                      ? 'Zugestellt'
                      : latest
                        ? 'Unterwegs'
                        : 'Status ausstehend'}
                  </span>
                  <time>{latest ? date(latest.time) : 'Noch kein Scan'}</time>
                </div>
                <h3>
                  {latest
                    ? label(latest)
                    : selected.error
                      ? 'Status nicht verfügbar'
                      : 'Warte auf Trackingdaten'}
                </h3>
                <div className="country-route">
                  <span>{country(selected.data?.origin)}</span>
                  <span className="route-line" />
                  <Plane size={17} />
                  <span className="route-line" />
                  <span>{country(selected.data?.destination)}</span>
                </div>
              </div>
              <output className="tracking-freshness">
                {selected.data?.checkedAt
                  ? `Zuletzt erfolgreich geprüft: ${date(selected.data.checkedAt)}`
                  : 'Noch kein erfolgreicher Tracking-Abruf'}
                {selected.error && selected.lastAttemptAt && (
                  <span>Letzter Versuch: {date(selected.lastAttemptAt)}</span>
                )}
              </output>
              {selected.items.length > 1 && (
                <section
                  className="shipment-articles"
                  aria-label="Artikel in diesem Paket"
                >
                  <h3>{selected.items.length} Artikel in einer Sendung</h3>
                  <ul>
                    {selected.items.map((item) => (
                      <li key={item.number}>
                        <strong>{item.name}</strong>
                        {item.number.startsWith('307') ? (
                          <a
                            href={`https://www.aliexpress.com/p/order/detail.html?orderId=${encodeURIComponent(item.number)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Bestellung ansehen <ArrowUpRight size={14} />
                          </a>
                        ) : (
                          <span>{item.number}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {selected.error && (
                <output className="notice">
                  Aktualisierung fehlgeschlagen: {selected.error}
                  {selected.data
                    ? ' Angezeigt wird der letzte erfolgreiche Abruf.'
                    : ''}
                </output>
              )}
              <div
                className="milestones"
                aria-label="Bestätigte Versandstationen"
              >
                {stages.map((s) => (
                  <div
                    key={s.name}
                    className={'milestone ' + (s.confirmed ? 'confirmed' : '')}
                  >
                    <span className="milestone-icon">
                      <s.icon size={18} />
                    </span>
                    <span>{s.name}</span>
                    <small>
                      {s.confirmed ? 'Bestätigt' : 'Noch kein Scan'}
                    </small>
                  </div>
                ))}
              </div>
              <div className="detail-columns">
                <section className="history-section">
                  <div className="section-heading">
                    <h3>Versandverlauf</h3>
                    <span>{events.length} Meldungen</span>
                  </div>
                  <ol className="timeline">
                    {events.map((event, index) => (
                      <li key={event.time + '-' + index}>
                        <span
                          className={
                            'timeline-dot ' + (index === 0 ? 'current' : '')
                          }
                        />
                        <div>
                          <strong>{label(event)}</strong>
                          <time>{date(event.time)}</time>
                          {label(event) !== event.description && (
                            <p>{event.description}</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                  {!events.length && (
                    <p className="muted">
                      Hier erscheint der Verlauf, sobald Trackingdaten
                      vorliegen.
                    </p>
                  )}
                </section>
                <aside className="package-facts">
                  <h3>Paketinformationen</h3>
                  <dl>
                    <dt>Sendungsnummer</dt>
                    <dd>{selected.id}</dd>
                    {selected.items.length === 1 &&
                      selected.id !== selected.number && (
                        <>
                          <dt>Ursprüngliche Nummer / Bestellreferenz</dt>
                          <dd>{selected.number}</dd>
                        </>
                      )}
                    {selected.data?.previousNumbers?.filter(
                      (n) => n !== selected.id && !n.startsWith('307'),
                    ).length ? (
                      <>
                        <dt>Frühere Trackingnummern</dt>
                        <dd>
                          {selected.data.previousNumbers
                            .filter(
                              (n) => n !== selected.id && !n.startsWith('307'),
                            )
                            .join(' · ')}
                        </dd>
                      </>
                    ) : null}
                    <dt>Letzter erfolgreicher Abruf</dt>
                    <dd>
                      {selected.data?.checkedAt
                        ? date(selected.data.checkedAt)
                        : 'Noch nicht verfügbar'}
                    </dd>
                    <dt>Zusteller</dt>
                    <dd>
                      {carrier
                        ? `${carrier.name}${carrier.inferred ? ' (anhand der Nummer)' : ''}`
                        : 'Noch nicht bekannt'}
                    </dd>
                    <dt>Datenquelle</dt>
                    <dd>Cainiao</dd>
                  </dl>
                  <div className="tracking-links">
                    {carrier && (
                      <a
                        className="carrier-link"
                        href={carrier.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Bei {carrier.name} verfolgen <ArrowUpRight size={15} />
                      </a>
                    )}
                    {selected.items.length === 1 &&
                      selected.number.startsWith('307') && (
                        <a
                          href={`https://www.aliexpress.com/p/order/detail.html?orderId=${encodeURIComponent(selected.number)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          AliExpress <ArrowUpRight size={15} />
                        </a>
                      )}
                    <a
                      href={`https://global.cainiao.com/newDetail.htm?mailNoList=${encodeURIComponent(selected.data?.internationalNumber || selected.number)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Cainiao Global <ArrowUpRight size={15} />
                    </a>
                    <a
                      href={`https://t.17track.net/en#nums=${encodeURIComponent(selected.data?.internationalNumber || selected.number)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      17TRACK <ArrowUpRight size={15} />
                    </a>
                  </div>
                </aside>
              </div>
              <footer className="detail-bottom">
                <MapPin size={13} />
                Alle Zeiten in Deutschland. Stationen werden nur bei passendem
                Scan bestätigt.
              </footer>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
