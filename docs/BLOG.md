# Blog: post format and publishing

The blog is a set of static pages built together with the desk (`npm run build`): a list of posts grouped by day, a page for every post,
a monthly archive, an RSS feed (`blog/feed.xml`), `sitemap.xml`, a link-preview image (Open Graph / X, 1200×630) for every post
and share buttons under the title and under the body of each post (X, Facebook, LinkedIn, Telegram, WhatsApp, copy link, the system share sheet on phones).
A full analysis can have a „W skrócie” (In brief) box, a data panel, a liquidation map, flows and conditional scenarios, placed at chosen points in the body.
Code: `scripts/blog/`, posts: `content/blog/`. Posts are written in Polish, so the examples below are in Polish too.

## File

`content/blog/YYYY-MM-DD-slug.md`, e.g. `content/blog/2026-10-26-mapa-dnia.md`. The file name is the post's URL
(`https://hyperquant.tech/blog/2026-10-26-mapa-dnia/`), so it does not change after publication.
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

`--at` is the data moment (the last full 15-min candle before it), `--fp` the start of the footprint (eight 15-min candles, by default the last two hours), `--source` the data repository URL or a folder with the same layout (`archive/`, `history/`, `main/`). On standard output the script prints a chart reading: price, the day's range, POC and value area, daily VWAP with the distance in σ, delta and OI change over 1 and 4 hours (each over exactly that much time up to its latest reading; a delta window with more than 10% of its candles missing from the tape is `null`, so a gap in the recording never passes for a full hour), the largest liquidations and, for every footprint candle, delta, volume, OI change, POC and imbalance levels. The analysis text is written from these numbers, the same ones as in the picture.

