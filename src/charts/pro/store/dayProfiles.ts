import { type DayProfile, PROFILE_DAY_MS, dayProfilePath, decodeDayProfile } from '../../../utils/dayProfile';
import { isHistoryIndex } from '../../../utils/tapeHistory';
import type { ProStore } from './proStore';
import { type Fetcher, HISTORY_BASE, gzJson } from './serverHistory';

/**
 * Profile zamkniętych dób z serwera (pliki rejestratora w gałęzi historii, spis `days`): kupno, sprzedaż i zmiana OI na
 * cenach dla dób, których taśmy strona nie trzyma (ostatnie 7 dób zamiast ostatniej). Doba zamknięta się nie zmienia,
 * więc plik pobieramy raz; spis odświeżamy najwyżej co INDEX_TTL_MS (nowa doba pojawia się raz dziennie po 00:00 UTC).
 * Doba używana dopiero po jej końcu w zegarze magazynu — powtórka nie widzi profilu doby, którą właśnie odtwarza.
 */

const INDEX_TTL_MS = 10 * 60_000;
const defaultFetch: Fetcher = (url) => fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(20_000) });

export class DayProfiles {
  private readonly loaded = new Map<number, DayProfile>();
  private readonly failed = new Set<number>();
  private days: number[] | null = null;
  private indexAt = Number.NEGATIVE_INFINITY;
  private from = Number.POSITIVE_INFINITY;
  private busy = false;

  constructor(
    private readonly store: ProStore,
    private readonly base: string,
    private readonly fetcher: Fetcher = defaultFetch
  ) {}

  /** Profil doby (początek doby UTC) zamkniętej w zegarze magazynu; null bez pliku albo przed pobraniem. */
  get(day: number): DayProfile | null {
    return day + PROFILE_DAY_MS <= this.store.serverNow() ? (this.loaded.get(day) ?? null) : null;
  }

  /** Profile dób od chwili `from`; po pobraniu nowych — powiadomienie magazynu (przerysowanie). */
  async ensure(from: number): Promise<void> {
    this.from = Math.min(this.from, from);
    if (this.busy) return;
    this.busy = true;
    try {
      const now = this.store.serverNow();
      if (now - this.indexAt >= INDEX_TTL_MS) await this.loadIndex(now);
      const want = (this.days ?? []).filter((d) => d + PROFILE_DAY_MS <= now && d + PROFILE_DAY_MS > this.from && !this.loaded.has(d) && !this.failed.has(d));
      const got = await Promise.all(want.map((d) => this.load(d)));
      if (got.some(Boolean)) this.store.bump();
    } finally {
      this.busy = false;
    }
  }

  private async loadIndex(now: number): Promise<void> {
    try {
      const res = await this.fetcher(`${this.base}/index.json`);
      const j: unknown = res.ok ? await res.json() : null;
      if (!isHistoryIndex(j)) return;
      this.days = j.markets[this.store.coin]?.days ?? [];
      this.indexAt = now;
      // Nowy spis — pliki, które się nie udały, próbujemy jeszcze raz
      this.failed.clear();
    } catch {
      // Następne wywołanie spróbuje ponownie
    }
  }

  private async load(day: number): Promise<boolean> {
    try {
      const res = await this.fetcher(`${this.base}/${dayProfilePath(this.store.coin, day)}`);
      const p = res.ok ? decodeDayProfile(await gzJson(res)) : null;
      if (p && p.coin === this.store.coin && p.day === day) {
        this.loaded.set(day, p);
        return true;
      }
    } catch {
      // Jak niżej
    }
    this.failed.add(day);
    return false;
  }
}

const loaders = new Map<ProStore, DayProfiles>();

/** Profile dób z serwera od chwili `from` dla rynku magazynu; bez adresu danych albo bez dekompresji w przeglądarce — nic. */
export function requestDayProfiles(store: ProStore, from: number): void {
  if (!HISTORY_BASE || typeof DecompressionStream === 'undefined') return;
  let p = loaders.get(store);
  if (!p) loaders.set(store, (p = new DayProfiles(store, HISTORY_BASE)));
  void p.ensure(from);
}

/** Pobrany profil doby z serwera; null bez niego. */
export function dayProfileOf(store: ProStore, day: number): DayProfile | null {
  return loaders.get(store)?.get(day) ?? null;
}
