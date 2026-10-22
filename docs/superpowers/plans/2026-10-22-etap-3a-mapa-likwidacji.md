# Etap 3a: mapa likwidacji i symulator kaskady — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skaner pozycji Hyperliquid na VPS publikuje do R2 zmierzoną mapę likwidacji BTC; strona pokazuje ją z pokryciem OI i krzywą wzmocnienia kaskady.

**Architecture:** Czyste moduły współdzielone `src/utils/liqMap.ts` i `src/utils/cascade.ts` (bez importów zewnętrznych). Backend `backend/scanner/*.ts` uruchamiany natywnie przez Node 24 (bez npm), czyste części testowane Vitestem z repo. Strona czyta `${VITE_DATA_BASE_URL}/liq-map/BTC.json` hookiem `useLiqMap`.

**Tech Stack:** TypeScript (erasable), Node 24 (`fetch`, `WebSocket`, `node:crypto`), React 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-22-etap-3a-mapa-likwidacji-design.md`

## Global Constraints

- Zero danych VPS w repo (adres, host, alias, użytkownik, ścieżki właściciela, klucze); przed każdym pushem grep diffu.
- Backend bez zależności npm; importy z jawnym rozszerzeniem `.ts`; tylko składnia usuwalna (bez `enum`, bez parameter properties).
- Publikowane JSON-y bez adresów. Budżet API domyślnie 240 wag/min, wycofanie przy 429/5xx.
- Polski w UI i komentarzach.

## Review Focus

1. `openInterest` z HL to jedna strona rynku — pokrycie = Σ|szi| / (2·OI), ograniczone do 1 (test T1).
2. Pozycje bez ceny likwidacji (`liquidationPx` null) liczą się do pokrycia, nie do kubełków (test T1).
3. Kaskada musi się zatrzymać (punkt stały) i nie dawać NaN przy pustej mapie lub zerowym wolumenie (test T2).
4. Błąd sieci / 429 nie może zatrzymać skanera ani wyczerpać budżetu cudzych usług — limiter z karą (test T3).
5. Strona bez `VITE_DATA_BASE_URL` lub z danymi > 10 min: „—” i oznaczenie, nigdy stara mapa jako LIVE (test T5).

---

### Task 1: `src/utils/liqMap.ts` — mapa z pozycji
- Produces: `ScannedPosition { szi; entryPx; liqPx: number | null; scannedAt }`, `LiqBucket { px; ntlUsd; n }`,
  `LiqMap { v: 1; coin; asOf; markPx; stepUsd; longs; shorts; coverage { positions; addresses; scannedBtc; oiBtc; share }; ageMin { p50; p90 }; method }`,
  `niceStep(x): number`, `buildLiqMap(positions, { coin, markPx, oiBtc, asOf, addresses, rangePct = 0.15 }): LiqMap`, `isLiqMap(x): x is LiqMap`.
- Tests: krok z {10,20,25,50,100,200,250,500,1000} najbliższy 0.1% ceny; long z liq 82 040 przy kroku 100 → kubełek 82 000, ntl = |szi|·liq; shorty osobno; poza ±15% pominięte; liq null → tylko pokrycie; pokrycie z 2·OI i cap 1; wiek p50/p90; `isLiqMap` odrzuca złe kształty.

### Task 2: `src/utils/cascade.ts` — symulator kaskady
- Consumes: `LiqMap`, `LiqBucket`.
- Produces: `impactFraction(qUsd, p: { y; sigmaDaily; dayVolumeUsd })`, `cascadeOutcome(map, shockPct, p): { finalPct; liquidatedUsd; rounds; amplification }`, `cascadeCurve(map, shocks, p)`.
- Tests: √-skalowanie (4×Q → 2× wpływ); pusta mapa → A = 1; klaster poza zasięgiem szoku → A = 1, w zasięgu → A > 1; domino trzech klastrów; strona wzrostowa ze shortami; zerowy wolumen / σ → bez NaN; zbieżność ≤ 100 rund.

### Task 3: backend — czyste klocki
- Files: `backend/scanner/rateLimiter.ts`, `addressBook.ts`, `sigv4.ts`, `positions.ts` (+ testy w `backend/scanner/__tests__/`).
- Produces: `WeightLimiter(perMin)` z `reserve(weight, now): number` (ms czekania) i `penalize(now)`; `AddressBook` z `recordTrade(users, ntlUsd, t)`, `updatePosition(addr, pos | null, t)`, `due(now, limit): string[]`, `positions(): ScannedPosition[]`, `prune(now)`, `toJSON/fromJSON`; `signV4(...)` (wektor AWS get-vanilla); `parseBtcPosition(clearinghouseState, coin, t): ScannedPosition | null`.
- Harmonogram: nowy adres od razu; pozycja ≥ 1M USD co 2 min, ≥ 100k co 10 min, inna pozycja co 30 min, bez pozycji co 120 min; usuwanie adresów bez pozycji nieaktywnych > 3 dni.

### Task 4: backend — I/O i proces
- Files: `backend/scanner/hl.ts` (REST z limiterem, WS `trades` + `activeAssetCtx` z ponownym łączeniem i ping), `r2.ts` (PUT z SigV4), `main.ts` (pętla skanu, publikacja co 60 s, zapis stanu co 5 min), `config.ts` (tylko zmienne środowiskowe), `backend/deploy/hyperquant-scanner.service`, `backend/deploy/scanner.env.example`, `backend/README.md`.
- Test: `config` odrzuca brakujące/niepoprawne wartości; `main` w trybie `--once` z zamockowanym fetch buduje i zapisuje plik (smoke).

### Task 5: strona
- Files: `src/state/useLiqMap.ts`, `src/views/market/LiquidationMapPanel.tsx` (histogram + pokrycie + A(δ) z pasmem Y), wpięcie w widok Rynek i Desk, ostrzeżenie w `PlanResult`, wiersze w Rodowodzie, README, CHANGELOG, `.github/workflows/static.yml` (`VITE_DATA_BASE_URL` z `vars`).
- Test: `liqMapFreshness(map, now)` (ready/stale) i `stopNearCluster(...)` jako czyste funkcje.

### Task 6: wdrożenie na VPS
- Node 24.22.1 (SHA-256), użytkownik `hyperquant`, `/opt/hyperquant/app` (git clone), `/var/lib/hyperquant`, usługa systemd; najpierw tryb lokalny (bez R2), weryfikacja pliku, logów i zużycia wag; instrukcja R2 dla właściciela.

### Task 7: weryfikacja i PR
- `npm run lint && npm test && npm run build`, przegląd diffu pod kątem danych VPS, recenzja, PR.
