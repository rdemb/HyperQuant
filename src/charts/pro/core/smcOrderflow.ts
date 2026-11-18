import type { ObservationJournal, ObservedPrint } from './smcObservation';
import { addFlow, emptyFlow, printFlow } from './smcObservationBins';
import type { FlowTotal } from './smcObservationBins';
import type { Dir, SBar, StructureState } from './smcStructure';

export interface FlowElement {
  id: string; kind: 'ob' | 'fvg' | 'sweep'; known: number; lo: number; hi: number; dir: Dir;
  atr: number; expiresAt: number; endAt?: number | null; originFrom?: number;
}
export type Defense = 'first' | 'weakening' | 'absorption' | 'mixed' | 'unknown';
export interface Contact {
  from: number; observedAt: number; endedAt: number | null; result: 'active' | 'retreat' | 'broken' | 'expired';
  attack: number; penetration: number; rebound: number; extreme: number; complete: boolean;
  flow: FlowTotal;
}
export interface FvgProfile {
  from: number; to: number; totalUsd: number | null; insideUsd: number | null; share: number | null; delta: number | null;
  flowReferences: number; depthReferences: number; volumeP80: number | null; depthP20: number | null;
  depthUsd: number | null; step: number | null; strongFlow: boolean | null; lowLiquidity: boolean | null;
  impulseShare: number | null;
}
export interface FlowSnapshot {
  version: 'smc-orderflow-v1';
  intervalMs: number;
  id: string; kind: FlowElement['kind']; lo: number; hi: number; dir: Dir; atr: number; knownAt: number; observedAt: number;
  structure: StructureState; anchor: number | null; complete: boolean; reason: 'before-observation' | 'gap' | 'buffer' | null;
  contacts: number; completed: number; defense: Defense; recent: Contact[]; zone: FlowTotal; since: FlowTotal;
  sweep: { state: 'observing' | 'initiative' | 'return-only' | 'beyond' | 'unknown'; retest: number | null; closes: number; bars: number; lastClose: number | null; flow: FlowTotal | null; above: FlowTotal | null; below: FlowTotal | null } | null;
  fvg: FvgProfile | null; ended: boolean; endReason: 'filled' | 'mitigated' | 'expired' | null;
}
export type FlowEventKind = 'formation' | 'contact' | 'contact-end' | 'defense' | 'sweep' | 'retest' | 'profile' | 'metrics' | 'gap' | 'structure' | 'filled' | 'mitigated' | 'expired' | 'late';
export interface FlowEvent { kind: FlowEventKind; observedAt: number; exchangeAt: number; snapshot: FlowSnapshot }
interface Entry { element: FlowElement; state: FlowSnapshot; history: FlowEvent[]; seq: number; barThrough: number; metricAt: number; gapAt: number; lastPx: number | null; armed: boolean }
const clone = (s: FlowSnapshot): FlowSnapshot => ({ ...s, recent: s.recent.map(x => ({ ...x, flow: { ...x.flow } })), zone: { ...s.zone }, since: { ...s.since }, sweep: s.sweep && { ...s.sweep, flow: s.sweep.flow && { ...s.sweep.flow }, above: s.sweep.above && { ...s.sweep.above }, below: s.sweep.below && { ...s.sweep.below } }, fvg: s.fvg && { ...s.fvg } });
const quantile = (xs: number[], q: number): number | null => xs.length < 20 ? null : [...xs].sort((a, b) => a - b)[Math.ceil(q * xs.length) - 1];

