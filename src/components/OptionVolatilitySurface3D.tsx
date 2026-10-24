import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Maximize2, Move3d, RotateCcw } from 'lucide-react';
import {
  BackendQuantTelemetry,
  OptionVolSurfacePoint,
  QuantMathMetrics,
  ShaakuniState,
} from '../types/trading';
import { normCdf, normPdf } from '../utils/stats';
import { Badge, EmptyState, Segmented } from '../ui';
import { tr } from '../i18n';

// UWAGA: Hyperliquid nie ma rynku opcji, a aplikacja nie pobiera żadnych danych opcyjnych.
// Cały panel to model ilustracyjny (parametryczny smile IV + Black-Scholes), nie dane rynkowe —
// dlatego komponent celowo nie emituje sygnałów transakcyjnych.
interface OptionVolatilitySurface3DProps {
  currentPrice: number;
  shaakuni: ShaakuniState;
  quant: QuantMathMetrics;
  backendTelemetry: BackendQuantTelemetry | null;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

const EXPIRIES: { days: number; label: string }[] = [
  { days: 1, label: '1D (Daily)' },
  { days: 3, label: '3D' },
  { days: 7, label: '7D (Weekly)' },
  { days: 14, label: '14D' },
  { days: 30, label: '30D (Monthly)' },
  { days: 60, label: '60D' },
  { days: 90, label: '90D (Quarterly)' },
  { days: 180, label: '180D (Bi-Annual)' },
];

// Stopa wolna od ryzyka przyjęta w modelu (roczna, ciągła kapitalizacja); dywidenda q = 0.
const RISK_FREE_RATE = 0.045;

// Greki Blacka-Scholesa dla opcji CALL przy q = 0.
// Jednostki: delta — bezwymiarowa (0..1); gamma — zmiana delty na 1 $ ruchu spotu (1/$);
// vanna = ∂Δ/∂σ na 1.00 zmienności (na 1 pkt vol podziel przez 100);
// charm = ∂Δ/∂t na rok upływu czasu (na 1 dzień podziel przez 365).
// Dla T ≤ 0 lub σ ≤ 0 zwracamy granicę wypłaty (delta 0/1, pozostałe greki 0), żeby uniknąć NaN.
const bsCallGreeks = (
  spot: number,
  strike: number,
  tYears: number,
  sigma: number,
  r: number
) => {
  if (!(tYears > 0) || !(sigma > 0) || !(spot > 0) || !(strike > 0)) {
    return { delta: spot > strike ? 1 : 0, gamma: 0, vanna: 0, charm: 0 };
  }
  const sigmaSqrtT = sigma * Math.sqrt(tYears);
  const d1 = (Math.log(spot / strike) + (r + 0.5 * sigma * sigma) * tYears) / sigmaSqrtT;
  const d2 = d1 - sigmaSqrtT;
  const pdfD1 = normPdf(d1);
  return {
    delta: normCdf(d1),
    gamma: pdfD1 / (spot * sigmaSqrtT),
    vanna: (-pdfD1 * d2) / sigma,
    charm: (-pdfD1 * (2 * r * tYears - d2 * sigmaSqrtT)) / (2 * tYears * sigmaSqrtT),
  };
};

type SurfaceMode = 'iv_surface' | 'model_gamma' | 'model_vanna';

export const OptionVolatilitySurface3D: React.FC<
  OptionVolatilitySurface3DProps
> = ({
  currentPrice,
  backendTelemetry,
  onToggleExpand,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapperRef = useRef<HTMLDivElement | null>(null);

  // 3D Isometric Orientation Angles (Clamped to avoid degenerate edge-on view)
  const [pitch, setPitch] = useState<number>(36); // degrees
  const [yaw, setYaw] = useState<number>(-38); // degrees
  const [zoom, setZoom] = useState<number>(1);
  const [activeSurfaceMode, setActiveSurfaceMode] = useState<SurfaceMode>('iv_surface');
  const [selectedExpiryDays, setSelectedExpiryDays] = useState<number>(30);
  const [hoveredPoint, setHoveredPoint] =
    useState<OptionVolSurfacePoint | null>(null);

  const isDraggingRef = useRef<boolean>(false);
  // Rozmiar ramki płótna — przerysowanie po zmianie układu (obrót telefonu, okno)
  const [wrapSize, setWrapSize] = useState<string>('');
  useEffect(() => {
    const el = canvasWrapperRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWrapSize(`${el.clientWidth}x${el.clientHeight}`));
    ro.observe(el);
    return () => ro.disconnect();
    // Ramka istnieje tylko gdy jest cena — obserwator podpinany po jej pojawieniu się
  }, [currentPrice > 0]);
  const lastMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Generate 15 Strikes x 8 Expiries Option Volatility & GEX Grid
  // Brak ceny → pusta siatka i komunikat zamiast ceny zastępczej
  const spotOk = currentPrice > 0;
  const surfaceGrid = useMemo(() => {
    const spot = currentPrice > 0 ? currentPrice : 1;
    const strikeStep = 1000;
    const baseStrike = Math.round(spot / 1000) * 1000;
    const strikes: number[] = [];
    for (let i = -7; i <= 7; i++) {
      strikes.push(baseStrike + i * strikeStep);
    }

    const points: OptionVolSurfacePoint[] = [];

    // Człon fundingu stosujemy tylko przy realnej telemetrii — bez niej nie zakładamy żadnej wartości.
    const fundingSqueezeDrift =
      backendTelemetry && backendTelemetry.fundingAnnualizedPct > 15 ? 0.04 : 0;

    strikes.forEach((k) => {
      const moneyness = k / spot;
      const logMoneyness = Math.log(moneyness);

      EXPIRIES.forEach((exp) => {
        const tYears = exp.days / 365;

        // Ilustracyjny, ręcznie sparametryzowany smile w IV (struktura terminowa + skew + krzywizna).
        // To NIE jest kalibracja SVI ani Hestona do danych rynkowych — brak kwotowań opcji.
        const termStructure = 0.44 + (0.16 / Math.sqrt(Math.max(0.01, exp.days / 7)));
        const skew = -0.065 * logMoneyness * 4.5; // Downside put skew
        const smileCurvature = 0.18 * Math.pow(logMoneyness * 3.5, 2);

        const impliedVolPct = Math.max(
          32,
          Math.min(
            115,
            (termStructure + skew + smileCurvature + fundingSqueezeDrift) * 100
          )
        );

        // Greki Blacka-Scholesa dla CALL (r = RISK_FREE_RATE, q = 0)
        const sigma = impliedVolPct / 100;
        const greeks = bsCallGreeks(spot, k, tYears, sigma, RISK_FREE_RATE);

        // Gamma modelu w $ na ruch spotu o 1% na 1 BTC nominału: Γ·S²·0.01.
        // Bez open interest nie znamy pozycjonowania dealerów, więc brak odwracania znaku (to nie GEX).
        const gammaUsdPer1Pct = Number(
          (greeks.gamma * spot * spot * 0.01).toFixed(2)
        );

        points.push({
          strike: k,
          expiryDays: exp.days,
          expiryLabel: exp.label,
          moneyness: Number(moneyness.toFixed(3)),
          impliedVol: Number(impliedVolPct.toFixed(1)),
          delta: Number(greeks.delta.toFixed(2)),
          gammaUsdPer1Pct,
          vanna: Number(greeks.vanna.toFixed(3)),
          charm: Number(greeks.charm.toFixed(3)),
          // Max pain i zero-gamma wymagają open interest per strike — niedostępne, więc zawsze false.
          isMaxPain: false,
          isZeroGamma: false,
        });
      });
    });

    return { strikes, expiries: EXPIRIES, points };
  }, [currentPrice, backendTelemetry]);

  // ATM IV wyliczone z siatki modelu: strike najbliższy spotowi przy wygaśnięciu 30D (wynik modelu, nie rynek).
  const modelAtmIv30 = useMemo<number | null>(() => {
    const slice30 = surfaceGrid.points.filter((p) => p.expiryDays === 30);
    if (slice30.length === 0) return null;
    const spot = currentPrice;
    const atm = slice30.reduce((best, p) =>
      Math.abs(p.strike - spot) < Math.abs(best.strike - spot) ? p : best
    );
    return atm.impliedVol;
  }, [surfaceGrid, currentPrice]);

  // (Usunięto pseudo-fizyczny HUD — „liczba Reynoldsa”, „MPa” — nie miał podstaw w danych)

  // Slice points for currently selected expiry for the 2D cross-section smile
  const currentExpirySlice = useMemo(() => {
    return surfaceGrid.points.filter((p) => p.expiryDays === selectedExpiryDays);
  }, [surfaceGrid, selectedExpiryDays]);

  // Interactive 3D Canvas Rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = canvasWrapperRef.current;
    if (!canvas || !wrapper || !spotOk) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = wrapper.clientWidth;
    const height = wrapper.clientHeight;
    if (width < 50 || height < 50) return;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    // Tło panelu (surface-1)
    ctx.fillStyle = '#0b1019';
    ctx.fillRect(0, 0, width, height);

    // Center of 3D projection - dynamic offset
    const cx = width * 0.5;
    const cy = height * 0.52;

    const radPitch = (pitch * Math.PI) / 180;
    const radYaw = (yaw * Math.PI) / 180;
    const cosPitch = Math.cos(radPitch);
    const sinPitch = Math.sin(radPitch);
    const cosYaw = Math.cos(radYaw);
    const sinYaw = Math.sin(radYaw);

    const strikes = surfaceGrid.strikes;
    const expiries = surfaceGrid.expiries;

    const minStrike = strikes[0];
    const maxStrike = strikes[strikes.length - 1];
    const strikeRange = Math.max(1, maxStrike - minStrike);

    // Responsive 3D box scaling that generously fills the wide canvas!
    // Skala dopasowana do płótna: po obrocie |x| ≤ ~1.4, |y| ≤ ~1.63, perspektywa ≤ ~1.17 —
    // przy zoomie 100% cała powierzchnia mieści się w ramce (z marginesem na etykiety osi)
    const boxW = (Math.max(120, width / 2 - 28) / 1.64) * zoom;
    const boxH = (Math.max(100, height / 2 - 28) / 1.9) * zoom;

    // 3D to 2D projection function
    const project = (strikeVal: number, expIdx: number, valNorm: number) => {
      // Normalized coordinates (-1 to 1)
      const nx = ((strikeVal - minStrike) / strikeRange) * 2 - 1;
      const nz = (expIdx / (expiries.length - 1)) * 2 - 1;
      const ny = valNorm * 2 - 1; // height

      // 3D rotation
      // 1. Yaw rotation (around Y)
      const x1 = nx * cosYaw - nz * sinYaw;
      const z1 = nx * sinYaw + nz * cosYaw;
      // 2. Pitch rotation (around X)
      const y2 = ny * cosPitch - z1 * sinPitch;
      const z2 = ny * sinPitch + z1 * cosPitch;

      // Perspective projection
      const dist = 3.8;
      const fov = dist / (dist + z2 * 0.4);

      return {
        px: cx + x1 * boxW * fov,
        py: cy - y2 * boxH * fov,
        depth: z2,
      };
    };

    // Skale sekwencyjne jednego odcienia: IV = akcent, gamma/vanna modelu = zone (krycie rośnie z wartością)
    const getColor = (normVal: number, mode: SurfaceMode) => {
      if (mode === 'iv_surface') return `rgba(63, 198, 221, ${0.18 + normVal * 0.7})`;
      return `rgba(144, 133, 233, ${0.18 + normVal * 0.7})`;
    };

    // 1. Draw 3D Base Floor Grid & Shadow
    ctx.strokeStyle = '#1b2533';
    ctx.lineWidth = 1;
    for (let i = 0; i < strikes.length; i += 2) {
      const p1 = project(strikes[i], 0, -0.05);
      const p2 = project(strikes[i], expiries.length - 1, -0.05);
      ctx.beginPath();
      ctx.moveTo(p1.px, p1.py);
      ctx.lineTo(p2.px, p2.py);
      ctx.stroke();
    }
    for (let j = 0; j < expiries.length; j++) {
      const p1 = project(strikes[0], j, -0.05);
      const p2 = project(strikes[strikes.length - 1], j, -0.05);
      ctx.beginPath();
      ctx.moveTo(p1.px, p1.py);
      ctx.lineTo(p2.px, p2.py);
      ctx.stroke();

      // Etykieta osi terminu
      ctx.fillStyle = '#7a889c';
      ctx.font = '9px "IBM Plex Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(expiries[j].label.split(' ')[0], p1.px - 6, p1.py + 3);
    }

    // 2. Build and Depth-Sort 3D Polygons (Painter's Algorithm)
    interface QuadPoly {
      k1: number;
      k2: number;
      j: number;
      avgVal: number;
      avgDepth: number;
      pts: { px: number; py: number }[];
    }
    const quads: QuadPoly[] = [];

    // Surowa wartość rysowana w trybach gamma / vanna; wysokość normalizujemy min/max po całej siatce
    const getRawVal = (p: OptionVolSurfacePoint) =>
      activeSurfaceMode === 'model_gamma' ? p.gammaUsdPer1Pct : Math.abs(p.vanna);
    let rawMin = Infinity;
    let rawMax = -Infinity;
    surfaceGrid.points.forEach((p) => {
      const v = getRawVal(p);
      if (v < rawMin) rawMin = v;
      if (v > rawMax) rawMax = v;
    });
    // Ochrona przed płaską siatką (max == min) — wtedy rysujemy płaszczyznę na połowie wysokości
    const rawRange = rawMax - rawMin;

    const getVal = (p: OptionVolSurfacePoint) => {
      if (activeSurfaceMode !== 'iv_surface') {
        if (!(rawRange > 0)) return 0.5;
        return Math.max(0, Math.min(1, (getRawVal(p) - rawMin) / rawRange));
      }
      return Math.max(0, Math.min(1, (p.impliedVol - 35) / 65));
    };

    for (let j = 0; j < expiries.length - 1; j++) {
      for (let i = 0; i < strikes.length - 1; i++) {
        const k1 = strikes[i];
        const k2 = strikes[i + 1];

        const pt1 = surfaceGrid.points.find(
          (p) => p.strike === k1 && p.expiryDays === expiries[j].days
        );
        const pt2 = surfaceGrid.points.find(
          (p) => p.strike === k2 && p.expiryDays === expiries[j].days
        );
        const pt3 = surfaceGrid.points.find(
          (p) => p.strike === k2 && p.expiryDays === expiries[j + 1].days
        );
        const pt4 = surfaceGrid.points.find(
          (p) => p.strike === k1 && p.expiryDays === expiries[j + 1].days
        );

        if (!pt1 || !pt2 || !pt3 || !pt4) continue;

        const v1 = getVal(pt1);
        const v2 = getVal(pt2);
        const v3 = getVal(pt3);
        const v4 = getVal(pt4);
        const avgVal = (v1 + v2 + v3 + v4) * 0.25;

        const proj1 = project(k1, j, v1);
        const proj2 = project(k2, j, v2);
        const proj3 = project(k2, j + 1, v3);
        const proj4 = project(k1, j + 1, v4);

        const avgDepth = (proj1.depth + proj2.depth + proj3.depth + proj4.depth) * 0.25;

        quads.push({
          k1,
          k2,
          j,
          avgVal,
          avgDepth,
          pts: [proj1, proj2, proj3, proj4],
        });
      }
    }

    // Sort from farthest to nearest
    quads.sort((a, b) => a.avgDepth - b.avgDepth);

    // Render Quads
    quads.forEach((q) => {
      ctx.beginPath();
      ctx.moveTo(q.pts[0].px, q.pts[0].py);
      ctx.lineTo(q.pts[1].px, q.pts[1].py);
      ctx.lineTo(q.pts[2].px, q.pts[2].py);
      ctx.lineTo(q.pts[3].px, q.pts[3].py);
      ctx.closePath();

      ctx.fillStyle = getColor(q.avgVal, activeSurfaceMode);
      ctx.fill();

      ctx.strokeStyle = activeSurfaceMode === 'iv_surface' ? 'rgba(63, 198, 221, 0.45)' : 'rgba(144, 133, 233, 0.45)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    });

    // 3. Znacznik ceny spot (bez poziomu zero-gamma — wymagałby open interest, którego nie mamy)
    const spotProj = project(currentPrice, 2, 0.5);
    ctx.strokeStyle = '#eef2f7';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(spotProj.px, spotProj.py - 30);
    ctx.lineTo(spotProj.px, spotProj.py + 30);
    ctx.stroke();

    ctx.fillStyle = '#eef2f7';
    ctx.font = '600 10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`SPOT $${currentPrice.toFixed(0)}`, spotProj.px + 5, spotProj.py - 14);

    // Strike Axis Labels at bottom edge
    for (let i = 0; i < strikes.length; i += 3) {
      const p = project(strikes[i], expiries.length - 1, -0.05);
      ctx.fillStyle = '#a9b4c4';
      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`$${(strikes[i] / 1000).toFixed(0)}k`, p.px, p.py + 12);
    }
  }, [surfaceGrid, pitch, yaw, zoom, activeSurfaceMode, currentPrice, spotOk, wrapSize]);

