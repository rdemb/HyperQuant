import type { IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { tr } from '../../../i18n';
import { DASH, numLang } from '../../../ui/format';
import { fmtVol } from '../../orderflow/footprint';
import type { BookFrame } from '../core/book';
import type { Coverage } from '../core/coverage';
import { rangeProfileStep, SMC_PROFILE_ROW_PX, SmcRangeProfile, usdFromMicros, type ProfileSpan, type RangeProfileRow } from '../core/smcRangeProfile';
import { priceBuckets, RangeVisits, priceReaction, type PriceBucket, type PriceReaction, type ProfileVisit } from '../core/smcRangeProfileFlow';
import type { Tape } from '../core/tape';
import { MONO, PRO, rgba } from './theme';

export interface RangeProfileInfo extends ProfileSpan {
  step: number;
  levels: number;
  coverage: number;
  reaction: (PriceReaction & PriceBucket) | null;
}

const REFRESH_MS = 250;
const HEADER_PX = 17;
const COMPACT_HEADER_PX = 30;
const COMPACT_ROW_PX = 24;
export const rangeProfileWidth = (compact: boolean): number => compact ? 120 : 246;

interface DrawRow extends PriceBucket {
  top: number;
  bottom: number;
  labelY: number;
  turnoverUsd: number;
  deltaUsd: number;
}

export function rangeProfileLabel(usd: number | null, signed: boolean): string {
  if (usd === null || !Number.isFinite(usd)) return DASH;
  if (usd === 0) return '0';
  const abs = Math.abs(usd);
  const value = abs < .01 ? numLang('<0.01') : abs >= 1e9 ? numLang(`${(abs / 1e9).toFixed(2)}B`) : fmtVol(abs);
  return (usd < 0 ? '−' : signed ? '+' : '') + value;
}

export function rangeProfileRows(
  rows: readonly RangeProfileRow[], step: number, height: number, yOf: (price: number) => number | null, headerTop = 0, compact = false
): DrawRow[] {
  const start = headerTop + (compact ? COMPACT_HEADER_PX : HEADER_PX);
  const half = compact ? COMPACT_ROW_PX / 2 : 6;
  if (height < start + 2 * half) return [];
  const yOfLabel = (top: number, bottom: number) => Math.max(start + half, Math.min(height - half, (top + bottom) / 2));
  type ProjectedRow = Omit<DrawRow, 'deltaUsd'> & Pick<RangeProfileRow, 'deltaMicros'>;
  const visible: ProjectedRow[] = [];
  for (const { price, turnoverUsd, deltaMicros } of rows) {
    const a = yOf(price), b = yOf(price + step);
    if (a === null || b === null || turnoverUsd <= 0) continue;
    const top = Math.max(start, Math.min(a, b));
    const bottom = Math.min(height, Math.max(a, b));
    if (bottom > top) visible.push({ low: price, high: price + step, top, bottom, labelY: yOfLabel(top, bottom), turnoverUsd, deltaMicros });
  }
  visible.sort((a, b) => a.top - b.top);
  const laidOut: ProjectedRow[] = [];
  for (const row of visible) {
    const prev = laidOut.at(-1);
    // Przy uciętym brzegu osi scalamy słupki i podpisy z tej samej sumy wykonań.
    if (prev && row.labelY - prev.labelY < (compact ? COMPACT_ROW_PX : SMC_PROFILE_ROW_PX)) {
      prev.low = Math.min(prev.low, row.low);
      prev.high = Math.max(prev.high, row.high);
      prev.bottom = Math.max(prev.bottom, row.bottom);
      prev.labelY = yOfLabel(prev.top, prev.bottom);
      prev.turnoverUsd += row.turnoverUsd;
      prev.deltaMicros += row.deltaMicros;
    } else laidOut.push(row);
  }
  return laidOut.map(({ deltaMicros, ...row }) => ({ ...row, deltaUsd: usdFromMicros(deltaMicros) }));
}

type DrawData = { span: ProfileSpan; step: number; geometry: string; rows: DrawRow[]; visits: ReadonlyMap<number, ProfileVisit[]> };

export class SmcRangeProfileLayer implements ISeriesPrimitive<Time> {
  private adapter: SeriesAttachedParameter<Time> | null = null;
  private width = 0;
  private inset = 0;
  private headerTop = 0;
  private cutoff: number | null = null;
  private updated = -Infinity;
  private data: DrawData | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private infoKey = '';
  private readonly model: SmcRangeProfile;
  private readonly visits: RangeVisits;
  onInfo: ((info: RangeProfileInfo | null) => void) | null = null;

  constructor(private readonly tape: Tape, private readonly coverage: Coverage, private readonly span: () => ProfileSpan | null,
    private readonly replay: boolean, private readonly exactBook: () => readonly BookFrame[], private readonly bookCoverage: Coverage,
    private readonly serverNow: () => number) {
    this.model = new SmcRangeProfile(tape);
    this.visits = new RangeVisits(tape, coverage);
  }

  attached(adapter: SeriesAttachedParameter<Time>): void { this.adapter = adapter; }
  detached(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.clearDeadline();
    this.adapter = null;
  }

  setLayout(width: number, inset: number): void {
    if (this.width === width && this.inset === inset) return;
    this.width = width;
    this.inset = inset;
    this.adapter?.requestUpdate();
  }

  setHeaderTop(top: number): void {
    if (this.headerTop === top) return;
    this.headerTop = top;
    this.adapter?.requestUpdate();
  }

  setCutoff(at: number | null): void {
    if (this.cutoff === at) return;
    this.cutoff = at;
    this.updated = -Infinity;
    this.adapter?.requestUpdate();
  }

  private clearDeadline(): void {
    if (this.deadlineTimer !== null) clearTimeout(this.deadlineTimer);
    this.deadlineTimer = null;
  }

  updateAllViews(): void {
    const adapter = this.adapter;
    const range = this.width > 0 && adapter ? this.span() : null;
    const span = range && { from: range.from, to: Math.min(range.to, this.cutoff ?? Infinity) };
    const height = adapter?.chart.paneSize(0).height ?? 0;
    const top = adapter?.series.coordinateToPrice(0);
    const bottom = adapter?.series.coordinateToPrice(height);
    if (!adapter || !span || span.to <= span.from || top == null || bottom == null || height <= 0 || !Number.isFinite(top - bottom) || top === bottom) {
      this.data = null;
      this.clearDeadline();
      if (this.infoKey) {
        this.infoKey = '';
        this.onInfo?.(null);
      }
      return;
    }
    const compact = this.width <= rangeProfileWidth(true);
    const step = rangeProfileStep(Math.min(top, bottom), Math.max(top, bottom), height, compact ? COMPACT_ROW_PX : SMC_PROFILE_ROW_PX);
    const geometry = `${this.width}:${this.headerTop}:${height}:${top}:${bottom}`;
    const now = performance.now();
    const prior = this.data;
    if (prior?.span.from === span.from && prior.step === step && now - this.updated < REFRESH_MS &&
        prior.span.to <= span.to && prior.geometry === geometry) {
      if (this.timer === null) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.adapter?.requestUpdate();
        }, Math.ceil(REFRESH_MS - (now - this.updated)));
      }
      return;
    }
    // Anuluj odłożone odświeżenie, jeśli geometria lub granica wymusiła wcześniejszy odczyt.
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const profile = this.model.read(span, step, this.coverage);
    const rows = rangeProfileRows(profile.rows, step, height, p => adapter.series.priceToCoordinate(p), this.headerTop, compact);
    const observed = this.visits.read(span, priceBuckets(step, rows.filter(row => row.high - row.low > step)));
    const bucket = observed.lastBucket;
    const reaction = bucket ? { ...bucket, ...priceReaction(this.tape, span, bucket, this.exactBook(), this.bookCoverage) } : null;
    this.clearDeadline();
    if (!this.replay && this.cutoff === null && reaction?.nextDeadline != null) {
      const serverNow = this.serverNow();
      if (serverNow - span.to < REFRESH_MS) {
        this.deadlineTimer = setTimeout(() => {
          this.deadlineTimer = null;
          this.adapter?.requestUpdate();
        }, Math.max(1, reaction.nextDeadline - serverNow));
      }
    }
    this.data = { span, step, geometry, rows, visits: observed.byPrice };
    this.updated = now;
    const coverage = profile.spanMs > 0 ? Math.floor(1000 * profile.coveredMs / profile.spanMs) / 10 : 0;
    const info = { ...span, step, levels: profile.rows.length, coverage, reaction };
    const stateKey = (side: PriceReaction['buy']) =>
      `${side.mean?.toFixed(2)}:${side.totalUsd ? (100 * side.matchedUsd / side.totalUsd).toFixed(1) : '-'}:${side.pendingUsd > 0}:${side.missingUsd > 0}`;
    const reactionKey = reaction && `${reaction.low}:${reaction.high}/${stateKey(reaction.buy)}/${stateKey(reaction.sell)}`;
    const key = `${info.from}:${Math.floor(info.to / (this.replay ? 1000 : 60000))}:${step}:${info.levels}:${coverage}:${reactionKey}`;
    if (key === this.infoKey) return;
    this.infoKey = key;
    this.onInfo?.(info);
  }

  private readonly axis: readonly IPrimitivePaneView[] = [{ zOrder: () => 'normal', renderer: () => ({
    draw: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) =>
      this.draw(context, mediaSize.width - this.inset, mediaSize.height)),
  }) }];

  priceAxisPaneViews(): readonly IPrimitivePaneView[] { return this.axis; }

  private draw(ctx: CanvasRenderingContext2D, right: number, height: number): void {
    const left = right - this.width;
    if (!this.width || left < 0 || !this.adapter || height <= 0) return;
    const rows = this.data?.rows ?? [];
    let maxVolume = 0, maxDelta = 0;
    for (const row of rows) {
      maxVolume = Math.max(maxVolume, row.turnoverUsd);
      maxDelta = Math.max(maxDelta, Math.abs(row.deltaUsd));
    }
    const compact = this.width <= rangeProfileWidth(true);
    const metricEnd = compact ? right : left + 116;
    const divider = Math.round((left + metricEnd) / 2);
    const zero = Math.round((divider + metricEnd) / 2);
    const volWidth = divider - left - 5;
    const halfDelta = metricEnd - zero - 4;
    const visitLeft = compact ? left : metricEnd;
    const visitWidth = (right - visitLeft) / 3;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, 0, this.width, height);
    ctx.clip();
    ctx.fillStyle = rgba(PRO.ink2, .12);
    for (const x of [left, divider, zero, metricEnd]) ctx.fillRect(x, 0, 1, height);
    ctx.font = `600 ${compact ? 10 : 11}px ${MONO}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = PRO.bg;
    const label = (text: string, x: number, y: number, maxWidth: number) => {
      ctx.strokeText(text, x, y, maxWidth);
      ctx.fillText(text, x, y, maxWidth);
    };
    for (const row of rows) {
      const h = Math.max(1, row.bottom - row.top - 1);
      const vol = row.turnoverUsd / maxVolume * volWidth;
      ctx.fillStyle = rgba(PRO.ink2, row.turnoverUsd === maxVolume ? .86 : .55);
      ctx.fillRect(divider - vol, row.top, vol, h);
      if (row.deltaUsd !== 0 && maxDelta > 0) {
        const delta = row.deltaUsd / maxDelta * halfDelta;
        ctx.fillStyle = delta > 0 ? PRO.buy : PRO.sell;
        ctx.fillRect(zero + Math.min(0, delta), row.top, Math.abs(delta), h);
      }
      ctx.fillStyle = PRO.ink1;
      const metricY = row.labelY - (compact ? 6 : 0);
      label(rangeProfileLabel(row.turnoverUsd, false), divider - 4, metricY, divider - left - 8);
      ctx.fillStyle = row.deltaUsd < 0 ? PRO.sellInk : row.deltaUsd > 0 ? PRO.buyInk : PRO.ink2;
      label(rangeProfileLabel(row.deltaUsd, true), metricEnd - 4, metricY, metricEnd - divider - 8);
      const visits = this.data?.visits.get(row.low) ?? [];
      const visitMax = visits.reduce((max, visit) => Math.max(max, Math.abs(usdFromMicros(visit.deltaMicros))), 0);
      const visitY = row.labelY + (compact ? 6 : 0);
      for (let i = 0; i < 3; i++) {
        const visit = visits[i + visits.length - 3];
        const value = visit ? usdFromMicros(visit.deltaMicros) : null;
        if (value !== null && value !== 0 && visitMax > 0) {
          const center = visitLeft + (i + .5) * visitWidth;
          const length = value / visitMax * (visitWidth / 2 - 4);
          ctx.fillStyle = rgba(value > 0 ? PRO.buy : PRO.sell, .65);
          ctx.fillRect(center + Math.min(0, length), visitY + 4, Math.abs(length), 2);
        }
        ctx.fillStyle = value === null || value === 0 ? PRO.ink2 : value < 0 ? PRO.sellInk : PRO.buyInk;
        label(rangeProfileLabel(value, true) + (visit?.partial ? '*' : ''),
          visitLeft + (i + 1) * visitWidth - 3, visitY, visitWidth - 4);
      }
    }
    ctx.fillStyle = PRO.bg;
    ctx.fillRect(left, this.headerTop, this.width, compact ? COMPACT_HEADER_PX : HEADER_PX);
    ctx.font = `600 10px ${MONO}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    ctx.fillStyle = PRO.ink2;
    ctx.fillText(compact ? tr('Obr. USD', 'Vol USD') : tr('Obrót USD', 'Volume USD'), (left + divider) / 2, this.headerTop + 3, divider - left - 4);
    ctx.fillText('Δ USD', zero, this.headerTop + 3);
    ctx.fillText(tr('Δ wizyt USD →', 'Visit Δ USD →'), (visitLeft + right) / 2, this.headerTop + (compact ? 16 : 3), right - visitLeft - 4);
    if (!rows.length) ctx.fillText(DASH, (left + right) / 2, this.headerTop + (compact ? 34 : 21));
    ctx.restore();
  }
}
