import {
  AggrTradeTick,
  L2OrderbookLevel,
  LiquidationHeatmapCell,
  LiquidityProfileBucket,
  OFIMomentumSummary,
  OHLCVBar,
  OrderFlowImbalanceTick,
  QuantMathMetrics,
  ShaakuniState,
} from '../types/trading';
import { tr } from '../i18n';

/**
 * Metryki opisowe przepływu i mikrostruktury BTC-PERP (Hyperliquid) — co jest estymatorem, a co heurystyką:
 * 1) Ornstein-Uhlenbeck: OLS AR(1) wokół kotwicy 0.65·D-EQ + 0.35·W-EQ (kotwica ustalona, nie estymowana).
 * 2) „Hawkes”: intensywność samowzbudna ze STAŁYMI μ, α, β (bez estymacji MLE, bez współczynnika rozgałęzienia) — heurystyka.
 * 3) Prawdopodobieństwo PDH vs PDL z odległości (heurystyka, nie formuła barier) i entropia Shannona na 6 koszykach (heurystyka).
 * 4) VPIN (BVC, Easley–López de Prado–O'Hara 2012), λ Kyle'a (OLS na realnym przepływie), profil wolumenu (POC/VAH/VAL)
 *    oraz „pole przyciągania” U(p) z ręcznie dobranymi wagami (heurystyka).
 * 5) Liniowa kombinacja powyższych z ręcznie ustawionymi wagami + tanh („neural*” w nazwach pól z powodów historycznych):
 *    NIE jest wytrenowaną siecią ani sygnałem — UI pokazuje ją jako „siłę heurystyki”, a stożek ±1σ domyślnie jest wyłączony.
 */

/** Próg reżimu trendowego dla skorygowanego H: ≈ 96. percentyl rozkładu pod szumem (n = 45, symulacja). */
export const HURST_TREND_THRESHOLD = 0.6;

/** Wartość oczekiwana R/S dla szumu iid (Anis-Lloyd 1976 z korektą Petersa (n − ½)/n). */
function expectedRescaledRange(n: number): number {
  // Γ((n−1)/2) / Γ(n/2) rekurencyjnie: r(n+2) = r(n)·(n−1)/n
  let ratio = n % 2 === 0 ? Math.sqrt(Math.PI) : 2 / Math.sqrt(Math.PI);
  for (let k = n % 2 === 0 ? 2 : 3; k < n; k += 2) ratio *= (k - 1) / k;
  let sum = 0;
  for (let i = 1; i < n; i++) sum += Math.sqrt((n - i) / i);
  return ((n - 0.5) / n) * (ratio / Math.sqrt(Math.PI)) * sum;
}

/**
 * Wykładnik Hursta z R/S skorygowany o obciążenie małej próby:
 * H = 0.5 + (ln(R/S) − ln E[R/S]_n) / ln(n). Pod szumem iid średnio ≈ 0.5.
 */
export function hurstAnisLloyd(returns: number[]): number {
  const n = returns.length;
  if (n < 8) return 0.5;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  let cum = 0;
  let maxDev = -Infinity;
  let minDev = Infinity;
  let varSum = 0;
  for (const r of returns) {
    const d = r - mean;
    cum += d;
    if (cum > maxDev) maxDev = cum;
    if (cum < minDev) minDev = cum;
    varSum += d * d;
  }
  const std = Math.sqrt(varSum / n);
  if (!(std > 0)) return 0.5;
  const rs = (maxDev - minDev) / std;
  const h = 0.5 + (Math.log(rs) - Math.log(expectedRescaledRange(n))) / Math.log(n);
  return Math.max(0, Math.min(1, h));
}

/**
 * VPIN na kubełkach o równym wolumenie (Easley, López de Prado, O'Hara 2012).
 * Podział kupno/sprzedaż w świecach: realny z WS albo BVC. Wolumen świecy jest rozlewany
 * proporcjonalnie do kolejnych kubełków; VPIN = średnia |V_B − V_S| / V z pełnych kubełków.
 */
export function computeVpinBvc(bars: OHLCVBar[], bucketCount: number = 50): number {
  const totalVol = bars.reduce((acc, b) => acc + b.vbuy + b.vsell, 0);
  if (!(totalVol > 0)) return 0;
  const bucketVol = totalVol / bucketCount;
  let fill = 0;
  let buy = 0;
  let sell = 0;
  let sumImb = 0;
  let full = 0;
  for (const b of bars) {
    let remaining = b.vbuy + b.vsell;
    if (remaining <= 0) continue;
    const buyShare = b.vbuy / remaining;
    while (remaining > 0) {
      const take = Math.min(remaining, bucketVol - fill);
      buy += take * buyShare;
      sell += take * (1 - buyShare);
      fill += take;
      remaining -= take;
      if (fill >= bucketVol - 1e-9) {
        sumImb += Math.abs(buy - sell) / bucketVol;
        full++;
        fill = 0;
        buy = 0;
        sell = 0;
      }
    }
  }
  return full > 0 ? sumImb / full : 0;
}

