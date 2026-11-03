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
The canvas has six palettes (`of-*` tokens, the same values in `src/charts/pro/chart/theme.ts`), picked in Chart settings → Colours for all charts and kept in the browser (`src/charts/pro/chart/palette.ts`, the `data-chart-palette` attribute on `<html>` switches the tokens; changing it reloads the page). **Neon** (default): neon-green buys and violet sells on a graphite background, cyan and magenta imbalances, a yellow POC. **Desk**: sea-green buys and copper sells on the Desk's navy background. **Kobalt**: azure buys and saffron sells on ink black, silver liquidity, an aqua POC; the blue–yellow pair stays apart for protanopia and deuteranopia too. **Zorza**: mint buys and raspberry sells on a polar-night navy, purple liquidity, a gold POC. **Laka**: gold buys and vermilion sells on black lacquer, indigo liquidity, a jade POC. **Atrament**: muted sea-mist buys and dusty-rose sells for night sessions, a dim violet heatmap whose brightest wall stays darker than the candles. In Zorza, Laka and Atrament the sides differ mainly in lightness. Every buy/sell pair is checked in OKLab under simulated protanopia, deuteranopia and tritanopia (Machado 2009, ΔE×100 ≥ 18 for candles); text inks are ≥ 6.8:1 and candles ≥ 4.8:1 against the canvas. The frame, toolbar and menus stay in the page tokens in all of them.

| Role | Token / class | Neon (default) | Desk | Kobalt | Zorza | Laka | Atrament |
|---|---|---|---|---|---|---|---|
| Canvas background (no grid) | `of-bg` | `#151521` | `#0B1019` | `#0C0F16` | `#0A0B1D` | `#100D0C` | `#100F12` |
| Buy / sell candle | `of-buy` / `of-sell` | `#10FF21` / `#8A2BE2` | `#19A88E` / `#D9582E` | `#3D8EF5` / `#F4A62A` | `#5EF2B5` / `#E0407E` | `#E6BB4F` / `#E5482F` | `#A6DCCD` / `#B9707F` |
| Buy / sell flow (text, bubbles, liquidations, whales) | `text-of-buy-ink` / `text-of-sell-ink` | `#3DFF4F` / `#A66BFF` | `#35C9A8` / `#F07C55` | `#6AA9FF` / `#FFBD55` | `#7AF5C4` / `#FF6A9E` | `#F2CC6B` / `#FF6A4D` | `#B5E3D6` / `#D48B99` |
| Buy / sell imbalance | `of-imb-buy` / `of-imb-sell` | `#00FFFF` / `#FF00FF` | `#5CF2CF` / `#FF9A6A` | `#5CC8FF` / `#FFCF3F` | `#E2FF5C` / `#FFA3C8` | `#FFE69A` / `#FF9A82` | `#D9FFF2` / `#FF9FB3` |
| POC frame in a candle | `of-poc` | `#FFFF20` | `#E0A045` | `#45E3C8` | `#FFCF5C` | `#3FD4A4` | `#D9B26A` |
| Row volume | `of-vol` | `#D08A10` | `#5B7AA6` | `#5F6B80` | `#6A6F9A` | `#6E6358` | `#5F5A6A` |
| Session profile: value area / rest / POC / naked POC | — | `#555557` / `#3C6265` / `#C58109` / `#5C6166` | `#34425A` / `#1F2B3D` / `#E0A045` / `#7A889C` | `#3A4457` / `#20262F` / `#45E3C8` / `#8A94A6` | `#363A5C` / `#1F2238` / `#FFCF5C` / `#8A8EB0` | `#3D3631` / `#231F1C` / `#3FD4A4` / `#8E857A` | `#37343F` / `#211F26` / `#D9B26A` / `#7F7A8A` |
| DOM ladder: bids / asks | — | `#06AF23` / `#8A2BE2` | `#19A88E` / `#D9582E` | buy / sell | buy / sell | buy / sell | buy / sell |
| VWAP / session VWAP | `of-vwap` / `of-svwap` | `#D0D3D9` / `#14C8C8` | `#E6EBF2` / `#9085E9` | `#F2F4F8` / `#C9B8FF` | `#F5F3FF` / `#7FD0FF` | `#EFE6D8` / `#9FB4FF` | `#8FB3FF` / `#F0EDE6` |
| Order-book heatmap (weak → walls) | `of-heat-1…3` | `#017979` → `#F5E611` → `#F5290D` | `#22609A` → `#7FDCEE` → `#FFFFFF` | `#56627B` → `#A9B3C4` → `#FFFFFF` | `#5A2BA6` → `#9F50D8` → `#E6B8F4` | `#3A3794` → `#7470D6` → `#E4E2FF` | `#4B3A60` → `#66507C` → `#765E8F` |
| Exchanges: Hyperliquid / Binance / Bybit | — | `#199E70` / `#D95926` / `#3987E5` | `#3987E5` / `#C98500` / `#D55181` | `#2FC5B0` / `#C9B8FF` / `#EEF1F5` | `#7FD0FF` / `#FFCF5C` / `#F5F3FF` | `#3FD4A4` / `#EFE6D8` / `#C9A0FF` | `#A6DCCD` / `#D9B26A` / `#8FB3FF` |

Bid × Ask footprint cells are tiles from grey `#A0A0A0` (Neon) or a dark neutral of the palette (`#2A3446` Desk, `#262D3A` Kobalt, `#24263F` Zorza, `#2A2420` Laka, `#25232B` Atrament) at low volume to the saturated side colour; dark numbers on a light tile, light numbers on a dark one. The Delta and Volume styles are bars from the left edge of the candle (delta and volume in the colour of the dominant side) with light bid and ask numbers. Second channel: position (sells on the left, buys on the right), and the imbalance number is bold and outlined.

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
