// Syntetyczna godzina wejścia; bez sieci, kont i transportu zleceń.
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { ObservationJournal } from '../../src/charts/pro/core/smcObservation';
import { SmcOrderflow, type FlowElement } from '../../src/charts/pro/core/smcOrderflow';
import type { SBar } from '../../src/charts/pro/core/smcStructure';

const gc = (globalThis as unknown as { gc?: () => void }).gc;
if (!gc) throw new Error('Run with --expose-gc; heap must use the same GC procedure.');
const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * p) - 1];
const elements = (count: number): FlowElement[] => Array.from({ length: count }, (_, i) => ({
  id: `bench:${i}`, kind: i % 5 === 0 ? 'sweep' : i % 5 === 1 ? 'fvg' : 'ob', known: 0,
  lo: 99 + i * .01, hi: 101 + i * .01, atr: 1, dir: i % 2 ? 1 : -1, expiresAt: 1e12,
}));
function run(count: number, seconds: number) {
  gc!(); gc!(); const heapBase = process.memoryUsage().heapUsed;
  const j = new ObservationJournal('BTC'), m = new SmcOrderflow(j), es = elements(count), bars: SBar[] = [];
  j.open(0, 0); m.update(es, bars, 'up', 0);
  const times: number[] = [], trajectory: { at: number; heap: number }[] = [];
  let nextBook = 0, nextBar = 300000, notifications = 0, peak = heapBase;
  const start = performance.now();
  for (let batch = 0; batch < seconds * 3; batch++) {
    const from = batch * 100, end = (from + 100) / 300 * 1000;
    const prints = Array.from({ length: 100 }, (_, i) => {
      const id = from + i; return { time: id / 300 * 1000, tid: id, px: 100 + Math.round(Math.sin(id / 3000) * 100) / 100, sz: 1 + id % 3, side: (id % 3 ? 1 : -1) as 1 | -1 };
    });
    const before = performance.now();
    j.trades(prints, end);
    while (nextBook < end) {
      j.book({ time: nextBook, bids: Array.from({ length: 20 }, (_, i) => ({ px: 99.9 - i * .1, sz: 1 + i })), asks: Array.from({ length: 20 }, (_, i) => ({ px: 100.1 + i * .1, sz: 1 + i })) }, end, .1);
      nextBook += 500;
    }
    while (nextBar <= end) { bars.push({ t: nextBar - 300000, o: 100, h: 101, l: 99, c: 100 }); nextBar += 300000; }
    m.update(es, bars, 'up', end);
    // Wywołanie konsumenta/odczyt otwartego panelu w tej samej próbce, nie poza pomiarem.
    m.current(es[0].id); m.events(es[0].id); notifications++;
    times.push(performance.now() - before);
    if (batch % 300 === 0) { const heap = process.memoryUsage().heapUsed; peak = Math.max(peak, heap); trajectory.push({ at: end, heap }); }
  }
  const elapsed = performance.now() - start;
  gc!(); gc!(); const retained = process.memoryUsage().heapUsed - heapBase;
  return { count, seconds, trades: seconds * 300, batches: times.length, notifications, elapsedMs: elapsed,
    p95Ms: q(times, .95), p99Ms: q(times, .99), maxMs: Math.max(...times), over50ms: times.filter(x => x > 50).length,
    retainedMiB: retained / 1048576, sampledPeakMiB: (peak - heapBase) / 1048576, trajectory,
    journal: j.stats(), bins: j.bins.stats(), model: m.stats(), last: m.current(es[0].id) };
}
run(2, 30);
const primary = run(20, 3600), stress = run(64, 10800);
const result = { synthetic: true, version: process.version, platform: process.platform, gc: 'two explicit full GC before/after, sampled uncollected heap during run',
  includes: ['whitelist/dedup', 'raw retention', 'minute totals/exact histograms', 'L2 aggregation', 'all element accumulators', 'history snapshots', 'panel subscriber read'],
  excludes: ['existing non-SMC consumers', 'React commit/canvas paint (separate browser experiment)', 'network latency'],
  primary, stress, pass: primary.retainedMiB <= 64 && primary.p95Ms <= 20 };
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(result, null, 2));
console.log(JSON.stringify({ pass: result.pass, primary: { p95: primary.p95Ms, p99: primary.p99Ms, max: primary.maxMs, retainedMiB: primary.retainedMiB }, stress: { p95: stress.p95Ms, retainedMiB: stress.retainedMiB } }));
if (!result.pass) process.exitCode = 1;
