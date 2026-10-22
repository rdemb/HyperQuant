/**
 * Taśma likwidacji Hyperliquid z pozycji śledzonych przez skaner — czysta funkcja współdzielona przez serwer i stronę
 * (bez importów zewnętrznych; uruchamiana także natywnie przez Node 24).
 *
 * Hyperliquid nie ma publicznego strumienia likwidacji wszystkich kont. Skaner wykrywa kandydatów (pozycja z mapy zmalała,
 * a cena od poprzedniego odczytu dotknęła jej ceny likwidacji) i potwierdza je w fillach konta (`userFillsByTime`,
 * pole `liquidation`). Taśma obejmuje więc tylko zmierzoną część open interest — tak jak mapa.
 * Publikowane: czas, strona, rozmiar, cena, metoda i błąd mapy — bez adresów i identyfikatorów transakcji.
 */

export type LiqSide = 'long' | 'short';

export interface LiqEvent {
  /** Czas pierwszego fillu likwidacji, ms UTC */
  t: number;
  /** Strona likwidowanej pozycji */
  side: LiqSide;
  /** Zlikwidowany rozmiar, BTC */
  sz: number;
  /** Średnia cena fillów (VWAP), USD */
  px: number;
  usd: number;
  /** market = zlecenia w arkusz; backstop = przejęcie przez Liquidator Vault */
  method: 'market' | 'backstop';
  /** Cena mark w chwili likwidacji (z API) */
  markPx: number;
  /** Ostatnia cena likwidacji tej pozycji znana mapie przed zdarzeniem */
  mapLiqPx: number | null;
  /** Wiek tamtego odczytu w chwili likwidacji, min */
  mapAgeMin: number | null;
}

export interface LiqSums {
  longUsd: number;
  shortUsd: number;
  n: number;
}

export interface LiqTapeBucket extends LiqSums {
  /** Początek kubełka 5 min, ms UTC */
  t: number;
}

export interface LiqTapeChecks {
  /** Kandydaci (zmniejszona pozycja przy cenie likwidacji) w ostatnich 24 h */
  candidates: number;
  /** Potwierdzone fillami z polem `liquidation` */
  confirmed: number;
  /** Bez fillu likwidacyjnego (zamknięcie przez właściciela) */
  rejected: number;
  /** Nieudane zapytanie / brak budżetu */
  failed: number;
}

export interface LiqTape {
  v: 1;
  coin: string;
  asOf: number;
  /** Od kiedy skaner obserwuje bez przerwy (po restarcie historia jest krótsza) */
  since: number;
  /** Najnowsze najpierw, maks. 200 */
  events: LiqEvent[];
  /** Niepuste kubełki 5 min z ostatnich 24 h, rosnąco */
  buckets: LiqTapeBucket[];
  totals: { h1: LiqSums; h24: LiqSums };
  /** Błąd mapy: o ile bp likwidacja nastąpiła głębiej (+) albo wcześniej (−) niż cena likwidacji z mapy */
  calib: { n: number; medAbsErrBp: number | null; p90AbsErrBp: number | null; medSignedErrBp: number | null; medAgeMin: number | null };
  checks: LiqTapeChecks;
  method: 'hl-fills-liquidation-v1';
}

const MIN = 60_000;
const BUCKET = 5 * MIN;
const DAY = 24 * 60 * MIN;
const MAX_EVENTS = 200;

/**
 * Błąd ceny likwidacji z mapy w bp, dodatni = likwidacja „głębiej” niż mapa (long niżej, short wyżej).
 * Ujemny = wcześniej (np. strata na innym rynku konta cross przybliżyła cenę likwidacji po ostatnim odczycie).
 */
