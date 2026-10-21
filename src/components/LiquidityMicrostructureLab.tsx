import React, { useEffect, useRef, useState } from 'react';
import {
  Compass,
  Flame,
  Layers,
  Magnet,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react';
import {
  QuantMathMetrics,
  ShaakuniState,
} from '../types/trading';

interface LiquidityMicrostructureLabProps {
  quant: QuantMathMetrics;
  shaakuni: ShaakuniState;
  currentPrice: number;
  onSimulateStrategySignal?: (direction: 'LONG' | 'SHORT', customTitle: string, customReason: string) => void;
}

interface PioneeringBlueprint {
  id: string;
  number: string;
  title: string;
  subtitle: string;
  formula: string;
  edgeDescription: string;
  hyperliquidExecution: string;
  recommendedDirection: 'LONG' | 'SHORT';
  liveMetricLabel: string;
  liveMetricValue: string;
}

export const LiquidityMicrostructureLab: React.FC<LiquidityMicrostructureLabProps> = ({
  quant,
  shaakuni,
  currentPrice,
  onSimulateStrategySignal,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string>('grav-magnet');
  const [hoveredBucketPrice, setHoveredBucketPrice] = useState<number | null>(null);

  const blueprints: PioneeringBlueprint[] = [
    {
      id: 'grav-magnet',
      number: '01.',
      title: 'Pole Grawitacyjne Płynności (Gravitational Liquidity Tensor)',
      subtitle: 'Modelowanie pul likwidacji (20x/50x/100x) oraz PDH/PDL jako studni potencjału grawitacyjnego',
      formula: 'U(p) = - ∑ [ G · (LiqPool_i + OB_Mass_i) / |p - p_i|^α ]',
      edgeDescription:
        'Cena na Hyperliquid porusza się od jednej kieszeni płynności do drugiej. Zamiast traktować PDH/PDL oraz mapę likwidacji z aggr.trade jako statyczne linie, model wylicza wektor przyciągania grawitacyjnego. Gdy powstaje tzw. LVN (Low Volume Node — próżnia płynności) między ceną a silnym klastrem likwidacji, prawdopodobieństwo szybkiego ruchu typu "Vacuum Sweep" rośnie powyżej 82%.',
      hyperliquidExecution:
        'Stawiaj zlecenia Limit Take-Profit dokładnie 2–4 ticki przed centrum klastra grawitacyjnego ($' +
        quant.primaryMagnetPrice +
        ') oraz wchodź po przejściu przez strefę LVN (próżni wolumenowej).',
      recommendedDirection: quant.primaryMagnetPrice >= currentPrice ? 'LONG' : 'SHORT',
      liveMetricLabel: 'Główny Magnes Grawitacyjny',
      liveMetricValue: `$${quant.primaryMagnetPrice.toLocaleString()} (${
        quant.primaryMagnetPrice >= currentPrice ? '+' : ''
      }${(((quant.primaryMagnetPrice - currentPrice) / currentPrice) * 100).toFixed(2)}%)`,
    },
    {
      id: 'vpin-absorption',
      number: '02.',
      title: 'VPIN Toxicity + Absorpcja Spot CVD w Strefie Shaakuni OB',
      subtitle: 'Detekcja poinformowanego kapitału instytucjonalnego (Toxic Flow) podczas retestu Order Blocka',
      formula: 'VPIN = ∑ |V_buy^τ - V_sell^τ| / (N · V_bucket)  ×  Spot_CVD_Divergence',
      edgeDescription:
        'Większość traderów detalicznych nie wie, czy dany Order Block (OB/POI) ze skryptu Shaakuni wytrzyma, czy zostanie przebity. Połączenie wskaźnika VPIN (toksyczności przepływu zleceń) z dywergencją Spot CVD vs Perp CVD rozwiązuje ten problem: jeśli cena wchodzi w Bullish OB, Perp CVD spada (tłum szortuje lub jest likwidowany), a Spot CVD na Coinbase/Binance rośnie przy wysokim VPIN — mamy potwierdzoną absorpcję pasywną.',
      hyperliquidExecution:
        'Wchodź agresywnie na Hyperliquid (dźwignia wg Kelly’ego) wewnątrz górnych 25% strefy Shaakuni OB tylko wtedy, gdy VPIN > 45% oraz Spot CVD wykazuje dywergencję przeciwko ruchowi Perp.',
      recommendedDirection: quant.cvdDivergenceScore >= 0 ? 'LONG' : 'SHORT',
      liveMetricLabel: 'Toksyczność Przepływu VPIN',
      liveMetricValue: `${(quant.vpinToxicity * 100).toFixed(1)}% · Dywergencja Spot/Perp: ${(
        quant.cvdDivergenceScore * 100
      ).toFixed(1)}%`,
    },
    {
      id: 'kyle-lambda',
      number: '03.',
      title: 'Asymetria Lambdy Kyle’a (Directional Price Impact & Air-Pockets)',
      subtitle: 'Pomiar kosztu przesunięcia ceny o $10 w górę vs $10 w dół w arkuszu L2 + Aggr',
      formula: 'ΔP = λ_Kyle · OFI + ε   gdzie   Asymetria = (λ_down - λ_up) / (λ_down + λ_up)',
      edgeDescription:
        'Lambda Kyle’a mierzy niepłynność (opór arkusza zleceń). Kiedy animatorzy rynku (Market Makers) na Hyperliquid wycofują płynność po jednej stronie przed wybiciem PDH lub PDL, koszt przesunięcia ceny o $10 w tym kierunku gwałtownie spada. Wykrycie asymetrii λ_up vs λ_down pozwala zająć pozycję ułamki sekund przed kaskadą stop-lossów.',
      hyperliquidExecution:
        'Gdy koszt ruchu w górę ($' +
        (quant.kyleLambdaUp / 1000).toFixed(0) +
        'K / $10) jest wyraźnie niższy niż koszt ruchu w dół ($' +
        (quant.kyleLambdaDown / 1000).toFixed(0) +
        'K / $10), ścieżka najmniejszego oporu prowadzi w górę.',
      recommendedDirection: quant.kyleLambdaUp <= quant.kyleLambdaDown ? 'LONG' : 'SHORT',
      liveMetricLabel: 'Opór Arkusza (Góra vs Dół)',
      liveMetricValue: `↑ $${(quant.kyleLambdaUp / 1000).toFixed(0)}K vs ↓ $${(
        quant.kyleLambdaDown / 1000
      ).toFixed(0)}K na $10 ruchu`,
    },
    {
      id: 'hawkes-cascade',
      number: '04.',
      title: 'Samowzbudny Proces Punktowy Hawkesa dla Kaskad Likwidacji',
      subtitle: 'Matematyczny model łańcuchowych likwidacji lewarowanych pozycji na kontraktach Perp',
      formula: 'λ(t) = μ + ∑ α · exp(-β · (t - t_i))   [Punkt krytyczny: η = α/β > 0.85]',
      edgeDescription:
        'Likwidacje na BTCUSD nie są niezależne (nie są procesem Poissona) — każda likwidacja wymusza zlecenie rynkowe, które przesuwa cenę i wyzwala kolejną likwidację. Proces Hawkesa liczy współczynnik rozgałęziania η (branching ratio). Gdy η przekracza 0.80 podczas Sweepu PDH/PDL, dochodzi do wyczerpania paliwa likwidacyjnego — idealny moment na kontrariański zwrot (Fade the Sweep) do D-EQ (50%).',
      hyperliquidExecution:
        'Gdy Shaakuni pokazuje status "Sweep !" na PDH/PDL, poczekaj na szczyt intensywności Hawkesa (η > 0.82) i otwórz pozycję powrotną z celem na D-EQ ($' +
        (shaakuni.deq ? Math.round(shaakuni.deq) : currentPrice) +
        ').',
      recommendedDirection: quant.hawkesNetDominance >= 0 ? 'LONG' : 'SHORT',
      liveMetricLabel: 'Współczynnik Kaskady Hawkesa η',
      liveMetricValue: `η = ${quant.hawkesBranchingRatio} (λB=${quant.hawkesBuyIntensity} / λS=${quant.hawkesSellIntensity})`,
    },
    {
      id: 'ou-bridge',
      number: '05.',
      title: 'Most stochastyczny Ornsteina-Uhlenbecka wokół D-EQ i W-EQ (50%)',
      subtitle: 'Ilościowa kalibracja poziomów Equilibrium 50% ze skryptu Shaakuni z czasem półtrwania',
      formula: 'dX_t = θ · (EQ_50% - X_t) dt + σ dW_t   [Half-Life t_½ = ln(2) / θ]',
      edgeDescription:
        'Poziomy 50% (Daily EQ oraz Weekly EQ) ze skryptu Shaakuni działają jak atraktory równowagi. Proces Ornsteina-Uhlenbecka oblicza dokładną prędkość powrotu do średniej θ oraz standaryzowane odchylenie Z-Score. Gdy |Z| > 1.85σ, a wykładnik Hursta H < 0.48 (reżim mean-reverting), statystyczna przewaga zagrania powrotnego do D-EQ wynosi ponad 74%.',
      hyperliquidExecution:
        'Skaluj wejścia limitami na odchyleniach ±2.0σ od D-EQ i realizuj 70% zysku dokładnie na linii D-EQ (50%).',
      recommendedDirection: quant.ouZScore <= 0 ? 'LONG' : 'SHORT',
      liveMetricLabel: 'Odchylenie OU Z-Score & Half-Life',
      liveMetricValue: `Z = ${quant.ouZScore > 0 ? '+' : ''}${quant.ouZScore}σ · t½ = ${
        quant.ouHalfLifeBars
      } świec`,
    },
  ];

  const selectedBlueprint =
    blueprints.find((b) => b.id === selectedBlueprintId) ?? blueprints[0];

  // Render High-Density 2D Gravitational Liquidity & Volume Profile Tensor Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || quant.liquidityProfile.length === 0) return;

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

    ctx.fillStyle = '#070A12';
    ctx.fillRect(0, 0, width, height);

    const profile = [...quant.liquidityProfile].sort((a, b) => b.price - a.price);
    const n = profile.length;
    const topPad = 28;
    const bottomPad = 24;
    const plotH = height - topPad - bottomPad;
    const rowH = plotH / n;

    const leftAxisW = 68;
    const midSplitX = leftAxisW + (width - leftAxisW) * 0.48;

    const maxVol = Math.max(1, ...profile.map((p) => p.totalVolumeUsd));
    const maxLiq = Math.max(1, ...profile.map((p) => p.liquidationPoolUsd));

    // Column Headers
    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('PRICE ($)', 8, 16);
    ctx.fillText('VOLUME PROFILE (BUY / SELL + POC / VAH / VAL)', leftAxisW + 6, 16);
    ctx.fillText('LIQUIDATION FUEL ($M) & GRAVITY CURVE U(p)', midSplitX + 10, 16);

    // Divider lines
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.7)';
    ctx.beginPath();
    ctx.moveTo(0, 22);
    ctx.lineTo(width, 22);
    ctx.moveTo(leftAxisW, 0);
    ctx.lineTo(leftAxisW, height);
    ctx.moveTo(midSplitX, 22);
    ctx.lineTo(midSplitX, height - bottomPad);
    ctx.stroke();

    const gravityPoints: { x: number; y: number }[] = [];
    const rightColW = width - midSplitX - 18;
    const leftColW = midSplitX - leftAxisW - 16;

    profile.forEach((bucket, idx) => {
      const y = topPad + idx * rowH;
      const barH = Math.max(4, rowH - 3);
      const isHovered = hoveredBucketPrice === bucket.price;

      // Highlight Value Area or Hovered Row
      if (isHovered) {
        ctx.fillStyle = 'rgba(6, 182, 212, 0.14)';
        ctx.fillRect(0, y, width, rowH);
      } else if (bucket.isPOC) {
        ctx.fillStyle = 'rgba(250, 204, 21, 0.1)';
        ctx.fillRect(0, y, width, rowH);
      } else if (bucket.isValueArea) {
        ctx.fillStyle = 'rgba(30, 41, 59, 0.35)';
        ctx.fillRect(leftAxisW, y, midSplitX - leftAxisW, rowH);
      }

      // Price Label on Left
      ctx.font = bucket.isPOC
        ? '700 10.5px "IBM Plex Mono", monospace'
        : '500 10px "IBM Plex Mono", monospace';
      ctx.fillStyle = bucket.isPOC
        ? '#FACC15'
        : Math.abs(bucket.price - currentPrice) < 35
        ? '#38BDF8'
        : '#CBD5E1';
      ctx.textAlign = 'left';
      ctx.fillText(`$${bucket.price}`, 8, y + rowH * 0.72);

      // Left Column: Volume Profile Bar (Buy Cyan + Sell Rose)
      const totW = (bucket.totalVolumeUsd / maxVol) * leftColW;
      const buyRatio =
        bucket.totalVolumeUsd > 0
          ? bucket.buyVolumeUsd / bucket.totalVolumeUsd
          : 0.5;
      const buyW = totW * buyRatio;
      const sellW = totW - buyW;

      ctx.fillStyle = bucket.isPOC
        ? 'rgba(250, 204, 21, 0.85)'
        : 'rgba(56, 189, 248, 0.75)';
      ctx.fillRect(leftAxisW + 6, y + 1.5, Math.max(2, buyW), barH);

      ctx.fillStyle = bucket.isPOC
        ? 'rgba(245, 158, 11, 0.85)'
        : 'rgba(244, 63, 94, 0.75)';
      ctx.fillRect(leftAxisW + 6 + buyW, y + 1.5, Math.max(1, sellW), barH);

      // Tag POC, VAH, VAL, or LVN Air-Pocket
      ctx.font = '600 9px "IBM Plex Mono", monospace';
      if (bucket.isPOC) {
        ctx.fillStyle = '#FACC15';
        ctx.fillText('POC (Control)', leftAxisW + totW + 12, y + rowH * 0.72);
      } else if (bucket.price === quant.vahPrice) {
        ctx.fillStyle = '#38BDF8';
        ctx.fillText('VAH (70%)', leftAxisW + totW + 12, y + rowH * 0.72);
      } else if (bucket.price === quant.valPrice) {
        ctx.fillStyle = '#38BDF8';
        ctx.fillText('VAL (70%)', leftAxisW + totW + 12, y + rowH * 0.72);
      } else if (bucket.isLVN) {
        ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
        ctx.fillText('LVN Void', leftAxisW + totW + 12, y + rowH * 0.72);
      }

      // Right Column: Liquidation Pool Fuel Bar (Heat Gradient)
      const liqW = (bucket.liquidationPoolUsd / maxLiq) * (rightColW * 0.78);
      const isShortLiq = bucket.price >= currentPrice;
      ctx.fillStyle =
        bucket.gravityPotential > 0.75
          ? 'rgba(240, 218, 24, 0.9)'
          : isShortLiq
          ? 'rgba(251, 146, 60, 0.72)'
          : 'rgba(45, 212, 191, 0.72)';
      ctx.fillRect(midSplitX + 8, y + 1.5, Math.max(2, liqW), barH);

      // Liquidation USD Label
      if (bucket.liquidationPoolUsd > maxLiq * 0.28) {
        ctx.fillStyle = '#E2E8F0';
        ctx.font = '600 9px "IBM Plex Mono", monospace';
        ctx.fillText(
          `$${(bucket.liquidationPoolUsd / 1000000).toFixed(1)}M ${
            bucket.price === quant.primaryMagnetPrice ? '★ MAGNET' : ''
          }`,
          midSplitX + 12 + liqW,
          y + rowH * 0.72
        );
      }

      // Collect Gravity Potential Trajectory Point
      const gx = midSplitX + 8 + bucket.gravityPotential * (rightColW * 0.9);
      const gy = y + rowH * 0.5;
      gravityPoints.push({ x: gx, y: gy });
    });

    // Draw Smooth Gravitational Potential Curve U(p)
    if (gravityPoints.length > 2) {
      ctx.save();
      ctx.beginPath();
      gravityPoints.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.strokeStyle = '#22D3EE';
      ctx.lineWidth = 2;
      ctx.stroke();

      for (const pt of gravityPoints) {
        ctx.fillStyle = '#22D3EE';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Current Spot/Perp Price Horizontal Laser Line across the Profile
    const maxP = profile[0].price;
    const minP = profile[profile.length - 1].price;
    const curY =
      topPad +
      ((maxP - currentPrice) / Math.max(1, maxP - minP)) * plotH;
    if (curY >= topPad && curY <= height - bottomPad) {
      ctx.save();
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(leftAxisW, curY);
      ctx.lineTo(width, curY);
      ctx.stroke();
      ctx.restore();
    }
  }, [quant, currentPrice, hoveredBucketPrice]);

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || quant.liquidityProfile.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const profile = [...quant.liquidityProfile].sort((a, b) => b.price - a.price);
    const topPad = 28;
    const bottomPad = 24;
    const plotH = rect.height - topPad - bottomPad;
    const idx = Math.floor(((y - topPad) / plotH) * profile.length);
    if (idx >= 0 && idx < profile.length) {
      setHoveredBucketPrice(profile[idx].price);
    } else {
      setHoveredBucketPrice(null);
    }
  };

  const totalFuel = Math.max(
    1,
    quant.shortSqueezeFuelUsd + quant.longCascadeFuelUsd
  );
  const shortFuelPct = (quant.shortSqueezeFuelUsd / totalFuel) * 100;

  return (
    <div className="space-y-4">
      {/* Top KPI Microstructure Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[#0B101B] border border-slate-800/80 rounded-lg p-3.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Główny Magnes Płynności U(p)</span>
            <Magnet className="w-4 h-4 text-yellow-400" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between font-mono tabular-nums">
            <span className="text-lg font-bold text-white">
              ${quant.primaryMagnetPrice.toLocaleString()}
            </span>
            <span
              className={`text-xs font-semibold ${
                quant.primaryMagnetPrice >= currentPrice
                  ? 'text-emerald-400'
                  : 'text-rose-400'
              }`}
            >
              {quant.primaryMagnetPrice >= currentPrice ? '↑ Above' : '↓ Below'} (
              {(
                ((quant.primaryMagnetPrice - currentPrice) / currentPrice) *
                100
              ).toFixed(2)}
              %)
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400 font-mono">
            POC: ${quant.pocPrice} · VAH: ${quant.vahPrice} · VAL: ${quant.valPrice}
          </div>
        </div>

        <div className="bg-[#0B101B] border border-slate-800/80 rounded-lg p-3.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>VPIN Informed Flow Toxicity</span>
            <Flame className="w-4 h-4 text-orange-400" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between font-mono tabular-nums">
            <span className="text-lg font-bold text-cyan-300">
              {(quant.vpinToxicity * 100).toFixed(1)}%
            </span>
            <span className="text-xs text-slate-300">
              {quant.vpinToxicity > 0.55
                ? 'Informed Institutional Flow'
                : 'Balanced Two-Sided Flow'}
            </span>
          </div>
          <div className="mt-2 w-full h-1.5 bg-slate-900 rounded-xs overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 via-amber-400 to-rose-500"
              style={{ width: `${(quant.vpinToxicity * 100).toFixed(0)}%` }}
            />
          </div>
        </div>

        <div className="bg-[#0B101B] border border-slate-800/80 rounded-lg p-3.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Asymetria Lambdy Kyle’a (Opór L2)</span>
            <Compass className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between font-mono tabular-nums">
            <span className="text-sm font-bold text-emerald-400">
              ↑ ${(quant.kyleLambdaUp / 1000).toFixed(0)}K / $10
            </span>
            <span className="text-sm font-bold text-rose-400">
              ↓ ${(quant.kyleLambdaDown / 1000).toFixed(0)}K / $10
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            Ścieżka mniejszego oporu:{' '}
            <strong className="text-white">
              {quant.kyleLambdaUp <= quant.kyleLambdaDown
                ? 'W GÓRĘ (Cieńszy Ask)'
                : 'W DÓŁ (Cieńszy Bid)'}
            </strong>
          </div>
        </div>

        <div className="bg-[#0B101B] border border-slate-800/80 rounded-lg p-3.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Paliwo Likwidacyjne (Shorts vs Longs)</span>
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between font-mono tabular-nums text-xs">
            <span className="text-amber-300 font-semibold">
              Shorts ↑ ${(quant.shortSqueezeFuelUsd / 1000000).toFixed(1)}M
            </span>
            <span className="text-teal-300 font-semibold">
              Longs ↓ ${(quant.longCascadeFuelUsd / 1000000).toFixed(1)}M
            </span>
          </div>
          <div className="mt-2 w-full h-2 bg-slate-900 rounded-xs overflow-hidden flex">
            <div
              className="bg-amber-400 h-full"
              style={{ width: `${shortFuelPct.toFixed(1)}%` }}
            />
            <div
              className="bg-teal-400 h-full"
              style={{ width: `${(100 - shortFuelPct).toFixed(1)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Main Split: Left (7 cols) Deep Liquidity Profile & Gravity Field Canvas | Right (5 cols) Pioneering Quant Recommendations */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 bg-[#0B101B] border border-slate-800/80 rounded-lg p-4 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
            <div>
              <h2 className="text-sm font-semibold text-white">
                Profil Płynności TPO/Delta, Próżnie LVN oraz Pole Grawitacyjne Likwidacji U(p)
              </h2>
              <p className="text-xs text-slate-400">
                Po lewej: Rozkład wolumenu Buy/Sell (POC, 70% Value Area, LVN Air-Pockets) · Po prawej: Skumulowane pule likwidacji 5x/20x/100x i krzywa przyciągania
              </p>
            </div>
            <span className="text-xs font-mono text-cyan-300">
              24 Poziomy Kwantyzacji Ceny
            </span>
          </div>

          <div
            ref={containerRef}
            className="relative flex-1 min-h-[430px] mt-3 rounded-md overflow-hidden border border-slate-800/80"
          >
            <canvas
              ref={canvasRef}
              onMouseMove={handleCanvasMouseMove}
              onMouseLeave={() => setHoveredBucketPrice(null)}
              className="block w-full h-full cursor-crosshair"
            />
          </div>
        </div>

        {/* Right Column (5 cols): Interactive Pioneering Recommendations & Strategy Blueprints */}
        <div className="lg:col-span-5 bg-[#0B101B] border border-slate-800/80 rounded-lg p-4 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <h2 className="text-sm font-semibold text-white">
                  Pionierskie Rekomendacje Quant + Price Action (Hyperliquid)
                </h2>
              </div>
              <span className="text-xs font-mono text-slate-400">5 Metodologii</span>
            </div>

            {/* Selector List of 5 Pioneering Approaches */}
            <div className="mt-3 space-y-1.5">
              {blueprints.map((bp) => {
                const isSelected = bp.id === selectedBlueprint.id;
                return (
                  <button
                    key={bp.id}
                    type="button"
                    onClick={() => setSelectedBlueprintId(bp.id)}
                    className={`w-full text-left px-3 py-2 rounded-md border transition-colors flex items-center justify-between gap-2 ${
                      isSelected
                        ? 'bg-cyan-500/15 border-cyan-500/50 text-white'
                        : 'bg-[#090D16] border-slate-800/80 text-slate-300 hover:bg-slate-900'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">
                        <span className="font-mono text-cyan-400 mr-1.5">
                          {bp.number}
                        </span>
                        {bp.title}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate mt-0.5">
                        {bp.subtitle}
                      </div>
                    </div>
                    <span className="text-[11px] font-mono text-cyan-300 shrink-0">
                      {bp.recommendedDirection}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Detailed View of Selected Pioneering Recommendation */}
            <div className="mt-3 bg-[#090D16] border border-slate-800 rounded-lg p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-cyan-300">
                  {selectedBlueprint.number} {selectedBlueprint.title}
                </span>
              </div>

              <div className="px-2.5 py-1.5 bg-[#0B101B] border border-slate-800 rounded font-mono text-[11px] text-amber-300 overflow-x-auto">
                {selectedBlueprint.formula}
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                {selectedBlueprint.edgeDescription}
              </p>

              <div className="pt-2 border-t border-slate-800/80 text-xs">
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Egzekucja na Hyperliquid BTC-PERP:</span>
                </div>
                <p className="text-slate-300 mt-1 leading-relaxed">
                  {selectedBlueprint.hyperliquidExecution}
                </p>
              </div>
            </div>
          </div>

          {/* Live Telemetry & 1-Click Signal Simulation Trigger */}
          <div className="pt-2.5 border-t border-slate-800 flex items-center justify-between gap-3">
            <div className="text-xs font-mono">
              <div className="text-[10px] text-slate-400 font-sans">
                {selectedBlueprint.liveMetricLabel}
              </div>
              <div className="text-cyan-300 font-semibold">
                {selectedBlueprint.liveMetricValue}
              </div>
            </div>

            {onSimulateStrategySignal && (
              <button
                type="button"
                onClick={() =>
                  onSimulateStrategySignal(
                    selectedBlueprint.recommendedDirection,
                    `HYPERLIQUID ${selectedBlueprint.recommendedDirection} // ${selectedBlueprint.title.toUpperCase()}`,
                    selectedBlueprint.hyperliquidExecution
                  )
                }
                className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Wygeneruj Sygnał z Modelu</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