- `[[wykres]]`: session map of the last 24 hours. 15-min candles (30 min on phones), daily VWAP from UTC midnight with ±1σ and ±2σ bands, volume profile with POC and value area (70% of turnover), the previous day's high and low (PDH, PDL; out of range shown as a marker at the edge), liquidations as circles at the candles, zones from `setups` (in the direction colour) and panels for aggressor delta, CVD and open interest, each with its own scale. Without tape the panels are hatched and labelled „brak taśmy” (no tape).
- `[[wykres]]` in a note: with the `--notka` flag the script builds a shorter window, the last 6 hours in 5-min candles (10 min on phones), without footprint. The chart is lighter: candles, daily VWAP with bands, the post's `levels` labelled in a column at the axis (the nearest level above and below the range as a marker with an arrow), liquidations and the delta and CVD panels. No volume profile and no open interest. The reading has `zakres6h` instead of `zakres24h` and no POC or value area, because they are not in the picture.
- `[[footprint]]`: aggressor sells and buys at every price level (step fitted to the range, up to 26 rows), tiles in the side's shade by volume, the candle's POC framed, diagonal 3:1 imbalances (a bar at the edge and a bold number; cells below 10% of the candle's largest are skipped), with delta, volume and OI change underneath. Only candles fully recorded on the tape.

Both charts are inline SVG in two layouts: wide (from 640 px) and narrow for phones. Hovering a candle or a cell shows the numbers. RSS has no charts. The validator checks the shape of the file, and a chart marker without data in the file is a post error.

### Replay on Charts

Every post gets a „Zobacz na wykresie” (See it on the chart) block between the body and the share buttons, with no extra field in the post. Its button opens the recorded tape on Charts (link format version 1 from `src/charts/pro/replay/link.ts`): BTC 5-min footprint with VWAP, profile, levels and aggressor bubbles, paused at the post's `date`. The window follows the section: a post whose `section` contains „podsumowanie” or „rozliczenie” (summary, settlement) looks back, from 10 hours before to 2 hours after `date`; every other post looks forward, from 2 hours before to 10 hours after, so the reader can play what happened next. The server keeps the recording for 7 days, so after that a small script in the page swaps the block for links to live Charts and the replay of the last day. A window that starts before the recording began (24 Oct 2026, 16:00 UTC) shows the Charts message about a missing recording.

## Body

Markdown (GFM): sections from `##`, paragraphs, tables, lists, links, images. Raw HTML is shown as text.
Links may use `https:`, `http:`, `mailto:` or a relative path (`../2026-10-26-mapa-dnia/`, `../../#after`, `#section`); any other scheme (`javascript:`, `data:`, `vbscript:`, `file:` …) and an HTML character reference in the address render the link text only. An image `src` must be a file name from the post's folder (`[a-z0-9-]`, `.png`, `.jpg` or `.webp`); anything else, including images from other sites, is a post error and renders as the alt text. The front matter may not use YAML anchors and aliases (`&a`, `*a`), and a post file is at most 64 KB, `wykresy.json` at most 1 MB. Only `wykresy.json` and those image files are copied from the post's folder to the site.
Numbers in Polish format with a space between digit groups (`80 777`, `3,8 bp`); the generator adds non-breaking spaces so that a number does not break across lines.

## Safeguards

The same validator runs before publication (`npm run blog:check`) and on every build. A broken post stops the build, so nothing reaches the site silently.

- **Privacy:** wallet addresses and transaction hashes (`0x…`), IP addresses, e-mails, tokens and access keys.
- **Analysis, not signals:** the imperative mood („kup”, „sprzedaj”, „wejdź w longa”: buy, sell, go long), ready-made entries („long od 80 500”: long from 80,500), TP/SL levels.
- **Style:** no dashes (— and – with spaces) and no arrows. Number ranges with an en dash and no spaces (`80 100–80 200`) are fine.
- **Schema:** the fields and lengths from the table above, the day in the file name matching `date`, no `#` heading in the body, existing image files from the post's folder, no YAML aliases, file size limits.

The privacy, advice and style patterns live in `src/utils/safeguards.mjs` (plain JavaScript, so the blog check runs on any Node), shared with the desk: the title of a chart frame (*Klatka*) passes the privacy and advice patterns plus English imperatives („buy the dip”, „go long”) and shorthand entries („long 80 500”), but not the style rules, because there „—” marks a missing number.

## Publishing

```bash
npm run blog:check -- content/blog/2026-10-26-mapa-dnia.md   # validate a single post
git add content/blog/2026-10-26-mapa-dnia.md
git commit -m "docs(blog): Mapa dnia 26.10.2026"
git push origin main                                          # GitHub Pages publishes in ~2 min
```

After each push that adds or changes a published post, the deploy workflow sends the post URLs and the blog index to IndexNow (Bing, Yandex, Seznam, Naver; `scripts/blog/indexnow.mjs`, key file in `public/`), so these search engines learn about a post minutes after publication instead of waiting for the sitemap. To submit every URL from `sitemap.xml` at once, run the deploy workflow by hand (Actions → Deploy static content to Pages → Run workflow) with „Zgłoś do IndexNow wszystkie adresy z sitemap.xml” ticked. Google reads `sitemap.xml` through Search Console and Bing through Bing Webmaster Tools (verification files `public/google3e29f86ae03c99dc.html` and `public/BingSiteAuth.xml`; keep both there, the services re-check them).

Local preview (including drafts): `npm run build && node scripts/blog/build.mjs --drafts && npm run preview`, then `http://localhost:4173/blog/`.

Every post is in the repository's public history from the moment of publication; the post page links to the file's change history.

Today posts are written by an automated author process on a server, from its own clone of this repository, and pushed to `main` over SSH with a deploy key that has write access; the commits are attributed to the repository owner. The next step moves only where that process pushes to (the `blog` branch below); how it writes and checks posts stays the same.

### Posts from the `blog` branch of the data repository

The deploy workflow (`.github/workflows/static.yml`) also reads posts from the `blog` branch of the public data repository `rdemb/hyperquant-data`, with the same layout as here (`<id>.md`, `<id>/wykresy.json`, `<id>/*.png`). These steps run only when the repository variable `BLOG_INTAKE` is `on` (Settings → Secrets and variables → Actions → Variables); without it the workflow behaves as before (only `content/blog/` from `main`, deploy on push and on new public data). Until the variable is set the published `blog/source.json` still carries the registry of `main` posts and the `main` commit, so the first run after enabling has a readable registry.

- **Detection:** every run (the schedule is every 5 minutes) reads the branch head with `git ls-remote` (no credentials) and the published `https://hyperquant.tech/blog/source.json`, before Node is set up. A different branch head, or a `main` commit in `source.json` different from the current `main`, deploys the site (so a deploy skipped after a push repeats by itself); the same heads and unchanged data do not. When the branch is missing or GitHub does not answer, nothing is deployed for that reason. When the published `source.json` cannot be read (network error, any status other than 200, a broken file), nothing is deployed at all, for any event: without the registry, old posts from the branch would look new.
- **Untrusted content:** the branch is cloned with full history into the runner's temporary folder, outside the repository and without credentials, and `scripts/blog/intake.mjs` (no npm dependencies, runs before `npm ci`) copies to `content/blog/` only posts that pass all rules: regular files only (no symbolic links, submodules or executable files, by the mode in git and by `lstat`); a file name `YYYY-MM-DD-slug.md` (lower-case letters, digits, hyphens, up to 60 characters) and a folder of the same name with only `wykresy.json` and `*.png`, `*.jpg`, `*.webp` named `[a-z0-9-]`; images recognised by their first bytes (PNG, JPEG, WebP; SVG is never accepted); at most 64 KB per `.md`, 1 MB per `wykresy.json`, 2 MB per image, 8 MB per post and 40 new posts per calendar day (posts already in the registry count first and are never dropped; new ones in order of `date`); `date` and the day in the name no later than the build time + 10 minutes, and for a new post (one not in the registry, below) no earlier than the build time − 24 hours. An id that already exists in `content/blog/` on `main` wins.
- **A bad post is skipped, not fatal:** a post that fails the rules above or the post validator is left out with its reason, and the rest of the site is built. A broken post on `main` still stops the build.
- **Trusted time:** commit dates are set by whoever pushes, so they are used for nothing but the history link. The only trusted clock is the build: `blog/source.json` carries a registry of every published post, `posts: { "<id>": { hash, seen, changed } }` (`hash` = SHA-256 of the lines `<SHA-256 of the file>  <name>` for the `.md` file and every media file of the post that reaches the site, media in name order, so replacing a chart or an image without touching the text also counts as a change (`hashFormat: 2`), `seen` = time of the build that first published it, `changed` = time of the build that first saw different content, or null), for posts from `main` and from the branch alike. A post not in the registry is new and its `date` must fall between the earlier of this build and the previous published build (`at` in `source.json`) minus 24 hours, and this build + 10 minutes; a pause in deploys longer than a day therefore does not reject posts written during it. A post in the registry stays; different content sets `changed` to the build time. Entries are never removed, so moving `main` posts to the branch later does not turn them into new posts. The registry is carried from build to build only while `BLOG_INTAKE` is on; without it every build starts a fresh registry and no page shows the note below. When the published registry has hashes in an older format (`hashFormat` missing = 1, the `.md` file only), the first build with the new format rewrites the hashes and keeps `seen` and `changed`, without marking posts as changed; an edit made between those two builds is not flagged.
- **`blog/source.json`:** `{ sha, main, at, hashFormat, reseededAt, posts, rewritten, skipped }`: the branch commit the site was built from (the previous one when the branch could not be read), the `main` commit, the build time, the hash format, the time of the last registry rebuild (null if never), the registry, whether the branch history was rewritten since the last published `sha`, and the skipped posts and files with reasons.
- **History:** the page of a post from the branch links to the file's history in the data repository. When the registry has `changed` for a post (from the branch or from `main`), a line „Zmieniony po publikacji: <time of that build>” appears under the title and `dateModified` in the structured data is that time.
- **IndexNow:** new and changed posts come from `git diff` in the branch clone since the published `sha` (the whole branch the first time; nothing when the history was rewritten). The branch clone has a 120 s limit and the build job 20 minutes, because the `pages` group does not cancel runs in progress.

**Turning it on.** (1) Merge the workflow change with `BLOG_INTAKE` unset. (2) Wait for one ordinary deploy (a push to `main` or the next scheduled run with new data): it publishes `blog/source.json` with the registry of every `main` post and the `main` commit. Check that `https://hyperquant.tech/blog/source.json` opens and has `hashFormat: 2`. (3) Set the repository variable `BLOG_INTAKE` to `on`. If the variable is set before step 2, `source.json` is missing (404), the site cannot be read and nothing deploys: unset the variable, let one deploy run, set it again.

**Rebuilding the registry.** If the published `source.json` is lost or damaged after posts have moved to the branch, no deploy runs (see Detection), and unsetting the variable would start the registry again from `main` posts only, so every older branch post would then be rejected as „from the past”. The repository owner rebuilds it by hand: Actions → Deploy static content to Pages → Run workflow with „Odtwórz rejestr wpisów bloga” ticked (`blog_reseed`). The run is accepted only when both the account that started it and the account that started a re-run are the repository owner (`github.actor` and `github.triggering_actor` equal to `github.repository_owner`); for anyone else the box does nothing. That one build deploys even when `source.json` cannot be read, takes every post from the branch that passes the other rules without the lower date bound (posts already in a readable registry keep their `seen`; the rest get the build time) and writes the time to `reseededAt`, which later builds keep. The next ordinary build reads that registry, so the restored posts are not rejected. Review the branch history before rebuilding: whatever is on the branch at that moment is accepted as published.

### Publishing queue on the server (the author has no key)

The automated author on the server does not push anywhere. It drops a finished post into a queue; a separate service, the publisher (`scripts/blog/publisher.mjs`, `backend/deploy/hyperquant-blog-publisher.service` and `.timer`, every minute), checks it with the same filter and validator as the site build and only then commits it to the `blog` branch of the data repository with the data repository key. Whoever takes over the author can at most put a file into the queue, and that file is checked twice (by the publisher and by the site build).

**Directories** (created by `install.sh`; group `hqblog` = the author and the publisher):

| Path | Owner, group, mode | Who writes |
| --- | --- | --- |
| `/var/lib/hyperquant-blog/kolejka/` | `hyperquant-blog`, `hqblog`, `3770` (sticky + setgid) | the author adds packages; the publisher removes them |
| `/var/lib/hyperquant-blog/zrobione/` | `hyperquant-blog`, `hqblog`, `2750` | the publisher only (results `0640`) |
| `/var/lib/hyperquant-blog/odrzucone/` | `hyperquant-blog`, `hqblog`, `2750` | the publisher only (results `0640`) |
| `/var/lib/hyperquant-blog/stan/status.json` | `hyperquant-blog`, `0644` | the publisher only |
| `/var/lib/hyperquant-blog/praca/` | `hyperquant-blog`, `hyperquant-blog`, `0700` | the publisher only (packages taken from the queue) |

**Contract for the author** (one package = one post, full replacement):

1. Work with `umask 0007` (directories `2770`, files `0660`): the publisher must be able to move the package directory out of the queue, read the files and remove them. A package it cannot move is rejected.
2. Create `kolejka/<id>.tmp-<random>/` (`<id>` = `YYYY-MM-DD-slug`, as the file name). Inside, write `<id>.md` and, optionally, the folder `<id>/` with `wykresy.json` and images `*.png`, `*.jpg`, `*.webp` named `[a-z0-9-]`, only regular files (no links, no subfolders). Same rules as a post in `content/blog/` (64 KB per `.md`, 1 MB per `wykresy.json`, 2 MB per image, 8 MB per post).
3. Close all files, then `rename("kolejka/<id>.tmp-<random>", "kolejka/<id>")`. The publisher reads only directories named exactly `<id>`, so it never sees a half-written package; anything named `*.tmp-*` is ignored. If `kolejka/<id>` already exists, the previous package of that post is still waiting: wait and retry the rename. Do not touch the package after the rename.
4. Wait for the result: `zrobione/<id>.json` or `odrzucone/<id>.json` whose `md` equals the SHA-256 (hex) of the `<id>.md` you sent. The publisher writes one of the two and removes the other, atomically (temporary file + rename). Usually within 1–2 minutes. If neither file appears within 5 minutes, report an error (with the content of `stan/status.json`) instead of waiting longer; the package may still be published later, and sending the same content again then returns the existing result.
   - `zrobione/<id>.json`: `{ "v": 1, "id", "status": "published", "md", "commit": "<sha of the last commit with this post on the blog branch>", "committed": true | false, "at": "<ISO time>" }`. `committed: false` = the same content was already on the branch; nothing new was committed.
   - `odrzucone/<id>.json`: `{ "v": 1, "id", "status": "rejected", "md", "reason": "<rule or validator messages>", "at" }`. `md` is null when `<id>.md` could not be read as a regular file (missing, a link); then match by `at` later than your rename. The package is removed; fix the post and send it again.
5. A new package with the id of a post already on the branch replaces it completely (text and media; media missing from the package disappear from the branch); the site then shows „Zmieniony po publikacji”. Such a correction is accepted only within 24 hours of the post's `date` and only with the same `date`; otherwise it is rejected with „wpis starszy niż 24 h zmienia tylko właściciel” (older posts are changed by the repository owner). The same content sent again is always accepted (`committed: false`). Only a post that is not on the branch yet must have `date` within the last 24 hours (and at most 10 minutes ahead).
7. `reason` is plain rule or validator text, at most 500 characters, without server paths.
6. Optional pre-check on a read-only clone of this repository: `npm run blog:check -- <id>.md`.

**What the publisher does each minute:** if the queue has no finished package, it exits without touching the network. Otherwise it brings its clone of the `blog` branch (in its private state directory, `/var/lib/hyperquant-blog-publisher`) up to date, or starts an empty orphan branch when the data repository has none yet. For each package: it moves the package directory into its private working directory `praca/` (a `rename`, which never follows a link; the author has no access there, so nothing can be swapped for a link while it is checked; a package left there by an interrupted run goes back to the queue), then `lstat` on every entry (a link, a non-directory package or any non-regular file is rejected; the link target is never read), each file read once into memory (`O_NOFOLLOW`), then `intake.mjs` (names, types, first bytes of images, size limits, ids already in `main`, date window, 40 new posts a day) and the post validator (`loadPostFile`, the same as `npm run blog:check` and the build) on those bytes. A good post becomes one commit `blog: <id>` (or `blog: zmiana <id>`) by `HyperQuant blog <hyperquant-blog@users.noreply.github.com>`; the push is retried up to 3 times, each time after `fetch` and `rebase` onto the new head. Results are written only after a successful push; if the push fails, the packages go back to the queue (unless a newer package of the same post is already there) and the next run starts again from a clean clone (an identical package produces no second commit).

**Alarm:** `stan/status.json` is `{ "v": 1, "at", "ok", "alarm": null | "odrzucone" | "kwarantanna" | "push", "published", "rejected", "quarantined", "quarantine", "pending", "pushError", "lastRejected": [{ "id", "reason", "at" }] }`, rewritten every run, readable by every user. `alarm: "push"` = the data repository did not accept the commits (or could not be reached) and the posts wait in the queue; `alarm: "kwarantanna"` = a package could not be taken from the queue or removed (wrong permissions, e.g. the author's umask): it was moved to `odrzucone/_kwarantanna/<id>-<time>` (or, when even that move is impossible, renamed in place to a hidden `.<id>.kwarantanna-<time>`), got a rejection result, and the run went on with the other packages; `quarantine` counts what is still there and the alarm stays until it is gone. Clean-up is manual, by root (the author owns the files but cannot delete them in the publisher's directories): look at the package, then `sudo rm -rf /var/lib/hyperquant-blog/odrzucone/_kwarantanna/<entry> /var/lib/hyperquant-blog/{kolejka,praca}/.<id>.kwarantanna-*`; `alarm: "odrzucone"` = a package was rejected in this run (`lastRejected` keeps the last 20 across runs). A failed push also leaves the systemd unit in the `failed` state. The watchdog does not read this file yet; until it does, check it by hand during the observation days.

**User and isolation:** the publisher runs as its own system user `hyperquant-blog` (not the scanner, whose state and secrets it does not need, and not the author), with code from a copy that `install.sh` puts outside the auto-updated directory (`/opt/hyperquant/blog-publisher`, like the watchdog) and the `yaml` package downloaded from the address and SHA-512 recorded in `package-lock.json` of the installed signed tag (no npm on the server). The data repository key comes through `LoadCredential`, so the key file stays owned by the scanner. SSH accepts only the GitHub host keys kept in this repository (`backend/deploy/github_known_hosts`, from `https://api.github.com/meta`, fingerprints as in GitHub's documentation), installed next to the code (`StrictHostKeyChecking=yes`); when GitHub rotates its keys, update the file and install a new tag. Known cause of a stop: after GitHub rotates its SSH host keys, every push fails host key verification and publishing stays at `alarm: "push"` (posts wait in the queue) until a new signed tag with a new `github_known_hosts` is installed. Package directories are opened with `O_DIRECTORY | O_NOFOLLOW` and read through `/proc/self/fd`. Writes are allowed only to its state directory and the four queue directories (`ProtectSystem=strict`, `NoNewPrivileges`, no capabilities).

**B2 rollout order:** (1) merge this change; (2) create a signed tag; (3) `HQ_BLOG_AUTHOR=<author user> TAG=<tag> bash install.sh` on the server (creates the group, the user, the directories, the units, adds the author to `hqblog`; the author's processes see the new group after their restart); (4) ruleset on the `blog` branch of the data repository: no force pushes and no deletion; (5) switch the author from `git push` to the queue (contract above); (6) set `BLOG_INTAKE=on` in this repository (see „Turning it on” above); (7) observe for 3 days: the delay from the queue to the site, `skipped` in `blog/source.json`, `stan/status.json`, IndexNow. **Rollback**, in this order: (1) switch the author back to its previous `git push` and `systemctl disable --now hyperquant-blog-publisher.timer`; (2) a pull request that copies every post from the `blog` branch to `content/blog/` on `main` (same files, so the same addresses), merged; (3) only then unset `BLOG_INTAKE`. Unsetting it first would make the site build only from `main`, and the pages of posts published through the branch would return 404 until step 2.

Every page from the blog template carries a Content Security Policy: scripts only from the site's files (`blog/blog.js`: share buttons and the 7-day replay switch; the structured data block is not executed), styles from the site and Google Fonts, fonts from Google Fonts, images from the site and `data:`, no `<base>` and no forms. Inline `style` attributes are allowed (`style-src-attr`), because the generator positions the level ladder and sizes the bars of the liquidation, flow and scenario diagrams with them; post text cannot set attributes.

## Site pages

The same generator (`scripts/blog/pages.mjs`) builds static pages for the parts of the desk that live behind `#` routes, which search engines do not index: Charts (`wykresy/`, `en/charts/`), Lessons (`lekcje/`, `en/lessons/`), one page for each of the 21 indicator atlas entries in both languages (`lekcje/atlas/<id>/`, `en/lessons/atlas/<id>/`, text taken from `src/lessons/content/`) and `404.html`. Each page has its own title, description, canonical URL, `hreflang` link to the other language, structured data and link-preview image, and its buttons open the matching view of the app. The previews of the main page (`og.png`), Charts and Lessons carry a screenshot of the app from `scripts/blog/shots/` (JPEG, 2880 px wide); replace these files when the look of the app changes. `sitemap.xml` lists the posts and the site pages with their language versions.
