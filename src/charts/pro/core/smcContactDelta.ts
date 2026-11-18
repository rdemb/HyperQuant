import type { ObservationJournal, ObservedPrint } from './smcObservation';

export const SMC_CONTACT_BINS_MAX = 16;
export interface ContactDeltaBin { lo: number; hi: number; turnoverUsd: number; deltaUsd: number }
export type ContactProfileStatus = 'complete' | 'coverage' | 'retention';
interface ContactIdentity { ordinal: number; active: boolean }
export type ContactProfile = ContactIdentity & (
  | { status: 'complete'; bins: ContactDeltaBin[]; turnoverUsd: number; deltaUsd: number }
  | { status: 'coverage' | 'retention'; bins: []; turnoverUsd: null; deltaUsd: null }
);
export interface ContactProfiles { current: ContactProfile; previous: ContactProfile | null }
interface ContactGrid { lo: number; hi: number; step: number; count: number; zoneLo: number; zoneHi: number }

export function contactGrid(lo: number, hi: number, tick: number): ContactGrid {
  const minStep = Number.isFinite(tick) && tick > 0 ? tick : (hi - lo) / SMC_CONTACT_BINS_MAX || 1;
  if (lo === hi) return { lo: lo - minStep / 2, hi: hi + minStep / 2, step: minStep, count: 1, zoneLo: lo, zoneHi: hi };
  const ticksPerBin = Math.max(1, Math.ceil((hi - lo) / minStep / SMC_CONTACT_BINS_MAX - 1e-9));
  const step = ticksPerBin * minStep;
  return { lo, hi, step, count: Math.min(SMC_CONTACT_BINS_MAX, Math.max(1, Math.ceil((hi - lo) / step - 1e-9))), zoneLo: lo, zoneHi: hi };
}

/** Suma na żywo przeżywa retencję taśmy. Prefiks wcześniejszy niż ostatni druk wymaga zachowanych sekwencji. */
export class ContactDeltaTally {
  private readonly amounts: Float64Array;
  private last: ObservedPrint;
  private invalidAt = Infinity;
  private prefix: { at: number; amounts: Float64Array } | null = null;
  private readonly firstSequence: number;

  constructor(private readonly grid: ContactGrid, first: ObservedPrint) {
    this.firstSequence = first.seq;
    this.last = first;
    this.amounts = new Float64Array(grid.count * 2);
  }

  private increment(amounts: Float64Array, t: ObservedPrint): boolean {
    const index = Math.min(this.grid.count - 1, Math.max(0, Math.floor((t.px - this.grid.lo) / this.grid.step + 1e-9)));
    const slot = index * 2 + (t.side === 1 ? 0 : 1);
    const value = amounts[slot] + t.px * t.sz;
    if (!Number.isFinite(value)) return false;
    amounts[slot] = value;
    return true;
  }

  add(t: ObservedPrint): void {
    if (!this.increment(this.amounts, t)) this.invalidate(t.observedAt);
    this.last = t;
  }

  invalidate(at: number): void { this.invalidAt = Math.min(this.invalidAt, at); }

  read(identity: ContactIdentity, journal: ObservationJournal, at: number, complete: boolean): ContactProfile {
    const unavailable = (status: 'coverage' | 'retention'): ContactProfile =>
      ({ ...identity, status, bins: [], turnoverUsd: null, deltaUsd: null });
    if (!complete || this.invalidAt <= at) return unavailable('coverage');
    let amounts = this.amounts;
    if (at < this.last.observedAt) {
      if (this.prefix?.at === at) amounts = this.prefix.amounts;
      else {
        const rows = journal.sequenceRange(this.firstSequence, this.last.seq);
        if (!rows) return unavailable('retention');
        amounts = new Float64Array(this.grid.count * 2);
        for (const t of rows) {
          if (t.observedAt > at) break;
          if (!t.late && t.px >= this.grid.zoneLo && t.px <= this.grid.zoneHi && !this.increment(amounts, t)) return unavailable('coverage');
        }
        this.prefix = { at, amounts };
      }
    }
    let turnoverUsd = 0, deltaUsd = 0;
    const { lo, hi, step, count } = this.grid;
    const bins = Array.from({ length: count }, (_, i) => {
      const buy = amounts[i * 2], sell = amounts[i * 2 + 1];
      const turnover = buy + sell, delta = buy - sell;
      turnoverUsd += turnover;
      deltaUsd += delta;
      return { lo: lo + i * step, hi: i === count - 1 ? hi : lo + (i + 1) * step, turnoverUsd: turnover, deltaUsd: delta };
    });
    if (!Number.isFinite(turnoverUsd) || !Number.isFinite(deltaUsd)) return unavailable('coverage');
    return { ...identity, status: 'complete', bins, turnoverUsd, deltaUsd };
  }
}
