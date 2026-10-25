import type { OHLCVBar } from '../../types/trading';
import { IMB_BUY, IMB_SELL, detectImbalances, fmtVol, valueArea } from './footprint';
import { HeatTexture } from './heatTexture';
import { FP_TICK, FpCandle, FpCell, OrderFlowStore } from './orderFlowStore';
import { numLang } from '../../ui/format';
import { Frame, bucketFor, priceTickStep, priceToY, timeStep, timeToX } from './scales';

/** Kolory płótna = tokeny z src/index.css (canvas nie widzi klas Tailwind). */
export const C = {
  page: '#070a11',
  bg: '#0b1019',
  tip: '#16202f',
  grid: '#1b2533',
  divider: '#283447',
  ink1: '#eef2f7',
  ink2: '#a9b4c4',
  ink3: '#7a889c',
  accent: '#3fc6dd',
  buy: '#19a88e',
  sell: '#d9582e',
  buyInk: '#35c9a8',
  sellInk: '#f07c55',
  level: '#e0a045',
  zone: '#9085e9',
  series1: '#3987e5',
} as const;

export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Gotowe kolory z kryciem (bez budowania napisów w pętli)
const K = {
  shade: rgba(C.page, 0.34),
  cellBack: rgba(C.bg, 0.8),
  buy25: rgba(C.buy, 0.25),
  sell25: rgba(C.sell, 0.25),
  buy75: rgba(C.buy, 0.75),
  sell75: rgba(C.sell, 0.75),
  buyModel: rgba(C.buy, 0.38),
  sellModel: rgba(C.sell, 0.38),
  labelBack: rgba(C.bg, 0.86),
  cross: rgba(C.ink2, 0.55),
  zoneFill: rgba(C.zone, 0.1),
  zoneLine: rgba(C.zone, 0.55),
  startLine: rgba(C.accent, 0.55),
  priceLine: rgba(C.accent, 0.85),
  poc: rgba(C.ink1, 0.85),
  va: rgba(C.ink2, 0.45),
  buyRing: rgba(C.buyInk, 0.7),
  sellRing: rgba(C.sellInk, 0.7),
} as const;

export const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

export interface Layers {
  heat: boolean;
  bubbles: boolean;
  footprint: boolean;
  profile: boolean;
  levels: boolean;
  ob: boolean;
}

export interface LevelLine {
  price: number;
  label: string;
  color: string;
}

export interface Zone {
  t0: number;
  top: number;
  bottom: number;
  bull: boolean;
}

export interface ChartData {
  bars: readonly OHLCVBar[];
  tfMs: number;
  lastPrice: number;
  levels: LevelLine[];
  zones: Zone[];
}

export interface Layout {
  W: number;
  H: number;
  compact: boolean;
  plotX0: number;
  plotX1: number;
  plotY0: number;
  plotY1: number;
  profX0: number;
  profX1: number;
  axisX0: number;
  cvdY0: number;
  cvdY1: number;
  dY0: number;
  dY1: number;
  timeY0: number;
}

export const COMPACT_BELOW = 640;
/** Szerokość slotu świecy, od której pokazujemy liczby footprintu. */
export const FOOTPRINT_MIN_SLOT = 70;

export function computeLayout(W: number, H: number, profileOn: boolean): Layout {
  const compact = W < COMPACT_BELOW;
  const axisW = compact ? 50 : 64;
  const profW = profileOn ? (compact ? 46 : 88) : 0;
  const timeH = 22;
  const lowerH = compact ? 76 : Math.round(Math.min(150, Math.max(96, H * 0.22)));
  const plotY1 = Math.max(80, H - timeH - lowerH);
  const cvdY1 = plotY1 + Math.round(lowerH * 0.5);
  const plotX1 = Math.max(80, W - axisW - profW);
  return {
    W,
    H,
    compact,
    plotX0: 0,
    plotX1,
    plotY0: 0,
    plotY1,
    profX0: plotX1,
    profX1: plotX1 + profW,
    axisX0: W - axisW,
    cvdY0: plotY1,
    cvdY1,
    dY0: cvdY1,
    dY1: H - timeH,
    timeY0: H - timeH,
  };
}

export interface DrawOptions {
  layers: Layers;
  bubbleThr: number;
  /** Date.now() — wiek bąbli (animacja wejścia). */
  nowWall: number;
  reduceMotion: boolean;
  hover: { x: number; y: number } | null;
  startedAt: number | null;
}

const easeOutQuint = (t: number) => 1 - (1 - t) ** 5;

function hhmm(t: number, withSec: boolean): string {
  const d = new Date(t);
  const s = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return withSec ? `${s}:${String(d.getSeconds()).padStart(2, '0')}` : s;
}

export function fmtAxisPrice(p: number, step: number): string {
  return numLang(p.toLocaleString('en-US', { minimumFractionDigits: step < 1 ? 1 : 0, maximumFractionDigits: step < 1 ? 1 : 0 }));
}

/** Pierwszy indeks świecy z czasem ≥ t (świece rosnąco po czasie). */
export function lowerBoundBars(bars: readonly OHLCVBar[], t: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (bars[m].time < t) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** Słupek z zaokrąglonym końcem od strony wartości. */
function roundedBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, up: boolean) {
  const r = Math.min(3, w / 2, h);
  if (r < 1 || typeof ctx.roundRect !== 'function') {
    ctx.fillRect(x, y, w, h);
    return;
  }
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, up ? [r, r, 0, 0] : [0, 0, r, r]);
  ctx.fill();
}

interface AxisTag {
  y: number;
  text: string;
  bg: string;
  fg: string;
}

