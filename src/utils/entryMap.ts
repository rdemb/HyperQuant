import { LIQ_MAP_RANGE, LIQ_MIN_N, type ScannedPosition, niceStep } from './liqMap.ts';

/**
 * Mapa uwięzionych pozycji (skaner HyperQuant, te same odczyty pozycji co mapa likwidacji): gdzie otwarte pozycje BTC
 * weszły na rynek. Rozkład cen wejścia co ~0,25% ceny, osobno longi i shorty, ważony wartością wejścia (|szi|·entryPx),
 * jaka część każdej strony jest „pod wodą” przy cenie mark i jak daleko jest do likwidacji (kwartyle ważone wartością).
 * Opis faktów pozycji, bez kierunku i bez twierdzenia o reakcji ceny; same agregaty, bez adresów; kubełek z mniej niż
 * `LIQ_MIN_N` pozycjami ma wartość zaokrągloną do 2 cyfr znaczących. Pokrycie jak w mapie likwidacji: Σ|szi| / (2·OI).
 */

export interface EntryBucket {
  /** Dolna krawędź kubełka ceny wejścia, USD */
  px: number;
  /** Wartość wejścia w kubełku: Σ |szi|·entryPx, USD */
  ntlUsd: number;
  n: number;
}

export interface SideStats {
  /** Wartość wejścia całej strony (także poza zakresem kubełków), USD */
  ntlUsd: number;
  /** Część „pod wodą” przy cenie mark (long: wejście nad ceną, short: wejście pod ceną): wartość i udział 0–1 */
  underwaterUsd: number;
  underwaterShare: number;
  /** Wartość wejść poza zakresem kubełków (±range od ceny), USD */
  outsideUsd: number;
  /** Odległość ceny mark od ceny likwidacji w %, kwartyle ważone wartością; null — brak pozycji z ceną likwidacji */
  liqDistPct: { p25: number; p50: number; p75: number } | null;
}

export interface EntryMap {
  v: 1;
  coin: string;
  asOf: number;
  markPx: number;
  stepUsd: number;
  rangePct: number;
  longs: EntryBucket[];
  shorts: EntryBucket[];
  long: SideStats;
  short: SideStats;
  coverage: { positions: number; addresses: number; scannedBtc: number; oiBtc: number; share: number };
  /** Wiek odczytów w minutach: mediana i mediana ważona wartością */
  ageMin: { p50: number; ntlP50: number };
  method: string;
}

/** Krok kubełków: ~0,25% ceny, zaokrąglony do „okrągłej” kwoty. */
export const ENTRY_STEP = 0.0025;

function weightedQuantiles(pairs: [number, number][], qs: number[]): number[] {
  const s = [...pairs].sort((a, b) => a[0] - b[0]);
  const total = s.reduce((t, [, w]) => t + w, 0);
  return qs.map((q) => {
    let cum = 0;
    for (const [v, w] of s) {
      cum += w;
      if (cum >= q * total) return v;
    }
    return s.length ? s[s.length - 1][0] : 0;
  });
}

const round2 = (v: number) => Number(v.toFixed(2));

function buckets(map: Map<number, EntryBucket>): EntryBucket[] {
  return [...map.values()].map((b) => (b.n < LIQ_MIN_N ? { ...b, ntlUsd: Number(b.ntlUsd.toPrecision(2)) } : b)).sort((a, b) => a.px - b.px);
}

export function buildEntryMap(positions: ScannedPosition[], o: { coin: string; markPx: number; oiBtc: number; asOf: number; addresses: number; rangePct?: number }): EntryMap {
  const range = o.rangePct ?? LIQ_MAP_RANGE;
  const step = niceStep(o.markPx * ENTRY_STEP);
  const side = () => ({ map: new Map<number, EntryBucket>(), ntl: 0, under: 0, outside: 0, dist: [] as [number, number][] });
  const L = side();
  const S = side();
  let scannedBtc = 0;
  const ages: [number, number][] = [];
  for (const p of positions) {
    if (!(p.szi !== 0 && p.entryPx > 0)) continue;
    const isLong = p.szi > 0;
    const s = isLong ? L : S;
    const ntl = Math.abs(p.szi) * p.entryPx;
    scannedBtc += Math.abs(p.szi);
    s.ntl += ntl;
    ages.push([(o.asOf - p.scannedAt) / 60_000, ntl]);
    if (isLong ? p.entryPx > o.markPx : p.entryPx < o.markPx) s.under += ntl;
    if (p.liqPx !== null && p.liqPx > 0) {
      // Odległość do likwidacji od strony pozycji; odczyt po złej stronie ceny (nieaktualny) pominięty
      const d = isLong ? (o.markPx - p.liqPx) / o.markPx : (p.liqPx - o.markPx) / o.markPx;
      if (d > 0) s.dist.push([d * 100, ntl]);
    }
    if (Math.abs(p.entryPx / o.markPx - 1) > range) {
      s.outside += ntl;
      continue;
    }
    const px = Math.floor(p.entryPx / step) * step;
    const b = s.map.get(px) ?? { px, ntlUsd: 0, n: 0 };
    b.ntlUsd += ntl;
    b.n++;
    s.map.set(px, b);
  }
  const stats = (s: ReturnType<typeof side>): SideStats => {
    const q = s.dist.length ? weightedQuantiles(s.dist, [0.25, 0.5, 0.75]).map(round2) : null;
    return {
      ntlUsd: s.ntl,
      underwaterUsd: s.under,
      underwaterShare: s.ntl > 0 ? s.under / s.ntl : 0,
      outsideUsd: s.outside,
      liqDistPct: q ? { p25: q[0], p50: q[1], p75: q[2] } : null,
    };
  };
  const plainAges = ages.map(([a]) => a);
  return {
    v: 1,
    coin: o.coin,
    asOf: o.asOf,
    markPx: o.markPx,
    stepUsd: step,
    rangePct: range,
    longs: buckets(L.map),
    shorts: buckets(S.map),
    long: stats(L),
    short: stats(S),
    coverage: { positions: positions.length, addresses: o.addresses, scannedBtc, oiBtc: o.oiBtc, share: o.oiBtc > 0 ? Math.min(1, scannedBtc / (2 * o.oiBtc)) : 0 },
    ageMin: { p50: plainAges.length ? round2(weightedQuantiles(plainAges.map((a) => [a, 1]), [0.5])[0]) : 0, ntlP50: ages.length ? round2(weightedQuantiles(ages, [0.5])[0]) : 0 },
    method: 'hl-entry-v1',
  };
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBuckets = (v: unknown): v is EntryBucket[] => Array.isArray(v) && v.every((b) => !!b && fin(b.px) && fin(b.ntlUsd) && fin(b.n));
const isSide = (v: unknown): v is SideStats => {
  const s = v as SideStats;
  return !!s && fin(s.ntlUsd) && fin(s.underwaterUsd) && fin(s.underwaterShare) && fin(s.outsideUsd) && (s.liqDistPct === null || (!!s.liqDistPct && fin(s.liqDistPct.p50)));
};

/** Walidacja mapy pobranej z sieci: zły kształt to brak danych, nigdy częściowo użyta mapa. */
export function isEntryMap(x: unknown): x is EntryMap {
  const m = x as EntryMap;
  return !!m && m.v === 1 && typeof m.coin === 'string' && fin(m.asOf) && fin(m.markPx) && fin(m.stepUsd) && isBuckets(m.longs) && isBuckets(m.shorts) && isSide(m.long) && isSide(m.short) && !!m.coverage && fin(m.coverage.share);
}
