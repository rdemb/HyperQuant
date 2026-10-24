# HyperQuant — UI, data and motion style guide (v2)

Applies to every new and reworked component. Code and identifiers in English, **comments in Polish**.

## 1. Core rules
1. **Data honesty.** A number without a source does not exist. Every value is `LIVE` (real data), `MODEL` (model output from real data; name the method) or `SIM` (simulation; only in model mode, always labelled). Missing data = `—` or `n/a`, never a placeholder number.
2. **The desk scores the plan; it does not suggest entries.** No automatic LONG/SHORT signals. "Signal" buttons in panels pass the direction and levels to the Plan Analyzer (`onPrefillPlan`).
3. **One hero per screen.** Every view has one main element (the hero); everything else is quieter (ink-2/ink-3, lower weight).
4. **Mobile first for content, desktop for density.** Every view works from 360 px (16 px gutter, no horizontal page scroll; wide tables scroll inside their frame).

## 2. Tokens (defined in `src/index.css` via `@theme`; use the Tailwind classes)
| Role | Token / class | Value |
|---|---|---|
| Page background | `bg-page` | `#070A11` |
| Panel | `bg-surface-1` | `#0B1019` |
| Raised panel | `bg-surface-2` | `#101826` |
| Hover / field | `bg-surface-3` | `#16202F` |
| Line (hairline) | `border-line` | `#1B2533` |
| Strong line | `border-line-strong` | `#283447` |
| Primary text | `text-ink-1` | `#EEF2F7` |
| Secondary text | `text-ink-2` | `#A9B4C4` |
| Muted text (min. 4.5:1) | `text-ink-3` | `#7A889C` |
| Brand accent (HL) | `text-accent` / `bg-accent` | `#3FC6DD` |
| Buy (mark/bar) | `bg-buy` / `text-buy-ink` | `#19A88E` / `#35C9A8` |
| Sell (mark/bar) | `bg-sell` / `text-sell-ink` | `#D9582E` / `#F07C55` |
| HTF levels (PDH/PDL) | `level` | `#E0A045` |
| OB zones | `zone` | `#9085E9` |
| Status | `good` / `warn` / `critical` | `#0CA30C` / `#FAB219` / `#D03B3B` (always with an icon + label) |

The buy/sell pair passed the palette validator (CVD ΔE 11.8, contrast ≥ 3:1). **Always add a second channel**: a `+/−` sign, a ▲▼ arrow or position (bid below the price, ask above).

Categorical series on charts (fixed order, never cycled): `series-1…8` = `#3987e5 #d95926 #199e70 #c98500 #d55181 #008300 #9085e9 #e66767`. More than 3 series on a scatter/map → "Other" or small multiples.
Exception: flow panels (buy/sell direction in the background) skip `series-2` and `series-3`, which are too close to `sell`/`buy`. Participant cohorts: `series-1` market makers, `series-4` informed, `series-5` whales, `series-7` everyone else (a set checked with the palette validator on `surface-1`: lightness band, chroma, CVD ΔE ≥ 13, contrast ≥ 3:1).

## 3. Typography
- `font-display` (Outfit 600/700): section headings and the app name only. **Never on numbers.**
- `font-sans` (Plus Jakarta Sans): UI and hero numbers (proportional figures).
- `font-mono` (IBM Plex Mono) + `tabular-nums`: number columns, tables, axes, the tape.
- Scale: 11 / 12 / 13 / 14 / 16 / 20 / 28 / 44 px. "Eyebrow" labels: 11 px, uppercase, tracking 0.08em, `text-ink-3`.

## 4. Charts
- 2 px lines, bars ≤ 24 px with a 4 px rounded end, area fill at ~10% opacity, 1 px hairline grid that is **solid** (never dashed).
- One Y axis per chart, never two scales. Different units = two charts or an index = 100.
- Label selectively (last value, extreme). Text in ink colours; colour is carried by the marker next to it.
- Hover: crosshair + tooltip on lines, a per-element tooltip on bars/cells; hit target ≥ 24 px.
- Data refresh: keep the previous render (no skeletons, no layout jumps).

