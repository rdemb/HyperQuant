import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  Logical,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import type { FootprintBar, FootprintRows, ImbalanceParams } from '../core/footprintBar';
import { aggregateRows } from '../core/footprintBar';
import { ImbalanceZone, UnfinishedAuction, ZoneBar, dayZoneStep, imbalanceZones, unfinishedAuctions } from '../core/zones';
import type { ProBar } from '../store/proStore';
import { type ZonesSelection, selectZones } from './zonesSelect';
import { logicalOfTime } from './overlay';
import { MONO, PRO, rgba } from './theme';

/**
 * Strefy z footprintu na wykresie ceny: strefy nierównowagi (seria wierszy z nierównowagą po jednej stronie) jako
 * półprzezroczysty pas od świecy powstania do prawej krawędzi i niedokończone aukcje jako kropkowana linia od szczytu
 * albo dołka. Liczone tylko ze świec zamkniętych i tylko po ich zmianie; rysowany jest wybór `selectZones` na ostatniej
 * zamkniętej świecy (otwarte, najbliższe cenie). Tryb „Historia” — wszystkie strefy i aukcje obrysami.
 */

export interface ZoneToggles {
  showZones: boolean;
  showAuctions: boolean;
  /** Tryb „Historia”: wszystkie strefy i aukcje obrysami (domyślnie wyłączony). */
  history?: boolean;
}

/** Świece zamknięte (koniec ≤ `now`) jako świece modelu stref; świeca w trakcie nie wchodzi. */
export function closedZoneBars(bars: readonly ProBar[], ms: number, now: number): ZoneBar[] {
  let n = bars.length;
  while (n > 0 && bars[n - 1].t + ms > now) n--;
  return bars.slice(0, n).map((b) => ({ t: b.t, high: b.candle.h, low: b.candle.l, fp: b.fp, complete: b.complete }));
}

export interface ZoneParams {
  rowStep: number;
  imbalance: ImbalanceParams;
  stackedMin: number;
}

const Z = {
  buyFill: rgba(PRO.imbBuy, 0.1),
  buyEdge: rgba(PRO.imbBuy, 0.55),
  sellFill: rgba(PRO.imbSell, 0.1),
  sellEdge: rgba(PRO.imbSell, 0.55),
  closedAlpha: 0.45,
  ua: rgba(PRO.warn, 0.85),
};

interface ZoneRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  buy: boolean;
  open: boolean;
  outline: boolean;
}

interface UaLine {
  x0: number;
  x1: number;
  y: number;
  open: boolean;
}

