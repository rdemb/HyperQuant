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

/** Model vs rynek (HIP-4, 15 min): Brier i log score obu na tych samych pytaniach, różnica (model − rynek) z bootstrapem 90% */
export interface MktScores {
  /** Ocenione pary (płynne notowanie, rozstrzygnięcie z dala od progu) */
  n: number;
  /** Rozstrzygnięcia blisko progu (≤ 0,02%) — pominięte */
  near: number;
  /** Notowania niepłynne — pominięte */
  illiquid: number;
  brierModel: number | null;
  brierMarket: number | null;
  logModel: number | null;
  logMarket: number | null;
  diff: { d: number; lo: number; hi: number } | null;
  /** Ensemble model + rynek (pooling logarytmiczny) — pytania z zapisanym p_e; brak w starszych podsumowaniach */
  nEns?: number;
  brierEns?: number | null;
  logEns?: number | null;
  /** Różnica Brier ensemble − rynek z bootstrapem 90% */
  diffEns?: { d: number; lo: number; hi: number } | null;
  /** Model i rynek na tym samym podzbiorze pytań co ensemble (porównanie jak z jak) */
  brierModelE?: number | null;
  brierMarketE?: number | null;
  /** Rynek skalibrowany (a + b_k·logit środka) — punkt odniesienia */
  brierRec?: number | null;
  /** Ensemble − rynek skalibrowany: wartość dodana modelu ponad samą rekalibrację ceny rynku */
  diffAdd?: { d: number; lo: number; hi: number } | null;
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
  participation: { issued: number; skipped: number; gaps: { slot: number; until?: number; reason: string }[] };
  /** Model vs rynek predykcyjny (HIP-4, 15 min) — opcjonalne (starsze podsumowania bez tej części) */
  market?: {
    /** Ocena ścisła: notowania płynne (spread ≤ 5 pp i głębokość ≥ 50 USDC po obu stronach) */
    scores: MktScores;
    /** Ocena „wąski spread”: notowania ze spreadem ≤ 5 pp, także płytkie (brak w starszych podsumowaniach) */
    tight?: MktScores;
    latest: { t: number; expiry: number; K: number; p: number; bid: number | null; ask: number | null; liquid: boolean; pe?: number | null } | null;
    /** Bieżące wagi ensemble (logit p_e = a + bm·logit p_model + bk·logit p_rynek), n — liczba par; brak w starszych */
    ensemble?: { a: number; bm: number; bk: number; n: number; at: number; rec?: { a: number; bk: number } };
  };
  /**
   * A/B wersji modelu (1 h): wersja A (HAR + FHS) vs B (σ z mieszaniny z reżimem BOCPD) na tych samych slotach; ocena
   * w z góry ustalonych okresach (bloki `blockDays` dni od AB_EPOCH): w toku i w rozliczaniu — tylko liczności i CRPS,
   * zakończony — różnica B − A z 95% przedziałem Neweya–Westa (fixed-b). `registeredAt` — prerejestracja planu oceny
   * w dzienniku (null = jeszcze nie). Brak w starszych podsumowaniach; uszkodzona sekcja jest pomijana, nie cały panel.
   */
  ab?: {
    h: number;
    model: string;
    blockDays: number;
    registeredAt?: number | null;
    current: AbBlock | null;
    closing?: AbBlock | null;
    last: AbBlock | null;
    latest: { t: number; scale: number; regime: { sigma5: number; run: number; pChange: number } } | null;
  };
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
    Array.isArray(s.participation.gaps) &&
    // Sekcja A/B nie wpływa na ważność podsumowania — panel sprawdza ją osobno (isAb)
    (s.market === undefined || isMarket(s.market))
  );
}

/** Okres oceny A/B */
export interface AbBlock {
  start: number;
  end: number;
  n: number;
  crpsA: number | null;
  crpsB: number | null;
  diff: { d: number; lo: number; hi: number } | null;
}

function isAbBlock(x: unknown): boolean {
  if (x === null) return true;
  const b = x as Partial<AbBlock> | undefined;
  if (!b || !fin(b.start) || !fin(b.end) || !fin(b.n)) return false;
  const fon = (v: unknown) => v === null || fin(v);
  if (!fon(b.crpsA) || !fon(b.crpsB)) return false;
  return b.diff === null || (!!b.diff && fin(b.diff.d) && fin(b.diff.lo) && fin(b.diff.hi));
}

/** Sekcja A/B (opcjonalna) — sprawdzana osobno: uszkodzona sekcja ukrywa tylko kartę A/B */
export function isAb(x: unknown): x is NonNullable<DeskLedgerSummary['ab']> {
  const a = x as Partial<NonNullable<DeskLedgerSummary['ab']>> | null;
  if (!a || !fin(a.h) || typeof a.model !== 'string' || !fin(a.blockDays) || !isAbBlock(a.current) || !isAbBlock(a.last)) return false;
  if (a.closing !== undefined && !isAbBlock(a.closing)) return false;
  if (a.registeredAt !== undefined && a.registeredAt !== null && !fin(a.registeredAt)) return false;
  const l = a.latest;
  return l === null || (!!l && fin(l.t) && fin(l.scale) && !!l.regime && fin(l.regime.sigma5) && fin(l.regime.run) && fin(l.regime.pChange));
}

const isMkt = (m: unknown) => {
  const x = m as Partial<MktScores> | null;
  const d3 = (d: unknown) => d === null || (!!d && fin((d as { d: unknown }).d) && fin((d as { lo: unknown }).lo) && fin((d as { hi: unknown }).hi));
  return !!x && fin(x.n) && fin(x.near) && fin(x.illiquid) && d3(x.diff) && (x.diffEns === undefined || d3(x.diffEns)) && (x.diffAdd === undefined || d3(x.diffAdd));
};
/** Część „model vs rynek” (opcjonalna): wyniki obu poziomów i ostatnie pytanie — źle zbudowana odrzuca całe podsumowanie */
function isMarket(m: unknown): boolean {
  const x = m as Partial<NonNullable<DeskLedgerSummary['market']>> | null;
  if (!x || !isMkt(x.scores) || (x.tight !== undefined && !isMkt(x.tight))) return false;
  const e = x.ensemble;
  if (e !== undefined && !(!!e && fin(e.a) && fin(e.bm) && fin(e.bk) && fin(e.n) && fin(e.at) && (e.rec === undefined || (!!e.rec && fin(e.rec.a) && fin(e.rec.bk))))) return false;
  const l = x.latest;
  return l === null || (!!l && fin(l.t) && fin(l.expiry) && fin(l.K) && fin(l.p) && typeof l.liquid === 'boolean' && (l.pe === undefined || l.pe === null || fin(l.pe)));
}
