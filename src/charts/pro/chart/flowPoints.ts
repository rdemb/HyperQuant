import type { CandlestickData, Time, UTCTimestamp, WhitespaceData } from 'lightweight-charts';
import { type FlowInput, deltaCandle } from '../core/flow';
import { PRO } from './theme';

/**
 * Punkty paneli delty i CVD giełd ze świec wykresu. Świeca niepełna (luka w taśmie w trakcie świecy, `complete: false`)
 * jest w każdym panelu tak samo „niepełna”: delta wyszarzona (część świecy bez nagrania), CVD z przerwą.
 */

const sec = (t: number) => (t / 1000) as UTCTimestamp;

/** Świeca panelu delty: bez taśmy — puste miejsce, niepełna — w kolorze świecy niepełnej. */
export function deltaPoint(b: FlowInput): CandlestickData<Time> | WhitespaceData<Time> {
  if (!b.fp) return { time: sec(b.t) };
  const c = { time: sec(b.t), ...deltaCandle(b.fp) };
  return b.complete === false ? { ...c, color: PRO.incomplete, borderColor: PRO.incomplete, wickColor: PRO.incomplete } : c;
}

/** Delta świecy Hyperliquid do linii CVD giełd: null (przerwa) dla świecy bez taśmy albo niepełnej. */
export function hlDelta(b: FlowInput): number | null {
  return b.fp && b.complete !== false ? b.fp.delta : null;
}
