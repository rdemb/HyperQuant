# Contributing to HyperQuant

Thanks for wanting to help. HyperQuant is a public BTC analytics desk on Hyperliquid, and what matters above all is **honest numbers**. Before you start, read the [principles in the README](README.md#principles).

## Running

Requires Node.js 24.

```bash
npm ci --legacy-peer-deps
npm run dev      # http://localhost:3000
```

| Script | What it does |
|---|---|
| `npm run lint` | type check (`tsc --noEmit`) |
| `npm test` | Vitest tests |
| `npm run build` | production build to `dist/` |
| `npm run data` | fetches public data into `public/data/feeds` |

## Content rules

1. **Every number has a source and a method.** A value from an API is `LIVE`, a model output from real data is `MODEL` (method described in the UI and in the [data lineage](src/views/sources/LineageTable.tsx)), a simulation is `SIM`. Missing data = "—", never a placeholder number.
2. **Name = maths.** If something is called "Hawkes", "OFI" or "VPIN", it implements exactly that method (with a citation) or is explicitly labelled as a heuristic.
3. **The desk scores the plan; it does not suggest entries.** No automatic LONG/SHORT signals.
4. **Public, legal data only.** The core is Hyperliquid's public API; centralised exchanges are opt-in only, in the user's browser.
5. **Methods from the literature.** A new model or estimator gets a citation (author, year, journal) in a code comment and in the UI methodology section, plus a test on data with a known distribution.

## Code

- Strict TypeScript; pure computation functions in `src/utils/` (no network, no state), data hooks in `src/state/`, views in `src/views/`.
- UI text in Polish and English: every visible string goes through `tr('polski', 'English')` from `src/i18n.ts`, dates and numbers use its `locale`. Texts recorded in the verifiable ledger (lab catalogue, A/B plan) stay Polish in the source and are translated only when displayed. The blog is Polish only.
- Code comments in Polish, identifiers in English.
- Every behaviour change comes with a test that fails first (TDD). Randomness in tests and simulations uses a deterministic seed.
- Commits follow Conventional Commits: `feat(...)`, `fix(...)`, `docs:`, `ci:`, `chore:`.

## Pull requests

1. Branch from `main`, one topic per PR.
2. Run `npm run lint && npm test && npm run build` locally; CI runs the same on every PR.
3. Update the [CHANGELOG](CHANGELOG.md) (the "Unreleased" section or a new version).
4. UI changes: a screenshot (desktop and phone).

Merging to `main` publishes the site on GitHub Pages.
