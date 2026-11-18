import type { FlowElement, FlowSnapshot } from '../core/smcOrderflow';
import type { SmcResult } from '../core/smcStructure';

export const flowId = (kind: FlowElement['kind'], t: number, known: number, dir: number): string => `${kind}:${t}:${known}:${dir}`;
export function flowElements(r: SmcResult, mitigation: 'wick' | 'close' = 'close'): FlowElement[] {
  return [
    ...r.obs.map(o => ({ id: flowId('ob', o.t, o.known, o.dir), kind: 'ob' as const, known: o.known,
      lo: o.lo, hi: o.hi, dir: o.dir, atr: r.atr[o.breakIdx], expiresAt: o.expiresAt, endAt: mitigation === 'wick' ? o.wickAt : o.closeAt })),
    ...r.fvgs.map(f => ({ id: flowId('fvg', f.t, f.known, f.dir), kind: 'fvg' as const, known: f.known,
      lo: f.lo, hi: f.hi, dir: f.dir, atr: r.atr[f.idx], expiresAt: f.expiresAt, endAt: f.filledAt, originFrom: f.t - 2 * r.ms })),
    ...r.sweeps.map(s => ({ id: flowId('sweep', s.t, s.known, s.dir), kind: 'sweep' as const, known: s.known,
      lo: s.level, hi: s.level, dir: s.dir, atr: r.atr[s.returnIdx], originFrom: s.t, expiresAt: s.known + Math.max(86400000, 24 * r.ms) })),
  ];
}
export type FlowAlignment = 'aligned' | 'divergent' | 'ambiguous' | 'unavailable';
export function flowAlignment(s: FlowSnapshot): FlowAlignment {
  if (!s.complete || s.since.volume <= 0 || !s.recent.some(c => c.complete && (c.result === 'retreat' || c.result === 'broken'))) return 'unavailable';
  const side = s.since.buy / s.since.volume >= .6 ? 1 : s.since.sell / s.since.volume >= .6 ? -1 : 0;
  if (!side || s.structure === 'mixed') return 'ambiguous';
  return side === (s.structure === 'up' ? 1 : -1) ? 'aligned' : 'divergent';
}
