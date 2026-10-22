import { impactBp, type SideDepth } from './execCost.ts';
import type { LiqBucket, LiqMap } from './liqMap.ts';
import { mulberry32 } from './pathEngine.ts';

/**
 * Symulator kaskady likwidacji 2.0 (Monte Carlo, krok 30 s, horyzont 60 min) na zmierzonej mapie pozycji.
 *
 * Szok obejmuje cały rynek: cena (wyrocznia, giełdy) przesuwa się do `base`, a pozycje między ceną a `base` są
 * likwidowane od razu. Likwidacje to zlecenia rynkowe w transzach (20% nominału na krok — duże pozycje Hyperliquid
 * likwiduje częściami), które zjadają zmierzoną stronę arkusza HL (longi — bidy, shorty — aski) wzdłuż krzywej głębokości
 * z rejestratora (liniowo do ±10 / ±20 bp, dalej prawo pierwiastka; Tóth i in. 2011, Bouchaud i in. 2018).
 * Kolejne likwidacje wyzwala cena **mark**, nie środek arkusza: mark Hyperliquid to mediana (wyrocznia + EMA 150 s
 * różnicy środka HL od wyroczni, ceny HL, mediana perpów CEX) — przy wpływie tylko na arkusz HL podąża za nim
 * z opóźnieniem EMA 150 s. W tym czasie arkusz się odbudowuje: zużyta głębokość wygasa ze stałą czasową z pomiaru
 * odporności (powrót do 80% w medianie t minut → τ = t / ln 5). Kaskada rozkręca się tylko wtedy, gdy wpływ trwa dłużej,
 * niż arkusz potrzebuje na odbudowę — założenie: zewnętrzne ceny nie podążają za wpływem na HL.
 *
 * Niepewność: pozycje poza mapą — nominał kubełka × 1/pokrycie strony × czynnik wspólny ścieżki (log-normalny, σ = 0,5)
 * × czynnik kubełka (σ = 0,3), oba o średniej 1; w arkusz trafia U(0,6; 1) nominału (resztę przejmuje Liquidator Vault).
 * Wynik: pasma ruchu szczytowego ceny HL, zlikwidowanego nominału, P(ruch ≥ 2 × szok).
 */

export interface CascadeSimParams {
  /** Głębokość stron arkusza (USD w ±10 / ±20 bp) */
  bids: SideDepth;
  asks: SideDepth;
  /** Mediana minut do odbudowy głębokości po gwałtownym ruchu; null → 5 min */
  resilienceMin: number | null;
  paths?: number;
  seed?: number;
  horizonMin?: number;
}

export interface Band {
  p10: number;
  p50: number;
  p90: number;
}

export interface CascadeSimResult {
  shockPct: number;
  /** Ruch szczytowy ceny HL względem ceny mark (ułamek, ze znakiem) */
  move: Band;
  /** Zlikwidowany nominał (z pozycjami poza mapą), USD */
  liquidated: Band;
  /** Odsetek ścieżek z ruchem szczytowym ≥ 2 × szok */
  pAmplify2: number;
  /** Pokrycie strony użyte do przeskalowania (po ograniczeniu do [5%, 100%]) */
  coverage: number;
}

const STEP_S = 30;
const MARK_EMA_S = 150;
const TRANCHE = 0.2;
const SPREAD_COMMON = 0.5;
const SPREAD_BUCKET = 0.3;
const BOOK_SHARE: [number, number] = [0.6, 1];
export const MIN_COVERAGE = 0.05;
const DEFAULT_RESILIENCE_MIN = 5;
const MAX_IMPACT_BP = 9500;
const mid = (b: LiqBucket, step: number) => b.px + step / 2;

function quantiles(xs: number[]): Band {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => {
    const pos = (s.length - 1) * p;
    const lo = Math.floor(pos);
    return s[lo] + (s[Math.ceil(pos)] - s[lo]) * (pos - lo);
  };
  return { p10: q(0.1), p50: q(0.5), p90: q(0.9) };
}

/** Pokrycie strony: zeskanowane longi (shorty) / open interest; brak → udział całkowity; ograniczone do [5%, 100%]. */
export function sideCoverage(map: LiqMap, down: boolean): number {
  const c = map.coverage;
  const v = (down ? c.longBtc : c.shortBtc) / c.oiBtc;
  const cov = Number.isFinite(v) && v > 0 ? v : c.share;
  return Math.min(1, Math.max(MIN_COVERAGE, cov));
}

/** Kubełki po właściwej stronie ceny, posortowane od najbliższego. */
function sideBuckets(map: LiqMap, down: boolean): { px: number; ntl: number }[] {
  const bs = (down ? map.longs : map.shorts)
    .map((b) => ({ px: mid(b, map.stepUsd), ntl: b.ntlUsd }))
    .filter((b) => b.ntl > 0 && (down ? b.px < map.markPx : b.px > map.markPx));
  return bs.sort((a, b) => (down ? b.px - a.px : a.px - b.px));
}

