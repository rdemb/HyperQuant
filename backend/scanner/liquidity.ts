/**
 * Rejestrator płynności arkusza: z migawek `l2Book` (zagregowanych tak, by 20 poziomów pokrywało ±20 bp — agregacja
 * dobierana do ceny) głębokość po obu stronach w ±10 i ±20 bp od środka; minutowe mediany przechowywane na serwerze
 * (30 dni), publikowane wyłącznie agregaty: profil płynności wg godziny UTC, bieżąca płynność względem normy tej godziny
 * i odporność (ile minut głębokość wraca do normy po gwałtownym ruchu ceny). Publiczne API nie daje historii arkusza.
 */
import type { LiquidityProfile } from '../../src/utils/liquidity.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Okno historii (dni) */
export const LIQ_KEEP_DAYS = 30;
/** Poziomy arkusza po stronie w odpowiedzi Hyperliquid */
const LEVELS = 20;
/** Pasmo, które agregacja musi pokrywać (bp) */
const COVER_BP = 20;
/** „Teraz” tylko z minuty nie starszej niż 3 min — rejestrator, który stoi, nie udaje bieżącej wartości */
const NOW_MAX_AGE = 3 * MIN;

/** Agregacja `l2Book` Hyperliquid: cyfry znaczące (mantysa 2 lub 5 tylko przy 5 cyfrach) */
export interface BookAgg {
  nSigFigs: 3 | 4 | 5;
  mantissa?: 2 | 5;
}

/** Rozmiar koszyka (USD) dla agregacji przy danej cenie. */
export function bucketFor(a: BookAgg, price: number): number {
  const digits = Math.floor(Math.log10(price)) + 1;
  return (a.mantissa ?? 1) * 10 ** (digits - a.nSigFigs);
}

const OPTIONS: BookAgg[] = [{ nSigFigs: 5 }, { nSigFigs: 5, mantissa: 2 }, { nSigFigs: 5, mantissa: 5 }, { nSigFigs: 4 }, { nSigFigs: 3 }];

/**
 * Najdrobniejsza agregacja, przy której 20 poziomów pokrywa ±20 bp. Histereza: obecna zostaje, póki pokrywa pasmo, a jej
 * koszyk jest najwyżej 2× większy od najlepszego (bez przełączania subskrypcji przy każdym drobnym ruchu ceny).
 */
export function chooseAgg(price: number, current?: BookAgg): BookAgg & { bucket: number } {
  const need = (price * COVER_BP) / 1e4 / LEVELS;
  const fits = (a: BookAgg) => bucketFor(a, price) >= need - 1e-9;
  const best = OPTIONS.filter(fits).sort((a, b) => bucketFor(a, price) - bucketFor(b, price))[0] ?? { nSigFigs: 3 };
  const pick = current && fits(current) && bucketFor(current, price) <= 2 * bucketFor(best, price) + 1e-9 ? current : best;
  return { ...(pick.mantissa ? { nSigFigs: pick.nSigFigs, mantissa: pick.mantissa } : { nSigFigs: pick.nSigFigs }), bucket: bucketFor(pick, price) };
}

export interface BookSnap {
  t: number;
  mid: number;
  /** Rozmiar koszyka (USD) wyznaczony z danych */
  bucket: number;
  /** USD po stronie bid / ask w ±10 bp i ±20 bp od środka; ±20 bp null, gdy arkusz go nie pokrywa */
  b10: number;
  a10: number;
  b20: number | null;
  a20: number | null;
}

/** Wiersz minutowy: mediany migawek z minuty (USD w pełnych dolarach), `bk` — koszyk */
export interface MinuteRow {
  t: number;
  n: number;
  mid: number;
  bk: number;
  b10: number;
  a10: number;
  b20: number | null;
  a20: number | null;
}

type Lvl = { px?: unknown; sz?: unknown };

/**
 * Migawka z poziomów `l2Book` [bids, asks] zagregowanych w koszyki (bid zaokrąglony w dół: [px, px + k), ask w górę:
 * (px − k, px]). Koszyk k = najmniejsza różnica cen sąsiednich poziomów (z danych — niezależnie od subskrypcji). Koszyk
 * przecinający granicę pasma liczony proporcjonalnie. Pokrycie: ±10 bp wymagane (inaczej null), ±20 bp — null, gdy
 * najgłębszy poziom nie sięga granicy (bez cichego obcięcia).
 */
