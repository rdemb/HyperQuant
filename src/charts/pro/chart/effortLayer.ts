import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';
import { tr } from '../../../i18n';
import { numLang } from '../../../ui/format';
import { DEFAULT_EFFORT_PARAMS, type EffortResult, type Side, type VBar, type ZoneKind, effortZones } from '../core/effortZones';
import type { Candle } from '../hl/parse';
import { logicalOfTime } from './overlay';
import { MONO, PRO, rgba } from './theme';

/**
 * Warstwa wskaźnika „Strefy absorpcji i pudełka Effort” na wykresie ceny (interwały do 1 h, na żywo i w powtórce):
 * strefy absorpcji, dyskonta swingu i po zmianie roli ze znacznikiem A, D albo F w rogu (aktywne do prawej krawędzi,
 * zakończone przygaszone) oraz pudełka Effort przez 12 świec, w stałych kolorach stron (popyt w kolorze kupna, podaż
 * w kolorze sprzedaży); w legendzie aktywne strefy, pudełka z ostatniej godziny i udział delty z taśmy. Liczone na
 * zamkniętych świecach wykresu i tylko po ich zmianie.
 */

/** Styl widocznego wskaźnika: krycie wypełnień i grubość obrysów (kolory stron są stałe). */
export interface EffortStyle {
  alpha: number;
  width: number;
}

/** Świeca wykresu z taśmą (ProBar): delta agresorów z footprintu i czy świeca jest w całości nagrana. */
export interface EffortSourceBar {
  t: number;
  candle: Candle;
  fp: { delta: number } | null;
  complete: boolean;
}

const MAX_TF = 3_600_000;
const HOUR = 3_600_000;
/** Wypełnienie strefy aktywnej i zakończonej oraz pudełka (mnożone przez krycie stylu). */
const ZONE_FILL = 0.13;
const ZONE_FILL_ENDED = 0.05;
const BOX_FILL = 0.3;
const MARK: Record<ZoneKind, string> = { absorption: 'A', discount: 'D', flip: 'F' };

/** Kolory stron z kryciem `a`, zbudowane raz na rysowanie: popyt w kolorze kupna, podaż w kolorze sprzedaży. */
function sideInk(a: number): (s: Side) => string {
  const buy = rgba(PRO.buy, a);
  const sell = rgba(PRO.sell, a);
  return (s) => (s === 1 ? buy : sell);
}

interface ZoneRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  side: Side;
  mark: string;
  live: boolean;
}

interface BoxRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  side: Side;
  stacked: boolean;
}

/** Liczba zamkniętych świec (koniec ≤ `now`) na początku listy rosnącej po czasie. */
function closedCount(bars: readonly EffortSourceBar[], ms: number, now: number): number {
  let n = bars.length;
  while (n > 0 && bars[n - 1].t + ms > now) n--;
  return n;
}

/** Świeca modelu: delta z footprintu tylko przy świecy w całości nagranej, inaczej null (model przybliża ją ze świecy). */
const toVBar = (b: EffortSourceBar): VBar => ({ t: b.t, o: b.candle.o, h: b.candle.h, l: b.candle.l, c: b.candle.c, v: b.candle.v, delta: b.complete && b.fp ? b.fp.delta : null });

/** Zamknięte świece wykresu (koniec ≤ `now`) jako świece modelu; świeca w trakcie nie wchodzi. */
export function closedBars(bars: readonly EffortSourceBar[], ms: number, now: number): VBar[] {
  return bars.slice(0, closedCount(bars, ms, now)).map(toVBar);
}

const pct = (x: number) => `${numLang(String(Math.round(x * 100)))}%`;

/**
 * Opis w legendzie z wyniku modelu: aktywne strefy po stronach, pudełka zamknięte w ostatniej godzinie i udział świec
 * z deltą z taśmy; powyżej 1 h powód braku, bez zamkniętych świec — czekanie.
 */
export function effortLegend(r: EffortResult | null, ms: number, now: number): { text: string; color: string }[] {
  if (ms > MAX_TF) return [{ text: tr('—, interwał do 1 h', '—, intervals up to 1 h'), color: PRO.ink3 }];
  if (!r) return [{ text: tr('czekam na świece…', 'waiting for candles…'), color: PRO.ink3 }];
  let demand = 0;
  let supply = 0;
  for (const z of r.zones) {
    if (z.to !== null) continue;
    if (z.side === 1) demand++;
    else supply++;
  }
  const boxes = r.boxes.filter((b) => b.t + ms > now - HOUR).length;
  const tape = pct(1 - r.proxyShare);
  return [
    { text: tr(`strefy: ${demand} popytu · ${supply} podaży`, `zones: ${demand} demand · ${supply} supply`), color: demand + supply > 0 ? PRO.ink1 : PRO.ink2 },
    { text: tr(`· pudełka z ostatniej godziny: ${boxes}`, `· boxes in the last hour: ${boxes}`), color: PRO.ink2 },
    { text: tr(`· delta z taśmy ${tape}`, `· tape delta ${tape}`), color: PRO.ink2 },
  ];
}

