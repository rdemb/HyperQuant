import { DATA_BASE } from '../../../state/usePublished';
import { DAY } from '../core/time';
import type { ValueBar } from '../core/valueReference';
import type { Fetcher } from './serverHistory';

/**
 * Archiwum świec 1m skanera (gałąź `archive` repo danych, plik doby `BTC/1m/RRRR/MM-DD.csv`, CSV t,o,h,l,c,v,n) do nagich
 * POC starszych niż zasięg świec 5m. Tylko BTC (skaner archiwizuje tylko BTC). Doba zamknięta się nie zmienia, więc plik
 * pobieramy raz; brak pliku (404) — null (warstwa 1h), błąd sieci — ponowna próba po RETRY_MS. Najwyżej CONCURRENCY
 * pobrań naraz.
 */

export const ARCHIVE_MARKET = 'BTC';
export const ARCHIVE_BASE = DATA_BASE ? DATA_BASE.replace(/\/main$/, '/archive') : '';
const RETRY_MS = 60_000;
const CONCURRENCY = 3;

const pad = (x: number) => String(x).padStart(2, '0');

/** Ścieżka pliku doby w gałęzi archiwum: `BTC/1m/2026/10-19.csv`. */
export function archiveMinutePath(day: number): string {
  const d = new Date(day);
  return `${ARCHIVE_MARKET}/1m/${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}.csv`;
}

/** Świece 1m doby z CSV archiwum (nagłówek t,o,h,l,c,v,n); wiersze z błędem i spoza doby pominięte. */
export function parseArchiveMinutes(csv: string, day: number): ValueBar[] {
  const out: ValueBar[] = [];
  for (const line of csv.trim().split('\n').slice(1)) {
    const [t, , h, l, , v] = line.split(',').map(Number);
    if (![t, h, l, v].every(Number.isFinite) || t < day || t >= day + DAY || !(h >= l) || !(l > 0) || v < 0) continue;
    out.push({ t, l, h, v });
  }
  return out.sort((a, b) => a.t - b.t);
}

const defaultFetch: Fetcher = (url) => fetch(url, { signal: AbortSignal.timeout(20_000) });

export class ArchiveMinutes {
  private readonly days = new Map<number, ValueBar[] | null>();
  private readonly failedAt = new Map<number, number>();
  private readonly busy = new Set<number>();
  private readonly queue: number[] = [];

  constructor(
    private readonly base: string,
    private readonly fetcher: Fetcher = defaultFetch,
    private readonly clock: () => number = Date.now
  ) {}

  /** Świece doby: lista, null (brak pliku albo archiwum) albo undefined (wczytuje się — pobranie w kolejce). */
  get(day: number): ValueBar[] | null | undefined {
    if (!this.base) return null;
    if (this.days.has(day)) return this.days.get(day);
    const failed = this.failedAt.get(day);
    if (failed !== undefined && this.clock() - failed < RETRY_MS) return null;
    if (!this.busy.has(day) && !this.queue.includes(day)) {
      this.queue.push(day);
      this.pump();
    }
    return undefined;
  }

  private pump(): void {
    while (this.busy.size < CONCURRENCY && this.queue.length > 0) {
      const day = this.queue.shift()!;
      this.busy.add(day);
      void this.load(day).finally(() => {
        this.busy.delete(day);
        this.pump();
      });
    }
  }

  private async load(day: number): Promise<void> {
    try {
      const res = await this.fetcher(`${this.base}/${archiveMinutePath(day)}`);
      if (res.status === 404) {
        this.days.set(day, null);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      this.days.set(day, parseArchiveMinutes(await res.text(), day));
      this.failedAt.delete(day);
    } catch {
      this.failedAt.set(day, this.clock());
    }
  }
}

let shared: ArchiveMinutes | null = null;

/** Archiwum 1m dla rynku `coin`: tylko BTC i tylko z adresem danych w buildzie; inaczej brak (warstwa 1h). */
export function archiveMinutesOf(coin: string): ((day: number) => ValueBar[] | null | undefined) | undefined {
  if (coin !== ARCHIVE_MARKET || !ARCHIVE_BASE) return undefined;
  shared ??= new ArchiveMinutes(ARCHIVE_BASE);
  const a = shared;
  return (day) => a.get(day);
}
