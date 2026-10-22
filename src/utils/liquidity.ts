/** Profil płynności arkusza BTC publikowany przez skaner (`liquidity/BTC.json` w repo danych). */
export interface LiquidityProfile {
  v: 1;
  coin: string;
  asOf: number;
  /** Pierwsza zapisana minuta w oknie (historia rośnie od uruchomienia rejestratora) */
  since: number | null;
  /** Dni z danymi w oknie (maks. 30) i liczba minut */
  days: number;
  minutes: number;
  /** Mediana głębokości obu stron (USD) w ±10 / ±20 bp wg godziny UTC; null = brak danych */
  byHour: { h: number; d10: number | null; d20: number | null; n: number }[];
  /** Ostatnia pełna minuta względem normy jej godziny (ratio10 = bieżąca / mediana godziny) */
  now: { t: number; d10: number; d20: number; ratio10: number | null } | null;
  /** Odporność: po minucie z ruchem środka ≥ 15 bp — minuty do powrotu głębokości ±10 bp do 80% mediany z poprzedniej godziny */
  resilience: { events: number; medianMin: number | null; unrecovered: number };
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
    fin(p.days) &&
    fin(p.minutes) &&
    Array.isArray(p.byHour) &&
    p.byHour.length === 24 &&
    p.byHour.every((b) => fin(b?.h) && finOrNull(b.d10) && finOrNull(b.d20) && fin(b.n)) &&
    (p.now === null || (!!p.now && fin(p.now.t) && fin(p.now.d10) && fin(p.now.d20) && finOrNull(p.now.ratio10))) &&
    !!p.resilience &&
    fin(p.resilience.events) &&
    finOrNull(p.resilience.medianMin) &&
    fin(p.resilience.unrecovered)
  );
}
