/**
 * Weryfikowalny dziennik prognoz desku — kontrakt danych `ledger/BTC/summary.json` (gałąź `ledger` repo danych) i odczyty
 * dla UI. Bez importów (moduł ładowany także natywnie w skanerze).
 *
 * Prognozy są pre-rejestrowane co 15 min w plikach dziennych JSONL z łańcuchem hashy (SHA-256), dni zakotwiczane
 * w Bitcoinie przez OpenTimestamps; rozstrzygnięcia ze świec 1m Hyperliquid. Każdy może zweryfikować łańcuch
 * i przeliczyć wyniki (scripts/verify-ledger.mjs) bez zaufania do HyperQuant.
 */

export type TouchLevel = 'pdh' | 'pdl' | 'deq';

export interface Coverage {
  /** Odsetek realizacji w przedziale (wszystkie prognozy — opis) */
  rate: number;
  n: number;
  /** Liczność podpróby rozłącznej (prognozy nie nakładają się horyzontami) — do testu */
  nEff: number;
  /** p-wartość testu Kupca na podpróbie rozłącznej; null = brak danych */
  kupiecP: number | null;
}

export interface RetScores {
  n: number;
  /** Średni CRPS modelu i benchmarku (log-zwrot) */
  crps: number | null;
  crpsBench: number | null;
  /** Umiejętność względem benchmarku: 1 − CRPS/CRPS_bench (> 0 = lepszy) */
  crpss: number | null;
  /** Histogram PIT w 10 koszykach (płaski = kalibracja) */
  pitHist: number[];
  cov90: Coverage | null;
  cov60: Coverage | null;
  /** Pokrycie przedziałów ACI (nominał 90%) */
  covAci: Coverage | null;
}

export interface ReliabilityBin {
  lo: number;
  hi: number;
  n: number;
  meanP: number | null;
  freq: number | null;
}

export interface TouchScores {
  /** Liczba rozstrzygniętych prognoz (każda: do 3 poziomów) */
  n: number;
  /** Liczba ocenionych par (poziom, wynik) — poziomy już przekroczone przy wydaniu pominięte */
  pairs: number;
  brier: number | null;
  /** Brier klimatologii poziomu (częstość bazowa osobno dla PDH, PDL, D-EQ z tego samego okna) */
  brierBase: number | null;
  /** Brier Skill Score względem klimatologii poziomów */
  bss: number | null;
  reliability: ReliabilityBin[];
  /** Mapa kalibracji izotonicznej (PAV): punkty [p surowe, częstość] — funkcja schodkowa niemalejąca */
  calibration: [number, number][];
}

export interface DeskLedgerSummary {
  v: 1;
  coin: string;
  asOf: number;
  model: string;
  /** Głowa łańcucha hashy i liczba linii */
  head: { hash: string; lines: number };
  /** Prognozy czekające na rozstrzygnięcie */
  pending: number;
  /** Prognozy jawnie unieważnione z braku danych (30 dni) */
  voided: number;
  latest: {
    ret: {
      t: number;
      h: number;
      px0: number;
      taus: number[];
      q: number[];
      bq: number[];
      /** Przedział ACI tej prognozy (α z chwili wydania; null = nieskończony) i bieżące α */
      aci: { alpha: number; alphaNow: number; lo: number | null; hi: number | null };
    }[];
    touch: {
      t: number;
      px0: number;
      lv: Record<TouchLevel, number>;
      /** null = cena już za poziomem przy wydaniu (zdarzenie trywialne) */
      p: Record<TouchLevel, number | null>;
      /** Venn–Abers: przedział [p0, p1] i scalone p dla najnowszych prawdopodobieństw */
      va: Record<TouchLevel, { p0: number; p1: number; p: number } | null>;
    } | null;
  };
  scores: { ret: Record<string, RetScores>; touch: TouchScores };
  /** Pliki dzienne zakotwiczone przez OpenTimestamps (ostatnie) */
  ots: { day: string; file: string; calendars: number; stampedAt: number }[];
  /** Pokwitowania OpenTimestamps głowy łańcucha po wydaniu slotu (ostatnie 24 h) */
  slotStamps: number;
  /** Uczestnictwo: sloty z prognozą vs jawnie pominięte (ostatnie luki z powodem) */
  participation: { issued: number; skipped: number; gaps: { slot: number; reason: string }[] };
  method: 'hq-ledger-v1';
}

/** Wartość mapy izotonicznej dla p (funkcja schodkowa: ostatni punkt z p_i ≤ p; przed pierwszym — pierwszy); pusta → null. */
export function calibrate(map: [number, number][], p: number): number | null {
  if (map.length === 0 || !Number.isFinite(p)) return null;
  let v = map[0][1];
  for (const [x, y] of map) {
    if (x > p) break;
    v = y;
  }
  return v;
}

/** Prognozy co 15 min: ready ≤ 35 min od ostatniej publikacji, stale ≤ 3 h, potem expired. */
export function ledgerFreshness(s: DeskLedgerSummary, now: number): 'ready' | 'stale' | 'expired' {
  const min = 60_000;
  if (now - s.asOf > 180 * min) return 'expired';
  if (now - s.asOf > 35 * min) return 'stale';
  return 'ready';
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const finOrNull = (v: unknown) => v === null || fin(v);
const nums = (v: unknown) => Array.isArray(v) && v.every(fin);
const isCov = (c: unknown) => c === null || (!!c && fin((c as Coverage).rate) && fin((c as Coverage).n) && fin((c as Coverage).nEff) && finOrNull((c as Coverage).kupiecP));
const isRet = (r: unknown) => {
  const o = r as Partial<RetScores> | null;
  return !!o && fin(o.n) && finOrNull(o.crps) && finOrNull(o.crpsBench) && finOrNull(o.crpss) && nums(o.pitHist) && isCov(o.cov90) && isCov(o.cov60) && isCov(o.covAci);
};

export function isDeskLedgerSummary(x: unknown): x is DeskLedgerSummary {
  if (!x || typeof x !== 'object') return false;
  const s = x as Partial<DeskLedgerSummary>;
  const t = s.scores?.touch;
  return (
    s.v === 1 &&
    typeof s.coin === 'string' &&
    fin(s.asOf) &&
    typeof s.model === 'string' &&
    !!s.head &&
    typeof s.head.hash === 'string' &&
    fin(s.head.lines) &&
    fin(s.pending) &&
    fin(s.voided) &&
    !!s.latest &&
    Array.isArray(s.latest.ret) &&
    s.latest.ret.every((r) => fin(r.t) && fin(r.h) && fin(r.px0) && nums(r.taus) && nums(r.q) && nums(r.bq) && !!r.aci && fin(r.aci.alpha)) &&
    (s.latest.touch === null || (!!s.latest.touch && fin(s.latest.touch.t) && !!s.latest.touch.p && !!s.latest.touch.va)) &&
    !!s.scores &&
    !!s.scores.ret &&
    Object.values(s.scores.ret).every(isRet) &&
    !!t &&
    fin(t.n) &&
    fin(t.pairs) &&
    finOrNull(t.brier) &&
    finOrNull(t.brierBase) &&
    finOrNull(t.bss) &&
    Array.isArray(t.reliability) &&
    Array.isArray(t.calibration) &&
    Array.isArray(s.ots) &&
    fin(s.slotStamps) &&
    !!s.participation &&
    fin(s.participation.issued) &&
    fin(s.participation.skipped) &&
    Array.isArray(s.participation.gaps)
  );
}
