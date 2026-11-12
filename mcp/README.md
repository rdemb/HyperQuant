# hyperquant-mcp

An MCP server that gives an AI assistant read-only BTC market context from public data: the HyperQuant blog day maps, Hyperliquid candles and the public files of the HyperQuant scanner. The numbers come from the same functions and method as on [hyperquant.tech](https://hyperquant.tech/), but the price is the last 1-minute close (candles up to 60 s old), so values can differ slightly from the site at the same moment.

Market description, not investment advice. No keys, no accounts, no trading, no orders.

## Status

- Version 0.1.4, stdio transport only.
- The package is published on npm as `hyperquant-mcp`: install and run it with `npx -y hyperquant-mcp@0.1.4` (next section). Claude Desktop can also install the `.mcpb` file (see Claude Desktop below), and the server can be built from source (see From source).
- A Streamable HTTP mode (a hosted endpoint you connect to by URL) is planned, not built.
- `twaps.activeCount` (the number of TWAPs running now) needs a live stream, so for now it is always `null` with a reason.

## Install

Requires Node.js 20 or later.

```sh
npx -y hyperquant-mcp@0.1.4
```

The command downloads the package, starts the server on stdin/stdout and waits for an MCP client. Keep the version in the command: `npx` then runs exactly that release, not whatever is newest on npm. In a client, use the command `npx` with the arguments `-y hyperquant-mcp@0.1.4`.

## Configure a client

### OpenBot

In OpenBot, open Marketplace → Apps, add your own app and choose the STDIO transport:

- command: `npx`
- arguments: `-y hyperquant-mcp@0.1.4`
- optional environment: `HQ_LANG=en` (or `pl`), `HQ_TZ=UTC`

From source (see below), use the command `node` and the argument `/path/to/HyperQuant/mcp/dist/hyperquant-mcp.mjs`.

### Claude Desktop

The simplest way is the `.mcpb` file, with no terminal: download <https://hyperquant.tech/agents/hyperquant.mcpb> and double-click it, and Claude Desktop shows the install dialog. The server and its dependencies are inside the file, and Node.js ships with Claude Desktop. The site shows the file's SHA-256 next to the download button (the same checksum is in `hyperquant.mcpb.sha256` next to the file), so you can compare it with the downloaded file.

To configure it by hand instead, add the server to `claude_desktop_config.json` (Settings → Developer → Edit Config) and restart Claude Desktop:

```json
{
  "mcpServers": {
    "hyperquant": {
      "command": "npx",
      "args": ["-y", "hyperquant-mcp@0.1.4"],
      "env": { "HQ_LANG": "en", "HQ_TZ": "UTC" }
    }
  }
}
```

From source: `"command": "node"`, `"args": ["/path/to/HyperQuant/mcp/dist/hyperquant-mcp.mjs"]`.

### Any other MCP client

Any client that launches stdio servers works: command `npx`, arguments `-y hyperquant-mcp@0.1.4` (or `node` with the bundle path, see From source). The server reads requests on stdin and writes only MCP messages on stdout; its logs go to stderr.

## From source

To run the server without the npm package, build it from the repository. Requires Node.js 20 or later.

```sh
git clone https://github.com/rdemb/HyperQuant.git
cd HyperQuant
npm ci --legacy-peer-deps
npm run mcp:build
node mcp/dist/hyperquant-mcp.mjs
```

The last command starts the server on stdin/stdout and waits for an MCP client. In a client, use the command `node` with the absolute path of `mcp/dist/hyperquant-mcp.mjs` as its argument. On Windows, write that path in JSON with forward slashes (`C:/path/to/HyperQuant/…`) or doubled backslashes.

## Tools

All tools are read-only. Two take an optional argument: `session_review` (`session`: `london` or `ny`) and `market_brief` (`level`: a price level in USD); the others take none.

| Tool | What it returns | Example question |
| --- | --- | --- |
| `market_brief` | The pre-session brief of the site's Pre-session screen: the four numbers (yesterday's clarity: day type of the last NY session and the hits of its blog map, MODEL; fuel ±1%: USD of liquidations within 1% below and above the price, LIVE; typical width of the next session hour, MODEL, 20-day median; price distance from the UTC-day VWAP in σ, LIVE), today's blog Day map levels, the previous session's VAH, POC and VAL, the session in progress and the next open. With `level`, also the level against the price (`fromPrice`: USD and %), against the UTC-day VWAP in σ (`vwapDistance`) and the liquidation fuel between the price and the level (`fuelToLevel`, LIVE; null with a reason beyond 20% from the price or outside the map range). | "Prepare me for the London open." / "What sits around 100,000?" |
| `day_map` | Today's blog Day map levels, whether price has touched each one since the post (Hyperliquid 1m candles) and at which minute, the candle coverage and the link to the post. | "Which levels of today's Day map has price touched?" |
| `session_context` | The London or NY session in progress: Initial Balance, day type so far (Dalton, MODEL), expected (mean) session range, typical day and range budget (MODEL: hourly profile × volatility level, from 1h candles, fixed at the session open), UTC-day VWAP and the σ distance from it, RVOL of the current hour (MODEL: median of the same New York hour over 20 days of the same type). In Asian hours `session` is null and the next open is given. | "What is happening in the NY session right now?" |
| `session_review` | A London or NY session review, the rows of the site's Session review card: day type, value area migration, IB result, range against the expected range, touched blog levels, liquidations in the session, forecast cone coverage, cohort markouts. Only the latest session of each type is available. | "How did the last NY session go?" |
| `liquidation_map` | The scanner's liquidation map: fuel within 1% and 3% below and above the price, the 5 largest clusters on each side, open interest coverage and the snapshot age. | "Where are the liquidation clusters around the price?" |
| `liquidation_tape` | Realised liquidations of tracked positions: 1 h and 24 h sums of longs and shorts and up to 10 latest events, without addresses. | "Were there large liquidations in the last hour?" |
| `cohort_flow` | Four participant cohorts (market makers, informed, whales, rest): net flow, aggressor delta, volume and volume share over the last hour and day. A cohort whose cells are all hidden for privacy has these numbers null with the count of hidden cells; when only some are hidden, a `note` gives the count. | "Which cohort has been the net taker in the last hour?" |
| `whales` | The largest Hyperliquid BTC accounts under pseudonyms valid for one UTC day: long and short balance, up to 10 largest positions and up to 10 groups of resting orders. | "What are the largest BTC positions right now?" |
| `twaps` | The share of zero-hash fills (TWAP suborders among them) in the value of the tape over the last 15 and 60 minutes of the recording, in total and per aggressor side. | "How much of the tape is TWAP flow?" |
| `forecast_ledger` | Scores of the verifiable HyperQuant forecast ledger: CRPSS, coverage of the 90%, 60% and ACI intervals with the Kupiec test (MODEL, like the cone row of `session_review`), Brier score and BSS for level touches against the distance baseline (`bssDist`, reflection formula with a 30-day hourly σ) and against the level base rate (`bss`), and a link to verify them yourself. | "How well calibrated are the HyperQuant forecasts?" |

