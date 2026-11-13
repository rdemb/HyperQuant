import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { marketGroups } from '../charts/pro/chart/marketMenu';
import { fetchMetaAndCtxs } from '../charts/pro/hl/rest';
import { fmtHms } from '../charts/pro/core/time';
import { noScannerWhy } from '../utils/marketCaps';
import {
  type DexState,
  HL_WEIGHT_LIMIT_PER_MIN,
  MARKETS_REFRESH_MS,
  META_CTXS_WEIGHT,
  type MarketGroupModel,
  type SortKey,
  WeightMeter,
  marketTableModel,
  parseDexCtxs,
  registryDexes,
} from '../utils/marketsTable';
import { NYSE_CALENDAR, wallStreetAt, wallStreetCell } from '../utils/wallStreet';
import { useMarkets } from './markets';

/**
 * Dane tabeli „Rynki”: przeglądarka pyta Hyperliquid bezpośrednio (serwer HyperQuant nic nie pyta), jedno
 * `metaAndAssetCtxs` na każdą giełdę z rejestru, runda co 60 s i tylko przy widocznej karcie. Powrót do karty nie przyspiesza
 * rundy: następna rusza najwcześniej 60 s po początku poprzedniej, więc przełączanie kart nie zwiększa wag. Giełda, która
 * pojawi się w rejestrze później, dostaje jedno zapytanie od razu. Licznik wag (`WeightMeter`) liczy każde zapytanie.
 */

export interface PollerDeps {
  /** Transport: surowa odpowiedź `metaAndAssetCtxs` giełdy albo null (błąd) */
  fetchDex: (dex: string) => Promise<unknown>;
  now: () => number;
  visible: () => boolean;
  /** Subskrypcja zmiany widoczności karty; zwraca odpięcie */
  onVisibility: (fn: () => void) => () => void;
}

export interface PollerSnapshot {
  dexes: Readonly<Record<string, DexState>>;
  /** Liczba zapytań od otwarcia strony */
  requests: number;
}

export class MarketsPoller {
  readonly meter = new WeightMeter();
  private dexes: string[] = [];
  private state: Record<string, DexState> = {};
  private requests = 0;
  /** Początek ostatniej rundy (ms) */
  private lastRound = Number.NEGATIVE_INFINITY;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private running = false;
  private offVisibility: (() => void) | null = null;
  private listeners = new Set<() => void>();
  private snap: PollerSnapshot = { dexes: {}, requests: 0 };

  constructor(private readonly deps: PollerDeps) {}

  /** Uruchamia odświeżanie z listą giełd albo (już działające) zmienia listę. */
  run(dexes: readonly string[]): void {
    const added = dexes.filter((d) => !this.dexes.includes(d));
    this.dexes = [...dexes];
    for (const d of Object.keys(this.state)) if (!this.dexes.includes(d)) delete this.state[d];
    if (!this.running) {
      this.running = true;
      this.offVisibility = this.deps.onVisibility(() => this.schedule());
      this.schedule();
      return;
    }
    // Nowa giełda w rejestrze: jedno zapytanie od razu (po pierwszej rundzie; przed nią wejdzie do rundy)
    if (added.length > 0 && this.lastRound > Number.NEGATIVE_INFINITY && !this.inFlight && this.deps.visible()) void this.fetch(added);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.offVisibility?.();
    this.offVisibility = null;
  }