/** Rozsuwa etykiety osi (posortowane po y), żeby się nie nakładały; mieści je w [top, bottom]. */
export function spreadTags(ys: number[], minGap: number, top: number, bottom: number): number[] {
  const out = ys.slice();
  for (let i = 1; i < out.length; i++) if (out[i] < out[i - 1] + minGap) out[i] = out[i - 1] + minGap;
  if (out.length && out[out.length - 1] > bottom) {
    out[out.length - 1] = bottom;
    for (let i = out.length - 2; i >= 0; i--) if (out[i] > out[i + 1] - minGap) out[i] = out[i + 1] - minGap;
  }
  if (out.length && out[0] < top) {
    out[0] = top;
    for (let i = 1; i < out.length; i++) if (out[i] < out[i - 1] + minGap) out[i] = out[i - 1] + minGap;
  }
  return out;
}

export class OrderFlowRenderer {
  readonly heat: HeatTexture;
  // Prealokowane bufory (bez alokacji w pętlach rysowania)
  private readonly rowBid = new Float64Array(512);
  private readonly rowAsk = new Float64Array(512);
  private readonly rowFlags = new Uint8Array(512);
  private readonly pLB = new Float64Array(800);
  private readonly pLS = new Float64Array(800);
  private readonly pMB = new Float64Array(800);
  private readonly pMS = new Float64Array(800);
  private readonly pTot = new Float64Array(800);
  private readonly cvdPts = new Float64Array(16384);
  private readonly visBubbles = new Int32Array(20000);
  /** Prostokąty bloków footprintu w tej klatce (x0, x1, y0, y1) — bąble nad nimi są puste w środku. */
  private readonly fpRects = new Float64Array(4 * 64);
  private nFpRects = 0;
  // Agregacja bąbli przy oddaleniu (prealokowane)
  private readonly aggMap = new Map<number, number>();
  private readonly aggX = new Float64Array(8000);
  private readonly aggY = new Float64Array(8000);
  private readonly aggUsd = new Float64Array(8000);
  private readonly aggSide = new Uint8Array(8000);
  private fpK = 1;
  private fpRLo = 0;
  private pBucket = 5;
  private pBase = 0;
  private pN = 0;
  private dv = 0;
  private dReal = false;
  /** Bieżący DPR i grubość linii włosowej = całe piksele urządzenia (ostre linie także przy DPR 1.5). */
  private dpr = 1;
  private hw = 1;

  /** Przyciąga współrzędną CSS do siatki pikseli urządzenia. */
  private sn(v: number): number {
    return Math.round(v * this.dpr) / this.dpr;
  }
  /** Ostatni pomiar czasu rysowania (ms). */
  lastDrawMs = 0;

  constructor(store: OrderFlowStore) {
    this.heat = new HeatTexture(store.heatCap);
  }

  private readonly accFp = (cell: FpCell, idx: number): void => {
    const r = Math.floor(idx / this.fpK) - this.fpRLo;
    this.rowBid[r] += cell.sell;
    this.rowAsk[r] += cell.buy;
  };

  private readonly accProf = (cell: FpCell, idx: number): void => {
    const r = Math.floor((idx * FP_TICK) / this.pBucket) - this.pBase;
    if (r < 0 || r >= this.pN) return;
    this.pLB[r] += cell.buy;
    this.pLS[r] += cell.sell;
  };

  /** Rysuje całą klatkę. Zwraca true, gdy trwa animacja (potrzebna kolejna klatka). */
  draw(ctx: CanvasRenderingContext2D, dpr: number, L: Layout, f: Frame, data: ChartData, store: OrderFlowStore, o: DrawOptions): boolean {
    const t0perf = performance.now();
    const { W, H, compact } = L;
    const plotW = L.plotX1 - L.plotX0;
    const plotH = L.plotY1 - L.plotY0;
    const msPerPx = (f.t1 - f.t0) / plotW;
    const pSpan = f.pMax - f.pMin;
    let animating = false;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dpr = dpr;
    this.hw = Math.max(1, Math.round(dpr)) / dpr;
    const hw = this.hw;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    // ── Heatmapa: nowe kolumny, auto-kontrast, przemalowanie widocznych ──
    const s0 = Math.floor(f.t0 / 1000);
    const s1 = Math.ceil(f.t1 / 1000);
    if (o.layers.heat) {
      this.heat.sync(store);
      this.heat.updateNorm(store, s0, s1, t0perf);
      if (this.heat.refreshVisible(store, s0, s1)) animating = true;
      this.heat.flush();
    }

    // ── Siatka (hairline, ciągła) ──
    const pStep = priceTickStep(pSpan, plotH, compact ? 30 : 36);
    const tStep = timeStep(f.t1 - f.t0, plotW, compact ? 72 : 96);
    ctx.fillStyle = C.grid;
    for (let p = Math.ceil(f.pMin / pStep) * pStep; p <= f.pMax; p += pStep) {
      ctx.fillRect(L.plotX0, this.sn(priceToY(f, p)), L.profX1 - L.plotX0, hw);
    }
    for (let t = Math.ceil(f.t0 / tStep) * tStep; t <= f.t1; t += tStep) {
      ctx.fillRect(this.sn(timeToX(f, t)), L.plotY0, hw, L.dY1 - L.plotY0);
    }

    // ════════════ Panel ceny (przycięty) ════════════
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.plotX0, L.plotY0, plotW, plotH);
    ctx.clip();

    if (o.layers.heat) this.heat.draw(ctx, f, store);

    // Przed startem zapisu: brak danych order flow — lekkie przyciemnienie zamiast zgadywania
    const xStart = o.startedAt !== null ? timeToX(f, o.startedAt) : L.plotX1;
    if (xStart > L.plotX0) {
      ctx.fillStyle = K.shade;
      ctx.fillRect(L.plotX0, L.plotY0, Math.min(xStart, L.plotX1) - L.plotX0, plotH);
    }

