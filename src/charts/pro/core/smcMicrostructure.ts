import type { ObservationJournal, ObservedPrint, ObservedDepth } from './smcObservation';

export interface SweepConfig { from: number; to?: number; boundary: number; outside: 1 | -1; maxGapMs: number }
export interface SweepExcursion {
  method: 'last-price-intervals-v1'; startAt: number | null; returnAt: number | null; observedAt: number;
  frozen: boolean; outsideMs: number; unknownMs: number; timeCoverage: number | null;
  observedUsd: number; observedOutsideUsd: number; outsideShare: number | null; complete: boolean;
}
/** Receipt-time gated, first excursion only. No candle or last-tick extrapolation. */
export function sweepExcursion(j: ObservationJournal, c: SweepConfig, asOf: number): SweepExcursion {
  const beyond = (p: ObservedPrint) => (p.px - c.boundary) * c.outside > 0;
  const rows = j.range(c.from, Math.min(c.to ?? asOf, asOf) + 1, asOf).filter(p => !p.late);
  const start = rows.findIndex(beyond);
  const returned = start < 0 ? undefined : rows.slice(start + 1).find(p => !beyond(p));
  const seenAt = returned?.observedAt ?? asOf;
  const contact = rows.filter(p => p.observedAt <= seenAt && (!returned || p.time <= returned.time && p.seq <= returned.seq));
  const excursion = start < 0 ? [] : contact.filter(p => p.time >= rows[start].time);
  let outsideMs = 0, unknownMs = 0;
  for (let i = 1; i < excursion.length; i++) {
    const a = excursion[i - 1], b = excursion[i], dt = b.time - a.time;
    if (dt > c.maxGapMs || !j.continuous(a.time, b.time, seenAt)) unknownMs += dt;
    else if (beyond(a)) outsideMs += dt;
  }
  const end = returned?.time ?? contact.at(-1)?.time ?? c.from;
  const complete = contact.length > 0 && j.complete(c.from, end, seenAt);
  let observedUsd = 0, observedOutsideUsd = 0;
  for (const p of contact) { const usd = p.px * p.sz; observedUsd += usd; if (beyond(p)) observedOutsideUsd += usd; }
  const duration = start < 0 ? 0 : end - rows[start].time;
  return { method: 'last-price-intervals-v1', startAt: start < 0 ? null : rows[start].time,
    returnAt: returned?.time ?? null, observedAt: seenAt, frozen: !!returned, outsideMs, unknownMs,
    timeCoverage: duration > 0 ? (duration - unknownMs) / duration : null,
    observedUsd, observedOutsideUsd, outsideShare: complete && observedUsd > 0 ? observedOutsideUsd / observedUsd : null, complete };
}

export interface NotionalConfig { from: number; to: number; lo: number; hi: number; dir: 1 | -1; atr: number; budgetUsd: number; complete: boolean }
export interface NotionalResult { budgetUsd: number; reachedAt: number | null; observedAt: number | null; attackUsd: number; overshootUsd: number | null; penetration: number | null; penetrationAtr: number | null }
export class NotionalTally {
  private attackUsd = 0;
  private penetration = 0;
  private hit: ObservedPrint | null = null;
  private lastAt = -Infinity;
  constructor(private readonly c: Pick<NotionalConfig, 'lo' | 'hi' | 'dir' | 'atr' | 'budgetUsd'>) {}
  add(p: ObservedPrint): void {
    if (this.hit) return;
    this.lastAt = p.time;
    const c = this.c;
    this.penetration = Math.max(this.penetration, c.dir === 1 ? c.hi - p.px : p.px - c.lo);
    if (p.side !== -c.dir) return;
    this.attackUsd += p.px * p.sz;
    if (this.attackUsd >= c.budgetUsd) this.hit = p;
  }
  read(complete: boolean, through = Infinity): NotionalResult {
    const c = this.c;
    const valid = complete && this.lastAt <= through && c.budgetUsd > 0 && c.atr > 0 && Number.isFinite(this.attackUsd);
    const hit = valid ? this.hit : null;
    return { budgetUsd: c.budgetUsd, reachedAt: hit?.time ?? null, observedAt: hit?.observedAt ?? null,
      attackUsd: valid ? this.attackUsd : 0, overshootUsd: hit ? this.attackUsd - c.budgetUsd : null,
      penetration: hit ? this.penetration : null, penetrationAtr: hit ? this.penetration / c.atr : null };
  }
}

export function equalNotional(rows: readonly ObservedPrint[], c: NotionalConfig, asOf: number): NotionalResult {
  const tally = new NotionalTally(c);
  if (!c.complete || c.to > asOf) return tally.read(false);
  const prints = rows.filter(p => p.time >= c.from && p.time <= c.to && p.observedAt <= asOf).sort((a, b) => a.time - b.time || a.seq - b.seq);
  if (prints.some(p => p.late)) return tally.read(false);
  for (const p of prints) tally.add(p);
  return tally.read(true);
}

