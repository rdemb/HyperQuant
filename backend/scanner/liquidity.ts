/**
 * Rejestrator płynności arkusza: z migawek `l2Book` (zagregowanych do 4 cyfr znaczących — koszyki ~10 USD, zasięg ±20 bp)
 * głębokość po obu stronach w ±10 i ±20 bp od środka; minutowe mediany przechowywane na serwerze (30 dni, ~130 KB/dzień),
 * publikowane wyłącznie agregaty: profil płynności wg godziny UTC, bieżąca płynność względem normy tej godziny i odporność
 * (ile minut głębokość wraca do normy po gwałtownym ruchu ceny). Publiczne API nie daje historii arkusza — to ją tworzy.
 */
import type { LiquidityProfile } from '../../src/utils/liquidity.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Okno historii (dni) */
export const LIQ_KEEP_DAYS = 30;

export interface BookSnap {
  t: number;
  mid: number;
  /** USD po stronie bid / ask w ±10 bp i ±20 bp od środka */
  b10: number;
  a10: number;
  b20: number;
  a20: number;
}

/** Wiersz minutowy: mediany migawek z minuty */
export interface MinuteRow extends BookSnap {
  n: number;
}

type Lvl = { px?: unknown; sz?: unknown };

/** Migawka z poziomów `l2Book` [bids, asks]; pusta strona / skrzyżowany arkusz → null. */
export function bookSnap(t: number, levels: unknown): BookSnap | null {
  if (!Array.isArray(levels) || levels.length < 2) return null;
  const side = (rows: unknown) =>
    (Array.isArray(rows) ? (rows as Lvl[]) : [])
      .map((r) => ({ px: Number(r?.px), sz: Number(r?.sz) }))
      .filter((r) => Number.isFinite(r.px) && Number.isFinite(r.sz) && r.px > 0 && r.sz > 0);
  const bids = side(levels[0]);
  const asks = side(levels[1]);
  if (!bids.length || !asks.length || bids[0].px >= asks[0].px) return null;
  const mid = (bids[0].px + asks[0].px) / 2;
  const depth = (xs: { px: number; sz: number }[], bp: number) => xs.filter((r) => Math.abs(r.px - mid) <= (mid * bp) / 1e4).reduce((a, r) => a + r.px * r.sz, 0);
  return { t, mid, b10: depth(bids, 10), a10: depth(asks, 10), b20: depth(bids, 20), a20: depth(asks, 20) };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Mediany migawek w minutach (klucz = początek minuty); minuta w toku (koniec > `now`) pomijana. */
export function minuteRows(snaps: BookSnap[], now: number): MinuteRow[] {
  const by = new Map<number, BookSnap[]>();
  for (const s of snaps) {
    const k = Math.floor(s.t / MIN) * MIN;
    if (k + MIN > now) continue;
    const arr = by.get(k);
    if (arr) arr.push(s);
    else by.set(k, [s]);
  }
  return [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, xs]) => ({
      t,
      n: xs.length,
      mid: median(xs.map((x) => x.mid)),
      b10: median(xs.map((x) => x.b10)),
      a10: median(xs.map((x) => x.a10)),
      b20: median(xs.map((x) => x.b20)),
      a20: median(xs.map((x) => x.a20)),
    }));
}