export class EffortLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private style: EffortStyle | null = null;
  private bars: readonly EffortSourceBar[] = [];
  private ms = 60_000;
  private now = 0;
  private rightInset = 0;
  /** Zamknięte świece ostatniego przeliczenia (te same obiekty — bez zmian) i jego wynik. */
  private src: readonly EffortSourceBar[] = [];
  private srcMs = 0;
  private result: EffortResult | null = null;
  private zones: ZoneRect[] = [];
  private boxes: BoxRect[] = [];
  private readonly views: readonly IPrimitivePaneView[];

  /** `styleOf` — styl widocznego wskaźnika (null — ukryty: bez liczenia i rysowania). */
  constructor(private readonly styleOf: () => EffortStyle | null) {
    const back: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          const st = this.style;
          if (!st) return;
          const zone = sideInk(ZONE_FILL * st.alpha);
          const ended = sideInk(ZONE_FILL_ENDED * st.alpha);
          const box = sideInk(BOX_FILL * st.alpha);
          for (const z of this.zones) {
            ctx.fillStyle = (z.live ? zone : ended)(z.side);
            ctx.fillRect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
          }
          for (const b of this.boxes) {
            ctx.fillStyle = box(b.side);
            ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
          }
        }),
    };
    const front: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          const st = this.style;
          if (!st) return;
          const a = Math.max(0.35, 0.85 * st.alpha);
          const live = sideInk(a);
          const ended = sideInk(0.4 * a);
          const rect = (r: { x0: number; x1: number; y0: number; y1: number }, w: number) => {
            ctx.lineWidth = w;
            // Linia nieparzystej grubości na środku piksela (ostra krawędź)
            const o = w % 2 ? 0.5 : 0;
            ctx.strokeRect(Math.round(r.x0) + o, Math.round(r.y0) + o, Math.round(r.x1 - r.x0), Math.round(r.y1 - r.y0));
          };
          ctx.font = `600 9px ${MONO}`;
          ctx.textBaseline = 'top';
          for (const z of this.zones) {
            const c = (z.live ? live : ended)(z.side);
            ctx.strokeStyle = c;
            rect(z, st.width);
            // Znacznik rodzaju w lewym górnym rogu (przy strefie zaczętej poza widokiem — przy lewej krawędzi)
            const lx = Math.max(z.x0, 0) + 3;
            if (z.x1 - lx < 8) continue;
            ctx.fillStyle = c;
            ctx.fillText(z.mark, lx, z.y0 + 2);
          }
          for (const b of this.boxes) {
            ctx.strokeStyle = live(b.side);
            // Nałożone pudełka (kontrola jednej strony świeca po świecy) grubszym obrysem
            rect(b, b.stacked ? st.width + 1 : Math.max(1, st.width - 1));
          }
        }),
    };
    this.views = [
      { zOrder: () => 'bottom', renderer: () => back },
      // Obrysy i znaczniki nad świecami
      { zOrder: () => 'top', renderer: () => front },
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

  setRightInset(px: number): void {
    this.rightInset = px;
    this.requestUpdate?.();
  }

  /** Świece wykresu; przeliczenie tylko po zmianie zamkniętych świec (nowa, doczytana historia, taśma starszej świecy). */
  setData(bars: readonly EffortSourceBar[], ms: number, now: number): void {
    this.bars = bars;
    this.ms = ms;
    this.now = now;
    if (!this.styleOf() || ms > MAX_TF) {
      this.src = [];
      this.srcMs = 0;
      this.result = null;
      this.requestUpdate?.();
      return;
    }
    const n = closedCount(bars, ms, now);
    const same = ms === this.srcMs && this.src.length === n && this.src.every((b, i) => b === bars[i]);
    if (!same) {
      this.src = bars.slice(0, n);
      this.srcMs = ms;
      this.result = n > 0 ? effortZones(this.src.map(toVBar), ms) : null;
    }
    this.requestUpdate?.();
  }

  updateAllViews(): void {
    this.zones = [];
    this.boxes = [];
    this.style = this.styleOf();
    const r = this.result;
    const chart = this.chart;
    const series = this.series;
    const bars = this.bars;
    const ms = this.ms;
    if (!this.style || !r || !chart || !series || bars.length === 0 || ms > MAX_TF) return;
    const ts = chart.timeScale();
    const xa = ts.logicalToCoordinate(0 as Logical);
    const xb = ts.logicalToCoordinate(1 as Logical);
    if (xa === null || xb === null || !(xb > xa)) return;
    const sp = xb - xa;
    const right = chart.paneSize(0).width - this.rightInset;
    const x = (t: number) => Math.min(right, xa + (logicalOfTime(bars, t, ms) - 0.5) * sp);
    const y = (p: number) => series.priceToCoordinate(p);
    const span = (x0: number, x1: number, hi: number, lo: number) => {
      if (x1 < 0 || x0 >= right) return null;
      const ya = y(hi);
      const yb = y(lo);
      return ya === null || yb === null ? null : { x0, x1, y0: Math.min(ya, yb), y1: Math.max(ya, yb) };
    };
    for (const z of r.zones) {
      const s = span(x(z.from), z.to === null ? right : x(z.to + ms), z.hi, z.lo);
      if (s) this.zones.push({ ...s, side: z.side, mark: MARK[z.kind], live: z.to === null });
    }
    const ext = DEFAULT_EFFORT_PARAMS.boxExtend * ms;
    for (const b of r.boxes) {
      const s = span(x(b.t), x(b.t + ext), b.hi, b.lo);
      if (s) this.boxes.push({ ...s, side: b.side, stacked: b.stacked });
    }
  }

  /** Opis w legendzie (z ostatniego przeliczenia). */
  legend(): { text: string; color: string }[] {
    return effortLegend(this.result, this.ms, this.now);
  }
}
