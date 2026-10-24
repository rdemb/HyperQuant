import { HIST_HOUR_MS, type HistoryIndex } from '../../../utils/tapeHistory';
import type { Candle } from '../hl/parse';
import { fetchCandles } from '../hl/rest';
import { HlStream } from '../hl/stream';
import { DAY } from '../core/time';
import { HISTORY_BASE, type Fetcher } from '../store/serverHistory';
import { type Market, ProStore, type ReplayClock } from '../store/proStore';
import { type ReplayData, fetchIndex, loadReplay, recordedRange } from './data';
import type { ReplaySource } from './link';

/**
 * Powtórka nagranej doby: osobny magazyn rynku z zegarem odtwarzania, do którego taśma, arkusz i otwarte pozycje z nagrania
 * trafiają po kolei, tak jak przychodziłyby na żywo. Przewinięcie wstecz tworzy magazyn od nowa (taśmy nie da się cofnąć),
 * w przód dokłada brakujący odcinek. Świece z API (do końca nagrania) są pamiętane, więc nowy magazyn nie pyta drugi raz.
 */

/** Tempa odtwarzania (× czas rzeczywisty). */
export const REPLAY_SPEEDS = [1, 5, 15, 60] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];
/** Najdłuższy zakres i domyślny: doba nagrania (1500 świec 1m z jednego zapytania pokrywa ją całą). */
export const REPLAY_WINDOW_MS = DAY;
/** Bez chwili w linku powtórka startuje tyle przed końcem nagrania. */
const START_BEFORE_END_MS = HIST_HOUR_MS;
const TICK_MS = 200;

export type ReplayState = 'loading' | 'ready' | 'empty' | 'error';

export interface ReplayRequest {
  source: ReplaySource;
  coin: Market;
  from: number | null;
  to: number | null;
  t: number | null;
}

/** Baza plików nagrania: gałąź historii serwera albo kopia przy lekcjach (w plikach strony). */
export function replayBase(source: ReplaySource): string {
  return source === 'history' ? HISTORY_BASE : `${import.meta.env.BASE_URL.replace(/\/+$/, '')}/lessons/replay`;
}

const defaultFetch: Fetcher = (url) => fetch(url, { signal: AbortSignal.timeout(30_000) });

export class ReplaySession {
  readonly coin: Market;
  readonly source: ReplaySource;
  state: ReplayState = 'loading';
  /** Wczytane pliki nagrania / wszystkie. */
  progress = { done: 0, total: 0 };
  from = 0;
  to = 0;
  /** Chwila odtwarzania (zegar giełdy). */
  t = 0;
  speed: ReplaySpeed = 15;
  playing = false;
  /** Magazyn wykresu powtórki; nowy po przewinięciu wstecz (`storeGen` rośnie). */
  store: ProStore | null = null;
  storeGen = 0;
  version = 0;
  private data: ReplayData | null = null;
  private fed = Number.NEGATIVE_INFINITY;
  private iFill = 0;
  private iFrame = 0;
  private iOi = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private readonly listeners = new Set<() => void>();
  private readonly candleMemo = new Map<string, Promise<Candle[]>>();
  private closed = false;

  constructor(
    private readonly req: ReplayRequest,
    private readonly fetcher: Fetcher = defaultFetch,
    private readonly loadCandles: (coin: string, interval: string, from: number, to: number) => Promise<Candle[]> = fetchCandles,
    private readonly base: string = replayBase(req.source)
  ) {
    this.coin = req.coin;
    this.source = req.source;
  }

