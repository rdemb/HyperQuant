# Schrödi

Schrödi is the cat under the chart in the **Charts** tab. Every five minutes it gives two probabilities for BTC over the
next hour: the chance of a **big move** and the chance that the price ends the hour **higher**. It also lists the nearest
auction levels and the next high-impact macro release.

The cat is drawn as Schrödinger's cat: a green (Long) and an orange (Short) outline in superposition, each as bright as
its probability. The closer the forecast is to 50%, the more the two outlines drift apart and blur. Above about 60% on
one side the cat collapses into a single colour.

Everything runs in the visitor's browser from public Hyperliquid candles. There is no server-side signal and no account.

**This is not investment advice.** The direction forecast is only slightly better than a coin flip; see
[Direction](#direction) for what that means after costs.

## What it predicts

The forecast is made at the close of each 5-minute candle (time `t`, the open of the last closed 5m candle, so the
forecast is issued at `t + 5 min`).

| Head | Target | Base rate |
| --- | --- | --- |
| Big move | High-low range of the 1m candles from `t + 5` to `t + 64` min is larger than the median range of the last 720 complete 1h candles (about 30 days) | 48 to 49% |
| Direction | Log return from the close of the 5m candle to the close of minute `t + 64` is positive | 50 to 51% |

The panel shows the big-move threshold in dollars (`price × (e^median − 1)`), so "big" always means the current
30-day median hourly range.

## Features

22 features, computed identically in training (Python) and live (`src/utils/schrodi.ts`). Returns are in basis points
of log price; distances to levels are divided by the median daily range of the last 30 days.

| Group | Features |
| --- | --- |
| Move | `ret_15m`, `ret_1h`, `ret_4h`, `ret_1d` |
| Volatility | `rv_1h`, `rv_1d` (realised volatility of 5m returns), `rng4h_rel` (4h range over the 30-day median daily range), `vol_z` (z-score of the 5m candle's log dollar volume against the last 7 days) |
| Auction and levels | `dist_vwap` (daily VWAP from 00:00 UTC), `day_pos` (position in the day's range), `dist_pdh`, `dist_pdl` (previous day high and low), `dist_poc`, `dist_vah`, `dist_val`, `above_va` (previous day volume profile, 5 bp log bins, 70% value area) |
| Clock and calendar | `ny_hour`, `ldn_hour`, `dow`, `min_to_event`, `min_since_event` (FOMC, CPI, NFP), `expiry_pre` (last Friday of the month before the 08:00 UTC monthly options expiry) |

Order flow, funding, open interest, liquidations and options were tested in earlier stages and did not improve the
direction forecast out of sample, so v1 uses candles only. That keeps the live model honest: it sees exactly what it was
trained on.

## Model

Each head is the average of two models:

- **Logistic regression**, L2 with `C = 0.1`, on standardised features clipped to ±5 (missing values set to 0), plus
  one-hot New York hour (24) and weekday (7).
- **LightGBM**, 300 trees, learning rate 0.03, 15 leaves, min 400 rows per leaf, feature fraction 0.7, bagging 0.7,
  L2 10, seed 7.

The final model (`public/schrodi/model-v1.json`, version `schrodi-v1`) is trained on BTCUSDT perpetual 1m candles from
the public Binance data archive, January 2022 to 24 October 2026, on every third 5-minute row. Live features come from
Hyperliquid candles. Both are BTC perpetuals that move together; volume features are relative (z-score and profile
shape), so the difference in venue size largely cancels out.

The browser evaluates the regression and the trees directly from the JSON file. A synthetic test fixture checks that the
TypeScript features match the Python ones to 6 decimal places and the model output to 9
(`src/utils/__tests__/schrodi.test.ts`).

### Why?

The panel splits the direction forecast into four groups (move, volatility, auction, clock) in percentage points. For
the regression this is `coef × z` per feature, for the trees the Saabas decomposition (the change in node value assigned
to the split feature). Both are converted from log-odds to points with the local slope `50 × p × (1 − p)` and summed per
group. It is an approximation, which the panel says.

## Validation

Quarterly walk-forward: for every quarter from 2023 Q1, the models are trained on all data from January 2022 up to one
day before the quarter starts (1-day embargo) and scored on that quarter. 2026 is a holdout: all thresholds were fixed on
2023 to 2025 before looking at it.

### Big move

| Period | Rows | AUC | Accuracy | Big move when in the top 20% of forecasts | Big move when in the bottom 20% |
| --- | --- | --- | --- | --- | --- |
| 2023 to 2025 | 315 648 | 0.837 | 75.3% | 92.1% | 11.2% |
| 2026 (to October) | 85 488 | 0.827 | 74.5% | 90.0% | 10.6% |

AUC stayed between 0.80 and 0.88 in all 16 quarters. Log loss is 27 to 28% better than the base rate.

For comparison, simple baselines on the same rows (AUC, 2023 to 2025 / 2026): last hour's realised volatility alone
0.768 / 0.768, 4h range alone 0.774 / 0.762, hour of day (frequencies from 2022) 0.652 / 0.624. Most of the skill is
volatility clustering and the session clock; the model adds about 6 AUC points on top of the best single feature.

Calibration (mean forecast vs observed frequency, deciles, 2023 to 2026):

| Forecast | 8% | 16% | 23% | 30% | 37% | 46% | 56% | 68% | 81% | 93% |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Observed | 6% | 17% | 25% | 32% | 41% | 49% | 62% | 75% | 87% | 97% |

### Direction

| Period | AUC | Accuracy | Long (p ≥ 53%): share, hit rate | Short (p ≤ 47%): share, hit rate |
| --- | --- | --- | --- | --- |
| 2023 to 2025 | 0.544 | 53.0% | 29%, 55.1% | 28%, 54.0% |
| 2026 (to October) | 0.535 | 52.3% | 27%, 53.8% | 20%, 54.5% |

Between 47% and 53% the cat says it does not know (43% of the time in 2023 to 2025, 54% in 2026). AUC was above 0.52 in
all 16 quarters, but the edge is small. In the most confident 10% of forecasts the hit rate was 58% to 59%, with an
average gross move of 1 to 4 bp per trade. After a 3 bp maker round trip that is negative in 2023 to 2025 and +1.3 bp in
2026; after a 10 bp taker round trip it is negative in both. **The direction alone is not a trading edge.**

Before v1, about 230 model and rule configurations were tested on the same history (order flow, derivatives, options,
triple-barrier labels, meta-labelling). Probability of backtest overfitting (CSCV) was 0.09, but the deflated Sharpe
ratio of the best one was at most 0.18 and Benjamini–Hochberg found no significant rule in 2026. A "sure shot" mode was
therefore not built.

Direction calibration (deciles): forecasts of 42% to 59% matched observed frequencies of 44% to 58%.

## Files

| Path | Role |
| --- | --- |
| `src/utils/schrodi.ts` | Features, model evaluation, forecast (no React, shared with the scanner) |
| `public/schrodi/model-v1.json` | Model weights, trees and the validation card shown in the panel |
| `src/components/schrodi/` | Cat, launcher button, panel, data hook |
| `src/utils/__tests__/schrodi.test.ts` | Parity tests against the Python reference on a synthetic fixture |
