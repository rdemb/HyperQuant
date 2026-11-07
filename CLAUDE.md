# HyperQuant: instructions for Claude Code

Open-source BTC day-trading desk for Hyperliquid (PWA) at https://hyperquant.tech, with a blog and a verifiable forecast ledger. The owner is Rafał, who trades BTC on Hyperliquid. **Talk to him in Polish**, briefly and concretely. Never promise profit.

Before any change, read [README.md](README.md) (principles, views, methods), [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/STYLEGUIDE.md](docs/STYLEGUIDE.md). For blog work, also read [docs/BLOG.md](docs/BLOG.md). For the forecast cat, read [docs/SCHRODI.md](docs/SCHRODI.md).

## Stack and commands
- React 19, TypeScript (strict), Vite 8, Tailwind 4 (`@theme` tokens in `src/index.css`), TradingView Lightweight Charts with custom canvas layers, Express dev server (`server.ts` via tsx), Vitest.
- Node.js 24 (the same version as CI). No API keys or `.env` are needed to run the app locally.

```bash
npm ci --legacy-peer-deps   # always with this flag
npm run dev                 # Express + Vite at http://localhost:3000
npm run lint                # tsc --noEmit
npm test                    # vitest run
npm run build               # vite build + blog (scripts/blog/build.mjs) into dist/
npm run data                # public feeds into public/data/feeds (optional)
npm run blog:check -- content/blog/<post>.md
```

- CI (`.github/workflows/ci.yml`) runs `lint`, `test` and `build` on every PR.
- A push to `main` publishes the site on GitHub Pages (`static.yml`, also every 30 min).
- To build with the published scanner data locally, set `VITE_DATA_BASE_URL=https://raw.githubusercontent.com/rdemb/hyperquant-data/main`. Without it, scanner panels and the ledger show nothing.
- On Windows, two tests fail for environment reasons only: `backend/alerts/__tests__/book.test.ts` (file mode 0600) and the blog build test under the default 5 s timeout. Run `npx vitest run --testTimeout=180000`, where only `book.test.ts` may fail.

## Structure (since stage 1a, November 2026)
- **Navigation:** `src/state/route.ts` and `src/state/DeskContext.tsx`. Views are `#before` (Przed sesją), `#charts` (W sesji, the default), `#after` (Po sesji), `#research` (Badania), `#lessons` and `#sources`. Old hashes (`#desk`, `#plan`, `#market`, `#lab`, `#micro`, `#flow`) redirect. `#charts?…` links (replays, alarms, blog, push) must keep working.
- **Chart layouts** live in `src/charts/pro/chart/stations.ts`. There are six layouts in three phases (`day-map`, `fuel` | `cockpit`, `auction-open`, `big-hands` | `review`).
  - Each layout has at most 5 layers on the price chart and at most 3 panels under it; tests enforce this.
  - Old station ids go through `LEGACY_STATION`.
  - Tabs and their migration are in `tabs.ts`; `legacyPresets.ts` is a frozen copy used only by the migration.
- **Palette:** a single palette, „Głębia”, in `src/charts/pro/chart/theme.ts`, mirrored in `src/lessons/chart/palette.ts` and `scripts/blog/charts.mjs`. Buy is `#3280DD`, sell is `#CA3829`. `fpBidRamp` is the sell side and `fpAskRamp` the buy side. Change all three files together; the parity tests check this.
- **Code layout:** pure maths in `src/utils/` (no network, no state), data hooks in `src/state/`, views in `src/views/`. The scanner and alerts run on the VPS from `backend/`, and the Cloudflare worker is in `workers/alerts/`.

## Rules
- **Honest data:** every value is `LIVE`, `MODEL` (method named) or `SIM`. Missing data is shown as „—”, never a placeholder number, and no made-up readings before the first sync. No buy/sell signals.
- **Privacy:** aggregates and pseudonyms only. Never wallet addresses or transaction hashes in files, UI, logs or commits. Centralised exchange data is opt-in, fetched in the user's browser.
- **Strings:** every UI string is PL and EN via `tr('polski', 'English')` from `src/i18n.ts`. The blog is Polish only. Code comments in Polish, identifiers in English.
- **Changes:** TDD for behaviour changes, Conventional Commits, and a CHANGELOG entry (in Polish). Work on a branch; merging and deploying are the owner's call.
- **Never delete or overwrite user data in `localStorage`:** `hq.ledger.v1`, `hq.journal.v1`, `hq.charts.templates.v1`, `hq.charts.v1`, `hq.charts.tabs.v1`, drawings and alarms. Migrations only add keys.

## Do not touch
- Published posts in `content/blog/`. Posts are written and pushed by the owner's automated routines; change a post only when asked.
- The data repository `rdemb/hyperquant-data`, which is written by the scanner. Its `ledger` branch is an append-only hash chain: never rewrite or force-push it.
- The scanner on the VPS (`backend/deploy/install.sh`, systemd units). Deploy only on the owner's explicit request.
- Local-only paths (git-ignored): `tasks/`, `.scanner/`, `backend/deploy/scanner.env`, `src/plugins/`, `docs/superpowers/`, `.superpowers/`, `.remember/`, `.claude/`.
- Never force-push `main`.
