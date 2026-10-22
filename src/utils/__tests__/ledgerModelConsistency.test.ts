import { describe, expect, it } from 'vitest';
import { simulateBarrierPaths } from '../planAnalyzer';
import { LedgerBar, LedgerEntry, resolvePending } from '../forecastLedger';

/**
 * Zgodność modelu z dziennikiem: ścieżki 1-sekundowe GBM → świece 1m → prawdziwe `resolvePending`,
 * porównane z Monte Carlo Analizatora (kroki 5 min z korektą mostu). Model ma prognozować to, co dziennik rozlicza.
 */
function rng(seed: number) {
  let s = seed | 0;
  const u = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(u() + 1e-300)) * Math.cos(2 * Math.PI * u());
}

const MIN = 60_000;
const MINUTE0 = Date.UTC(2026, 9, 22, 12, 0, 0);
const CREATED = MINUTE0 + 25_000; // zapis w 25. sekundzie minuty
const HORIZON = 30;

function ledgerShares(p: { entry: number; stop: number; target: number; start: number; sigma: number; paths: number; seed: number; startPrice?: number }) {
  const n = rng(p.seed);
  const sigSec = p.sigma / Math.sqrt(HORIZON * 60);
  const deadline = CREATED + HORIZON * MIN;
  const counts: Record<string, number> = { target: 0, stop: 0, none: 0, nofill: 0 };
  for (let k = 0; k < p.paths; k++) {
    let price = p.start;
    // Reszta minuty zapisu (35 s) — nieobserwowana przez dziennik (świeca w toku jest pomijana)
    for (let s = 0; s < 35; s++) price *= Math.exp(sigSec * n());
    const bars: LedgerBar[] = [];
    for (let t = MINUTE0 + MIN; t < deadline + MIN; t += MIN) {
      let hi = price;
      let lo = price;
      for (let s = 0; s < 60; s++) {
        price *= Math.exp(sigSec * n());
        hi = Math.max(hi, price);
        lo = Math.min(lo, price);
      }
      bars.push({ time: t, high: hi, low: lo });
    }
    const e: LedgerEntry = {
      id: `p${k}`,
      createdAt: CREATED,
      direction: 'LONG',
      entry: p.entry,
      stop: p.stop,
      target: p.target,
      horizonMin: HORIZON,
      pTarget: 0,
      pStop: 0,
      pNeither: 0,
      modelVersion: 'test',
      status: 'pending',
      startPrice: p.startPrice,
    };
    counts[resolvePending([e], bars, deadline + 5 * MIN, MIN)[0].status]++;
  }
  const filled = p.paths - counts.nofill;
  return {
    pFill: filled / p.paths,
    pTarget: counts.target / filled,
    pStop: counts.stop / filled,
  };
}

function modelShares(p: { entry: number; stop: number; target: number; start: number; sigma: number }) {
  const mc = simulateBarrierPaths({
    direction: 'LONG',
    entry: p.entry,
    stop: p.stop,
    target: p.target,
    sigmaHorizon: p.sigma,
    horizonMin: HORIZON,
    stepSigmas: Array(6).fill(p.sigma / Math.sqrt(6)),
    stepMin: 5,
    residuals: null,
    startPrice: p.start,
    paths: 6000,
    seed: 3,
  });
  return { pFill: mc.pFill, pTarget: mc.pTarget, pStop: mc.pStop };
}

describe('zgodność Monte Carlo z rozstrzyganiem dziennika (świece 1m)', () => {
  it('wejście po cenie rynku (w granicy 1 bp): oba traktują je jako wypełnione; wynik warunkowy ±4 pp', () => {
    const start = 83000;
    const p = { entry: start + 2, stop: start * 0.997, target: start * 1.0045, start, sigma: 0.003 };
    const m = modelShares(p);
    const l = ledgerShares({ ...p, paths: 2000, seed: 11, startPrice: start });
    expect(m.pFill).toBe(1);
    expect(l.pFill).toBe(1);
    expect(Math.abs(m.pTarget - l.pTarget)).toBeLessThan(0.04);
    expect(Math.abs(m.pStop - l.pStop)).toBeLessThan(0.04);
  });

  it('zlecenie z limitem 0.2% pod rynkiem: P(wypełnienia) i wynik warunkowy ±5 pp', () => {
    const start = 83000;
    const entry = start * 0.998;
    const p = { entry, stop: entry * 0.997, target: entry * 1.0045, start, sigma: 0.003 };
    const m = modelShares(p);
    const l = ledgerShares({ ...p, paths: 2000, seed: 12, startPrice: start });
    expect(Math.abs(m.pFill - l.pFill)).toBeLessThan(0.05);
    expect(Math.abs(m.pTarget - l.pTarget)).toBeLessThan(0.05);
    expect(Math.abs(m.pStop - l.pStop)).toBeLessThan(0.05);
  });
});
