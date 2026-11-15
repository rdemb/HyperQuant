import {
  AggrTradeTick,
  KyleEstimate,
  L2OrderbookLevel,
  LiquidityProfileBucket,
  OFIMomentumSummary,
  OHLCVBar,
  OrderFlowImbalanceTick,
  QuantMathMetrics,
  RegimeEstimate,
  ShaakuniState,
  VpinEstimate,
} from '../types/trading';
import { tr } from '../i18n';
import { fmtNum, fmtPrice } from '../ui/format';
import { Bocpd, regimePrior } from './bocpd';
import { t975 } from './tQuantile';

/**
 * Metryki opisowe przepływu i mikrostruktury (Badania, Przed sesją) — same estymatory z metodą i niepewnością:
 * 1) Ornstein-Uhlenbeck: OLS AR(1) wokół kotwicy 0.65·D-EQ + 0.35·W-EQ (kotwica ustalona, nie estymowana); t½ w UI
 *    tylko powyżej progu szumu (noiseBands).
 * 2) Hurst: R/S z korektą Anis-Lloyd na 45 zwrotach; w UI pasmo 90% szumu.
 * 3) VPIN (BVC, Easley–López de Prado–O'Hara 2012) z przedziałem 95% ze średnich partii kubełków.
 * 4) λ Kyle'a (OLS na realnym przepływie WS) z przedziałem t; przedział obejmujący 0 = „nieodróżnialne od zera”.
 * 5) Reżim zmienności: BOCPD (Adams i MacKay 2007) na log-zwrotach zamkniętych świec, prior jak we wskaźniku wykresu.
 * 6) Profil wolumenu ostatnich 80 świec: POC, VAH, VAL, LVN.
 * Bez heurystyk z ręcznymi wagami (dawny „Hawkes” ze stałymi, entropia, pole przyciągania, trajektoria) — plan 59, B8.
 */

/** Próg reżimu trendowego dla skorygowanego H: ≈ 96. percentyl rozkładu pod szumem (n = 45, symulacja). */
export const HURST_TREND_THRESHOLD = 0.6;

export { t975 };

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
 * Mniej niż 8 zwrotów albo seria płaska (σ = 0): H nieokreślone → null, nie 0,5.
 */
export function hurstAnisLloyd(returns: number[]): number | null {
  const n = returns.length;
  if (n < 8) return null;
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
  if (!(std > 0)) return null;
  const rs = (maxDev - minDev) / std;
  const h = 0.5 + (Math.log(rs) - Math.log(expectedRescaledRange(n))) / Math.log(n);
  return Math.max(0, Math.min(1, h));
}

/** Partie średnich do przedziału VPIN (50 kubełków → 10 partii po 5). */
const VPIN_BATCHES = 10;

/**
 * VPIN na kubełkach o równym wolumenie (Easley, López de Prado, O'Hara 2012) z przedziałem 95% ze średnich partii.
 * Podział kupno/sprzedaż w świecach: realny z WS albo BVC. Wolumen świecy jest rozlewany proporcjonalnie do kolejnych
 * kubełków; VPIN = średnia |V_B − V_S| / V z pełnych kubełków. Przedział: kubełki w kolejności czasu dzielone na 10
 * partii, se = sd(średnich partii) / √10, granice VPIN ∓ t₀,₉₇₅(9)·se obcięte do [0, 1]. Bez wolumenu albo bez pełnego
 * kubełka VPIN nieokreślony → null, nie 0.
 */
export function vpinEstimate(bars: OHLCVBar[], bucketCount: number = 50): VpinEstimate | null {
  const totalVol = bars.reduce((acc, b) => acc + b.vbuy + b.vsell, 0);
  if (!(totalVol > 0)) return null;
  const bucketVol = totalVol / bucketCount;
  let fill = 0;
  let buy = 0;
  let sell = 0;
  const imb: number[] = [];
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
        imb.push(Math.abs(buy - sell) / bucketVol);
        fill = 0;
        buy = 0;
        sell = 0;
      }
    }
  }
  const full = imb.length;
  if (full === 0) return null;
  const value = imb.reduce((a, x) => a + x, 0) / full;
  const k = Math.min(VPIN_BATCHES, full);
  if (k < 2) return { value, lo: Number.NaN, hi: Number.NaN, full };
  const per = Math.floor(full / k);
  const means: number[] = [];
  for (let b = 0; b < k; b++) {
    const end = b === k - 1 ? full : (b + 1) * per;
    let s = 0;
    for (let i = b * per; i < end; i++) s += imb[i];
    means.push(s / (end - b * per));
  }
  const mm = means.reduce((a, x) => a + x, 0) / k;
  const sd = Math.sqrt(means.reduce((a, x) => a + (x - mm) ** 2, 0) / (k - 1));
  const half = t975(k - 1) * (sd / Math.sqrt(k));
  return { value, lo: Math.max(0, value - half), hi: Math.min(1, value + half), full };
}