export class ZonesLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;

  private toggles: ZoneToggles;
  private params: ZoneParams = { rowStep: 0, imbalance: { ratio: 3, minVol: 0.05 }, stackedMin: 3 };
  private bars: readonly ProBar[] = [];
  private ms = 60_000;
  private now = 0;
  private rightInset = 0;
  private zones: ImbalanceZone[] = [];
  private auctions: UnfinishedAuction[] = [];
  /** Zamknięte świece ostatniego przeliczenia (te same obiekty — bez zmian) i klucz parametrów. */
  private src: readonly ProBar[] = [];
  private calcKey = '';
  private sel: ZonesSelection | null = null;
  private selKey: readonly unknown[] = [];
  /** Po każdym nowym wyborze: liczba pasm stref i linii aukcji (pomiar układu czyta ją z wykresu). */
  onSelect: ((zones: number, auctions: number) => void) | null = null;
  private rects: ZoneRect[] = [];
  private lines: UaLine[] = [];
  private readonly rowCache = new WeakMap<FootprintBar, { key: string; rows: FootprintRows }>();
  private readonly views: readonly IPrimitivePaneView[];

  constructor(toggles: ZoneToggles) {
    this.toggles = toggles;
    const fills: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          for (const r of this.rects) {
            if (r.outline) continue;
            ctx.globalAlpha = r.open ? 1 : Z.closedAlpha;
            ctx.fillStyle = r.buy ? Z.buyFill : Z.sellFill;
            ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
          }
          ctx.globalAlpha = 1;
        }),
    };
    const edges: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          ctx.lineWidth = 1;
          for (const r of this.rects) {
            ctx.globalAlpha = r.open ? 1 : Z.closedAlpha;
            ctx.strokeStyle = r.buy ? Z.buyEdge : Z.sellEdge;
            if (r.outline) {
              // Tryb „Historia”: sam obrys
              ctx.strokeRect(Math.round(r.x0) + 0.5, Math.round(r.y0) + 0.5, Math.round(r.x1 - r.x0), Math.round(r.y1 - r.y0));
              continue;
            }
            ctx.beginPath();
            // Krawędź strefy po stronie, z której cena powinna ją bronić: dół wsparcia, góra oporu
            const y = Math.round(r.buy ? r.y1 : r.y0) + 0.5;
            ctx.moveTo(r.x0, y);
            ctx.lineTo(r.x1, y);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          if (this.lines.length === 0) return;
          ctx.strokeStyle = Z.ua;
          ctx.fillStyle = Z.ua;
          ctx.setLineDash([1, 3]);
          ctx.font = `600 9px ${MONO}`;
          ctx.textBaseline = 'middle';
          for (const l of this.lines) {
            const y = Math.round(l.y) + 0.5;
            ctx.beginPath();
            ctx.moveTo(l.x0, y);
            ctx.lineTo(l.x1, y);
            ctx.stroke();
          }
          ctx.setLineDash([]);
          for (const l of this.lines) if (l.open) ctx.fillText('UA', l.x1 + 3, Math.round(l.y));
        }),
    };
    this.views = [
      { zOrder: () => 'bottom', renderer: () => fills },
      { zOrder: () => 'normal', renderer: () => edges },
    ];
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart;
    this.series = p.series;
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  setToggles(t: ZoneToggles): void {
    this.toggles = t;
    this.requestUpdate?.();
  }

  setParams(p: ZoneParams): void {
    this.params = p;
    this.calcKey = '';
    this.src = [];
    this.requestUpdate?.();
  }

  setRightInset(px: number): void {
    this.rightInset = px;
    this.requestUpdate?.();
  }

  setData(bars: readonly ProBar[], ms: number, now: number): void {
    this.bars = bars;
    this.ms = ms;
    this.now = now;
    this.requestUpdate?.();
  }

  updateAllViews(): void {
    const { showZones, showAuctions } = this.toggles;
    this.rects = [];
    this.lines = [];
    if (!(showZones || showAuctions)) return;
    this.recalc();
    const chart = this.chart;
    const series = this.series;
    const bars = this.bars;
    if (!chart || !series || bars.length === 0) return;
    const ts = chart.timeScale();
    const xa = ts.logicalToCoordinate(0 as Logical);
    const xb = ts.logicalToCoordinate(1 as Logical);
    if (xa === null || xb === null || !(xb > xa)) return;
    const sp = xb - xa;
    const right = chart.paneSize(0).width - this.rightInset;
    // Lewa krawędź świecy o początku t
    const x = (t: number) => xa + (logicalOfTime(bars, t, this.ms) - 0.5) * sp;
    const y = (p: number) => series.priceToCoordinate(p);
    const sel = this.sel;
    if (!sel) return;
    if (showZones) {
      for (const z of sel.zones) {
        const x0 = x(z.from);
        const x1 = z.to === null || z.to > this.asOf ? right : x(z.to) + sp / 2;
        const ya = y(z.hi);
        const yb = y(z.lo);
        if (ya === null || yb === null || x1 < 0 || x0 > right) continue;
        const open = !sel.history || z.to === null || z.to > this.asOf;
        this.rects.push({ x0, x1: Math.min(open ? right : x1, right), y0: Math.min(ya, yb), y1: Math.max(ya, yb), buy: z.side === 1, open, outline: sel.history });
      }
    }
    if (showAuctions) {
      for (const u of sel.auctions) {
        const x0 = x(u.from) + sp / 2;
        const x1 = u.to === null || u.to > this.asOf ? right - 18 : x(u.to) + sp / 2;
        const yy = y(u.px);
        if (yy === null || x1 < 0 || x0 > right) continue;
        this.lines.push({ x0, x1: Math.min(x1, right), y: yy, open: u.to === null || u.to > this.asOf });
      }
    }
  }

  /** Chwila wyboru: ostatnia zamknięta świeca. */
  private asOf = 0;

  /** Przeliczenie tylko po zmianie zamkniętych świec albo parametrów; świeca w trakcie nie wchodzi. */
  private recalc(): void {
    const p = this.params;
    const ms = this.ms;
    let n = this.bars.length;
    while (n > 0 && this.bars[n - 1].t + ms > this.now) n--;
    const key = `${ms}|${p.rowStep}|${p.imbalance.ratio}|${p.imbalance.minVol}|${p.stackedMin}`;
    const same = key === this.calcKey && this.src.length === n && this.src.every((b, i) => b === this.bars[i]);
    if (!same) {
      this.calcKey = key;
      this.src = this.bars.slice(0, n);
      const zb = closedZoneBars(this.src, ms, this.now);
      // Krok stały w obrębie doby UTC (z poprzedniej doby), więc strefy z historii nie liczą się od nowa
      const step = dayZoneStep(zb, p.rowStep);
      const rowsOf = (fp: FootprintBar, s: number, imb: ImbalanceParams) => {
        const k = `${s}|${imb.ratio}|${imb.minVol}`;
        const hit = this.rowCache.get(fp);
        if (hit && hit.key === k) return hit.rows;
        const rows = aggregateRows(fp, s, imb);
        this.rowCache.set(fp, { key: k, rows });
        return rows;
      };
      this.zones = imbalanceZones(zb, step, p.imbalance, p.stackedMin, rowsOf);
      this.auctions = unfinishedAuctions(zb, step, rowsOf, p.imbalance);
    }
    const last = this.src[this.src.length - 1];
    const history = this.toggles.history === true;
    const selKey = [this.zones, this.auctions, history, this.toggles.showZones, this.toggles.showAuctions];
    if (selKey.every((v, i) => Object.is(v, this.selKey[i]))) return;
    this.selKey = selKey;
    this.asOf = last ? last.t : 0;
    this.sel = last ? selectZones(this.zones, this.auctions, last.candle.c, last.t, { history }) : null;
    this.onSelect?.(this.toggles.showZones ? (this.sel?.zones.length ?? 0) : 0, this.toggles.showAuctions ? (this.sel?.auctions.length ?? 0) : 0);
  }
}
