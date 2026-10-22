# Etap 0–1: spójność + silnik zmienności — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Analizator planu i pas MC 2h liczą na sezonowym log-HAR + FHS z prawdopodobieństwami warunkowanymi wypełnieniem, a opisy w README/UI odpowiadają matematyce.

**Architecture:** Czyste funkcje w `src/utils/volatility.ts` (estymatory, HAR, profil, FHS, `buildVolModel`) i `src/utils/pathEngine.ts` (RNG, innowacje). Hook `src/state/useVolModel.ts` pobiera świece 1h/5m co 60 min i podaje `VolModel` przez `useDeskFeed` → `DeskContext`. `planAnalyzer.simulateBarrierPaths` przyjmuje opcjonalnie σ kroków, innowacje FHS i cenę startową; bez nich działa jak dotąd (zgodność testów).

**Tech Stack:** TypeScript 5, React 19, Vite 8, Vitest 5 (`npm test`), `tsc --noEmit` (`npm run lint`).

**Spec:** `docs/superpowers/specs/2026-10-22-etap-0-1-zmiennosc-design.md`

## Global Constraints

- Tylko publiczne API Hyperliquid; strona statyczna; brak nowych zależności npm.
- Brak danych → `null`/„—”, nigdy wartości zastępcze. Etykiety LIVE/MODEL/SIM jak w README.
- Polski w UI i komentarzach; nazwy w kodzie po angielsku jak w istniejących plikach.
- `PLAN_MODEL_VERSION = 'plan-fhs-har-v2'`.
- Stałe: krok MC 5 min (`VOL_STEP_MIN = 5`), ≥ 2000 ścieżek, próg `fillRare` < 200 wypełnionych ścieżek, LM α = 0.01 i K = 288,
  ściąganie profilu K = 20, okna HAR 24 i 168, podział OOS 70/30, odświeżanie modelu 60 min, min. 1000 świec 1h i 1500 świec 5m.

## Review Focus

1. Świeca w toku z API (ostatnia) nie może trafić do estymacji — `buildVolModel` odrzuca świece z `t + interwał > now` (test w Task 2).
2. Świeca z H = L lub cenami ≤ 0 nie może dać `-Infinity`/`NaN` w HAR — filtr i podłoga ε (test w Task 1/2).
3. Horyzont 30 min zaczynający się w połowie godziny musi brać wariancję z dwóch godzin proporcjonalnie (test w Task 2).
4. Wejście daleko od rynku → prawie zero wypełnień; wynik nie może być NaN — `fillRare` i symulacja od wejścia (test w Task 3).
5. Stare wpisy dziennika bez `pFill` muszą się wczytać i nie psuć metryk (test w Task 4).

---

### Task 1: Estymatory zmienności i skoków

**Files:**
- Create: `src/utils/volatility.ts`
- Test: `src/utils/__tests__/volatility.test.ts`

**Interfaces:**
- Produces:
  - `interface RangeBar { time: number; open: number; high: number; low: number; close: number }`
  - `isValidBar(b: RangeBar): boolean` — wszystkie ceny > 0 i skończone, high ≥ max(open, close), low ≤ min(open, close)
  - `parkinsonVar(b)`, `garmanKlassVar(b)`, `rogersSatchellVar(b): number` (wariancja log na świecę)
  - `yangZhangVar(bars: RangeBar[]): number` (na świecę; NaN gdy < 2 świece)
  - `logReturns(closes: number[]): number[]`, `realizedVariance(r)`, `bipowerVariation(r): number`
  - `interface JumpShare { share: number; rv: number; bv: number; days: number }`, `jumpShareByDay(bars: RangeBar[], barMs: number): JumpShare | null`
  - `leeMyklandJumps(r: number[], window = 288, alpha = 0.01): number[]` (indeksy w `r`)

