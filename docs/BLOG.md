# Blog: post format and publishing

The blog is a set of static pages built together with the desk (`npm run build`): a list of posts grouped by day, a page for every post,
a monthly archive, an RSS feed (`blog/feed.xml`), `sitemap.xml`, a link-preview image (Open Graph / X, 1200×630) for every post
and share buttons under the title and under the body of each post (X, Facebook, LinkedIn, Telegram, WhatsApp, copy link, the system share sheet on phones).
A full analysis can have a „W skrócie” (In brief) box, a data panel, a liquidation map, flows and conditional scenarios, placed at chosen points in the body.
Code: `scripts/blog/`, posts: `content/blog/`. Posts are written in Polish, so the examples below are in Polish too.

## File

`content/blog/YYYY-MM-DD-slug.md`, e.g. `content/blog/2026-10-26-mapa-dnia.md`. The file name is the post's URL
(`https://rdemb.github.io/HyperQuant/blog/2026-10-26-mapa-dnia/`), so it does not change after publication.
The date in the name is the publication day in Polish time; several posts on one day differ by slug (`2026-10-26-aktualizacja-12`).

A post's images live in a folder with the same name (`content/blog/2026-10-26-mapa-dnia/wykres.png`) and are embedded in the body as `![Description](wykres.png)`.
Link to an earlier post: `[mapa dnia](../2026-10-26-mapa-dnia/)`.

## Frontmatter

```yaml
---
title: "Sobota tuż nad dołkiem tygodnia. Pod 80 500 czekają longi do likwidacji"
description: "BTC-PERP stoi na 80 777, niecałe 300 dolarów nad piątkowym dołkiem. Poziomy i prawdopodobieństwa do 13:00."
date: 2026-10-24T09:30:00+02:00
type: article
section: Mapa dnia
price: 80777
levels:
  - { label: PDH, price: 82088, note: szczyt piątku w sesji NY }
  - { label: PDL, price: 80500, note: "dołek tygodnia, 34% dotknięcia do 11:00" }
scenarios:
  - { label: Cena o 13:00 poniżej 80 400, probability: 20, note: Zejście pod PDL otwiera strefę likwidacji longów. }
  - { label: Cena o 13:00 między 80 400 a 81 160, probability: 60 }
  - { label: Cena o 13:00 powyżej 81 160, probability: 20 }
---
```

| Field | Required | Description |
|---|---|---|
| `title` | yes | Title, up to 90 characters. |
| `description` | yes | Teaser, 50–220 characters: the lead under the title, the Google description and the link-preview text. |
| `date` | yes | Moment of publication, ISO 8601 with a time zone (`+01:00` in winter, `+02:00` in summer, or `Z`). |
| `type` | yes | `article` (full analysis, at least 150 words) or `note` (short note, 15–250 words). |
| `section` | yes | Column, up to 40 characters. Articles: Mapa dnia, Mapa przed Nowym Jorkiem, Podsumowanie dnia, Rozliczenie tygodnia, Mapa na weekend, Mapa tygodnia. Notes: Otwarcie Londynu, Rozliczenie Londynu, Otwarcie Nowego Jorku, Aktualizacja 4h. |
| `price` | with `levels` | BTC-PERP price at the moment of publication (USD). |
| `levels` | no | Up to 12 levels: `label` (up to 20 characters), `price`, optionally `note` (up to 40 characters). Drawn as a level map with the distance from price in %. |
| `scenarios` | no | Up to 4 **mutually exclusive** scenarios (e.g. three price ranges at the same time): `label` (up to 60 characters, including the horizon), `probability` (integer 1–99, %), optionally `note` (up to 240 characters). They sum to at most 100%; the missing remainder is shown as „inne przebiegi” (other outcomes). |
| `summary` | no | „W skrócie” (In brief): 2–5 points (up to 200 characters each), a box under the lead and a list at the start of the post in RSS. |
| `metrics` | no | Data panel, up to 12 cards: `label` (up to 28 characters), `value` (text with a unit, up to 20 characters, e.g. `"−1,5 bp"`), optionally `note` (up to 80 characters) and `bias`: `up`, `down` or `flat` (a ▲ ▼ ◆ sign next to the value). |
| `liquidations` | no | Liquidation map (requires `price`): `step` (bucket width in USD), `longs` and `shorts` as `[price from, USD m]` pairs with prices that are multiples of `step` (longs below the price, shorts above it; a short bucket may contain the price), optionally `coverage` (1–100, % of open interest covered by the map) and `note` (up to 200 characters). At most 60 buckets from lowest to highest; empty buckets in between are drawn so that distances are true. |
| `flows` | no | Flows: `title` (up to 60 characters), `unit` (up to 12 characters), `rows` of 1–8 rows `{ label, value, note }`; a positive `value` means buyers dominate, a negative one sellers. Bars from zero in both directions. |
| `setups` | no | Up to 4 conditional scenarios (requires `price`): `name` (up to 70 characters), `bias` (`up`, `down`, `flat`), `zone: [from, to]` (watch zone), optionally `window` (horizon, up to 40 characters), `triggers` (1–5 conditions, each up to 180 characters, in order), `invalidation` (what invalidates the scenario, up to 220 characters), `reactions` (up to 5 levels `{ label, price }`), `evidence` (what historical data says, up to 280 characters). |
| `draft` | no | `true`: the post is not published (local preview: `--drafts`). |

