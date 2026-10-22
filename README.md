# HyperQuant — desk do day tradingu BTC na Hyperliquid

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/rdemb/HyperQuant/actions/workflows/ci.yml/badge.svg)](https://github.com/rdemb/HyperQuant/actions/workflows/ci.yml)
[![Live: GitHub Pages](https://img.shields.io/badge/Live-GitHub%20Pages-0b1019)](https://rdemb.github.io/HyperQuant/)
[![Stack](https://img.shields.io/badge/React%2019%20·%20Vite%208%20·%20Canvas%20·%20Three.js-PWA-3fc6dd)](https://github.com/rdemb/HyperQuant)

> **EN summary.** Open-source, mobile-installable (PWA) day-trading desk for BTC perpetuals on Hyperliquid. A live order-flow chart (order-book heatmap, aggressor bubbles, footprint, volume profile), a Plan Analyzer that scores *your* trade plan (probability of target-before-stop, slippage from the live book, liquidation buffer, EV after fees) instead of giving buy/sell signals, cross-market context from Hyperliquid's public API (Binance/Bybit funding via HL, HIP-3 equity/commodity/FX proxies, market map), an official US macro calendar, and a data-lineage page that tells you where every number comes from. Real data only; anything modelled is labelled.

**Na żywo:** https://rdemb.github.io/HyperQuant/ · instalacja na telefonie: „Udostępnij → Do ekranu początkowego” (iOS) lub „Zainstaluj aplikację” (Android/Chrome).

---

## Zasady

1. **Uczciwe dane.** Każda wartość ma znacznik `LIVE` (realne dane), `MODEL` (wynik modelu z realnych danych, metoda opisana) albo `SIM`. Brak danych to „—”, nigdy liczba zastępcza. Desk startuje dopiero po pierwszej udanej synchronizacji z API.
2. **Desk ocenia plan, nie podsuwa wejść.** Zero automatycznych sygnałów LONG/SHORT. Panele mogą tylko przekazać kierunek do Analizatora planu.
3. **Dane publiczne i legalne.** Rdzeń to publiczne API Hyperliquid. Giełdy CEX (Binance, Bybit, OKX, Coinbase) są wyłącznie opcją *opt-in* — połączenie nawiązuje przeglądarka użytkownika, do jego osobistego użytku; w wersji publicznej domyślnie wyłączone (regulaminy części giełd zabraniają publicznego pokazywania danych).
4. **Twoje dane zostają u Ciebie.** Plany, dziennik trafności i ustawienia są tylko w Twojej przeglądarce (localStorage).

## Co jest w środku

| Widok | Zawartość |
|---|---|
| **Desk** | Wykres order flow (domyślny): heatmapa arkusza L2 w czasie (kubełki 10 USD, próbkowanie 1 s, 2 h historii od otwarcia strony), bąble transakcji agresora (pole ∝ USD), footprint z nierównowagą diagonalną 3:1 i POC świecy, profil wolumenu z POC/VAH/VAL, poziomy PDH/PDL/PWH/PWL/D-EQ, strefy OB, CVD agresora i delta świec. Alternatywnie klasyczny wykres świec + Shaakuni. Obok arkusz L2 z OFI i taśma. Pas kontekstu: zasięg 2 h (Monte Carlo), głębokość arkusza, VPIN/λ, OU, odległość od VWAP sesji w σ i stan Initial Balance, funding, najbliższa publikacja makro. Szybki Analizator planu. |
| **Analizator planu** | Kierunek, wejście, stop, cel, wielkość/ryzyko %, dźwignia, horyzont → P(cel przed stopem) / P(stop) / P(żadne w horyzoncie) z Monte Carlo (≥ 2000 ścieżek, krok 5 min, σ z sezonowego log-HAR, innowacje FHS, korekta mostu Browna) z fazą wypełnienia od bieżącej ceny i P(wypełnienia), formuła dwóch barier jako punkt odniesienia, wachlarz ścieżek, poślizg z przejścia po arkuszu, EV w R po opłatach, cena likwidacji (isolated) i bufor stopu, zdarzenia makro w oknie (mnożnik wariancji). **Dziennik trafności**: zapisane plany są rozstrzygane na realnych świecach 1m z API Hyperliquid, niezależnie od interwału wykresu (najpierw wypełnienie wejścia), metryki Brier/log score, Brier P(wypełnienia) i wykres niezawodności. **Kontekst aukcji** sesji UTC: VWAP ±1σ/±2σ, Initial Balance z rozszerzeniami, profil poprzedniego dnia (POC/VAH/VAL), słabe szczyty i dna — i obok częstości historyczne z ~200 sesji BTC z przedziałami Wilsona (wybicia IB, reguła 80%, przebicie słabych vs mocnych ekstremów, dotknięcie PDH/PDL wg otwarcia). Zakładka „Plan na jutro” z mechanicznymi scenariuszami i checklistą. |
| **Rynek** | Funding HL vs Binance vs Bybit (przez API Hyperliquid, znormalizowany do APR) + z-score tłoku; proxy makro z rynków HIP-3 (S&P 500, Nasdaq-100, złoto, ropa, EUR, JPY) i udział makro w ruchu BTC (β, R²); mapa rynku perpów HL (treemap, OI/wolumen, zmiana 24 h); kalendarz Fed/BLS/BEA z odliczaniem; makro (rentowności UST, TGA, RRP), CFTC COT (CME BTC), Fear & Greed, mempool; nagłówki RSS. |
| **Lab 3D** | Pięć scen Three.js ładowanych leniwie (jedna naraz): Liquidity Canyon, Orderflow Vortex, Delta Fluid, Liquidation Risk (szacunek), Options (ilustracja) — z opisem „co widzisz / jak czytać / źródło / ograniczenia”. |
| **Mikrostruktura** | Mechanika arkusza z literatury na żywo (OFI Cont–Kukanov–Stoikov, Hawkes MLE, mikrocena Stoikova, dodane/anulowane zlecenia przy cenie, absorpcja z regresji); profil płynności i pole przyciągania U(p), reżim, trajektoria heurystyczna, OU, intensywność Hawkesa, Hurst, entropia, VPIN, λ Kyle'a, kalkulator wielkości pozycji ze stałego ryzyka. |
| **Źródła** | Rodowód każdej liczby (źródło → metoda → LIVE/MODEL → odświeżanie), atrybucje i licencje, przełącznik CEX opt-in ze statusem połączeń, dźwięk taśmy. |

## Metody (skrót) i literatura

- **Podział kupno/sprzedaż świec:** realna strona agresora z WebSocket Hyperliquid tam, gdzie desk obserwował transakcje; dla starszych świec Bulk Volume Classification `V_B = V·Φ(ΔP/σ)` (Easley, López de Prado, O'Hara 2012) — oznaczone jako MODEL.
- **VPIN:** 50 kubełków o równym wolumenie; metryka **kontrowersyjna** (Andersen & Bondarenko 2014) — czytaj względem własnej historii.
- **λ Kyle'a:** OLS `ΔP = λ·Q + ε` wyłącznie na świecach z realnym przepływem (na BVC regresja byłaby kołowa) — Kyle 1985.
- **Zmienność:** sezonowy log-HAR (Corsi 2009) na godzinowych wariancjach Garman–Klass (1980) z ~5000 świec 1h Hyperliquid (≈ 208 dni), profil godzin UTC (Andersen & Bollerslev 1997), korekta Duana (1983); prognoza iterowana na kroki 5 min. Trafność pokazywana na żywo: strata QLIKE (Patton 2011) poza próbą względem naiwnej średniej z 24 h. Udział skoków — wariancja dwupotęgowa (Barndorff-Nielsen & Shephard 2004), skoki — test Lee & Mykland (2008), obie jako diagnostyka. Brak danych → estymator Parkinsona (1980) jako oznaczony zapas.
- **Prawdopodobieństwa barier:** Monte Carlo z innowacjami z bootstrapu standaryzowanych zwrotów 5m (filtered historical simulation, Barone-Adesi i in. 1999 — grube ogony i skoki z danych) i korektą dyskretnego monitoringu z lokalnym σ kroku (Broadie, Glasserman & Kou 1997). Gdy wejście ≠ cena rynku, ścieżka najpierw musi je dotknąć; wynik jest warunkowy na wypełnienie, tak jak rozlicza dziennik. Formuła dla ruchu Browna (bez limitu czasu) jako punkt odniesienia.
- **Zasięg 2 h (pas desku):** ten sam silnik (2000 ścieżek, wspólne liczby losowe w obrębie minuty); bez modelu zmienności — Merton z założonym udziałem skoków 20% (oznaczony w pasku).
- **Hurst:** R/S z korektą Anis-Lloyd; Lo (1991) — test może mylić krótką pamięć z długą.
- **OU:** dyskretny AR(1) wokół 0.65·D-EQ + 0.35·W-EQ; bez powrotu do średniej → t½ = ∞.
- **Mapa likwidacji (panel na Desku):** zmierzona z pozycji on-chain — kubełki cen likwidacji z `clearinghouseState`, pokrycie OI jawnie; kaskada z prawa pierwiastka kwadratowego (Tóth i in. 2011; Bouchaud i in. 2018) jako górna granica.
- **Weryfikowalny dziennik desku:** co 15 min prognozy zapisywane przed faktem — rozkład zwrotu BTC na 1 h i 4 h (13 kwantyli z modelu HAR + FHS, benchmark normalny zapisany razem z prognozą) i szanse dotknięcia PDH/PDL/D-EQ w 2 h; rozstrzygane ze świec 1m. Wyniki: CRPSS względem benchmarku, PIT, pokrycia z testem Kupca, ACI (Gibbs & Candès 2021), Brier/BSS, niezawodność, kalibracja Venna–Abersa. Integralność: łańcuch hashy SHA-256 w plikach dziennych na gałęzi `ledger` repo danych (historia tylko dopisywana), po każdym slocie pokwitowanie OpenTimestamps głowy łańcucha (kalendarze od razu, blok Bitcoina po kilku godzinach), kotwice dni, jawne rekordy pominiętych slotów; niezależna weryfikacja `node scripts/verify-ledger.mjs --dir <klon gałęzi ledger> [--market] [--bitcoin]` (łańcuch, historia git, kolejność, pokwitowania, wyniki z kwantyli; `--market` — ceny rozstrzygnięć vs świece 1m Hyperliquid; `--bitcoin` — czas bloku z pokwitowań). Blok Bitcoina przychodzi zwykle po 1–6 h: dla prognoz 1 h dowodem zapisu przed faktem są kalendarze OpenTimestamps, blok potwierdza je później.
- **Przepływ kohort:** każda transakcja z publicznej taśmy HL ma adresy obu stron i stronę agresora — skaner przypisuje je do kohort (market makerzy, statystycznie poinformowani, wieloryby, reszta) i publikuje przepływ netto (zmiana zapasów; suma po kohortach = 0) oraz agresywne CVD per kohorta. „Poinformowani” = istotnie dodatni markout biorcy po 5 min (obserwacja = blok 5 min adresu, test jednostronny, kontrola FDR Benjaminiego–Hochberga q = 10%, empiryczny Bayes); markouty kohort liczone poza próbą (kohorta z chwili transakcji). Prywatność: tylko zamknięte kubełki, k-anonimowość z regułą dominacji i ukrywaniem wtórnym (suma kohort jest publiczna), osobno dla warstwy agresora, kwoty zaokrąglone do 10 tys. USD.
- **Taśma zrealizowanych likwidacji i precyzja mapy:** likwidacje śledzonych pozycji potwierdzone fillami z polem `liquidation` (Hyperliquid nie publikuje strumienia likwidacji wszystkich kont); dla każdej — o ile bp cena mark przy likwidacji różniła się od ceny likwidacji z mapy (mediana, p90). Pozycje z ceną likwidacji blisko rynku skaner odczytuje co minutę.
- **Heatmapa likwidacji na wykresie świec, order blocks, U(p):** heurystyki bez walidacji statystycznej — oznaczone jako szacunek.
- **Ocena prognoz:** Brier, log score, Brier P(wypełnienia), wykres niezawodności (Gneiting & Raftery 2007); ćwierć-Kelly dopiero po ≥ 50 rozstrzygniętych planach, z dolnej granicy Wilsona (MacLean, Thorp & Ziemba 2010).

## Źródła danych

| Źródło | Co | Uwagi |
|---|---|---|
| Hyperliquid API (`/info`, WebSocket) | świece, arkusz L2, transakcje, OI, funding (także Binance/Bybit przez `predictedFundings`), HIP-3, mapa rynku | publiczne, limit 1200 wag/min na IP użytkownika |
| Skaner HyperQuant ([backend/](backend/README.md)) | mapa likwidacji z pozycji on-chain (`clearinghouseState` portfeli z taśmy BTC) taśma zrealizowanych likwidacji (potwierdzonych fillami z polem `liquidation`) i przepływ kohort z taśmy (pole `users` + strona agresora) — bez adresów | publikowana co 2 min do publicznego repo [rdemb/hyperquant-data](https://github.com/rdemb/hyperquant-data); przeglądarka nie łączy się z serwerem skanera |
| Federal Reserve, BLS, BEA | harmonogram FOMC, CPI, NFP, PPI, PKB/PCE | dane publiczne USA |
| U.S. Treasury, FiscalData, NY Fed, CFTC | rentowności, TGA, RRP, COT | dane publiczne USA |
| alternative.me | Fear & Greed | atrybucja obok danych |
| GDELT Project | ton mediów | cytowanie + link |
| mempool.space | opłaty, trudność, hashrate | — |
| RSS (CoinDesk, Cointelegraph, Decrypt, The Block, Bitcoin Magazine, Fed, BLS, SEC) | nagłówki | tylko tytuł, czas i link do wydawcy |
| Binance, Bybit, OKX, Coinbase | transakcje i likwidacje | **wyłącznie opt-in** w przeglądarce użytkownika |

Dane publiczne spoza Hyperliquid pobiera co ~30 min workflow GitHub Actions (`scripts/fetch-public-data.mjs`, bez kluczy API) i publikuje razem ze stroną jako `data/feeds/*.json`.

## Uruchomienie lokalne

Wymagany Node.js 22. Nie są potrzebne klucze API ani plik `.env`.

```bash
git clone https://github.com/rdemb/HyperQuant.git
cd HyperQuant
npm ci --legacy-peer-deps
npm run data      # opcjonalnie: pobiera dane publiczne do public/data/feeds
npm run dev       # serwer deweloperski (Express + Vite) na http://localhost:3000
npm test          # testy Vitest
npm run build     # produkcja do ./dist (ścieżki względne, gotowe pod GitHub Pages)
```

**Własna kopia na GitHub Pages:** fork → *Settings → Pages → Source: GitHub Actions*. Workflow `.github/workflows/static.yml` przy każdym pushu na `main` i co ~30 min uruchamia testy, pobiera dane publiczne, buduje i publikuje stronę.

## Architektura

```
src/
  state/        useDeskFeed (REST + WS Hyperliquid, paczkowanie, status danych), DeskContext, CEX opt-in
  charts/       orderflow/ — magazyn order flow i renderer Canvas (heatmapa, bąble, footprint, profil)
  views/        Desk, Plan, Rynek, Lab, Mikrostruktura, Źródła (leniwie ładowane)
  components/   sceny Three.js (Lab), wykres świec + Shaakuni, taśma, panele mikrostruktury i „Plan na jutro”
  types/        typy danych rynkowych i metryk
  utils/        silniki: marketDataFeed, quantMathEngine, shaakuniEngine, planAnalyzer, forecastLedger, hlMarkets, publicFeeds, cexAdapters
  data/         oficjalny kalendarz makro
  ui/           prymitywy (Panel, Stat, Badge, Segmented…) i tokeny ruchu
  shell/        powłoka aplikacji, PWA (instalacja, aktualizacje, offline)
scripts/      pobieranie danych publicznych (GitHub Actions), generator ikon PWA
docs/STYLEGUIDE.md  tokeny kolorów (paleta zwalidowana pod daltonizm), typografia, zasady wykresów i ruchu
```

## Ograniczenia

- Publiczne API nie udostępnia historii arkusza — heatmapa, bąble i footprint powstają **od momentu otwarcia strony**.
- Funding Binance/Bybit pochodzi z prognozy publikowanej przez Hyperliquid; rynki HIP-3 to perpy-proxy, nie indeksy kasowe (poza sesją mogą stać).
- Modele (Monte Carlo, OU, VPIN, Hurst) to narzędzia opisowe; ich trafność mierzysz sam w dzienniku.
- Model zmienności widzi ~208 dni historii (API zwraca najwyżej ~5000 świec na interwał); mnożniki zdarzeń makro to nadal założenia, a selekcja negatywna przy wypełnieniu zleceń z limitem nie jest modelowana.

## Zastrzeżenie

HyperQuant jest narzędziem edukacyjnym i analitycznym. Nie jest poradą inwestycyjną, finansową ani prawną i nie generuje sygnałów transakcyjnych. Handel kontraktami z dźwignią wiąże się z wysokim ryzykiem utraty kapitału.

## Współtworzenie

Zasady, konwencje i lista kontrolna PR: [CONTRIBUTING.md](CONTRIBUTING.md) · historia zmian: [CHANGELOG.md](CHANGELOG.md) · zgłaszanie podatności: [SECURITY.md](SECURITY.md).

## Licencja

MIT — zobacz [LICENSE](LICENSE).