export function bookSnap(t: number, levels: unknown): BookSnap | null {
  if (!Array.isArray(levels) || levels.length < 2) return null;
  const side = (rows: unknown) =>
    (Array.isArray(rows) ? (rows as Lvl[]) : [])
      .map((r) => ({ px: Number(r?.px), sz: Number(r?.sz) }))
      .filter((r) => Number.isFinite(r.px) && Number.isFinite(r.sz) && r.px > 0 && r.sz > 0);
  const bids = side(levels[0]);
  const asks = side(levels[1]);
  if (!bids.length || !asks.length || bids[0].px >= asks[0].px) return null;
  let bucket = Infinity;
  for (const xs of [bids, asks]) for (let i = 1; i < xs.length; i++) bucket = Math.min(bucket, Math.abs(xs[i].px - xs[i - 1].px));
  if (!Number.isFinite(bucket) || !(bucket > 0)) bucket = asks[0].px - bids[0].px;
  const mid = (bids[0].px + asks[0].px) / 2;
  const lowest = Math.min(...bids.map((b) => b.px));
  const highest = Math.max(...asks.map((a) => a.px));
  const cover = (Math.min(mid - lowest, highest - mid) / mid) * 1e4;
  if (cover < 10) return null;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const depthBid = (bp: number) => {
    const edge = mid * (1 - bp / 1e4);
    return bids.reduce((a, r) => a + r.px * r.sz * clamp((r.px + bucket - edge) / bucket), 0);
  };
  const depthAsk = (bp: number) => {
    const edge = mid * (1 + bp / 1e4);
    return asks.reduce((a, r) => a + r.px * r.sz * clamp((edge - (r.px - bucket)) / bucket), 0);
  };
  const ok20 = cover >= COVER_BP;
  return { t, mid, bucket, b10: depthBid(10), a10: depthAsk(10), b20: ok20 ? depthBid(20) : null, a20: ok20 ? depthAsk(20) : null };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const medianOrNull = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? median(v) : null;
};

const roundOrNull = (x: number | null) => (x === null ? null : Math.round(x));

/** Kwantyl z interpolacją liniową (typ 7). */
const quantile = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.ceil(pos)] - s[lo]) * (pos - lo);
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
      bk: median(xs.map((x) => x.bucket)),
      b10: Math.round(median(xs.map((x) => x.b10))),
      a10: Math.round(median(xs.map((x) => x.a10))),
      b20: roundOrNull(medianOrNull(xs.map((x) => x.b20))),
      a20: roundOrNull(medianOrNull(xs.map((x) => x.a20))),
    }));
}

const tot10 = (r: MinuteRow) => r.b10 + r.a10;
const tot20 = (r: MinuteRow) => (r.b20 === null || r.a20 === null ? null : r.b20 + r.a20);
const dayOf = (t: number) => Math.floor(t / DAY);