Text containing a comma inside YAML curly braces must be quoted (`note: "dołek, 34%"`); otherwise the comma starts a new field and validation reports it.

### Extended analysis

A full analysis combines numbers from the desk with diagrams and conditional scenarios. Example fields (values shortened):

```yaml
summary:
  - "Pod ceną czeka osiem razy więcej longów do likwidacji niż shortów nad nią."
  - "Przepływ jest po stronie sprzedających, perp notuje się pod indeksem."
metrics:
  - { label: Premia perp, value: "−1,5 bp", note: "perp pod indeksem od rana", bias: down }
  - { label: Likwidacje 24 h, value: "13,3 mln USD", note: same longi }
liquidations:
  step: 250
  coverage: 43
  shorts: [[82750, 13.4], [82500, 7.6]]
  longs: [[80000, 42.9], [79750, 57.4]]
flows:
  title: Przepływ agresorów netto, 24 h
  unit: mln USD
  rows:
    - { label: Wieloryby, value: -37.5, note: 100 największych kont }
    - { label: Reszta rynku, value: -23.3 }
setups:
  - name: Wypłukanie longów pod 80 000 i powrót nad dołek tygodnia
    bias: up
    zone: [79750, 80250]
    window: do 18:00
    triggers:
      - Cena wchodzi w klaster, a likwidacje longów rosną skokowo.
      - W ciągu godziny świeca 15 min zamyka się z powrotem nad 80 500.
    invalidation: Dwa zamknięcia 15 min pod 79 750 bez powrotu.
    reactions:
      - { label: VWAP soboty, price: 80836 }
    evidence: Po pierwszym dotknięciu minimum poprzedniego dnia cena doszła do środka zakresu w 44% z 85 przypadków (losowo 48%).
```

Conditional scenarios describe what would have to happen in the market (zone, confirmation conditions, invalidation, reaction levels). Above the cards there is a fixed note that this describes conditions and is neither an order nor a recommendation. The safeguards cover every text in these fields, so TP/SL levels, "long from …" and the imperative mood will not pass there either.

**Placing blocks in the body.** A data block can be placed at a chosen point in the body with a marker on its own line: `[[dane]]` (data panel), `[[wykres]]` and `[[footprint]]` (see Charts), `[[poziomy]]`, `[[likwidacje]]`, `[[przeplywy]]`, `[[scenariusze]]`, `[[setupy]]`. A placed block gets a caption instead of a section heading, so it sits well under its own `##`. Blocks without a marker go before the body in this order, each with a heading. A marker without data, an unknown marker, a repeated one or one in the middle of a paragraph is a post error. In RSS the diagrams are omitted, and conditional scenarios stay as text.

### Charts