/** null — brak głębokości strony arkusza (wynik nieznany, nie „brak kaskady”). */
export function simulateCascade(map: LiqMap, shockPct: number, p: CascadeSimParams): CascadeSimResult | null {
  const down = shockPct < 0;
  const depth = down ? p.bids : p.asks;
  if (!(depth.d10 > 0)) return null;
  const buckets = sideBuckets(map, down);
  const paths = p.paths ?? 400;
  const steps = Math.round(((p.horizonMin ?? 60) * 60) / STEP_S);
  const tauMin = Math.max(0.05, (p.resilienceMin ?? DEFAULT_RESILIENCE_MIN) / Math.log(5));
  const decay = Math.exp(-STEP_S / 60 / tauMin);
  const ema = 1 - Math.exp(-STEP_S / MARK_EMA_S);
  const cov = sideCoverage(map, down);
  const rnd = mulberry32(p.seed ?? 20261022);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const base = map.markPx * (1 + shockPct);
  const sgn = down ? -1 : 1;
  const priceOf = (bp: number) => base * (1 + (sgn * Math.min(bp, MAX_IMPACT_BP)) / 1e4);
  const crossed = (px: number, at: number) => (down ? px >= at : px <= at);
  const moves: number[] = [];
  const liq: number[] = [];
  let amp2 = 0;
  for (let k = 0; k < paths; k++) {
    const share = BOOK_SHARE[0] + (BOOK_SHARE[1] - BOOK_SHARE[0]) * rnd();
    const common = Math.exp(SPREAD_COMMON * gauss() - (SPREAD_COMMON * SPREAD_COMMON) / 2);
    const active: { rem: number; tranche: number }[] = [];
    let next = 0;
    let total = 0;
    // Wyzwolenie kubełków przekroczonych przez cenę mark; mnożnik losowany dopiero przy wyzwoleniu (tanio)
    const trigger = (markPx: number) => {
      while (next < buckets.length && crossed(buckets[next].px, markPx)) {
        const ntl = (buckets[next].ntl / cov) * common * Math.exp(SPREAD_BUCKET * gauss() - (SPREAD_BUCKET * SPREAD_BUCKET) / 2);
        total += ntl;
        active.push({ rem: ntl * share, tranche: ntl * share * TRANCHE });
        next++;
      }
    };
    trigger(base);
    let q = 0;
    let markBp = 0;
    let peakBp = 0;
    for (let s = 0; s <= steps; s++) {
      for (const a of active) {
        const e = Math.min(a.rem, a.tranche);
        a.rem -= e;
        q += e;
      }
      const x = impactBp(q, depth);
      const midBp = Number.isFinite(x) ? x : 0;
      if (midBp > peakBp) peakBp = midBp;
      markBp += (midBp - markBp) * ema;
      trigger(priceOf(markBp));
      q *= decay;
      // Kaskada wygasła: nic w kolejce, arkusz odbudowany, mark wrócił do szoku
      if (q < 1 && markBp < 1e-6 && active.every((a) => a.rem <= 0)) break;
    }
    const move = priceOf(peakBp) / map.markPx - 1;
    moves.push(move);
    liq.push(total);
    if (shockPct !== 0 && Math.abs(move) >= 2 * Math.abs(shockPct)) amp2++;
  }
  return { shockPct, move: quantiles(moves), liquidated: quantiles(liq), pAmplify2: amp2 / paths, coverage: cov };
}

/**
 * Wzmocnienie lokalne (sieczna, bez opóźnienia mark i odbudowy): największy stosunek wpływu likwidacji uruchomionych
 * ruchem o δ do δ, dla δ = 5…50 bp (pozycje poza mapą: 1/pokrycie strony, średni udział w arkuszu 0,8). ≥ 1 — ruch o δ
 * uruchamia likwidacje, które same mogą przesunąć cenę o co najmniej δ. NaN — brak głębokości strony.
 */
export function branchingRatio(map: LiqMap, dir: 'down' | 'up', p: CascadeSimParams): number {
  const down = dir === 'down';
  const depth = down ? p.bids : p.asks;
  if (!(depth.d10 > 0)) return Number.NaN;
  const cov = sideCoverage(map, down);
  const bs = sideBuckets(map, down);
  const meanShare = (BOOK_SHARE[0] + BOOK_SHARE[1]) / 2;
  let best = 0;
  for (let d = 5; d <= 50; d += 5) {
    const edge = map.markPx * (1 + ((down ? -1 : 1) * d) / 1e4);
    const q = bs.filter((b) => (down ? b.px >= edge : b.px <= edge)).reduce((s, b) => s + b.ntl, 0);
    if (q <= 0) continue;
    best = Math.max(best, impactBp((q / cov) * meanShare, depth) / d);
  }
  return best;
}