    // Strefy OB (świeże): od świecy impulsu do prawej krawędzi
    if (o.layers.ob) {
      ctx.lineWidth = hw;
      for (const z of data.zones) {
        const x0 = Math.max(L.plotX0, timeToX(f, z.t0));
        if (x0 >= L.plotX1) continue;
        const yT = priceToY(f, z.top);
        const yB = priceToY(f, z.bottom);
        if (yB < L.plotY0 || yT > L.plotY1) continue;
        ctx.fillStyle = K.zoneFill;
        ctx.fillRect(x0, yT, L.plotX1 - x0, Math.max(2, yB - yT));
        ctx.strokeStyle = K.zoneLine;
        ctx.strokeRect(this.sn(x0) + hw / 2, this.sn(yT) + hw / 2, this.sn(L.plotX1 - x0), Math.max(2, this.sn(yB - yT)));
        if (yB - yT >= 12 && L.plotX1 - x0 > 60) {
          ctx.fillStyle = C.ink2;
          ctx.font = `10px ${MONO}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(z.bull ? 'OB ▲' : 'OB ▼', x0 + 4, (yT + yB) / 2);
        }
      }
    }

    // Świece + footprint
    const tf = data.tfMs;
    const slotW = tf / msPerPx;
    const wide = slotW >= FOOTPRINT_MIN_SLOT;
    const fpBucket = bucketFor(pSpan, plotH, 13, FP_TICK);
    const fpOn = o.layers.footprint && wide && fpBucket <= 250;
    const bars = data.bars;
    const iStart = lowerBoundBars(bars, f.t0 - tf);
    ctx.textBaseline = 'middle';
    const bodyW = wide ? 5 : Math.max(1, Math.min(9, slotW * 0.6));
    for (let i = iStart; i < bars.length; i++) {
      const b = bars[i];
      if (b.time > f.t1) break;
      const cx = this.candleX(f, L, b.time, slotW, wide, bodyW);
      const yH = priceToY(f, b.high);
      const yL = priceToY(f, b.low);
      const yO = priceToY(f, b.open);
      const yC = priceToY(f, b.close);
      const up = b.close >= b.open;
      ctx.fillStyle = up ? C.buy : C.sell;
      ctx.fillRect(this.sn(cx - hw / 2), yH, hw, Math.max(hw, yL - yH));
      const top = this.sn(Math.min(yO, yC));
      const h = Math.max(hw, this.sn(Math.abs(yC - yO)));
      const bx = this.sn(cx - bodyW / 2);
      const bw = Math.max(hw, this.sn(bodyW));
      if (bodyW >= 3) {
        ctx.fillStyle = C.bg;
        ctx.fillRect(bx - 1, top - 1, bw + 2, h + 2);
        ctx.fillStyle = up ? C.buy : C.sell;
      }
      ctx.fillRect(bx, top, bw, h);
    }

    // Footprint per świeca z magazynu (niezależnie od świec REST — liczy się tylko realny zapis)
    this.nFpRects = 0;
    if (fpOn) {
      for (let t = Math.floor((f.t0 - tf) / tf) * tf; t <= f.t1; t += tf) {
        const c = store.candleAt(t);
        if (!c || c.cells.size === 0) continue;
        const cx = this.candleX(f, L, t, slotW, wide, bodyW);
        // Blok liczb zaczyna się za świecą i przy pierwszej zapisanej transakcji (nie przed startem zapisu)
        const xa = Math.max(cx + bodyW / 2 + 5, timeToX(f, c.firstTs) + 3);
        // Na wąskim ekranie zostawiamy miejsce na opisy poziomów przy prawej krawędzi
        const xb = Math.min(timeToX(f, t) + slotW - 4, xa + 112, L.plotX1 - (compact && o.layers.levels ? 40 : 4));
        if (xb - xa >= 56) this.drawFootprint(ctx, f, L, c, xa, xb, fpBucket);
      }
    }

    // Bąble transakcji (pole ∝ USD), najnowsze na wierzchu
    if (o.layers.bubbles && store.bubbleCount > 0) {
      let nVis = 0;
      const sA = s0 - 1;
      const sB = s1 + 1;
      for (let k = 0; k < store.bubbleCount && nVis < this.visBubbles.length; k++) {
        const i = store.bubbleAt(k);
        const s = store.bSec[i];
        if (s < sA - 30) break; // pierścień w kolejności przyjścia (dopuszczamy lekkie spóźnienia)
        if (s < sA || s > sB || store.bUsd[i] < o.bubbleThr) continue;
        this.visBubbles[nVis++] = i;
      }
      const secPx = 1000 / msPerPx;
      if (secPx >= 1.5) {
        for (let n = nVis - 1; n >= 0; n--) {
          const i = this.visBubbles[n];
          const x = timeToX(f, store.bSec[i] * 1000 + 500);
          const y = priceToY(f, store.bPxSum[i] / store.bBtc[i]);
          // Promień ∝ √USD (pole ∝ wolumen): $50K → 2.4 px, $1M → 10.7 px, limit 24 px
          let r = Math.min(24, Math.max(2, 2.4 * Math.sqrt(store.bUsd[i] / 50_000)));
          if (y < L.plotY0 - r || y > L.plotY1 + r) continue;
          if (!o.reduceMotion) {
            const age = o.nowWall - store.bBorn[i];
            if (age >= 0 && age < 160) {
              r *= 0.6 + 0.4 * easeOutQuint(age / 160);
              animating = true;
            }
          }
          this.drawBubble(ctx, x, y, r, store.bSide[i] === 1);
        }
      } else {
        // Oddalenie: kwalifikujące się bąble sumowane w komórkach ekranu ~12 px (osobno kupno i sprzedaż),
        // pozycja = średnia ważona USD, promień względny do największej komórki (pole ∝ suma USD)
        const cell = 12;
        const m = this.aggMap;
        m.clear();
        let nAgg = 0;
        for (let n = 0; n < nVis; n++) {
          const i = this.visBubbles[n];
          const x = timeToX(f, store.bSec[i] * 1000 + 500);
          const y = priceToY(f, store.bPxSum[i] / store.bBtc[i]);
          if (y < L.plotY0 - cell || y > L.plotY1 + cell) continue;
          const side = store.bSide[i];
          const key = (Math.floor(x / cell) + 1000) * 100_000 + (Math.floor(y / cell) + 1000) * 2 + side;
          let a = m.get(key);
          if (a === undefined) {
            if (nAgg >= this.aggUsd.length) continue;
            a = nAgg++;
            m.set(key, a);
            this.aggX[a] = 0;
            this.aggY[a] = 0;
            this.aggUsd[a] = 0;
            this.aggSide[a] = side;
          }
          const u = store.bUsd[i];
          this.aggX[a] += x * u;
          this.aggY[a] += y * u;
          this.aggUsd[a] += u;
        }
        let maxU = 0;
        for (let a = 0; a < nAgg; a++) if (this.aggUsd[a] > maxU) maxU = this.aggUsd[a];
        for (let a = nAgg - 1; a >= 0; a--) {
          const u = this.aggUsd[a];
          const r = Math.max(2, 12 * Math.sqrt(u / maxU));
          this.drawBubble(ctx, this.aggX[a] / u, this.aggY[a] / u, r, this.aggSide[a] === 1);
        }
      }
    }

    // Poziomy HTF: cienkie linie ciągłe
    const tags: AxisTag[] = [];
    const inPlotLabels: { y: number; text: string }[] = [];
    if (o.layers.levels) {
      for (const lv of data.levels) {
        const y = priceToY(f, lv.price);
        if (y < L.plotY0 || y > L.plotY1) continue;
        ctx.fillStyle = lv.color;
        ctx.fillRect(L.plotX0, this.sn(y), plotW, hw);
        tags.push({ y, text: fmtAxisPrice(lv.price, 1), bg: lv.color, fg: C.page });
        inPlotLabels.push({ y, text: lv.label });
      }
    }

    // Bieżąca cena
    const lastY = Number.isFinite(data.lastPrice) ? priceToY(f, data.lastPrice) : Number.NaN;
    if (lastY >= L.plotY0 && lastY <= L.plotY1) {
      ctx.fillStyle = K.priceLine;
      ctx.fillRect(L.plotX0, this.sn(lastY), plotW, hw);
    }

    // Znacznik startu zapisu
    if (xStart > L.plotX0 && xStart < L.plotX1) {
      ctx.fillStyle = K.startLine;
      ctx.fillRect(this.sn(xStart), L.plotY0, hw, plotH);
    }

    // Opisy poziomów przy prawej krawędzi (nad linią, rozsunięte)
    if (inPlotLabels.length) {
      inPlotLabels.sort((a, b) => a.y - b.y);
      const ys = spreadTags(
        inPlotLabels.map((l) => l.y - 8),
        14,
        L.plotY0 + 8,
        L.plotY1 - 8
      );
      ctx.font = `10px ${MONO}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      inPlotLabels.forEach((l, k) => {
        const w = ctx.measureText(l.text).width;
        ctx.fillStyle = K.labelBack;
        ctx.fillRect(L.plotX1 - w - 10, ys[k] - 7, w + 8, 14);
        ctx.fillStyle = C.ink2;
        ctx.fillText(l.text, L.plotX1 - 6, ys[k] + 0.5);
      });
    }

    // Crosshair (panel ceny)
    const hov = o.hover;
    if (hov && hov.x >= L.plotX0 && hov.x <= L.plotX1) {
      ctx.fillStyle = K.cross;
      ctx.fillRect(this.sn(hov.x), L.plotY0, hw, plotH);
      if (hov.y >= L.plotY0 && hov.y <= L.plotY1) ctx.fillRect(L.plotX0, this.sn(hov.y), plotW, hw);
    }
    ctx.restore();

    // ════════════ Profil wolumenu ════════════
    if (o.layers.profile && L.profX1 > L.profX0) this.drawProfile(ctx, f, L, data, store, o.startedAt);

    // ════════════ Panele dolne: CVD i Δ świecy ════════════
    this.drawLower(ctx, f, L, data, store, o, slotW, wide);

    // Crosshair w panelach dolnych
    if (hov && hov.x >= L.plotX0 && hov.x <= L.plotX1) {
      ctx.fillStyle = K.cross;
      ctx.fillRect(this.sn(hov.x), L.cvdY0, hw, L.dY1 - L.cvdY0);
    }

    // Separatory paneli
    ctx.fillStyle = C.divider;
    ctx.fillRect(0, this.sn(L.cvdY0), L.plotX1, hw);
    ctx.fillRect(0, this.sn(L.dY0), L.plotX1, hw);
    ctx.fillRect(0, this.sn(L.timeY0), W, hw);
    ctx.fillRect(this.sn(L.axisX0), 0, hw, L.timeY0);
    if (L.profX1 > L.profX0) ctx.fillRect(this.sn(L.profX0), 0, hw, L.plotY1);

    // ════════════ Oś ceny ════════════
    ctx.font = `10px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const axX = L.axisX0 + 6;
    // Znaczniki: poziomy, cena bieżąca, crosshair (na wierzchu); zwykłe etykiety omijają znaczniki
    if (lastY >= L.plotY0 && lastY <= L.plotY1) {
      tags.push({ y: lastY, text: fmtAxisPrice(data.lastPrice, compact ? 1 : 0.5), bg: C.accent, fg: C.page });
    }
    tags.sort((a, b) => a.y - b.y);
    const ys = spreadTags(
      tags.map((t) => t.y),
      16,
      L.plotY0 + 8,
      L.plotY1 - 8
    );
    const hovTagY = hov && hov.y >= L.plotY0 && hov.y <= L.plotY1 && hov.x <= L.profX1 ? hov.y : Number.NaN;
    ctx.fillStyle = C.ink3;
    for (let p = Math.ceil(f.pMin / pStep) * pStep; p <= f.pMax; p += pStep) {
      const y = priceToY(f, p);
      if (y < L.plotY0 + 6 || y > L.plotY1 - 6) continue;
      let clash = Math.abs(y - hovTagY) < 14;
      for (let k = 0; k < ys.length && !clash; k++) if (Math.abs(y - ys[k]) < 14) clash = true;
      if (!clash) ctx.fillText(fmtAxisPrice(p, pStep), axX, y);
    }
    if (tags.length) {
      ctx.font = `600 10px ${MONO}`;
      tags.forEach((t, k) => {
        ctx.fillStyle = t.bg;
        ctx.fillRect(L.axisX0 + 1, ys[k] - 8, W - L.axisX0 - 1, 16);
        ctx.fillStyle = t.fg;
        ctx.fillText(t.text, axX, ys[k] + 0.5);
      });
    }
    if (hov && hov.y >= L.plotY0 && hov.y <= L.plotY1 && hov.x <= L.profX1) {
      const p = f.pMax - ((hov.y - f.y0) / (f.y1 - f.y0)) * pSpan;
      ctx.fillStyle = C.tip;
      ctx.fillRect(L.axisX0 + 1, hov.y - 8, W - L.axisX0 - 1, 16);
      ctx.fillStyle = C.ink1;
      ctx.font = `10px ${MONO}`;
      ctx.fillText(fmtAxisPrice(p, compact ? 1 : 0.5), axX, hov.y + 0.5);
    }

    // ════════════ Oś czasu ════════════
    ctx.font = `10px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tyText = L.timeY0 + 11.5;
    const startTagX = xStart > L.plotX0 && xStart < L.plotX1 ? xStart : Number.NaN;
    const startText = o.startedAt === null ? '' : compact ? `▸ ${hhmm(o.startedAt, false)}` : `start zapisu ${hhmm(o.startedAt, false)}`;
    ctx.font = `600 10px ${MONO}`;
    const startTagW = Math.ceil(ctx.measureText(startText).width) + 12;
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = C.ink3;
    const hovX = hov && hov.x >= L.plotX0 && hov.x <= L.plotX1 ? hov.x : Number.NaN;
    for (let t = Math.ceil(f.t0 / tStep) * tStep; t <= f.t1; t += tStep) {
      const x = timeToX(f, t);
      if (x < L.plotX0 + 24 || x > L.plotX1 - 20) continue;
      if (Math.abs(x - startTagX) < startTagW / 2 + 26) continue;
      if (Math.abs(x - hovX) < 62) continue;
      ctx.fillText(hhmm(t, tStep < 60_000), x, tyText);
    }
    if (Number.isFinite(startTagX) && startText) {
      const x = Math.min(L.plotX1 - startTagW / 2, Math.max(L.plotX0 + startTagW / 2, startTagX));
      ctx.fillStyle = C.accent;
      ctx.fillRect(x - startTagW / 2, L.timeY0 + 3, startTagW, 16);
      ctx.fillStyle = C.page;
      ctx.font = `600 10px ${MONO}`;
      ctx.fillText(startText, x, tyText);
      ctx.font = `10px ${MONO}`;
    }
    if (hov && hov.x >= L.plotX0 && hov.x <= L.plotX1) {
      const t = f.t0 + ((hov.x - f.x0) / (f.x1 - f.x0)) * (f.t1 - f.t0);
      const w = 62;
      const x = Math.min(L.plotX1 - w / 2, Math.max(w / 2, hov.x));
      ctx.fillStyle = C.tip;
      ctx.fillRect(x - w / 2, L.timeY0 + 3, w, 16);
      ctx.fillStyle = C.ink1;
      ctx.fillText(hhmm(t, true), x, tyText);
    }

    this.lastDrawMs = performance.now() - t0perf;
    return animating;
  }

  /** Komórki footprintu świecy: sprzedaż | kupno agresora (BTC), nierównowaga 3:1, POC obrysem. */
  private drawFootprint(ctx: CanvasRenderingContext2D, f: Frame, L: Layout, c: FpCandle, xa: number, xb: number, bucket: number): void {
    const k = bucket / FP_TICK;
    const rLo = Math.floor(c.minIdx / k);
    const n = Math.floor(c.maxIdx / k) - rLo + 1;
    if (n <= 0 || n > this.rowBid.length) return;
    this.rowBid.fill(0, 0, n);
    this.rowAsk.fill(0, 0, n);
    this.fpK = k;
    this.fpRLo = rLo;
    c.cells.forEach(this.accFp);
    let maxV = 0;
    let poc = -1;
    for (let r = 0; r < n; r++) {
      const v = this.rowBid[r] + this.rowAsk[r];
      if (v > maxV) {
        maxV = v;
        poc = r;
      }
    }
    detectImbalances(this.rowBid, this.rowAsk, n, 3, maxV * 0.03, this.rowFlags);
    const w = xb - xa;
    const mid = Math.round(xa + w / 2);
    ctx.font = `10px ${MONO}`;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (let r = 0; r < n; r++) {
      const vb = this.rowBid[r];
      const va = this.rowAsk[r];
      if (vb + va <= 0) continue;
      const lo = (rLo + r) * bucket;
      const yT = Math.round(priceToY(f, lo + bucket));
      const yB = Math.round(priceToY(f, lo));
      if (yB < L.plotY0 || yT > L.plotY1) continue;
      const h = yB - yT;
      const flags = this.rowFlags[r];
      ctx.fillStyle = K.cellBack;
      ctx.fillRect(xa, yT + 1, w, h - 1);
      if (flags & IMB_SELL) {
        ctx.fillStyle = K.sell25;
        ctx.fillRect(xa, yT + 1, mid - xa, h - 1);
      }
      if (flags & IMB_BUY) {
        ctx.fillStyle = K.buy25;
        ctx.fillRect(mid + 1, yT + 1, xb - mid - 1, h - 1);
      }
      const ym = yT + h / 2 + 0.5;
      ctx.textAlign = 'right';
      ctx.fillStyle = vb <= 0 ? C.ink3 : flags & IMB_SELL ? C.ink1 : C.ink2;
      ctx.fillText(fmtVol(vb), mid - 5, ym);
      ctx.textAlign = 'left';
      ctx.fillStyle = va <= 0 ? C.ink3 : flags & IMB_BUY ? C.ink1 : C.ink2;
      ctx.fillText(fmtVol(va), mid + 6, ym);
      if (yT < yMin) yMin = yT;
      if (yB > yMax) yMax = yB;
      if (r === poc) {
        ctx.strokeStyle = K.poc;
        ctx.lineWidth = this.hw;
        ctx.strokeRect(this.sn(xa) + this.hw / 2, yT + this.hw / 2, this.sn(w) - this.hw, h);
      }
    }
    if (yMax > yMin) {
      ctx.fillStyle = C.divider;
      ctx.fillRect(this.sn(mid), yMin + 1, this.hw, yMax - yMin - 1);
      if (this.nFpRects < 64) {
        const o = this.nFpRects++ * 4;
        this.fpRects[o] = xa;
        this.fpRects[o + 1] = xb;
        this.fpRects[o + 2] = yMin;
        this.fpRects[o + 3] = yMax;
      }
    }
  }

  /**
   * Środek świecy: w wąskim slocie pośrodku; w szerokim przy lewej krawędzi slotu,
   * „przyklejony” do krawędzi widoku, gdy początek świecy jest poza ekranem.
   */
  private candleX(f: Frame, L: Layout, t: number, slotW: number, wide: boolean, bodyW: number): number {
    const x0 = timeToX(f, t);
    if (!wide) return x0 + slotW / 2;
    return Math.min(x0 + slotW - 3 - bodyW / 2, Math.max(x0, L.plotX0) + 3 + bodyW / 2);
  }

  /** Bąbel: wypełnienie 75% z pierścieniem 2 px w kolorze tła; nad footprintem tylko pierścień. */
  private drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, buy: boolean): void {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (this.overFootprint(x, y)) {
      // Nad liczbami footprintu: sam pierścień, żeby liczby pozostały czytelne
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = buy ? K.buyRing : K.sellRing;
      ctx.stroke();
      return;
    }
    ctx.fillStyle = buy ? K.buy75 : K.sell75;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = C.bg;
    ctx.stroke();
    // Drugi kanał strony: „+” kupno, „−” sprzedaż
    if (r >= 8) {
      const a = r * 0.42;
      ctx.fillStyle = C.bg;
      ctx.fillRect(x - a, y - 1, a * 2, 2);
      if (buy) ctx.fillRect(x - 1, y - a, 2, a * 2);
    }
  }

