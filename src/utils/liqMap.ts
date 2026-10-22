/**
 * Mapa likwidacji z pozycji on-chain Hyperliquid (`clearinghouseState` każdego portfela) — czysta funkcja współdzielona
 * przez skaner na serwerze i stronę. Bez importów zewnętrznych (uruchamiana także natywnie przez Node 24).
 * Publikowane są wyłącznie agregaty: kubełki ceny likwidacji, liczności i pokrycie open interest — nigdy adresy.
 */

export interface ScannedPosition {
  /** Rozmiar pozycji w BTC ze znakiem (+ long, − short) */
  szi: number;
  entryPx: number;
  /** Cena likwidacji z API; null = pozycja w pełni zabezpieczona (brak likwidacji) */
  liqPx: number | null;
  /** Czas odczytu pozycji, ms UTC */
  scannedAt: number;
}

export interface LiqBucket {
  /** Dolna krawędź kubełka ceny likwidacji, USD */
  px: number;
  /** Nominał likwidowany w kubełku: Σ |szi|·liqPx, USD */
  ntlUsd: number;
  /** Liczba pozycji */
  n: number;
}

export interface LiqMap {
  v: 1;
  coin: string;
  asOf: number;
  markPx: number;
  stepUsd: number;
  /** Likwidacje longów (sprzedaż przy spadku), rosnąco po cenie */
  longs: LiqBucket[];
  /** Likwidacje shortów (kupno przy wzroście), rosnąco po cenie */
  shorts: LiqBucket[];
  coverage: {
    positions: number;
    addresses: number;
    /** Σ |szi| zeskanowanych pozycji, BTC */
    scannedBtc: number;
    /** Σ szi longów i Σ |szi| shortów — samokontrola: przy pełnym pokryciu obie ≈ OI */
    longBtc: number;
    shortBtc: number;
    /** Pozycje z ceną likwidacji po złej stronie ceny mark (nieaktualny odczyt) — poza kubełkami */
    wrongSide: number;
    /** Open interest z API (jedna strona rynku), BTC */
    oiBtc: number;
    /** scannedBtc / (2·oiBtc), ≤ 1 */
    share: number;
  };
  /** Wiek odczytów pozycji w minutach; ntlP50 = mediana ważona nominałem (wiek tego, co waży na mapie) */
  ageMin: { p50: number; p90: number; ntlP50: number };
  /** Czas kontekstu rynku (mark, OI), ms UTC */
  ctxAt: number;
  method: string;
}

const STEPS = [10, 20, 25, 50, 100, 200, 250, 500, 1000];

/** „Okrągły” krok kubełków najbliższy (w skali log) zadanej wartości, np. 0.1% ceny. */
export function niceStep(x: number): number {
  let best = STEPS[0];
  for (const s of STEPS) if (Math.abs(Math.log(s / x)) < Math.abs(Math.log(best / x))) best = s;
  return best;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function toBuckets(map: Map<number, LiqBucket>): LiqBucket[] {
  return [...map.values()].sort((a, b) => a.px - b.px);
}

/**
 * Kubełki stałego kroku USD (~0.1% ceny), osobno longi i shorty, w zakresie ±rangePct od ceny mark.
 * Pokrycie: Σ|szi| / (2·OI) — OI z Hyperliquid liczy jedną stronę rynku, a skan widzi obie.
 */
export function buildLiqMap(
  positions: ScannedPosition[],
  o: { coin: string; markPx: number; oiBtc: number; asOf: number; addresses: number; rangePct?: number; ctxAt?: number }
): LiqMap {
  const rangePct = o.rangePct ?? 0.15;
  const step = niceStep(o.markPx * 0.001);
  const longs = new Map<number, LiqBucket>();
  const shorts = new Map<number, LiqBucket>();
  let scannedBtc = 0;
  let longBtc = 0;
  let shortBtc = 0;
  let wrongSide = 0;
  const ages: number[] = [];
  const weighted: [number, number][] = [];
  for (const p of positions) {
    scannedBtc += Math.abs(p.szi);
    if (p.szi > 0) longBtc += p.szi;
    else shortBtc -= p.szi;
    const age = (o.asOf - p.scannedAt) / 60_000;
    ages.push(age);
    weighted.push([age, Math.abs(p.szi) * p.entryPx]);
    if (p.liqPx === null || !(p.liqPx > 0) || p.szi === 0) continue;
    // Long z likwidacją nad ceną albo short pod ceną już by zniknął — odczyt jest nieaktualny, nie wchodzi do mapy
    if (p.szi > 0 ? p.liqPx >= o.markPx : p.liqPx <= o.markPx) {
      wrongSide++;
      continue;
    }
    if (Math.abs(p.liqPx / o.markPx - 1) > rangePct) continue;
    const px = Math.floor(p.liqPx / step) * step;
    const side = p.szi > 0 ? longs : shorts;
    const b = side.get(px) ?? { px, ntlUsd: 0, n: 0 };
    b.ntlUsd += Math.abs(p.szi) * p.liqPx;
    b.n++;
    side.set(px, b);
  }
  ages.sort((a, b) => a - b);
  weighted.sort((a, b) => a[0] - b[0]);
  const totalW = weighted.reduce((s, [, w]) => s + w, 0);
  let ntlP50 = 0;
  for (let i = 0, cum = 0; i < weighted.length; i++) {
    cum += weighted[i][1];
    if (cum >= totalW / 2) {
      ntlP50 = weighted[i][0];
      break;
    }
  }
  const share = o.oiBtc > 0 ? Math.min(1, scannedBtc / (2 * o.oiBtc)) : 0;
  return {
    v: 1,
    coin: o.coin,
    asOf: o.asOf,
    markPx: o.markPx,
    stepUsd: step,
    longs: toBuckets(longs),
    shorts: toBuckets(shorts),
    coverage: { positions: positions.length, addresses: o.addresses, scannedBtc, longBtc, shortBtc, wrongSide, oiBtc: o.oiBtc, share },
    ageMin: { p50: quantile(ages, 0.5), p90: quantile(ages, 0.9), ntlP50 },
    ctxAt: o.ctxAt ?? o.asOf,
    method: 'hl-clearinghouse-v1',
  };
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBuckets = (v: unknown): v is LiqBucket[] =>
  Array.isArray(v) && v.every((b) => b && fin((b as LiqBucket).px) && fin((b as LiqBucket).ntlUsd) && fin((b as LiqBucket).n));

/** Walidacja mapy pobranej z sieci — zły kształt = brak danych, nigdy częściowo użyta mapa. */
export function isLiqMap(x: unknown): x is LiqMap {
  if (!x || typeof x !== 'object') return false;
  const m = x as Partial<LiqMap>;
  return (
    m.v === 1 &&
    typeof m.coin === 'string' &&
    fin(m.asOf) &&
    fin(m.ctxAt) &&
    fin(m.markPx) &&
    fin(m.stepUsd) &&
    isBuckets(m.longs) &&
    isBuckets(m.shorts) &&
    !!m.coverage &&
    fin(m.coverage.share) &&
    fin(m.coverage.scannedBtc) &&
    fin(m.coverage.oiBtc) &&
    fin(m.coverage.positions) &&
    fin(m.coverage.addresses) &&
    !!m.ageMin &&
    fin(m.ageMin.p50) &&
    fin(m.ageMin.p90) &&
    fin(m.ageMin.ntlP50)
  );
}