  /** Stała funkcja (do useSyncExternalStore bez ponownej subskrypcji przy każdym renderze). */
  readonly subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private emit(): void {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  /** Spis, zakres i pliki nagrania; potem magazyn w chwili startu (pauza). */
  async load(): Promise<void> {
    const base = this.base;
    const index: HistoryIndex | null = base && typeof DecompressionStream !== 'undefined' ? await fetchIndex(base, this.fetcher) : null;
    if (this.closed) return;
    const rec = index ? recordedRange(index, this.coin) : null;
    if (!index || !rec) {
      this.state = index ? 'empty' : 'error';
      this.emit();
      return;
    }
    const to = Math.min(this.req.to ?? rec.to, rec.to);
    const from = Math.max(this.req.from ?? 0, to - REPLAY_WINDOW_MS, rec.from);
    if (!(to > from)) {
      this.state = 'empty';
      this.emit();
      return;
    }
    this.from = from;
    this.to = to;
    this.t = clamp(this.req.t ?? to - START_BEFORE_END_MS, from, to);
    this.emit();
    const data = await loadReplay(base, index, this.coin, from, to, this.fetcher, (done, total) => {
      this.progress = { done, total };
      this.emit();
    });
    if (this.closed) return;
    if (data.fills.length === 0) {
      this.state = 'empty';
      this.emit();
      return;
    }
    this.data = data;
    this.state = 'ready';
    this.rebuild();
    this.emit();
  }

  /** Przejście do chwili `t` (w zakresie nagrania). */
  seek(t: number): void {
    if (!this.data) return;
    this.t = clamp(t, this.from, this.to);
    if (this.t < this.fed) this.rebuild();
    else this.feed();
    this.lastTick = performance.now();
    this.emit();
  }

  play(): void {
    if (this.playing || !this.data) return;
    if (this.t >= this.to) this.seek(this.from);
    this.playing = true;
    this.lastTick = performance.now();
    this.timer ??= setInterval(() => this.tick(), TICK_MS);
    this.emit();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.emit();
  }

  setSpeed(s: ReplaySpeed): void {
    this.speed = s;
    this.emit();
  }

  close(): void {
    this.closed = true;
    this.pause();
    this.listeners.clear();
  }

  private tick(): void {
    const now = performance.now();
    const dt = now - this.lastTick;
    this.lastTick = now;
    this.t = Math.min(this.to, this.t + dt * this.speed);
    this.feed();
    if (this.t >= this.to) this.pause();
    else this.emit();
  }

  /** Nowy magazyn od początku nagrania do chwili odtwarzania. */
  private rebuild(): void {
    const d = this.data;
    if (!d) return;
    const clock: ReplayClock = { now: () => this.t, end: this.to, candles: (coin, iv, a, b) => this.candles(coin, iv, a, b) };
    this.store = new ProStore(new HlStream(), this.coin, clock);
    this.storeGen++;
    this.fed = Number.NEGATIVE_INFINITY;
    this.iFill = this.iFrame = this.iOi = 0;
    // Agregacje arkusza od ceny w chwili startu (ostatnia transakcja przed nią albo pierwsza nagrana)
    const k = Math.max(0, upperBound(d.fills, this.t) - 1);
    this.store.prepareReplay(d.fills[k].px);
    this.feed();
  }

  /** Dokłada nagranie z odcinka (dotąd, t] do magazynu. */
  private feed(): void {
    const d = this.data;
    const st = this.store;
    if (!d || !st || !(this.t > this.fed)) return;
    const t = this.t;
    const a = this.fed;
    const fills = [];
    while (this.iFill < d.fills.length && d.fills[this.iFill].time <= t) fills.push(d.fills[this.iFill++]);
    const frames = [];
    while (this.iFrame < d.frames.length && d.frames[this.iFrame].t <= t) frames.push(d.frames[this.iFrame++]);
    const oi: [number, number][] = [];
    while (this.iOi < d.oi.length && d.oi[this.iOi][0] <= t) oi.push(d.oi[this.iOi++]);
    const lo = Number.isFinite(a) ? a : this.from;
    const spans = d.spans.map(([x, y]): [number, number] => [Math.max(x, lo), Math.min(y, t)]).filter(([x, y]) => y > x);
    this.fed = t;
    st.feedReplay({ trades: { from: lo, to: t, spans, fills, oi }, frames });
  }

  /** Świece z API do końca nagrania, pamiętane dla kolejnych magazynów tej powtórki. */
  private candles(coin: string, interval: string, from: number, to: number): Promise<Candle[]> {
    const key = `${coin}:${interval}:${from}:${to}`;
    let p = this.candleMemo.get(key);
    if (!p) {
      p = this.loadCandles(coin, interval, from, to);
      this.candleMemo.set(key, p);
      // Błąd pobrania nie zostaje w pamięci — następna próba pyta ponownie
      p.catch(() => this.candleMemo.delete(key));
    }
    return p;
  }
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** Indeks pierwszej transakcji późniejszej niż `t`. */
function upperBound(fills: readonly { time: number }[], t: number): number {
  let lo = 0;
  let hi = fills.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fills[mid].time <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
