---
name: hyperquant
description: "Use for BTC market context on Hyperliquid from the hyperquant-mcp tools: prepare for the London or New York session, read the session in progress, review a session, check a price level, or draft a short market note for X. Public read-only data, no advice."
---

# HyperQuant

Recipes that turn the `hyperquant-mcp` tools into everyday trader tasks for BTC: prepare for a session, read the session in progress, review a session after the close, check a price level and draft a short market note. The tools read public data only (the HyperQuant blog day maps, Hyperliquid candles and the public files of the HyperQuant scanner) and compute the numbers with the same functions as [hyperquant.tech](https://hyperquant.tech/).

**Requires** the `hyperquant-mcp` server connected to your MCP client over stdio. Setup for OpenBot, Claude Desktop and other clients is in the package README: <https://github.com/rdemb/HyperQuant/blob/main/mcp/README.md>. The tools cover BTC only and take no market argument.

## Tools

All tools are read-only. Only `session_review` takes an argument: `session`, either `london` or `ny` (optional).

| Tool | Returns | Use it for |
| --- | --- | --- |
| `market_brief` | The four pre-session numbers: yesterday's clarity (MODEL), fuel within 1% below and above the price (LIVE), typical width of the next session hour (MODEL, 20-day median), price distance from the UTC-day VWAP in σ (LIVE). Also today's blog Day map levels with the previous session's VAH, POC and VAL, the session in progress and the next open. | Session prep, level checks, market notes |
| `session_context` | The London or NY session in progress: Initial Balance, day type so far (Dalton, MODEL), expected range and range budget (MODEL), price, UTC-day VWAP and the price distance from it in σ (LIVE), RVOL of the current hour (MODEL, 20-day median). In Asian hours `session` is null and `nextSession` gives the next open. | What is happening now, level checks |
| `day_map` | Today's blog Day map: each level, whether price has touched it since the post and at which minute, the candle coverage and the link to the post. | Level status |
| `session_review` | A London or NY session review, the rows of the site's Session review card: day type, value area migration, IB result, range against the expected range, touched blog levels, liquidations in the session, forecast cone coverage, cohort markouts. | After the close |
| `liquidation_map` | The price, fuel within 1% and 3% below and above it, the 5 largest liquidation clusters on each side, open interest coverage and the snapshot age. | Where forced flows sit |
| `liquidation_tape` | Realised liquidations of tracked positions: 1 h and 24 h sums of longs and shorts and up to 10 latest events, without addresses. | Recent forced flow |
| `cohort_flow` | Four participant cohorts (market makers, informed, whales, rest): net flow, aggressor delta, volume and volume share over the last hour and day. | Who is the net taker |
| `whales` | The largest BTC accounts under pseudonyms valid for one UTC day: the balance of longs and shorts, up to 10 largest positions and up to 10 groups of resting orders. | Large positions and orders |
| `twaps` | The share of zero-hash fills (TWAP suborders among them) in the value of the tape over the last 15 and 60 minutes of the recording, in total and per aggressor side. | TWAP flow |
| `forecast_ledger` | Scores of the verifiable HyperQuant forecast ledger: CRPSS, coverage of the 90%, 60% and ACI intervals with the Kupiec test, Brier score and BSS for level touches, and a link to verify them yourself. | Forecast calibration |

## How to read a response

Every tool returns one JSON envelope:

- `asOf` is the response time in ISO 8601 UTC. `sources` lists each source with its URL and its own `asOf` (null when the source did not respond).
- Every number is a `Num`: `value`, `unit`, `badge`, `why`, sometimes `method` and `note`.
  - `badge` is `LIVE` (measured from current data), `MODEL` (a model output; `method` names the model) or `SIM` (a simulation).
  - `value: null` means there is no number, and `why` says why. It never means zero.
  - `note` carries context you must keep, such as the age of a scanner snapshot older than 2 minutes or a gap in the 1m candles.
- Some fields are the site's display text: `title`, `text`, `hint`, `note` and `flag` of the four items in `market_brief`, and `label`, `value`, `why`, `hint` and `detail` of the rows in `session_review`. There "—" means no data and the reason is in `hint` or `why`.
- In `market_brief`, clarity is a description, not a number: its `value` is null by design and its content is `text` (MODEL). Fuel keeps its two numbers in `parts`.
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

- RVOL is MODEL: `session_context.rvolHour` is the current hour's volume against the 20-day median of the same hour, scaled to the elapsed part of the hour; 1 is the typical volume for that hour.
- Also MODEL: the day type (Dalton), the expected range and the range budget (HAR volatility model, or Parkinson σ from 5m candles when the model is unavailable; `method` says which) and the typical hour width (20-day median).
- `twaps.share60` is null when the last 60 minutes of the tape recording have a gap; `why` says how many minutes are covered. `share15` follows the same rule over 15 minutes.
- `twaps.activeCount` (the number of TWAPs running now) is always null for now: it needs a live stream that is not built yet.
- A scanner snapshot older than 2 minutes keeps `badge: "LIVE"` and gets a `note` with its age. Quote the age.
- `day_map`: with a gap in the 1m candles, levels without a touch have `touched: null` (unsettled), not false, and `coverage` is below 100.
- A blog level whose label trips the server's content guards keeps its price: `label` is null with the reason in `labelWhy` (in `session_review` the label reads "[label withheld]"). Report the price and say the label was withheld.
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

1. Call `session_context`. If `session` is null (Asian hours), say that no London or NY session is running, give `nextSession.opensAt` and report only the price, VWAP, `vwapDistance` and RVOL (MODEL).
2. Call `liquidation_tape` for the 1 h sums of longs and shorts and the latest events.
3. Call `cohort_flow` and read the `h1` window: `takerNet` shows which cohort is the net aggressor, `net` its inventory change.
4. Call `twaps` for `share15` and `share60`.
5. If the user asks about fuel or clusters, call `liquidation_map`.
6. Report in this order: session and IB status; range used (`rangeBudget`, MODEL) against the expected range (MODEL); price against the VWAP in σ; RVOL (MODEL); the last hour of flow (cohorts, liquidations, TWAP share). Ten lines at most.

### 3. Review the last session

Asked as: "How did the London session go?", "Review yesterday's NY session." This reviews the market session, not the user's trades.

1. Call `session_review`. Pass `session: "london"` or `session: "ny"` when the user names one; without it the tool reviews the last closed session.
2. If `session.inProgress` is true, say that the session is still running and the rows describe it so far.
3. Report the `rows` in the order given: `label`, `value` and `badge` (for MODEL rows, the method from `hint`), then `detail` when present. A row whose `value` is "—" gets its `why` or `hint`. Rows with `scope: "window"` cover a different data window (the forecast cone: 30 days of the ledger; cohorts: the last 24 h); say so.
4. If the user asks, add `day_map` for the minute of each touch on today's map and `forecast_ledger` for the scores behind the cone row.

### 4. Check a price level

Asked as: "What sits around level X?", "Check X for me."

1. Call `session_context` for the price, the VWAP (its `note` gives σ in USD) and `vwapDistance` (σ, LIVE).
2. Call `market_brief` for the fuel within 1% (LIVE), the typical width of the next session hour (MODEL) and the `levels` list.
3. Call `liquidation_map` for the clusters on each side (price and USD) and the fuel within 3%.
4. If X matches a level of today's blog map, call `day_map` to see whether price has touched it.
5. Report:
   - where X sits: above or below the price and the VWAP, the tool levels just above and just below X, and the clusters between the price and X;
   - the context numbers from steps 1 to 3, each with its badge;
   - that the tools give the σ distance for the current price only. Do not compute a σ or USD distance for X.

### 5. Short market note for X

Asked as: "Write a short post about BTC for X."

1. Call `market_brief`; during a session also call `session_context`.
2. Pick two to four numbers, each marked with its badge, for example "(model)".
3. Facts from the responses only: no direction, no advice, no hype, and no hashtags or emoji unless the user asks.
4. Keep the whole post within 280 characters, including the footer: "Data: hyperquant.tech, {HH:MM} UTC. Market description, not investment advice." Take the time from `asOf`.
5. Show the draft to the user. Never post it yourself.

## Response format

- Answer in the user's language. Tool texts follow the server's `HQ_LANG` (en or pl); translate them faithfully when needed.
- Start with one line that says what the answer is and the data time, for example "London pre-session, data as of {HH:MM} UTC".
- One number per line: `{name}: {value} {unit} ({badge}, {method})`, plus `; {note}` when there is one. A missing value: `{name}: — ({reason})`.
- Units: `usd` and `price` in USD (large amounts may be shortened, such as 3.4M); `btc` in BTC; `sigma` as σ; `ratio` as a fraction where 1 is 100% (you may show it as a percentage); `pct` as a percentage; `count` as a plain count; `min` in minutes.
- Times: from `asOf` and the other ISO UTC fields, shortened to HH:MM UTC when the date is clear.
- Close with a "Sources" line (source names with their `asOf`) and the disclaimer.

Skeleton:

```text
{Session} pre-session, data as of {HH:MM} UTC
Session: {London|NY} opens {HH:MM} UTC
Clarity yesterday: {text} (MODEL)
Fuel within 1%: {below} USD below, {above} USD above (LIVE)
Typical width of the {HH:MM} hour: {value} USD (MODEL, 20-day median)
From VWAP: {value} σ (LIVE)
Levels: {price} {origin} [{touched at HH:MM | not touched | unsettled}], ...
Sources: {name} {asOf}, ...
Market description, not investment advice.
```