/**
 * Lambda Kyle'a: OLS ΔP_t = λ·Q_t + ε na świecach z realnym przepływem agresora (WS).
 * Na świecach BVC regresja byłaby kołowa (Q wyliczone z ΔP) — wtedy null.
 * Wynik w $ ruchu ceny na $1M netto przepływu.
 */
export function kyleLambdaOls(bars: OHLCVBar[], minBars: number = 10): number | null {
  const dp: number[] = [];
  const q: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    if (!bars[i].realFlow) continue;
    dp.push(bars[i].close - bars[i - 1].close);
    q.push((bars[i].vbuy - bars[i].vsell) / 1e6);
  }
  if (q.length < minBars) return null;
  const mq = q.reduce((a, b) => a + b, 0) / q.length;
  const mp = dp.reduce((a, b) => a + b, 0) / dp.length;
  let cov = 0;
  let varQ = 0;
  for (let i = 0; i < q.length; i++) {
    cov += (q[i] - mq) * (dp[i] - mp);
    varQ += (q[i] - mq) ** 2;
  }
  return varQ > 0 ? cov / varQ : null;
}

/** Neutralny zestaw metryk dla braku danych (wartości liczbowe NaN, listy puste). */
export function emptyQuantMetrics(): QuantMathMetrics {
  return {
    ouTheta: 0,
    ouHalfLifeBars: Number.POSITIVE_INFINITY,
    ouEquilibriumPrice: Number.NaN,
    ouZScore: 0,
    hawkesBuyIntensity: 0,
    hawkesSellIntensity: 0,
    hawkesBranchingRatio: null,
    hawkesNetDominance: 0,
    shannonEntropyBits: 0,
    hurstExponent: 0.5,
    combinatorialPathProbPDH: Number.NaN,
    combinatorialPathProbPDL: Number.NaN,
    l2MicroPrice: Number.NaN,
    l2OrderbookImbalance: 0,
    vpinToxicity: 0,
    bookDepthAskUsd: 0,
    bookDepthBidUsd: 0,
    kyleLambdaPer1M: null,
    shortSqueezeFuelUsd: 0,
    longCascadeFuelUsd: 0,
    pocPrice: Number.NaN,
    vahPrice: Number.NaN,
    valPrice: Number.NaN,
    primaryMagnetPrice: Number.NaN,
    liquidityProfile: [],
    cvdDivergenceScore: 0,
    regimeClassification: 'Mean-Reversion Equilibrium',
    neuralConfidence: 0,
    neuralDirectionBias: 0,
    neuralAttentionWeights: {
      shaakuniOBProximity: 0,
      spotCvdDelta: 0,
      perpFundingAndLiq: 0,
      l2BookImbalance: 0,
      hawkesCascadeVelocity: 0,
    },
    forecastHorizon: [],
  };
}