export function calibErrorBp(e: LiqEvent): number | null {
  if (e.mapLiqPx === null || !(e.mapLiqPx > 0) || !(e.markPx > 0)) return null;
  const d = (e.mapLiqPx - e.markPx) / e.mapLiqPx;
  return (e.side === 'long' ? d : -d) * 1e4;
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const emptySums = (): LiqSums => ({ longUsd: 0, shortUsd: 0, n: 0 });
function add(s: LiqSums, e: LiqEvent): void {
  if (e.side === 'long') s.longUsd += e.usd;
  else s.shortUsd += e.usd;
  s.n++;
}

const sig2 = (x: number) => (x > 0 ? Number(x.toPrecision(2)) : x);

/**
 * Tylko publiczne pola zdarzenia — wejście skanera może nieść adres i identyfikatory transakcji.
 * Zgrubienie (czas do minuty, rozmiar do 2 cyfr znaczących, ceny do dolara, wartość do 100 USD) utrudnia dopasowanie
 * zdarzenia do pojedynczej transakcji z publicznej taśmy, która zawiera adresy stron. Sumy i kubełki liczone są z wartości dokładnych.
 */
function publicEvent(e: LiqEvent): LiqEvent {
  return {
    t: Math.floor(e.t / MIN) * MIN,
    side: e.side,
    sz: sig2(e.sz),
    px: Math.round(e.px),
    usd: Math.round(e.usd / 100) * 100,
    method: e.method,
    markPx: Math.round(e.markPx),
    mapLiqPx: e.mapLiqPx === null ? null : Math.round(e.mapLiqPx),
    mapAgeMin: e.mapAgeMin === null ? null : Math.round(e.mapAgeMin * 10) / 10,
  };
}

export function buildLiqTape(events: LiqEvent[], o: { coin: string; asOf: number; since: number; checks: LiqTapeChecks }): LiqTape {
  const day = events.filter((e) => e.t > o.asOf - DAY && e.t <= o.asOf).sort((a, b) => b.t - a.t);
  const h1 = emptySums();
  const h24 = emptySums();
  const byBucket = new Map<number, LiqTapeBucket>();
  for (const e of day) {
    add(h24, e);
    if (e.t > o.asOf - 60 * MIN) add(h1, e);
    const t = Math.floor(e.t / BUCKET) * BUCKET;
    const b = byBucket.get(t) ?? { t, ...emptySums() };
    add(b, e);
    byBucket.set(t, b);
  }
  const errs = day.map(calibErrorBp).filter((x): x is number => x !== null);
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  const signed = [...errs].sort((a, b) => a - b);
  const ages = day
    .filter((e) => calibErrorBp(e) !== null && e.mapAgeMin !== null)
    .map((e) => e.mapAgeMin as number)
    .sort((a, b) => a - b);
  return {
    v: 1,
    coin: o.coin,
    asOf: o.asOf,
    since: o.since,
    events: day.slice(0, MAX_EVENTS).map(publicEvent),
    buckets: [...byBucket.values()].sort((a, b) => a.t - b.t),
    totals: { h1, h24 },
    calib: { n: errs.length, medAbsErrBp: quantile(abs, 0.5), p90AbsErrBp: quantile(abs, 0.9), medSignedErrBp: quantile(signed, 0.5), medAgeMin: quantile(ages, 0.5) },
    checks: { ...o.checks },
    method: 'hl-fills-liquidation-v1',
  };
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const finOrNull = (v: unknown) => v === null || fin(v);
const isSums = (s: unknown): s is LiqSums => !!s && typeof s === 'object' && fin((s as LiqSums).longUsd) && fin((s as LiqSums).shortUsd) && fin((s as LiqSums).n);

/** Walidacja zdarzenia (strona: dane z sieci; skaner: stan odczytany z dysku). */
export function isLiqEvent(e: unknown): e is LiqEvent {
  if (!e || typeof e !== 'object') return false;
  const x = e as LiqEvent;
  return (
    fin(x.t) &&
    (x.side === 'long' || x.side === 'short') &&
    fin(x.sz) &&
    fin(x.px) &&
    fin(x.usd) &&
    (x.method === 'market' || x.method === 'backstop') &&
    fin(x.markPx) &&
    finOrNull(x.mapLiqPx) &&
    finOrNull(x.mapAgeMin)
  );
}

export function isLiqTape(x: unknown): x is LiqTape {
  if (!x || typeof x !== 'object') return false;
  const m = x as Partial<LiqTape>;
  return (
    m.v === 1 &&
    typeof m.coin === 'string' &&
    fin(m.asOf) &&
    fin(m.since) &&
    Array.isArray(m.events) &&
    m.events.every(isLiqEvent) &&
    Array.isArray(m.buckets) &&
    m.buckets.every((b) => isSums(b) && fin((b as LiqTapeBucket).t)) &&
    !!m.totals &&
    isSums(m.totals.h1) &&
    isSums(m.totals.h24) &&
    !!m.calib &&
    fin(m.calib.n) &&
    finOrNull(m.calib.medAbsErrBp) &&
    finOrNull(m.calib.p90AbsErrBp) &&
    finOrNull(m.calib.medSignedErrBp) &&
    finOrNull(m.calib.medAgeMin) &&
    !!m.checks &&
    fin(m.checks.candidates) &&
    fin(m.checks.confirmed) &&
    fin(m.checks.rejected) &&
    fin(m.checks.failed)
  );
}

/** Świeżość publikacji taśmy: ready ≤ 10 min, stale ≤ 60 min (liczby ukryte), expired > 60 min. */
export function liqTapeFreshness(tape: LiqTape, now: number): 'ready' | 'stale' | 'expired' {
  if (now - tape.asOf > 60 * MIN) return 'expired';
  if (now - tape.asOf > 10 * MIN) return 'stale';
  return 'ready';
}