export function formationProfile(j: ObservationJournal, e: FlowElement, ms: number, now: number): FvgProfile {
  const from = e.originFrom ?? e.known - 3 * ms, to = e.known;
  const total = j.flow(from, to, now), inside = j.flow(from, to, now, e);
  const depth = now >= j.observedNow && j.continuous(from, to, now) ? j.bins.depth(from, to, e) : null;
  const volumes: number[] = [], depths: number[] = [];
  for (let i = 0; i < 60; i++) {
    const end = from - i * ms, start = end - 3 * ms;
    const f = j.flow(start, end, now); if (f) volumes.push(f.buyUsd + f.sellUsd);
    const d = now >= j.observedNow && j.continuous(start, end, now) ? j.bins.depth(start, end, e) : null;
    if (d && depth && d.step === depth.step) depths.push(d.usd);
  }
  const p80 = quantile(volumes, .8), p20 = quantile(depths, .2), usd = total ? total.buyUsd + total.sellUsd : null;
  const directional = total ? (e.dir === 1 ? total.buyUsd : total.sellUsd) : 0;
  return { from, to, totalUsd: usd, insideUsd: inside ? inside.buyUsd + inside.sellUsd : null,
    share: usd && inside ? (inside.buyUsd + inside.sellUsd) / usd : null, delta: total?.delta ?? null,
    flowReferences: volumes.length, depthReferences: depths.length, volumeP80: p80, depthP20: p20,
    depthUsd: depth?.usd ?? null, step: depth?.step ?? null, impulseShare: usd && total ? directional / usd : null,
    strongFlow: usd !== null && usd > 0 && p80 !== null ? usd >= p80 && directional / usd >= .6 : null,
    lowLiquidity: depth && p20 !== null ? depth.usd <= p20 : null };
}