export function computeQuantMathAndNeuralForecast(
  bars: OHLCVBar[],
  shaakuni: ShaakuniState,
  heatmap: LiquidationHeatmapCell[],
  recentTrades: AggrTradeTick[],
  bids: L2OrderbookLevel[],
  asks: L2OrderbookLevel[]
): QuantMathMetrics {
  const n = bars.length;
  // Za mało danych (np. przed pierwszą synchronizacją) — neutralne metryki z NaN zamiast liczb zastępczych
  if (n < 3) return emptyQuantMetrics();
  const lastBar = bars[n - 1];
  const currentPrice = lastBar.close;
  const atr = lastBar.atr || Math.max(1, lastBar.high - lastBar.low);

  // 1. Ornstein-Uhlenbeck (OU) Process Estimation: dX_t = theta * (mu - X_t) dt + sigma dW_t
  const deq = shaakuni.deq ?? currentPrice;
  const weq = shaakuni.weq ?? currentPrice;
  const equilibriumPrice = deq * 0.65 + weq * 0.35;

  const lookback = Math.min(40, n - 1);
  let sumXY = 0;
  let sumX2 = 0;
  let sumResiduals2 = 0;

  for (let i = n - lookback; i < n; i++) {
    const xPrev = bars[i - 1].close - equilibriumPrice;
    const dx = bars[i].close - bars[i - 1].close;
    sumXY += xPrev * dx;
    sumX2 += xPrev * xPrev;
  }

  // Brak powrotu do średniej (nachylenie ≥ 0) → θ = 0 i t½ = ∞, bez wartości zastępczej
  const rawSlope = sumX2 > 1e-6 ? sumXY / sumX2 : 0;
  const ouTheta = Math.max(0, Math.min(1, -rawSlope));
  const ouHalfLifeBars = ouTheta > 0 ? Math.LN2 / ouTheta : Number.POSITIVE_INFINITY;

  for (let i = n - lookback; i < n; i++) {
    const dev = bars[i].close - equilibriumPrice;
    sumResiduals2 += dev * dev;
  }
  const ouStdDev = Math.max(1, Math.sqrt(sumResiduals2 / Math.max(1, lookback)));
  const ouZScore = (currentPrice - equilibriumPrice) / ouStdDev;

  // 2. Hawkes Self-Exciting Point Process on Live Order Flow
  const now = Date.now();
  const mu = 0.85;
  const alpha = 0.42;
  const beta = 0.55;
  let buyExcitation = 0;
  let sellExcitation = 0;

  for (let i = 0; i < Math.min(80, recentTrades.length); i++) {
    const t = recentTrades[i];
    const dtSec = Math.max(0.05, (now - t.timestamp) / 1000);
    if (dtSec > 30) continue;
    const sizeWeight = Math.min(4.0, Math.log10(Math.max(1000, t.sizeUsd)) / 4.5);
    const liqBoost = t.isLiquidation ? 1.85 : 1.0;
    const kernel = alpha * sizeWeight * liqBoost * Math.exp(-beta * dtSec);
    if (t.side === 'buy') {
      buyExcitation += kernel;
    } else {
      sellExcitation += kernel;
    }
  }

  const hawkesBuyIntensity = mu + buyExcitation;
  const hawkesSellIntensity = mu + sellExcitation;
  const totalHawkes = hawkesBuyIntensity + hawkesSellIntensity;
  const hawkesNetDominance =
    totalHawkes > 0
      ? (hawkesBuyIntensity - hawkesSellIntensity) / totalHawkes
      : 0;
  // Współczynnik rozgałęzienia wymaga estymacji MLE (μ, α, β) — stałe α/β to nie pomiar
  const hawkesBranchingRatio: number | null = null;

  // 3. L2 Orderbook Micro-Price, Imbalance & Shannon Information Entropy
  // Micro-price tylko z realnego arkusza; bez arkusza = NaN (UI pokaże „—”)
  const topBid = bids[0];
  const topAsk = asks[0];
  const l2MicroPrice =
    topBid && topAsk && topBid.sizeUsd + topAsk.sizeUsd > 0
      ? (topBid.price * topAsk.sizeUsd + topAsk.price * topBid.sizeUsd) / (topBid.sizeUsd + topAsk.sizeUsd)
      : Number.NaN;

  const sumBidUsd = bids.slice(0, 12).reduce((acc, b) => acc + b.sizeUsd, 0);
  const sumAskUsd = asks.slice(0, 12).reduce((acc, a) => acc + a.sizeUsd, 0);
  const l2OrderbookImbalance =
    sumBidUsd + sumAskUsd > 0
      ? (sumBidUsd - sumAskUsd) / (sumBidUsd + sumAskUsd)
      : 0;

  const buckets = [
    Math.max(1, lastBar.spotVbuy),
    Math.max(1, lastBar.spotVsell),
    Math.max(1, lastBar.perpVbuy),
    Math.max(1, lastBar.perpVsell),
    Math.max(1, sumBidUsd),
    Math.max(1, sumAskUsd),
  ];
  const totalMass = buckets.reduce((a, b) => a + b, 0);
  let entropy = 0;
  for (const val of buckets) {
    const p = val / totalMass;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  const maxEntropy = Math.log2(buckets.length);
  const shannonEntropyBits = entropy / maxEntropy;

  // 4. Hurst Exponent via Rescaled Range (R/S) — skorygowany Anis-Lloyd
  const returns: number[] = [];
  for (let i = Math.max(1, n - 45); i < n; i++) {
    returns.push(Math.log(bars[i].close / bars[i - 1].close));
  }
  const hurstExponent = hurstAnisLloyd(returns);

  // 5. VPIN (Volume-Synchronized Probability of Informed Trading) & Kyle's Lambda
  const vpinToxicity = computeVpinBvc(bars);

  // Głębokość arkusza (12 poziomów, USD) i lambda Kyle'a z regresji na realnym przepływie
  const bookDepthAskUsd = Math.round(sumAskUsd);
  const bookDepthBidUsd = Math.round(sumBidUsd);
  const kyleLambdaPer1M = kyleLambdaOls(bars);

  // 6. High-Resolution Volume Profile (TPO / POC / VAH / VAL / LVN) & Gravitational Liquidity Field
  const profileBucketsCount = 24;
  const visibleSlice = bars.slice(-80);
  let minP = Math.min(...visibleSlice.map((b) => b.low));
  let maxP = Math.max(...visibleSlice.map((b) => b.high));
  if (shaakuni.pdh && shaakuni.pdl) {
    minP = Math.min(minP, shaakuni.pdl - 80);
    maxP = Math.max(maxP, shaakuni.pdh + 80);
  }
  const bucketStep = Math.max(20, (maxP - minP) / profileBucketsCount);

  const rawBuckets: {
    price: number;
    buyVol: number;
    sellVol: number;
    liqFuel: number;
    gravity: number;
  }[] = [];

  for (let idx = 0; idx < profileBucketsCount; idx++) {
    const pCenter = Number((minP + (idx + 0.5) * bucketStep).toFixed(0));
    const pLow = pCenter - bucketStep / 2;
    const pHigh = pCenter + bucketStep / 2;

    let buyVol = 0;
    let sellVol = 0;
    for (const b of visibleSlice) {
      if (b.high >= pLow && b.low <= pHigh) {
        // Overlap proportion
        const overlap =
          Math.min(b.high, pHigh) - Math.max(b.low, pLow);
        const barRange = Math.max(1, b.high - b.low);
        const weight = Math.max(0.1, overlap / barRange);
        buyVol += b.vbuy * weight;
        sellVol += b.vsell * weight;
      }
    }

    // Add Liquidation Heatmap fuel falling near this bucket
    let liqFuel = 0;
    for (const cell of heatmap) {
      const dist = Math.abs(cell.priceLevel - pCenter);
      if (dist <= bucketStep * 1.4) {
        liqFuel += cell.strength * cell.count * 420000 * Math.exp(-dist / bucketStep);
      }
    }

    // Boost liquidation fuel around Shaakuni PDH, PDL, PWH, PWL stop-loss pools
    const keyStops = [shaakuni.pdh, shaakuni.pdl, shaakuni.pwh, shaakuni.pwl];
    for (const stopLvl of keyStops) {
      if (stopLvl && Math.abs(stopLvl - pCenter) <= bucketStep * 1.1) {
        liqFuel += 3800000;
      }
    }

    // Gravitational Liquidity Pull U(p) combining resting liquidation fuel + Order Block mass
    let obMass = 0;
    for (const ob of shaakuni.orderBlocks) {
      if (ob.state === 'fresh' && pCenter >= ob.bottom - bucketStep && pCenter <= ob.top + bucketStep) {
        obMass += ob.pocVolume * 0.45;
      }
    }

    const distFromCurrent = Math.max(bucketStep * 0.6, Math.abs(pCenter - currentPrice));
    const gravity = (liqFuel * 1.4 + obMass + (buyVol + sellVol) * 0.18) / Math.pow(distFromCurrent, 0.55);

    rawBuckets.push({
      price: pCenter,
      buyVol: Math.round(buyVol),
      sellVol: Math.round(sellVol),
      liqFuel: Math.round(liqFuel),
      gravity,
    });
  }

  let maxBucketVol = 1;
  let pocIdx = 0;
  let totalProfileVol = 0;
  let maxGravity = 1;
  let primaryMagnetPrice = deq;

  rawBuckets.forEach((rb, i) => {
    const tot = rb.buyVol + rb.sellVol;
    totalProfileVol += tot;
    if (tot > maxBucketVol) {
      maxBucketVol = tot;
      pocIdx = i;
    }
    if (rb.gravity > maxGravity && Math.abs(rb.price - currentPrice) > bucketStep * 0.8) {
      maxGravity = rb.gravity;
      primaryMagnetPrice = rb.price;
    }
  });

  const pocPrice = rawBuckets[pocIdx]?.price ?? currentPrice;

  // Compute 70% Value Area (VAH / VAL) expanding from POC
  let vaAccum = rawBuckets[pocIdx]
    ? rawBuckets[pocIdx].buyVol + rawBuckets[pocIdx].sellVol
    : 0;
  let lowIdx = pocIdx;
  let highIdx = pocIdx;
  while (
    vaAccum < totalProfileVol * 0.7 &&
    (lowIdx > 0 || highIdx < rawBuckets.length - 1)
  ) {
    const nextLowVol =
      lowIdx > 0
        ? rawBuckets[lowIdx - 1].buyVol + rawBuckets[lowIdx - 1].sellVol
        : -1;
    const nextHighVol =
      highIdx < rawBuckets.length - 1
        ? rawBuckets[highIdx + 1].buyVol + rawBuckets[highIdx + 1].sellVol
        : -1;
    if (nextHighVol >= nextLowVol && highIdx < rawBuckets.length - 1) {
      highIdx++;
      vaAccum += nextHighVol;
    } else if (lowIdx > 0) {
      lowIdx--;
      vaAccum += nextLowVol;
    } else {
      break;
    }
  }

  const valPrice = rawBuckets[lowIdx]?.price ?? currentPrice - atr;
  const vahPrice = rawBuckets[highIdx]?.price ?? currentPrice + atr;

  let shortSqueezeFuelUsd = 0;
  let longCascadeFuelUsd = 0;
  const liquidityProfile: LiquidityProfileBucket[] = rawBuckets.map((rb, idx) => {
    const totalVolumeUsd = rb.buyVol + rb.sellVol;
    if (rb.price > currentPrice) shortSqueezeFuelUsd += rb.liqFuel;
    else longCascadeFuelUsd += rb.liqFuel;

    return {
      price: rb.price,
      totalVolumeUsd,
      buyVolumeUsd: rb.buyVol,
      sellVolumeUsd: rb.sellVol,
      deltaUsd: rb.buyVol - rb.sellVol,
      liquidationPoolUsd: rb.liqFuel,
      gravityPotential: Number(Math.min(1, rb.gravity / Math.max(1, maxGravity)).toFixed(3)),
      isPOC: idx === pocIdx,
      isValueArea: idx >= lowIdx && idx <= highIdx,
      isLVN: totalVolumeUsd < maxBucketVol * 0.28,
    };
  });

  // 7. Combinatorial Barrier Hitting Probability (PDH vs PDL)
  const pdh = shaakuni.pdh ?? currentPrice + atr * 2.5;
  const pdl = shaakuni.pdl ?? currentPrice - atr * 2.5;
  const distToPDH = Math.max(1, pdh - currentPrice);
  const distToPDL = Math.max(1, currentPrice - pdl);
  const geomProbPDH = distToPDL / (distToPDH + distToPDL);

  const recentSlice = bars.slice(-16);
  const spotCvdChange =
    recentSlice[recentSlice.length - 1].cvdSpot - recentSlice[0].cvdSpot;
  const perpCvdChange =
    recentSlice[recentSlice.length - 1].cvdPerp - recentSlice[0].cvdPerp;
  const normSpot = spotCvdChange / Math.max(1, Math.abs(spotCvdChange) + Math.abs(perpCvdChange));
  const normPerp = perpCvdChange / Math.max(1, Math.abs(spotCvdChange) + Math.abs(perpCvdChange));
  // Bez wolumenu spot (sam Hyperliquid) dywergencja spot/perp jest niezdefiniowana → 0
  const hasSpotFlow = recentSlice.some((b) => b.spotVbuy + b.spotVsell > 0);
  const cvdDivergenceScore = hasSpotFlow ? normSpot - normPerp : 0;

  const freshOBs = shaakuni.orderBlocks.filter((ob) => ob.state === 'fresh');
  let obBias = 0;
  for (const ob of freshOBs) {
    const dist = Math.abs(currentPrice - ob.mid);
    if (dist < atr * 3) {
      const proximityWeight = Math.exp(-dist / (atr * 1.2));
      obBias += (ob.type === 'bull' ? 1 : -1) * proximityWeight;
    }
  }
  obBias = Math.max(-1, Math.min(1, obBias));

  let upperLiqMass = 0;
  let lowerLiqMass = 0;
  for (const cell of heatmap) {
    const dist = Math.max(10, Math.abs(cell.priceLevel - currentPrice));
    const pull = (cell.strength * cell.count) / Math.pow(dist, 0.65);
    if (cell.isResistance) upperLiqMass += pull;
    else lowerLiqMass += pull;
  }
  const liqMagnetBias =
    upperLiqMass + lowerLiqMass > 0
      ? (upperLiqMass - lowerLiqMass) / (upperLiqMass + lowerLiqMass)
      : 0;

  // 8. Neural Attention Network Forward Pass
  const rawWeights = {
    shaakuniOBProximity: 0.28 + Math.abs(obBias) * 0.2,
    spotCvdDelta: 0.26 + Math.abs(normSpot) * 0.18,
    perpFundingAndLiq: 0.2 + Math.abs(liqMagnetBias) * 0.15,
    l2BookImbalance: 0.14 + Math.abs(l2OrderbookImbalance) * 0.12,
    hawkesCascadeVelocity: 0.12 + Math.abs(hawkesNetDominance) * 0.15,
  };
  const weightSum = Object.values(rawWeights).reduce((a, b) => a + b, 0);
  const neuralAttentionWeights = {
    shaakuniOBProximity: Number((rawWeights.shaakuniOBProximity / weightSum).toFixed(3)),
    spotCvdDelta: Number((rawWeights.spotCvdDelta / weightSum).toFixed(3)),
    perpFundingAndLiq: Number((rawWeights.perpFundingAndLiq / weightSum).toFixed(3)),
    l2BookImbalance: Number((rawWeights.l2BookImbalance / weightSum).toFixed(3)),
    hawkesCascadeVelocity: Number((rawWeights.hawkesCascadeVelocity / weightSum).toFixed(3)),
  };

  const linearActivation =
    obBias * neuralAttentionWeights.shaakuniOBProximity * 1.45 +
    (normSpot * 0.7 + cvdDivergenceScore * 0.5) *
      neuralAttentionWeights.spotCvdDelta *
      1.5 +
    liqMagnetBias * neuralAttentionWeights.perpFundingAndLiq * 1.25 +
    l2OrderbookImbalance * neuralAttentionWeights.l2BookImbalance * 1.2 +
    hawkesNetDominance * neuralAttentionWeights.hawkesCascadeVelocity * 1.3 -
    Math.max(-0.4, Math.min(0.4, ouZScore * 0.12));

  const neuralDirectionBias = Math.tanh(linearActivation * 1.85);
  // Score 0..100 = siła heurystyki |bias|; nieskalibrowane, więc nie jest to prawdopodobieństwo
  const neuralConfidence = Math.round(Math.min(100, Math.abs(neuralDirectionBias) * 100));

  const combinatorialPathProbPDH = Math.max(
    0.04,
    Math.min(0.96, geomProbPDH + neuralDirectionBias * 0.18)
  );
  const combinatorialPathProbPDL = Number((1 - combinatorialPathProbPDH).toFixed(3));

  let regimeClassification: QuantMathMetrics['regimeClassification'] =
    'Mean-Reversion Equilibrium';
  if (cvdDivergenceScore > 0.22 && obBias >= 0) {
    regimeClassification = 'Spot Absorption Bullish';
  } else if (cvdDivergenceScore < -0.22 && obBias <= 0) {
    regimeClassification = 'Perp Exhaustion Bearish';
  } else if (hurstExponent > HURST_TREND_THRESHOLD) {
    regimeClassification = 'Momentum Breakout';
  }

  const horizons = [
    { stepBars: 1, label: '+5m' },
    { stepBars: 3, label: '+15m' },
    { stepBars: 6, label: '+30m' },
    { stepBars: 12, label: '+1h' },
  ];

  const forecastHorizon = horizons.map((h) => {
    const stepScale = Math.sqrt(h.stepBars);
    const ouPull =
      (equilibriumPrice - currentPrice) * (1 - Math.exp(-ouTheta * h.stepBars * 0.45));
    const neuralDrift = neuralDirectionBias * atr * 0.52 * stepScale;
    const kalmanMomentum = (lastBar?.kalmanVelocity ?? 0) * Math.min(3, h.stepBars * 0.35);

    const predictedPrice = Number(
      (currentPrice + neuralDrift + ouPull * 0.35 + kalmanMomentum).toFixed(1)
    );
    const sigma = atr * 0.42 * stepScale;
    return {
      stepBars: h.stepBars,
      label: h.label,
      predictedPrice,
      upper1Sigma: Number((predictedPrice + sigma).toFixed(1)),
      lower1Sigma: Number((predictedPrice - sigma).toFixed(1)),
      upper2Sigma: Number((predictedPrice + sigma * 1.96).toFixed(1)),
      lower2Sigma: Number((predictedPrice - sigma * 1.96).toFixed(1)),
    };
  });

  return {
    ouTheta: Number(ouTheta.toFixed(4)),
    ouHalfLifeBars: Number(ouHalfLifeBars.toFixed(1)),
    ouEquilibriumPrice: Number(equilibriumPrice.toFixed(1)),
    ouZScore: Number(ouZScore.toFixed(2)),
    hawkesBuyIntensity: Number(hawkesBuyIntensity.toFixed(2)),
    hawkesSellIntensity: Number(hawkesSellIntensity.toFixed(2)),
    hawkesBranchingRatio,
    hawkesNetDominance: Number(hawkesNetDominance.toFixed(3)),
    shannonEntropyBits: Number(shannonEntropyBits.toFixed(3)),
    hurstExponent: Number(hurstExponent.toFixed(3)),
    combinatorialPathProbPDH: Number(combinatorialPathProbPDH.toFixed(3)),
    combinatorialPathProbPDL,
    l2MicroPrice: Number(l2MicroPrice.toFixed(1)),
    l2OrderbookImbalance: Number(l2OrderbookImbalance.toFixed(3)),
    vpinToxicity: Number(vpinToxicity.toFixed(3)),
    bookDepthAskUsd,
    bookDepthBidUsd,
    kyleLambdaPer1M,
    shortSqueezeFuelUsd: Math.round(shortSqueezeFuelUsd),
    longCascadeFuelUsd: Math.round(longCascadeFuelUsd),
    pocPrice,
    vahPrice,
    valPrice,
    primaryMagnetPrice,
    liquidityProfile,
    cvdDivergenceScore: Number(cvdDivergenceScore.toFixed(3)),
    regimeClassification,
    neuralConfidence,
    neuralDirectionBias: Number(neuralDirectionBias.toFixed(3)),
    neuralAttentionWeights,
    forecastHorizon,
  };
}

/** Minimalny realny przepływ na poziomie ($), od którego klasyfikujemy wyczerpanie/absorpcję. */
const MIN_OFI_FLOW_USD = 25000;

export function computeOrderFlowImbalanceHeatmap(
  bids: L2OrderbookLevel[],
  asks: L2OrderbookLevel[],
  trades: AggrTradeTick[],
  bars: OHLCVBar[],
  currentPrice: number
): OFIMomentumSummary {
  const lastBar = bars[bars.length - 1];
  const prevBar = bars.length > 1 ? bars[bars.length - 2] : lastBar;

  // Sort asks descending (highest price at top, best ask just above spread)
  const topAsks = [...asks]
    .slice(0, 12)
    .sort((a, b) => b.price - a.price);
  // Sort bids descending (best bid just below spread, lowest bid at bottom)
  const topBids = [...bids]
    .slice(0, 12)
    .sort((a, b) => b.price - a.price);

  // Determine average tick spacing
  const allLevels = [...topAsks, ...topBids];
  const tickStep =
    allLevels.length >= 2
      ? Math.max(0.5, Math.abs(allLevels[0].price - allLevels[1].price))
      : 1.0;

  const maxRestingUsd = Math.max(
    100000,
    ...allLevels.map((l) => l.sizeUsd)
  );

  const priceSlope =
    lastBar && prevBar ? lastBar.close - prevBar.close : 0;

  let totalAggBuy = 0;
  let totalAggSell = 0;
  let maxAggTotal = 1;

  const buildTickRow = (
    lvl: L2OrderbookLevel,
    side: 'ASK' | 'BID',
    idxFromSpread: number
  ): OrderFlowImbalanceTick => {
    // 1. Aggregate actual streaming trades near this price tick
    let tradeBuyUsd = 0;
    let tradeSellUsd = 0;
    const band = Math.max(1.8, tickStep * 1.65);

    for (let i = 0; i < trades.length; i++) {
      const tr = trades[i];
      const dist = Math.abs(tr.price - lvl.price);
      if (dist <= band) {
        const weight = 1 - (dist / band) * 0.45;
        if (tr.side === 'buy') tradeBuyUsd += tr.sizeUsd * weight;
        else tradeSellUsd += tr.sizeUsd * weight;
      }
    }

    // 2. Wyłącznie realne transakcje — bez modelowanego przepływu bazowego i sinusoidy
    const aggressiveBuyUsd = Math.round(tradeBuyUsd);
    const aggressiveSellUsd = Math.round(tradeSellUsd);
    const hasFlow = aggressiveBuyUsd + aggressiveSellUsd >= MIN_OFI_FLOW_USD;

    totalAggBuy += aggressiveBuyUsd;
    totalAggSell += aggressiveSellUsd;
    maxAggTotal = Math.max(maxAggTotal, aggressiveBuyUsd + aggressiveSellUsd);

    // Bez przepływu stosunek jest neutralny (1), a nie 0 — inaczej „wyczerpanie” z pustki
    // Stosunek ograniczony do 99 (jednostronny przepływ) — bez wartości typu 26756x
    const buySellRatio = !hasFlow
      ? 1
      : aggressiveSellUsd > 0
      ? Number(Math.min(99, aggressiveBuyUsd / aggressiveSellUsd).toFixed(2))
      : 99;
    const ofiNormalized = Number(
      (
        (aggressiveBuyUsd - aggressiveSellUsd) /
        Math.max(1, aggressiveBuyUsd + aggressiveSellUsd)
      ).toFixed(3)
    );
    const deltaUsd = aggressiveBuyUsd - aggressiveSellUsd;

    // Passive wall ratio relative to max resting L2 depth
    const restingWallNorm = Math.min(1, lvl.sizeUsd / maxRestingUsd);
    const absorptionScore = hasFlow
      ? Number(
          Math.min(
            1,
            (lvl.sizeUsd / Math.max(1, aggressiveBuyUsd + aggressiveSellUsd)) * 0.45
          ).toFixed(2)
        )
      : 0;

    // Detect Momentum Exhaustion & Passive Absorption at this exact tick
    let exhaustionState: OrderFlowImbalanceTick['exhaustionState'] = 'NONE';
    let exhaustionScore = 0;

    if (!hasFlow) {
      // Brak realnego przepływu na tym poziomie — brak podstaw do klasyfikacji
    } else if (side === 'ASK') {
      if (restingWallNorm > 0.52 && buySellRatio > 1.35) {
        // Heavy aggressive buying slamming into a large resting Ask wall without breaking through
        exhaustionState = 'ASK_WALL_ABSORPTION';
        exhaustionScore = Math.min(
          98,
          Math.round(55 + restingWallNorm * 28 + Math.min(15, buySellRatio * 5))
        );
      } else if (idxFromSpread >= 5 && buySellRatio < 0.68 && priceSlope >= 0) {
        // Price tried to push higher, but aggressive buy ratio collapsed at higher ticks
        exhaustionState = 'BUY_EXHAUSTION';
        exhaustionScore = Math.min(
          96,
          Math.round(52 + (1 - buySellRatio) * 45)
        );
      }
    } else {
      if (restingWallNorm > 0.52 && buySellRatio < 0.74) {
        // Heavy aggressive selling slamming into a large resting Bid wall (Passive Bid Absorption)
        exhaustionState = 'BID_WALL_ABSORPTION';
        exhaustionScore = Math.min(
          98,
          Math.round(
            55 + restingWallNorm * 28 + Math.min(15, (1 / Math.max(0.1, buySellRatio)) * 4)
          )
        );
      } else if (idxFromSpread >= 5 && buySellRatio > 1.45 && priceSlope <= 0) {
        // Downward push losing aggressive sell pressure at lower ticks
        exhaustionState = 'SELL_EXHAUSTION';
        exhaustionScore = Math.min(
          96,
          Math.round(50 + Math.min(45, (buySellRatio - 1) * 28))
        );
      }
    }

    const heatIntensity = Number(
      Math.min(1, Math.abs(ofiNormalized) * 0.85 + restingWallNorm * 0.25).toFixed(2)
    );

    return {
      price: lvl.price,
      side,
      restingSizeBtc: lvl.sizeBtc,
      restingSizeUsd: lvl.sizeUsd,
      cumulativeUsd: lvl.cumulativeUsd,
      orderCount: lvl.exchangeCount,
      aggressiveBuyUsd,
      aggressiveSellUsd,
      buySellRatio,
      ofiNormalized,
      deltaUsd,
      absorptionScore,
      exhaustionState,
      exhaustionScore,
      heatIntensity,
    };
  };

  // topAsks is sorted highest -> lowest, so distance from spread is (topAsks.length - 1 - i)
  const askTicks = topAsks.map((a, i) =>
    buildTickRow(a, 'ASK', topAsks.length - 1 - i)
  );
  // topBids is sorted highest -> lowest, so distance from spread is i
  const bidTicks = topBids.map((b, i) => buildTickRow(b, 'BID', i));

  const ticks = [...askTicks, ...bidTicks];

  // Bez realnego przepływu stosunek neutralny (1) — nie „dominacja sprzedających” z zera
  const overallBuySellRatio =
    totalAggBuy + totalAggSell >= MIN_OFI_FLOW_USD
      ? Number((totalAggBuy / Math.max(1, totalAggSell)).toFixed(2))
      : 1;
  const overallOfiPct =
    totalAggBuy + totalAggSell >= MIN_OFI_FLOW_USD
      ? Number(
          (((totalAggBuy - totalAggSell) / (totalAggBuy + totalAggSell)) * 100).toFixed(1)
        )
      : 0;

  // Find strongest exhaustion/absorption tick
  let topExhaustionTick: OrderFlowImbalanceTick | null = null;
  for (const t of ticks) {
    if (
      t.exhaustionState !== 'NONE' &&
      (!topExhaustionTick || t.exhaustionScore > topExhaustionTick.exhaustionScore)
    ) {
      topExhaustionTick = t;
    }
  }

  // Bez wykrytego wyczerpania indeks = 0 (wcześniej: wymyślona baza 18% + |OFI|)
  const exhaustionIndex = topExhaustionTick ? topExhaustionTick.exhaustionScore : 0;

  let exhaustionBias: OFIMomentumSummary['exhaustionBias'] =
    'BALANCED_EQUILIBRIUM';
  let exhaustionNote = tr(
    `Zrównoważony przepływ OFI (${overallBuySellRatio}x Buy/Sell) wokół $${currentPrice.toFixed(1)}.`,
    `Balanced OFI flow (${overallBuySellRatio}x Buy/Sell) around $${currentPrice.toFixed(1)}.`
  );

  if (
    topExhaustionTick?.exhaustionState === 'ASK_WALL_ABSORPTION' ||
    topExhaustionTick?.exhaustionState === 'BUY_EXHAUSTION'
  ) {
    exhaustionBias = 'BULLISH_EXHAUSTION_TOP_RISK';
    exhaustionNote = tr(
      `Wyczerpanie impetu kupujących na $${topExhaustionTick.price.toFixed(1)} (${topExhaustionTick.buySellRatio}x B/S) — pasywna ściana ASK absorbuje zlecenia rynkowe.`,
      `Buyer momentum exhausted at $${topExhaustionTick.price.toFixed(1)} (${topExhaustionTick.buySellRatio}x B/S): a passive ASK wall is absorbing market orders.`
    );
  } else if (
    topExhaustionTick?.exhaustionState === 'BID_WALL_ABSORPTION' ||
    topExhaustionTick?.exhaustionState === 'SELL_EXHAUSTION'
  ) {
    exhaustionBias = 'BEARISH_EXHAUSTION_BOTTOM_REVERSAL';
    exhaustionNote = tr(
      `Wyczerpanie impetu sprzedających na $${topExhaustionTick.price.toFixed(1)} (${topExhaustionTick.buySellRatio}x B/S) — pasywna ściana BID absorbuje podaż rynkową.`,
      `Seller momentum exhausted at $${topExhaustionTick.price.toFixed(1)} (${topExhaustionTick.buySellRatio}x B/S): a passive BID wall is absorbing market selling.`
    );
  } else if (overallBuySellRatio >= 1.25) {
    exhaustionBias = 'AGGRESSIVE_BUY_CONTINUATION';
    exhaustionNote = tr(
      `Dominacja agresywnych zleceń Market Buy (${overallBuySellRatio}x B/S, OFI +${overallOfiPct}%) bez oporu pasywnego.`,
      `Aggressive market buys dominate (${overallBuySellRatio}x B/S, OFI +${overallOfiPct}%) with no passive resistance.`
    );
  } else if (overallBuySellRatio <= 0.8) {
    exhaustionBias = 'AGGRESSIVE_SELL_CONTINUATION';
    exhaustionNote = tr(
      `Dominacja agresywnych zleceń Market Sell (${overallBuySellRatio}x B/S, OFI ${overallOfiPct}%) wywierająca presję na arkusz BID.`,
      `Aggressive market sells dominate (${overallBuySellRatio}x B/S, OFI ${overallOfiPct}%), pressing on the BID side of the book.`
    );
  }

  return {
    ticks,
    overallBuySellRatio,
    overallOfiPct,
    exhaustionIndex,
    exhaustionBias,
    dominantExhaustionTick: topExhaustionTick ? topExhaustionTick.price : null,
    exhaustionNote,
  };
}
