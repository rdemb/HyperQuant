import { DATA_BASE } from '../../../state/usePublished';
import { HIST_HOUR_MS, HIST_PART_MS, type HistFrame, type HistoryIndex, decodeBook, decodeTrades, historyPath, isHistoryIndex } from '../../../utils/tapeHistory';
import type { BookFrame } from '../core/book';
import type { Fill } from '../hl/parse';
import { type HistoryBatch, type ProStore, RETENTION_MS } from './proStore';

/**
 * Historia ostatniej doby z serwera (gałąź `history` repo danych, pliki rejestratora): taśma, zlecenia agresora, ściany,
 * otwarte pozycje i arkusz sprzed otwarcia strony, od lewej krawędzi widocznego zakresu wykresu. Godziny zamknięte
 * z plików godzinowych, bieżąca z części 5-minutowych; plik jeszcze nieobecny w spisie (CDN trzyma spis do kilku minut)
 * zgadujemy po czasie. Co ROUND_MS dociągamy brakujące: najnowsze części sprzed otwarcia strony (pojawiają się
 * z opóźnieniem) i przerwy połączenia. Plik w całości pokryty strumieniem na żywo nie jest pobierany.
 */

export const HISTORY_BASE = DATA_BASE ? DATA_BASE.replace(/\/main$/, '/history') : '';
/** Część trafia do repo ok. 25 s po swoim końcu (zapis po 10 s, takt 15 s), do tego push. */
const PUBLISH_LAG_MS = 90_000;
const INDEX_TTL_MS = 60_000;
const ROUND_MS = 120_000;
/** Arkusz (najcięższe pliki) tylko z ostatnich godzin; taśma z całej doby. */
const BOOK_MS = 12 * HIST_HOUR_MS;
const CONCURRENCY = 4;

const hourOf = (t: number) => Math.floor(t / HIST_HOUR_MS) * HIST_HOUR_MS;

export type Fetcher = (url: string) => Promise<Response>;
const defaultFetch: Fetcher = (url) => fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(20_000) });

/** Plik godziny albo części 5-minutowej. */
interface Unit {
  start: number;
  end: number;
  part: boolean;
}

const unitKey = (u: Unit) => `${u.part ? 'p' : 'h'}${u.start}`;

function toBookFrame(f: HistFrame): BookFrame {
  const nBids = f.bids.length / 3;
  const all = [...f.bids, ...f.asks];
  const n = all.length / 3;
  const px = new Float64Array(n);
  const sz = new Float64Array(n);
  const cnt = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    px[i] = all[3 * i];
    sz[i] = all[3 * i + 1];
    cnt[i] = all[3 * i + 2];
  }
  return { t: f.t, step: f.step, px, sz, n: cnt, nBids };
}

/** Wypełnienia z pliku: numery biorcy, makera i zlecenia w godzinie jako klucze (`~godzina:numer`), bez adresów. */
export function toFills(trades: NonNullable<ReturnType<typeof decodeTrades>>['trades'], hour: number): Fill[] {
  const id = (n: number, p = '') => (n >= 0 ? `~${hour}:${p}${n}` : '');
  return trades.map((x) => ({ time: x.t, px: x.px, sz: x.sz, side: x.side === 'B' ? 1 : -1, tid: x.tid, hash: id(x.o, 'o'), taker: id(x.k), maker: id(x.m) }));
}