- [ ] **Step 1: Testy (padają)** — `volatility.test.ts`:
  - bar O=100 H=110 L=95 C=105: `parkinsonVar` = ln(110/95)²/(4 ln2); `garmanKlassVar` = 0.5·ln(110/95)² − (2ln2−1)·ln(1.05)²; `rogersSatchellVar` = ln(110/105)ln(110/100)+ln(95/105)ln(95/100) (toBeCloseTo 12).
  - GBM (mulberry32, seed 42, σ_krok = 0.002, 20 podkroków na świecę, 2000 świec): `yangZhangVar`, `garmanKlassVar` (średnia) w ±10% od 20·σ².
  - 5000 zwrotów N(0, 0.001²): `bipowerVariation/realizedVariance` w [0.95, 1.05]; po dodaniu skoku 0.02 w i=2500: `jumpShare` z pojedynczego „dnia” ≈ 0.02²/RV (±25%).
  - `leeMyklandJumps` wykrywa i=2500; na czystym szumie (seed 7, 5000 zwrotów) ≤ 2 fałszywe.
  - `isValidBar` odrzuca H<L, cenę 0, NaN; estymatory na barze H=L dają 0, nie NaN.
- [ ] **Step 2:** `npx vitest run src/utils/__tests__/volatility.test.ts` → FAIL (brak modułu).
- [ ] **Step 3: Implementacja.** YZ: o_i = ln(O_i/C_{i−1}), c_i = ln(C_i/O_i), V = Var(o) + k·Var(c) + (1−k)·mean(RS), k = 0.34/(1.34 + (n+1)/(n−1)), wariancje z n−1. BV = (π/2)·Σ_{i≥1}|r_i||r_{i−1}|·n/(n−1). `jumpShareByDay`: grupy wg dnia UTC, tylko dni z ≥ 90% oczekiwanych świec (86400000/barMs), share = Σmax(RV−BV,0)/ΣRV; null gdy 0 dni. LM: σ̂²_i = Σ_{j=i−K+2}^{i−1}|r_j||r_{j−1}|/(K−2); L_i = r_i/σ̂_i; c = √(2/π), n = r.length, C_n = √(2 ln n)/c − (ln π + ln ln n)/(2c√(2 ln n)), S_n = 1/(c√(2 ln n)), β* = −ln(−ln(1−α)); skok gdy (|L_i| − C_n)/S_n > β*; testowane i ≥ K.
- [ ] **Step 4:** ten sam vitest → PASS.
- [ ] **Step 5:** commit `feat(vol): estymatory zakresowe, wariancja dwupotęgowa, udział skoków, test Lee–Mykland`.

### Task 2: Profil sezonowy, log-HAR, FHS, `buildVolModel`

