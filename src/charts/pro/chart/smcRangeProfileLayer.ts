import type { IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { tr } from '../../../i18n';
import { fmtVol } from '../../orderflow/footprint';
import type { Coverage } from '../core/coverage';
import { rangeProfileStep, SmcRangeProfile, type ProfileSpan, type RangeProfile } from '../core/smcRangeProfile';
import type { Tape } from '../core/tape';
import { MONO, PRO, rgba } from './theme';

export interface RangeProfileInfo extends ProfileSpan {
  step: number;
  levels: number;
  coverage: number;
}

const REFRESH_MS = 250;

export class SmcRangeProfileLayer implements ISeriesPrimitive<Time> {
  private adapter: SeriesAttachedParameter<Time> | null = null;
  private width = 0;
  private inset = 0;
  private updated = -Infinity;
  private data: { span: ProfileSpan; step: number; profile: RangeProfile } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private infoKey = '';
  private readonly model: SmcRangeProfile;
  onInfo: ((info: RangeProfileInfo | null) => void) | null = null;

  constructor(tape: Tape, private readonly coverage: Coverage, private readonly span: () => ProfileSpan | null, private readonly replay: boolean) {
    this.model = new SmcRangeProfile(tape);
  }

  attached(adapter: SeriesAttachedParameter<Time>): void { this.adapter = adapter; }
  detached(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.adapter = null;
  }

  setLayout(width: number, inset: number): void {
    if (this.width === width && this.inset === inset) return;
    this.width = width;
    this.inset = inset;
    this.adapter?.requestUpdate();
  }

  updateAllViews(): void {
    const adapter = this.adapter;
    const span = this.width > 0 && adapter ? this.span() : null;
    const height = adapter?.chart.paneSize(0).height ?? 0;
    const top = adapter?.series.coordinateToPrice(0);
    const bottom = adapter?.series.coordinateToPrice(height);
    if (!span || top == null || bottom == null || height <= 0 || !Number.isFinite(top - bottom) || top === bottom) {
      this.data = null;
      if (this.infoKey) {
        this.infoKey = '';
        this.onInfo?.(null);
      }
      return;
    }
    const step = rangeProfileStep(Math.min(top, bottom), Math.max(top, bottom), height);
    const now = performance.now();
    const prior = this.data;
    if (!this.replay && prior?.span.from === span.from && prior.step === step && now - this.updated < REFRESH_MS) {
      if (this.timer === null) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.adapter?.requestUpdate();
        }, Math.ceil(REFRESH_MS - (now - this.updated)));
      }
      return;
    }
    const profile = this.model.read(span, step, this.coverage);
    this.data = { span, step, profile };
    this.updated = now;
    const coverage = profile.spanMs > 0 ? Math.floor(1000 * profile.coveredMs / profile.spanMs) / 10 : 0;
    const info = { ...span, step, levels: profile.rows.length, coverage };
    const key = `${info.from}:${Math.floor(info.to / (this.replay ? 1000 : 60000))}:${step}:${info.levels}:${coverage}`;
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
    const series = this.adapter.series;
    const step = this.data?.step ?? 1;
    const rows = [];
    let maxVolume = 0, maxDelta = 0;
    for (const row of this.data?.profile.rows ?? []) {
      const a = series.priceToCoordinate(row.price), b = series.priceToCoordinate(row.price + step);
      if (a === null || b === null) continue;
      const top = Math.max(0, Math.min(a, b));
      const bottom = Math.min(height, Math.max(a, b));
      if (bottom <= top) continue;
      rows.push({ ...row, top, height: bottom - top });
      maxVolume = Math.max(maxVolume, row.turnoverUsd);
      maxDelta = Math.max(maxDelta, Math.abs(row.deltaUsd));
    }
    const divider = Math.round(left + this.width * .53);
    const zero = Math.round((divider + right) / 2);
    const volWidth = divider - left - 5;
    const halfDelta = right - zero - 4;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, 0, this.width, height);
    ctx.clip();
    ctx.fillStyle = rgba(PRO.ink2, .12);
    ctx.fillRect(left, 0, 1, height);
    ctx.fillRect(divider, 0, 1, height);
    ctx.fillRect(zero, 0, 1, height);
    for (const row of rows) {
      const h = row.height >= 3 ? row.height - 1 : row.height;
      const vol = row.turnoverUsd / maxVolume * volWidth;
      ctx.fillStyle = rgba(PRO.ink2, row.turnoverUsd === maxVolume ? .86 : .55);
      ctx.fillRect(divider - vol, row.top, vol, h);
      if (row.deltaUsd !== 0 && maxDelta > 0) {
        const delta = row.deltaUsd / maxDelta * halfDelta;
        ctx.fillStyle = delta > 0 ? PRO.buy : PRO.sell;
        ctx.fillRect(zero + Math.min(0, delta), row.top, Math.abs(delta), h);
      }
    }
    const compact = this.width < 100;
    ctx.fillStyle = rgba(PRO.bg, .92);
    ctx.fillRect(left, 1, this.width, rows.length && !compact ? 26 : 14);
    ctx.font = `600 10px ${MONO}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    ctx.fillStyle = PRO.ink2;
    ctx.fillText(compact ? 'VOL' : tr('Obrót', 'Volume'), (left + divider) / 2, 3);
    ctx.fillText('− Δ +', zero, 3);
    if (rows.length && !compact) {
      ctx.font = `9px ${MONO}`;
      ctx.fillText(fmtVol(maxVolume), (left + divider) / 2, 15);
      ctx.fillText(`±${fmtVol(maxDelta)}`, zero, 15);
    }
    if (!rows.length) ctx.fillText('—', (left + right) / 2, 21);
    ctx.restore();
  }
}