/** Agregaty do publikacji z wierszy minutowych (okno `days` dni). */
export function liquidityProfile(rows: MinuteRow[], coin: string, now: number, days = LIQ_KEEP_DAYS): LiquidityProfile {
  const from = now - days * DAY;
  const rs = rows.filter((r) => r.t >= from && r.t < now).sort((a, b) => a.t - b.t);
  const hourOf = (r: MinuteRow) => new Date(r.t).getUTCHours();
  const byHour = Array.from({ length: 24 }, (_, h) => {
    const xs = rs.filter((r) => hourOf(r) === h);
    const has = xs.length > 0;
    return {
      h,
      d10: has ? median(xs.map(tot10)) : null,
      d20: medianOrNull(xs.map(tot20)),
      n: xs.length,
      days: new Set(xs.map((r) => dayOf(r.t))).size,
      // Strony osobno (koszt kupna — aski, sprzedaży — bidy) i warunki cienkie: 25. percentyl sumy ±10 bp
      b10: has ? median(xs.map((r) => r.b10)) : null,
      a10: has ? median(xs.map((r) => r.a10)) : null,
      b20: medianOrNull(xs.map((r) => r.b20)),
      a20: medianOrNull(xs.map((r) => r.a20)),
      thin10: has ? quantile(xs.map(tot10), 0.25) : null,
    };
  });

  // „Teraz”: ostatnia minuta, jeśli świeża; norma tej godziny z innych dni (≥ 3 dni, ≥ 90 min) — bez dzisiejszej sesji
  const last = rs[rs.length - 1];
  let nowRow: LiquidityProfile['now'] = null;
  if (last && now - (last.t + MIN) <= NOW_MAX_AGE) {
    const others = rs.filter((r) => hourOf(r) === hourOf(last) && dayOf(r.t) !== dayOf(last.t));
    const norm = others.length >= 90 && new Set(others.map((r) => dayOf(r.t))).size >= 3 ? median(others.map(tot10)) : null;
    nowRow = { t: last.t, d10: tot10(last), d20: tot20(last), ratio10: norm && norm > 0 ? tot10(last) / norm : null };
  }

  // Odporność: zdarzenie = minuta z ruchem środka ≥ 15 bp względem poprzedniej (ciągłej) minuty. Okno odniesienia —
  // godzina przed zdarzeniem (dwa wskaźniki, O(n)). Powrót liczony tylko po ciągłych minutach: luka albo koniec danych
  // przed powrotem = zdarzenie cenzurowane (pomijane); ruch bez wycofania płynności liczony osobno.
  const recov: number[] = [];
  let unrecovered = 0;
  let censored = 0;
  let noDrop = 0;
  let lo = 0;
  for (let i = 1; i < rs.length; i++) {
    const p = rs[i - 1];
    const c = rs[i];
    if (c.t - p.t !== MIN || Math.abs(c.mid - p.mid) / p.mid < 0.0015) continue;
    while (rs[lo].t < c.t - HOUR) lo++;
    const base = rs.slice(lo, i).map(tot10);
    if (base.length < 30) continue;
    const target = 0.8 * median(base);
    if (tot10(c) >= target) {
      noDrop++;
      continue;
    }
    let k = i + 1;
    for (;;) {
      if (k >= rs.length || rs[k].t - rs[k - 1].t !== MIN) {
        censored++;
        break;
      }
      if (rs[k].t - c.t > HOUR) {
        unrecovered++;
        break;
      }
      if (tot10(rs[k]) >= target) {
        recov.push((rs[k].t - c.t) / MIN);
        break;
      }
      k++;
    }
    i = k; // następne zdarzenie dopiero po zakończeniu epizodu
  }

  return {
    v: 1,
    coin,
    asOf: now,
    since: rs.length ? rs[0].t : null,
    last: last ? last.t : null,
    days: new Set(rs.map((r) => dayOf(r.t))).size,
    minutes: rs.length,
    byHour,
    now: nowRow,
    resilience: { events: recov.length + unrecovered, medianMin: recov.length ? median(recov) : null, unrecovered, censored, noDrop },
  };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const finiteOrNull = (v: unknown) => v === null || finite(v);
/** Wiersz ze stanu: wszystkie pola liczbowe poprawne (uszkodzony wiersz nie psuje profilu) */
const validRow = (r: unknown): r is MinuteRow => {
  const x = r as Partial<MinuteRow> | null;
  return !!x && finite(x.t) && finite(x.n) && finite(x.mid) && finite(x.bk) && finite(x.b10) && finite(x.a10) && finiteOrNull(x.b20) && finiteOrNull(x.a20);
};

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

  /** Wczytanie wierszy ze stanu (tylko poprawne, w oknie 30 dni, rosnąco, bez duplikatów). */
  load(rows: unknown[], now: number): void {
    const cut = now - LIQ_KEEP_DAYS * DAY;
    const seen = new Set<number>();
    this.rows = rows
      .filter(validRow)
      .filter((r) => r.t >= cut && r.t < now && !seen.has(r.t) && (seen.add(r.t), true))
      .sort((a, b) => a.t - b.t);
    this.lastRowT = this.rows.length ? this.rows[this.rows.length - 1].t : Number.NEGATIVE_INFINITY;
  }

  /** Wiersze w oknie (do zapisu skompaktowanego pliku stanu). */
  allRows(): MinuteRow[] {
    return this.rows;
  }

  /** Środek ceny z ostatniej zapisanej minuty (do doboru agregacji po restarcie) */
  lastMid(): number | null {
    return this.rows.length ? this.rows[this.rows.length - 1].mid : null;
  }

  profile(now: number): LiquidityProfile {
    return liquidityProfile(this.rows, this.coin, now);
  }
}
