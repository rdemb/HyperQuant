# Changelog

Wszystkie istotne zmiany w projekcie. Format: [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/), wersjonowanie: [SemVer](https://semver.org/lang/pl/).

## [Unreleased]

### Dodane
- **Nadzór danych** (`.github/workflows/data-health.yml`, `scripts/check-data-health.mjs`): co 30 min kontrola świeżości publikacji skanera, pokrycia open interest i opóźnienia odczytów pozycji oraz strażnik prywatności (alarm, gdyby w publikacji pojawił się adres portfela lub IP); problem otwiera zgłoszenie `alert-danych`, powrót danych je zamyka.

- **Taśma zrealizowanych likwidacji** (`backend/scanner/liqDetect.ts`, `src/utils/liqTape.ts`, panel na Desku): skaner wykrywa zmniejszenie śledzonej pozycji przy jej cenie likwidacji i potwierdza je w fillach konta (pole `liquidation`, metoda market/backstop); publikuje `liq-tape/BTC.json` — zdarzenia z 24 h, sumy 1 h / 24 h, kubełki 5 min — bez adresów i identyfikatorów transakcji.
- **Precyzja mapy likwidacji**: dla każdej potwierdzonej likwidacji błąd ceny likwidacji z mapy względem ceny mark w chwili likwidacji (mediana |błędu|, p90, mediana ze znakiem).
- **Skanowanie adaptacyjne**: pozycje z ceną likwidacji < 1% od ceny mark odczytywane co 1 min (< 3%: najwyżej co 2 min).

### Zmienione
- Wdrożenie GitHub Pages na Node 24 (jak CI i skaner).
- Hook danych skanera wspólny dla mapy i taśmy (`usePublished`): pamięć podręczna, odświeżanie co minutę tylko w widocznej karcie, starsza odpowiedź nie cofa nowszej.

### Naprawione
- `status.json` pokazywał `seeded: 0` po każdym restarcie skanera (licznik tylko w pamięci); konta z rankingu bez pozycji BTC wypadały co 3 dni i wracały z zasiewem (zbędne ponowne odczyty).

## [2.2.0] — 2026-10-22

Mapa likwidacji z pozycji on-chain i symulator kaskady ([#8](https://github.com/rdemb/HyperQuant/pull/8), [#12](https://github.com/rdemb/HyperQuant/pull/12)), aktualizacje zależności ([#9](https://github.com/rdemb/HyperQuant/pull/9)).

### Dodane
- **Mapa likwidacji z pozycji on-chain** zamiast szacunku: skaner na serwerze zbiera adresy portfeli z publicznej taśmy BTC (pole `users`), oraz z publicznego rankingu kont (zasiew 5000 największych co 6 h), odczytuje ich pozycje i ceny likwidacji (`clearinghouseState`) i publikuje wyłącznie agregaty (kubełki, pokrycie open interest, wiek odczytów ważony nominałem).
- **Symulator kaskady likwidacji**: punkt stały szok → likwidacje → wpływ ceny z prawa pierwiastka kwadratowego (Tóth i in. 2011), krzywa szok → ruch końcowy z pasmem dla Y 0.5–1.5.
- Panel „Mapa likwidacji i kaskada” na Desku (histogram, najbliższe klastry, tabela) i ostrzeżenie w Analizatorze, gdy stop leży w klastrze likwidacji.
- Publikacja danych skanera do publicznego repo [rdemb/hyperquant-data](https://github.com/rdemb/hyperquant-data) (bez kosztów i kont w chmurze): jeden commit z bieżącym stanem co 2 min, neutralne metadane, klucz wdrożeniowy tylko na serwerze; Cloudflare R2 jako opcja.
- Backend `backend/scanner` bez zależności npm (Node 24): własny budżet wag API, harmonogram skanów wg wielkości pozycji, podpis SigV4 sprawdzony wektorem AWS, usługa systemd z limitami zasobów, instalator.

### Zmienione
- Zależności: lucide-react 1.59, motion 14.3 (używane API bez zmian; poprawki AnimatePresence), Express 5.3 (fallback SPA serwera produkcyjnego jako middleware — Express 5 odrzuca ścieżkę '*'), vitest 5.0.5; typy Node przypięte do wersji uruchomieniowej (24); TypeScript 7.0.2; motion 14.3.1.

## [2.1.0] — 2026-10-22

Silnik zmienności i spójność modelu z dziennikiem trafności ([#1](https://github.com/rdemb/HyperQuant/pull/1)).

### Dodane
- **Model zmienności** (`src/utils/volatility.ts`): sezonowy log-HAR (Corsi 2009) na godzinowych wariancjach Garman–Klass z ~5000 świec 1h Hyperliquid, profil godzin UTC, korekta Duana dla każdego horyzontu prognozy; innowacje FHS (Barone-Adesi i in. 1999) ze standaryzowanych zwrotów 5m; udział skoków (wariancja dwupotęgowa, BNS 2004) i test Lee–Mykland (2008); trafność QLIKE (Patton 2011) poza próbą w UI.
- **P(wypełnienia)** w Analizatorze planu: Monte Carlo startuje od bieżącej ceny, zlecenie z limitem musi najpierw zostać dotknięte; wynik warunkowy na wypełnienie.
- Karta „Model zmienności” w Analizatorze; Brier P(wypełnienia) w dzienniku; wiersze w Rodowodzie danych.
- Test integracyjny zgodności Monte Carlo z rozstrzyganiem dziennika (ścieżki 1 s → świece 1m).
- CI dla pull requestów (typy, testy, build).

### Zmienione
- Monte Carlo Analizatora: kroki 5 min z σ z modelu zmienności i korektą mostu Browna z lokalnym σ (zapas: stała σ Parkinsona).
- Pas „Zasięg 2h”: ten sam silnik, 2000 ścieżek, wspólne liczby losowe w obrębie minuty, bez nieestymowanego przyciągania OU; Merton tylko jako oznaczony zapas.
- Dziennik rozstrzyga plany na świecach 1m z API, niezależnie od interwału wykresu; wejście w granicy 1 bp od rynku = zlecenie rynkowe (ta sama reguła w modelu).
- Wpisy dziennika zapisują faktycznie użytą wersję modelu (`plan-fhs-har-v2` / `plan-har-normal-v2` / `plan-gbm-fill-v2`) i flagę `fillRare`.
- Akcje GitHub bez przestarzałego Node 20 (checkout v7, setup-node v7, upload-pages-artifact v5, deploy-pages v5).

### Naprawione
- README twierdziło, że prawdopodobieństwa barier Analizatora zawierają skoki Mertona — nie zawierały.
- Szybka karta na Desku liczyła bez modelu zmienności mimo etykiety HAR+FHS.
- Liczby pasa 2h skakały losowo przy każdej synchronizacji (ziarno z ceny i warunkowe losowania mostu).

## [2.0.0] — 2026-10-21

Przebudowa desku i poprawki krytyczne.

### Dodane
- Wykres order flow: heatmapa arkusza L2, bąble agresora, footprint, profil wolumenu, CVD.
- Analizator planu (P cel przed stopem, poślizg, likwidacja, EV) i dziennik trafności.
- Widok Rynek: funding HL/Binance/Bybit przez API Hyperliquid, proxy makro z rynków HIP-3, mapa rynku, kalendarz Fed/BLS/BEA, dane publiczne pobierane przez GitHub Actions.
- Widok Źródła z rodowodem liczb i licencjami; giełdy CEX wyłącznie opt-in.
- PWA (manifest, service worker, instalacja), nowa powłoka i tokeny, Lab 3D, Mikrostruktura.

### Zmienione
- Uczciwe dane: brak świec i liczb zastępczych, BVC zamiast syntetycznego podziału wolumenu, `null` zamiast stałych.
- Kalman z kowariancją, VPIN na kubełkach wolumenu, λ Kyle'a z OLS, Hurst z korektą Anis-Lloyd.
- WebSocket: ponowne łączenie, ping, rollover świec, deduplikacja, paczkowanie.

### Usunięte
- Automatyczne sygnały i przeliczanie Kelly → dźwignia; nieużywane `.env.example` i zależność `dotenv`.

[2.2.0]: https://github.com/rdemb/HyperQuant/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/rdemb/HyperQuant/compare/5b33b4b...v2.1.0
[2.0.0]: https://github.com/rdemb/HyperQuant/commit/5b33b4b
