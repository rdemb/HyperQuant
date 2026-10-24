# HyperQuant — BTC day-trading desk for Hyperliquid

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/rdemb/HyperQuant/actions/workflows/ci.yml/badge.svg)](https://github.com/rdemb/HyperQuant/actions/workflows/ci.yml)
[![Desk ledger — daily independent verification](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Frdemb%2Fhyperquant-data%2Fhealth%2Fbadge%2Fledger.json)](https://github.com/rdemb/hyperquant-data/actions)
[![Live: GitHub Pages](https://img.shields.io/badge/Live-GitHub%20Pages-0b1019)](https://rdemb.github.io/HyperQuant/)
[![Stack](https://img.shields.io/badge/React%2019%20·%20Vite%208%20·%20Canvas%20·%20Three.js-PWA-3fc6dd)](https://github.com/rdemb/HyperQuant)

Open-source, installable (PWA) day-trading desk for BTC perpetuals on Hyperliquid. It combines live order-flow charts on TradingView Lightweight Charts™ (footprint, delta and CVD, order-book heatmap, aggressor bubbles, TPO, drawing tools), a Plan Analyzer that scores *your* trade plan (probability of target before stop, slippage from the live book, liquidation buffer, EV after fees) instead of giving buy/sell signals, cross-market context from Hyperliquid's public API, an official US macro calendar, a verifiable forecast ledger, a blog with BTC analyses written before the fact, and a data-lineage page that tells you where every number comes from. Real data only; anything modelled is labelled.

The interface and the blog are in Polish; where it helps you find something, the Polish UI label is given in *italics* next to the English name.

**Live:** https://rdemb.github.io/HyperQuant/ · install on a phone: Share → Add to Home Screen (iOS) or Install app (Android/Chrome).

---

## Principles

1. **Honest data.** Every value carries a tag: `LIVE` (real data), `MODEL` (model output from real data, method documented) or `SIM`. Missing data is shown as "—", never as a placeholder number. The desk starts only after the first successful sync with the API.
2. **The desk scores your plan; it does not suggest entries.** No automatic LONG/SHORT signals. Panels can only pass a direction to the Plan Analyzer.
3. **Public, legal data.** The core is Hyperliquid's public API. Centralised exchanges (Binance, Bybit, OKX, Coinbase) are strictly *opt-in*: the connection is made by the user's own browser, for personal use, and is off by default in the public build (the terms of some exchanges forbid public display of their data).
4. **Your data stays with you.** Plans, the accuracy journal, drawings and settings live only in your browser (localStorage and IndexedDB).

## What's inside

| View | Contents |
|---|---|
| **Desk** | Home page: a welcome panel and a site map with a short description of every tab, next to the L2 order book with OFI and the tape. Below the map, a context strip: 2 h range (Monte Carlo), book depth, VPIN/λ, OU, distance from the session VWAP in σ and Initial Balance state, funding, the next macro release; then the liquidation map with cascade, cohort flow and a quick Plan Analyzer. The welcome panel shows immediately; data appears after the first API sync. |
| **Charts** (*Wykresy*) | BTC, ETH, SOL and HYPE perpetuals on the TradingView Lightweight Charts™ engine with live Hyperliquid data (each market with its own tape, price tick and book aggregation). **Workstations** (*Stacje*) above the chart (Start, Scalper, Liquidity, Auction, Exchanges, Two timeframes) set the layout, timeframes, layers and panels for one trader question in a single click; your changes are kept as your own version of the station, and a reset button returns to the template. On phones, **Chart, Tape, DOM and Numbers** cards, shown one at a time. Timeframes 1m–1D with history from the API (loaded further as you scroll left), local time. The **last 24 hours of tape and order book** come from the scanner's recorder in the public data repository, and the tape is also cached in the browser, so footprint, Delta, CVD, bubbles and the heatmap are there from the first second. **Footprint** from the trade tape: zoomed out a plain candle, closer a volume profile inside the candle, closer still cells with numbers on every price row. Styles Bid × Ask (aggressor sells × buys; on wide candles also row delta and volume columns), Delta and Volume; automatic or fixed row height, framed POC, 70% value area, diagonal imbalances (adjustable ratio and minimum USD value) and stacked zones. **Delta** panel (delta candles: max and min delta during the bar) and **CVD** panel (reset per Asia/London/New York session with DST, UTC day, week, or continuous), volume from the API, and optional CVD and ΔOI panels comparing Hyperliquid with Binance and Bybit; every panel under the chart, including the Numbers table, can be hidden with the cross in its corner. **Indicators** (*Wskaźniki*) from candle history, visible immediately: daily VWAP with ±1σ/±2σ bands and session VWAP, visible-range volume profile with POC/VAH/VAL, PDH/PDL and daily open, session opens, initial balance with 1.5× and 2× extensions, liquidation clusters from the scanner, each toggled in the Indicators menu. **Drawing tools** like TradingView (left toolbar): lines, channel, Fibonacci, shapes, measure with tape volume and delta, long/short position with R:R, text and notes, fixed-range volume profile, anchored VWAP; magnet, undo, keyboard shortcuts (list under "?"), saved in the browser. **Address-level clashes**: aggressor order bubbles above a market-adjusted threshold, battles with one large maker, bursts of small orders from many addresses, maker walls and icebergs (a maker absorbed more than the level ever showed in the book), and **large resting orders in the book** (average order size of a level above a threshold, drawn as a line for as long as it rests); a click shows details and the taker's account pseudonym (never the address) with a summary of its orders, and the **order tape** (Time & Sales) has a value filter and a sound for large orders. **Whales**: positions and large resting orders (including stops and take-profits) of the largest Hyperliquid accounts, under a pseudonym valid for one UTC day. **TPO** (daily time profile, timeframes up to 30m): letters of 30-minute periods on each price row with POC, value area, initial balance, single prints, tails and naked POCs. **Numbers table** (*Tablica liczb*) under the chart, in groups: Hyperliquid (volume, delta, ΔOI, 8 h funding), tape (delta %, delta extremes, trades, pace) and optionally Binance (perp and spot delta, ΔOI, funding) and Bybit (delta, ΔOI); also **imbalance zones** and **unfinished auctions** extended to the right until price closes them. Legend with OHLC, VWAP and distance from it in σ, delta and its extremes, trade count, tape share of bar volume and the row under the cursor; PNG screenshot with caption, full screen. **Price alerts** from the right-click menu or a typed price (sound and browser notification while the page is open), a **view link** with market, timeframe and chart type, a chart menu with horizontal line, copy price and screenshot. On wide screens, **layouts of 1, 2 or 4 charts** (each with its own market, timeframe and settings; shared drawings per market, alerts and crosshair) and **setting templates**: built-in (order flow, 1m scalping, 1h swing, clean candles) and your own, saved from the current settings. |
| **Plan Analyzer** (*Analizator planu*) | Direction, entry, stop, target, size/risk %, leverage, horizon → P(target before stop) / P(stop) / P(neither within the horizon) from Monte Carlo (≥ 2000 paths, 5-min step, σ from seasonal log-HAR, FHS innovations, Brownian-bridge correction) with a fill phase from the current price and P(fill), the two-barrier formula as a reference, a path fan, slippage from walking the book, EV in R after fees, liquidation price (isolated) and stop buffer, macro events within the window (variance multiplier). **Accuracy journal**: saved plans are settled on real 1m Hyperliquid candles regardless of the chart timeframe (entry fill first), with Brier/log score, Brier for P(fill) and a reliability diagram. **Auction context** for the UTC session: VWAP ±1σ/±2σ, Initial Balance with extensions, the previous day's profile (POC/VAH/VAL), weak highs and lows, next to historical frequencies from ~200 BTC sessions with Wilson intervals (IB breakouts, the 80% rule, weak vs strong extremes taken out, PDH/PDL touch by open). A Plan for tomorrow (*Plan na jutro*) tab with mechanical scenarios and a checklist. **Trade journal and playbook**: setups in a context → location → trigger → execution → invalidation template, trades with an R result from the initial stop, MAE/MFE (in R) and the auction context at entry reconstructed from 1m Hyperliquid candles, per-setup statistics with uncertainty (hit rate with a Wilson interval, mean R with a bootstrap interval, profit factor, median MAE of winners and MFE of losers); data stays in the browser, JSON export/import. **Folklore lab**: 10 BTC day-trading rules (round numbers, PDH/PDL sweeps, IB breakout, VWAP reversion, CME gap, extreme funding, the "10:00 New York dump", intraday momentum) with a positive control and a placebo: a historical test with FDR correction and a pre-registered forward test (catalogue recorded in the verifiable ledger, e-values valid at every peek, e-BH). |
| **Market** (*Rynek*) | **Model vs market (HIP-4)**: Hyperliquid outcome markets on BTC ("price above K at expiry", "touch K before expiry", the daily market settling at 06:00 UTC), with the market price from the "Yes" side of the book next to the desk model's probability for the same question (Monte Carlo on seasonal log-HAR + FHS in a Web Worker, exact Brownian-bridge extremes), a liquidity filter and the difference in pp; a calibration comparison, not a signal. Funding HL vs Binance vs Bybit (via Hyperliquid's API, normalised to APR) + crowding z-score; macro proxies from HIP-3 markets (S&P 500, Nasdaq-100, gold, oil, EUR, JPY) and the macro share of BTC's move (β, R²); Hyperliquid perp market map (treemap, OI/volume, 24 h change); Fed/BLS/BEA calendar with countdown; macro (UST yields, TGA, RRP), CFTC COT (CME BTC), Fear & Greed, mempool; RSS headlines. |
| **Lab 3D** | Five lazily loaded Three.js scenes (one at a time): Liquidity Canyon, Orderflow Vortex, Delta Fluid, Liquidation Risk (estimate), Options (illustration), each with a "what you see / how to read it / source / limitations" note. |
| **Microstructure** (*Mikrostruktura*) | Book liquidity across the day from the scanner's recorder (median ±10 bp depth by UTC hour, current vs normal, resilience after sharp moves) and the execution cost of your size by hour (slippage from the depth curve and the square-root law, typical and in thin conditions); live order-book mechanics from the literature (Cont–Kukanov–Stoikov OFI, Hawkes MLE, Stoikov microprice, orders added and cancelled near the price, absorption from regression); liquidity profile and attraction field U(p), regime, heuristic trajectory, OU, Hawkes intensity, Hurst, entropy, VPIN, Kyle's λ, a fixed-risk position-size calculator. |
| **Blog** | BTC analyses written before the fact (in Polish): the day map, the map before the New York open and the daily summary, with short notes in between. Every post has a level map with distance from price, scenarios with probabilities, its own link-preview image and share buttons; full analyses also have a data panel, a liquidation map, flows, conditional scenarios and charts (session map with VWAP, profile, delta, CVD and OI; footprint of the key area), and short notes a 6-hour chart. Static pages (SEO), RSS, monthly archive. Posts are Markdown files in `content/blog/`; format and safeguards in [docs/BLOG.md](docs/BLOG.md) (in Polish). |
| **Sources** (*Źródła*) | Lineage of every number (source → method → LIVE/MODEL → refresh), attributions and licences, the opt-in CEX switch with connection status, tape sound. |

## Methods (summary) and literature

- **Buy/sell split of candles:** the real aggressor side from Hyperliquid's WebSocket wherever the desk observed the trades; for older candles, Bulk Volume Classification `V_B = V·Φ(ΔP/σ)` (Easley, López de Prado & O'Hara 2012), labelled MODEL.
- **VPIN:** 50 equal-volume buckets; a **contested** metric (Andersen & Bondarenko 2014), so read it against its own history.
- **Kyle's λ:** OLS `ΔP = λ·Q + ε` only on candles with real order flow (on BVC the regression would be circular); Kyle 1985.
- **Volatility:** seasonal log-HAR (Corsi 2009) on hourly Garman–Klass (1980) variances from ~5000 Hyperliquid 1h candles (≈ 208 days), UTC hour-of-day profile (Andersen & Bollerslev 1997), Duan (1983) smearing correction; the forecast is iterated in 5-min steps. Accuracy is shown live: out-of-sample QLIKE loss (Patton 2011) against a naive 24 h mean. Jump share from bipower variation (Barndorff-Nielsen & Shephard 2004), jumps from the Lee & Mykland (2008) test, both as diagnostics. Missing data → the Parkinson (1980) estimator as a labelled fallback.
- **Barrier probabilities:** Monte Carlo with innovations bootstrapped from standardised 5m returns (filtered historical simulation, Barone-Adesi et al. 1999: fat tails and jumps come from the data) and a discrete-monitoring correction with the local per-step σ (Broadie, Glasserman & Kou 1997). When the entry differs from the market price, a path must touch it first; the result is conditional on the fill, exactly as the journal settles it. The formula for Brownian motion (no time limit) serves as a reference.
- **2 h range (desk strip):** the same engine (2000 paths, common random numbers within a minute); without the volatility model, Merton with an assumed 20% jump share (labelled in the strip).
- **Hurst:** R/S with the Anis–Lloyd correction; Lo (1991): the test can mistake short memory for long memory.
- **OU:** discrete AR(1) around 0.65·D-EQ + 0.35·W-EQ; no mean reversion → t½ = ∞.
- **Liquidation map (Desk panel):** measured from on-chain positions: liquidation-price buckets from `clearinghouseState`, with OI coverage shown explicitly; the cascade from the square-root law (Tóth et al. 2011; Bouchaud et al. 2018) as an upper bound, and **cascade 2.0**, a Monte Carlo on the measured book: liquidations in tranches, triggering on the mark price with a 150 s EMA lag, the book refilling at the measured resilience rate, uncertainty about positions outside the map (a common path and bucket factor, coverage of each side separately), bands and local amplification.
- **Verifiable desk ledger:** every 15 min, forecasts are recorded before the fact: the distribution of BTC's 1 h and 4 h return (13 quantiles from the HAR + FHS model, with a normal benchmark recorded alongside) and the chances of touching PDH/PDL/D-EQ within 2 h, settled from 1m candles. Scores: CRPSS vs the benchmark, PIT, coverage with Kupiec's test, ACI (Gibbs & Candès 2021), Brier/BSS, reliability, Venn–Abers calibration. Integrity: a SHA-256 hash chain in daily files on the `ledger` branch of the data repository (append-only history), an OpenTimestamps receipt for the chain head after every slot (calendars immediately, a Bitcoin block after a few hours), day anchors, explicit records of skipped slots. **Model vs market**: every 15 min the model's p and the price of the rolling 15-minute HIP-4 BTC market are recorded before the fact, with the Brier score of both on the same questions; an **ensemble** (logarithmic pooling with weights fitted only on previously settled questions: Genest & Zidek 1986, Ranjan & Gneiting 2010; extremising: Satopää et al. 2014) and a calibrated market as a reference (the model's added value) are recorded alongside and scored the same way, with weights reproduced by the verifier. One-click verification in the reader's browser (WebCrypto: the chain from the first line, the summary head, receipts of the latest slots, pre-registrations) and full independent verification with `node scripts/verify-ledger.mjs --dir <clone of the ledger branch> [--market] [--bitcoin]` (chain, git history, ordering, receipts, scores from quantiles, ensemble weights reproduced by refitting, variant B from the scale formula, pre-registrations of the lab catalogue and the A/B plan matching the code; `--market`: settlement prices vs Hyperliquid 1m candles; `--bitcoin`: block time from the receipts). The Bitcoin block usually arrives after 1–6 h: for 1 h forecasts, the proof of recording before the fact is the OpenTimestamps calendars, and the block confirms them later.
- **Folklore lab:** barrier rules are events with two barriers (the one folklore predicts and the opposite one); under the hypothesis that price is a martingale, the optional stopping theorem gives the exact p0 = |C − failure| / |success − failure| regardless of the shape of the move distribution. A time limit gives a fractional outcome (the value of the stopped martingale, still E = p0); a candle touching both barriers is discarded (neutral under symmetric moves and rare thanks to a minimum band width; calibration checked by martingale simulation). Calendar rules (10:00 NY, momentum, weekend): p0 = 0.5 from sign symmetry or exchangeability of days. History: p-values with variance under H0 and Benjamini–Hochberg (1995) q, as exploration. Forward: the catalogue (definitions, parameters, thresholds and a control vector, i.e. a hash of the whole engine's output on fixed test data, so any code change requires a new version; SHA-256) is recorded in the ledger chain with an OpenTimestamps receipt, and only events starting ≥ 24 h later are scored; a betting process (Waudby-Smith & Ramdas 2023) gives an e-value valid under arbitrarily frequent peeking (Ville), with e-BH (Wang & Ramdas 2022) separately for confirmations and refutations and a confidence sequence for the effect; a positive control (weekends are calmer) and a placebo (non-round levels). Data: an archive of 1m/1h/1d candles and funding on the `archive` branch of the data repository (the API returns only the latest ~5000 candles).
- **Volatility regime and A/B of model versions:** BOCPD (Adams & MacKay 2007) with a Gamma prior on the precision of deseasonalised 5m returns, a Student-t predictive and a constant hazard (regime ~1 day); version B of the 1 h return forecast mixes the model's variance with the regime variance and is recorded next to version A in the same slots. The evaluation plan is pre-registered in the ledger, with 14-day periods fixed in advance, CRPS on the same slots and a Newey–West interval with the fixed-b critical value (Kiefer & Vogelsang 2005); conclusions are drawn only after a period ends.
- **Cohort flow:** every trade on Hyperliquid's public tape carries the addresses of both sides and the aggressor side. The scanner assigns them to cohorts (market makers, statistically informed, whales, everyone else) and publishes net flow (inventory change; the sum over cohorts = 0) and aggressive CVD per cohort. "Informed" = a significantly positive taker markout after 5 min (observation = a 5-min block per address, one-sided test, Benjamini–Hochberg FDR control at q = 10%, empirical Bayes); cohort markouts are computed out of sample (the cohort at the time of the trade). Privacy: closed buckets only, k-anonymity with a dominance rule and secondary suppression (the cohort sum is public), separately for the aggressor layer, amounts rounded to USD 10k.
- **Realised liquidation tape and map precision:** liquidations of tracked positions confirmed by fills with the `liquidation` field (Hyperliquid does not publish a liquidation stream for all accounts); for each one, how many bp the mark price at liquidation differed from the liquidation price on the map (median, p90). Positions with a liquidation price close to the market are read every minute.
- **Liquidation heatmap (Lab 3D), order blocks, U(p):** heuristics without statistical validation, labelled as estimates.
- **Forecast scoring:** Brier, log score, Brier for P(fill), reliability diagram (Gneiting & Raftery 2007); quarter-Kelly only after ≥ 50 settled plans, from the lower Wilson bound (MacLean, Thorp & Ziemba 2010).

## Data sources

| Source | What | Notes |
|---|---|---|
| Hyperliquid API (`/info`, WebSocket) | candles, L2 book, trades, OI, funding (also Binance/Bybit via `predictedFundings`), HIP-3, market map | public, limit of 1200 weight/min per user IP |
| HyperQuant scanner ([backend/](backend/README.md)) | liquidation map from on-chain positions (`clearinghouseState` of wallets seen on the BTC tape), realised liquidation tape (confirmed by fills with the `liquidation` field), cohort flow from the tape (`users` field + aggressor side), the last 24 h of tape and order book for the Charts view and the whale layer (pseudonyms only); no addresses | published to the public repository [rdemb/hyperquant-data](https://github.com/rdemb/hyperquant-data) (main files every 2 min, tape history in 5-minute parts); the browser never connects to the scanner's server |
| Federal Reserve, BLS, BEA | FOMC, CPI, NFP, PPI, GDP/PCE schedule | US public data |
| U.S. Treasury, FiscalData, NY Fed, CFTC | yields, TGA, RRP, COT | US public data |
| alternative.me | Fear & Greed | attribution next to the data |
| GDELT Project | media tone | citation + link |
| mempool.space | fees, difficulty, hashrate | — |
| RSS (CoinDesk, Cointelegraph, Decrypt, The Block, Bitcoin Magazine, Fed, BLS, SEC) | headlines | title, time and link to the publisher only |
| Binance, Bybit, OKX, Coinbase | trades and liquidations; in the Charts view also delta, open interest and funding | **opt-in only**, in the user's browser |

Public data from outside Hyperliquid is fetched every ~30 min by a GitHub Actions workflow (`scripts/fetch-public-data.mjs`, no API keys) and published together with the site as `data/feeds/*.json`.

## Running locally

Requires Node.js 24 (the version CI uses). No API keys or `.env` file are needed.

```bash
git clone https://github.com/rdemb/HyperQuant.git
cd HyperQuant
npm ci --legacy-peer-deps
npm run data      # optional: fetches public data into public/data/feeds
npm run dev       # development server (Express + Vite) at http://localhost:3000
npm test          # Vitest tests
npm run build     # production build to ./dist, including the blog (relative paths, ready for GitHub Pages)
```

**Your own copy on GitHub Pages:** fork → *Settings → Pages → Source: GitHub Actions*. The `.github/workflows/static.yml` workflow runs the tests, fetches public data, builds and publishes the site on every push to `main` and every ~30 min.

## Architecture

```
src/
  state/        useDeskFeed (Hyperliquid REST + WS, batching, data status), DeskContext, CEX opt-in
  charts/       pro/ — the Charts view: Hyperliquid client (hl/), tape, footprint, coverage and sessions (core/),
                store with last-day history and browser tape cache (store/), footprint series and Lightweight Charts
                controller (chart/), drawing tools (draw/), Binance and Bybit feeds (venues/)
                orderflow/ — the original Canvas order-flow store and renderer; footprint maths, heat colours
                and formatting shared with the Charts view
  views/        Desk, Charts, Plan, Market, Lab, Microstructure, Sources (lazy-loaded)
  components/   Three.js scenes (Lab), tape, microstructure panels and "Plan for tomorrow"
  workers/      Web Worker for the HIP-4 model (Monte Carlo)
  types/        market data and metric types
  utils/        engines: marketDataFeed, quantMathEngine, shaakuniEngine, planAnalyzer, forecastLedger, hlMarkets, publicFeeds, cexAdapters
  data/         official macro calendar
  ui/           primitives (Panel, Stat, Badge, Segmented…) and motion tokens
  shell/        app shell, PWA (install, updates, offline)
backend/      HyperQuant scanner: liquidation map, ledger, cohorts, tape and book recorder (backend/README.md)
content/blog/ blog posts (Markdown + YAML frontmatter)
scripts/      public data fetching (GitHub Actions), ledger verifier, PWA icon generator, blog/ (blog generator: pages, RSS, sitemap, OG images, post charts and their data)
docs/BLOG.md  blog post format, safeguards, publishing
docs/STYLEGUIDE.md  colour tokens (palette validated for colour blindness), typography, chart and motion rules
```

## Limitations

- Hyperliquid's public API has no trade or order-book history. The Charts view therefore loads the last 24 hours of tape and book recorded by the scanner and keeps its own tape in the browser for a day; time covered by neither stays a visible gap. A candle whose recording is incomplete is dimmed and marked as partial, never filled with an estimate. Candles and volume have full API history (up to ~5000 candles per timeframe).
- In the Market view, Binance/Bybit funding comes from the forecast published by Hyperliquid; HIP-3 markets are proxy perps, not cash indices (they may stall outside trading hours).
- Models (Monte Carlo, OU, VPIN, Hurst) are descriptive tools; you measure their accuracy yourself in the journal.
- The volatility model sees ~208 days of history (the API returns at most ~5000 candles per timeframe); macro event multipliers are still assumptions, and adverse selection when limit orders fill is not modelled.

## Disclaimer

HyperQuant is an educational and analytical tool. It is not investment, financial or legal advice and does not generate trading signals. Trading leveraged contracts carries a high risk of losing capital.

## Contributing

Guidelines, conventions and the PR checklist: [CONTRIBUTING.md](CONTRIBUTING.md) · changelog: [CHANGELOG.md](CHANGELOG.md) · reporting vulnerabilities: [SECURITY.md](SECURITY.md). These documents are currently in Polish.

## License

MIT, see [LICENSE](LICENSE). Charts use TradingView Lightweight Charts™ by [TradingView](https://www.tradingview.com/) (Apache 2.0), see [NOTICE](NOTICE).
