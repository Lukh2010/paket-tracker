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
  Sun,
  Moon,
  Laptop,
  Pencil,
  Calendar,
  ArrowLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { toast as baseToast, Toaster } from '@/components/ui/toast';
import { useIsMobile } from '@/hooks/use-mobile';

type ThemeMode = 'system' | 'light' | 'dark';

interface ToastOptions {
  title?: React.ReactNode;
  description?: React.ReactNode;
  type?: 'success' | 'info' | 'warning' | 'error' | 'loading';
}

const toast = {
  ...baseToast,
  create: (opts: ToastOptions) => baseToast.add(opts),
};

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

function formatDateShort(val?: string | number) {
  if (!val) return '';
  if (typeof val === 'number') {
    try {
      return new Intl.DateTimeFormat('de-DE', {
        day: '2-digit',
        month: 'short',
        timeZone: 'Europe/Berlin',
      }).format(new Date(val));
    } catch {
      return String(val);
    }
  }
  const str = String(val).trim();
  if (/^\d{10,13}$/.test(str)) {
    try {
      return new Intl.DateTimeFormat('de-DE', {
        day: '2-digit',
        month: 'short',
        timeZone: 'Europe/Berlin',
      }).format(new Date(Number(str)));
    } catch {
      return str;
    }
  }
  const parsed = Date.parse(str);
  if (
    !isNaN(parsed) &&
    str.length > 8 &&
    (str.includes('-') || str.includes('/'))
  ) {
    try {
      return new Intl.DateTimeFormat('de-DE', {
        day: '2-digit',
        month: 'short',
        timeZone: 'Europe/Berlin',
      }).format(new Date(parsed));
    } catch {
      return str;
    }
  }
  return str;
}

const KEY = 'unterwegs.parcels.v1';

const noopSubscribe = () => () => {};
const getIsDesktopSnapshot = () =>
  typeof window !== 'undefined' &&
  Boolean((window as unknown as { isDesktopApp?: boolean }).isDesktopApp);
const getServerIsDesktopSnapshot = () => false;

