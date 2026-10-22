export type ExchangeId =
  | 'HYPERLIQUID'
  | 'BINANCE_FUTURES'
  | 'BINANCE'
  | 'BYBIT'
  | 'COINBASE'
  | 'OKEX'
  | 'BITFINEX'
  | 'DERIBIT'
  | 'KRAKEN'
  | 'BITMEX'
  | 'BITSTAMP';

export interface ExchangeVolumeBreakdown {
  vbuy: number;
  vsell: number;
}

export interface OHLCVBar {
  time: number; // Unix timestamp in ms
  open: number;
  high: number;
  low: number;
  close: number;
  vbuy: number; // Total buy volume in USD
  vsell: number; // Total sell volume in USD
  spotVbuy: number;
  spotVsell: number;
  perpVbuy: number;
  perpVsell: number;
  lbuy: number; // Short liquidations (forced market buys)
  lsell: number; // Long liquidations (forced market sells)
  cbuy: number; // Buy trade count
  csell: number; // Sell trade count
  exchanges: Record<ExchangeId, ExchangeVolumeBreakdown>;
  // Computed indicator values
  cvdTotal: number;
  cvdSpot: number;
  cvdPerp: number;
  deltaSpot: number;
  deltaPerp: number;
  spotHighVol: boolean;
  perpHighVol: boolean;
  keltnerUpper: number;
  keltnerBasis: number;
  keltnerLower: number;
  kalmanEstimate: number;
  kalmanVelocity: number;
  atr: number;
  // true = podział buy/sell z realnych transakcji WS (strona agresora); false/brak = estymata BVC ze świecy
  realFlow?: boolean;
}

export type LevelStatus = 'Active' | 'Sweep !' | 'Break';

export type NYSessionName =
  | 'Asian'
  | 'London'
  | 'New York'
  | 'London Close'
  | 'No Active Session';

export interface OrderBlockZone {
  id: string;
  type: 'bull' | 'bear'; // 5 = Bull OB, 6 = Bear OB in Shaakuni Pine Script
  label: 'OB' | 'POI';
  top: number;
  bottom: number;
  mid: number;
  createdBarIndex: number;
  createdTime: number;
  state: 'fresh' | 'mitigated';
  mitigatedBarIndex: number | null;
  impulseAtrMultiple: number;
  deltaImbalance: number; // Net orderflow delta inside the OB candle
  pocVolume: number; // Volume concentration
}

export interface ShaakuniConfig {
  tzChoice: 'Auto (DST)' | 'Manual UTC-4 (EDT)' | 'Manual UTC-5 (EST)';
  showWeek: boolean;
  showEQ: boolean;
  showPrevW: boolean;
  showDay: boolean;
  showDEQ: boolean;
  showOB: boolean;
  showFresh: boolean;
  showMit: boolean;
  obSwingLen: number;
  impMult: number;
  showKeltner: boolean;
  showLiqHeatmap: boolean;
  showNeuralCone: boolean;
}

export interface ShaakuniState {
  pwh: number | null;
  pwl: number | null;
  weq: number | null;
  pwh2: number | null;
  pwl2: number | null;
  pdh: number | null;
  pdl: number | null;
  deq: number | null;
  pdhStatus: LevelStatus;
  pdlStatus: LevelStatus;
  nySession: NYSessionName;
  nyTimeFormatted: string;
  atr14: number;
  orderBlocks: OrderBlockZone[];
}

export interface LiquidationHeatmapCell {
  id: string;
  priceLevel: number;
  top: number;
  bottom: number;
  strength: number;
  count: number;
  leverage: 5 | 20 | 100;
  isResistance: boolean; // true = short liquidations above price, false = long liquidations below price
  intensityRatio: number; // 0..1 normalized
  color: string;
  createdBarIndex: number;
}

export interface LiquidityProfileBucket {
  price: number;
  totalVolumeUsd: number;
  buyVolumeUsd: number;
  sellVolumeUsd: number;
  deltaUsd: number;
  liquidationPoolUsd: number; // Estimated resting leveraged liquidation fuel at this bucket
  gravityPotential: number; // Normalized 0..1 gravitational magnet pull
  isPOC: boolean;
  isValueArea: boolean;
  isLVN: boolean; // Low Volume Node (Air-pocket fast-travel zone)
}