export interface DepthConfig { hitAt: number; to?: number; side: 'bids' | 'asks'; lo: number; hi: number; maxGapMs: number; complete?: boolean }
export interface DepthRecovery {
  method: 'fixed-visible-prices-v1'; baselineAt: number | null; sampleAt: number | null; observedAt: number;
  baselineUsd: number | null; currentUsd: number | null; ratio: number | null; prices: number[];
  maxGapMs: number; range: [number, number] | null; reason: 'baseline' | 'range' | 'gap' | 'step' | 'no-sample' | null;
}
export function depthRecovery(rows: readonly ObservedDepth[], c: DepthConfig, asOf: number): DepthRecovery {
  const through = Math.min(c.to ?? asOf, asOf);
  const available = rows.filter(b => b.observedAt <= asOf && b.time <= through).sort((a, b) => a.time - b.time);
  const base = available.filter(b => b.time < c.hitAt && b.observedAt <= c.hitAt).at(-1);
  const out: DepthRecovery = { method: 'fixed-visible-prices-v1', baselineAt: base?.time ?? null, sampleAt: null, observedAt: asOf,
    baselineUsd: null, currentUsd: null, ratio: null, prices: [], maxGapMs: 0, range: null, reason: 'baseline' };
  if (c.complete === false) return { ...out, reason: 'gap' };
  if (!base || c.hitAt - base.time > c.maxGapMs) return out;
  const levels = base[c.side], min = Math.min(...levels.map(p => p.px)), max = Math.max(...levels.map(p => p.px));
  if (min > c.lo || max < c.hi) return { ...out, reason: 'range' };
  out.prices = levels.filter(p => p.px >= c.lo && p.px <= c.hi).map(p => p.px);
  out.baselineUsd = levels.filter(p => out.prices.includes(p.px)).reduce((s, p) => s + p.px * p.sz, 0);
  if (!out.prices.length || out.baselineUsd <= 0) return out;
  const samples = available.filter(b => b.time >= c.hitAt);
  if (!samples.length) return { ...out, reason: 'no-sample' };
  let previous = base.time, reason: DepthRecovery['reason'] = null;
  for (const b of samples) {
    const ps = b[c.side], lo = Math.min(...ps.map(p => p.px)), hi = Math.max(...ps.map(p => p.px));
    out.maxGapMs = Math.max(out.maxGapMs, b.time - previous); previous = b.time;
    if (b.step !== base.step) reason = 'step';
    else if (lo > c.lo || hi < c.hi) reason ??= 'range';
    out.sampleAt = b.time; out.range = ps.length ? [lo, hi] : null;
    out.currentUsd = out.prices.reduce((s, px) => s + px * (ps.find(p => p.px === px)?.sz ?? 0), 0);
  }
  out.maxGapMs = Math.max(out.maxGapMs, through - previous);
  if (out.maxGapMs > c.maxGapMs) reason ??= 'gap';
  return { ...out, reason, currentUsd: reason ? null : out.currentUsd, ratio: reason ? null : out.currentUsd! / out.baselineUsd };
}

export interface ControlFeatures { id: string; knownAt: number; selectedAt: number; widthAtr: number; distanceAtr: number; volatility: number }
export type ControlTolerance = Pick<ControlFeatures, 'widthAtr' | 'distanceAtr' | 'volatility'>;
/** Candidates must be ordinary levels supplied by the caller, never selected using outcome fields. */
export function selectControl(target: ControlFeatures, candidates: readonly ControlFeatures[], tolerance: ControlTolerance): ControlFeatures | null {
  const keys = ['widthAtr', 'distanceAtr', 'volatility'] as const;
  if (target.knownAt > target.selectedAt || keys.some(k => !Number.isFinite(target[k]) || !(tolerance[k] > 0))) return null;
  const score = (c: ControlFeatures) => keys.reduce((s, k) => s + Math.abs(c[k] - target[k]) / tolerance[k], 0);
  const matches = candidates.filter(c => c.id !== target.id && c.knownAt <= target.selectedAt && c.selectedAt <= target.selectedAt &&
    keys.every(k => Number.isFinite(c[k]) && Math.abs(c[k] - target[k]) <= tolerance[k]));
  return matches.sort((a, b) => score(a) - score(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0] ?? null;
}
export interface ReactionPair { selectedAt: number; smc: { endAt: number; observedAt: number; reactionAtr: number }; control: { endAt: number; observedAt: number; reactionAtr: number } }
export function compareReactions(pairs: readonly ReactionPair[], asOf: number) {
  const valid = pairs.filter(p => [p.smc, p.control].every(r => r.endAt > p.selectedAt && r.observedAt >= r.endAt && r.observedAt <= asOf && Number.isFinite(r.reactionAtr)));
  const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  return { method: 'paired-terminal-reaction-v1' as const, n: valid.length, pending: pairs.length - valid.length,
    smcAtr: mean(valid.map(p => p.smc.reactionAtr)), controlAtr: mean(valid.map(p => p.control.reactionAtr)),
    differenceAtr: mean(valid.map(p => p.smc.reactionAtr - p.control.reactionAtr)) };
}
