import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Layers, RotateCcw, SlidersHorizontal, Table2, X, ZoomIn, ZoomOut } from 'lucide-react';
import {
  LevelStatus,
  LiquidationHeatmapCell,
  OHLCVBar,
  QuantMathMetrics,
  ShaakuniConfig,
  ShaakuniState,
} from '../types/trading';
import { DASH, fmtCompact, fmtPrice } from '../ui';

interface ShaakuniAggrChart2DProps {
  bars: OHLCVBar[];
  shaakuni: ShaakuniState;
  config: ShaakuniConfig;
  onChangeConfig: React.Dispatch<React.SetStateAction<ShaakuniConfig>>;
  heatmap: LiquidationHeatmapCell[];
  quant: QuantMathMetrics;
  timeframeLabel: string;
}

// Kolory płótna = tokeny z src/index.css (@theme); canvas nie widzi klas Tailwind
const C = {
  page: '#070a11',
  bg: '#0b1019', // surface-1
  tip: '#16202f', // surface-3
  grid: '#1b2533', // line (hairline)
  divider: '#283447', // line-strong
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
  series2: '#d95926',
} as const;

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const MONO = '"IBM Plex Mono", ui-monospace, monospace';
const COMPACT_BELOW = 640;
const DEFAULT_BARS = { wide: 85, compact: 48 };
const BOTTOM_SCALE = 24;
const HINT =
  'Przeciągnij: przesuwanie · oś cen: rozciąganie ceny · oś czasu: rozciąganie czasu · kółko lub szczypanie: zoom świec · podwójny klik/stuknięcie: reset';

const STATUS_PL: Record<LevelStatus, string> = { Active: 'aktywny', 'Sweep !': 'sweep', Break: 'przebity' };

/** Geometria ostatniego rysunku — wspólna dla rysowania i obsługi wskaźnika (crosshair, przeciąganie). */
interface ChartLayout {
  visibleBars: OHLCVBar[];
  barSpacing: number;
  chartWidth: number;
  candlesPlotWidth: number;
  rightScaleWidth: number;
  pricePaneTop: number;
  pricePaneHeight: number;
  maxPrice: number;
  priceRange: number;
}

type Overlay = 'none' | 'layers' | 'levels' | 'params';

/** Słupek z zaokrąglonym końcem (od strony wartości). */
function roundedBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, up: boolean) {
  const r = Math.min(2, w / 2, h);
  if (r < 1 || typeof ctx.roundRect !== 'function') {
    ctx.fillRect(x, y, w, h);
    return;
  }
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, up ? [r, r, 0, 0] : [0, 0, r, r]);
  ctx.fill();
}