export interface AggrTradeTick {
  id: string;
  timestamp: number;
  exchange: ExchangeId;
  market: string;
  isPerp: boolean;
  side: 'buy' | 'sell';
  price: number;
  sizeUsd: number;
  sizeBtc: number;
  isLiquidation: boolean;
  tier: 'normal' | 'threshold' | 'significant' | 'huge' | 'rare';
  // true = tick wygenerowany przez model (tryb HL Live + Aggr Model), nie realna transakcja
  isSynthetic?: boolean;
}

export interface L2OrderbookLevel {
  price: number;
  sizeBtc: number;
  sizeUsd: number;
  cumulativeUsd: number;
  exchangeCount: number;
}

export interface OrderFlowImbalanceTick {
  price: number;
  side: 'ASK' | 'BID';
  restingSizeBtc: number;
  restingSizeUsd: number;
  cumulativeUsd: number;
  orderCount: number;
  aggressiveBuyUsd: number;
  aggressiveSellUsd: number;
  buySellRatio: number; // V_buy / V_sell ratio at this price tick
  ofiNormalized: number; // (V_buy - V_sell) / (V_buy + V_sell) in [-1, 1]
  deltaUsd: number; // V_buy - V_sell
  absorptionScore: number; // 0..1 passive wall absorption vs aggressive flow
  exhaustionState:
    | 'NONE'
    | 'BUY_EXHAUSTION'
    | 'SELL_EXHAUSTION'
    | 'ASK_WALL_ABSORPTION'
    | 'BID_WALL_ABSORPTION';
  exhaustionScore: number; // 0..100%
  heatIntensity: number; // 0..1 thermal intensity
}

export interface OFIMomentumSummary {
  ticks: OrderFlowImbalanceTick[];
  overallBuySellRatio: number;
  overallOfiPct: number; // -100% to +100%
  exhaustionIndex: number; // 0..100% momentum exhaustion index
  exhaustionBias:
    | 'BULLISH_EXHAUSTION_TOP_RISK'
    | 'BEARISH_EXHAUSTION_BOTTOM_REVERSAL'
    | 'AGGRESSIVE_BUY_CONTINUATION'
    | 'AGGRESSIVE_SELL_CONTINUATION'
    | 'BALANCED_EQUILIBRIUM';
  dominantExhaustionTick: number | null;
  exhaustionNote: string;
}

export interface WhaleOrderNode {
  price: number;
  side: 'BID' | 'ASK';
  sizeBtc: number;
  sizeUsd: number;
  orderCount: number;
  pattern: 'Institutional Iceberg' | 'Passive Whale Wall' | 'Liquidity Shield';
}

export interface BackendQuantTelemetry {
  timestamp: number;
  markPrice: number;
  oraclePrice: number;
  midPrice: number;
  openInterestBtc: number;
  openInterestUsd: number;
  dayVolumeUsd: number;
  funding1hPct: number;
  fundingAnnualizedPct: number;
  basisBps: number;
  whaleNodes: WhaleOrderNode[];
  monteCarlo: {
    probTouchPDH2h: number;
    probTouchPDL2h: number;
    probTouchDEQ2h: number;
    // null = żadna ścieżka nie dotknęła poziomu w horyzoncie 2h
    expectedMinsToPDH: number | null;
    expectedMinsToPDL: number | null;
    expectedMinsToDEQ: number | null;
    sampledPaths: {
      id: string;
      type: 'bull' | 'bear' | 'mean_revert';
      points: { step: number; price: number }[];
    }[];
    /** fhs-har = σ kroków z sezonowego log-HAR + reszty FHS; merton-assumed = zapas z założonymi skokami */
    method: 'fhs-har' | 'merton-assumed';
  };
}

export interface QuantMathMetrics {
  // Ornstein-Uhlenbeck Mean Reversion Process: dX_t = theta * (mu - X_t) dt + sigma dW_t
  ouTheta: number; // Mean reversion speed
  ouHalfLifeBars: number; // ln(2) / theta; Infinity gdy brak powrotu do średniej (theta = 0)
  ouEquilibriumPrice: number; // Anchor (weighted D-EQ & W-EQ)
  ouZScore: number; // Standardized price deviation from equilibrium

