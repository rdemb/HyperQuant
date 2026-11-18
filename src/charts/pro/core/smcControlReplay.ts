import type { ObservedPrint } from './smcObservation';
import type { SBar } from './smcStructure';
import { selectControl } from './smcMicrostructure';

export interface ControlZone { lo: number; hi: number }
export interface TrialConfig { selectedAt: number; horizonMs: number; atr: number; dir: 1 | -1; target: ControlZone; control: ControlZone | null; maxGapMs: number }
interface Reaction { from: number | null; startPx: number; last: ObservedPrint | null; value: number | null; observedAt: number | null; invalid: boolean }
export interface ControlComparison {
  method: 'ordinary-level-contact-v1'; selectedAt: number; horizonMs: number; control: ControlZone | null;
  n: number; nSmc: number; nControl: number; smcAtr: number | null; controlAtr: number | null; differenceAtr: number | null;
  smcFrom: number | null; controlFrom: number | null; observedAt: number; incomplete: boolean;
}
/** Geometrical control fixed before any subsequent contact, not a fitted or random baseline. */
export function ordinaryControl(e: ControlZone & { atr: number }, bars: readonly SBar[], ms: number, selectedAt: number): ControlZone | null {
  if (!(e.atr > 0)) return null;
  const closed = bars.filter(b => b.t + ms <= selectedAt).slice(-24), last = closed.at(-1);
  if (!last || closed.length < 2) return null;
  const width = e.hi - e.lo, mid = (e.hi + e.lo) / 2, ref = last.c;
  const rv = Math.sqrt(closed.reduce((s, b) => s + (b.c - b.o) ** 2, 0) / closed.length) / e.atr;
  const target = { id: 'target', knownAt: selectedAt, selectedAt, widthAtr: width / e.atr, distanceAtr: Math.abs(mid - ref) / e.atr, volatility: rv };
  const zones = closed.flatMap(b => [b.h, b.l].map((px, i) => ({ id: `${b.t}:${i}`, knownAt: b.t + ms, selectedAt,
    widthAtr: width / e.atr, distanceAtr: Math.abs(px - ref) / e.atr, volatility: rv, lo: px - width / 2, hi: px + width / 2 })));
  const candidates = zones.filter(z => z.hi < e.lo || z.lo > e.hi);
  const chosen = selectControl(target, candidates, { widthAtr: .01, distanceAtr: .25, volatility: .01 });
  const zone = candidates.find(z => z.id === chosen?.id);
  return zone ? Object.freeze({ lo: zone.lo, hi: zone.hi }) : null;
}
export class LevelControlTrial {
  private readonly smc: Reaction = { from: null, startPx: 0, last: null, value: null, observedAt: null, invalid: false };
  private readonly control: Reaction = { ...this.smc };
  private lastSeq = -1;
  private seenAt: number;
  private invalid = false;
  readonly config: TrialConfig;
  constructor(config: TrialConfig) {
    this.config = Object.freeze({ ...config, target: Object.freeze({ ...config.target }), control: config.control && Object.freeze({ ...config.control }) });
    this.seenAt = config.selectedAt;
  }
  observe(rows: readonly ObservedPrint[], asOf: number, complete: boolean): boolean {
    if (this.smc.value !== null && (this.control.value !== null || !this.config.control)) return false;
    let changed = !this.invalid && !complete;
    if (changed) this.seenAt = asOf;
    this.invalid ||= !complete;
    for (const p of rows) {
      if (p.seq <= this.lastSeq || p.observedAt > asOf || p.time > asOf || p.time < this.config.selectedAt) continue;
      this.lastSeq = p.seq;
      if (p.late) {
        if (!this.invalid) { changed = true; this.seenAt = Math.max(this.seenAt, p.observedAt); }
        this.invalid = true;
        continue;
      }
      const smcChanged = this.observeOne(this.smc, this.config.target, p);
      const controlChanged = this.config.control && this.observeOne(this.control, this.config.control, p);
      if (smcChanged || controlChanged) {
        changed = true;
        this.seenAt = Math.max(this.seenAt, p.observedAt);
      }
    }
    return changed;
  }
  private observeOne(r: Reaction, zone: ControlZone, p: ObservedPrint): boolean {
    if (r.value !== null || r.invalid) return false;
    if (this.invalid) { r.invalid = true; return true; }
    const started = r.from === null && p.px >= zone.lo && p.px <= zone.hi;
    if (started) { r.from = p.time; r.startPx = p.px; }
    if (r.from === null) return false;
    const end = r.from + this.config.horizonMs, previous = r.last;
    if (previous && p.time - previous.time > this.config.maxGapMs) { r.invalid = true; return true; }
    if (p.time >= end) {
      const endpoint = p.time === end ? p : previous;
      if (!endpoint || end - endpoint.time > this.config.maxGapMs || !(this.config.atr > 0)) { r.invalid = true; return true; }
      r.value = (endpoint.px - r.startPx) * this.config.dir / this.config.atr; r.observedAt = p.observedAt;
      return true;
    }
    r.last = p;
    return started;
  }
  snapshot(): ControlComparison {
    const smc = this.smc.value, control = this.control.value;
    return { method: 'ordinary-level-contact-v1', selectedAt: this.config.selectedAt, horizonMs: this.config.horizonMs,
      control: this.config.control, n: smc !== null && control !== null ? 1 : 0, nSmc: smc !== null ? 1 : 0, nControl: control !== null ? 1 : 0,
      smcAtr: smc, controlAtr: control, differenceAtr: smc !== null && control !== null ? smc - control : null,
      smcFrom: this.smc.from, controlFrom: this.control.from, observedAt: this.seenAt, incomplete: this.invalid || this.smc.invalid || this.control.invalid };
  }
}