### Order-flow chart (Charts tab)
The canvas has its own HyperQuant "Desk" palette (`of-*` tokens, the same values in `src/charts/pro/chart/theme.ts`): sea-green buys and copper sells on the Desk's navy background. The frame, toolbar and menus stay in the page tokens. The buy and sell colours pass the palette validator, including for colour-blind viewers.

| Role | Token / class | Value |
|---|---|---|
| Canvas background (no grid) | `of-bg` | `#0B1019` |
| Buy / sell candle | `of-buy` / `of-sell` | `#19A88E` / `#D9582E` |
| Buy / sell flow (text, bubbles, liquidations, whales) | `text-of-buy-ink` / `text-of-sell-ink` | `#35C9A8` / `#F07C55` |
| Buy / sell imbalance | `of-imb-buy` / `of-imb-sell` | `#5CF2CF` / `#FF9A6A` |
| POC frame in a candle | `of-poc` | `#E0A045` |
| Row volume | `of-vol` | `#5B7AA6` |
| Session profile: value area / rest / POC / naked POC | — | `#34425A` / `#1F2B3D` / `#E0A045` / `#7A889C` |
| DOM ladder: bids / asks | — | `#19A88E` / `#D9582E` |
| VWAP / session VWAP | `of-vwap` / `of-svwap` | `#E6EBF2` / `#9085E9` |
| Order-book heatmap (navy → light blue → white walls) | `of-heat-1…3` | `#22609A` → `#7FDCEE` → `#FFFFFF` |
| Exchanges: Hyperliquid / Binance / Bybit | — | `#3987E5` / `#C98500` / `#D55181` |

Bid × Ask footprint cells are tiles from graphite `#2A3446` (low volume) to the saturated side colour; dark numbers on a light tile, light numbers on a dark one. The Delta and Volume styles are bars from the left edge of the candle (delta and volume in the colour of the dominant side) with light bid and ask numbers. Second channel: position (sells on the left, buys on the right), and the imbalance number is bold and outlined.

## 5. Motion (`motion/react`, tokens in `src/ui/motion.ts`)
- Default spring: `stiffness 260, damping 26, mass 1` (ζ ≈ 0.8, "premium"). Position and size may spring; **opacity and colour never**.
- Durations: feedback 100–160 ms; UI motion 200–300 ms; hero entrance 600–720 ms. Exits 40–50% shorter than entrances.
- Curves: entrance `ease-out-quint` `cubic-bezier(0.22,1,0.36,1)`; exit `ease-in-quint` `cubic-bezier(0.64,0,0.78,0)`; moving across the screen `ease-in-out-quint` `cubic-bezier(0.83,0,0.17,1)`. Linear only for rotation, progress bars and loop phase.
- List stagger 40–60 ms, **only on first mount**; the next item starts at 30–50% of the previous one.
- Data motion: a number change = a short 160 ms background flash (max 3 flashes/s per element), depth bars move on a spring, new candles have no entrance animation.
- `prefers-reduced-motion`: no transforms; opacity only, ≤ 120 ms.
- **Forbidden:** purple/blue gradient backgrounds, glows, flares, decorative particles, everything appearing at once, fade+slide-up on every element, centred content layouts, moving text while reading, flicker > 3/s. (The 3D scenes in the Lab may have a subtle bloom, and only there.)

## 6. Base components (`src/ui/`)
`Panel` (header + eyebrow + actions + content), `Stat` (label, value, delta, sparkline), `Badge` (LIVE/MODEL/SIM/STALE), `Segmented`, `AnimatedNumber`, `Sparkline`, `EmptyState`. Use them instead of custom cards. Buttons: real `<button>` elements, touch target ≥ 44 px on mobile, `aria-label` on icons.

## 7. Accessibility
Text contrast ≥ 4.5:1 (checked for the ink tokens on every surface). Visible keyboard focus (`focus-visible:ring-2 ring-accent`). Colour is never the only carrier of meaning.
