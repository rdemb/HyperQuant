# HyperQuant 3D Desk

> **Experimental Open-Source 3D Quantitative Order Flow & Liquidity Analytics Desk for BTCUSD on Hyperliquid**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Demo: Live on GitHub Pages](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-emerald)](https://rdemb.github.io/HyperQuant/)
[![Stack: React 19 + Three.js + Vite](https://img.shields.io/badge/Stack-React%2019%20%7C%20Three.js%20%7C%20Vite%20%7C%20D3-cyan)](https://github.com/rdemb/HyperQuant)
[![Data: Hyperliquid + Aggr.trade](https://img.shields.io/badge/Feed-Hyperliquid%20L2%20%2B%20Aggr.trade-purple)](https://hyperliquid.xyz/)

---

## 🌐 Live Interactive Terminal

Experience the live analytical desk directly in your browser:
👉 **[https://rdemb.github.io/HyperQuant/](https://rdemb.github.io/HyperQuant/)**

---

## 🎯 Overview & Purpose

Standard 2D Depth-of-Market (DOM) ladders and Cumulative Volume Delta (CVD) indicators compress multidimensional market dynamics into flat lines. **HyperQuant 3D Desk** is an open-source exploratory project designed to test whether **GPU-accelerated 3D spatial topologies (Three.js / WebGL)** can uncover microstructure patterns that remain invisible on traditional 2D candlestick charts.

The desk targets **BTCUSD perpetuals on Hyperliquid**, combining:
1. **Real-time Level 2 Order Book & Trade Feeds** directly from the official Hyperliquid API/WebSocket.
2. **Multi-Exchange Aggr.trade Flow Modeling** uniting Spot (Coinbase, Binance, Bitfinex, Kraken) and Perp (Hyperliquid, Binance Futures, Bybit, OKX, Deribit, BitMEX) volume deltas and liquidations.
3. **Shaakuni Liquidity Framework (Pine Script v6)**: Mathematical tracking of High-Timeframe (HTF) levels (`PDH`, `PDL`, `PWH`, `PWL`), 50% Equilibriums (`D-EQ`, `W-EQ`), and ATR impulse Order Blocks.
4. **5 Specialized 3D WebGL Spatial Engines**:
   - **Liquidity Canyon**: Physical spatial depth with Bokeh Depth-of-Field (DOF) mapping book thickness across price levels.
   - **Orderflow Vortex**: Multi-venue orbital velocity field tracking Spot vs. Perp lead-lag dynamic.
   - **Delta Flow Fluid Field**: Continuous pressure-sensitive displacement mesh showing aggressive market sweeps.
   - **Quantum Risk Topography**: Blue-to-Red D3 3D terrain visualizing 10x–100x liquidation magnets.
   - **Option Volatility Surface**: Real-time SVI implied volatility smile and dealer gamma exposure (GEX) matrix with 2D cross-section slicer.
5. **Microstructure Quantitative Engines**: Merton Jump-Diffusion Monte Carlo first-passage time projections, Kyle's Lambda price impact, VPIN flow toxicity, and Hawkes self-exciting cascade intensity.

---

## 🔬 Mathematical & Microstructure Models

### 1. Merton Jump-Diffusion + Ornstein-Uhlenbeck First-Passage Paths
To project intra-session reach probabilities toward HTF liquidity targets (`PDH`, `PDL`, `D-EQ`), the engine computes a 600-path stochastic simulation:

$$dS_t = \theta (\bar{S} - S_t) dt + \sigma S_t dW_t + J_t S_t dN_t$$

- **Mean Reversion Drift ($\theta, \bar{S}$)**: Anchored to daily equilibrium `D-EQ = (PDH + PDL) / 2`.
- **Diffusion Volatility ($\sigma$)**: Dynamically calibrated from the 15-minute Parkinson high-low volatility estimator.
- **Jump Component ($J_t dN_t$)**: Poisson process simulating sudden order-block impulse sweeps with log-normal amplitude:
  $$\ln(1 + J) \sim \mathcal{N}\left(\mu_J, \sigma_J^2\right)$$
- Evaluates empirical first-passage time distributions ($\tau_{\text{PDH}}$, $\tau_{\text{PDL}}$) to measure time-to-target likelihood for day trading setups.

### 2. Kyle’s Lambda ($\lambda$) Microstructure Price Impact
Measures the illiquidity cost per transacted contract:

$$\lambda = \frac{\text{Cov}(\Delta P_t, \, Q_t)}{\text{Var}(Q_t)}$$

Where $\Delta P_t$ represents the midpoint tick change and $Q_t$ denotes signed trade flow. Spikes in $\lambda$ identify institutional liquidity thinness or aggressive sweep vacuum zones.

### 3. Volume-Synchronized Probability of Toxicity (VPIN)
Detects informed flow toxicity by grouping trading activity into volume buckets $V$:

$$\text{VPIN} = \frac{\sum_{\tau=1}^N |V_\tau^B - V_\tau^S|}{N \times V}$$

When VPIN crosses the 65% threshold alongside an ATR expansion, it flags institutional positioning or imminent cascade risk.

### 4. Hawkes Self-Exciting Point Process
Models the clustering of rapid-fire aggressive market orders:

$$\lambda(t) = \mu_0 + \sum_{t_i < t} \alpha \, e^{-\beta (t - t_i)}$$

Where $\alpha / \beta$ represents the branching ratio. High branching ratios ($\alpha / \beta \to 1.0$) indicate cascade self-excitation, typical of stop-loss runs and liquidation spirals.

### 5. Shaakuni Liquidity Framework (Pine Script v6 Standard)
- **Previous Day High / Low (`PDH`, `PDL`)** and **Previous Week High / Low (`PWH`, `PWL`)**: Computed strictly from closed daily/weekly candles on Hyperliquid.
- **Daily / Weekly Equilibrium (`D-EQ`, `W-EQ`)**: Median fair-value retest levels.
- **Order Block (`BULL OB` / `BEAR OB`)**: Identified when an impulse bar exceeds $1.8 \times \text{ATR}(14)$ and leaves an unfilled imbalance zone.
- **Sweep States**: Live state-machine classification (`Active` $\to$ `Sweep !` $\to$ `Broken X`).

---

## 🎮 3D Spatial Visualizations & How to Read Them

| 3D Component | Visual Paradigm | Actionable Trader Insight |
| :--- | :--- | :--- |
| **Liquidity Canyon** | 3D Topographic Depth Ridge with dynamic Bokeh Depth-of-Field | Identifies dense passive resting limit walls (Icebergs) before price enters the zone. High elevation = heavy bid/ask shielding. |
| **Orderflow Vortex** | Multi-exchange orbital particle flux (Hyperliquid + Binance + Bybit) | Visualizes rotational momentum. When outer rings (Spot) lead inner rings (Perp), it indicates spot-driven spot accumulation rather than over-leveraged perp chasing. |
| **Delta Fluid Field** | Elastic pressure displacement mesh | Visualizes buyer vs. seller battles. Market buy sweeps generate green kinetic crests; aggressive dumps create deep crimson depressions. |
| **Quantum Risk Heatmap** | 3D liquidation terrain colored with a continuous D3 Blue-to-Red gradient | Highlights short-squeeze and long-cascade 'magnet' levels where leveraged stop orders cluster. |
| **Option Volatility Surface** | 3D SVI Implied Volatility surface + 2D Smile slice + Greeks Heatmap | Displays the volatility skew across strikes and expiries, uncovering dealer gamma flip levels and tail-risk pricing. |

---

## 📈 Real-World Day Trading Use Cases

### Scenario A: HTF Liquidity Sweep & Mean Reversion (Fade Setup)
1. **Trigger**: Price expands into the `PDH` zone during the New York Open.
2. **Confirmation**:
   - Shaakuni engine transitions `PDH Status` to `Sweep !`.
   - The **Quantum Risk Heatmap** displays a sharp liquidation exhaustion ridge above the level.
   - The **Delta Fluid Field** displays an aggressive buy crest that immediately flattens (absorption by limit asks).
   - Kyle’s Lambda drops sharply, confirming heavy resting passive limit resistance.
3. **Execution**: Fade the sweep toward `D-EQ` with defined risk above the sweep wick.

### Scenario B: Volatility Compression & Breakout Cascade
1. **Trigger**: VPIN falls below 30% while the Orderflow Vortex displays tight concentric rotation (compression).
2. **Confirmation**:
   - Hawkes self-exciting branching ratio accelerates above 0.85.
   - An aggressive delta surge breaks out of the daily equilibrium `D-EQ`.
   - The Monte Carlo first-passage time probability to `PDH` jumps to >70%.
3. **Execution**: Enter breakout momentum targeting the next unmitigated Order Block.

## 📡 Data Architecture: Live Hyperliquid L1 Feeds vs. Quantitative Modeling

To ensure full transparency for quantitative researchers and traders, HyperQuant 3D Desk clearly separates **live network telemetry** from **client-side stochastic & multi-venue modeling**, and provides a one-click toolbar switch (`HL Live + Aggr Model` vs. `Pure HL Live`):

| Telemetry Layer | Source / Endpoint | Mode & Transparency Notes |
| :--- | :--- | :--- |
| **OHLCV Candles (`1m`–`4h`)** | `POST https://api.hyperliquid.xyz/info` (`candleSnapshot`) | **100% Live** from Hyperliquid L1. |
| **Shaakuni HTF Levels (`PDH`, `PDL`, `PWH`, `PWL`, `D-EQ`)** | `POST https://api.hyperliquid.xyz/info` (`1d` & `1w` candles) | **100% Live** computed from real Hyperliquid daily and weekly candle closes. |
| **L2 Orderbook & Whale Iceberg Clusters** | `POST https://api.hyperliquid.xyz/info` (`l2Book`) + `wss://api.hyperliquid.xyz/ws` | **100% Live** resting bids/asks and order-count clustering on Hyperliquid. |
| **Open Interest, Funding APR, Mark/Oracle Basis** | `POST https://api.hyperliquid.xyz/info` (`metaAndAssetCtxs`) | **100% Live** perpetual contract context fetched directly in the browser. |
| **Hyperliquid BTC-PERP Trade Tape** | `wss://api.hyperliquid.xyz/ws` (`trades` channel) | **100% Live** streaming executions. |
| **600-Path Merton Jump-Diffusion & Vol Surface** | Client-side / Express `runMertonMonteCarloEngine()` | **Live-Calibrated Stochastic Model** anchored to live Hyperliquid price, `PDH`/`PDL`/`D-EQ`, and Parkinson volatility. |
| **AggrBTCv5 Multi-Venue Spot/Perp Disaggregation** | `public/data/aggr_template.json` + heuristic flow model | `aggr_template.json` defines the Aggr.trade workspace layout and whale thresholds. In **`HL Live + Aggr Model`** mode, cross-exchange Spot/Perp CVD split and auxiliary CEX ticks are heuristically modeled around live Hyperliquid price/volume. Switch to **`Pure HL Live`** in the top toolbar to stream **exclusively raw Hyperliquid ticks**. |

---

## 💻 Tech Stack & Architecture

- **Frontend Core**: React 19, TypeScript, Vite 6, Tailwind CSS v4 (with DOM-mutation resilience guards against browser translation extensions).
- **3D & Graphics Engine**: Three.js (WebGL with automatic off-screen `IntersectionObserver` render pausing), Canvas 2D, D3.js (scales, contours, gradients, color interpolators).
- **Audio Feedback**: Custom Web Audio API synthesizer for acoustic trade frequency and liquidation chimes.
- **Backend (Optional Local Full-Stack Mode)**: Node.js, Express, TypeScript (`tsx server.ts`), exposing `/api/quant/hyperliquid-live`.
- **Static GitHub Pages Mode**: Complete zero-backend browser execution querying `https://api.hyperliquid.xyz/info` and `wss://api.hyperliquid.xyz/ws` directly from the client.

---

## 🚀 Getting Started Locally

### Prerequisites
- Node.js 20+ installed
- npm or bun

### Installation & Run

```bash
# Clone the repository
git clone https://github.com/rdemb/HyperQuant.git
cd HyperQuant

# Install dependencies (using legacy peer deps for bulletproof resolution)
npm install --legacy-peer-deps

# Start development server with live express backend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build Production Bundle

```bash
npm run build
```

The production assets will be emitted to `./dist` with relative paths (`./assets/...`), fully compatible with GitHub Pages or any static CDN.

---

## ⚙️ Automated GitHub Pages Deployment

The repository includes a ready-to-run GitHub Actions workflow in `.github/workflows/static.yml`:
1. In your GitHub repository, navigate to **Settings ➔ Pages**.
2. Under **Build and deployment > Source**, select **GitHub Actions**.
3. Pushes to `main` will automatically trigger `npm run build` and publish `./dist` to GitHub Pages.

---

## ⚖️ Disclaimer & Educational Notice

> **IMPORTANT**: HyperQuant 3D Desk is an open-source experimental software project designed for educational, research, and algorithmic visualization purposes. It does **not** constitute financial, investment, trading, or legal advice. 
> Cryptocurrency trading, perpetual futures, and leveraged derivatives involve substantial risk of loss. Past simulations, mathematical models (including Merton Jump-Diffusion, VPIN, and Monte Carlo projections), and visualized order flow signals are probabilistic estimates and cannot guarantee future outcomes. Always conduct your own research and exercise risk management.

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.
