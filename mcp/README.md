# hyperquant-mcp

An MCP server that gives an AI assistant read-only BTC market context from public data: the HyperQuant blog day maps, Hyperliquid candles and the public files of the HyperQuant scanner. The numbers come from the same functions that compute them on [hyperquant.tech](https://hyperquant.tech/), so the assistant and the site report the same values.

Market description, not investment advice. No keys, no accounts, no trading, no orders.

## Status

- Version 0.1.0, stdio transport only.
- The package is not published on npm yet. The `npx -y hyperquant-mcp` commands below work only after the first npm release, and the package name can still change before then. Until then, run the server from the repository (next section).
- A Streamable HTTP mode (a hosted endpoint you connect to by URL) is planned, not built.
- `twaps.activeCount` (the number of TWAPs running now) needs a live stream, so for now it is always `null` with a reason.

## Run from the repository

Requires Node.js 20 or later.

```sh
git clone https://github.com/rdemb/HyperQuant.git
cd HyperQuant
npm ci --legacy-peer-deps
npm run mcp:build
node mcp/dist/hyperquant-mcp.mjs
```

The last command starts the server on stdin/stdout and waits for an MCP client. In a client, use the command `node` with the absolute path of `mcp/dist/hyperquant-mcp.mjs` as its argument.

## Install (after the npm release)

```sh
npx -y hyperquant-mcp
```

## Configure a client

### OpenBot

In OpenBot, open Marketplace → Apps, add your own app and choose the STDIO transport:

- command: `npx`
- arguments: `-y hyperquant-mcp`
- optional environment: `HQ_LANG=en` (or `pl`), `HQ_TZ=UTC`

From a repository checkout, use the command `node` and the argument `/path/to/HyperQuant/mcp/dist/hyperquant-mcp.mjs`.

### Claude Desktop

Add the server to `claude_desktop_config.json` (Settings → Developer → Edit Config) and restart Claude Desktop:

```json
{
  "mcpServers": {
    "hyperquant": {
      "command": "npx",
      "args": ["-y", "hyperquant-mcp"],
      "env": { "HQ_LANG": "en", "HQ_TZ": "UTC" }
    }
  }
}
```

From a repository checkout: `"command": "node"`, `"args": ["/path/to/HyperQuant/mcp/dist/hyperquant-mcp.mjs"]`.

### Any other MCP client

Any client that launches stdio servers works: command `npx`, arguments `-y hyperquant-mcp` (or `node` with the bundle path). The server reads requests on stdin and writes only MCP messages on stdout; its logs go to stderr.

## Tools

All tools are read-only and take no arguments, except `session_review` (optional `session`: `london` or `ny`).

| Tool | What it returns | Example question |
| --- | --- | --- |
| `market_brief` | The pre-session brief of the site's Pre-session screen: the four numbers (yesterday's clarity: day type of the last NY session and the hits of its blog map, MODEL; fuel ±1%: USD of liquidations within 1% below and above the price, LIVE; typical width of the next session hour, MODEL, 20-day median; price distance from the UTC-day VWAP in σ, LIVE), today's blog Day map levels, the previous session's VAH, POC and VAL, the session in progress and the next open. | "Prepare me for the London open." |
| `day_map` | Today's blog Day map levels, whether price has touched each one since the post (Hyperliquid 1m candles) and at which minute, the candle coverage and the link to the post. | "Which levels of today's day map have been hit?" |
| `session_context` | The London or NY session in progress: Initial Balance, day type so far (Dalton, MODEL), expected session range and range budget (MODEL: HAR or Parkinson), UTC-day VWAP and the σ distance from it, RVOL of the current hour (MODEL: 20-day median). In Asian hours `session` is null and the next open is given. | "What is happening in the NY session right now?" |
| `session_review` | A London or NY session review, the rows of the site's Session review card: day type, value area migration, IB result, range against the expected range, touched blog levels, liquidations in the session, forecast cone coverage, cohort markouts. | "How did yesterday's NY session go?" |
| `liquidation_map` | The scanner's liquidation map: fuel within 1% and 3% below and above the price, the 5 largest clusters on each side, open interest coverage and the snapshot age. | "Where are the liquidation clusters around the price?" |
| `liquidation_tape` | Realised liquidations of tracked positions: 1 h and 24 h sums of longs and shorts and up to 10 latest events, without addresses. | "Were there large liquidations in the last hour?" |
| `cohort_flow` | Four participant cohorts (market makers, informed, whales, rest): net flow, aggressor delta, volume and volume share over the last hour and day. | "Which cohort has been the net taker in the last hour?" |
| `whales` | The largest Hyperliquid BTC accounts under pseudonyms valid for one UTC day: long and short balance, up to 10 largest positions and up to 10 groups of resting orders. | "What are the largest BTC positions right now?" |
| `twaps` | The share of zero-hash fills (TWAP suborders among them) in the value of the tape over the last 15 and 60 minutes of the recording, in total and per aggressor side. | "How much of the tape is TWAP flow?" |
| `forecast_ledger` | Scores of the verifiable HyperQuant forecast ledger: CRPSS, coverage of the 90%, 60% and ACI intervals with the Kupiec test, Brier score and BSS for level touches, and a link to verify them yourself. | "How well calibrated are the HyperQuant forecasts?" |

