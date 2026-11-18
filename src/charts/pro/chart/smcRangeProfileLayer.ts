import type { IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { tr } from '../../../i18n';
import { DASH, numLang } from '../../../ui/format';
import { fmtVol } from '../../orderflow/footprint';
import type { BookFrame } from '../core/book';
import type { Coverage } from '../core/coverage';
import { rangeProfileStep, SmcRangeProfile, usdFromMicros, type ProfileSpan, type RangeProfileRow } from '../core/smcRangeProfile';
import { priceBuckets, RangeVisits, priceReaction, summarizeVisits, type PriceBucket, type PriceReaction, type VisitSummary } from '../core/smcRangeProfileFlow';
import { rangeTapeWindows, readRangeTape, type TapeWindow } from '../core/smcRangeProfileTape';
import type { Tape } from '../core/tape';
import { MONO, PRO, rgba } from './theme';

export interface RangeProfileInfo extends ProfileSpan {
  step: number;
  levels: number;
  coverage: number;
  tapeWindows: TapeWindow[];
  active: (PriceBucket & { visits: VisitSummary; reaction: PriceReaction }) | null;
}

const REFRESH_MS = 250;
const TAPE_REFRESH_MS = 1000;
const HEADER_PX = 20;
const ROW_PX = 26;
const LABEL_MARGIN_PX = 10;
const TRACE_BOTTOM_PX = 16;
export const rangeProfileWidth = (compact: boolean): number => compact ? 112 : 144;

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
  rows: readonly RangeProfileRow[], step: number, height: number, yOf: (price: number) => number | null, headerTop = 0
): DrawRow[] {
  const start = headerTop + HEADER_PX;
  if (height < start + LABEL_MARGIN_PX + TRACE_BOTTOM_PX) return [];
  const yOfLabel = (top: number, bottom: number) => Math.max(start + LABEL_MARGIN_PX, Math.min(height - TRACE_BOTTOM_PX, (top + bottom) / 2));
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
    if (prev && row.labelY - prev.labelY < ROW_PX) {
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

type DrawData = { span: ProfileSpan; step: number; geometry: string; rows: DrawRow[] };
type DrawTape = ReturnType<typeof readRangeTape> & {
  key: string;
  updated: number;
  end: number;
  windows: TapeWindow[];
};

export class SmcRangeProfileLayer implements ISeriesPrimitive<Time> {
  private adapter: SeriesAttachedParameter<Time> | null = null;
  private width = 0;
  private inset = 0;
  private headerTop = 0;
  private cutoff: number | null = null;
  private updated = -Infinity;
  private data: DrawData | null = null;
  private trace: DrawTape | null = null;
  private traceVisible = true;
  private traceTimer: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private infoKey = '';
  private readonly model: SmcRangeProfile;
  private readonly visits: RangeVisits;
  onInfo: ((info: RangeProfileInfo | null) => void) | null = null;

  constructor(private readonly tape: Tape, private readonly coverage: Coverage, private readonly span: () => ProfileSpan | null,
    private readonly replay: boolean, private readonly exactBook: () => readonly BookFrame[], private readonly bookCoverage: Coverage,
    private readonly serverNow: () => number, private readonly replayPlaying: () => boolean = () => false,
    private readonly traceCoverage: Pick<Coverage, 'coveredMs'> = coverage) {
    this.model = new SmcRangeProfile(tape);
    this.visits = new RangeVisits(tape, coverage);
  }

  attached(adapter: SeriesAttachedParameter<Time>): void { this.adapter = adapter; }
  detached(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.clearDeadline();
    this.clearTraceTimer();
    this.trace = null;
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

  setTraceVisible(visible: boolean): void {
    if (this.traceVisible === visible) return;
    this.traceVisible = visible;
    this.trace = null;
    this.clearTraceTimer();
    this.updated = -Infinity;
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

  private clearTraceTimer(): void {
    if (this.traceTimer !== null) clearTimeout(this.traceTimer);
    this.traceTimer = null;
  }

  private requestTraceIn(ms: number): void {
    if (this.traceTimer !== null) return;
    this.traceTimer = setTimeout(() => {
      this.traceTimer = null;
      this.adapter?.requestUpdate();
    }, Math.ceil(ms));
  }

  private updateTrace(span: ProfileSpan, rows: readonly DrawRow[], now: number, ticking: boolean): TapeWindow[] {
    let key = `${span.from}/${rows.map(row => `${row.low}:${row.high}`).join(',')}`;
    const previous = this.trace;
    if (ticking && previous?.key === key && previous.end <= span.to && now - previous.updated < TAPE_REFRESH_MS) {
      this.requestTraceIn(TAPE_REFRESH_MS - (now - previous.updated));
      return previous.windows;
    }
    const windows = rangeTapeWindows(span, this.traceCoverage);
    if (!ticking) {
      key += `/${span.to}/${this.tape.signature(windows[0].from, windows[windows.length - 1].to)}/${windows.map(window => window.coverage).join(',')}`;
      if (previous?.key === key) return previous.windows;
    }
    this.clearTraceTimer();
    this.trace = { ...readRangeTape(this.tape, windows, rows), key, updated: now, end: span.to, windows };
    if (ticking) this.requestTraceIn(TAPE_REFRESH_MS);
    return windows;
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
      this.trace = null;
      this.clearTraceTimer();
      this.clearDeadline();
      if (this.infoKey) {
        this.infoKey = '';
        this.onInfo?.(null);
      }
      return;
    }
    const compact = this.width <= rangeProfileWidth(true);
    const rowLimit = Math.min(compact ? 9 : 14, Math.floor((height - this.headerTop - HEADER_PX) / ROW_PX));
    const step = rangeProfileStep(Math.min(top, bottom), Math.max(top, bottom), rowLimit);
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
    const rows = rangeProfileRows(profile.rows, step, height, p => adapter.series.priceToCoordinate(p), this.headerTop);
    const ticking = this.cutoff === null && (!this.replay || this.replayPlaying()) && this.serverNow() - span.to < REFRESH_MS;
    const tapeWindows = this.traceVisible ? this.updateTrace(span, rows, now, ticking) : [];
    const observed = this.visits.read(span, priceBuckets(step, rows.filter(row => row.high - row.low > step)));
    const bucket = observed.lastBucket;
    const visits = bucket ? summarizeVisits(observed.byPrice.get(bucket.low) ?? []) : null;
    const active = bucket && visits ? { ...bucket, visits, reaction: priceReaction(this.tape, span, bucket, this.exactBook(), this.bookCoverage) } : null;
    const nextDeadline = active?.reaction.nextDeadline;
    this.clearDeadline();
    if (!this.replay && this.cutoff === null && nextDeadline != null) {
      const serverNow = this.serverNow();
      if (serverNow - span.to < REFRESH_MS) {
        this.deadlineTimer = setTimeout(() => {
          this.deadlineTimer = null;
          this.adapter?.requestUpdate();
        }, Math.max(1, nextDeadline - serverNow));
      }
    }
    this.data = { span, step, geometry, rows };
    this.updated = now;
    const coverage = profile.spanMs > 0 ? Math.floor(1000 * profile.coveredMs / profile.spanMs) / 10 : 0;
    const info = { ...span, step, levels: rows.length, coverage, active, tapeWindows };
    const stateKey = (side: PriceReaction['buy']) =>
      `${side.mean?.toFixed(2)}:${side.totalUsd ? (100 * side.matchedUsd / side.totalUsd).toFixed(1) : '-'}:${side.pendingUsd > 0}:${side.missingUsd > 0}`;
    const activeKey = active && `${active.low}:${active.high}/${active.visits.count}:${active.visits.deltaMicros}:${active.visits.partial}/${stateKey(active.reaction.buy)}/${stateKey(active.reaction.sell)}`;
    const key = `${info.from}:${Math.floor(info.to / (this.replay ? 1000 : 60000))}:${step}:${info.levels}:${coverage}:${activeKey}:${tapeWindows.map(window => window.coverage).join(',')}`;
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
    const divider = Math.round((left + right) / 2);
    const zero = Math.round((divider + right) / 2);
    const gutter = 5;
    const columnWidth = divider - left - 2 * gutter;
    const halfDelta = right - zero - gutter;
    const traceCellWidth = (this.width - 2 * gutter) / 3;
    const traceHalf = traceCellWidth / 2 - 2;
    const traceScale = Number(this.trace?.maxSide ?? 0n);
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, 0, this.width, height);
    ctx.clip();
    ctx.fillStyle = PRO.bg;
    ctx.fillRect(left, 0, this.width, height);
    ctx.fillStyle = rgba(PRO.ink2, .12);
    for (const x of [left, divider]) ctx.fillRect(x, 0, 1, height);
    ctx.fillRect(left, this.headerTop + HEADER_PX - 1, this.width, 1);
    ctx.font = `600 ${compact ? 11 : 12}px ${MONO}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (const row of rows) {
      const barY = row.labelY + 8;
      const vol = row.turnoverUsd / maxVolume * columnWidth;
      ctx.fillStyle = rgba(PRO.ink2, row.turnoverUsd === maxVolume ? .86 : .55);
      ctx.fillRect(divider - gutter - vol, barY, vol, 2);
      if (row.deltaUsd !== 0 && maxDelta > 0) {
        const delta = row.deltaUsd / maxDelta * halfDelta;
        ctx.fillStyle = delta > 0 ? PRO.buy : PRO.sell;
        ctx.fillRect(zero + Math.min(0, delta), barY, Math.abs(delta), 2);
      }
      ctx.fillStyle = PRO.ink1;
      ctx.fillText(rangeProfileLabel(row.turnoverUsd, false), divider - gutter, row.labelY, columnWidth);
      ctx.fillStyle = row.deltaUsd < 0 ? PRO.sellInk : row.deltaUsd > 0 ? PRO.buyInk : PRO.ink2;
      ctx.fillText(rangeProfileLabel(row.deltaUsd, true), right - gutter, row.labelY, right - divider - 2 * gutter);
      this.trace?.byPrice.get(row.low)?.forEach((cell, index) => {
        if (!cell) return;
        const center = Math.round(left + gutter + (index + .5) * traceCellWidth);
        const y = row.labelY + 12;
        const sell = Number(cell.sell) / traceScale * traceHalf;
        const buy = Number(cell.buy) / traceScale * traceHalf;
        if (sell > 0) {
          ctx.fillStyle = PRO.sell;
          ctx.fillRect(center - sell, y, sell, 3);
        }
        if (buy > 0) {
          ctx.fillStyle = PRO.buy;
          ctx.fillRect(center, y, buy, 3);
        }
        ctx.fillStyle = rgba(PRO.ink2, .55);
        ctx.fillRect(center - .5, y, 1, 3);
      });
    }
    ctx.font = `600 10px ${MONO}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    ctx.fillStyle = PRO.ink2;
    ctx.fillText(tr('Obrót USD', 'Volume USD'), (left + divider) / 2, this.headerTop + 4, divider - left - 6);
    ctx.fillText('Δ USD', zero, this.headerTop + 4);
    if (!rows.length) ctx.fillText(DASH, (left + right) / 2, this.headerTop + HEADER_PX + 7);
    ctx.restore();
  }
}
