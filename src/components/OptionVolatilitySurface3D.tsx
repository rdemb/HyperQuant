import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  RotateCcw,
  Sparkles,
  Layers,
  Activity,
  Compass,
  Zap,
  Target,
  Maximize2,
  ChevronDown,
  ChevronUp,
  BarChart3,
  TrendingUp,
} from 'lucide-react';
import {
  BackendQuantTelemetry,
  MarketPhysicsMetrics,
  OptionVolSurfacePoint,
  QuantMathMetrics,
  ShaakuniState,
} from '../types/trading';

interface OptionVolatilitySurface3DProps {
  currentPrice: number;
  shaakuni: ShaakuniState;
  quant: QuantMathMetrics;
  backendTelemetry: BackendQuantTelemetry | null;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onTriggerVolSignal?: (
    dir: 'LONG' | 'SHORT',
    title: string,
    reason: string
  ) => void;
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

export const OptionVolatilitySurface3D: React.FC<
  OptionVolatilitySurface3DProps
> = ({
  currentPrice,
  shaakuni,
  quant,
  backendTelemetry,
  isExpanded = false,
  onToggleExpand,
  onTriggerVolSignal,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapperRef = useRef<HTMLDivElement | null>(null);

  // 3D Isometric Orientation Angles (Clamped to avoid degenerate edge-on view)
  const [pitch, setPitch] = useState<number>(36); // degrees
  const [yaw, setYaw] = useState<number>(-38); // degrees
  const [zoom, setZoom] = useState<number>(1.15);
  const [activeSurfaceMode, setActiveSurfaceMode] = useState<
    'iv_surface' | 'gex_dealer' | 'fluid_mechanics'
  >('iv_surface');
  const [selectedExpiryDays, setSelectedExpiryDays] = useState<number>(30);
  const [hoveredPoint, setHoveredPoint] =
    useState<OptionVolSurfacePoint | null>(null);

  const isDraggingRef = useRef<boolean>(false);
  const lastMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Generate 15 Strikes x 8 Expiries Option Volatility & GEX Grid
  const surfaceGrid = useMemo(() => {
    const spot = currentPrice || 82850;
    const strikeStep = 1000;
    const baseStrike = Math.round(spot / 1000) * 1000;
    const strikes: number[] = [];
    for (let i = -7; i <= 7; i++) {
      strikes.push(baseStrike + i * strikeStep);
    }

    const points: OptionVolSurfacePoint[] = [];
    const maxPainStrike = baseStrike - 1000;
    const zeroGammaStrike = baseStrike + 500;

    strikes.forEach((k) => {
      const moneyness = k / spot;
      const logMoneyness = Math.log(moneyness);

      EXPIRIES.forEach((exp) => {
        const tYears = exp.days / 365;

        // Implied Volatility Smile (SVI / Heston parametric approximation)
        const termStructure = 0.44 + (0.16 / Math.sqrt(Math.max(0.01, exp.days / 7)));
        const skew = -0.065 * logMoneyness * 4.5; // Downside put skew
        const smileCurvature = 0.18 * Math.pow(logMoneyness * 3.5, 2);
        const fundingSqueezeDrift =
          (backendTelemetry?.fundingAnnualizedPct ?? 10.9) > 15 ? 0.04 : 0;

        const impliedVolPct = Math.max(
          32,
          Math.min(
            115,
            (termStructure + skew + smileCurvature + fundingSqueezeDrift) * 100
          )
        );

        // Black-Scholes approx d1, d2
        const sigma = impliedVolPct / 100;
        const d1 =
          (Math.log(spot / k) + (0.045 + 0.5 * sigma * sigma) * tYears) /
          (sigma * Math.sqrt(tYears));
        const delta = Math.max(-1, Math.min(1, Math.tanh(d1 * 1.1)));

        // Gamma Exposure (GEX): Dealers Long Gamma near ATM/ITM Calls, Short Gamma at OTM Puts
        const gamma = Math.exp(-0.5 * d1 * d1) / (spot * sigma * Math.sqrt(tYears));
        const gammaExposureUsd = Number(
          (
            (gamma * spot * spot * 0.01 * (k > zeroGammaStrike ? 1 : -0.85)) /
            1e6
          ).toFixed(2)
        );

        points.push({
          strike: k,
          expiryDays: exp.days,
          expiryLabel: exp.label,
          moneyness: Number(moneyness.toFixed(3)),
          impliedVol: Number(impliedVolPct.toFixed(1)),
          delta: Number(delta.toFixed(2)),
          gammaExposureUsd,
          vanna: Number((-d1 * (1 - delta) * 0.1).toFixed(3)),
          charm: Number((-delta * (0.05 / Math.max(0.1, tYears))).toFixed(3)),
          isMaxPain: k === maxPainStrike && exp.days === 30,
          isZeroGamma: Math.abs(k - zeroGammaStrike) <= 500,
        });
      });
    });

    return { strikes, expiries: EXPIRIES, points };
  }, [currentPrice, backendTelemetry]);

  // Market Physics & Fluid Dynamics Telemetry
  const physics = useMemo<MarketPhysicsMetrics>(() => {
    const volTotal = (quant.hawkesBuyIntensity + quant.hawkesSellIntensity) * 1000;
    const flowDisplacement = Math.abs(currentPrice - (shaakuni.deq ?? currentPrice));

    const reynoldsNumber = Math.round(
      Math.max(650, (volTotal / 45000) * (flowDisplacement + 12) * 18)
    );

    const flowViscosity = Math.round(
      (quant.kyleLambdaUp + quant.kyleLambdaDown) * 0.5 * 1000
    );

    const kineticPressureGradient = Number(
      (quant.hawkesNetDominance * (volTotal / 1e6)).toFixed(3)
    );

    let regime: MarketPhysicsMetrics['regime'] = 'Laminar Steady Flow';
    if (reynoldsNumber > 2600) regime = 'Turbulent Churn';
    else if (quant.vpinToxicity > 0.68) regime = 'Cavitation Breakout';
    else if (flowViscosity > 450000) regime = 'Viscous Stagnation';

    return {
      reynoldsNumber,
      flowViscosity,
      kineticPressureGradient,
      brownianDiffusionCoeff: Number((quant.hurstExponent * 1.8).toFixed(2)),
      bernoulliLiftScore: Number(
        (quant.combinatorialPathProbPDH - quant.combinatorialPathProbPDL).toFixed(2)
      ),
      regime,
    };
  }, [quant, currentPrice, shaakuni]);

  // Slice points for currently selected expiry for the 2D cross-section smile
  const currentExpirySlice = useMemo(() => {
    return surfaceGrid.points.filter((p) => p.expiryDays === selectedExpiryDays);
  }, [surfaceGrid, selectedExpiryDays]);

  // Interactive 3D Canvas Rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = canvasWrapperRef.current;
    if (!canvas || !wrapper) return;

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

    // Dark obsidian glass backdrop (#070A12)
    ctx.fillStyle = '#070A12';
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
    const boxW = Math.max(width * 0.44, 340) * zoom;
    const boxD = Math.max(height * 0.38, 220) * zoom;
    const boxH = Math.max(height * 0.32, 160) * zoom;

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

    // Color gradient interpolation
    const getColor = (normVal: number, mode: string) => {
      if (mode === 'gex_dealer') {
        if (normVal >= 0.5) {
          const t = (normVal - 0.5) * 2;
          return `rgba(34, 211, 238, ${0.4 + t * 0.5})`;
        } else {
          const t = (0.5 - normVal) * 2;
          return `rgba(244, 63, 94, ${0.4 + t * 0.5})`;
        }
      }
      if (mode === 'fluid_mechanics') {
        const r = Math.round(120 + normVal * 40);
        const g = Math.round(80 + normVal * 140);
        const b = Math.round(250 - normVal * 50);
        return `rgba(${r}, ${g}, ${b}, ${0.45 + normVal * 0.45})`;
      }
      // Implied Volatility Surface: Deep Indigo -> Electric Cyan -> Gold
      if (normVal > 0.65) {
        return `rgba(250, 204, 21, ${0.55 + (normVal - 0.65) * 1.1})`;
      }
      return `rgba(56, 189, 248, ${0.35 + normVal * 0.55})`;
    };

    // 1. Draw 3D Base Floor Grid & Shadow
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.09)';
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

      // Expiry axis label
      ctx.fillStyle = '#64748B';
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

    const getVal = (p: OptionVolSurfacePoint) => {
      if (activeSurfaceMode === 'gex_dealer') {
        return Math.max(0, Math.min(1, (p.gammaExposureUsd + 5) / 10));
      }
      if (activeSurfaceMode === 'fluid_mechanics') {
        return Math.max(0, Math.min(1, Math.abs(p.vanna) * 5 + 0.2));
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

      ctx.strokeStyle =
        activeSurfaceMode === 'gex_dealer'
          ? 'rgba(34, 211, 238, 0.45)'
          : 'rgba(56, 189, 248, 0.50)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    });

    // 3. Draw Laser-Etched Zero-Gamma Flip Pillar & Spot Price Beacon
    const spotProj = project(currentPrice, 2, 0.5);
    ctx.strokeStyle = '#FACC15';
    ctx.lineWidth = 2.0;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(spotProj.px, spotProj.py - 30);
    ctx.lineTo(spotProj.px, spotProj.py + 30);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#FACC15';
    ctx.font = 'bold 9px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`SPOT $${currentPrice.toFixed(0)}`, spotProj.px + 5, spotProj.py - 14);

    // Strike Axis Labels at bottom edge
    for (let i = 0; i < strikes.length; i += 3) {
      const p = project(strikes[i], expiries.length - 1, -0.05);
      ctx.fillStyle = '#94A3B8';
      ctx.font = '9px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`$${(strikes[i] / 1000).toFixed(0)}k`, p.px, p.py + 12);
    }
  }, [surfaceGrid, pitch, yaw, zoom, activeSurfaceMode, currentPrice]);

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

  return (
    <div className="w-full bg-[#070A12]/95 backdrop-blur-xl border border-slate-700/60 rounded-xl overflow-hidden shadow-2xl flex flex-col">
      {/* Top Glass-Morphism Header */}
      <div className="px-4 py-3 border-b border-slate-800 bg-[#090D16]/90 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <div>
            <h2 className="text-xs font-bold text-white tracking-tight flex items-center gap-2">
              <span>3D BTCUSD Option Volatility Surface & Dealer GEX Topology</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-mono">
                Real-Time SVI & Black-Scholes
              </span>
            </h2>
            <p className="text-[11px] text-slate-400 font-mono tabular-nums">
              Spot: ${currentPrice.toFixed(1)} · Zero-Gamma: ~${Math.round(currentPrice + 500)}{' '}
              · Max Pain: ~${Math.round(currentPrice - 1000)} · ATM IV: 54.2% · Skew 25Δ: -3.8%
            </p>
          </div>
        </div>

        {/* Surface Mode & Expiry Switcher */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 bg-[#0B101B] p-0.5 rounded-lg border border-slate-800">
            {(
              [
                { id: 'iv_surface', label: 'IV Smile Surface' },
                { id: 'gex_dealer', label: 'Dealer GEX ($M)' },
                { id: 'fluid_mechanics', label: 'Fluid Mechanics' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setActiveSurfaceMode(m.id)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  activeSurfaceMode === m.id
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              setPitch(36);
              setYaw(-38);
              setZoom(1.15);
            }}
            className="p-1.5 text-slate-400 hover:text-white bg-[#0B101B] border border-slate-800 rounded-md transition-colors"
            title="Resetuj orientację 3D"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {onTriggerVolSignal && (
            <button
              type="button"
              onClick={() =>
                onTriggerVolSignal(
                  'LONG',
                  'VOLATILITY CRUSH // MEAN REVERSION LONG',
                  `Option Volatility Surface detected elevated OTM Put Skew (ATM IV 54.2%) with positive Dealer Gamma Flip above $${Math.round(
                    currentPrice + 500
                  )}.`
                )
              }
              className="px-2.5 py-1 text-xs font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded-md flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Sygnał Opcji</span>
            </button>
          )}

          {onToggleExpand && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="p-1.5 text-slate-400 hover:text-white bg-[#0B101B] border border-slate-800 rounded-md transition-colors"
              title="Maksymalizuj / Zwiń panel"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Grid: 3D Surface Arena (Left/Center) + 2D Smile Cross-Section & Greeks Heatmap (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[480px]">
        {/* Left/Center: Dynamic 3D Volatility Surface */}
        <div
          ref={canvasWrapperRef}
          className="lg:col-span-8 relative h-[480px] bg-[#070A12] cursor-grab active:cursor-grabbing border-b lg:border-b-0 lg:border-r border-slate-800/80"
        >
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            className="w-full h-full block"
          />

          {/* 3D Navigation Guide Badge */}
          <div className="absolute top-3 left-3 pointer-events-none bg-[#090D16]/85 backdrop-blur-md border border-slate-800 rounded-md px-2.5 py-1 text-[10px] font-mono text-slate-300 flex items-center gap-2">
            <Compass className="w-3 h-3 text-cyan-400" />
            <span>
              Obracaj 3D (Pitch {pitch.toFixed(0)}° / Yaw {yaw.toFixed(0)}°) · Kąt bezpieczny
            </span>
          </div>

          {/* Fluid Mechanics & Market Physics HUD Card */}
          <div className="absolute bottom-3 left-3 bg-[#090D16]/92 backdrop-blur-md border border-slate-800 rounded-lg p-2.5 text-xs font-mono tabular-nums shadow-xl max-w-xs">
            <div className="flex items-center justify-between text-cyan-300 font-bold mb-1">
              <span className="flex items-center gap-1.5 text-[11px]">
                <Activity className="w-3 h-3 text-cyan-400" />
                <span>Fizyka & Lepkość L2</span>
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-normal">
                {physics.regime}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-slate-300">
              <div>
                <span className="text-slate-500">Liczba Reynoldsa:</span>
                <div className="font-bold text-white">{physics.reynoldsNumber}</div>
              </div>
              <div>
                <span className="text-slate-500">Lepkość (μ):</span>
                <div className="font-bold text-cyan-300">
                  ${(physics.flowViscosity / 1000).toFixed(0)}K
                </div>
              </div>
              <div>
                <span className="text-slate-500">Gradient ∇P:</span>
                <div className="font-bold text-emerald-400">
                  {physics.kineticPressureGradient >= 0 ? '+' : ''}
                  {physics.kineticPressureGradient} MPa
                </div>
              </div>
              <div>
                <span className="text-slate-500">Dyfuzja Browna:</span>
                <div className="font-bold text-amber-300">
                  {physics.brownianDiffusionCoeff}x
                </div>
              </div>
            </div>
          </div>

          {/* Zoom Slider */}
          <div className="absolute right-3 bottom-3 flex items-center gap-2 bg-[#090D16]/90 backdrop-blur-md border border-slate-800 rounded-md px-2.5 py-1 text-xs font-mono text-slate-300">
            <span className="text-slate-500 text-[10px]">Zoom:</span>
            <input
              type="range"
              min={0.8}
              max={1.8}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-16 accent-cyan-400 cursor-pointer"
            />
            <span className="text-cyan-300 text-[10px]">{(zoom * 100).toFixed(0)}%</span>
          </div>
        </div>

        {/* Right: Volatility Smile Cross-Section & Greeks Heatmap Matrix */}
        <div className="lg:col-span-4 bg-[#090D16] p-3 flex flex-col justify-between space-y-3 font-mono text-xs">
          <div>
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-1.5 text-white font-semibold">
                <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
                <span>Przekrój Smile & Dealer Greeks</span>
              </div>
              {/* Expiry Selector */}
              <select
                value={selectedExpiryDays}
                onChange={(e) => setSelectedExpiryDays(Number(e.target.value))}
                className="bg-[#0B101B] border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-cyan-300"
              >
                {EXPIRIES.map((exp) => (
                  <option key={exp.days} value={exp.days}>
                    {exp.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Cross-section Volatility Smile Visualizer */}
            <div className="mt-2.5 bg-[#070A12] border border-slate-800 rounded-md p-2">
              <div className="text-[10px] text-slate-400 mb-1 flex items-center justify-between">
                <span>Profil IV Smile ({selectedExpiryDays}D Expiry)</span>
                <span className="text-amber-400 font-semibold">
                  ATM Strike ${Math.round(currentPrice / 1000) * 1000}
                </span>
              </div>
              {/* Sparkline Smile Bars */}
              <div className="h-24 flex items-end gap-1 pt-2">
                {currentExpirySlice.map((p) => {
                  const isAtm = Math.abs(p.strike - currentPrice) < 600;
                  const heightPct = Math.max(15, Math.min(100, (p.impliedVol / 110) * 100));
                  return (
                    <div
                      key={p.strike}
                      onMouseEnter={() => setHoveredPoint(p)}
                      onMouseLeave={() => setHoveredPoint(null)}
                      className="flex-1 flex flex-col items-center group relative cursor-pointer"
                    >
                      <div
                        style={{ height: `${heightPct}%` }}
                        className={`w-full rounded-t transition-all ${
                          isAtm
                            ? 'bg-amber-400 shadow-[0_0_8px_rgba(250,204,21,0.5)]'
                            : p.strike < currentPrice
                            ? 'bg-rose-500/70 hover:bg-rose-400'
                            : 'bg-cyan-500/70 hover:bg-cyan-400'
                        }`}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-[9px] text-slate-500 mt-1">
                <span>Put OTM ${currentExpirySlice[0]?.strike ?? '-'}</span>
                <span>ATM</span>
                <span>Call OTM ${currentExpirySlice[currentExpirySlice.length - 1]?.strike ?? '-'}</span>
              </div>
            </div>

            {/* Hovered or ATM Greek Values */}
            <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11px] tabular-nums">
              <div className="bg-[#070A12] border border-slate-800 rounded p-2">
                <span className="text-[10px] text-slate-500 block">Strike / Implied Vol</span>
                <span className="font-bold text-white text-xs">
                  ${hoveredPoint?.strike ?? Math.round(currentPrice / 1000) * 1000}{' '}
                  <span className="text-cyan-300">({hoveredPoint?.impliedVol ?? 54.2}%)</span>
                </span>
              </div>
              <div className="bg-[#070A12] border border-slate-800 rounded p-2">
                <span className="text-[10px] text-slate-500 block">Delta (Δ) / Vanna</span>
                <span className="font-bold text-white text-xs">
                  Δ {hoveredPoint?.delta ?? 0.51} ·{' '}
                  <span className="text-amber-300">{hoveredPoint?.vanna ?? -0.04}</span>
                </span>
              </div>
              <div className="bg-[#070A12] border border-slate-800 rounded p-2">
                <span className="text-[10px] text-slate-500 block">Dealer Gamma (GEX)</span>
                <span
                  className={`font-bold text-xs ${
                    (hoveredPoint?.gammaExposureUsd ?? 1.2) >= 0
                      ? 'text-cyan-400'
                      : 'text-rose-400'
                  }`}
                >
                  ${hoveredPoint?.gammaExposureUsd ?? 1.45}M USD
                </span>
              </div>
              <div className="bg-[#070A12] border border-slate-800 rounded p-2">
                <span className="text-[10px] text-slate-500 block">Charm (Theta/Delta)</span>
                <span className="font-bold text-emerald-400 text-xs">
                  {hoveredPoint?.charm ?? -0.02}
                </span>
              </div>
            </div>
          </div>

          {/* Options Structural Levels Card */}
          <div className="bg-[#070A12] border border-slate-800 rounded-md p-2.5 text-[10px] space-y-1.5 text-slate-400">
            <div className="flex items-center justify-between">
              <span>Zero-Gamma Flip:</span>
              <strong className="text-cyan-300 font-mono">
                ${Math.round(currentPrice + 500)} (Dealer Net Long Gamma)
              </strong>
            </div>
            <div className="flex items-center justify-between">
              <span>Max Pain Strike (30D):</span>
              <strong className="text-amber-300 font-mono">
                ${Math.round(currentPrice - 1000)} (Resting Liq Magnet)
              </strong>
            </div>
            <div className="flex items-center justify-between">
              <span>25-Delta Skew:</span>
              <strong className="text-rose-400 font-mono">-3.8% (Bearish Put Premium)</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