const hhmm = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const ShaakuniAggrChart2D: React.FC<ShaakuniAggrChart2DProps> = ({
  bars,
  shaakuni,
  config,
  onChangeConfig,
  heatmap,
  quant,
  timeframeLabel,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<ChartLayout | null>(null);

  // Rozmiar obszaru płótna (ResizeObserver) i tryb kompaktowy (< 640 px)
  const [size, setSize] = useState({ w: 0, h: 0 });
  const compact = size.w > 0 && size.w < COMPACT_BELOW;
  // Średnia szerokość (tablet / wąski desktop): pasek narzędzi bez części podpisów
  const dense = !compact && size.w < 1000;
  const defaultBars = compact ? DEFAULT_BARS.compact : DEFAULT_BARS.wide;

  // Pan & zoom
  const [visibleBarCount, setVisibleBarCount] = useState<number>(DEFAULT_BARS.wide);
  const [panOffsetBars, setPanOffsetBars] = useState<number>(0); // 0 = prawa krawędź (na żywo)
  const [priceZoomMultiplier, setPriceZoomMultiplier] = useState<number>(1.0); // 1.0 = auto-dopasowanie
  const [priceCenterOffsetUsd, setPriceCenterOffsetUsd] = useState<number>(0);
  const [overlay, setOverlay] = useState<Overlay>('none');

  // Crosshair: czas świecy zamiast obiektu świecy (obiekt starzeje się przy każdym ticku)
  const [hover, setHover] = useState<{ time: number; x: number; y: number; price: number } | null>(null);

  // Stan gestów
  const dragModeRef = useRef<'NONE' | 'PAN' | 'STRETCH_Y' | 'STRETCH_X' | 'PINCH'>('NONE');
  const dragStartRef = useRef({
    clientX: 0,
    clientY: 0,
    startPanBars: 0,
    startPriceOffset: 0,
    startPriceZoom: 1.0,
    startBarCount: DEFAULT_BARS.wide,
  });
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef({ startDist: 1, startCount: DEFAULT_BARS.wide });
  const tapRef = useRef({ moved: false, lastTapAt: 0 });

  const resetView = useCallback(() => {
    setPanOffsetBars(0);
    setPriceZoomMultiplier(1.0);
    setPriceCenterOffsetUsd(0);
    setVisibleBarCount(defaultBars);
  }, [defaultBars]);

  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const measure = (w: number, h: number) =>
      setSize((s) => (s.w === Math.round(w) && s.h === Math.round(h) ? s : { w: Math.round(w), h: Math.round(h) }));
    const r = el.getBoundingClientRect();
    measure(r.width, r.height);
    const ro = new ResizeObserver(([entry]) => measure(entry.contentRect.width, entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Zmiana trybu (obrót telefonu, zmiana szerokości) → domyślna liczba świec dla tej szerokości
  useEffect(() => {
    setVisibleBarCount(compact ? DEFAULT_BARS.compact : DEFAULT_BARS.wide);
  }, [compact]);

  // Zoom kółkiem: natywny listener { passive: false } — React rejestruje wheel pasywnie i preventDefault nie działa
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 8 : -8;
      setVisibleBarCount((c) => Math.max(15, Math.min(300, c + delta)));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // Nakładki: Escape i klik poza nimi zamykają
  useEffect(() => {
    if (overlay === 'none') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOverlay('none');
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest('[data-chart-overlay],[data-overlay-toggle]')) setOverlay('none');
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [overlay]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const { w: width, h: height } = size;
    if (!canvas || width === 0 || height === 0 || bars.length < 5) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, width, height);

    const rightScaleWidth = compact ? 58 : 76;
    const chartWidth = width - rightScaleWidth;
    const futureForecastWidth = compact ? 40 : 84; // miejsce na przedłużenia OB, etykiety i zakres modelu
    const candlesPlotWidth = Math.max(100, chartWidth - futureForecastWidth);

    // Panele pionowe: cena 67% · CVD 16.5% · delta 16.5%
    const pricePaneTop = 8;
    const pricePaneBottom = Math.floor((height - BOTTOM_SCALE) * 0.67);
    const pricePaneHeight = Math.max(80, pricePaneBottom - pricePaneTop);

    const cvdPaneTop = pricePaneBottom + 4;
    const cvdPaneBottom = Math.floor((height - BOTTOM_SCALE) * 0.835);
    const cvdPaneHeight = Math.max(30, cvdPaneBottom - cvdPaneTop);

    const deltaPaneTop = cvdPaneBottom + 4;
    const deltaPaneBottom = height - BOTTOM_SCALE;
    const deltaPaneHeight = Math.max(30, deltaPaneBottom - deltaPaneTop);

    // Widoczny wycinek świec z uwzględnieniem przesunięcia
    const count = Math.min(bars.length, Math.max(15, Math.min(300, visibleBarCount)));
    const maxPan = Math.max(0, bars.length - count);
    const clampedPan = Math.max(0, Math.min(maxPan, Math.round(panOffsetBars)));

    const sliceEnd = bars.length - clampedPan;
    const sliceStart = Math.max(0, sliceEnd - count);
    const visibleBars = bars.slice(sliceStart, sliceEnd);
    if (visibleBars.length === 0) return;

    // Zakres cen z mnożnikiem zoomu i przesunięciem środka
    let rawMinPrice = Infinity;
    let rawMaxPrice = -Infinity;
    for (const b of visibleBars) {
      if (b.low < rawMinPrice) rawMinPrice = b.low;
      if (b.high > rawMaxPrice) rawMaxPrice = b.high;
    }
    if (config.showDay && shaakuni.pdh && shaakuni.pdl) {
      rawMinPrice = Math.min(rawMinPrice, shaakuni.pdl);
      rawMaxPrice = Math.max(rawMaxPrice, shaakuni.pdh);
    }
    if (config.showNeuralCone && quant.forecastHorizon.length > 0) {
      for (const fh of quant.forecastHorizon) {
        rawMinPrice = Math.min(rawMinPrice, fh.lower1Sigma);
        rawMaxPrice = Math.max(rawMaxPrice, fh.upper1Sigma);
      }
    }

    const midPrice = (rawMaxPrice + rawMinPrice) * 0.5 + priceCenterOffsetUsd;
    const baseSpan = Math.max(25, (rawMaxPrice - rawMinPrice) * 1.15);
    const zoomedSpan = baseSpan / Math.max(0.2, priceZoomMultiplier);

    const minPrice = midPrice - zoomedSpan * 0.5;
    const maxPrice = midPrice + zoomedSpan * 0.5;
    const priceRange = Math.max(1, maxPrice - minPrice);

    const priceToY = (p: number) => pricePaneTop + ((maxPrice - p) / priceRange) * pricePaneHeight;
    const yToPrice = (y: number) => maxPrice - ((y - pricePaneTop) / pricePaneHeight) * priceRange;

    const barSpacing = candlesPlotWidth / Math.max(1, visibleBars.length);
    const candleWidth = Math.max(2, Math.min(14, barSpacing * 0.68));
    const barIndexToX = (globalIdx: number) => (globalIdx - sliceStart) * barSpacing + barSpacing * 0.5;
    const xOf = (i: number) => i * barSpacing + barSpacing * 0.5;
    const crisp = (v: number) => Math.round(v) + 0.5; // ostra linia 1 px

    // Siatka hairline (ciągła) i etykiety osi cen
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.font = `10px ${MONO}`;
    ctx.textAlign = 'left';
    const gridSteps = compact ? 5 : 7;
    for (let i = 0; i <= gridSteps; i++) {
      const y = crisp(pricePaneTop + (pricePaneHeight / gridSteps) * i);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(chartWidth, y);
      ctx.stroke();
      ctx.fillStyle = C.ink3;
      ctx.fillText(yToPrice(y).toFixed(0), chartWidth + 6, y + 3);
    }
    // Linia zera delty
    const deltaMidY = deltaPaneTop + deltaPaneHeight * 0.5;
    ctx.beginPath();
    ctx.moveTo(0, crisp(deltaMidY));
    ctx.lineTo(chartWidth, crisp(deltaMidY));
    ctx.stroke();

    // Separatory paneli
    ctx.strokeStyle = C.divider;
    ctx.beginPath();
    ctx.moveTo(0, crisp(pricePaneBottom + 2));
    ctx.lineTo(width, crisp(pricePaneBottom + 2));
    ctx.moveTo(0, crisp(cvdPaneBottom + 2));
    ctx.lineTo(width, crisp(cvdPaneBottom + 2));
    ctx.moveTo(crisp(chartWidth), 0);
    ctx.lineTo(crisp(chartWidth), height);
    ctx.stroke();

    // ── Panel ceny: wszystko przycięte do jego prostokąta (świece nie wchodzą w CVD/deltę) ──
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, pricePaneTop, width, pricePaneBottom - pricePaneTop);
    ctx.clip();

    // 1. Mapa płynności (jednobarwna skala sekwencyjna — intensywność = krycie)
    if (config.showLiqHeatmap) {
      for (const cell of heatmap) {
        const yTop = priceToY(cell.top);
        const yBot = priceToY(cell.bottom);
        if (yBot < pricePaneTop || yTop > pricePaneBottom) continue;
        const xStart = Math.max(0, barIndexToX(cell.createdBarIndex));
        ctx.fillStyle = rgba(C.series1, 0.05 + 0.22 * cell.intensityRatio);
        ctx.fillRect(xStart, yTop, chartWidth - xStart - 4, Math.max(2, yBot - yTop));
      }
    }

    // 2. Order Blocks Shaakuni (OB / POI) — kolor strefy, typ w etykiecie
    if (config.showOB) {
      for (const ob of shaakuni.orderBlocks) {
        if (ob.state === 'fresh' && !config.showFresh) continue;
        if (ob.state === 'mitigated' && !config.showMit) continue;

        const x1 = Math.max(0, barIndexToX(ob.createdBarIndex));
        const x2 =
          ob.state === 'fresh'
            ? candlesPlotWidth + 28
            : Math.min(candlesPlotWidth, barIndexToX((ob.mitigatedBarIndex ?? ob.createdBarIndex) + 2));
        if (x2 < 0) continue;

        const yTop = Math.max(pricePaneTop, priceToY(ob.top));
        const yBot = Math.min(pricePaneBottom, priceToY(ob.bottom));
        if (yBot <= yTop) continue;

        const fresh = ob.state === 'fresh';
        const w = Math.max(8, x2 - x1);
        const h = Math.max(3, yBot - yTop);
        ctx.fillStyle = fresh ? rgba(C.zone, 0.14) : rgba(C.ink3, 0.08);
        ctx.strokeStyle = fresh ? rgba(C.zone, 0.7) : rgba(C.ink3, 0.3);
        ctx.lineWidth = 1;
        ctx.fillRect(x1, yTop, w, h);
        ctx.strokeRect(crisp(x1), crisp(yTop), w, h);

        if (h >= 10 && w >= 60) {
          ctx.fillStyle = fresh ? C.ink1 : C.ink3;
          ctx.font = `600 9px ${MONO}`;
          ctx.textAlign = 'center';
          ctx.fillText(
            `${ob.type === 'bull' ? 'BULL' : 'BEAR'} ${ob.label} (${ob.impulseAtrMultiple}x)`,
            x1 + w / 2,
            (yTop + yBot) / 2 + 3
          );
        }
      }
    }

    // 3. Kanał Keltnera (neutralny, żeby świece były bohaterem)
    if (config.showKeltner) {
      ctx.beginPath();
      visibleBars.forEach((b, i) => {
        const y = priceToY(b.keltnerUpper);
        if (i === 0) ctx.moveTo(xOf(i), y);
        else ctx.lineTo(xOf(i), y);
      });
      for (let i = visibleBars.length - 1; i >= 0; i--) ctx.lineTo(xOf(i), priceToY(visibleBars[i].keltnerLower));
      ctx.closePath();
      ctx.fillStyle = rgba(C.ink3, 0.06);
      ctx.fill();

      ctx.strokeStyle = rgba(C.ink3, 0.45);
      ctx.lineWidth = 1;
      ctx.beginPath();
      visibleBars.forEach((b, i) => {
        const y = priceToY(b.keltnerBasis);
        if (i === 0) ctx.moveTo(xOf(i), y);
        else ctx.lineTo(xOf(i), y);
      });
      ctx.stroke();
    }

    // 4. Świece + kropki wolumenu ponadprogowego (pozycja nad/pod świecą = drugi kanał)
    visibleBars.forEach((b, i) => {
      const x = xOf(i);
      const isUp = b.close >= b.open;
      const openY = priceToY(b.open);
      const closeY = priceToY(b.close);
      const highY = priceToY(b.high);
      const lowY = priceToY(b.low);
      const color = isUp ? C.buy : C.sell;

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(crisp(x), highY);
      ctx.lineTo(crisp(x), lowY);
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.fillRect(x - candleWidth / 2, Math.min(openY, closeY), candleWidth, Math.max(1, Math.abs(closeY - openY)));

      if (b.spotHighVol || b.perpHighVol) {
        ctx.fillStyle = isUp ? C.buyInk : C.sellInk;
        ctx.beginPath();
        ctx.arc(x, isUp ? highY - 5 : lowY + 5, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // 5. Zakres modelu ±1σ (MODEL) — tylko przy prawej krawędzi na żywo
    const fh = quant.forecastHorizon;
    if (config.showNeuralCone && fh.length > 0 && clampedPan === 0) {
      const x0 = xOf(visibleBars.length - 1);
      const xEnd = chartWidth - 6;
      const maxStep = Math.max(...fh.map((f) => f.stepBars));
      const pts = fh.map((f) => ({
        x: x0 + (f.stepBars / maxStep) * (xEnd - x0),
        up: priceToY(f.upper1Sigma),
        lo: priceToY(f.lower1Sigma),
      }));
      ctx.beginPath();
      ctx.moveTo(x0, priceToY(visibleBars[visibleBars.length - 1].close));
      pts.forEach((p) => ctx.lineTo(p.x, p.up));
      for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i].x, pts[i].lo);
      ctx.closePath();
      ctx.fillStyle = rgba(C.ink2, 0.08);
      ctx.fill();
      ctx.strokeStyle = rgba(C.ink2, 0.35);
      ctx.stroke();
      // Etykieta pod dolną krawędzią zakresu (opisy poziomów są nad liniami — mniej kolizji)
      const last = pts[pts.length - 1];
      ctx.fillStyle = C.ink3;
      ctx.font = `9px ${MONO}`;
      ctx.textAlign = 'right';
      ctx.fillText(compact ? '±1σ' : 'MODEL ±1σ', xEnd, Math.min(pricePaneBottom - 4, last.lo + 11));
    }

    // 6. Poziomy Shaakuni: linia w kolorze, opis w ink na tle, wartość na osi
    const drawLevel = (val: number | null, name: string, color: string, dash: number[], status?: LevelStatus) => {
      if (!val) return;
      const y = priceToY(val);
      if (y < pricePaneTop - 5 || y > pricePaneBottom + 5) return;
      const yc = crisp(y);

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(0, yc);
      ctx.lineTo(chartWidth, yc);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = color;
      ctx.fillRect(chartWidth, y - 8, rightScaleWidth, 16);
      ctx.fillStyle = C.page;
      ctx.font = `600 10px ${MONO}`;
      ctx.textAlign = 'left';
      ctx.fillText(val.toFixed(0), chartWidth + 5, y + 3.5);

      const tag = `${name}${compact ? '' : ` ${val.toFixed(0)}`}${status ? ` · ${STATUS_PL[status]}` : ''}`;
      ctx.font = `10px ${MONO}`;
      const tw = ctx.measureText(tag).width;
      ctx.fillStyle = rgba(C.bg, 0.85);
      ctx.fillRect(chartWidth - 10 - tw, y - 15, tw + 6, 13);
      ctx.fillStyle = C.ink2;
      ctx.textAlign = 'right';
      ctx.fillText(tag, chartWidth - 7, y - 5);
    };

    if (config.showDay) {
      drawLevel(shaakuni.pdh, 'PDH', C.level, [6, 4], shaakuni.pdhStatus);
      drawLevel(shaakuni.pdl, 'PDL', C.level, [6, 4], shaakuni.pdlStatus);
    }
    if (config.showDEQ) drawLevel(shaakuni.deq, 'D-EQ 50%', rgba(C.level, 0.6), [2, 3]);
    if (config.showWeek) {
      drawLevel(shaakuni.pwh, 'PWH', C.ink2, [6, 4]);
      drawLevel(shaakuni.pwl, 'PWL', C.ink2, [6, 4]);
    }
    if (config.showEQ) drawLevel(shaakuni.weq, 'W-EQ 50%', rgba(C.ink2, 0.6), [2, 3]);

    // 7. Cena ostatniej widocznej świecy na osi
    const lastBar = visibleBars[visibleBars.length - 1];
    if (lastBar) {
      const curY = priceToY(lastBar.close);
      ctx.strokeStyle = rgba(C.accent, 0.5);
      ctx.setLineDash([1, 3]);
      ctx.beginPath();
      ctx.moveTo(0, crisp(curY));
      ctx.lineTo(chartWidth, crisp(curY));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.accent;
      ctx.fillRect(chartWidth, curY - 9, rightScaleWidth, 18);
      ctx.fillStyle = C.page;
      ctx.font = `600 10px ${MONO}`;
      ctx.textAlign = 'left';
      ctx.fillText(lastBar.close.toFixed(compact ? 0 : 1), chartWidth + 5, curY + 3.5);
    }
    ctx.restore();

    // Legenda panelu: znacznik koloru + opis w ink
    const legend = (y: number, items: { color?: string; shape: 'line' | 'box'; text: string }[]) => {
      ctx.font = `10px ${MONO}`;
      ctx.textAlign = 'left';
      let x = 8;
      const widths = items.map((it) => (it.color ? 16 : 0) + ctx.measureText(it.text).width + 12);
      ctx.fillStyle = rgba(C.bg, 0.85);
      ctx.fillRect(4, y - 2, widths.reduce((a, b) => a + b, 0), 14);
      items.forEach((it, i) => {
        if (it.color) {
          ctx.fillStyle = it.color;
          if (it.shape === 'line') ctx.fillRect(x, y + 4, 12, 2);
          else ctx.fillRect(x + 2, y + 1, 8, 8);
          x += 16;
        }
        ctx.fillStyle = it.color ? C.ink2 : C.ink3;
        ctx.fillText(it.text, x, y + 9);
        x += widths[i] - (it.color ? 16 : 0);
      });
    };

    // 8. Panel CVD: perp (series-1) i spot (series-2) — spot tylko gdy są dane spot (CEX opt-in)
    const hasSpot = visibleBars.some((b) => b.spotVbuy + b.spotVsell > 0);
    let minCvd = Infinity;
    let maxCvd = -Infinity;
    for (const b of visibleBars) {
      if (b.cvdPerp < minCvd) minCvd = b.cvdPerp;
      if (b.cvdPerp > maxCvd) maxCvd = b.cvdPerp;
      if (hasSpot) {
        if (b.cvdSpot < minCvd) minCvd = b.cvdSpot;
        if (b.cvdSpot > maxCvd) maxCvd = b.cvdSpot;
      }
    }
    const cvdRange = Math.max(100, maxCvd - minCvd);
    const cvdToY = (cvd: number) => cvdPaneTop + 4 + ((maxCvd - cvd) / cvdRange) * (cvdPaneHeight - 8);
    const cvdLine = (pick: (b: OHLCVBar) => number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      visibleBars.forEach((b, i) => {
        if (i === 0) ctx.moveTo(xOf(i), cvdToY(pick(b)));
        else ctx.lineTo(xOf(i), cvdToY(pick(b)));
      });
      ctx.stroke();
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, cvdPaneTop, chartWidth, cvdPaneHeight);
    ctx.clip();
    cvdLine((b) => b.cvdPerp, C.series1);
    if (hasSpot) cvdLine((b) => b.cvdSpot, C.series2);
    ctx.restore();
    legend(cvdPaneTop + 4, [
      { color: C.series1, shape: 'line', text: 'CVD perp' },
      hasSpot ? { color: C.series2, shape: 'line', text: 'CVD spot' } : { shape: 'line', text: 'spot: n/a' },
    ]);

    // 9. Panel delty perp: słupki kupno/sprzedaż (znak = pozycja nad/pod zerem)
    let maxAbsDelta = 1;
    for (const b of visibleBars) {
      if (Math.abs(b.deltaSpot) > maxAbsDelta) maxAbsDelta = Math.abs(b.deltaSpot);
      if (Math.abs(b.deltaPerp) > maxAbsDelta) maxAbsDelta = Math.abs(b.deltaPerp);
    }
    const deltaHalfH = deltaPaneHeight * 0.45;
    visibleBars.forEach((b, i) => {
      const x = xOf(i);
      const barH = (b.deltaPerp / maxAbsDelta) * deltaHalfH;
      const up = b.deltaPerp >= 0;
      ctx.fillStyle = up ? C.buy : C.sell;
      roundedBar(ctx, x - candleWidth * 0.4, up ? deltaMidY - barH : deltaMidY, candleWidth * 0.8, Math.max(1, Math.abs(barH)), up);
    });
    legend(deltaPaneTop + 4, [
      { shape: 'box', text: 'Δ perp' },
      { color: C.buy, shape: 'box', text: 'kupno +' },
      { color: C.sell, shape: 'box', text: 'sprzedaż −' },
    ]);

    // 10. Oś czasu
    ctx.fillStyle = C.ink3;
    ctx.font = `10px ${MONO}`;
    ctx.textAlign = 'center';
    const timeStep = Math.max(6, Math.floor(visibleBars.length / (compact ? 4 : 7)));
    for (let i = 0; i < visibleBars.length; i += timeStep) {
      if (xOf(i) < 18) continue; // etykieta ucięta przy lewej krawędzi
      ctx.fillText(hhmm(visibleBars[i].time), xOf(i), height - 8);
    }

    // 11. Crosshair z etykietą ceny i czasu
    if (hover && dragModeRef.current === 'NONE') {
      ctx.save();
      ctx.strokeStyle = rgba(C.ink2, 0.5);
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(crisp(hover.x), 0);
      ctx.lineTo(crisp(hover.x), height - BOTTOM_SCALE);
      if (hover.y >= pricePaneTop && hover.y <= pricePaneBottom) {
        ctx.moveTo(0, crisp(hover.y));
        ctx.lineTo(chartWidth, crisp(hover.y));
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `10px ${MONO}`;
      if (hover.y >= pricePaneTop && hover.y <= pricePaneBottom) {
        ctx.fillStyle = C.tip;
        ctx.fillRect(chartWidth, hover.y - 9, rightScaleWidth, 18);
        ctx.fillStyle = C.ink1;
        ctx.textAlign = 'left';
        ctx.fillText(hover.price.toFixed(compact ? 0 : 1), chartWidth + 5, hover.y + 3.5);
      }
      ctx.fillStyle = C.tip;
      ctx.fillRect(hover.x - 22, height - BOTTOM_SCALE + 2, 44, 18);
      ctx.fillStyle = C.ink1;
      ctx.textAlign = 'center';
      ctx.fillText(hhmm(hover.time), hover.x, height - 8);
      ctx.restore();
    }

    layoutRef.current = {
      visibleBars,
      barSpacing,
      chartWidth,
      candlesPlotWidth,
      rightScaleWidth,
      pricePaneTop,
      pricePaneHeight,
      maxPrice,
      priceRange,
    };
  }, [
    bars,
    shaakuni,
    config,
    heatmap,
    quant,
    visibleBarCount,
    panOffsetBars,
    priceZoomMultiplier,
    priceCenterOffsetUsd,
    hover,
    size,
    compact,
  ]);

  /** Crosshair: świeca pod kursorem i cena z tej samej geometrii co rysunek. */
  const updateHover = (x: number, y: number) => {
    const L = layoutRef.current;
    if (!L || L.visibleBars.length === 0) return;
    const idx = Math.max(0, Math.min(L.visibleBars.length - 1, Math.floor(x / L.barSpacing)));
    const price = L.maxPrice - ((y - L.pricePaneTop) / L.pricePaneHeight) * L.priceRange;
    setHover({ time: L.visibleBars[idx].time, x: idx * L.barSpacing + L.barSpacing * 0.5, y, price });
  };

  const pinchDistance = () => {
    const [a, b] = [...pointersRef.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 1;
  };

  // Wskaźnik (mysz, dotyk, rysik): przeciąganie / rozciąganie osi / szczypanie
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2) {
      dragModeRef.current = 'PINCH';
      pinchRef.current = { startDist: Math.max(1, pinchDistance()), startCount: visibleBarCount };
      setHover(null);
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const rightScaleWidth = layoutRef.current?.rightScaleWidth ?? 76;
    tapRef.current.moved = false;

    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      startPanBars: panOffsetBars,
      startPriceOffset: priceCenterOffsetUsd,
      startPriceZoom: priceZoomMultiplier,
      startBarCount: visibleBarCount,
    };

    if (x >= rect.width - rightScaleWidth) dragModeRef.current = 'STRETCH_Y';
    else if (y >= rect.height - BOTTOM_SCALE) dragModeRef.current = 'STRETCH_X';
    else dragModeRef.current = 'PAN';
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || bars.length === 0) return;
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = canvas.getBoundingClientRect();

    if (dragModeRef.current === 'PINCH') {
      if (pointersRef.current.size < 2) return;
      const ratio = pinchDistance() / pinchRef.current.startDist;
      setVisibleBarCount(Math.max(15, Math.min(300, Math.round(pinchRef.current.startCount / Math.max(0.1, ratio)))));
      return;
    }

    const dx = e.clientX - dragStartRef.current.clientX;
    const dy = e.clientY - dragStartRef.current.clientY;
    if (dragModeRef.current !== 'NONE' && Math.hypot(dx, dy) > 4) tapRef.current.moved = true;

    if (dragModeRef.current === 'PAN') {
      const candlesPlotWidth = layoutRef.current?.candlesPlotWidth ?? Math.max(100, rect.width - 76 - 84);
      const barSpacing = candlesPlotWidth / Math.max(1, visibleBarCount);
      const deltaBars = dx / barSpacing;
      setPanOffsetBars(Math.max(0, dragStartRef.current.startPanBars + deltaBars));

      // Przybliżone USD na piksel
      const lastBar = bars[bars.length - 1];
      const approxSpan = (lastBar.close * 0.05) / Math.max(0.2, priceZoomMultiplier);
      const deltaUsd = (dy / (rect.height * 0.67)) * approxSpan;
      setPriceCenterOffsetUsd(dragStartRef.current.startPriceOffset + deltaUsd);
      return;
    }

    if (dragModeRef.current === 'STRETCH_Y') {
      const factor = 1 + (dragStartRef.current.clientY - e.clientY) * 0.008;
      setPriceZoomMultiplier(Math.max(0.25, Math.min(6.0, dragStartRef.current.startPriceZoom * factor)));
      return;
    }

    if (dragModeRef.current === 'STRETCH_X') {
      const deltaCount = Math.round((dragStartRef.current.clientX - e.clientX) * 0.4);
      setVisibleBarCount(Math.max(15, Math.min(300, dragStartRef.current.startBarCount + deltaCount)));
      return;
    }

    // Bez wciśnięcia (tylko mysz/rysik) — crosshair
    if (e.pointerType !== 'touch') updateHover(e.clientX - rect.left, e.clientY - rect.top);
  };

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // wskaźnik nie był przechwycony
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    endPointer(e);
    const mode = dragModeRef.current;
    if (mode === 'PINCH') {
      // Pozostały palec nie przejmuje gestu (bez skoku widoku)
      if (pointersRef.current.size === 0) dragModeRef.current = 'NONE';
      return;
    }
    dragModeRef.current = 'NONE';

    // Stuknięcie palcem: crosshair na świecy; dwa stuknięcia: reset widoku
    if (e.pointerType !== 'mouse' && mode === 'PAN' && !tapRef.current.moved) {
      const now = performance.now();
      if (now - tapRef.current.lastTapAt < 320) {
        tapRef.current.lastTapAt = 0;
        setHover(null);
        resetView();
      } else {
        tapRef.current.lastTapAt = now;
        const rect = e.currentTarget.getBoundingClientRect();
        updateHover(e.clientX - rect.left, e.clientY - rect.top);
      }
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    endPointer(e);
    if (pointersRef.current.size === 0) dragModeRef.current = 'NONE';
  };

  const lastBar = bars[bars.length - 1];
  const hoveredBar = hover ? bars.find((b) => b.time === hover.time) : undefined;
  const inspectedBar = hoveredBar ?? lastBar;
  const toggleOverlay = (o: Overlay) => setOverlay((cur) => (cur === o ? 'none' : o));
  const zoomIn = () => setVisibleBarCount((c) => Math.max(20, c - 15));
  const zoomOut = () => setVisibleBarCount((c) => Math.min(250, c + 15));
  const toggleCfg = (key: 'showLiqHeatmap' | 'showNeuralCone') => onChangeConfig((prev) => ({ ...prev, [key]: !prev[key] }));

  const LAYER_TOGGLES = [
    { key: 'showLiqHeatmap' as const, label: 'Płynność', swatch: 'bg-series-1', title: 'Mapa płynności (szacunkowe skupiska likwidacji)' },
    { key: 'showNeuralCone' as const, label: '±1σ MODEL', swatch: 'bg-ink-2', title: 'Zakres modelu ±1σ na kolejne świece (MODEL — rozrzut, nie sygnał kierunku)' },
  ];

  return (
    <div className="relative w-full h-full min-h-[320px] flex flex-col bg-surface-1 border border-line-strong rounded-xl overflow-hidden select-none">
      {/* Nagłówek nad płótnem: OHLC (bez zasłaniania świec) + narzędzia */}
      {/* Jedna linia bez zawijania — zmiana szerokości wartości nie zmienia wysokości płótna */}
      <div className="flex items-center justify-between gap-3 px-2 sm:px-3 py-1 border-b border-line min-h-11">
        {inspectedBar && (
          <div className="min-w-0 flex-1 flex items-baseline gap-x-2.5 overflow-x-auto whitespace-nowrap text-[11px] font-mono tabular-nums [scrollbar-width:none]">
            {(compact
              ? ([
                  ['H', inspectedBar.high],
                  ['L', inspectedBar.low],
                ] as const)
              : ([
                  ['O', inspectedBar.open],
                  ['H', inspectedBar.high],
                  ['L', inspectedBar.low],
                ] as const)
            ).map(([k, v]) => (
              <span key={k} className="text-ink-3">
                {k} <span className="text-ink-1">{fmtPrice(v, compact ? 0 : 1)}</span>
              </span>
            ))}
            <span className="text-ink-3">
              C{' '}
              <span className={inspectedBar.close >= inspectedBar.open ? 'text-buy-ink' : 'text-sell-ink'} aria-hidden="true">
                {inspectedBar.close >= inspectedBar.open ? '▲' : '▼'}
              </span>
              <span className="text-ink-1">{fmtPrice(inspectedBar.close, compact ? 0 : 1)}</span>
            </span>
            {!compact && !dense && (
              <span className="text-ink-3">
                Δ perp{' '}
                <span className="text-ink-1">
                  {inspectedBar.deltaPerp > 0 ? '+' : ''}
                  {fmtCompact(inspectedBar.deltaPerp)}
                </span>
              </span>
            )}
            {!compact && !dense && inspectedBar.spotVbuy + inspectedBar.spotVsell > 0 && (
              <span className="text-ink-3">
                Δ spot{' '}
                <span className="text-ink-1">
                  {inspectedBar.deltaSpot > 0 ? '+' : ''}
                  {fmtCompact(inspectedBar.deltaSpot)}
                </span>
              </span>
            )}
          </div>
        )}

        {compact ? (
          <button
            type="button"
            data-overlay-toggle
            aria-expanded={overlay === 'layers'}
            aria-haspopup="menu"
            onClick={() => toggleOverlay('layers')}
            className={`shrink-0 inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg text-xs font-medium border transition-colors duration-150 ${
              overlay === 'layers' ? 'bg-surface-3 text-ink-1 border-line-strong' : 'text-ink-2 border-line hover:text-ink-1'
            }`}
          >
            <Layers className="w-4 h-4" aria-hidden="true" />
            Warstwy
          </button>
        ) : (
          <div className="flex items-center gap-1 shrink-0 ml-auto">
            <ToolBtn
              toggle
              active={overlay === 'levels'}
              onClick={() => toggleOverlay('levels')}
              title={`Tabela poziomów Shaakuni · sesja: ${shaakuni.nySession}`}
            >
              <span>Shaakuni</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${overlay === 'levels' ? 'rotate-180' : ''}`} aria-hidden="true" />
            </ToolBtn>
            <ToolBtn onClick={zoomOut} label="Oddal (więcej świec)">
              <ZoomOut className="w-4 h-4" aria-hidden="true" />
            </ToolBtn>
            <ToolBtn onClick={zoomIn} label="Przybliż (mniej świec)">
              <ZoomIn className="w-4 h-4" aria-hidden="true" />
            </ToolBtn>
            <ToolBtn onClick={resetView} label={dense ? 'Auto-fit' : undefined} title="Zresetuj pozycję i skalę (auto-dopasowanie)">
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              {!dense && <span>Auto-fit</span>}
            </ToolBtn>
            <span className="w-px h-5 bg-line mx-1" aria-hidden="true" />
            {LAYER_TOGGLES.map((t) => (
              <ToolBtn key={t.key} pressed={config[t.key]} onClick={() => toggleCfg(t.key)} title={t.title}>
                <span className={`w-2 h-2 rounded-sm ${t.swatch} ${config[t.key] ? '' : 'opacity-40'}`} aria-hidden="true" />
                <span>{t.label}</span>
              </ToolBtn>
            ))}
            <ToolBtn
              toggle
              active={overlay === 'params'}
              onClick={() => toggleOverlay('params')}
              label={dense ? 'Parametry' : undefined}
              title="Parametry wskaźnika Shaakuni"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
              {!dense && <span>Parametry</span>}
            </ToolBtn>
          </div>
        )}
      </div>

      <div ref={plotRef} className="relative flex-1 min-h-0">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Wykres BTC-PERP ${timeframeLabel}: świece, poziomy Shaakuni, CVD i delta perp`}
          title={HINT}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={(e) => e.pointerType !== 'touch' && setHover(null)}
          onDoubleClick={resetView}
          className="absolute inset-0 block w-full h-full cursor-crosshair active:cursor-grabbing touch-none"
        />

        {bars.length < 5 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-3 pointer-events-none">Czekam na świece…</div>
        )}

        {/* Menu „Warstwy” (tryb kompaktowy): zoom, warstwy, tabela i parametry */}
        {overlay === 'layers' && (
          <div
            data-chart-overlay
            role="menu"
            aria-label="Warstwy i widok wykresu"
            className="absolute top-2 right-2 z-30 w-[min(280px,calc(100%-16px))] max-h-[calc(100%-16px)] overflow-y-auto bg-surface-2 border border-line-strong rounded-xl p-1.5 shadow-2xl"
          >
            <div className="grid grid-cols-3 gap-1 pb-1.5 mb-1.5 border-b border-line">
              <MenuBtn onClick={zoomOut} label="Oddal">
                <ZoomOut className="w-4 h-4" aria-hidden="true" />
              </MenuBtn>
              <MenuBtn onClick={zoomIn} label="Przybliż">
                <ZoomIn className="w-4 h-4" aria-hidden="true" />
              </MenuBtn>
              <MenuBtn onClick={resetView} label="Auto-fit">
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
              </MenuBtn>
            </div>
            {LAYER_TOGGLES.map((t) => (
              <button
                key={t.key}
                type="button"
                role="menuitemcheckbox"
                aria-checked={config[t.key]}
                onClick={() => toggleCfg(t.key)}
                className="w-full min-h-11 flex items-center gap-2.5 px-3 rounded-lg text-sm text-ink-1 hover:bg-surface-3"
              >
                <span
                  className={`w-4 h-4 rounded border flex items-center justify-center ${config[t.key] ? 'bg-accent border-accent' : 'border-line-strong'}`}
                  aria-hidden="true"
                >
                  {config[t.key] && <span className="w-2 h-1 border-l-2 border-b-2 border-page -rotate-45 -mt-0.5" />}
                </span>
                <span className={`w-2 h-2 rounded-sm ${t.swatch}`} aria-hidden="true" />
                {t.label}
              </button>
            ))}
            <div className="mt-1.5 pt-1.5 border-t border-line">
              <button
                type="button"
                role="menuitem"
                onClick={() => setOverlay('levels')}
                className="w-full min-h-11 flex items-center gap-2.5 px-3 rounded-lg text-sm text-ink-1 hover:bg-surface-3"
              >
                <Table2 className="w-4 h-4 text-ink-3" aria-hidden="true" />
                Tabela poziomów Shaakuni
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => setOverlay('params')}
                className="w-full min-h-11 flex items-center gap-2.5 px-3 rounded-lg text-sm text-ink-1 hover:bg-surface-3"
              >
                <SlidersHorizontal className="w-4 h-4 text-ink-3" aria-hidden="true" />
                Parametry Shaakuni
              </button>
            </div>
          </div>
        )}

        {/* Tabela poziomów Shaakuni */}
        {overlay === 'levels' && (
          <div
            data-chart-overlay
            className={`absolute top-2 z-30 bg-surface-2 border border-line-strong rounded-xl shadow-2xl overflow-hidden text-xs ${
              compact ? 'inset-x-2' : 'right-2 w-[280px]'
            }`}
          >
            <OverlayHeader title="Shaakuni · poziomy" meta={`BTC · ${timeframeLabel}`} onClose={() => setOverlay('none')} compact={compact} />
            <dl className="font-mono tabular-nums divide-y divide-line">
              <LevelRow label={`Sesja (${shaakuni.nyTimeFormatted})`}>
                <span className={shaakuni.nySession !== 'No Active Session' ? 'text-ink-1' : 'text-ink-3'}>{shaakuni.nySession}</span>
              </LevelRow>
              <LevelRow label="PDH (max wczoraj)" swatch="bg-level" status={shaakuni.pdhStatus} value={shaakuni.pdh} />
              <LevelRow label="PDL (min wczoraj)" swatch="bg-level" status={shaakuni.pdlStatus} value={shaakuni.pdl} />
              <LevelRow label="D-EQ 50%" swatch="bg-level/60" value={shaakuni.deq} />
              <LevelRow label="PWH (max tydz.)" swatch="bg-ink-2" value={shaakuni.pwh} />
              <LevelRow label="PWL (min tydz.)" swatch="bg-ink-2" value={shaakuni.pwl} />
            </dl>
          </div>
        )}

        {/* Parametry wskaźnika Shaakuni */}
        {overlay === 'params' && (
          <div
            data-chart-overlay
            className={`absolute top-2 z-30 bg-surface-2 border border-line-strong rounded-xl shadow-2xl text-xs max-h-[calc(100%-16px)] overflow-y-auto ${
              compact ? 'inset-x-2' : 'right-2 w-80'
            }`}
          >
            <OverlayHeader title="Parametry Shaakuni" onClose={() => setOverlay('none')} compact={compact} />
            <div className="p-3 space-y-2.5">
              <label className="flex items-center justify-between gap-3 text-ink-2">
                <span>OB lookback (świece)</span>
                <input
                  type="number"
                  min={3}
                  max={50}
                  value={config.obSwingLen}
                  onChange={(e) =>
                    onChangeConfig((c) => ({
                      ...c,
                      obSwingLen: Math.max(3, Math.min(50, Number(e.target.value))),
                    }))
                  }
                  className={`w-20 bg-page border border-line rounded-lg px-2 text-right font-mono tabular-nums text-ink-1 ${compact ? 'h-11' : 'h-8'}`}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-ink-2">
                <span>Świeca impulsu (× ATR)</span>
                <input
                  type="number"
                  min={0.1}
                  max={5.0}
                  step={0.1}
                  value={config.impMult}
                  onChange={(e) =>
                    onChangeConfig((c) => ({
                      ...c,
                      impMult: Math.max(0.1, Math.min(5.0, Number(e.target.value))),
                    }))
                  }
                  className={`w-20 bg-page border border-line rounded-lg px-2 text-right font-mono tabular-nums text-ink-1 ${compact ? 'h-11' : 'h-8'}`}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-ink-2">
                <span>Strefa czasowa NY</span>
                <select
                  value={config.tzChoice}
                  onChange={(e) =>
                    onChangeConfig((c) => ({
                      ...c,
                      tzChoice: e.target.value as ShaakuniConfig['tzChoice'],
                    }))
                  }
                  className={`bg-page border border-line rounded-lg px-2 text-ink-1 ${compact ? 'h-11' : 'h-8'}`}
                >
                  <option value="Auto (DST)">Auto (DST)</option>
                  <option value="Manual UTC-4 (EDT)">UTC-4 (EDT)</option>
                  <option value="Manual UTC-5 (EST)">UTC-5 (EST)</option>
                </select>
              </label>

              <div className="grid grid-cols-2 gap-x-2 pt-2 border-t border-line">
                {(
                  [
                    { key: 'showWeek', label: 'Tygodniowe H/L' },
                    { key: 'showEQ', label: 'Weekly EQ 50%' },
                    { key: 'showDay', label: 'Dzienne H/L' },
                    { key: 'showDEQ', label: 'Daily EQ 50%' },
                    { key: 'showOB', label: 'Order Blocks' },
                    { key: 'showMit', label: 'Zmitygowane OB' },
                    { key: 'showKeltner', label: 'Kanał Keltnera' },
                  ] as const
                ).map((item) => (
                  <label key={item.key} className={`flex items-center gap-2 text-ink-2 cursor-pointer ${compact ? 'min-h-11' : 'min-h-8'}`}>
                    <input
                      type="checkbox"
                      checked={Boolean(config[item.key])}
                      onChange={(e) =>
                        onChangeConfig((c) => ({
                          ...c,
                          [item.key]: e.target.checked,
                        }))
                      }
                      className="w-4 h-4 accent-accent"
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/** Przycisk paska narzędzi (desktop). `pressed` = przełącznik warstwy, `toggle/active` = otwiera nakładkę. */
const ToolBtn: React.FC<{
  onClick: () => void;
  children: React.ReactNode;
  label?: string;
  title?: string;
  pressed?: boolean;
  toggle?: boolean;
  active?: boolean;
}> = ({ onClick, children, label, title, pressed, toggle, active }) => {
  const on = pressed ?? active ?? false;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={title ?? label}
      aria-pressed={pressed}
      aria-expanded={toggle ? active : undefined}
      data-overlay-toggle={toggle ? '' : undefined}
      className={`inline-flex items-center gap-1.5 h-8 px-2 rounded-lg text-[11px] font-medium whitespace-nowrap border transition-colors duration-150 ${
        on ? 'bg-surface-3 text-ink-1 border-line-strong' : 'text-ink-2 border-transparent hover:text-ink-1 hover:bg-surface-2'
      }`}
    >
      {children}
    </button>
  );
};

/** Przycisk w menu kompaktowym (cel dotyku ≥ 44 px). */
const MenuBtn: React.FC<{ onClick: () => void; label: string; children: React.ReactNode }> = ({ onClick, label, children }) => (
  <button
    type="button"
    role="menuitem"
    onClick={onClick}
    className="min-h-11 flex flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] text-ink-2 hover:text-ink-1 hover:bg-surface-3"
  >
    {children}
    {label}
  </button>
);

const OverlayHeader: React.FC<{ title: string; meta?: string; onClose: () => void; compact: boolean }> = ({ title, meta, onClose, compact }) => (
  <div className="flex items-center justify-between gap-3 pl-3 pr-1 py-1 border-b border-line">
    <div className="min-w-0 flex items-baseline gap-2">
      <span className="text-sm font-medium text-ink-1 truncate">{title}</span>
      {meta && <span className="text-[11px] text-ink-3 font-mono">{meta}</span>}
    </div>
    <button
      type="button"
      aria-label="Zamknij"
      onClick={onClose}
      className={`inline-flex items-center justify-center rounded-lg text-ink-3 hover:text-ink-1 hover:bg-surface-3 ${compact ? 'w-11 h-11' : 'w-8 h-8'}`}
    >
      <X className="w-4 h-4" aria-hidden="true" />
    </button>
  </div>
);

/** Wiersz tabeli poziomów: znacznik koloru + opis w ink, status słowem (nie samym kolorem). */
const LevelRow: React.FC<{
  label: string;
  swatch?: string;
  value?: number | null;
  status?: LevelStatus;
  children?: React.ReactNode;
}> = ({ label, swatch, value, status, children }) => (
  <div className={`flex items-center justify-between gap-3 px-3 py-1.5 ${status === 'Sweep !' ? 'bg-level/10' : ''}`}>
    <dt className="flex items-center gap-2 text-ink-2 font-sans">
      {swatch && <span className={`w-2 h-2 rounded-sm ${swatch}`} aria-hidden="true" />}
      {label}
    </dt>
    <dd className="text-right">
      {children ?? (
        <>
          {status && (
            <span className={`mr-2 ${status === 'Sweep !' ? 'text-ink-1' : status === 'Break' ? 'text-ink-2' : 'text-ink-3'}`}>
              {status === 'Sweep !' ? '↺ ' : status === 'Break' ? '✕ ' : ''}
              {STATUS_PL[status]}
            </span>
          )}
          <span className="text-ink-1">{value ? fmtPrice(value, 0) : DASH}</span>
        </>
      )}
    </dd>
  </div>
);
