import type { LiqBucket, LiqMap } from './liqMap.ts';

/** Odczyty mapy likwidacji dla UI — czyste funkcje (świeżość, klastry, stop w klastrze, histogram). */

/**
 * Świeżość mapy z trzech czasów: publikacji (asOf), kontekstu rynku (ctxAt) i samych odczytów pozycji (mediana ważona nominałem).
 * ready = LIVE; delayed = publikacja aktualna, ale połowa nominału z odczytów > 15 min; stale = publikacja lub kontekst > 10 min;
 * expired = publikacja > 60 min (mapa nie jest pokazywana).
 */
export type LiqFreshness = 'ready' | 'delayed' | 'stale' | 'expired';

export function liqMapFreshness(map: LiqMap, now: number): LiqFreshness {
  const min = 60_000;
  if (now - map.asOf > 60 * min) return 'expired';
  if (now - map.asOf > 10 * min || now - map.ctxAt > 10 * min) return 'stale';
  if (map.ageMin.ntlP50 > 15) return 'delayed';
  return 'ready';
}

const mid = (b: LiqBucket, step: number) => b.px + step / 2;

export interface Cluster {
  /** Środek kubełka, USD */
  px: number;
  ntlUsd: number;
  /** Odległość od ceny mark (ułamek, ze znakiem) */
  distPct: number;
}

/** Najbliższy cenie kubełek o nominale ≥ minUsd: longi pod ceną i shorty nad nią. */
export function nearestClusters(map: LiqMap, minUsd: number): { below: Cluster | null; above: Cluster | null } {
  const pick = (buckets: LiqBucket[], under: boolean): Cluster | null => {
    let best: Cluster | null = null;
    for (const b of buckets) {
      const px = mid(b, map.stepUsd);
      if (b.ntlUsd < minUsd || (under ? px > map.markPx : px < map.markPx)) continue;
      const distPct = px / map.markPx - 1;
      if (!best || Math.abs(distPct) < Math.abs(best.distPct)) best = { px, ntlUsd: b.ntlUsd, distPct };
    }
    return best;
  };
  return { below: pick(map.longs, true), above: pick(map.shorts, false) };
}

/**
 * Likwidacje po tej samej stronie co stop planu w paśmie ±bandPct wokół stopu: stop LONG wpada w likwidacje longów
 * (sprzedaż), stop SHORT — shortów (kupno). Duży nominał tam = ryzyko przestrzelenia stopu i gorszego wykonania.
 */
export function stopNearCluster(
  map: LiqMap,
  direction: 'LONG' | 'SHORT',
  stop: number,
  opts: { bandPct?: number; minUsd?: number } = {}
): { ntlUsd: number; positions: number } | null {
  const band = opts.bandPct ?? 0.002;
  const lo = stop * (1 - band);
  const hi = stop * (1 + band);
  let ntlUsd = 0;
  let positions = 0;
  for (const b of direction === 'LONG' ? map.longs : map.shorts) {
    const px = mid(b, map.stepUsd);
    if (px < lo || px > hi) continue;
    ntlUsd += b.ntlUsd;
    positions += b.n;
  }
  return ntlUsd >= (opts.minUsd ?? 1e6) ? { ntlUsd, positions } : null;
}

export interface HistBin {
  from: number;
  to: number;
  ntlUsd: number;
  n: number;
}

/** `rows` równych przedziałów ceny w ±rangePct wokół ceny mark; kubełki przypisane po środku. */
export function rebin(buckets: LiqBucket[], markPx: number, rangePct: number, rows: number, stepUsd: number = 0): HistBin[] {
  const lo = markPx * (1 - rangePct);
  const hi = markPx * (1 + rangePct);
  const w = (hi - lo) / rows;
  const out: HistBin[] = Array.from({ length: rows }, (_, i) => ({ from: lo + i * w, to: lo + (i + 1) * w, ntlUsd: 0, n: 0 }));
  for (const b of buckets) {
    const px = b.px + (stepUsd > 0 ? stepUsd : 0) / 2;
    if (px < lo || px >= hi) continue;
    const bin = out[Math.min(rows - 1, Math.floor((px - lo) / w))];
    bin.ntlUsd += b.ntlUsd;
    bin.n += b.n;
  }
  return out;
}