  private overFootprint(x: number, y: number): boolean {
    for (let k = 0; k < this.nFpRects; k++) {
      const o = k * 4;
      if (x >= this.fpRects[o] && x <= this.fpRects[o + 1] && y >= this.fpRects[o + 2] && y <= this.fpRects[o + 3]) return true;
    }
    return false;
  }

  /** Profil wolumenu w widocznym oknie: realny z footprintu, MODEL (BVC) dla świec sprzed zapisu. */
  private drawProfile(ctx: CanvasRenderingContext2D, f: Frame, L: Layout, data: ChartData, store: OrderFlowStore, startedAt: number | null): void {
    const plotH = L.plotY1 - L.plotY0;
    const span = f.pMax - f.pMin;
    let pb = bucketFor(span, plotH, 3, FP_TICK);
    while (span / pb + 2 > this.pTot.length) pb *= 2;
    const base = Math.floor(f.pMin / pb);
    const n = Math.floor(f.pMax / pb) - base + 1;
    this.pBucket = pb;
    this.pBase = base;
    this.pN = n;
    this.pLB.fill(0, 0, n);
    this.pLS.fill(0, 0, n);
    this.pMB.fill(0, 0, n);
    this.pMS.fill(0, 0, n);
    const tf = data.tfMs;
    const bars = data.bars;
    for (let i = lowerBoundBars(bars, f.t0 - tf + 1); i < bars.length; i++) {
      const b = bars[i];
      if (b.time >= f.t1) break;
      const c = store.candleAt(b.time);
      let real = 0;
      if (c) {
        real = c.buy + c.sell;
        c.cells.forEach(this.accProf);
      }
      // Świeca (częściowo) sprzed startu zapisu: brakujący wolumen rozkładamy równomiernie w zakresie H–L
      const recorded = startedAt !== null && b.time >= startedAt;
      if (recorded || !(b.close > 0)) continue;
      const tot = (b.vbuy + b.vsell) / b.close;
      const rem = tot - real;
      if (!(rem > 0)) continue;
      const share = b.vbuy + b.vsell > 0 ? b.vbuy / (b.vbuy + b.vsell) : 0.5;
      const r0 = Math.max(0, Math.floor(b.low / pb) - base);
      const r1 = Math.min(n - 1, Math.floor(b.high / pb) - base);
      const all1 = Math.floor(b.high / pb) - Math.floor(b.low / pb) + 1;
      if (r1 < r0) continue;
      const per = rem / all1;
      for (let r = r0; r <= r1; r++) {
        this.pMB[r] += per * share;
        this.pMS[r] += per * (1 - share);
      }
    }
    let max = 0;
    for (let r = 0; r < n; r++) {
      const v = this.pLB[r] + this.pLS[r] + this.pMB[r] + this.pMS[r];
      this.pTot[r] = v;
      if (v > max) max = v;
    }
    if (max <= 0) return;
    const va = valueArea(this.pTot, n, 0.7);
    const x0 = L.profX0 + 3;
    const maxLen = L.profX1 - L.profX0 - 8;
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.profX0 + 1, L.plotY0, L.profX1 - L.profX0 - 1, plotH);
    ctx.clip();
    for (let r = 0; r < n; r++) {
      const v = this.pTot[r];
      if (v <= 0) continue;
      const lo = (base + r) * pb;
      const yT = priceToY(f, lo + pb);
      const yB = priceToY(f, lo);
      const h = Math.max(1, yB - yT - (yB - yT >= 4 ? 1 : 0));
      const len = (v / max) * maxLen;
      const gap = len > 6 ? 2 : 0;
      const usable = len - gap;
      const lsW = (this.pLS[r] / v) * usable;
      const msW = (this.pMS[r] / v) * usable;
      const lbW = (this.pLB[r] / v) * usable;
      const mbW = (this.pMB[r] / v) * usable;
      let x = x0;
      if (lsW > 0) {
        ctx.fillStyle = C.sell;
        ctx.fillRect(x, yT, lsW, h);
        x += lsW;
      }
      if (msW > 0) {
        ctx.fillStyle = K.sellModel;
        ctx.fillRect(x, yT, msW, h);
        x += msW;
      }
      x += gap;
      if (lbW > 0) {
        ctx.fillStyle = C.buy;
        ctx.fillRect(x, yT, lbW, h);
        x += lbW;
      }
      if (mbW > 0) {
        ctx.fillStyle = K.buyModel;
        ctx.fillRect(x, yT, mbW, h);
      }
      if (va && r === va.poc) {
        ctx.strokeStyle = K.poc;
        ctx.lineWidth = this.hw;
        ctx.strokeRect(this.sn(x0 - 2) + this.hw / 2, this.sn(yT - 1) + this.hw / 2, this.sn(len + 4) - this.hw, this.sn(h + 2) - this.hw);
      }
    }
    if (va) {
      ctx.font = `9px ${MONO}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const lineAt = (y: number, text: string) => {
        ctx.fillStyle = K.va;
        ctx.fillRect(L.profX0 + 1, this.sn(y), L.profX1 - L.profX0 - 1, this.hw);
        if (!L.compact) {
          ctx.fillStyle = C.ink3;
          ctx.fillText(text, L.profX1 - 3, y + (text === 'VAH' ? -6 : 6));
        }
      };
      lineAt(priceToY(f, (base + va.hi + 1) * pb), 'VAH');
      lineAt(priceToY(f, (base + va.lo) * pb), 'VAL');
      const pocLen = (this.pTot[va.poc] / max) * maxLen;
      if (!L.compact && pocLen < maxLen - 26) {
        const yP = priceToY(f, (base + va.poc + 0.5) * pb);
        ctx.fillStyle = C.ink1;
        ctx.fillText('POC', L.profX1 - 3, yP);
      }
    }
    ctx.restore();
  }

  /** CVD realnego agresora od startu zapisu (linia 2 px) i Δ per świeca (słupki ≤ 24 px). */
  private drawLower(
    ctx: CanvasRenderingContext2D,
    f: Frame,
    L: Layout,
    data: ChartData,
    store: OrderFlowStore,
    _o: DrawOptions,
    slotW: number,
    wide: boolean
  ): void {
    const plotW = L.plotX1 - L.plotX0;
    ctx.font = `10px ${MONO}`;
    ctx.textBaseline = 'middle';

    // ── CVD ──
    const cy0 = L.cvdY0 + 18;
    const cy1 = L.cvdY1 - 6;
    let label = 'CVD agresora HL · BTC';
    if (store.firstTradeSec >= 0) {
      const nowSec = Math.floor(store.nowMs() / 1000);
      const sA = Math.max(Math.floor(f.t0 / 1000), store.firstTradeSec);
      const sB = Math.min(Math.ceil(f.t1 / 1000), Math.max(store.lastTradeSec, nowSec));
      if (sB >= sA) {
        let cvd = store.cvdBefore(sA);
        let min = Math.min(0, cvd);
        let max = Math.max(0, cvd);
        let nPts = 0;
        const pts = this.cvdPts;
        const cap = pts.length - 2;
        let lastPx = Number.NaN;
        // Punkt startowy na początku pierwszej sekundy
        pts[nPts++] = timeToX(f, sA * 1000);
        pts[nPts++] = cvd;
        const stride = Math.max(1, Math.floor((sB - sA) / 6000));
        for (let s = sA; s <= sB; s += stride) {
          for (let q = 0; q < stride; q++) cvd += store.secDelta(s + q);
          const x = timeToX(f, (s + stride) * 1000);
          const xp = Math.round(x);
          if (cvd < min) min = cvd;
          if (cvd > max) max = cvd;
          if (xp === lastPx && nPts >= 4) {
            pts[nPts - 1] = cvd; // ta sama kolumna piksela — ostatnia wartość
          } else if (nPts < cap) {
            pts[nPts++] = x;
            pts[nPts++] = cvd;
            lastPx = xp;
          }
        }
        const range = Math.max(1e-6, max - min);
        const yOf = (v: number) => cy1 - ((v - min) / range) * (cy1 - cy0);
        ctx.save();
        ctx.beginPath();
        ctx.rect(L.plotX0, L.cvdY0 + 1, plotW, L.cvdY1 - L.cvdY0 - 1);
        ctx.clip();
        ctx.fillStyle = C.grid;
        ctx.fillRect(L.plotX0, this.sn(yOf(0)), plotW, this.hw);
        ctx.strokeStyle = C.series1;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let k = 0; k < nPts; k += 2) {
          const y = yOf(pts[k + 1]);
          if (k === 0) ctx.moveTo(pts[k], y);
          else ctx.lineTo(pts[k], y);
        }
        ctx.stroke();
        ctx.restore();
        // Wartości osi panelu
        ctx.textAlign = 'left';
        ctx.fillStyle = C.ink3;
        if (!L.compact || L.cvdY1 - L.cvdY0 > 34) {
          ctx.fillText(fmtSignedVol(max), L.axisX0 + 6, cy0);
          ctx.fillText(fmtSignedVol(min), L.axisX0 + 6, cy1);
        }
        label = `CVD agresora HL · BTC · ostatnio ${fmtSignedVol(cvd)}`;
      }
    } else {
      label = 'CVD agresora HL · czekam na transakcje';
    }
    this.paneLegend(ctx, L.plotX0 + 6, L.cvdY0 + 9, [{ text: label, color: C.series1, line: true }]);

    // ── Δ per świeca ──
    const mid = Math.round((L.dY0 + 14 + L.dY1 - 4) / 2);
    const half = (L.dY1 - 4 - (L.dY0 + 14)) / 2;
    const tf = data.tfMs;
    const bars = data.bars;
    const iStart = lowerBoundBars(bars, f.t0 - tf);
    let maxAbs = 0;
    let anyModel = false;
    for (let i = iStart; i < bars.length && bars[i].time <= f.t1; i++) {
      this.barDelta(bars[i], store);
      if (Math.abs(this.dv) > maxAbs) maxAbs = Math.abs(this.dv);
      if (!this.dReal) anyModel = true;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.plotX0, L.dY0 + 1, plotW, L.dY1 - L.dY0 - 1);
    ctx.clip();
    ctx.fillStyle = C.grid;
    ctx.fillRect(L.plotX0, this.sn(mid), plotW, this.hw);
    if (maxAbs > 0) {
      const bw = Math.max(1, Math.min(24, slotW * 0.6));
      for (let i = iStart; i < bars.length && bars[i].time <= f.t1; i++) {
        const b = bars[i];
        this.barDelta(b, store);
        if (this.dv === 0) continue;
        const x0 = timeToX(f, b.time);
        // Szeroka świeca: słupek przy lewej krawędzi slotu, „przyklejony” do krawędzi widoku
        const xc = wide ? Math.min(x0 + slotW - bw / 2 - 2, Math.max(x0, L.plotX0) + 2 + bw / 2) : x0 + slotW / 2;
        const h = Math.max(1, (Math.abs(this.dv) / maxAbs) * half);
        const up = this.dv > 0;
        ctx.fillStyle = up ? (this.dReal ? C.buy : K.buyModel) : this.dReal ? C.sell : K.sellModel;
        roundedBar(ctx, xc - bw / 2, up ? mid - h : mid + 1, bw, h, up);
      }
    }
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.fillStyle = C.ink3;
    if (maxAbs > 0 && (!L.compact || L.dY1 - L.dY0 > 34)) ctx.fillText(fmtSignedVol(maxAbs), L.axisX0 + 6, L.dY0 + 14);
    const items: { text: string; color?: string; line?: boolean }[] = [
      { text: 'Δ świecy · BTC' },
      { text: '+ kupno', color: C.buy },
      { text: '− sprzedaż', color: C.sell },
    ];
    if (anyModel) items.push({ text: 'MODEL (BVC)', color: K.buyModel });
    this.paneLegend(ctx, L.plotX0 + 6, L.dY0 + 9, L.compact ? items.slice(0, 1).concat(anyModel ? [items[3]] : []) : items);
  }

  /** Delta świecy do pól dv/dReal: realna z footprintu (gdy jest), inaczej estymata BVC (MODEL). */
  private barDelta(b: OHLCVBar, store: OrderFlowStore): void {
    const c = store.candleAt(b.time);
    this.dReal = c !== undefined;
    this.dv = c ? c.buy - c.sell : b.close > 0 ? (b.vbuy - b.vsell) / b.close : 0;
  }

  private paneLegend(ctx: CanvasRenderingContext2D, x: number, y: number, items: { text: string; color?: string; line?: boolean }[]): void {
    ctx.font = `10px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let w = 0;
    for (const it of items) w += (it.color ? 14 : 0) + ctx.measureText(it.text).width + 10;
    ctx.fillStyle = K.labelBack;
    ctx.fillRect(x - 4, y - 7, w + 2, 14);
    let cx = x;
    for (const it of items) {
      if (it.color) {
        ctx.fillStyle = it.color;
        if (it.line) ctx.fillRect(cx, y - 1, 10, 2);
        else ctx.fillRect(cx + 1, y - 4, 8, 8);
        cx += 14;
      }
      ctx.fillStyle = it.color ? C.ink2 : C.ink3;
      ctx.fillText(it.text, cx, y + 0.5);
      cx += ctx.measureText(it.text).width + 10;
    }
  }
}

/** Wolumen ze znakiem (BTC): +12.4 / −3.05 / +1.2K. */
export function fmtSignedVol(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const s = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${s}${fmtVol(Math.abs(v))}`;
}