  // Hawkes Self-Exciting Point Process: lambda(t) = mu + sum alpha * exp(-beta * (t - t_i))
  hawkesBuyIntensity: number;
  hawkesSellIntensity: number;
  // null: współczynnik rozgałęzienia wymaga estymacji MLE na znacznikach czasu transakcji — nieestymowany
  hawkesBranchingRatio: number | null;
  hawkesNetDominance: number; // -1 to +1

  // Combinatorics & Information Theory
  shannonEntropyBits: number; // Orderbook + trade directional entropy (0..1+)
  hurstExponent: number; // <0.45 mean-reverting, 0.5 random walk, >0.55 trending
  combinatorialPathProbPDH: number; // Binomial/Catalan barrier hitting probability for PDH before PDL
  combinatorialPathProbPDL: number;
  l2MicroPrice: number; // Volume-weighted micro-price from top L2 levels
  l2OrderbookImbalance: number; // -1 (heavy ask wall) to +1 (heavy bid wall)

  // Pioneering Liquidity Microstructure Telemetry (VPIN, Kyle's Lambda, Liquidation Fuel)
  vpinToxicity: number; // 0..1 Volume-Synchronized Probability of Informed Trading
  bookDepthAskUsd: number; // Suma płynności po stronie ASK (12 poziomów L2), USD
  bookDepthBidUsd: number; // Suma płynności po stronie BID (12 poziomów L2), USD
  // Lambda Kyle'a: regresja OLS ΔP na netto przepływie agresora ($ ruchu na $1M netto); null gdy < 10 świec z realnym przepływem
  kyleLambdaPer1M: number | null;
  shortSqueezeFuelUsd: number; // Total resting short liquidation fuel within +1.5%
  longCascadeFuelUsd: number; // Total resting long liquidation fuel within -1.5%
  pocPrice: number; // Volume Profile Point of Control
  vahPrice: number; // Value Area High (70%)
  valPrice: number; // Value Area Low (70%)
  primaryMagnetPrice: number; // Strongest combined Gravitational Liquidity Magnet
  liquidityProfile: LiquidityProfileBucket[];

  // Spot vs Perp Orderflow Regime
  cvdDivergenceScore: number; // Spot vs Perp Z-score spread
  regimeClassification:
    | 'Spot Absorption Bullish'
    | 'Perp Exhaustion Bearish'
    | 'Momentum Breakout'
    | 'Mean-Reversion Equilibrium'
    | 'Liquidation Cascade Squeeze';

  // Neural Time-Series Prediction (Multi-Horizon Attention Model)
  neuralConfidence: number; // 0..100 — siła heurystyki (|bias|), NIE skalibrowane prawdopodobieństwo
  neuralDirectionBias: number; // -1 (Strong Short) to +1 (Strong Long)
  neuralAttentionWeights: {
    shaakuniOBProximity: number;
    spotCvdDelta: number;
    perpFundingAndLiq: number;
    l2BookImbalance: number;
    hawkesCascadeVelocity: number;
  };
  forecastHorizon: {
    stepBars: number;
    label: string;
    predictedPrice: number;
    upper1Sigma: number;
    lower1Sigma: number;
    upper2Sigma: number;
    lower2Sigma: number;
  }[];
}

export interface OptionVolSurfacePoint {
  strike: number;
  expiryDays: number;
  expiryLabel: string;
  moneyness: number; // K / Spot
  impliedVol: number; // IV in % (e.g. 52.4%)
  delta: number; // -1 to +1
  gammaUsdPer1Pct: number; // Gamma modelu w $ na ruch 1% na 1 BTC nominału (bez OI — nie jest to GEX dealerów)
  vanna: number;
  charm: number;
  isMaxPain: boolean;
  isZeroGamma: boolean;
}

export interface MarketPhysicsMetrics {
  // Fluid Mechanics & Navier-Stokes Analogy
  reynoldsNumber: number; // < 1500 Laminar (stable trend), > 2500 Turbulent (liquidation whirlpool)
  flowViscosity: number; // Resistance to price movement in USD / $1 move
  kineticPressureGradient: number; // dp/dt pressure from aggressive flow
  brownianDiffusionCoeff: number; // Random microscopic dispersion
  bernoulliLiftScore: number; // Asymmetric pressure differential (Bid vs Ask constriction)
  regime: 'Laminar Steady Flow' | 'Turbulent Churn' | 'Cavitation Breakout' | 'Viscous Stagnation';
}