export default function Home() {
  const isMobile = useIsMobile();
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'system';
    try {
      const saved = (localStorage.getItem('unterwegs.theme.v1') ||
        localStorage.getItem('theme')) as ThemeMode | null;
      if (saved && ['system', 'light', 'dark'].includes(saved)) {
        return saved;
      }
    } catch {}
    return 'system';
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editNote, setEditNote] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

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

  // Theme application and prefers-color-scheme listener
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const root = document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = (currentTheme: ThemeMode) => {
      try {
        localStorage.setItem('unterwegs.theme.v1', currentTheme);
        localStorage.setItem('theme', currentTheme);
      } catch {}

      const isDark =
        currentTheme === 'dark' ||
        (currentTheme === 'system' && mediaQuery.matches);
      root.classList.toggle('dark', isDark);
    };

    applyTheme(theme);

    const handleMediaChange = () => {
      if (theme === 'system') {
        root.classList.toggle('dark', mediaQuery.matches);
      }
    };

    mediaQuery.addEventListener('change', handleMediaChange);
    return () => mediaQuery.removeEventListener('change', handleMediaChange);
  }, [theme]);

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
      if (value) {
        setExpanded(value);
        if (isMobile) setMobileView('detail');
      }
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

    const onTrayRefresh = async () => {
      if (lock.current) return;
      try {
        const res = await fetch('/api/parcels');
        const json = (await res.json()) as { parcels?: Parcel[] };
        if (res.ok && Array.isArray(json.parcels) && !lock.current) {
          setParcels(json.parcels);
        }
      } catch {}
    };
    window.addEventListener('unterwegs:refresh', onTrayRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('hashchange', selectFromHash);
      window.removeEventListener('unterwegs:refresh', onTrayRefresh);
    };
  }, [isMobile]);

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
        const data = (await res.json()) as {
          parcels?: Parcel[];
          errors?: Record<string, string>;
          updated?: number;
        };
        if (Array.isArray(data.parcels)) {
          setParcels(data.parcels);
        }
        if (data.errors && Object.keys(data.errors).length > 0) {
          const errorCount = Object.keys(data.errors).length;
          const firstError = Object.values(data.errors)[0];
          toast.create({
            title: 'Aktualisierung mit Fehlern',
            description:
              errorCount === 1
                ? firstError || 'Ein Paket konnte nicht aktualisiert werden.'
                : `${errorCount} Pakete konnten nicht aktualisiert werden.`,
            type: 'warning',
          });
        }
        if (Array.isArray(data.parcels)) {
          return;
        }
      } else {
        toast.create({
          title: 'Aktualisierung fehlgeschlagen',
          description: 'Server antwortete mit einem Fehler.',
          type: 'error',
        });
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
    } catch {
      toast.create({
        title: 'Verbindungsfehler',
        description: 'Paketstatus konnte nicht aktualisiert werden.',
        type: 'error',
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, []);

  // Refresh on initial ready
  useEffect(() => {
    if (ready) {
      const timer = setTimeout(() => {
        void refresh();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [ready, refresh]);

  async function add(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const n = number.trim().toUpperCase().replace(/\s/g, '');

    if (!/^[A-Z0-9]{8,40}$/.test(n)) {
      setMessage('Bitte eine gültige Sendungsnummer eingeben (8–40 Zeichen).');
      return;
    }

    if (parcels.some((p) => trackingNumbers(p).includes(n))) {
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
      if (isMobile) setMobileView('detail');
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
    ) || (isMobile ? null : shipments[0]);

  const isEditing = Boolean(editingId && selected && editingId === selected.id);

  const handleStartEdit = () => {
    if (!selected) return;
    setEditName(selected.name);
    setEditNote(
      selected.items.length === 1 &&
        selected.note &&
        !/^(Sendung |AliExpress Ref:|Über KI hinzugefügt)/.test(selected.note)
        ? selected.note
        : '',
    );
    setEditingId(selected.id);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  const handleSaveEdit = async (e?: React.SyntheticEvent) => {
    if (e) e.preventDefault();
    if (!selected) return;
    const newName = editName.trim() || selected.name;
    const newNote = editNote.trim();
    const targetNumber = selected.number;

    // Optimistically update parcel state
    // Note: updateParcelMeta is called on the server via PATCH /api/parcels
    setParcels((old) =>
      old.map((p) =>
        p.number === targetNumber ||
        trackingNumbers(p).includes(targetNumber) ||
        trackingNumbers(p).includes(selected.id)
          ? { ...p, name: newName, note: newNote }
          : p,
      ),
    );
    setEditingId(null);
    setIsSavingEdit(true);

    try {
      const res = await fetch('/api/parcels', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number: targetNumber,
          name: newName,
          note: newNote,
        }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.create({
          title: 'Fehler beim Speichern',
          description:
            errData.error || 'Änderungen konnten nicht gespeichert werden.',
          type: 'error',
        });
      }
    } catch {
      toast.create({
        title: 'Verbindungsfehler',
        description: 'Änderungen konnten nicht an den Server gesendet werden.',
        type: 'error',
      });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleBack = () => {
    setExpanded(null);
    setMobileView('list');
    if (typeof window !== 'undefined' && window.location.hash) {
      history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
      );
    }
  };

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
          <div
            className="theme-toggle flex items-center rounded-lg border border-border/60 bg-muted/30 p-0.5"
            aria-label="Farbschema auswählen"
          >
            <Button
              variant={theme === 'system' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setTheme('system')}
              className={`h-7 px-2 text-xs font-medium ${theme === 'system' ? 'shadow-xs font-semibold' : 'text-muted-foreground'}`}
              aria-pressed={theme === 'system'}
              title="System (Automatisch)"
            >
              <Laptop size={14} className="mr-1" />
              <span>System</span>
            </Button>
            <Button
              variant={theme === 'light' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setTheme('light')}
              className={`h-7 px-2 text-xs font-medium ${theme === 'light' ? 'shadow-xs font-semibold' : 'text-muted-foreground'}`}
              aria-pressed={theme === 'light'}
              title="Hell"
            >
              <Sun size={14} className="mr-1" />
              <span>Hell</span>
            </Button>
            <Button
              variant={theme === 'dark' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setTheme('dark')}
              className={`h-7 px-2 text-xs font-medium ${theme === 'dark' ? 'shadow-xs font-semibold' : 'text-muted-foreground'}`}
              aria-pressed={theme === 'dark'}
              title="Dunkel"
            >
              <Moon size={14} className="mr-1" />
              <span>Dunkel</span>
            </Button>
          </div>
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
        <aside
          className="shipment-sidebar"
          style={
            isMobile && mobileView === 'detail'
              ? { display: 'none' }
              : undefined
          }
          aria-label="Deine Pakete"
        >
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
                  onClick={() => {
                    setExpanded(p.id);
                    if (isMobile) setMobileView('detail');
                  }}
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
                    {p.data?.estimatedDeliveryTime && !delivered(p) && (
                      <span className="eta-badge text-[11px] font-semibold text-primary">
                        ETA: {formatDateShort(p.data.estimatedDeliveryTime)}
                      </span>
                    )}
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
          style={
            isMobile && mobileView === 'list'
              ? { display: 'none' }
              : undefined
          }
          aria-label="Sendungsdetails"
        >
          {!selected ? (
            <div className="empty">
              <Package size={40} />
              <h2>
                {shipments.length
                  ? 'Keine Sendung ausgewählt'
                  : 'Noch nichts unterwegs.'}
              </h2>
              <p>
                {shipments.length
                  ? 'Wähle eine Sendung aus der Liste, um die Details anzuzeigen.'
                  : 'Füge ein Paket hinzu, um seinen Versandweg zu verfolgen.'}
              </p>
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
              {isMobile && (
                <div className="mobile-back-bar md:hidden mb-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="back-button gap-1.5 -ml-2 text-muted-foreground hover:text-foreground"
                    onClick={handleBack}
                  >
                    <ArrowLeft size={16} />
                    <span>Zurück zur Paketliste</span>
                  </Button>
                </div>
              )}
              {isEditing ? (
                <header className="detail-heading editing">
                  <form
                    className="inline-edit-form w-full flex flex-col gap-2.5 p-3 rounded-lg border border-border/80 bg-muted/20"
                    onSubmit={handleSaveEdit}
                  >
                    <p className="detail-kicker">SENDUNGSDETAILS BEARBEITEN</p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="flex-1">
                        <label
                          htmlFor="edit-name"
                          className="text-xs font-medium text-muted-foreground mb-1 block"
                        >
                          Name / Bezeichnung
                        </label>
                        <Input
                          id="edit-name"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Paketname"
                          maxLength={100}
                        />
                      </div>
                      <div className="flex-1">
                        <label
                          htmlFor="edit-note"
                          className="text-xs font-medium text-muted-foreground mb-1 block"
                        >
                          Notiz (optional)
                        </label>
                        <Input
                          id="edit-note"
                          value={editNote}
                          onChange={(e) => setEditNote(e.target.value)}
                          placeholder="Zusätzliche Notiz"
                          maxLength={100}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Button
                        type="submit"
                        size="sm"
                        className="action primary"
                        disabled={isSavingEdit}
                      >
                        <Check size={14} className="mr-1" />
                        Speichern
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleCancelEdit}
                        disabled={isSavingEdit}
                      >
                        <X size={14} className="mr-1" />
                        Abbrechen
                      </Button>
                    </div>
                  </form>
                </header>
              ) : (
                <header className="detail-heading">
                  <div className="flex-1 min-w-0">
                    <p className="detail-kicker">SENDUNGSDETAILS</p>
                    <div className="flex items-center gap-2">
                      <h2>{selected.name}</h2>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleStartEdit}
                        className="edit-button h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                        aria-label="Sendungsname und Notiz bearbeiten"
                        title="Name und Notiz bearbeiten"
                      >
                        <Pencil size={15} />
                      </Button>
                    </div>
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
              )}
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
                {selected.data?.estimatedDeliveryTime &&
                  !delivered(selected) && (
                    <div className="status-eta flex items-center gap-1.5 font-medium text-xs sm:text-sm text-foreground/90 mt-1">
                      <Calendar size={14} className="text-primary shrink-0" />
                      <span>
                        Voraussichtliche Lieferung:{' '}
                        {formatDateShort(selected.data.estimatedDeliveryTime)}
                      </span>
                    </div>
                  )}
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
                    {selected.data?.estimatedDeliveryTime &&
                      !delivered(selected) && (
                        <li className="timeline-eta">
                          <span className="timeline-dot eta" />
                          <div>
                            <strong>Voraussichtliche Zustellung</strong>
                            <time>
                              {formatDateShort(
                                selected.data.estimatedDeliveryTime,
                              )}
                            </time>
                            <p>Prognostiziertes Lieferdatum</p>
                          </div>
                        </li>
                      )}
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
      <Toaster />
    </main>
  );
}