## Data rules

- **Read-only public data.** No keys, accounts, trading, orders or trade signals.
- **Every number is a `Num`:** `{ value, unit, badge, why }`, sometimes with `method` and `note`. `badge` is `LIVE` (measured from current data), `MODEL` (a model output, with the method named) or `SIM` (a simulation). Missing data is `value: null` with the reason in `why`, never 0 or a placeholder.
- **Every response is an envelope:** `tool`, `coin: "BTC"`, `asOf` (ISO 8601 UTC), `data`, `sources[]` (name, URL and the source's own `asOf`), `notes` and a fixed `disclaimer`.
- **Scanner snapshot age:** a snapshot older than 2 minutes keeps `badge: "LIVE"` and gets a `note` with its age; it never poses as fresh.
- **RVOL is MODEL:** `session_context.rvolHour` is the current hour's volume against the 20-day median of the same hour, as on the site.
- **`twaps.share60` is null** when the last 60 minutes of the tape recording have a gap (the same rule as the site); the reason states how many minutes are covered.
- **Privacy:** aggregates and day pseudonyms only, never wallet addresses or transaction hashes. Every response passes the site's content guards (privacy and trade-call patterns) and an address pattern; a hit returns `isError` with the reason and no content. A blog level whose label trips the guards keeps its price, with `label: null` and the reason in `labelWhy`.
- **BTC only:** the scanner records BTC, so the tools take no market argument.
- **Network:** a 10 s timeout per request; an in-process cache (scanner files and candles 60 s, blog maps 5 min, volatility model 15 min, a failed request 30 s, HTTP 429 60 s); the header `User-Agent: hyperquant-mcp/0.1.0` and nothing about the user.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `HQ_LANG` | `en` | Language of titles, hints, reasons and notes: `en` or `pl`. |
| `HQ_TZ` | `UTC` | Time zone of clock times inside texts (hints, reasons). Structured time fields are always ISO 8601 UTC. |
| `HQ_DATA_BASE` | `https://raw.githubusercontent.com/rdemb/hyperquant-data/main` | Scanner data repository; the tape history branch is derived from it (`…/main` → `…/history`). http(s) only, without user name, password, query or fragment. Use a host name: an IP address in the URL would trip the privacy guard on every response. |
| `HQ_SITE_BASE` | `https://hyperquant.tech` | Site that serves `blog/maps.json`. Same rules as `HQ_DATA_BASE`. |

## Data sources

- Blog day maps: `https://hyperquant.tech/blog/maps.json`
- Hyperliquid candles: `https://api.hyperliquid.xyz/info` (`candleSnapshot`, BTC 1m, 5m, 1h)
- Scanner files: `https://raw.githubusercontent.com/rdemb/hyperquant-data/main/` (`liq-map/BTC.json`, `liq-tape/BTC.json`, `cohorts/BTC.json`, `whales.json`, `ledger/BTC/summary.json`)
- Tape recordings: `https://raw.githubusercontent.com/rdemb/hyperquant-data/history/` (`index.json` and the BTC trade files)

## Development

```sh
npm run mcp:build                                              # bundle: mcp/dist/hyperquant-mcp.mjs
node mcp/scripts/stdio-smoke.mjs mcp/dist/hyperquant-mcp.mjs   # initialize + tools/list over real stdio, no network
npx vitest run mcp                                             # tests with synthetic data and a fake fetch
```

## License

MIT, see [LICENSE](LICENSE).

## Polski

Serwer MCP HyperQuant: kontekst rynku BTC z danych publicznych (mapy z bloga HyperQuant, świece Hyperliquid, pliki skanera), liczony tymi samymi funkcjami co strona hyperquant.tech. Tylko odczyt, bez kluczy i kont; opis rynku, nie porada inwestycyjna.

- Stan: paczki nie ma jeszcze w npm. Dziś uruchomisz ją z repozytorium: `npm ci --legacy-peer-deps`, `npm run mcp:build`, potem `node mcp/dist/hyperquant-mcp.mjs`. Tryb HTTP jest w planach.
- Teksty po polsku: `HQ_LANG=pl`. Strefa czasu godzin w tekstach: `HQ_TZ` (domyślnie UTC).
- Każda liczba ma oznaczenie LIVE, MODEL albo SIM, czas i źródło; brak danych to `null` z powodem.
- Narzędzia, konfiguracja klientów i zasady danych: jak w części angielskiej wyżej.