  // Mouse Drag Rotation Handlers (With safe pitch limits)
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = true;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - lastMouseRef.current.x;
    const dy = e.clientY - lastMouseRef.current.y;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };

    setYaw((prev) => (prev + dx * 0.5) % 360);
    // Keep pitch bounded between 18 deg and 68 deg so 3D perspective never vanishes!
    setPitch((prev) => Math.max(18, Math.min(68, prev - dy * 0.4)));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  };

  if (!spotOk) {
    return (
      <div className="w-full h-full bg-surface-1 border border-line rounded-xl">
        <EmptyState
          title={tr('Brak ceny BTC', 'No BTC price')}
          detail={tr('Ilustracja opcji potrzebuje bieżącej ceny Hyperliquid — poczekaj na synchronizację danych.', 'The options illustration needs the current Hyperliquid price; wait for the data to sync.')}
        />
      </div>
    );
  }

  const greekCell = 'bg-page border border-line rounded-lg p-2 min-w-0';
  return (
    <div className="w-full bg-surface-1 border border-line rounded-xl overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-line flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[15px] font-semibold text-ink-1 flex flex-wrap items-center gap-2">
            {tr('Options (ilustracja) · powierzchnia IV modelu', 'Options (illustration) · model IV surface')}
            <Badge tone="model" title={tr('Parametryczny smile IV + Black-Scholes; brak kwotowań opcji', 'Parametric IV smile + Black-Scholes; no option quotes')}>
              MODEL
            </Badge>
          </h2>
          <p className="text-[11px] text-ink-3 font-mono tabular-nums mt-0.5">
            Spot {currentPrice.toFixed(1)} · {tr('ATM IV modelu (30D)', 'model ATM IV (30D)')} {modelAtmIv30 !== null ? `${modelAtmIv30.toFixed(1)}%` : '—'} · r ={' '}
            {(RISK_FREE_RATE * 100).toFixed(1)}%, q = 0
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 max-w-full">
          <div className="overflow-x-auto max-w-full">
            <Segmented<SurfaceMode>
              ariaLabel={tr('Wielkość na osi wysokości', 'Quantity on the height axis')}
              value={activeSurfaceMode}
              onChange={setActiveSurfaceMode}
              options={[
                { value: 'iv_surface', label: 'IV' },
                { value: 'model_gamma', label: 'Gamma ($/1% · 1 BTC)' },
                { value: 'model_vanna', label: 'Vanna |∂Δ/∂σ|' },
              ]}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setPitch(36);
              setYaw(-38);
              setZoom(1);
            }}
            className="inline-flex items-center justify-center w-9 h-9 text-ink-2 hover:text-ink-1 bg-surface-2 border border-line rounded-lg transition-colors duration-150"
            title={tr('Resetuj orientację', 'Reset orientation')}
            aria-label={tr('Resetuj orientację', 'Reset orientation')}
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          {onToggleExpand && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="inline-flex items-center justify-center w-9 h-9 text-ink-2 hover:text-ink-1 bg-surface-2 border border-line rounded-lg transition-colors duration-150"
              title={tr('Maksymalizuj / zwiń panel', 'Maximise / collapse panel')}
              aria-label={tr('Maksymalizuj / zwiń panel', 'Maximise / collapse panel')}
            >
              <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12">
        {/* Powierzchnia 3D (rzut perspektywiczny na płótnie 2D) */}
        <div
          ref={canvasWrapperRef}
          className="lg:col-span-8 relative h-[340px] sm:h-[420px] lg:h-[520px] cursor-grab active:cursor-grabbing border-b lg:border-b-0 lg:border-r border-line"
        >
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={tr("Ilustracyjna powierzchnia zmienności implikowanej modelu w funkcji strike'u i terminu", 'Illustrative model implied volatility surface as a function of strike and expiry')}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            className="w-full h-full block touch-none"
          />
          <div className="absolute top-3 left-3 pointer-events-none bg-surface-1/90 border border-line rounded-lg px-2.5 py-1 text-[11px] text-ink-2 flex items-center gap-1.5">
            <Move3d className="w-3.5 h-3.5 text-ink-3" aria-hidden="true" />
            {tr('Przeciągnij, aby obrócić', 'Drag to rotate')}
          </div>
          <label className="absolute right-3 bottom-3 flex items-center gap-2 bg-surface-1/90 border border-line rounded-lg px-2.5 py-1 text-[11px] text-ink-3">
            Zoom
            <input
              type="range"
              min={0.8}
              max={1.8}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-16 accent-accent cursor-pointer"
            />
            <span className="font-mono tabular-nums text-ink-1 w-9">{(zoom * 100).toFixed(0)}%</span>
          </label>
        </div>

        {/* Przekrój smile dla wybranego terminu + greki modelu */}
        <div className="lg:col-span-4 p-4 flex flex-col gap-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">{tr('Przekrój smile · greki (CALL)', 'Smile cross-section · greeks (CALL)')}</span>
            <select
              value={selectedExpiryDays}
              onChange={(e) => setSelectedExpiryDays(Number(e.target.value))}
              aria-label={tr('Termin wygaśnięcia', 'Expiry')}
              className="bg-page border border-line-strong rounded-lg px-2 min-h-9 text-xs text-ink-1"
            >
              {EXPIRIES.map((exp) => (
                <option key={exp.days} value={exp.days}>
                  {exp.label}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-page border border-line rounded-lg p-2.5">
            <div className="flex items-center justify-between text-[11px] text-ink-3">
              <span>
                {tr('IV modelu', 'Model IV')} · {selectedExpiryDays}D
              </span>
              <span className="font-mono tabular-nums text-ink-2">ATM {Math.round(currentPrice / 1000) * 1000}</span>
            </div>
            <div className="h-24 flex items-end justify-center gap-1 pt-2">
              {currentExpirySlice.map((p) => {
                const isAtm = Math.abs(p.strike - currentPrice) < 600;
                const heightPct = Math.max(15, Math.min(100, (p.impliedVol / 110) * 100));
                return (
                  <button
                    key={p.strike}
                    type="button"
                    onMouseEnter={() => setHoveredPoint(p)}
                    onMouseLeave={() => setHoveredPoint(null)}
                    onFocus={() => setHoveredPoint(p)}
                    onBlur={() => setHoveredPoint(null)}
                    onClick={() => setHoveredPoint(p)}
                    title={`Strike ${p.strike} · IV ${p.impliedVol}%`}
                    aria-label={tr(`Strike ${p.strike}, IV modelu ${p.impliedVol}%`, `Strike ${p.strike}, model IV ${p.impliedVol}%`)}
                    className="flex-1 max-w-6 h-full flex items-end"
                  >
                    <span
                      style={{ height: `${heightPct}%` }}
                      className={`block w-full rounded-t ${
                        isAtm ? 'bg-ink-1' : p.strike < currentPrice ? 'bg-ink-3/70 hover:bg-ink-3' : 'bg-accent/60 hover:bg-accent'
                      }`}
                    />
                  </button>
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-ink-3 mt-1 font-mono tabular-nums">
              <span>put OTM {currentExpirySlice[0]?.strike ?? '—'}</span>
              <span>ATM</span>
              <span>call OTM {currentExpirySlice[currentExpirySlice.length - 1]?.strike ?? '—'}</span>
            </div>
          </div>

          {/* Bez wskazania słupka pokazujemy „—” zamiast wartości domyślnych */}
          <div className="grid grid-cols-2 gap-2 tabular-nums">
            <div className={greekCell}>
              <span className="text-[10px] text-ink-3 block">{tr('Strike · IV modelu', 'Strike · model IV')}</span>
              <span className="font-mono text-ink-1">
                {hoveredPoint ? `${hoveredPoint.strike} · ${hoveredPoint.impliedVol}%` : '—'}
              </span>
            </div>
            <div className={greekCell}>
              <span className="text-[10px] text-ink-3 block">Delta Δ · vanna</span>
              <span className="font-mono text-ink-1">
                {hoveredPoint ? `${hoveredPoint.delta} · ${hoveredPoint.vanna}` : '—'}
              </span>
            </div>
            <div className={greekCell}>
              <span className="text-[10px] text-ink-3 block">Gamma ($/1% · 1 BTC)</span>
              <span className="font-mono text-ink-1">{hoveredPoint ? `$${hoveredPoint.gammaUsdPer1Pct.toFixed(0)}` : '—'}</span>
            </div>
            <div className={greekCell}>
              <span className="text-[10px] text-ink-3 block">{tr('Charm ∂Δ/∂t (/rok)', 'Charm ∂Δ/∂t (/year)')}</span>
              <span className="font-mono text-ink-1">{hoveredPoint?.charm ?? '—'}</span>
            </div>
          </div>

          <p className="text-[11px] text-ink-3 leading-relaxed">
            {tr(
              'Hyperliquid nie ma rynku opcji, a aplikacja nie pobiera kwotowań. Zero-gamma, max pain i GEX dealerów wymagają open interest per strike — nie są wyliczane. To parametryczny smile + greki Blacka-Scholesa, wyłącznie do nauki.',
              'Hyperliquid has no options market and the app does not fetch quotes. Zero-gamma, max pain and dealer GEX need open interest per strike, so they are not computed. This is a parametric smile + Black-Scholes greeks, for learning only.'
            )}
          </p>
        </div>
      </div>
    </div>
  );
};