export class ServerHistory {
  private from = Number.POSITIVE_INFINITY;
  private index: HistoryIndex | null = null;
  private indexAt = Number.NEGATIVE_INFINITY;
  private readonly done = new Set<string>();
  private busy = false;
  private again = false;
  private off = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: ProStore,
    private readonly base: string,
    private readonly fetcher: Fetcher = defaultFetch
  ) {}

  /** Historia od chwili `from` (najwyżej dobę wstecz); wcześniejsza niż dotąd — pobranie od razu. */
  ensure(from: number): Promise<void> {
    if (this.off || !(from < this.from)) return Promise.resolve();
    this.from = from;
    this.timer ??= setInterval(() => void this.round(), ROUND_MS);
    return this.round();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Jeden przebieg: pliki z brakującym czasem, od najnowszych. */
  async round(): Promise<void> {
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    try {
      do {
        this.again = false;
        const now = this.store.serverNow();
        const want = this.wanted(Math.max(this.from, now - RETENTION_MS), now);
        if (want.length === 0) break;
        const index = await this.loadIndex(now);
        if (!index) break;
        const jobs = want.flatMap((u) => this.resolve(u, index, now));
        let i = 0;
        const worker = async () => {
          while (i < jobs.length) await jobs[i++]();
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
      } while (this.again && !this.off);
    } finally {
      this.busy = false;
    }
  }

  /** Czas sprzed strumienia na żywo (zlecenia i ściany) albo luka w nagraniu. */
  private needs(a: number, b: number, now: number): boolean {
    return a < this.store.liveSince || !this.store.coverage.covers(a, Math.min(b, now));
  }

  private wanted(from: number, now: number): Unit[] {
    const out: Unit[] = [];
    if (!(from < now)) return out;
    for (let h = hourOf(now); h >= hourOf(from); h -= HIST_HOUR_MS) {
      const parts: Unit[] = [];
      for (let p = h + HIST_HOUR_MS - HIST_PART_MS; p >= h; p -= HIST_PART_MS) {
        const u = { start: p, end: p + HIST_PART_MS, part: true };
        if (u.end <= from || this.done.has(unitKey(u)) || !this.needs(u.start, u.end, now)) continue;
        parts.push(u);
      }
      // Godzina zamknięta: jeden plik godzinowy, chyba że jej części są już wczytane (strona otwarta w tej godzinie)
      const hour = { start: h, end: h + HIST_HOUR_MS, part: false };
      if (hour.end + PUBLISH_LAG_MS <= now) {
        if (parts.length > 0 && !this.done.has(unitKey(hour))) out.push(hour);
      } else out.push(...parts.filter((u) => u.end + PUBLISH_LAG_MS <= now));
    }
    return out;
  }

  private async loadIndex(now: number): Promise<HistoryIndex | null> {
    if (this.index && now - this.indexAt < INDEX_TTL_MS) return this.index;
    try {
      const res = await this.fetcher(`${this.base}/index.json`);
      const j: unknown = res.ok ? await res.json() : null;
      if (isHistoryIndex(j)) {
        this.index = j;
        this.indexAt = now;
        // Rynek bez nagrania — nie pytamy dalej
        if (!j.markets[this.store.coin]) this.off = true;
      }
    } catch {
      // Następny przebieg spróbuje ponownie
    }
    return this.off ? null : this.index;
  }

  /**
   * Pobrania dla pliku: ze spisu albo zgadnięte, gdy spis powstał przed jego publikacją. Spis świeży i bez pliku —
   * serwer nie nagrywał (godzina zamknięta: jeszcze niepołączone części, jeśli są).
   */
  private resolve(u: Unit, index: HistoryIndex, now: number): (() => Promise<void>)[] {
    const m = index.markets[this.store.coin];
    const fresh = index.asOf >= u.end + PUBLISH_LAG_MS;
    const listed = u.part ? m.parts.includes(u.start) : m.hours.includes(u.start);
    if (listed || !fresh) return [() => this.load(u, now)];
    if (!u.part) {
      const parts = m.parts.filter((p) => p >= u.start && p < u.end).map((p) => ({ start: p, end: p + HIST_PART_MS, part: true }));
      if (parts.length > 0) return parts.filter((p) => !this.done.has(unitKey(p))).map((p) => () => this.load(p, now));
    }
    this.done.add(unitKey(u));
    return [];
  }

  private async load(u: Unit, now: number): Promise<void> {
    const coin = this.store.coin;
    const withBook = u.end > now - BOOK_MS;
    const [rawT, rawB] = await Promise.all([
      this.fetchGz(historyPath(coin, u.start, 'trades', u.part)),
      withBook ? this.fetchGz(historyPath(coin, u.start, 'book', u.part)) : Promise.resolve(null),
    ]);
    const t = decodeTrades(rawT);
    const b = withBook ? decodeBook(rawB) : null;
    const tOk = t !== null && t.coin === coin;
    const bOk = b !== null && b.coin === coin;
    if (!tOk && !bOk) return;
    const batch: HistoryBatch = {
      trades: tOk ? { from: t.from, to: t.to, spans: t.spans, fills: toFills(t.trades, hourOf(u.start)), oi: t.ctx.map((c) => [c.t, c.oi]) } : null,
      frames: bOk ? b.frames.map(toBookFrame) : [],
    };
    this.store.restoreHistory(batch);
    if (tOk && (bOk || !withBook)) this.done.add(unitKey(u));
  }

  /** Plik JSON w gzip; brak pliku albo błąd → null (ponowienie w następnym przebiegu). */
  private async fetchGz(rel: string): Promise<unknown> {
    try {
      const res = await this.fetcher(`${this.base}/${rel}`);
      if (!res.ok || !res.body) return null;
      return await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).json();
    } catch {
      return null;
    }
  }
}

const loaders = new Map<ProStore, ServerHistory>();

/** Historia z serwera od chwili `from` dla rynku magazynu; bez adresu danych albo bez dekompresji w przeglądarce — nic. */
export function requestHistory(store: ProStore, from: number): void {
  if (!HISTORY_BASE || typeof DecompressionStream === 'undefined') return;
  let h = loaders.get(store);
  if (!h) loaders.set(store, (h = new ServerHistory(store, HISTORY_BASE)));
  void h.ensure(from);
}