## Data rules

- **Read-only public data.** No keys, accounts, trading, orders or trade signals.
- **Every number is a `Num`:** `{ value, unit, badge, why }`, sometimes with `method` and `note`. `badge` is `LIVE` (measured from current data), `MODEL` (a model output, with the method named) or `SIM` (a simulation). Missing data is `value: null` with the reason in `why`, never 0 or a placeholder.
- **Every response is an envelope:** `tool`, `coin: "BTC"`, `asOf` (ISO 8601 UTC), `data`, `sources[]` (name, URL and the source's own `asOf`), `notes` and a fixed `disclaimer`.
- **Scanner snapshot age:** a snapshot older than 2 minutes keeps `badge: "LIVE"` and gets a `note` with its age; it never poses as fresh.
- **RVOL is MODEL:** `session_context.rvolHour` is the current hour's volume against the median of the same New York clock hour over the last 20 days of the same type (weekdays or weekend, the weekend running from Friday 17:00 to Sunday 18:00 New York time), as on the site. `sample` gives `n`, the median and its 80% interval from a bootstrap over days (1,000 draws, mulberry32, seed 20261111); the typical hour width in `market_brief` has the same `sample`.
- **Interval coverage is MODEL:** the coverage of the forecast intervals (`cov90`, `cov60`, `covAci` and `kupiecP90` in `forecast_ledger`, and the cone row of `session_review`) carries one badge in both tools, MODEL with the forecast ledger as its method, as the site marks the cone row.
- **`twaps.share60` is null** when the last 60 minutes of the tape recording have a gap (the same rule as the site); the reason states how many minutes are covered.
- **Hidden cohort cells:** `cohort_flow` publishes only cells that pass the privacy rules. A cohort whose cells in the window are all hidden has `net`, `takerNet`, `volume` and `volumeShare` null, with the number of hidden cells as the reason, never 0. When only some cells are hidden, the numbers cover the visible cells and `note` says how many were hidden. The hidden cells of the window are reported together in `othersCombined`, never split by cohort. `volumeShare` divides by twice the tape volume of the window, so a cohort's share is never 1 just because the other cohorts are hidden; with an older scanner file that has no tape volume and some hidden cells, the share is null with the reason. An informed cohort with fewer than 10 accounts or no skill dispersion stays empty: its numbers are null with the reason "no accounts with a persistent edge detected (N checked)".
- **Privacy:** aggregates and day pseudonyms only, never wallet addresses or transaction hashes. Every response passes the site's content guards (privacy and trade-call patterns) and an address pattern; a hit returns `isError` with the reason and no content. A blog level whose label trips the guards or falls outside the strict format keeps its price: in `day_map` and `market_brief` it has `label: null` with the reason in `labelWhy`, and in `session_review` the label reads `[label withheld]` (a post title that trips the guards or the format reads `[title withheld]`, and the reasons are in `notes`). A hit anywhere else blocks the whole response.
- **Text from the data is quoted, never followed:** labels, titles and pseudonyms come from public files, and the server instructions tell the model they are data, not instructions. Before they reach a response they must fit a strict format, or they are withheld with the reason "format not allowed": a level label up to 40 characters of letters, digits, spaces and `. , % ( ) / + ' ’ -`; a post title up to 120 characters of the same plus `:` and `—`; at most 20 levels per map (the rest are cut, with a note); a whale pseudonym `W` followed by 6 lowercase hex characters (a position or order with any other id is skipped, with a note giving the count).
- **BTC only:** the scanner records BTC, so the tools take no market argument.
- **Network:** a 10 s timeout per request; a size limit on every response (scanner files and `maps.json` 4 MB, one Hyperliquid candle request 2 MB, a tape history file 16 MB after decompression, 32 MB in total per `twaps` call); a larger response is a missing source with the reason, never a partial read. An in-process cache (scanner files and candles 60 s, blog maps 5 min, volatility model 15 min, a failed request 30 s, HTTP 429 60 s); the header `User-Agent: hyperquant-mcp/0.1.4` and nothing about the user.

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
npm run mcp:mcpb                                               # dist/agents/hyperquant.mcpb and its .sha256
```

`npm pack` and `npm publish` of the package rebuild the bundle first (`prepack`).

## License

MIT, see [LICENSE](LICENSE).

## Polski

Serwer MCP HyperQuant: kontekst rynku BTC z danych publicznych (mapy z bloga HyperQuant, świece Hyperliquid, pliki skanera), liczony tymi samymi funkcjami co strona hyperquant.tech. Tylko odczyt, bez kluczy i kont; opis rynku, nie porada inwestycyjna.

- Stan: paczka jest w npm. Instalacja i uruchomienie: `npx -y hyperquant-mcp@0.1.4` (wersja przypięta, Node.js 20 albo nowszy). Claude Desktop: plik `.mcpb` ze strony (dwuklik). Z kodu źródłowego: `npm ci --legacy-peer-deps`, `npm run mcp:build`, potem `node mcp/dist/hyperquant-mcp.mjs`. Tryb HTTP jest w planach.
- Teksty po polsku: `HQ_LANG=pl`. Strefa czasu godzin w tekstach: `HQ_TZ` (domyślnie UTC).
- Każda liczba ma oznaczenie LIVE, MODEL albo SIM, czas i źródło; brak danych to `null` z powodem. Te same funkcje i metoda co strona, ale cena to ostatnie zamknięcie świecy 1m, więc liczby mogą się nieco różnić od strony w tej samej chwili.
- Narzędzia, konfiguracja klientów i zasady danych: jak w części angielskiej wyżej.