**Files:**
- Modify: `src/utils/volatility.ts`
- Test: `src/utils/__tests__/volatility.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `interface SeasonalProfile { factors: number[] /* 24, średnia 1 */; counts: number[] }`, `seasonalProfile(bars: RangeBar[], shrinkK = 20): SeasonalProfile`
  - `interface HarModel { coef: [number, number, number, number]; smear: number; n: number; r2: number; oos: { qlikeHar: number; qlikeNaive: number; n: number } | null; lastY: number[] /* ostatnie 168 */ }`
  - `fitSeasonalHar(bars: RangeBar[], profile: SeasonalProfile): HarModel | null` (null gdy < 500 użytecznych godzin)
  - `qlike(realized: number, forecast: number): number` = r/f − ln(r/f) − 1
  - `forecastHourlyVariances(m: HarModel, p: SeasonalProfile, firstHourStartMs: number, hours: number): number[]`
  - `stepSigmas(hourVars: number[], firstHourStartMs: number, startMs: number, horizonMin: number, stepMin: number): number[]`
  - `fhsResiduals(bars5m: RangeBar[], p: SeasonalProfile, window = 288): Float64Array` (średnia 0, wariancja 1)
  - `interface VolModel { builtAt: number; profile: SeasonalProfile; har: HarModel; residuals: Float64Array; jump: JumpShare | null; lmJumps: { count: number; days: number; maxAbsMovePct: number }; hourlyBars: number; fiveMinBars: number; nextHourStartMs: number }`
  - `buildVolModel(hourly: RangeBar[], fiveMin: RangeBar[], nowMs: number): VolModel | null`
  - `horizonStepSigmas(m: VolModel, nowMs: number, horizonMin: number, stepMin?: number): number[]`
  - `VOL_STEP_MIN = 5`

- [ ] **Step 1: Testy (padają):**
  - `seasonalProfile`: 200 dni świec 1h, godzina 14 UTC z wariancją 3× → `factors[14]/factors[3]` ∈ [2.5, 3.5], średnia factors = 1 (±1e-9).
  - `fitSeasonalHar` na symulowanym procesie y_{t+1} = −0.5 + 0.4y_t + 0.3D_t + 0.2W_t + 0.3ε (5000 h, świece z GK zgodnym z exp(y)): b1, b2, b3 w ±0.08; `oos` ≠ null i `qlikeHar < qlikeNaive`.
  - `forecastHourlyVariances` dla 2000 godzin → ostatnie wartości (deseasonalizowane) zbiegają do exp(b0/(1−b1−b2−b3))·smear (±5%).
  - `stepSigmas`: hourVars [1e-4, 4e-4], start w :30 pierwszej godziny, horyzont 60, krok 5 → Σσ² = 0.5e-4 + 2e-4 (±1e-12), 12 kroków.
  - `qlike(2,2) = 0`, `qlike(1,2) > 0`.
  - `fhsResiduals`: średnia |·| < 0.02, wariancja ∈ [0.98, 1.02].
  - `buildVolModel`: ostatnia świeca z `t + 1h > now` jest pomijana (`hourlyBars` = n−1); < 1000 świec 1h lub < 1500 5m → null; świece z H=L nie dają NaN w `coef`.
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3: Implementacja.** Profil: m_h = średnia GK w godzinie h UTC, m = średnia ogólna, f_h = (n_h·m_h + K·m)/((n_h+K)·m), potem f /= mean(f). HAR: y_t = ln(max(GK_t, 1e-12)/f_h(t)); X = [1, y_t, mean(y_{t−23..t}), mean(y_{t−167..t})], cel y_{t+1}; OLS równaniami normalnymi 4×4 (eliminacja Gaussa z wyborem elementu głównego); smear = mean(exp(e)); OOS: dopasowanie na pierwszych 70% wierszy, prognoza wariancji f·exp(ŷ)·smear vs realizacja GK_{t+1}, naiwny = mean(GK_{t−23..t}); QLIKE pomija realizacje ≤ 0; końcowy model na wszystkich wierszach. Prognoza iterowana: dopisuj ŷ do bufora y i przeliczaj średnie 24/168. `stepSigmas`: wariancja kroku = Σ_h (minuty wspólne kroku i godziny h)/60·hourVars[h]. FHS: r_i = ln(C_i/C_{i−1}), σ̂²_i = f_h(i)·mean(GK_j/f_h(j), j ∈ [i−window, i−1]); z = r/σ̂, potem (z − mean)/sd. `buildVolModel`: filtr świec w toku i nieważnych, profil i HAR z 1h, FHS + `jumpShareByDay` (barMs 300000) + LM na zwrotach 5m podzielonych przez √f_h; `maxAbsMovePct` = max |r| wykrytych skoków·100; `nextHourStartMs` = start ostatniej pełnej godziny + 1h. `horizonStepSigmas`: godzin = ceil((now + horyzont − nextHourStartMs)/1h)+1, `forecastHourlyVariances(..., nextHourStartMs, ...)`, potem `stepSigmas`.
- [ ] **Step 4:** vitest → PASS.
- [ ] **Step 5:** commit `feat(vol): sezonowy log-HAR z QLIKE poza próbą, profil godzinowy, innowacje FHS, buildVolModel`.

### Task 3: Silnik ścieżek FHS i wynik warunkowany wypełnieniem

**Files:**
- Create: `src/utils/pathEngine.ts`
- Modify: `src/utils/planAnalyzer.ts` (`simulateBarrierPaths`, `PlanInput`, `McResult`, `analyzePlan`, `PLAN_MODEL_VERSION`, nagłówek)
- Test: `src/utils/__tests__/planAnalyzer.test.ts`, `src/utils/__tests__/pathEngine.test.ts`

**Interfaces:**
- Consumes: `VOL_STEP_MIN` (Task 2).
- Produces:
  - `pathEngine.ts`: `mulberry32(seed): () => number`, `normalGen(u): () => number`, `makeInnovation(u: () => number, residuals: ArrayLike<number> | null): () => number`, `seedFrom(...xs: number[]): number`
  - `PlanInput` + `vol?: { stepMin: number; stepSigmas: number[]; residuals: ArrayLike<number> | null }`, `startPrice?: number`
  - `McResult` + `pFill: number; fillRare: boolean; stepMin: number`
  - `simulateBarrierPaths` parametry + `stepSigmas?: number[]; stepMin?: number; residuals?: ArrayLike<number> | null; startPrice?: number`

- [ ] **Step 1: Testy (padają):**
  - `makeInnovation` z residuals = [−1, 1] zwraca tylko ±1; z null — średnia ≈ 0, wariancja ≈ 1 (10⁵ losowań).
  - Stałe σ: `stepSigmas` = 24 × (σ_h/√24), stepMin 5, residuals null (horyzont 120) → pTarget w ±0.02 od dotychczasowego wyniku 1-min dla tych samych wejść.
  - `startPrice === entry` → `pFill === 1`, `fillRare === false`.
  - LONG, wejście 2σ_h poniżej `startPrice` → 0 < pFill < 0.6, pTarget+pStop+pNeither = 1 (±1e-9).
  - Wejście 8σ_h od rynku → `fillRare === true`, prawdopodobieństwa skończone i sumują się do 1.
  - Ten sam seed → identyczny wynik; `analyzePlan` z `vol` i `startPrice` przekazuje je do symulacji (pFill w wyniku).
  - Wszystkie dotychczasowe testy planAnalyzer przechodzą bez zmian.
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3: Implementacja.** Przenieś `mulberry32`/`normalGen` do `pathEngine.ts`. Bez `stepSigmas`: dotychczasowe kroki 1-min, stała σ (zgodność). Z `stepSigmas`: σ_k = stepSigmas[k]·√mult, czasy w minutach = k·stepMin, korekta mostu z varStep_k = σ_k². Faza wypełnienia (gdy `startPrice` ≠ `entry`): proces w log-cenie od startu; wypełnienie gdy krok przecina ln(entry) lub most (ten sam wzór, d = odległość od ln(entry)); w kroku wypełnienia x = side·ln(P_k/E), stop gdy x ≤ −a, cel gdy x ≥ b; dalej wyścig w pozostałych krokach. Ścieżki bez wypełnienia nie wchodzą do pTarget/pStop/pNeither ani pasma. Gdy wypełnień < 200: ponowna symulacja od wejścia (startPrice = entry) z tym samym seedem, `fillRare = true`, `pFill` z pierwszej symulacji. Pasmo i ścieżki do wykresu startują od wejścia w chwili wypełnienia (jak dotąd od entry). `sigmaEff` = √(Σσ_k²·mult). Nagłówek pliku i `PLAN_MODEL_VERSION`.
- [ ] **Step 4:** `npx vitest run src/utils/__tests__/planAnalyzer.test.ts src/utils/__tests__/pathEngine.test.ts` → PASS.
- [ ] **Step 5:** commit `feat(plan): Monte Carlo FHS z σ kroków HAR i fazą wypełnienia zgodną z dziennikiem`.

### Task 4: Dziennik — `pFill` i Brier wypełnienia

**Files:**
- Modify: `src/utils/forecastLedger.ts`, `src/views/plan/LedgerPanel.tsx`, `src/views/PlanView.tsx` (zapis `pFill`)
- Test: `src/utils/__tests__/forecastLedger.test.ts`

**Interfaces:**
- Produces: `LedgerEntry.pFill?: number`; `LedgerMetrics.brierFill: number | null; fillScored: number`.

- [ ] **Step 1: Testy (padają):** `makeEntry` z `pFill: 0.4` zachowuje pole; `loadLedger` wczytuje wpis bez `pFill` i z `pFill`; `ledgerMetrics`: wpisy {pFill 0.8, status target}, {pFill 0.3, nofill}, {bez pFill, stop} → `brierFill` = ((0.8−1)² + (0.3−0)²)/2, `fillScored` = 2; pozostałe metryki bez zmian (nofill dalej poza nimi).
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3:** Implementacja + `LedgerPanel` pokazuje „Brier wypełnienia” (z n) obok istniejących metryk; `PlanView.onSave` zapisuje `pFill: analysis.mc.pFill`.
- [ ] **Step 4:** vitest → PASS.
- [ ] **Step 5:** commit `feat(ledger): prawdopodobieństwo wypełnienia i jego Brier`.

### Task 5: Dane modelu i pas MC 2h

**Files:**
- Create: `src/state/useVolModel.ts`
- Modify: `src/utils/marketDataFeed.ts` (eksport `postInfo`, `parseHlCandles`, `runMertonMonteCarloEngine` → `runTouchMonteCarlo` z opcjonalnym `VolModel`, opcja `volModel` w `fetchRealHyperliquidMarketData`), `src/state/useDeskFeed.ts` (zwraca `vol`)
- Test: `src/utils/__tests__/marketDataFeed.test.ts`

**Interfaces:**
- Consumes: `buildVolModel`, `horizonStepSigmas`, `VolModel` (Task 2); `pathEngine` (Task 3).
- Produces:
  - `parseHlCandles(raw: unknown): RangeBar[]` (pomija rekordy nieskończone)
  - `useVolModel(): { status: 'loading' | 'ready' | 'error'; model: VolModel | null }` (cache modułowy, odświeżanie 60 min, pauza w ukrytej karcie, błąd zostawia poprzedni model)
  - `DeskFeed.vol` = wynik `useVolModel()`
  - `runTouchMonteCarlo(price, pdh, pdl, deq, sigma2h, opts?: { vol?: VolModel | null; nowMs?: number }): BackendQuantTelemetry['monteCarlo'] & { method: 'fhs-har' | 'merton-assumed' }`

- [ ] **Step 1: Testy (padają):** `parseHlCandles` na próbce `{t,o,h,l,c}` jako stringi; `runTouchMonteCarlo` bez vol → `method: 'merton-assumed'`, dwa wywołania z tymi samymi wejściami dają identyczny wynik (deterministyczny seed); z vol (stałe σ, residuals null) → `method: 'fhs-har'`, P(touch PDH) rośnie z σ; brak OU (poziom D-EQ = cena ± 0 → P ≈ 1 przy dowolnym σ > 0).
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3:** Implementacja. 2000 ścieżek, seed `seedFrom(round(price), round(pdh), round(pdl), floor(now/60000))`; z vol: kroki 5 min z `horizonStepSigmas(vol, now, 120)`, innowacje FHS; bez vol: dotychczasowy Merton (20% — założenie) bez OU. `BackendQuantTelemetry['monteCarlo']` w `types/trading.ts` dostaje `method`. `useDeskFeed` trzyma model w ref przekazywanym do `fetchRealHyperliquidMarketData`.
- [ ] **Step 4:** vitest → PASS; `npm run lint` → 0 błędów.
- [ ] **Step 5:** commit `feat(feed): model zmienności z API HL i pas MC 2h na HAR+FHS`.

### Task 6: UI Analizatora, pasa i rodowodu

**Files:**
- Modify: `src/views/plan/hooks.ts`, `src/views/PlanView.tsx`, `src/views/plan/PlanResult.tsx`, `src/views/plan/PlanForm.tsx` (jeśli pokazuje źródło σ), `src/views/desk/DeskRail.tsx`, `src/views/sources/LineageTable.tsx`

**Interfaces:**
- Consumes: `DeskFeed.vol`, `horizonStepSigmas`, `McResult.pFill/fillRare`.
- Produces: `PlanMarket` + `vol: { stepMin: number; stepSigmas: number[]; residuals: Float64Array | null } | null; volModel: VolModel | null; sigmaFor(h: number): number`.

- [ ] **Step 1:** `usePlanMarket`: gdy `vol.model` gotowy → `stepSigmas` z `horizonStepSigmas(model, nowTick, horizon)`, σ = √Σσ²; źródło `MODEL` z tytułem „sezonowy log-HAR + FHS”; inaczej Parkinson jak dotąd z tytułem „zapas: model zmienności niedostępny”. `PlanView` przekazuje `vol` i `startPrice: market.price` (gdy skończona) do `PlanInput`; `sigmaFor` z `market.sigmaFor`.
- [ ] **Step 2:** `PlanResult`: linia „P(wypełnienia w horyzoncie) x%” gdy pFill < 0.999; przy `fillRare` ostrzeżenie „Wejście rzadko osiągane — wynik przy założeniu natychmiastowego wypełnienia”; karta „Model zmienności” (σ horyzontu, udział skoków z liczbą dni, skoki LM / dni, QLIKE HAR vs naiwny jako % poprawy z n, liczność świec); Metodologia i Źródła: Yang & Zhang 2000, Garman & Klass 1980, Barndorff-Nielsen & Shephard 2004, Lee & Mykland 2008, Corsi 2009, Duan 1983, Patton 2011, Barone-Adesi i in. 1999, Andersen & Bollerslev 1997; usunięcie zdania „Ocena startuje w chwili wejścia…”.
- [ ] **Step 3:** `DeskRail`: tytuł znacznika wg `monteCarlo.method`; `LineageTable`: wiersz „Model zmienności” + poprawiony wiersz Monte Carlo.
- [ ] **Step 4:** `npm run lint && npm test` → 0 błędów, wszystkie testy PASS.
- [ ] **Step 5:** commit `feat(ui): model zmienności i P(wypełnienia) w Analizatorze, pas MC i rodowód`.

### Task 7: Etap 0 — opisy, weryfikacja na żywo

**Files:**
- Modify: `README.md` (sekcja Metody i Ograniczenia), `src/utils/quantMathEngine.ts:14-21` (nagłówek), `src/views/lab/scenes.tsx:60` (opis MC)

- [ ] **Step 1:** README: σ = sezonowy log-HAR + FHS (zapas: Parkinson), bariery = FHS + most BGK + faza wypełnienia; usunięty fałszywy „Merton w barierach”; Merton tylko jako zapas pasa 2h (założenie 20%); nagłówek quantMathEngine bez „Neural Network Forecaster & Real-Time Signal Generator” (heurystyczna kombinacja liniowa, nie sieć, nie sygnał); scena Lab zgodna z `method`.
- [ ] **Step 2:** `npm run lint && npm test && npm run build` → sukces.
- [ ] **Step 3:** `npm run dev`, w przeglądarce widok Plan: karta „Model zmienności” ma liczby z API (nie „—” po ~5 s), P(wypełnienia) pojawia się dla wejścia 1% od rynku, brak błędów w konsoli; pas „Zasięg 2h” ma znacznik metody HAR+FHS.
- [ ] **Step 4:** commit `docs: opisy metod zgodne z kodem (etap 0)`.