  snapshot = (): PollerSnapshot => this.snap;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  /** Następna runda: najwcześniej 60 s po początku poprzedniej; karta schowana — żadnej. */
  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (!this.running || !this.deps.visible()) return;
    const wait = Math.max(0, this.lastRound + MARKETS_REFRESH_MS - this.deps.now());
    this.timer = setTimeout(() => void this.round(), wait);
  }

  private async round(): Promise<void> {
    this.timer = null;
    if (!this.running || !this.deps.visible()) return;
    if (this.inFlight) {
      // Poprzednia runda jeszcze trwa (limit czasu klienta 8 s): spróbuj po jej końcu
      this.timer = setTimeout(() => void this.round(), 1000);
      return;
    }
    this.lastRound = this.deps.now();
    await this.fetch(this.dexes);
    this.schedule();
  }

  private async fetch(dexes: readonly string[]): Promise<void> {
    this.inFlight = true;
    const results = await Promise.all(
      dexes.map(async (dex) => {
        this.meter.add(this.deps.now(), META_CTXS_WEIGHT);
        this.requests++;
        try {
          return { dex, ctxs: parseDexCtxs(await this.deps.fetchDex(dex), dex) };
        } catch {
          return { dex, ctxs: null };
        }
      })
    );
    this.inFlight = false;
    const t = this.deps.now();
    for (const { dex, ctxs } of results) {
      if (!this.dexes.includes(dex)) continue;
      const prev = this.state[dex] ?? { at: null, ctxs: null, failedAt: null };
      this.state[dex] = ctxs ? { at: t, ctxs, failedAt: prev.failedAt } : { ...prev, failedAt: t };
    }
    this.snap = { dexes: { ...this.state }, requests: this.requests };
    this.listeners.forEach((fn) => fn());
  }
}

const browserDeps = (): PollerDeps => ({
  fetchDex: fetchMetaAndCtxs,
  now: () => Date.now(),
  visible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  onVisibility: (fn) => {
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  },
});

/** Co ile widok przelicza świeżość i etykiety bez nowej odpowiedzi (odczyt starszy niż 3 min → „—”). */
const CLOCK_MS = 15_000;

export interface MarketsPage {
  /** Tabela gotowa do pokazania: grupy i wiersze z tekstami */
  groups: MarketGroupModel[];
  sort: SortKey;
  setSort: (s: SortKey) => void;
  /** Waga zapytań tej strony z ostatniej minuty i limit Hyperliquid na adres IP */
  weight: number;
  weightLimit: number;
  refreshSec: number;
  /** Chwila, według której liczona jest świeżość (ms) */
  now: number;
  /** Kalendarz NYSE etykiety Wall Street: źródło, dzień odczytu i lata w pliku (null = brak pliku) */
  calendar: { source: string; readAt: string; years: string[] } | null;
}

/**
 * Jedyny hook strony „Rynki”: lista rynków z rejestru, odświeżanie (rusza, gdy lista jest rozstrzygnięta — `ready` —
 * żeby pierwsza runda objęła giełdy z rejestru, a nie 4 rynki domyślne), zegar świeżości i model tabeli z czystych
 * funkcji (`utils/marketsTable`). Komponenty widoku dostają gotowe teksty.
 */
export function useMarketsPage(): MarketsPage {
  const { markets, ready } = useMarkets();
  const poller = useMemo(() => new MarketsPoller(browserDeps()), []);
  const dexKey = registryDexes(markets).join('|');
  useEffect(() => () => poller.stop(), [poller]);
  useEffect(() => {
    if (ready) poller.run(dexKey.split('|'));
  }, [poller, ready, dexKey]);
  const snap = useSyncExternalStore(poller.subscribe, poller.snapshot);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => window.clearInterval(id);
  }, []);
  // Zegar widoku także po każdej odpowiedzi (świeżość liczona od chwili odczytu)
  useEffect(() => setNow(Date.now()), [snap]);
  const [sort, setSort] = useState<SortKey>('oi');
  const groups = useMemo(() => {
    const ws = wallStreetAt(now);
    return marketTableModel(markets, snap.dexes, now, sort, {
      groupsOf: (list) => marketGroups(list, ''),
      fmtTime: fmtHms,
      scannerWhy: (coin) => noScannerWhy(coin, markets),
      wallStreet: (m) => wallStreetCell(m, ws),
    });
  }, [markets, snap, now, sort]);
  return {
    groups,
    sort,
    setSort,
    weight: poller.meter.lastMinute(now),
    weightLimit: HL_WEIGHT_LIMIT_PER_MIN,
    refreshSec: MARKETS_REFRESH_MS / 1000,
    now,
    calendar: NYSE_CALENDAR ? { source: NYSE_CALENDAR.source, readAt: NYSE_CALENDAR.readAt, years: Object.keys(NYSE_CALENDAR.years) } : null,
  };
}
