/**
 * Weryfikowalny dziennik prognoz desku — kontrakt danych `ledger/BTC/summary.json` (gałąź `ledger` repo danych) i odczyty
 * dla UI. Tylko importy typów (moduł ładowany także natywnie w skanerze).
 *
 * Prognozy są pre-rejestrowane co 15 min w plikach dziennych JSONL z łańcuchem hashy (SHA-256), dni zakotwiczane
 * w Bitcoinie przez OpenTimestamps; rozstrzygnięcia ze świec 1m Hyperliquid. Każdy może zweryfikować łańcuch
 * i przeliczyć wyniki (scripts/verify-ledger.mjs) bez zaufania do HyperQuant.
 */

import type { SkillCi } from './ledgerBootstrap.ts';
import type { CalSummary } from './catCal.ts';
import type { HrelBlock, HrelLead, HrelSummary } from './hourRel.ts';
import type { CatClock } from './moveClock.ts';
import type { CatTrust, HourTrust, TrustHead } from './schrodiTrust.ts';

export type { SkillCi } from './ledgerBootstrap.ts';

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
  /** Test Kupca przedziału 60% na próbie rozłącznej (trafienia `x` z `n`); brak w podsumowaniach sprzed 12.11.2026 */
  kupiec60?: Kupiec60;
  /** Jednostajność PIT (χ², 9 st. swobody) na próbie rozłącznej; test od 50 prognoz */
  pit?: PitTest;
  /** CRPSS z przedziałem z bootstrapu blokowego po dobach UTC (od 7 dób) */
  crpssCi?: SkillCi;
  /** Udział prognoz z nieskończoną granicą przedziału ACI (α ≤ 0 albo α ≥ 2) */
  aciInf?: AciInf;
}

/** Test Kupca: `n` prognoz rozłącznych, `x` trafień, `cover` = x/n, LR i p z χ²(1); n = 0 → null z powodem `min-n` */
export interface Kupiec60 {
  n: number;
  x: number;
  cover: number | null;
  lr: number | null;
  p: number | null;
  reason?: 'min-n';
}

/** PIT w 10 równych koszykach, χ² = Σ (o − n/10)² / (n/10), p z χ²(9); poniżej 50 prognoz null z powodem `min-n` */
export interface PitTest {
  n: number;
  bins: number[];
  chi2: number | null;
  p: number | null;
  reason?: 'min-n';
}