The session map and the footprint are drawn by the generator from `content/blog/<id>/wykresy.json` (the post's media folder). The file is created by a script from the desk's public data (archive of 1-minute candles, trade tape from the `history` branch, liquidation tape):

```sh
node scripts/blog/chartdata.mjs --at 2026-10-25T06:00Z --out content/blog/2026-10-25-mapa-dnia/wykresy.json [--fp 2026-10-25T04:00Z] [--source <url|folder>]
node scripts/blog/chartdata.mjs --notka --at 2026-10-25T12:00Z --out content/blog/2026-10-25-aktualizacja-14/wykresy.json
```

`--at` is the data moment (the last full 15-min candle before it), `--fp` the start of the footprint (eight 15-min candles, by default the last two hours), `--source` the data repository URL or a folder with the same layout (`archive/`, `history/`, `main/`). On standard output the script prints a chart reading: price, the day's range, POC and value area, daily VWAP with the distance in σ, delta and OI change over 1 and 4 hours, the largest liquidations and, for every footprint candle, delta, volume, OI change, POC and imbalance levels. The analysis text is written from these numbers, the same ones as in the picture.

- `[[wykres]]`: session map of the last 24 hours. 15-min candles (30 min on phones), daily VWAP from UTC midnight with ±1σ and ±2σ bands, volume profile with POC and value area (70% of turnover), the previous day's high and low (PDH, PDL; out of range shown as a marker at the edge), liquidations as circles at the candles, zones from `setups` (in the direction colour) and panels for aggressor delta, CVD and open interest, each with its own scale. Without tape the panels are hatched and labelled „brak taśmy” (no tape).
- `[[wykres]]` in a note: with the `--notka` flag the script builds a shorter window, the last 6 hours in 5-min candles (10 min on phones), without footprint. The chart is lighter: candles, daily VWAP with bands, the post's `levels` labelled in a column at the axis (the nearest level above and below the range as a marker with an arrow), liquidations and the delta and CVD panels. No volume profile and no open interest. The reading has `zakres6h` instead of `zakres24h` and no POC or value area, because they are not in the picture.
- `[[footprint]]`: aggressor sells and buys at every price level (step fitted to the range, up to 26 rows), tiles in the side's shade by volume, the candle's POC framed, diagonal 3:1 imbalances (a bar at the edge and a bold number; cells below 10% of the candle's largest are skipped), with delta, volume and OI change underneath. Only candles fully recorded on the tape.

Both charts are inline SVG in two layouts: wide (from 640 px) and narrow for phones. Hovering a candle or a cell shows the numbers. RSS has no charts. The validator checks the shape of the file, and a chart marker without data in the file is a post error.

### Replay on Charts

Every post gets a „Zobacz na wykresie” (See it on the chart) block between the body and the share buttons, with no extra field in the post. Its button opens the recorded tape on Charts (link format version 1 from `src/charts/pro/replay/link.ts`): BTC 5-min footprint with VWAP, profile, levels and aggressor bubbles, paused at the post's `date`. The window follows the section: a post whose `section` contains „podsumowanie” or „rozliczenie” (summary, settlement) looks back, from 10 hours before to 2 hours after `date`; every other post looks forward, from 2 hours before to 10 hours after, so the reader can play what happened next. The server keeps the recording for 7 days, so after that a small script in the page swaps the block for links to live Charts and the replay of the last day. A window that starts before the recording began (24 Oct 2026, 16:00 UTC) shows the Charts message about a missing recording.

## Body

Markdown (GFM): sections from `##`, paragraphs, tables, lists, links, images. Raw HTML is shown as text.
Numbers in Polish format with a space between digit groups (`80 777`, `3,8 bp`); the generator adds non-breaking spaces so that a number does not break across lines.

## Safeguards

The same validator runs before publication (`npm run blog:check`) and on every build. A broken post stops the build, so nothing reaches the site silently.

- **Privacy:** wallet addresses and transaction hashes (`0x…`), IP addresses, e-mails, tokens and access keys.
- **Analysis, not signals:** the imperative mood („kup”, „sprzedaj”, „wejdź w longa”: buy, sell, go long), ready-made entries („long od 80 500”: long from 80,500), TP/SL levels.
- **Style:** no dashes (— and – with spaces) and no arrows. Number ranges with an en dash and no spaces (`80 100–80 200`) are fine.
- **Schema:** the fields and lengths from the table above, the day in the file name matching `date`, no `#` heading in the body, existing image files.

## Publishing

```bash
npm run blog:check -- content/blog/2026-10-26-mapa-dnia.md   # validate a single post
git add content/blog/2026-10-26-mapa-dnia.md
git commit -m "docs(blog): Mapa dnia 26.10.2026"
git push origin main                                          # GitHub Pages publishes in ~2 min
```

After each push that adds or changes a published post, the deploy workflow sends the post URLs and the blog index to IndexNow (Bing, Yandex, Seznam, Naver; `scripts/blog/indexnow.mjs`, key file in `public/`), so these search engines learn about a post minutes after publication instead of waiting for the sitemap. Google reads `sitemap.xml` through Search Console (verification file in `public/`, keep it there).

Local preview (including drafts): `npm run build && node scripts/blog/build.mjs --drafts && npm run preview`, then `http://localhost:4173/blog/`.

Every post is in the repository's public history from the moment of publication; the post page links to the file's change history.

## Site pages

The same generator (`scripts/blog/pages.mjs`) builds static pages for the parts of the desk that live behind `#` routes, which search engines do not index: Charts (`wykresy/`, `en/charts/`), Lessons (`lekcje/`, `en/lessons/`), one page for each of the 21 indicator atlas entries in both languages (`lekcje/atlas/<id>/`, `en/lessons/atlas/<id>/`, text taken from `src/lessons/content/`) and `404.html`. Each page has its own title, description, canonical URL, `hreflang` link to the other language, structured data and link-preview image, and its buttons open the matching view of the app. The previews of the main page (`og.png`), Charts and Lessons carry a screenshot of the app from `scripts/blog/shots/` (JPEG, 2880 px wide); replace these files when the look of the app changes. `sitemap.xml` lists the posts and the site pages with their language versions.
