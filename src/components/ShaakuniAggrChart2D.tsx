import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  SlidersHorizontal,
  ZoomIn,
  ZoomOut,
  Activity,
  Layers,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Move,
  ArrowUpDown,
} from 'lucide-react';
import {
  LiquidationHeatmapCell,
  OHLCVBar,
  QuantMathMetrics,
  ShaakuniConfig,
  ShaakuniState,
  TradingSignal,
} from '../types/trading';

interface ShaakuniAggrChart2DProps {
  bars: OHLCVBar[];
  shaakuni: ShaakuniState;
  config: ShaakuniConfig;
  onChangeConfig: React.Dispatch<React.SetStateAction<ShaakuniConfig>>;
  heatmap: LiquidationHeatmapCell[];
  quant: QuantMathMetrics;
  activeSignal: TradingSignal | null;
  timeframeLabel: string;
}

export const ShaakuniAggrChart2D: React.FC<ShaakuniAggrChart2DProps> = ({
  bars,
  shaakuni,
  config,
  onChangeConfig,
  heatmap,
  quant,
  activeSignal,
  timeframeLabel,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Pan & Zoom Engine State
  const [visibleBarCount, setVisibleBarCount] = useState<number>(85);
  const [panOffsetBars, setPanOffsetBars] = useState<number>(0); // 0 = at live right edge
  const [priceZoomMultiplier, setPriceZoomMultiplier] = useState<number>(1.0); // 1.0 = auto-fit
  const [priceCenterOffsetUsd, setPriceCenterOffsetUsd] = useState<number>(0); // USD shift
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [shaakuniPanelOpen, setShaakuniPanelOpen] = useState<boolean>(false); // Collapsed by default so it never blocks candlesticks!

  const [hoverInfo, setHoverInfo] = useState<{
    bar: OHLCVBar;
    x: number;
    y: number;
    priceAtCursor: number;
  } | null>(null);

  // Drag interaction refs
  const dragModeRef = useRef<'NONE' | 'PAN' | 'STRETCH_Y' | 'STRETCH_X'>('NONE');
  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    startPanBars: number;
    startPriceOffset: number;
    startPriceZoom: number;
    startBarCount: number;
  }>({
    clientX: 0,
    clientY: 0,
    startPanBars: 0,
    startPriceOffset: 0,
    startPriceZoom: 1.0,
    startBarCount: 85,
  });

  const resetView = useCallback(() => {
    setPanOffsetBars(0);
    setPriceZoomMultiplier(1.0);
    setPriceCenterOffsetUsd(0);
    setVisibleBarCount(85);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || bars.length < 5) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = container.clientWidth;
    const height = container.clientHeight;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    // Deep obsidian background (#090D16)
    ctx.fillStyle = '#090D16';
    ctx.fillRect(0, 0, width, height);

    const rightScaleWidth = 76;
    const bottomScaleHeight = 24;
    const chartWidth = width - rightScaleWidth;
    const futureForecastWidth = 84; // Space on right for OB extensions, labels, and Neural Forecast Cone
    const candlesPlotWidth = Math.max(100, chartWidth - futureForecastWidth);

    // Vertical Sub-panes (matching aggr.trade):
    // Top 67%: Price + Shaakuni OBs + Liquidity Levels + Heatmap + Keltner + Neural Cone
    // Mid 16.5%: CVD BTC Spot (Cyan) vs CVD BTC Perp (Purple)
    // Bot 16.5%: Delta Perps & Delta Spot Histograms
    const pricePaneTop = 8;
    const pricePaneBottom = Math.floor((height - bottomScaleHeight) * 0.67);
    const pricePaneHeight = Math.max(80, pricePaneBottom - pricePaneTop);

    const cvdPaneTop = pricePaneBottom + 4;
    const cvdPaneBottom = Math.floor((height - bottomScaleHeight) * 0.835);
    const cvdPaneHeight = Math.max(30, cvdPaneBottom - cvdPaneTop);

    const deltaPaneTop = cvdPaneBottom + 4;
    const deltaPaneBottom = height - bottomScaleHeight;
    const deltaPaneHeight = Math.max(30, deltaPaneBottom - deltaPaneTop);

    // Compute visible bar slice taking into account panOffsetBars
    const count = Math.min(bars.length, Math.max(15, Math.min(300, visibleBarCount)));
    const maxPan = Math.max(0, bars.length - count);
    const clampedPan = Math.max(0, Math.min(maxPan, Math.round(panOffsetBars)));

    const sliceEnd = bars.length - clampedPan;
    const sliceStart = Math.max(0, sliceEnd - count);
    const visibleBars = bars.slice(sliceStart, sliceEnd);
    if (visibleBars.length === 0) return;

    // Price Scale Min/Max with Zoom Multiplier & Center Offset
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
    const zoomedSpan = (baseSpan / Math.max(0.2, priceZoomMultiplier));

    const minPrice = midPrice - zoomedSpan * 0.5;
    const maxPrice = midPrice + zoomedSpan * 0.5;
    const priceRange = Math.max(1, maxPrice - minPrice);

    const priceToY = (p: number) =>
      pricePaneTop + ((maxPrice - p) / priceRange) * pricePaneHeight;
    const yToPrice = (y: number) =>
      maxPrice - ((y - pricePaneTop) / pricePaneHeight) * priceRange;

    const barSpacing = candlesPlotWidth / Math.max(1, visibleBars.length);
    const candleWidth = Math.max(2, Math.min(14, barSpacing * 0.68));
    const barIndexToX = (globalIdx: number) => {
      const rel = globalIdx - sliceStart;
      return rel * barSpacing + barSpacing * 0.5;
    };

    // Horizontal gridlines & Y-Axis price labels
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    const gridSteps = 7;
    for (let i = 0; i <= gridSteps; i++) {
      const y = pricePaneTop + (pricePaneHeight / gridSteps) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(chartWidth, y);
      ctx.stroke();

      const pVal = yToPrice(y);
      ctx.fillStyle = '#64748B';
      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(pVal.toFixed(0), chartWidth + 6, y + 3);
    }

    // Pane Dividers
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.65)';
    ctx.beginPath();
    ctx.moveTo(0, pricePaneBottom + 2);
    ctx.lineTo(width, pricePaneBottom + 2);
    ctx.moveTo(0, cvdPaneBottom + 2);
    ctx.lineTo(width, cvdPaneBottom + 2);
    ctx.moveTo(chartWidth, 0);
    ctx.lineTo(chartWidth, height);
    ctx.stroke();

    // 1. Draw Aggr Liquidation Heatmap
    if (config.showLiqHeatmap) {
      for (const cell of heatmap) {
        const yTop = priceToY(cell.top);
        const yBot = priceToY(cell.bottom);
        if (yBot < pricePaneTop || yTop > pricePaneBottom) continue;

        const xStart = Math.max(0, barIndexToX(cell.createdBarIndex));
        ctx.fillStyle = cell.color;
        ctx.fillRect(
          xStart,
          yTop,
          chartWidth - xStart - 4,
          Math.max(2, yBot - yTop)
        );
      }
    }

    // 2. Draw Shaakuni Order Blocks (OB / POI)
    if (config.showOB) {
      for (const ob of shaakuni.orderBlocks) {
        if (ob.state === 'fresh' && !config.showFresh) continue;
        if (ob.state === 'mitigated' && !config.showMit) continue;

        const x1 = Math.max(0, barIndexToX(ob.createdBarIndex));
        const x2 =
          ob.state === 'fresh'
            ? candlesPlotWidth + 28
            : Math.min(
                candlesPlotWidth,
                barIndexToX((ob.mitigatedBarIndex ?? ob.createdBarIndex) + 2)
              );
        if (x2 < 0) continue;

        const yTop = Math.max(pricePaneTop, priceToY(ob.top));
        const yBot = Math.min(pricePaneBottom, priceToY(ob.bottom));
        if (yBot <= yTop) continue;

        if (ob.state === 'fresh') {
          ctx.fillStyle =
            ob.type === 'bull'
              ? 'rgba(41, 121, 255, 0.20)'
              : 'rgba(255, 112, 67, 0.20)';
          ctx.strokeStyle =
            ob.type === 'bull'
              ? 'rgba(41, 121, 255, 0.75)'
              : 'rgba(255, 112, 67, 0.75)';
        } else {
          ctx.fillStyle = 'rgba(30, 41, 59, 0.35)';
          ctx.strokeStyle = 'rgba(71, 85, 105, 0.4)';
        }

        ctx.lineWidth = 1;
        ctx.fillRect(x1, yTop, Math.max(8, x2 - x1), Math.max(3, yBot - yTop));
        ctx.strokeRect(x1, yTop, Math.max(8, x2 - x1), Math.max(3, yBot - yTop));

        // Text tag
        ctx.fillStyle =
          ob.state === 'fresh'
            ? 'rgba(255, 255, 255, 0.88)'
            : 'rgba(148, 163, 184, 0.5)';
        ctx.font = '600 9px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(
          `${ob.type === 'bull' ? 'BULL' : 'BEAR'} ${ob.label} (${ob.impulseAtrMultiple}x)`,
          x1 + Math.max(8, x2 - x1) / 2,
          (yTop + yBot) / 2 + 3
        );
      }
    }

    // 3. Draw Keltner Channel
    if (config.showKeltner) {
      ctx.beginPath();
      visibleBars.forEach((b, i) => {
        const x = i * barSpacing + barSpacing * 0.5;
        const y = priceToY(b.keltnerUpper);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      for (let i = visibleBars.length - 1; i >= 0; i--) {
        const x = i * barSpacing + barSpacing * 0.5;
        const y = priceToY(visibleBars[i].keltnerLower);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.04)';
      ctx.fill();

      // Midline
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      visibleBars.forEach((b, i) => {
        const x = i * barSpacing + barSpacing * 0.5;
        const y = priceToY(b.keltnerBasis);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // 4. Draw Candlesticks & Microstructure Absorption Dots
    visibleBars.forEach((b, i) => {
      const x = i * barSpacing + barSpacing * 0.5;
      const isUp = b.close >= b.open;
      const openY = priceToY(b.open);
      const closeY = priceToY(b.close);
      const highY = priceToY(b.high);
      const lowY = priceToY(b.low);

      const color = isUp ? '#00E5FF' : '#3B82F6';
      ctx.strokeStyle = color;
      ctx.fillStyle = isUp ? 'rgba(0, 229, 255, 0.85)' : 'rgba(59, 130, 246, 0.85)';
      ctx.lineWidth = 1.2;

      // Candle Wick
      ctx.beginPath();
      ctx.moveTo(x, highY);
      ctx.lineTo(x, lowY);
      ctx.stroke();

      // Candle Body
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(2, Math.abs(closeY - openY));
      ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);

      // Institutional Whale / Absorption Volume Threshold Highlight
      if (b.spotHighVol || b.perpHighVol) {
        ctx.fillStyle = isUp ? '#10B981' : '#F43F5E';
        ctx.beginPath();
        ctx.arc(x, isUp ? highY - 4 : lowY + 4, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // 5. Draw Shaakuni High/Low Levels (PDH, PDL, D-EQ, PWH, PWL, W-EQ)
    const drawLevel = (
      val: number | null,
      name: string,
      colorHex: string,
      status?: string
    ) => {
      if (!val) return;
      const y = priceToY(val);
      if (y < pricePaneTop - 5 || y > pricePaneBottom + 5) return;

      ctx.strokeStyle = colorHex;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(chartWidth, y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Right-side badge
      ctx.fillStyle = colorHex;
      ctx.fillRect(chartWidth, y - 9, rightScaleWidth - 2, 18);
      ctx.fillStyle = '#090D16';
      ctx.font = 'bold 9px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`$${val.toFixed(0)}`, chartWidth + 4, y + 3);

      // On-chart text tag
      ctx.fillStyle = colorHex;
      ctx.font = 'bold 9px "IBM Plex Mono", monospace';
      ctx.textAlign = 'right';
      const statusText = status ? ` [${status}]` : '';
      ctx.fillText(`${name} ${val.toFixed(0)}${statusText}`, chartWidth - 8, y - 3);
    };

    if (config.showDay) {
      drawLevel(shaakuni.pdh, 'PDH', '#FF8C00', shaakuni.pdhStatus);
      drawLevel(shaakuni.pdl, 'PDL', '#0096C8', shaakuni.pdlStatus);
    }
    if (config.showDEQ) {
      drawLevel(shaakuni.deq, 'D-EQ 50%', '#00E5FF');
    }
    if (config.showWeek) {
      drawLevel(shaakuni.pwh, 'PWH', '#DC3232');
      drawLevel(shaakuni.pwl, 'PWL', '#1EB464');
    }
    if (config.showEQ) {
      drawLevel(shaakuni.weq, 'W-EQ 50%', '#FFD700');
    }

    // 6. Draw Current Price Tag on Y-Scale
    const lastBar = visibleBars[visibleBars.length - 1];
    if (lastBar) {
      const curY = priceToY(lastBar.close);
      ctx.fillStyle = '#00E5FF';
      ctx.fillRect(chartWidth, curY - 10, rightScaleWidth, 20);
      ctx.fillStyle = '#040810';
      ctx.font = 'bold 10px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`$${lastBar.close.toFixed(1)}`, chartWidth + 4, curY + 4);
    }

    // 7. Middle Pane: CVD BTC Spot vs CVD BTC Perp
    let minCvd = Infinity;
    let maxCvd = -Infinity;
    for (const b of visibleBars) {
      if (b.cvdSpot < minCvd) minCvd = b.cvdSpot;
      if (b.cvdSpot > maxCvd) maxCvd = b.cvdSpot;
      if (b.cvdPerp < minCvd) minCvd = b.cvdPerp;
      if (b.cvdPerp > maxCvd) maxCvd = b.cvdPerp;
    }
    const cvdRange = Math.max(100, maxCvd - minCvd);
    const cvdToY = (cvd: number) =>
      cvdPaneTop + ((maxCvd - cvd) / cvdRange) * cvdPaneHeight;

    // CVD Spot Line (Cyan)
    ctx.strokeStyle = '#00E5FF';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    visibleBars.forEach((b, i) => {
      const x = i * barSpacing + barSpacing * 0.5;
      const y = cvdToY(b.cvdSpot);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // CVD Perp Line (Purple)
    ctx.strokeStyle = '#C084FC';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    visibleBars.forEach((b, i) => {
      const x = i * barSpacing + barSpacing * 0.5;
      const y = cvdToY(b.cvdPerp);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = '#64748B';
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('AGGR CVD // SPOT (CYAN) vs PERP (PURPLE)', 8, cvdPaneTop + 11);

    // 8. Bottom Pane: Delta Histograms
    let maxAbsDelta = 1;
    for (const b of visibleBars) {
      if (Math.abs(b.deltaSpot) > maxAbsDelta) maxAbsDelta = Math.abs(b.deltaSpot);
      if (Math.abs(b.deltaPerp) > maxAbsDelta) maxAbsDelta = Math.abs(b.deltaPerp);
    }
    const deltaMidY = deltaPaneTop + deltaPaneHeight * 0.5;
    const deltaHalfH = deltaPaneHeight * 0.45;

    visibleBars.forEach((b, i) => {
      const x = i * barSpacing + barSpacing * 0.5;
      const barH = (b.deltaPerp / maxAbsDelta) * deltaHalfH;
      ctx.fillStyle = b.deltaPerp >= 0 ? '#10B981' : '#F43F5E';
      ctx.fillRect(
        x - candleWidth * 0.4,
        b.deltaPerp >= 0 ? deltaMidY - barH : deltaMidY,
        candleWidth * 0.8,
        Math.max(1, Math.abs(barH))
      );
    });

    ctx.fillStyle = '#64748B';
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('DELTA PERPS & SPOT (STDEV σ THRESHOLD)', 8, deltaPaneTop + 11);

    // 9. Time Scale Labels (Bottom Axis)
    ctx.fillStyle = '#64748B';
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    const timeStep = Math.max(6, Math.floor(visibleBars.length / 7));
    for (let i = 0; i < visibleBars.length; i += timeStep) {
      const x = i * barSpacing + barSpacing * 0.5;
      const d = new Date(visibleBars[i].time);
      const tStr = `${String(d.getHours()).padStart(2, '0')}:${String(
        d.getMinutes()
      ).padStart(2, '0')}`;
      ctx.fillText(tStr, x, height - 7);
    }

    // 10. Interactive Crosshair
    if (hoverInfo && dragModeRef.current === 'NONE') {
      ctx.save();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hoverInfo.x, 0);
      ctx.lineTo(hoverInfo.x, height - bottomScaleHeight);
      ctx.moveTo(0, hoverInfo.y);
      ctx.lineTo(chartWidth, hoverInfo.y);
      ctx.stroke();
      ctx.restore();
    }
  }, [
    bars,
    shaakuni,
    config,
    heatmap,
    quant,
    activeSignal,
    visibleBarCount,
    panOffsetBars,
    priceZoomMultiplier,
    priceCenterOffsetUsd,
    hoverInfo,
  ]);

  // Pointer Down: Start Dragging (Pan / Stretch Y / Stretch X)
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const rightScaleWidth = 76;
    const bottomScaleHeight = 24;

    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      startPanBars: panOffsetBars,
      startPriceOffset: priceCenterOffsetUsd,
      startPriceZoom: priceZoomMultiplier,
      startBarCount: visibleBarCount,
    };

    if (x >= rect.width - rightScaleWidth) {
      // Dragging on Price Scale: Stretch Y
      dragModeRef.current = 'STRETCH_Y';
    } else if (y >= rect.height - bottomScaleHeight) {
      // Dragging on Time Scale: Stretch X
      dragModeRef.current = 'STRETCH_X';
    } else {
      // Dragging on Chart Body: Free 2D Pan (Time & Price)
      dragModeRef.current = 'PAN';
    }
  };

  // Pointer Move: Update Pan / Stretch or Crosshair
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || bars.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const rightScaleWidth = 76;
    const bottomScaleHeight = 24;
    const chartWidth = rect.width - rightScaleWidth;
    const candlesPlotWidth = Math.max(100, chartWidth - 84);

    if (dragModeRef.current === 'PAN') {
      const dx = e.clientX - dragStartRef.current.clientX;
      const dy = e.clientY - dragStartRef.current.clientY;

      const barSpacing = candlesPlotWidth / Math.max(1, visibleBarCount);
      const deltaBars = dx / barSpacing;
      setPanOffsetBars(Math.max(0, dragStartRef.current.startPanBars + deltaBars));

      // Calculate approximate USD per pixel
      const lastBar = bars[bars.length - 1];
      const approxSpan = (lastBar.close * 0.05) / Math.max(0.2, priceZoomMultiplier);
      const deltaUsd = (dy / (rect.height * 0.67)) * approxSpan;
      setPriceCenterOffsetUsd(dragStartRef.current.startPriceOffset + deltaUsd);
      return;
    }

    if (dragModeRef.current === 'STRETCH_Y') {
      const dy = dragStartRef.current.clientY - e.clientY;
      const factor = 1 + dy * 0.008;
      setPriceZoomMultiplier(
        Math.max(0.25, Math.min(6.0, dragStartRef.current.startPriceZoom * factor))
      );
      return;
    }

    if (dragModeRef.current === 'STRETCH_X') {
      const dx = dragStartRef.current.clientX - e.clientX;
      const deltaCount = Math.round(dx * 0.4);
      setVisibleBarCount(
        Math.max(15, Math.min(300, dragStartRef.current.startBarCount + deltaCount))
      );
      return;
    }

    // Crosshair hover calculation
    const count = Math.min(bars.length, visibleBarCount);
    const maxPan = Math.max(0, bars.length - count);
    const clampedPan = Math.max(0, Math.min(maxPan, Math.round(panOffsetBars)));
    const sliceEnd = bars.length - clampedPan;
    const sliceStart = Math.max(0, sliceEnd - count);
    const visibleBars = bars.slice(sliceStart, sliceEnd);
    if (visibleBars.length === 0) return;

    const barSpacing = candlesPlotWidth / visibleBars.length;
    const idx = Math.max(
      0,
      Math.min(visibleBars.length - 1, Math.floor(x / barSpacing))
    );
    const bar = visibleBars[idx];

    let minPrice = Math.min(...visibleBars.map((b) => b.low));
    let maxPrice = Math.max(...visibleBars.map((b) => b.high));
    const pad = (maxPrice - minPrice) * 0.08 || 60;
    minPrice -= pad;
    maxPrice += pad;
    const pricePaneHeight = Math.floor((rect.height - bottomScaleHeight) * 0.67) - 8;
    const priceAtCursor =
      maxPrice - ((y - 8) / Math.max(1, pricePaneHeight)) * (maxPrice - minPrice);

    setHoverInfo({ bar, x, y, priceAtCursor });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragModeRef.current = 'NONE';
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if not captured
    }
  };

  // Wheel Zoom (Time Horizon)
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 8 : -8;
    setVisibleBarCount((c) => Math.max(15, Math.min(300, c + delta)));
  };

  const inspectedBar = hoverInfo?.bar ?? bars[bars.length - 1];

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-[460px] bg-[#090D16] border border-slate-800/80 rounded-lg overflow-hidden select-none"
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
        onDoubleClick={resetView}
        className="block w-full h-full cursor-crosshair active:cursor-grabbing"
      />

      {/* Top Header Bar: Telemetry, Session & Non-Obstructive HUD */}
      <div className="absolute top-2.5 left-3 right-3 z-10 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        {/* Left: Live Bar O-H-L-C & Aggr CVD */}
        {inspectedBar && (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 bg-[#090D16]/95 border border-slate-800/90 px-3 py-1.5 rounded-md text-[11px] font-mono tabular-nums shadow-lg">
            <span className="font-sans font-semibold text-white">
              HYPERLIQUID:BTC-USD
            </span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-300">
              O <strong className="text-white">{inspectedBar.open.toFixed(1)}</strong>
            </span>
            <span className="text-slate-300">
              H <strong className="text-white">{inspectedBar.high.toFixed(1)}</strong>
            </span>
            <span className="text-slate-300">
              L <strong className="text-white">{inspectedBar.low.toFixed(1)}</strong>
            </span>
            <span className="text-slate-300">
              C{' '}
              <strong
                className={
                  inspectedBar.close >= inspectedBar.open
                    ? 'text-cyan-400'
                    : 'text-rose-400'
                }
              >
                {inspectedBar.close.toFixed(1)}
              </strong>
            </span>
            <span className="text-slate-500">·</span>
            <span className="text-cyan-300">
              ΔSpot: {inspectedBar.deltaSpot >= 0 ? '+' : ''}
              {(inspectedBar.deltaSpot / 1000).toFixed(0)}K
            </span>
            <span className="text-purple-300">
              ΔPerp: {inspectedBar.deltaPerp >= 0 ? '+' : ''}
              {(inspectedBar.deltaPerp / 1000).toFixed(0)}K
            </span>
          </div>
        )}

        {/* Right: Clean, Non-Obstructive Tool & Shaakuni Toggle Ribbon */}
        <div className="flex items-center gap-1.5 pointer-events-auto bg-[#0B101B]/95 border border-slate-800/90 px-2 py-1 rounded-md shadow-lg">
          {/* Compact Shaakuni Status Badge */}
          <button
            type="button"
            onClick={() => setShaakuniPanelOpen((v) => !v)}
            className={`px-2 py-0.5 text-[11px] font-mono font-medium rounded transition-colors flex items-center gap-1.5 ${
              shaakuniPanelOpen
                ? 'bg-[#ffc850]/20 text-[#ffc850] border border-[#ffc850]/40'
                : 'text-slate-300 hover:text-white bg-slate-900 border border-slate-800'
            }`}
            title="Kliknij, aby rozwinąć/zwinąć tabelę parametrów Shaakuni"
          >
            <span>Shaakuni ({shaakuni.nySession})</span>
            {shaakuniPanelOpen ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setVisibleBarCount((c) => Math.max(20, c - 15))}
            className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
            title="Przybliż (Zoom In)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setVisibleBarCount((c) => Math.min(250, c + 15))}
            className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
            title="Oddal (Zoom Out)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={resetView}
            className="px-2 py-0.5 text-[10px] font-medium text-cyan-300 hover:text-cyan-100 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 rounded flex items-center gap-1 transition-colors"
            title="Zresetuj pozycję i skalę wykresu (Auto-Fit)"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Auto-Fit</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onChangeConfig((prev) => ({
                ...prev,
                showLiqHeatmap: !prev.showLiqHeatmap,
              }))
            }
            className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 ${
              config.showLiqHeatmap
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3 h-3" />
            <span>Liq Heatmap</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onChangeConfig((prev) => ({
                ...prev,
                showNeuralCone: !prev.showNeuralCone,
              }))
            }
            className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 ${
              config.showNeuralCone
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-3 h-3" />
            <span>Neural Cone</span>
          </button>

          <button
            type="button"
            onClick={() => setShowSettingsModal((s) => !s)}
            className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 ${
              showSettingsModal
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
            title="Parametry Pine Script v6"
          >
            <SlidersHorizontal className="w-3 h-3" />
            <span>Pine Inputs</span>
          </button>
        </div>
      </div>

      {/* Interactive Helper Hint Badge (Bottom-Left) */}
      <div className="absolute bottom-2 left-3 z-10 pointer-events-none flex items-center gap-3 text-[10px] font-mono text-slate-500 bg-[#090D16]/80 px-2.5 py-1 rounded border border-slate-800/60">
        <span className="flex items-center gap-1 text-slate-400">
          <Move className="w-3 h-3 text-cyan-400" /> Przeciągnij: Przesuwanie (Pan)
        </span>
        <span>·</span>
        <span className="flex items-center gap-1 text-slate-400">
          <ArrowUpDown className="w-3 h-3 text-cyan-400" /> Oś Y: Rozciąganie ceny
        </span>
        <span>·</span>
        <span>Kółko myszy: Zoom świec</span>
        <span>·</span>
        <span>2x Klik: Reset</span>
      </div>

      {/* Expanded Shaakuni Table (Docked cleanly on the right, non-obstructive) */}
      {shaakuniPanelOpen && (
        <div className="absolute top-12 right-20 z-20 bg-[#141414]/98 border border-[#2a2a2a] rounded-md overflow-hidden shadow-2xl text-[11px] font-mono tabular-nums min-w-[245px] transition-all">
          <div className="flex items-center justify-between gap-4 px-2.5 py-1.5 bg-[#1f1f1f] border-b border-[#2a2a2a]">
            <span className="font-semibold text-[#ffc850]">
              Shaakuni - Levels & OB
            </span>
            <span className="text-[#a0a0a0]">BTCUSD / {timeframeLabel}</span>
          </div>

          <div className="flex items-center justify-between gap-4 px-2.5 py-1 bg-[#2d2d2d] border-b border-[#2a2a2a]">
            <span className="text-[#a0a0a0]">
              Session ({shaakuni.nyTimeFormatted})
            </span>
            <span
              className={
                shaakuni.nySession !== 'No Active Session'
                  ? 'text-[#64c88c] font-semibold'
                  : 'text-[#a0a0a0]'
              }
            >
              {shaakuni.nySession}
            </span>
          </div>

          <div
            className={`flex items-center justify-between gap-4 px-2.5 py-1 border-b border-[#2a2a2a] ${
              shaakuni.pdhStatus === 'Sweep !'
                ? 'bg-[#00b450]/35'
                : 'bg-[#141414]'
            }`}
          >
            <span className="text-[#ff8c00] font-medium">Day High (PDH)</span>
            <span
              className={
                shaakuni.pdhStatus === 'Sweep !'
                  ? 'text-white font-semibold'
                  : shaakuni.pdhStatus === 'Break'
                  ? 'text-[#c86464] font-semibold'
                  : 'text-[#a0a0a0]'
              }
            >
              {shaakuni.pdhStatus === 'Break'
                ? 'Broken X'
                : shaakuni.pdhStatus}{' '}
              {shaakuni.pdh ? Math.round(shaakuni.pdh) : '-'}
            </span>
          </div>

          <div
            className={`flex items-center justify-between gap-4 px-2.5 py-1 ${
              shaakuni.pdlStatus === 'Sweep !'
                ? 'bg-[#00b450]/35'
                : 'bg-[#141414]'
            }`}
          >
            <span className="text-[#0096c8] font-medium">Day Low (PDL)</span>
            <span
              className={
                shaakuni.pdlStatus === 'Sweep !'
                  ? 'text-white font-semibold'
                  : shaakuni.pdlStatus === 'Break'
                  ? 'text-[#c86464] font-semibold'
                  : 'text-[#a0a0a0]'
              }
            >
              {shaakuni.pdlStatus === 'Break'
                ? 'Broken X'
                : shaakuni.pdlStatus}{' '}
              {shaakuni.pdl ? Math.round(shaakuni.pdl) : '-'}
            </span>
          </div>
        </div>
      )}

      {/* Configurable Pine Script v6 Inputs Popover */}
      {showSettingsModal && (
        <div className="absolute top-12 right-20 z-30 bg-[#0B101B] border border-slate-700 rounded-lg p-3 shadow-2xl w-72 text-xs space-y-2.5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
            <span className="font-semibold text-white">
              Shaakuni Pine v6 Parameters
            </span>
            <button
              type="button"
              onClick={() => setShowSettingsModal(false)}
              className="text-slate-400 hover:text-white text-[11px]"
            >
              Zamknij
            </button>
          </div>

          <div className="space-y-2">
            <label className="flex items-center justify-between text-slate-300">
              <span>OB Lookback (świece)</span>
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
                className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-right font-mono text-cyan-300"
              />
            </label>

            <label className="flex items-center justify-between text-slate-300">
              <span>Świeca Impulsu (x ATR)</span>
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
                className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-right font-mono text-cyan-300"
              />
            </label>

            <label className="flex items-center justify-between text-slate-300">
              <span>Strefa Czasowa NY</span>
              <select
                value={config.tzChoice}
                onChange={(e) =>
                  onChangeConfig((c) => ({
                    ...c,
                    tzChoice: e.target.value as ShaakuniConfig['tzChoice'],
                  }))
                }
                className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-200"
              >
                <option value="Auto (DST)">Auto (DST)</option>
                <option value="Manual UTC-4 (EDT)">UTC-4 (EDT)</option>
                <option value="Manual UTC-5 (EST)">UTC-5 (EST)</option>
              </select>
            </label>

            <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-slate-800 text-[11px]">
              {(
                [
                  { key: 'showWeek', label: 'Tygodniowe H/L' },
                  { key: 'showEQ', label: 'Weekly EQ 50%' },
                  { key: 'showDay', label: 'Dzienny H/L' },
                  { key: 'showDEQ', label: 'Daily EQ 50%' },
                  { key: 'showOB', label: 'Order Blocks (OB)' },
                  { key: 'showMit', label: 'Pokaż Mitigated' },
                ] as const
              ).map((item) => (
                <label
                  key={item.key}
                  className="flex items-center gap-1.5 text-slate-300 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(config[item.key])}
                    onChange={(e) =>
                      onChangeConfig((c) => ({
                        ...c,
                        [item.key]: e.target.checked,
                      }))
                    }
                    className="accent-cyan-400"
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
