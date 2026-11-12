import type { CandlestickData, Time, UTCTimestamp, WhitespaceData } from 'lightweight-charts';
import { type FlowInput, deltaCandle } from '../core/flow';
import { PRO } from './theme';
import type { LegendPart } from './paneLegend';
import { fmtSignedVol } from '../../orderflow/renderer';
import { tr } from '../../../i18n';

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

/** Opis panelu przepływu (delta, CVD): liczba świecy niepełnej w kolorze niepełnej z dopiskiem, jak jej słupek. */
export function flowLegend(label: string, value: number | null, partial = false): LegendPart[] {
  if (value === null) return [{ text: label, color: PRO.ink3 }];
  if (partial) return [{ text: label, color: PRO.ink3 }, { text: `${fmtSignedVol(value)} ${tr('niepełna', 'partial')}`, color: PRO.incomplete }];
  return [
    { text: label, color: PRO.ink3 },
    { text: fmtSignedVol(value), color: value >= 0 ? PRO.buyInk : PRO.sellInk },
  ];
}

/** Delta świecy Hyperliquid do linii CVD giełd: null (przerwa) dla świecy bez taśmy albo niepełnej. */
export function hlDelta(b: FlowInput): number | null {
  return b.fp && b.complete !== false ? b.fp.delta : null;
}
