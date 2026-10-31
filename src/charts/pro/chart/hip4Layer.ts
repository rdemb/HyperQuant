import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';
import type { Hip4Row } from '../../../utils/hip4';
import { numLang } from '../../../ui/format';
import { tr } from '../../../i18n';
import { fmtDm, fmtHm } from '../core/time';
import { fmtPx } from './layout';
import { MONO, PRO, rgba } from './theme';

/** Poziom rynku wynikowego: cena progu, podpis i nasycenie koloru (0–1, z różnicy modelu i rynku). */
export interface OutcomeLevel {
  px: number;
  text: string;
  strength: number;
}

export interface Hip4Source {
  levels: readonly OutcomeLevel[];
  color: string;
  alpha: number;
  width: number;
}

/** Różnica modelu i rynku (w prawdopodobieństwie), przy której kolor jest pełny. */
const FULL_DIFF = 0.2;
const LABEL_BG = rgba(PRO.bg, 0.85);
const LABEL_H = 12;

/** Procent jak w panelu „Model vs rynek”: całe punkty, przy skrajach jedno miejsce po przecinku. */
const pct = (p: number) => `${numLang((p * 100).toFixed(p < 0.05 || p > 0.95 ? 1 : 0))}%`;

/** Termin: godzina, gdy dziś, inaczej z datą (czas lokalny). */
const when = (t: number, now: number) => (new Date(t).toDateString() === new Date(now).toDateString() ? fmtHm(t) : `${fmtDm(t)} ${fmtHm(t)}`);

/**
 * Poziomy rynków wynikowych BTC z płynnym arkuszem (przy rzadkim cena rynku nic nie mówi, jak w panelu „Model vs rynek”):
 * „> K” — cena powyżej progu w terminie, „dotknie K” — dotknięcie do terminu. `nearest` — tylko poziom najbliższy ceny.
 */
export function outcomeLevels(rows: readonly Hip4Row[], now: number, price: number, nearest: boolean): OutcomeLevel[] {
  const levels = rows.flatMap((r) => {
    const mid = r.quote?.liquid ? r.quote.mid : null;
    if (mid === null) return [];
    const q = r.q;
    const head = q.kind === 'above' ? `> ${fmtPx(q.K)}` : `${tr('dotknie', 'touches')} ${fmtPx(q.K)}`;
    const model = r.model === null ? '—' : pct(r.model);
    const text = `${head} · ${tr('do', 'by')} ${when(q.expiry, now)} · ${tr('rynek', 'market')} ${pct(mid)} · model ${model}`;
    return [{ px: q.K, text, strength: r.model === null ? 0 : Math.min(1, Math.abs(r.model - mid) / FULL_DIFF) }];
  });
  if (!nearest || levels.length === 0 || !(price > 0)) return levels;
  return [levels.reduce((a, b) => (Math.abs(b.px - price) < Math.abs(a.px - price) ? b : a))];
}

interface Drawn {
  lines: { y: number; alpha: number }[];
  texts: { x: number; y: number; text: string }[];
  color: string;
  width: number;
}

/**
 * Rynki wynikowe HIP-4 na wykresie ceny: przerywana linia na progu przez cały panel, kolor tym bardziej nasycony, im
 * bardziej model różni się od rynku, i podpis przy prawej krawędzi (podpisy rozsunięte, żeby się nie nakładały). Skali
 * ceny nie rozciąga — poziomy poza widokiem nie są rysowane.
 */
export class Hip4Layer implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private drawn: Drawn | null = null;
  private readonly views: readonly IPrimitivePaneView[];

  constructor(private readonly source: () => Hip4Source | null) {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          const d = this.drawn;
          if (!d) return;
          ctx.lineWidth = d.width;
          ctx.setLineDash([6, 4]);
          for (const l of d.lines) {
            ctx.strokeStyle = rgba(d.color, l.alpha);
            ctx.beginPath();
            ctx.moveTo(0, l.y);
            ctx.lineTo(mediaSize.width, l.y);
            ctx.stroke();
          }
          ctx.setLineDash([]);
        }),
    };
    const labels: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          const d = this.drawn;
          if (!d) return;
          ctx.font = `10px ${MONO}`;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          for (const t of d.texts) {
            const w = ctx.measureText(t.text).width;
            ctx.fillStyle = LABEL_BG;
            ctx.fillRect(t.x - w - 2, t.y - LABEL_H + 1, w + 4, LABEL_H);
            ctx.fillStyle = rgba(d.color, 0.95);
            ctx.fillText(t.text, t.x, t.y);
          }
        }),
    };
    this.views = [
      { zOrder: () => 'bottom', renderer: () => renderer },
      { zOrder: () => 'top', renderer: () => labels },
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

  /** Nowe notowania albo styl: przerysowanie. */
  update(): void {
    this.requestUpdate?.();
  }

  updateAllViews(): void {
    this.drawn = null;
    const src = this.source();
    const chart = this.chart;
    const series = this.series;
    if (!src || !chart || !series) return;
    const { width, height } = chart.paneSize(0);
    const placed = src.levels
      .flatMap((l) => {
        const y = series.priceToCoordinate(l.px);
        return y !== null && y >= 0 && y <= height ? [{ l, y: y as number }] : [];
      })
      .sort((a, b) => a.y - b.y);
    // Podpis nad linią; kolejny co najmniej wysokość podpisu niżej od poprzedniego
    let prev = Number.NEGATIVE_INFINITY;
    const texts = placed.map((p) => {
      const y = Math.max(p.y - 2, prev + LABEL_H + 1);
      prev = y;
      return { x: width - 6, y, text: p.l.text };
    });
    const lines = placed.map((p) => ({ y: p.y, alpha: src.alpha * (0.3 + 0.7 * p.l.strength) }));
    this.drawn = { lines, texts, color: src.color, width: src.width };
  }
}
