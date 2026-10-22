import { impactBp, type SideDepth } from './execCost.ts';
import type { LiqBucket, LiqMap } from './liqMap.ts';
import { mulberry32 } from './pathEngine.ts';

/**
 * Symulator kaskady likwidacji 2.0 (Monte Carlo, krok 1 min, horyzont 60 min) na zmierzonej mapie pozycji:
 *  - szok przesuwa cenę; likwidacje po złej stronie stają się zleceniami rynkowymi, które zjadają zmierzoną stronę
 *    arkusza (longi — bidy, shorty — aski) wzdłuż krzywej głębokości rejestratora (liniowo do ±20 bp, dalej prawo
 *    pierwiastka kwadratowego; Tóth i in. 2011, Bouchaud i in. 2018);
 *  - arkusz się odbudowuje: zużyta głębokość wygasa wykładniczo ze stałą czasową z pomiaru odporności (powrót do 80%
 *    w medianie t minut → τ = t / ln 5);
 *  - niepewność: pozycje poza mapą (pokrycie c) — nominał kubełka × (1/c) × rozrzut log-normalny (σ = 0,5, średnia 1),
 *    udział likwidacji trafiających w arkusz U(0,6; 1) — resztę przejmuje Liquidator Vault Hyperliquid.
 * Wynik: pasma ruchu szczytowego i zlikwidowanego nominału, P(wzmocnienie ≥ 2×). Lokalny współczynnik rozgałęzienia
 * pętli kaskady (analogia procesu Hawkesa): n = gęstość likwidacji przy cenie [USD/bp] × wpływ krańcowy [bp/USD];
 * n ≥ 1 — mały ruch sam się podtrzymuje (stan nadkrytyczny).
 */

export interface CascadeSimParams {
  /** Głębokość stron arkusza (USD w ±10 / ±20 bp) — bieżąca godzina z rejestratora */
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
  /** Ruch szczytowy względem ceny mark (ułamek, ze znakiem) */
  move: Band;
  /** Zlikwidowany nominał (z pozycjami poza mapą), USD */
  liquidated: Band;
  /** Odsetek ścieżek z ruchem szczytowym ≥ 2 × szok */
  pAmplify2: number;
}

const SPREAD = 0.5;
const BOOK_SHARE: [number, number] = [0.6, 1];
const MIN_COVERAGE = 0.05;
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

/** Kubełki po właściwej stronie ceny, posortowane od najbliższego. */
function sideBuckets(map: LiqMap, down: boolean): { px: number; ntl: number }[] {
  const bs = (down ? map.longs : map.shorts)
    .map((b) => ({ px: mid(b, map.stepUsd), ntl: b.ntlUsd }))
    .filter((b) => b.ntl > 0 && (down ? b.px < map.markPx : b.px > map.markPx));
  return bs.sort((a, b) => (down ? b.px - a.px : a.px - b.px));
}

export function simulateCascade(map: LiqMap, shockPct: number, p: CascadeSimParams): CascadeSimResult {
  const down = shockPct < 0;
  const depth = down ? p.bids : p.asks;
  const buckets = sideBuckets(map, down);
  const paths = p.paths ?? 400;
  const horizon = p.horizonMin ?? 60;
  const tau = Math.max(1, (p.resilienceMin ?? 5) / Math.log(5));
  const decay = Math.exp(-1 / tau);
  const cov = Math.max(MIN_COVERAGE, map.coverage.share);
  const rnd = mulberry32(p.seed ?? 20261022);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const base = map.markPx * (1 + shockPct);
  const moves: number[] = [];
  const liq: number[] = [];
  let amp2 = 0;
  for (let k = 0; k < paths; k++) {
    const share = BOOK_SHARE[0] + (BOOK_SHARE[1] - BOOK_SHARE[0]) * rnd();
    const mult = buckets.map(() => (1 / cov) * Math.exp(SPREAD * gauss() - (SPREAD * SPREAD) / 2));
    let q = 0;
    let total = 0;
    let next = 0;
    let peak = base;
    const priceAt = () => {
      const x = impactBp(q, depth);
      const imp = Number.isFinite(x) ? Math.min(0.95, x / 1e4) : 0;
      return down ? base * (1 - imp) : base * (1 + imp);
    };
    for (let t = 0; t <= horizon; t++) {
      // Kaskada w obrębie minuty: nowe likwidacje → wpływ → kolejne, aż do punktu stałego
      let price = priceAt();
      while (next < buckets.length && (down ? buckets[next].px >= price : buckets[next].px <= price)) {
        const add = buckets[next].ntl * mult[next];
        total += add;
        q += add * share;
        next++;
        price = priceAt();
      }
      if (down ? price < peak : price > peak) peak = price;
      q *= decay;
      if (next >= buckets.length && q < 1) break;
    }
    const move = peak / map.markPx - 1;
    moves.push(move);
    liq.push(total);
    if (shockPct !== 0 && Math.abs(move) >= 2 * Math.abs(shockPct)) amp2++;
  }
  return { shockPct, move: quantiles(moves), liquidated: quantiles(liq), pAmplify2: amp2 / paths };
}

/**
 * Lokalny współczynnik rozgałęzienia pętli kaskady przy obecnej cenie (pierwsze `windowBp` bp w danym kierunku):
 * gęstość likwidacji [USD/bp] (z pozycjami poza mapą, średni udział w arkuszu 0,8) × wpływ krańcowy przy pustym arkuszu
 * [bp/USD] = 10 / D10. n ≥ 1 — nadkrytycznie.
 */
export function branchingRatio(map: LiqMap, dir: 'down' | 'up', p: CascadeSimParams, windowBp = 50): number {
  const down = dir === 'down';
  const depth = down ? p.bids : p.asks;
  if (!(depth.d10 > 0)) return Number.NaN;
  const cov = Math.max(MIN_COVERAGE, map.coverage.share);
  const edge = map.markPx * (1 + ((down ? -1 : 1) * windowBp) / 1e4);
  const ntl = sideBuckets(map, down)
    .filter((b) => (down ? b.px >= edge : b.px <= edge))
    .reduce((s, b) => s + b.ntl, 0);
  const density = ((ntl / cov) * ((BOOK_SHARE[0] + BOOK_SHARE[1]) / 2)) / windowBp;
  return density * (10 / depth.d10);
}