/** Sam VPIN (bez przedziału): null bez pełnego kubełka. */
export function computeVpinBvc(bars: OHLCVBar[], bucketCount: number = 50): number | null {
  return vpinEstimate(bars, bucketCount)?.value ?? null;
}

/**
 * Lambda Kyle'a: OLS ΔP_t = a + λ·Q_t + ε na świecach z realnym przepływem agresora (WS), z przedziałem 95%:
 * se = √(Σe² / (n − 2) / Σ(Q − Q̄)²), granice λ ∓ t₀,₉₇₅(n − 2)·se. Na świecach BVC regresja byłaby kołowa (Q wyliczone
 * z ΔP) — wtedy null. Wynik w $ ruchu ceny na $1M netto przepływu.
 */
export function kyleEstimate(bars: OHLCVBar[], minBars: number = 10): KyleEstimate | null {
  const dp: number[] = [];
  const q: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    if (!bars[i].realFlow) continue;
    dp.push(bars[i].close - bars[i - 1].close);
    q.push((bars[i].vbuy - bars[i].vsell) / 1e6);
  }
  const n = q.length;
  if (n < minBars) return null;
  const mq = q.reduce((a, b) => a + b, 0) / n;
  const mp = dp.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varQ = 0;
  for (let i = 0; i < n; i++) {
    cov += (q[i] - mq) * (dp[i] - mp);
    varQ += (q[i] - mq) ** 2;
  }
  if (!(varQ > 0)) return null;
  const value = cov / varQ;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (dp[i] - mp - value * (q[i] - mq)) ** 2;
  const se = Math.sqrt(sse / (n - 2) / varQ);
  const half = t975(n - 2) * se;
  const lo = value - half;
  const hi = value + half;
  return { value, lo, hi, n, zeroInside: lo <= 0 && hi >= 0 };
}

/** Sama λ Kyle'a (bez przedziału): null bez realnego przepływu. */
export function kyleLambdaOls(bars: OHLCVBar[], minBars: number = 10): number | null {
  return kyleEstimate(bars, minBars)?.value ?? null;
}

/** BOCPD reżimu: jak we wskaźniku „Reżim zmienności” na wykresie (prior ze 100 pierwszych zwrotów, α₀ = 2, długość 200). */
export const REGIME_PRIOR_N = 100;
const REGIME_WINDOW = 300;
const REGIME_HAZARD = 1 / 200;
let regimeMemo: { key: string; v: RegimeEstimate | null } | null = null;

/**
 * Reżim zmienności z log-zwrotów zamkniętych świec (do 300 ostatnich): P(zmiana w ostatnich 5 świecach) i σ reżimu
 * na świecę. Mniej niż 101 zwrotów → null. Liczony raz na nową zamkniętą świecę (pamięć ostatniego wyniku).
 */
export function regimeEstimate(closes: readonly number[]): RegimeEstimate | null {
  const from = Math.max(0, closes.length - REGIME_WINDOW - 1);
  const key = `${closes.length}|${closes[from]}|${closes[closes.length - 1]}`;
  if (regimeMemo?.key === key) return regimeMemo.v;
  const r: number[] = [];
  for (let i = from + 1; i < closes.length; i++) {
    const x = Math.log(closes[i] / closes[i - 1]);
    if (Number.isFinite(x)) r.push(x);
  }
  let v: RegimeEstimate | null = null;
  if (r.length > REGIME_PRIOR_N) {
    const det = new Bocpd({ hazard: REGIME_HAZARD, alpha0: 2, beta0: regimePrior(r.slice(0, REGIME_PRIOR_N)), rMax: REGIME_WINDOW });
    for (const x of r) det.update(x);
    const s = det.state();
    v = { pRecent5: s.pRecent5, sigma: s.sigma, n: r.length };
  }
  regimeMemo = { key, v };
  return v;
}

/** Zestaw metryk dla braku danych (ceny NaN, estymatory null, listy puste). */
export function emptyQuantMetrics(): QuantMathMetrics {
  return {
    ouTheta: 0,
    ouHalfLifeBars: Number.POSITIVE_INFINITY,
    ouEquilibriumPrice: Number.NaN,
    ouZScore: 0,
    hurstExponent: null,
    vpin: null,
    kyle: null,
    regime: null,
    pocPrice: Number.NaN,
    vahPrice: Number.NaN,
    valPrice: Number.NaN,
    liquidityProfile: [],
  };
}