/** Prognozy (`n`), z nich z nieskończoną granicą przedziału ACI (`inf`) i udział */
export interface AciInf {
  n: number;
  inf: number;
  share: number | null;
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
  /** Brier Skill Score względem klimatologii poziomów (pokazywany tylko razem z `bssDist`) */
  bss: number | null;
  /** To samo co `bss`, z jawną nazwą bazy (częstość poziomu); brak w podsumowaniach sprzed 11.11.2026 */
  bssClim?: number | null;
  /**
   * Brier bazy odległości: P = 2(1 − Φ(|ln(poziom/cena)| / (σ·√(h/60)))), σ = stała σ godzinowych log-zwrotów z 30 dni
   * (ta sama co w benchmarku CRPS, odtworzona z `bq` prognozy zwrotu 1 h z tego samego slotu)
   */
  brierDist?: number | null;
  /** BSS względem bazy odległości, na parach z σ bazy (`pairsDist`) */
  bssDist?: number | null;
  /** Pary z σ bazy odległości (zwykle = `pairs`) */
  pairsDist?: number;
  /** `bss` (częstość poziomu) z przedziałem z bootstrapu blokowego po dobach UTC; brak w podsumowaniach sprzed 12.11.2026 */
  bssCi?: SkillCi;
  /** `bssDist` (baza odległości) z przedziałem z tego samego losowania */
  bssDistCi?: SkillCi;
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

/** Wyniki jednej głowy kota: Brier, Brier klimatologii z tego samego okna, BSS, AUC i trafność progu 50% */
export interface CatHeadScores {
  brier: number | null;
  brierBase: number | null;
  bss: number | null;
  auc: number | null;
  hit: number | null;
}

/** Schrödi (1 h): kierunek w trzech stanach panelu i duży ruch z diagramem niezawodności */
export interface CatScores {
  n: number;
  /** Prognozy rozłączne (sloty o pełnej godzinie) — prognozy co 15 min na 1 h nakładają się czterokrotnie */
  nEff: number;
  dir: CatHeadScores & { long: { n: number; hit: number | null }; short: { n: number; hit: number | null }; unsure: number };
  big: CatHeadScores & {
    reliability: ReliabilityBin[];
    /**
     * BSS wobec bazy sezonowej: częstość dużego ruchu z pełnych godzin tej samej godziny UTC w 20 poprzednich dobach
     * tego samego typu (dzień roboczy / weekend), od 8 rozstrzygnięć; mniej — częstość wszystkich godzin tych dób.
     * `n` = prognozy z bazą. Brak w podsumowaniach sprzed 12.11.2026.
     */
    bssSeasonal?: SkillCi & { n: number };
  };
  /** Szanse dotknięcia poziomów i stożek zasięgu; brak w starszych podsumowaniach */
  touch?: CatTouchScores;
}

/** Szanse dotknięcia kota: Brier wobec ruchu Browna, niezawodność i pokrycie stożka 80/50/20% (odsetek dotkniętych granic) */
export interface CatTouchScores {
  /** Ocenione szanse poziomów */
  n: number;
  /** Pełne godziny z szansami dotknięcia (prognozy rozłączne) */
  hours: number;
  brier: number | null;
  /** Ruch Browna z σ godziny z realizowanej zmienności doby */
  brierBm: number | null;
  bssBm: number | null;
  reliability: ReliabilityBin[];
  cone: { q: number; n: number; up: number | null; dn: number | null }[];
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
  /**
   * A/B wariantu C (plan `ab-v2`): wersja A vs C (świeży poziom zmienności z 12 świec 5m i mieszanina skali) na tych
   * samych slotach, w tych samych okresach co `ab`, oceniane od pierwszej granicy okresu po rejestracji planu
   * (`firstBlock`). Pola `crpsB` i `diff` w okresach to C i C − A. W zakończonym okresie `cal` — pokrycie 60% i 90% C na
   * próbie rozłącznej. Brak przed pierwszym rozliczonym rekordem C i w starszych podsumowaniach.
   */
  abC?: {
    h: number;
    model: string;
    plan: string;
    blockDays: number;
    registeredAt: number | null;
    firstBlock: number | null;
    current: AbBlock | null;
    closing: AbBlock | null;
    last: (AbBlock & { cal: { n: number; cov60: number | null; cov90: number | null } | null }) | null;
    latest: { t: number; x: number; rv60: number } | null;
  };
  /**
   * Schrödi (kot pod wykresem): od `since` w każdym slocie z prognozami desku; `slots` — takie sloty, `issued` — prognozy
   * kota (różnica = sloty bez danych kota). Brak w starszych podsumowaniach; sprawdzana osobno (isCat).
   */
  cat?: {
    model: string | null;
    since: number | null;
    issued: number;
    slots: number;
    latest: { t: number; px0: number; pUp: number; pBig: number; thr: number } | null;
    scores: CatScores;
    /** Ocena zaufania od rejestracji planu (cały dziennik, pełne godziny); brak w starszych podsumowaniach */
    trust?: CatTrust;
    /** Ocena godziny na żywo (zapisy o :15 i :30) od rejestracji jej planu; brak w starszych podsumowaniach */
    hour?: HourTrust;
    /** Rozliczenie kalibracji `cat-cal-v1` od rejestracji jej planu; brak w starszych podsumowaniach */
    cal?: CalSummary;
    /** Zegar ruchu: tercyle pBig z 14 dni i baza sezonowa godzin; brak w starszych podsumowaniach */
    clock?: CatClock;
  };
  /**
   * Prognoza `hrel-v1` (duży ruch jak na tę godzinę, cztery wyprzedzenia) od rejestracji jej planu; brak w starszych
   * podsumowaniach i przed rejestracją. Do awansu tylko w karcie dziennika i w MCP — sprawdzana osobno (isHrelSummary).
   */
  hrel?: HrelSummary;
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

/** Wyniki (trafność, pokrycie, Brier) pokazujemy dopiero od tylu rozstrzygnięć — mniejsza próba to szum, nie ocena. */
export const LEDGER_MIN_N = 20;

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
    // Baza odległości: pola opcjonalne (starsze podsumowania ich nie mają), ale jeśli są — liczby albo null
    (t.bssClim === undefined || finOrNull(t.bssClim)) &&
    (t.brierDist === undefined || finOrNull(t.brierDist)) &&
    (t.bssDist === undefined || finOrNull(t.bssDist)) &&
    (t.pairsDist === undefined || fin(t.pairsDist)) &&
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

/** Sekcja A/B wariantu C (opcjonalna) — jak `isAb`; uszkodzona ukrywa tylko kartę wariantu C */
export function isAbC(x: unknown): x is NonNullable<DeskLedgerSummary['abC']> {
  const a = x as Partial<NonNullable<DeskLedgerSummary['abC']>> | null;
  if (!a || !fin(a.h) || typeof a.model !== 'string' || typeof a.plan !== 'string' || !fin(a.blockDays)) return false;
  if (!finOrNull(a.registeredAt) || !finOrNull(a.firstBlock) || !isAbBlock(a.current) || !isAbBlock(a.closing) || !isAbBlock(a.last)) return false;
  const c = a.last?.cal;
  if (a.last && c !== null && !(c && fin(c.n) && finOrNull(c.cov60) && finOrNull(c.cov90))) return false;
  const l = a.latest;
  return l === null || (!!l && fin(l.t) && fin(l.x) && fin(l.rv60));
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

const isCatHead = (h: unknown) => {
  const x = h as Partial<CatHeadScores> | null;
  return !!x && finOrNull(x.brier) && finOrNull(x.brierBase) && finOrNull(x.bss) && finOrNull(x.auc) && finOrNull(x.hit);
};
const isSide = (v: unknown) => !!v && fin((v as { n: unknown }).n) && finOrNull((v as { hit: unknown }).hit);
const isCatTouch = (v: unknown) => {
  const t = v as Partial<CatTouchScores> | null;
  return (
    !!t && fin(t.n) && fin(t.hours) && finOrNull(t.brier) && finOrNull(t.brierBm) && finOrNull(t.bssBm) && Array.isArray(t.reliability) &&
    Array.isArray(t.cone) && t.cone.every((c) => !!c && fin(c.q) && fin(c.n) && finOrNull(c.up) && finOrNull(c.dn))
  );
};

const isTrustHead = (v: unknown) => {
  const h = v as Partial<TrustHead> | null;
  const d = h?.drift;
  return (
    !!h && fin(h.n) && fin(h.lg) && fin(h.lgMax) && finOrNull(h.proofAt) && Array.isArray(h.path) && h.path.every(fin) && fin(h.step) &&
    finOrNull(h.brier) && finOrNull(h.brierBase) && (h.corp === null || (!!h.corp && fin(h.corp.mcb) && fin(h.corp.dsc) && fin(h.corp.unc))) &&
    (h.spiegel === null || (!!h.spiegel && fin(h.spiegel.z) && fin(h.spiegel.p))) &&
    Array.isArray(h.rel) && h.rel.every((b) => !!b && fin(b.lo) && fin(b.hi) && fin(b.n) && finOrNull(b.meanP) && finOrNull(b.freq)) &&
    !!d && fin(d.lg) && typeof d.alarm === 'boolean' && fin(d.episodes) && finOrNull(d.since)
  );
};

/** Ocena zaufania kota (dowód przewagi, rozkład trafności, dryf, rzadki rynek) */
export function isTrust(x: unknown): x is CatTrust {
  const t = x as Partial<CatTrust> | null;
  const p = t?.plan;
  if (!t || !(p === null || (!!p && typeof p.id === 'string' && typeof p.hash === 'string' && fin(p.at)))) return false;
  if (!isTrustHead(t.big) || !isTrustHead(t.dir) || !isTrustHead(t.touch)) return false;
  return !!t.ood && fin(t.ood.n) && finOrNull(t.ood.bssBig) && finOrNull(t.ood.bssDir);
}

/** Ocena godziny na żywo: plan, dowód dużego ruchu wobec reguły, kierunek opisowo */
export function isHourTrust(x: unknown): x is HourTrust {
  const t = x as Partial<HourTrust> | null;
  const p = t?.plan;
  if (!t || !(p === null || (!!p && typeof p.id === 'string' && typeof p.hash === 'string' && fin(p.at)))) return false;
  return isTrustHead(t.big) && !!t.dir && fin(t.dir.n) && finOrNull(t.dir.brier) && finOrNull(t.dir.hit);
}

/** Sekcja kota (opcjonalna) — sprawdzana osobno: uszkodzona sekcja ukrywa tylko wynik kota */
const isCalGroup = (g: unknown) => {
  const x = g as { n?: unknown; meanP?: unknown; freq?: unknown } | null;
  return !!x && fin(x.n) && finOrNull(x.meanP) && finOrNull(x.freq);
};

const isCells = (v: unknown) => Array.isArray(v) && v.length === 24 && v.every((c) => !!c && fin(c.k) && fin(c.n));
/** Zegar ruchu (`cat.clock`) */
export function isClock(x: unknown): x is CatClock {
  const c = x as Partial<CatClock> | null;
  const t = c?.terciles;
  return !!c && (t === null || (!!t && fin(t.q1) && fin(t.q2) && fin(t.n))) && !!c.season && isCells(c.season.weekday) && isCells(c.season.weekend);
}

/** Rozliczenie kalibracji kota (`cat.cal`) */
export function isCalSummary(x: unknown): x is CalSummary {
  const c = x as Partial<CalSummary> | null;
  if (!c || !c.plan || !fin(c.plan.at) || typeof c.plan.hash !== 'string' || !fin(c.n) || !finOrNull(c.brier) || !finOrNull(c.brierRaw)) return false;
  if (!finOrNull(c.meanP) || !finOrNull(c.freq) || !c.byType || !isCalGroup(c.byType.weekday) || !isCalGroup(c.byType.weekend)) return false;
  if (!Array.isArray(c.deciles) || !c.deciles.every((d) => isCalGroup(d) && fin(d.lo) && fin(d.hi))) return false;
  const b = c.block;
  return b === null || (!!b && fin(b.start) && fin(b.end) && fin(b.n) && (b.diff === null || (!!b.diff && fin(b.diff.mean) && fin(b.diff.lo) && fin(b.diff.hi))));
}

const isHrelGroup = (g: unknown) => isCalGroup(g);
const isHrelBlock = (b: unknown) => {
  const x = b as Partial<HrelBlock> | null;
  return !!x && isHrelGroup(x) && fin(x.start) && fin(x.end) && finOrNull(x.mean) && finOrNull(x.se) && finOrNull(x.t) && finOrNull(x.maxQDev);
};

/** Rozliczenie prognozy `hrel-v1` (pole `hrel`): cztery wyprzedzenia, zakończone bloki, dane łączne, ostatnia prognoza */
export function isHrelSummary(x: unknown): x is HrelSummary {
  const h = x as Partial<HrelSummary> | null;
  if (!h || !h.plan || !fin(h.plan.at) || typeof h.plan.hash !== 'string' || !fin(h.days)) return false;
  const ci = (c: unknown) => {
    const s = c as Partial<SkillCi> | null;
    return !!s && finOrNull(s.value) && finOrNull(s.lo) && finOrNull(s.hi) && fin(s.days);
  };
  const leadOk = (l: unknown) => {
    const v = l as Partial<HrelLead> | null;
    return !!v && fin(v.j) && isHrelGroup(v) && finOrNull(v.brier) && ci(v.bss) && finOrNull(v.auc) && Array.isArray(v.quintiles) && v.quintiles.length === 5 && v.quintiles.every(isHrelGroup);
  };
  if (!Array.isArray(h.leads) || h.leads.length !== 4 || !h.leads.every(leadOk)) return false;
  if (!Array.isArray(h.blocks) || !h.blocks.every(isHrelBlock) || !(h.pooled === null || isHrelBlock(h.pooled))) return false;
  const l = h.latest;
  return l === null || (!!l && fin(l.t) && nums(l.x) && nums(l.thr) && nums(l.p) && l.p.length === 4 && l.thr.length === 4);
}

export function isCat(x: unknown): x is NonNullable<DeskLedgerSummary['cat']> {
  const c = x as Partial<NonNullable<DeskLedgerSummary['cat']>> | null;
  if (!c || !fin(c.issued) || !fin(c.slots) || !finOrNull(c.since ?? null) || !c.scores) return false;
  const s = c.scores;
  if (!fin(s.n) || !fin(s.nEff) || !isCatHead(s.dir) || !isCatHead(s.big)) return false;
  if (!isSide(s.dir.long) || !isSide(s.dir.short) || !fin(s.dir.unsure) || !Array.isArray(s.big.reliability)) return false;
  if (s.touch !== undefined && !isCatTouch(s.touch)) return false;
  if (c.trust !== undefined && !isTrust(c.trust)) return false;
  if (c.hour !== undefined && !isHourTrust(c.hour)) return false;
  if (c.cal !== undefined && !isCalSummary(c.cal)) return false;
  if (c.clock !== undefined && !isClock(c.clock)) return false;
  const l = c.latest;
  return l === null || (!!l && fin(l.t) && fin(l.px0) && fin(l.pUp) && fin(l.pBig) && fin(l.thr));
}
