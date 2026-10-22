/** Profil płynności arkusza BTC publikowany przez skaner (`liquidity/BTC.json` w repo danych). */
export interface LiquidityProfile {
  v: 1;
  coin: string;
  asOf: number;
  /** Pierwsza zapisana minuta w oknie (historia rośnie od uruchomienia rejestratora) */
  since: number | null;
  /** Ostatnia zapisana minuta (rejestrator, który stoi, widać po jej wieku) */
  last: number | null;
  /** Dni z danymi w oknie (maks. 30) i liczba minut */
  days: number;
  minutes: number;
  /** Mediana głębokości obu stron (USD) w ±10 / ±20 bp wg godziny UTC; null = brak danych; `days` — różne dni w godzinie */
  byHour: {
    h: number;
    d10: number | null;
    d20: number | null;
    n: number;
    days: number;
    /** Mediany stron osobno (USD w ±10 / ±20 bp) — brak w starszych profilach */
    b10?: number | null;
    a10?: number | null;
    b20?: number | null;
    a20?: number | null;
    /** 25. percentyl sumy obu stron w ±10 bp (warunki cienkie) — brak w starszych profilach */
    thin10?: number | null;
  }[];
  /**
   * Ostatnia minuta, jeśli świeża (≤ 3 min); ratio10 = bieżąca / norma tej godziny z ≥ 3 innych dni (null = za mało
   * historii); b10/a10/b20/a20 — strony osobno (brak w starszych profilach)
   */
  now: {
    t: number;
    d10: number;
    d20: number | null;
    ratio10: number | null;
    b10?: number | null;
    a10?: number | null;
    b20?: number | null;
    a20?: number | null;
  } | null;
  /**
   * Odporność: po minucie z ruchem środka ≥ 15 bp — minuty do powrotu głębokości ±10 bp do 80% mediany z poprzedniej
   * godziny. `events` = zdarzenia z wycofaniem płynności (z powrotem albo bez w 1 h); `censored` — przerwane brakiem danych;
   * `noDrop` — ruchy bez wycofania płynności.
   */
  resilience: { events: number; medianMin: number | null; unrecovered: number; censored: number; noDrop: number };
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const finOrNull = (v: unknown) => v === null || fin(v);

/** Walidacja publikowanego profilu (strona nie ufa plikowi z sieci). */
export function isLiquidityProfile(x: unknown): x is LiquidityProfile {
  const p = x as Partial<LiquidityProfile> | null;
  return (
    !!p &&
    p.v === 1 &&
    typeof p.coin === 'string' &&
    fin(p.asOf) &&
    finOrNull(p.since) &&
    finOrNull(p.last) &&
    fin(p.days) &&
    fin(p.minutes) &&
    Array.isArray(p.byHour) &&
    p.byHour.length === 24 &&
    p.byHour.every(
      (b, i) =>
        !!b &&
        b.h === i &&
        finOrNull(b.d10) &&
        finOrNull(b.d20) &&
        fin(b.n) &&
        fin(b.days) &&
        [b.b10, b.a10, b.b20, b.a20, b.thin10].every((v) => v === undefined || finOrNull(v))
    ) &&
    (p.now === null ||
      (!!p.now &&
        fin(p.now.t) &&
        fin(p.now.d10) &&
        finOrNull(p.now.d20) &&
        finOrNull(p.now.ratio10) &&
        [p.now.b10, p.now.a10, p.now.b20, p.now.a20].every((v) => v === undefined || finOrNull(v)))) &&
    !!p.resilience &&
    fin(p.resilience.events) &&
    finOrNull(p.resilience.medianMin) &&
    fin(p.resilience.unrecovered) &&
    fin(p.resilience.censored) &&
    fin(p.resilience.noDrop)
  );
}
