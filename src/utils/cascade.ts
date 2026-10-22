import type { LiqBucket, LiqMap } from './liqMap.ts';

/**
 * Symulator kaskady likwidacji na zmierzonej mapie (pozycje on-chain Hyperliquid).
 *
 * Szok δ przesuwa cenę do m·(1+δ). Likwidacje po złej stronie ceny (longi przy spadku, shorty przy wzroście) stają się
 * zleceniami rynkowymi o nominale Q, które przesuwają cenę dalej zgodnie z prawem pierwiastka kwadratowego wpływu ceny
 * Δp/p = Y·σ_d·√(Q/V_d) (Tóth i in. 2011, PRX; Bouchaud, Bonart, Donier, Gould 2018). Nowa cena uruchamia kolejne
 * likwidacje — iterujemy do punktu stałego. Wpływ szczytowy (bez wygaszania) i pełne trafienie w arkusz → górna granica;
 * na Hyperliquid część dużych likwidacji idzie po 20% na blok albo przejmuje ją Liquidator Vault.
 */

export interface ImpactParams {
  /** Stała prawa pierwiastka (rzędu 1 w literaturze) — założenie, pokazywane z pasmem */
  y: number;
  /** Dzienna zmienność log-ceny */
  sigmaDaily: number;
  /** Dzienny obrót nominalny, USD */
  dayVolumeUsd: number;
}

export interface CascadeResult {
  shockPct: number;
  /** Ruch końcowy względem ceny mark (ułamek) */
  finalPct: number;
  /** Nominał zlikwidowany w kaskadzie, USD */
  liquidatedUsd: number;
  rounds: number;
  /** Ruch końcowy / szok (1 = brak wzmocnienia) */
  amplification: number;
}

/** Wpływ ograniczony do 95% — model nie może sprowadzić ceny do zera (poza zakresem stosowalności prawa pierwiastka). */
const MAX_IMPACT = 0.95;

export function impactFraction(qUsd: number, p: ImpactParams): number {
  if (!(qUsd > 0) || !(p.dayVolumeUsd > 0) || !(p.sigmaDaily > 0) || !(p.y > 0)) return 0;
  return Math.min(MAX_IMPACT, p.y * p.sigmaDaily * Math.sqrt(qUsd / p.dayVolumeUsd));
}

/** Środek kubełka — reprezentatywna cena likwidacji pozycji w kubełku. */
const mid = (b: LiqBucket, step: number) => b.px + step / 2;

export function cascadeOutcome(map: LiqMap, shockPct: number, p: ImpactParams): CascadeResult {
  if (shockPct === 0) return { shockPct, finalPct: 0, liquidatedUsd: 0, rounds: 0, amplification: 1 };
  const down = shockPct < 0;
  // Tylko kubełki po właściwej stronie ceny: long z likwidacją nad ceną (short pod) to nieaktualny odczyt
  const buckets = (down ? map.longs : map.shorts).filter((b) => (down ? mid(b, map.stepUsd) < map.markPx : mid(b, map.stepUsd) > map.markPx));
  const base = map.markPx * (1 + shockPct);
  let price = base;
  let q = 0;
  let rounds = 0;
  // Punkt stały osiągany najwyżej po (liczba kubełków + 1) rundach — każda runda dokłada co najmniej jeden kubełek
  while (rounds <= buckets.length) {
    let qNew = 0;
    for (const b of buckets) {
      const m = mid(b, map.stepUsd);
      if (down ? m >= price : m <= price) qNew += b.ntlUsd;
    }
    if (qNew === q) break;
    q = qNew;
    rounds++;
    const impact = impactFraction(q, p);
    price = down ? base * (1 - impact) : base * (1 + impact);
  }
  const finalPct = price / map.markPx - 1;
  return { shockPct, finalPct, liquidatedUsd: q, rounds, amplification: finalPct / shockPct };
}

export function cascadeCurve(map: LiqMap, shocks: number[], p: ImpactParams): CascadeResult[] {
  return shocks.map((s) => cascadeOutcome(map, s, p));
}