export function computeQuantMetrics(bars: OHLCVBar[], shaakuni: ShaakuniState): QuantMathMetrics {
  const n = bars.length;
  // Za mało danych (np. przed pierwszą synchronizacją) — neutralne metryki z NaN zamiast liczb zastępczych
  if (n < 3) return emptyQuantMetrics();
  const lastBar = bars[n - 1];
  const currentPrice = lastBar.close;
  const atr = lastBar.atr || Math.max(1, lastBar.high - lastBar.low);

  // 1. Ornstein-Uhlenbeck (OU): dX_t = theta * (mu - X_t) dt + sigma dW_t
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

  // 2. Hurst (R/S, Anis-Lloyd) na 45 ostatnich zwrotach
  const returns: number[] = [];
  for (let i = Math.max(1, n - 45); i < n; i++) returns.push(Math.log(bars[i].close / bars[i - 1].close));
  const hurstExponent = hurstAnisLloyd(returns);

  // 3–5. VPIN i λ Kyle'a z przedziałami; reżim BOCPD na zamkniętych świecach (bieżąca świeca w trakcie nie wchodzi)
  const vpin = vpinEstimate(bars);
  const kyle = kyleEstimate(bars);
  const regime = regimeEstimate(bars.slice(0, -1).map((b) => b.close));

  // 6. Profil wolumenu (POC / VAH / VAL / LVN) z 80 ostatnich świec na 24 poziomach
  const profileBucketsCount = 24;
  const visibleSlice = bars.slice(-80);
  let minP = Math.min(...visibleSlice.map((b) => b.low));
  let maxP = Math.max(...visibleSlice.map((b) => b.high));
  if (shaakuni.pdh && shaakuni.pdl) {
    minP = Math.min(minP, shaakuni.pdl - 80);
    maxP = Math.max(maxP, shaakuni.pdh + 80);
  }
  const bucketStep = Math.max(20, (maxP - minP) / profileBucketsCount);
  const rawBuckets: { price: number; buyVol: number; sellVol: number }[] = [];
  for (let idx = 0; idx < profileBucketsCount; idx++) {
    const pCenter = Number((minP + (idx + 0.5) * bucketStep).toFixed(0));
    const pLow = pCenter - bucketStep / 2;
    const pHigh = pCenter + bucketStep / 2;
    let buyVol = 0;
    let sellVol = 0;
    for (const b of visibleSlice) {
      if (b.high >= pLow && b.low <= pHigh) {
        const overlap = Math.min(b.high, pHigh) - Math.max(b.low, pLow);
        const barRange = Math.max(1, b.high - b.low);
        const weight = Math.max(0.1, overlap / barRange);
        buyVol += b.vbuy * weight;
        sellVol += b.vsell * weight;
      }
    }
    rawBuckets.push({ price: pCenter, buyVol: Math.round(buyVol), sellVol: Math.round(sellVol) });
  }

  let maxBucketVol = 1;
  let pocIdx = 0;
  let totalProfileVol = 0;
  rawBuckets.forEach((rb, i) => {
    const tot = rb.buyVol + rb.sellVol;
    totalProfileVol += tot;
    if (tot > maxBucketVol) {
      maxBucketVol = tot;
      pocIdx = i;
    }
  });
  const pocPrice = rawBuckets[pocIdx]?.price ?? currentPrice;

  // Value Area 70% rozszerzana od POC o większego sąsiada
  let vaAccum = rawBuckets[pocIdx] ? rawBuckets[pocIdx].buyVol + rawBuckets[pocIdx].sellVol : 0;
  let lowIdx = pocIdx;
  let highIdx = pocIdx;
  while (vaAccum < totalProfileVol * 0.7 && (lowIdx > 0 || highIdx < rawBuckets.length - 1)) {
    const nextLowVol = lowIdx > 0 ? rawBuckets[lowIdx - 1].buyVol + rawBuckets[lowIdx - 1].sellVol : -1;
    const nextHighVol = highIdx < rawBuckets.length - 1 ? rawBuckets[highIdx + 1].buyVol + rawBuckets[highIdx + 1].sellVol : -1;
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

  const liquidityProfile: LiquidityProfileBucket[] = rawBuckets.map((rb, idx) => {
    const totalVolumeUsd = rb.buyVol + rb.sellVol;
    return {
      price: rb.price,
      totalVolumeUsd,
      buyVolumeUsd: rb.buyVol,
      sellVolumeUsd: rb.sellVol,
      deltaUsd: rb.buyVol - rb.sellVol,
      isPOC: idx === pocIdx,
      isValueArea: idx >= lowIdx && idx <= highIdx,
      isLVN: totalVolumeUsd < maxBucketVol * 0.28,
    };
  });

  return {
    ouTheta: Number(ouTheta.toFixed(4)),
    ouHalfLifeBars: Number(ouHalfLifeBars.toFixed(1)),
    ouEquilibriumPrice: Number(equilibriumPrice.toFixed(1)),
    ouZScore: Number(ouZScore.toFixed(2)),
    hurstExponent: hurstExponent === null ? null : Number(hurstExponent.toFixed(3)),
    vpin,
    kyle,
    regime,
    pocPrice,
    vahPrice,
    valPrice,
    liquidityProfile,
  };
}

/** Minimalny realny przepływ na poziomie ($), od którego klasyfikujemy wyczerpanie/absorpcję. */
export const MIN_OFI_FLOW_USD = 25000;

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
  // Poniżej progu stosunek jest neutralny z braku danych, nie z równowagi — mówimy to wprost
  let exhaustionNote =
    totalAggBuy + totalAggSell >= MIN_OFI_FLOW_USD
      ? tr(
          `Zrównoważony przepływ OFI (${fmtNum(overallBuySellRatio)}x Buy/Sell) wokół $${fmtPrice(currentPrice, 1)}.`,
          `Balanced OFI flow (${fmtNum(overallBuySellRatio)}x Buy/Sell) around $${fmtPrice(currentPrice, 1)}.`
        )
      : tr(
          `Mało transakcji w ostatnich 60 s wokół $${fmtPrice(currentPrice, 1)} — za mało przepływu, by go ocenić.`,
          `Few trades in the last 60 s around $${fmtPrice(currentPrice, 1)}, too little flow to assess.`
        );

  if (
    topExhaustionTick?.exhaustionState === 'ASK_WALL_ABSORPTION' ||
    topExhaustionTick?.exhaustionState === 'BUY_EXHAUSTION'
  ) {
    exhaustionBias = 'BUY_FLOW_ABSORBED';
    exhaustionNote = tr(
      `Wyczerpanie impetu kupujących na $${fmtPrice(topExhaustionTick.price, 1)} (${fmtNum(topExhaustionTick.buySellRatio)}x B/S) — pasywna ściana ASK absorbuje zlecenia rynkowe.`,
      `Buyer momentum exhausted at $${fmtPrice(topExhaustionTick.price, 1)} (${fmtNum(topExhaustionTick.buySellRatio)}x B/S): a passive ASK wall is absorbing market orders.`
    );
  } else if (
    topExhaustionTick?.exhaustionState === 'BID_WALL_ABSORPTION' ||
    topExhaustionTick?.exhaustionState === 'SELL_EXHAUSTION'
  ) {
    exhaustionBias = 'SELL_FLOW_ABSORBED';
    exhaustionNote = tr(
      `Wyczerpanie impetu sprzedających na $${fmtPrice(topExhaustionTick.price, 1)} (${fmtNum(topExhaustionTick.buySellRatio)}x B/S) — pasywna ściana BID absorbuje podaż rynkową.`,
      `Seller momentum exhausted at $${fmtPrice(topExhaustionTick.price, 1)} (${fmtNum(topExhaustionTick.buySellRatio)}x B/S): a passive BID wall is absorbing market selling.`
    );
  } else if (overallBuySellRatio >= 1.25) {
    exhaustionBias = 'AGGRESSIVE_BUY_DOMINANT';
    exhaustionNote = tr(
      `Dominacja agresywnych zleceń Market Buy (${fmtNum(overallBuySellRatio)}x B/S, OFI +${fmtNum(overallOfiPct)}%) bez oporu pasywnego.`,
      `Aggressive market buys dominate (${fmtNum(overallBuySellRatio)}x B/S, OFI +${fmtNum(overallOfiPct)}%) with no passive resistance.`
    );
  } else if (overallBuySellRatio <= 0.8) {
    exhaustionBias = 'AGGRESSIVE_SELL_DOMINANT';
    exhaustionNote = tr(
      `Dominacja agresywnych zleceń Market Sell (${fmtNum(overallBuySellRatio)}x B/S, OFI ${fmtNum(overallOfiPct)}%) wywierająca presję na arkusz BID.`,
      `Aggressive market sells dominate (${fmtNum(overallBuySellRatio)}x B/S, OFI ${fmtNum(overallOfiPct)}%), pressing on the BID side of the book.`
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
