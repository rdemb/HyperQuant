---
name: hyperquant
description: "Use for BTC market context on Hyperliquid from the hyperquant-mcp tools: prepare for the London or New York session, read the session in progress, review a session, check a price level, or draft a short market note for X (Twitter). Public read-only data, no advice."
---

# HyperQuant

Recipes that turn the `hyperquant-mcp` tools into everyday trader tasks for BTC: prepare for the London or New York (NY) session, read the session in progress, review a session after the close, check a price level and draft a short market note. The tools read public data only (the HyperQuant blog Day maps, Hyperliquid candles and the public files of the HyperQuant scanner) and compute the numbers with the same functions as [hyperquant.tech](https://hyperquant.tech/); values can differ slightly from the site at the same moment, because the tools read the latest 1-minute close.

**Requires** the `hyperquant-mcp` server connected to your MCP client over stdio. Setup for OpenBot, Claude Desktop and other clients is in the package README: <https://github.com/rdemb/HyperQuant/blob/main/mcp/README.md>. The tools cover BTC only and take no market argument.

## Tools

All tools are read-only. Two take an optional argument: `session_review` (`session`, either `london` or `ny`) and `market_brief` (`level`, a price level in USD). The others take none.

| Tool | Returns | Use it for |
| --- | --- | --- |
| `market_brief` | The four pre-session numbers: yesterday's clarity (MODEL; LIVE when only the map part is available), fuel within 1% below and above the price (LIVE), typical width of the next session hour (MODEL, 20-day median), price distance from the UTC-day VWAP in σ (LIVE). Also today's blog Day map levels with the previous session's VAH, POC and VAL, the session in progress and the next open. With `level`, also a `level` field: the level against the price (`fromPrice`, USD and %) and against the UTC-day VWAP (`vwapDistance`, σ), and the liquidation fuel between the price and the level (`fuelToLevel`). | Session prep, level checks, market notes |
| `session_context` | The London or NY session in progress: Initial Balance, day type so far (Dalton, MODEL), expected range and range budget (MODEL), price, UTC-day VWAP and the price distance from it in σ (LIVE), RVOL of the current hour (MODEL, median of the same New York hour over 20 days of the same type). In Asian hours `session` is null and `nextSession` gives the next open. | What is happening now |
| `day_map` | Today's blog Day map: each level, whether price has touched it since the post and at which minute, the candle coverage and the link to the post. | Level status |
| `session_review` | A London or NY session review, the rows of the site's Session review card: day type, value area migration, IB result, range against the expected range, touched blog levels, liquidations in the session, forecast cone coverage, cohort markouts. Only the latest session of each type is available. | After the close |
| `liquidation_map` | The price, fuel within 1% and 3% below and above it, the 5 largest liquidation clusters on each side, open interest coverage and the snapshot age. | Where forced flows sit |
| `liquidation_tape` | Realised liquidations of tracked positions: 1 h and 24 h sums of longs and shorts and up to 10 latest events, without addresses. | Recent forced flow |
| `cohort_flow` | Four participant cohorts (market makers, informed, whales, rest): net flow, aggressor delta, volume and volume share over the last hour and day. | Who is the net taker |
| `whales` | The largest BTC accounts under pseudonyms valid for one UTC day: the balance of longs and shorts, up to 10 largest positions and up to 10 groups of resting orders. | Large positions and orders |
| `twaps` | The share of zero-hash fills (TWAP suborders among them) in the value of the tape over the last 15 and 60 minutes of the recording, in total and per aggressor side. | TWAP flow |
| `forecast_ledger` | Scores of the verifiable HyperQuant forecast ledger: CRPSS with an interval, coverage of the 90%, 60% and ACI intervals with the Kupiec test, PIT uniformity, Brier score and BSS for level touches against the distance baseline (`bssDist`) and against the level base rate (`bss`), the cat's big move BSS against a seasonal baseline, and a link to verify them yourself. | Forecast calibration |

## How to read a response

Every tool returns one JSON envelope:

- `asOf` is the response time in ISO 8601 UTC. `sources` lists each source with its URL and its own `asOf` (null when the source did not respond).
- Every number is a `Num`: `value`, `unit`, `badge`, `why`, sometimes `method` and `note`.
  - `badge` is `LIVE` (measured from current data), `MODEL` (a model output; `method` names the model) or `SIM` (a simulation).
  - `value: null` means there is no number, and `why` says why. It never means zero.
  - `note` carries context you must keep, such as the age of a scanner snapshot older than 2 minutes or a gap in the 1m candles.
- Some fields are the site's display text: `title`, `text`, `hint`, `note` and `flag` of the four items in `market_brief`, and `label`, `value`, `why`, `hint` and `detail` of the rows in `session_review`. There "—" means no data and the reason is in `hint` or `why`.
- In `market_brief`, the `value` of clarity and of fuel is null by design: clarity is a description in `text`, and fuel keeps its two numbers in `parts`.
- `notes` holds method and coverage remarks; `disclaimer` is the fixed footer.

## Rules

1. **Numbers come only from tool responses.** Do not estimate, recall, extrapolate or compute new numbers. Comparisons are fine (above or below, inside or outside a range a tool gives); a new number is not. If the user asks for something the tools do not return, say so.
2. **Quote the badge and the time.** Give each number with its `badge` (LIVE or MODEL, and for MODEL the method) and give the response `asOf` in UTC. Keep the `note` when there is one, for example the age of a delayed scanner snapshot.
3. **Copy missing values as they are.** A null value or a "—" stays "—", followed by the reason from `why` or `hint`. Never fill a gap with a guess, an older number or a zero.
4. **No advice and no forecasts of your own.** Describe the market: levels, flows, ranges and what has happened. Give no buy or sell advice, no signals, entries, targets or stops, and no view on where price will go. The forecast ledger scores HyperQuant's recorded forecasts; quote its scores, never turn them into a call.
5. **No wallet addresses.** The tools return aggregates and day pseudonyms only. Never ask for, look up or print a wallet address or transaction hash, and never try to link a pseudonym to a wallet or a person.
6. **No account data.** The tools neither hold nor accept account data. Do not ask the user for positions, balances, keys or wallets, and do not pass any to a tool.
7. **Always end with the disclaimer** from the response: "Market description, not investment advice." The `disclaimer` field holds it in Polish and English; keep the half in the user's language.
8. **BTC only.** For another market, say that the tools cover BTC only.

### Model numbers and known gaps

- RVOL is MODEL: `session_context.rvolHour` is the current hour's volume against the median of the same New York clock hour over the last 20 days of the same type (weekdays or weekend, the weekend running from Friday 17:00 to Sunday 18:00 New York time), scaled to the elapsed part of the hour; 1 is the typical volume for that hour. Its `sample` gives `n` days, the median volume and the 80% interval of that median (bootstrap over days); `market_brief` gives the same `sample` for the typical hour width.
- Also MODEL: the day type (Dalton), the expected range, the typical day and the range budget (`method` `profile`: the hourly profile of the session from 20 days of the same type times the volatility level of the 24 h before the open, from 1h candles, fixed at the session open; `typical` is about the median, on half of the days the range stays below it), the typical hour width (median of 20 days of the same type) and the interval coverage of the forecast ledger (`cov90`, `cov60`, `covAci` and `kupiecP90` in `forecast_ledger`, and the cone row of `session_review`).
- `forecast_ledger` intervals: `crpssLo`/`crpssHi`, `bssLo`/`bssHi`, `bssDistLo`/`bssDistHi` and `bigMove.bssSeasonalLo`/`bssSeasonalHi` are the bounds of a block bootstrap over UTC days (1000 draws, the 25th and 975th value); below 7 days with data they are null and `why` gives the count. `kupiecP60` (the Kupiec test of the 60% interval, with `kupiecN60` and `cover60Disjoint`) and `pitP` (PIT uniformity, from 50 forecasts, `pitN`) use the disjoint subsample. The ACI interval has 90% coverage by construction, so `covAci` near 0.9 says nothing about accuracy; `aciInfShare` is the share of forecasts whose ACI bound is infinite. In `bigMove`, `bss` compares the cat's big move chance with the constant rate of the window and `bssSeasonal` with the rate of the same UTC hour on the previous 20 days of the same type (weekday or weekend). An older ledger summary has none of these fields: they are null with a `why`, and the other numbers stay valid.
- `twaps.share60`: when the last 60 minutes of the recording are not fully covered, its `total`, `buy` and `sell` values are null, with a reason (a recording gap or a missing zero-hash mark); `why` says how many minutes are covered. `share15` follows the same rule over 15 minutes.
- `twaps.activeCount` (the number of TWAPs running now) is always null for now: it needs a live stream that is not built yet.
- `cohort_flow`: when every cell of a cohort in the window is hidden for privacy, its `net`, `takerNet`, `volume` and `volumeShare` are null and `why` gives the number of hidden cells; never read them as zero. When only some cells are hidden, the numbers cover the visible cells and `note` says how many were hidden. The hidden cells together are in `othersCombined` (not split by cohort); `volumeShare` is measured against twice the tape volume, so the cohort shares and `othersCombined` add up to 1. When the informed cohort is empty, its `why` says "no accounts with a persistent edge detected" with the number of accounts checked; report that, not "no trades".
- A scanner snapshot older than 2 minutes keeps `badge: "LIVE"` and gets a `note` with its age. Quote the age.
- `day_map`: with a gap in the 1m candles, levels without a touch have `touched: null` (unsettled), not false, and `coverage` is below 100.
- A blog level whose label trips the server's content guards keeps its price: `label` is null with the reason in `labelWhy` (in `session_review` the label reads "[label withheld]", or "[etykieta wstrzymana]" when the server runs in Polish). Report the price and say the label was withheld.
- If a tool returns `isError` with "content blocked", the server withheld the whole response. Say so; do not retry to get around it and do not rebuild the content from elsewhere.

## Recipes

### 1. Prepare for the London or New York session

Asked as: "Prepare me for the London open", "Brief me before New York".

1. Call `market_brief`. Take `session` (in progress, next and `nextOpensAt`), the four items of `four` and the `levels` list.
2. Call `session_context` for the price, the VWAP, `vwapDistance` and the RVOL of the current hour (MODEL). If a session is already running, also take the IB, `dayTypeSoFar`, `expectedRange` and `rangeBudget`. In Asian hours `session` is null: say when the next session opens (`nextSession.opensAt`).
3. Call `day_map` to mark which blog levels price has touched since the post, and at which minute.
4. Report:
   - when the session opens (UTC), or that it is running;
   - the four items in the order of `four`: `title`, `text` and `badge`, plus `note` or `flag` when present; for an item whose `text` is "—", its `hint` as the reason;
   - the level ladder from `levels` (already sorted from the highest price), each level with its origin (blog, or the previous session's VAH, POC or VAL) and, for blog levels, the touch status from `day_map`;
   - `asOf`, the sources and the disclaimer.

### 2. What is happening now

Asked as: "What is happening in the NY session right now?", "Where are we in the session?"

1. Call `session_context`. In Asian hours (`session` is null) there is no IB, day type, expected range or range budget: say that no London or NY session is running and when the next one opens (`nextSession.opensAt`), report the price, the VWAP, `vwapDistance` and RVOL (MODEL), then carry on with steps 2 to 4, since flow continues between sessions.
2. Call `liquidation_tape` for the 1 h sums of longs and shorts and the latest events.
3. Call `cohort_flow` and read the `h1` window: `takerNet` shows which cohort is the net aggressor, `net` its inventory change.
4. Call `twaps` for `share15` and `share60`.
5. If the user asks about fuel or clusters, call `liquidation_map`.
6. Report in this order: session and IB status; range used (`rangeBudget`, MODEL) against the expected range (MODEL); price against the VWAP in σ; RVOL (MODEL); the last hour of flow (cohorts, liquidations, TWAP share). Ten lines at most.

### 3. Review the last session

Asked as: "How did the London session go?", "Review the last NY session." This reviews the market session, not the user's trades.

1. Call `session_review`. Pass `session: "london"` or `session: "ny"` when the user names one; without it the tool reviews the last closed session. Only the latest session of each type is available; compare `session.opensAt` with the session the user named and say so when an older one is asked for.
2. If `session.inProgress` is true, say that the session is still running and the rows describe it so far.
3. Report the `rows` in the order given: `label`, `value` and `badge` (for MODEL rows, the method from `hint`), then `detail` when present. A row whose `value` is "—" gets its `why` or `hint`. Rows with `scope: "window"` cover a different data window (the forecast cone: 30 days of the ledger; cohorts: the last 24 h); say so.
4. If the user asks, add `day_map` for the minute of each touch on today's Day map and `forecast_ledger` for the scores behind the cone row.

### 4. Check a price level

Asked as: "What sits around 100,000?", "Check this level for me."

1. Call `market_brief` with `level` set to the price the user named, for example `market_brief({ level: 100000 })`.
2. Read the `level` field:
   - `fromPrice.usd` and `fromPrice.pct`: the level against the current price (LIVE);
   - `vwapDistance`: the level against the UTC-day VWAP, in σ (LIVE);
   - `fuelToLevel`: USD of liquidations between the price and the level, on the level's side (LIVE, with the snapshot age note when there is one). It is null with a reason when the level is more than 20% from the price, outside the liquidation map's range or equal to the price; never report it as 0.
3. From the same response, take the typical width of the next session hour (the `hourWidth` item, MODEL) and the tool levels just above and just below the level in `levels`.
4. If the user wants the clusters themselves, call `liquidation_map` for the cluster prices and USD on each side. If the level matches a level of today's Day map, call `day_map` to see whether price has touched it.
5. Report the level, its distance from the price (USD and %) and from the VWAP (σ), the fuel up to it, the typical width of the next session hour and the nearest tool levels around it, each number with its badge. Do not compute any other distance or ratio.

### 5. Short market note for X (Twitter)

Asked as: "Write a short post about BTC for X."

1. Call `market_brief`; during a session also call `session_context`.
2. Pick two to four numbers, each marked with its badge, for example "(MODEL)".
3. Facts from the responses only: no direction, no advice, no hype, and no hashtags or emoji unless the user asks.
4. End with the footer in the post's language; in English: "Data: hyperquant.tech, {HH:MM} UTC. Market description, not investment advice." Take the time from `asOf`. Keep the whole post within 280 characters, footer included.
5. Show the draft to the user. Never post it yourself.

## Response format

- Answer in the user's language. Tool texts follow the server's `HQ_LANG` (en or pl); translate them faithfully when needed.
- Start with one line that says what the answer is and the data time, for example "London pre-session, data as of {HH:MM} UTC".
- One number per line: `{name}: {value} {unit} ({badge}, {method})`, plus `; {note}` when there is one. A missing value: `{name}: — ({reason})`.
- Units: `usd` and `price` in USD (large amounts may be shortened, such as 3.4M); `btc` in BTC; `sigma` as σ; `pct` as a percentage; `count` as a plain count; `min` in minutes; `ratio` is a fraction or a multiple: show leverage and RVOL (MODEL) as multiples (25×, 1.4×), shares (`oiCoverage`, `volumeShare`, `share15` and `share60`, `rangeBudget`) as percentages, and scores and p-values (CRPSS, Brier, BSS, Kupiec) as plain decimals. Give the touch BSS of `forecast_ledger` only as a pair, distance baseline first: `bssDist` (reflection formula with a constant σ of 30-day hourly returns) and `bss` (level base rate); the base rate ignores how far the level is, so on its own it overstates skill. If `bssDist` is null, give neither.
- Times: from `asOf` and the other ISO UTC fields, shortened to HH:MM UTC when the date is clear.
- Close with a "Sources" line (source names with their `asOf`) and the disclaimer.

Skeleton:

```text
{Session} pre-session, data as of {HH:MM} UTC
Session: {London|NY} opens {HH:MM} UTC
Clarity yesterday: {text} ({badge})
Fuel within 1%: {below} USD below, {above} USD above (LIVE)
Typical width of the {HH:MM} hour: {value} USD (MODEL, 20-day median)
From VWAP: {value} σ (LIVE)
Levels: {price} {origin} [{touched at HH:MM | not touched | unsettled}], ...
Sources: {name} {asOf}, ...
Market description, not investment advice.
```