/** Stan obserwowany, nie rekonstrukcja przepływu ze świec. Jeden model na widok, wspólny dziennik na rynek. */
export class SmcOrderflow {
  private readonly entries = new Map<string, Entry>();
  private correction = 0;
  constructor(readonly journal: ObservationJournal, readonly ms = 300000, readonly tick: number | ((price: number) => number) = .1) {}
  private tickAt(price: number): number { const tick = typeof this.tick === 'number' ? this.tick : this.tick(price); return tick > 0 && Number.isFinite(tick) ? tick : Infinity; }
  private event(r: Entry, kind: FlowEventKind, observedAt: number, exchangeAt: number): void {
    const at = Math.max(r.state.observedAt, observedAt);
    r.state.observedAt = at;
    const snapshot = clone(r.state);
    Object.freeze(snapshot.zone); Object.freeze(snapshot.since);
    for (const c of snapshot.recent) { Object.freeze(c.flow); Object.freeze(c); }
    Object.freeze(snapshot.recent); if (snapshot.sweep) { for (const v of [snapshot.sweep.flow, snapshot.sweep.above, snapshot.sweep.below]) if (v) Object.freeze(v); Object.freeze(snapshot.sweep); } if (snapshot.fvg) Object.freeze(snapshot.fvg);
    Object.freeze(snapshot);
    r.history.push(Object.freeze({ kind, observedAt: at, exchangeAt, snapshot }));
    if (r.history.length > 256) {
      let lastChange = r.history.length - 1;
      while (lastChange >= 0 && r.history[lastChange].kind === 'metrics') lastChange--;
      r.history.splice(lastChange === 0 ? 1 : 0, 1);
    }
  }
  update(elements: readonly FlowElement[], bars: readonly SBar[], structure: StructureState, now: number): void {
    now = Math.max(now, this.journal.observedNow);
    const incoming = elements.filter(e => e.known <= now).slice(0, 64);
    for (const e of incoming) {
      let r = this.entries.get(e.id);
      if (!r) {
        if (this.entries.size >= 64) this.entries.delete(this.entries.keys().next().value!);
        const available = this.journal.complete(e.known, now, now);
        const state: FlowSnapshot = { version: 'smc-orderflow-v1', intervalMs: this.ms, id: e.id, kind: e.kind, lo: e.lo, hi: e.hi, dir: e.dir, atr: e.atr, knownAt: e.known,
          observedAt: now, structure, anchor: null, complete: available, reason: available ? null : 'before-observation',
          contacts: 0, completed: 0, defense: 'first', recent: [], zone: emptyFlow(), since: emptyFlow(),
          sweep: e.kind === 'sweep' ? { state: 'observing', retest: null, closes: 0, bars: 0, lastClose: null, flow: null, above: null, below: null } : null,
          fvg: e.kind === 'fvg' ? formationProfile(this.journal, e, this.ms, now) : null, ended: false, endReason: null };
        r = { element: e, state, history: [], seq: available ? 0 : this.journal.sequence, barThrough: e.known, metricAt: now, gapAt: this.journal.gaps().at(-1)?.id ?? 0, lastPx: null, armed: true };
        this.entries.set(e.id, r); this.event(r, 'formation', now, e.known);
      } else r.element = { ...r.element, endAt: e.endAt, expiresAt: Math.min(r.element.expiresAt, e.expiresAt) };
    }
    // Każdy pakiet jest pobierany raz. Akumulatory kontaktu przeżywają usunięcie surowych ticków.
    const minSeq = Math.min(...[...this.entries.values()].map(r => r.seq));
    const trades = this.entries.size ? this.journal.tradesAfter(Number.isFinite(minSeq) ? minSeq : this.journal.sequence) : [];
    const corrections = this.journal.correctionsAfter(this.correction);
    const correctionOverflow = corrections.length > 0 && corrections[0].id > this.correction + 1;
    for (const r of this.entries.values()) {
      const e = r.element, s = r.state;
      const profileDirty = correctionOverflow || corrections.some(c => c.time < e.known && c.time >= (e.originFrom ?? e.known - 3 * this.ms) - 63 * this.ms);
      const eventCount = r.history.length;
      if (trades.length && trades[0].seq > r.seq + 1 && (r.seq > 0 || e.known <= this.journal.stats().retainedAfter)) {
        s.complete = false; s.reason = 'buffer'; s.defense = 'unknown'; r.armed = false;
        for (const c of s.recent) c.complete = false;
        this.event(r, 'gap', now, now);
      }
      if (s.ended) {
        for (const gap of this.journal.gaps()) if (gap.id > r.gapAt && gap.from < Math.min(e.endAt ?? Infinity, e.expiresAt) && gap.observedAt >= e.known) {
          s.complete = false; s.reason = 'gap'; s.defense = 'unknown';
          for (const c of s.recent) c.complete = false;
          this.event(r, 'gap', gap.observedAt, gap.from);
        }
        r.gapAt = this.journal.gaps().at(-1)?.id ?? r.gapAt;
        const late = trades.filter(t => t.seq > r.seq && t.time >= e.known && t.time < Math.min(e.expiresAt, e.endAt ?? Infinity));
        for (const t of late) this.print(r, { ...t, late: true });
        if (late.length) this.event(r, 'late', now, late.at(-1)!.time);
        if (profileDirty) this.refreshProfile(r, now);
        if (s.sweep && corrections.some(c => c.time >= e.known && c.time < e.known + 3 * this.ms)) this.finishSweep(r, now);
        r.seq = this.journal.sequence; continue;
      }
      if (s.structure !== structure) { s.structure = structure; this.event(r, 'structure', now, now); }
      for (const gap of this.journal.gaps()) if (gap.id > r.gapAt && gap.observedAt >= e.known) {
        s.complete = false; s.reason = 'gap'; s.defense = 'unknown'; r.armed = false;
        const active = s.recent.at(-1); if (active?.result === 'active') active.complete = false;
        this.event(r, 'gap', gap.observedAt, gap.from);
      }
      r.gapAt = this.journal.gaps().at(-1)?.id ?? r.gapAt;
      const closed: SBar[] = [];
      for (let i = bars.length - 1; i >= 0; i--) {
        const b = bars[i]; if (b.t + this.ms <= r.barThrough) break;
        if (b.t >= e.known && b.t + this.ms <= now) closed.push(b);
      }
      closed.reverse(); let bi = 0;
      const closeThrough = (through: number) => { while (bi < closed.length && closed[bi].t + this.ms <= through) {
        const b = closed[bi++]; this.bar(r, b, now); r.barThrough = b.t + this.ms;
      } };
      let lastLate: ObservedPrint | null = null;
      for (const t of trades) if (t.seq > r.seq && t.time >= e.known && t.observedAt <= now) {
        closeThrough(t.time);
        if (t.time < Math.min(e.expiresAt, e.endAt ?? Infinity)) { const row = t.late || t.time < r.barThrough ? { ...t, late: true } : t; this.print(r, row); if (row.late) lastLate = row; }
      }
      closeThrough(now); r.seq = this.journal.sequence;
      if (lastLate) this.event(r, 'late', lastLate.observedAt, lastLate.time);
      if (profileDirty) this.refreshProfile(r, now);
      if (s.sweep && now >= e.known + 3 * this.ms && (s.sweep.state === 'observing' || correctionOverflow || corrections.some(c => c.time >= e.known && c.time < e.known + 3 * this.ms))) this.finishSweep(r, now);
      if (now >= e.expiresAt || e.endAt != null && now >= e.endAt) {
        const c = s.recent.at(-1); if (c?.result === 'active') this.endContact(r, 'expired', now, now);
        s.ended = true; s.endReason = e.endAt != null && e.endAt <= now && e.endAt <= e.expiresAt ? (e.kind === 'fvg' ? 'filled' : 'mitigated') : 'expired';
        this.event(r, s.endReason, now, Math.min(e.endAt ?? Infinity, e.expiresAt));
      }
      if (s.anchor !== null && (now - r.metricAt >= 10000 || r.history.length !== eventCount)) { this.event(r, 'metrics', now, now); r.metricAt = now; }
      s.observedAt = Math.max(s.observedAt, now);
    }
    this.correction = this.journal.revision;
  }
  private print(r: Entry, t: ObservedPrint): void {
    const e = r.element, s = r.state;
    const tick = this.tickAt(e.lo);
    const inside = t.px >= e.lo && t.px <= e.hi;
    let anchored = false;
    if (t.late) {
      if (s.anchor !== null && t.time >= s.anchor) { const f = printFlow(t); addFlow(s.since, f); if (inside) addFlow(s.zone, f); }
      for (const c of s.recent) if (t.time >= c.from && t.time <= (c.endedAt ?? Infinity)) c.complete = false;
      s.defense = 'unknown'; return;
    }
    if (s.sweep && s.sweep.retest === null && r.lastPx !== null && Math.abs(r.lastPx - e.lo) > tick && Math.abs(t.px - e.lo) <= tick) {
      s.sweep.retest = t.time; this.event(r, 'retest', t.observedAt, t.time);
    }
    r.lastPx = t.px;
    if (s.anchor === null && (inside || s.sweep?.retest === t.time)) {
      s.anchor = t.time; s.complete = s.reason !== 'buffer' && s.reason !== 'gap' && this.journal.continuous(t.time, t.time, t.observedAt); s.reason = s.complete ? null : s.reason ?? 'gap';
      anchored = true;
    }
    if (s.anchor !== null && t.time >= s.anchor) {
      const flow = printFlow(t); addFlow(s.since, flow); if (inside) addFlow(s.zone, flow);
    }
    if (e.kind !== 'ob') { if (anchored) this.event(r, 'contact', t.observedAt, t.time); return; }
    let c = s.recent.at(-1);
    let started = false;
    const retreat = (e.dir === 1 ? t.px - e.hi : e.lo - t.px) >= .25 * e.atr && e.atr > 0;
    if (c?.result !== 'active' && !inside) r.armed = true;
    if ((!c || c.result !== 'active') && inside && r.armed) {
      c = { from: t.time, observedAt: t.observedAt, endedAt: null, result: 'active', attack: 0, penetration: 0, rebound: 0,
        extreme: t.px, complete: this.journal.continuous(t.time, t.time, t.observedAt), flow: emptyFlow() }; s.recent.push(c); if (s.recent.length > 3) s.recent.shift(); s.contacts++; r.armed = false;
      started = true;
    }
    if (!c || c.result !== 'active' || t.time < c.from) return;
    if (inside) { addFlow(c.flow, printFlow(t)); if (t.side === -e.dir) c.attack += t.sz; }
    const previousExtreme = c.extreme;
    c.extreme = e.dir === 1 ? Math.min(c.extreme, t.px) : Math.max(c.extreme, t.px);
    if (c.extreme !== previousExtreme) c.rebound = 0;
    c.penetration = Math.max(c.penetration, e.dir === 1 ? e.hi - c.extreme : c.extreme - e.lo);
    c.rebound = Math.max(c.rebound, (t.px - c.extreme) * e.dir);
    if (started) this.event(r, 'contact', t.observedAt, t.time);
    if (retreat) { this.endContact(r, 'retreat', t.observedAt, t.time); r.armed = true; }
  }
  private endContact(r: Entry, result: Contact['result'], observedAt: number, exchangeAt: number): void {
    const s = r.state, c = s.recent.at(-1); if (!c || c.result !== 'active') return;
    c.result = result; c.endedAt = exchangeAt; c.complete &&= this.journal.continuous(c.from, exchangeAt, observedAt);
    s.completed++;
    const completed = s.recent.filter(x => x.result !== 'active'); const [a, b] = completed.slice(-2);
    const cmp = (x: number) => Math.abs(x) < 2 * this.tickAt(r.element.lo) ? 0 : Math.sign(x);
    const validScale = Number.isFinite(r.element.atr) && r.element.atr > 0 && Number.isFinite(this.tickAt(r.element.lo));
    s.defense = !b ? 'first' : !validScale || !a.complete || !b.complete || a.result === 'expired' || b.result === 'expired' ? 'unknown' :
      cmp(b.penetration - a.penetration) > 0 && cmp(b.rebound - a.rebound) < 0 && b.attack <= a.attack ? 'weakening' :
      b.attack > a.attack && cmp(b.penetration - a.penetration) <= 0 && cmp(b.rebound - a.rebound) >= 0 ? 'absorption' : 'mixed';
    this.event(r, 'contact-end', observedAt, exchangeAt); if (b) this.event(r, 'defense', observedAt, exchangeAt);
  }
  private bar(r: Entry, b: SBar, now: number): void {
    const e = r.element, s = r.state, end = b.t + this.ms, c = s.recent.at(-1);
    if (c?.result === 'active') {
      if ((e.dir === 1 ? b.c < e.lo : b.c > e.hi)) this.endContact(r, 'broken', now, end);
      else if (end - Math.ceil(c.from / this.ms) * this.ms >= 6 * this.ms) this.endContact(r, 'expired', now, end);
    }
    if (s.sweep && end <= e.known + 3 * this.ms) {
      s.sweep.bars++;
      s.sweep.closes += (b.c - e.lo) * e.dir < 0 ? 1 : 0;
      if (end === e.known + 3 * this.ms) {
        s.sweep.lastClose = b.c; this.finishSweep(r, now);
      }
    }
  }
  private refreshProfile(r: Entry, now: number): void {
    if (r.element.kind !== 'fvg') return;
    const f = formationProfile(this.journal, r.element, this.ms, now);
    if (JSON.stringify(f) !== JSON.stringify(r.state.fvg)) { r.state.fvg = f; this.event(r, 'profile', now, r.element.known); }
  }
  private finishSweep(r: Entry, now: number): void {
    const e = r.element, w = r.state.sweep; if (!w) return;
    const before = JSON.stringify(w), end = e.known + 3 * this.ms;
    const f = this.journal.flow(e.known, end, now);
    w.flow = f;
    w.above = this.journal.flow(e.known, end, now, { lo: e.lo, hi: Infinity });
    w.below = this.journal.flow(e.known, end, now, { lo: -Infinity, hi: e.lo - this.tickAt(e.lo) / 2 });
    w.state = !f || w.bars !== 3 || w.lastClose === null ? 'unknown' : (w.lastClose - e.lo) * e.dir > 0 ? 'beyond' :
      w.closes >= 2 && (e.dir === 1 ? f.sell > f.buy : f.buy > f.sell) ? 'initiative' : 'return-only';
    if (before !== JSON.stringify(w)) this.event(r, 'sweep', now, end);
  }
  current(id: string): FlowSnapshot | null { const s = this.entries.get(id)?.state; return s ? clone(s) : null; }
  events(id: string): readonly FlowEvent[] { return this.entries.get(id)?.history.slice() ?? []; }
  at(id: string, observedAt: number): FlowSnapshot | null {
    const r = this.entries.get(id); if (!r) return null;
    if (observedAt >= r.state.observedAt) return clone(r.state);
    for (let i = r.history.length - 1; i >= 0; i--) if (r.history[i].observedAt <= observedAt) return clone(r.history[i].snapshot);
    return null;
  }
  list(): FlowSnapshot[] { return [...this.entries.values()].map(r => clone(r.state)); }
  stats(): { elements: number; events: number } { return { elements: this.entries.size, events: [...this.entries.values()].reduce((n, r) => n + r.history.length, 0) }; }
}
