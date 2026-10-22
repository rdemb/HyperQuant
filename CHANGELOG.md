# Changelog

Wszystkie istotne zmiany w projekcie. Format: [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/), wersjonowanie: [SemVer](https://semver.org/lang/pl/).

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

[2.1.0]: https://github.com/rdemb/HyperQuant/compare/5b33b4b...v2.1.0
[2.0.0]: https://github.com/rdemb/HyperQuant/commit/5b33b4b