/** Agregaty do publikacji z wierszy minutowych (okno `days` dni). */
export function liquidityProfile(rows: MinuteRow[], coin: string, now: number, days = LIQ_KEEP_DAYS): LiquidityProfile {
  const from = now - days * DAY;
  const rs = rows.filter((r) => r.t >= from && r.t < now).sort((a, b) => a.t - b.t);
  const tot10 = (r: MinuteRow) => r.b10 + r.a10;
  const tot20 = (r: MinuteRow) => r.b20 + r.a20;
  const byHour = Array.from({ length: 24 }, (_, h) => {
    const xs = rs.filter((r) => new Date(r.t).getUTCHours() === h);
    return { h, d10: xs.length ? median(xs.map(tot10)) : null, d20: xs.length ? median(xs.map(tot20)) : null, n: xs.length };
  });
  const last = rs[rs.length - 1];
  const norm = last ? byHour[new Date(last.t).getUTCHours()].d10 : null;
  // Odporność: zdarzenie = minuta z ruchem środka ≥ 15 bp względem poprzedniej (ciągłej) minuty
  const recov: number[] = [];
  let unrecovered = 0;
  let events = 0;
  for (let i = 1; i < rs.length; i++) {
    const p = rs[i - 1];
    const c = rs[i];
    if (c.t - p.t !== MIN || Math.abs(c.mid - p.mid) / p.mid < 0.0015) continue;
    const base = rs.filter((r) => r.t >= c.t - HOUR && r.t < c.t).map(tot10);
    if (base.length < 30) continue;
    events++;
    const target = 0.8 * median(base);
    let k = i;
    while (k < rs.length && rs[k].t - c.t <= HOUR && tot10(rs[k]) < target) k++;
    if (k < rs.length && rs[k].t - c.t <= HOUR) recov.push((rs[k].t - c.t) / MIN);
    else unrecovered++;
    i = k; // następne zdarzenie dopiero po powrocie (jeden epizod liczony raz)
  }
  return {
    v: 1,
    coin,
    asOf: now,
    since: rs.length ? rs[0].t : null,
    days: new Set(rs.map((r) => Math.floor(r.t / DAY))).size,
    minutes: rs.length,
    byHour,
    now: last ? { t: last.t, d10: tot10(last), d20: tot20(last), ratio10: norm && norm > 0 ? tot10(last) / norm : null } : null,
    resilience: { events, medianMin: recov.length ? median(recov) : null, unrecovered },
  };
}

/** Stan rejestratora: migawki bieżących minut i wiersze minutowe z 30 dni. */
export class LiquidityRecorder {
  private readonly coin: string;
  private snaps: BookSnap[] = [];
  private rows: MinuteRow[] = [];
  /** Ostatnia zamknięta minuta (wiersze nie powtarzają się) */
  private lastRowT = Number.NEGATIVE_INFINITY;

  constructor(coin: string) {
    this.coin = coin;
  }

  onBook(t: number, levels: unknown): void {
    const s = bookSnap(t, levels);
    if (s && Math.floor(s.t / MIN) * MIN > this.lastRowT) this.snaps.push(s);
  }

  /** Zamyka pełne minuty → nowe wiersze (do dopisania w pliku stanu); migawki minuty w toku zostają. */
  flush(now: number): MinuteRow[] {
    const fresh = minuteRows(this.snaps, now).filter((r) => r.t > this.lastRowT);
    if (fresh.length) {
      this.lastRowT = fresh[fresh.length - 1].t;
      this.rows.push(...fresh);
    }
    this.snaps = this.snaps.filter((s) => Math.floor(s.t / MIN) * MIN > this.lastRowT);
    const cut = now - LIQ_KEEP_DAYS * DAY;
    if (this.rows.length && this.rows[0].t < cut) this.rows = this.rows.filter((r) => r.t >= cut);
    return fresh;
  }

  /** Wczytanie wierszy ze stanu (tylko okno 30 dni, rosnąco, bez duplikatów). */
  load(rows: MinuteRow[], now: number): void {
    const cut = now - LIQ_KEEP_DAYS * DAY;
    const seen = new Set<number>();
    this.rows = rows
      .filter((r) => r && Number.isFinite(r.t) && r.t >= cut && r.t < now && !seen.has(r.t) && (seen.add(r.t), true))
      .sort((a, b) => a.t - b.t);
    this.lastRowT = this.rows.length ? this.rows[this.rows.length - 1].t : Number.NEGATIVE_INFINITY;
  }

  /** Wiersze w oknie (do zapisu skompaktowanego pliku stanu). */
  allRows(): MinuteRow[] {
    return this.rows;
  }

  profile(now: number): LiquidityProfile {
    return liquidityProfile(this.rows, this.coin, now);
  }
}
