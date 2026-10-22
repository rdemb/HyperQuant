# Changelog

Wszystkie istotne zmiany w projekcie. Format: [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/), wersjonowanie: [SemVer](https://semver.org/lang/pl/).

## [Unreleased]

### Dodane
- **Ensemble model + rynek w weryfikowalnym dzienniku** (`src/utils/ensemble.ts`, `backend/scanner/forecaster.ts`, karta w panelu dziennika, kolumna w panelu „Model vs rynek”): uogólniony pooling logarytmiczny `logit p_e = a + b_m·logit(p_model) + b_k·logit(środek rynku)`, wagi dopasowane (regresja logistyczna IRLS z priorem w stronę równego poolingu, półtrwanie 14 dni, od 50 par) w chwili wydania wyłącznie na wcześniej rozstrzygniętych 15-minutowych pytaniach HIP-4 z wąskim spreadem; `p_e` i wagi zapisywane w rekordzie przed faktem, Brier i log score ensemble obok modelu i rynku, różnica ensemble − rynek z bootstrapem; weryfikator sprawdza wzór `p_e` z zapisanych wag i że wagi nie użyły przyszłych wyników. Waga modelu bliska zeru = model nic nie dodaje do ceny rynku.
- **Laboratorium folkloru** (`src/utils/labEvents.ts`, `src/utils/anytime.ts`, `src/utils/folkloreLab.ts`, `backend/scanner/labRunner.ts`, karta w widoku Plan): 10 popularnych reguł day tradingu BTC (okrągły poziom jako opór / wsparcie, zebranie PDH / PDL → powrót, wybicie IB, powrót do VWAP z 2σ, luka CME, skrajne finansowanie → flush, „dump o 10:00 w NY”, momentum śróddzienne) oraz kontrola pozytywna (weekend spokojniejszy) i negatywna (poziomy nieokrągłe). Reguły barierowe to zdarzenia z dwiema barierami, z dokładnym p0 pod hipotezą martyngału z twierdzenia o opcjonalnym zatrzymaniu; reguły kalendarzowe mają p0 = 0,5 z symetrii znaku albo wymienialności. Limit czasu daje wynik ułamkowy (bez obciążenia od odrzucania), a minimalna szerokość pasma ogranicza niejednoznaczne świece; kalibrację pod H0 sprawdzono symulacją. Historia (eksploracja): p i q Benjaminiego–Hochberga. Do przodu (potwierdzenie): katalog prerejestrowany w łańcuchu dziennika z pokwitowaniem OTS — z wektorem kontrolnym (hash wyniku silnika na stałych danych), więc wiąże także kod — ocena zdarzeń od 24 h po zapisie, e-wartości z procesu zakładów (ważne przy każdym podglądzie), e-BH osobno dla potwierdzeń i obaleń, sekwencja ufności efektu. Wszystkie zdarzenia do przodu publikowane do przeliczenia.
- **Archiwum świec** (`backend/scanner/candleArchive.ts`, gałąź `archive` repo danych): zamknięte (co najmniej minutę) świece BTC 1m / 1h / 1d i godzinowe finansowanie w CSV, tylko dopisywanie — historia przestaje znikać z limitem ~5000 świec API. Odporne na ucięty zapis (obcięcie do ostatniego pełnego wiersza, ścisły odczyt, commit odrzuca plik bez końcowej nowej linii).
- Weryfikator dziennika sprawdza rekordy prerejestracji (hash katalogu, kolejność czasów).
- **Strażnik skanera na serwerze** (`scripts/watchdog.mjs`, `backend/deploy/hyperquant-watchdog.{service,timer}`): co 15 min ta sama ocena zdrowia danych co nadzór w GitHub Actions (którego harmonogram GitHub pomija), niezależnie od GitHuba. Samonaprawa: restart skanera w stanie `failed`, przy braku lokalnej publikacji > 10 min albo stojącej publikacji, dzienniku prognoz lub rejestratorze płynności — działającej usługi dopiero po godzinie jej działania, najwyżej 3 razy w epizodzie; bez restartu przy błędach sieci, problemach jakości i ręcznym zatrzymaniu. Alarm: stan w gałęzi `health` repo danych po potwierdzeniu w dwóch przebiegach (prywatność — od razu), przypomnienie co 6 h; push uruchamia workflow otwierający / komentujący / zamykający zgłoszenie `alert-danych`. Root z własnym katalogiem stanu (`StateDirectory`, `ProtectSystem=strict`), commity w UTC.

### Zmienione
- `scripts/check-data-health.mjs` eksportuje `fetchInput` (wspólne pobieranie dla nadzoru i strażnika); pilnuje świeżości `lab/BTC.json` (3 h), a strażnik restartuje skaner przy stojącym laboratorium.
- Magazyn gałęzi tylko do dopisywania (`ledgerStore`) obsługuje dowolną gałąź i pliki `.csv`.
- README repo danych: lista plików w jednym miejscu, opis gałęzi `health`.

## [2.3.0] — 2026-10-22

### Dodane
- **Rejestrator płynności arkusza** (`backend/scanner/liquidity.ts`, subskrypcja `l2Book` w strumieniu skanera z agregacją dobieraną do ceny (20 poziomów pokrywa ±20 bp), panel „Płynność arkusza w ciągu doby” w widoku Mikrostruktura): skaner co ~5 s liczy głębokość obu stron w ±10 i ±20 bp od środka, przechowuje minutowe mediany na serwerze (30 dni) i publikuje wyłącznie agregaty (`liquidity/BTC.json`): mediana głębokości wg godziny UTC, bieżąca płynność względem normy tej godziny, odporność (minuty do powrotu głębokości po ruchu ≥ 15 bp); nadzór danych pilnuje świeżości profilu.
- **Model vs rynek w weryfikowalnym dzienniku** (`backend/scanner/marketQuotes.ts`, `forecaster.ts`, `ledgerRunner.ts`, weryfikator, karta w panelu dziennika): co 15 min, 5–10 min przed terminem, skaner zapisuje w łańcuchu hashy notowanie rolującego 15-minutowego rynku HIP-4 na BTC („mark ≥ ceny z początku kwadransa”) i p z modelu desku z tej samej chwili; osobne pokwitowanie OpenTimestamps partii; rozstrzygnięcie ze świecy 1m w terminie z oznaczeniem wyników blisko progu (≤ 0,05%); Brier i log score modelu i rynku na tych samych pytaniach na dwóch poziomach (notowania płynne i z wąskim spreadem), różnica z bootstrapem parowanym, werdykt od 100 pytań; weryfikator przelicza wynik z ceny i progu, sprawdza cenę ze świecą (`--market`) i pokwitowania per partia.
- **Dziennik zagrań i playbook** (`src/utils/tradeJournal.ts`, `src/state/useJournal.ts`, zakładka w widoku Plan): setupy w szablonie kontekst → lokalizacja → wyzwalacz → wykonanie → unieważnienie; zagrania z wynikiem w R od stopu początkowego; MAE/MFE w R i kontekst aukcji przy wejściu (odległość od VWAP w σ, otwarcie względem VA, stan IB) odtwarzane ze świec 1m Hyperliquid dla zagrań z ostatnich ~3,5 doby; statystyki per setup: trafność z przedziałem Wilsona 95%, średnie R z przedziałem bootstrap 90% (stałe ziarno, od 5 zagrań), profit factor, mediany MAE wygranych i MFE przegranych, ostrzeżenie poniżej 20 zagrań; dane wyłącznie w localStorage, eksport/import JSON z walidacją wpisów.
- **Model vs rynek (HIP-4)** (`src/utils/hip4.ts`, `src/utils/hip4Model.ts`, `src/workers/hip4.worker.ts`, panel w widoku Rynek): rynki wynikowe Hyperliquid na BTC z `outcomeMeta` (dzienny `Recurring`, drabinki `binaryPrice` z jawnym źródłem ceny — mark, transakcja HL albo Pyth, `priceTouch`), notowania strony „Tak” z arkusza z filtrem płynności (spread ≤ 5 pp, ≥ 50 USDC w zleceniach do ±5 pp od środka) i prawdopodobieństwa modelu desku dla tych samych pytań: P(S_T > K) i P(dotknięcia) z Monte Carlo na σ sezonowego log-HAR i innowacjach FHS (krok 5/15/60 min z sumą innowacji 5-minutowych, dokładne ekstrema mostu Browna), liczone w Web Workerze; testy względem wzorów analitycznych.
- **Kontekst aukcji** (`src/utils/auction.ts`, `src/state/useAuctionContext.ts`, panel w widoku Plan, kafel na Desku): sesja UTC — VWAP z pasmami ±1σ/±2σ, Initial Balance 00:00–01:00 UTC z rozszerzeniami, profil poprzedniego dnia (POC/VAH/VAL), słabe szczyty i dna; częstości historyczne z ~200 pełnych sesji 1h z przedziałami Wilsona 95% (wybicia IB, reguła 80%, przebicie słabych vs mocnych ekstremów z różnicą Newcombe’a, dotknięcie PDH/PDL wg położenia otwarcia) i stan bieżącej sesji liczony tą samą metodą (tylko zamknięte godziny).
- **Mechanika arkusza** (`src/utils/microMechanics.ts`, `src/utils/microEngine.ts`, panel na górze widoku Mikrostruktura): metody z literatury liczone na żywo z publicznych kanałów WebSocket Hyperliquid — OFI Cont–Kukanov–Stoikov z kanału `bbo` (~co 150 ms) i regresja ΔP na OFI w interwałach 10 s, proces Hawkesa z jądrem wykładniczym (MLE Nelder–Mead, zdarzenie = blok z transakcjami, współczynnik rozgałęzienia), mikrocena (średnia ważona i empiryczna korekta wg nierównowagi, Stoikov 2018), bilans dodanych / anulowanych / wykonanych zleceń przy cenie z migawek `l2Book`, absorpcja jako reszta odpornej regresji ruchu ceny na wolumenie agresora. Estymatory pokazują „zbieram dane” do osiągnięcia minimalnej próby.
- **Weryfikowalny dziennik desku** (`backend/scanner/ledger*.ts`, `forecaster.ts`, `ots.ts`, `src/utils/forecastScore.ts`, `src/utils/deskLedger.ts`, panel w widoku Plan): prognozy co 15 min zapisywane przed faktem (kwantyle zwrotu 1 h / 4 h z modelu HAR + FHS z benchmarkiem; dotknięcia PDH/PDL/D-EQ w 2 h), rozstrzygane ze świec 1m; CRPSS, PIT, pokrycia z testem Kupca, ACI, Brier/BSS, niezawodność, Venn–Abers. Łańcuch hashy SHA-256 w plikach dziennych na gałęzi `ledger` repo danych (commit tylko dopisujący), pokwitowanie OpenTimestamps głowy łańcucha po każdym slocie i kotwice dni, jawne rekordy pominiętych slotów, horyzont od pełnej minuty po wydaniu; test Kupca na podpróbie rozłącznej, BSS względem klimatologii poziomów, ACI bez przycinania; niezależna weryfikacja `scripts/verify-ledger.mjs` (łańcuch od GENESIS, historia git, kolejność zapisów, pokwitowanie każdego slotu, wyniki przeliczane z kwantyli; `--market` — ceny źródłowe rozstrzygnięć vs świece 1m; `--bitcoin` — czas bloku z poświadczeń OTS, pełny zestaw operacji: SHA-256, SHA-1, RIPEMD-160, append, prepend, reverse, hexlify).
- Pas „Zasięg 2h” na Desku: wartości skalibrowane izotonicznie z dziennika (od 20 rozstrzygnięć).
- **Przepływ kohort** (`backend/scanner/cohortEngine.ts`, `src/utils/cohorts.ts`, panel „Przepływ kohort” na Desku): strony każdej transakcji z publicznej taśmy przypisane do kohort — market makerzy, statystycznie poinformowani (markout biorcy po 5 min, test jednostronny, FDR Benjaminiego–Hochberga q = 10%, empiryczny Bayes), wieloryby, reszta. Przepływ netto (zmiana zapasów, suma po kohortach = 0) i agresywne CVD per kohorta w zamkniętych kubełkach 15 min z 24 h, markouty 1/5/60 min poza próbą (tylko średnie z 24 ostatnich w pełni rozliczonych godzin, z tą samą regułą ukrywania); obserwacja testu = blok 5 min adresu (zamiatanie arkusza nie mnoży obserwacji), wariancja konserwatywnie ×2 za nakładające się horyzonty. Prywatność: k-anonimowość z regułą dominacji i ukrywaniem wtórnym (suma kohort jest publiczna), osobno dla warstwy agresora, kwoty do 10 tys. USD, liczności do dziesiątek; zero dodatkowych zapytań API.
- Skaner: deduplikacja transakcji WebSocket po (czas, tid) — powtórzenia po ponownej subskrypcji nie liczą się podwójnie.
- **Nadzór danych** (`.github/workflows/data-health.yml`, `scripts/check-data-health.mjs`): co 30 min kontrola świeżości publikacji skanera, pokrycia open interest i opóźnienia odczytów pozycji oraz strażnik prywatności (alarm, gdyby w publikacji pojawił się adres portfela lub IP); problem otwiera zgłoszenie `alert-danych`, powrót danych je zamyka.

- **Taśma zrealizowanych likwidacji** (`backend/scanner/liqDetect.ts`, `src/utils/liqTape.ts`, panel na Desku): skaner wykrywa zmniejszenie śledzonej pozycji w paśmie jej ceny likwidacji i potwierdza je w fillach konta (pole `liquidation`, metoda market/backstop; deduplikacja po fillach, faktyczna waga odpowiedzi w budżecie, wstrzymanie przy przeciążonym API); publikuje `liq-tape/BTC.json` — zdarzenia z 24 h (czas do minuty, rozmiar zaokrąglony), sumy 1 h / 24 h, kubełki 5 min — bez adresów i identyfikatorów transakcji.
- **Błąd ceny likwidacji z mapy**: dla każdej potwierdzonej likwidacji różnica między ceną likwidacji z ostatniego odczytu a ceną mark w chwili likwidacji (mediana |błędu|, p90, mediana ze znakiem, wiek odczytu).
- **Skanowanie adaptacyjne**: pozycje od 25 tys. USD z ceną likwidacji < 1% od ceny mark odczytywane co 1 min (< 3%: najwyżej co 2 min).

### Zmienione
- Wdrożenie GitHub Pages na Node 24 (jak CI i skaner).
- Hook danych skanera wspólny dla mapy i taśmy (`usePublished`): pamięć podręczna, odświeżanie co minutę tylko w widocznej karcie, starsza odpowiedź nie cofa nowszej.

### Naprawione
- Taśma agresora: uczciwe nazwy („przepływ agresora”, „heurystyka”) i odesłanie do absorpcji z regresji; mapa wielorybów z WebSocket nie jest już nadpisywana starszymi węzłami z REST.
- Kohorty: po restarcie pierwszy kubełek był obserwowany tylko częściowo, a publikowany jak pełny — teraz tylko kubełki obserwowane w całości.
- `status.json` pokazywał `seeded: 0` po każdym restarcie skanera (licznik tylko w pamięci); konta z rankingu bez pozycji BTC wypadały co 3 dni (oraz jako pierwsze przy przepełnieniu książki adresów) i wracały z zasiewem (zbędne ponowne odczyty).

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

[2.3.0]: https://github.com/rdemb/HyperQuant/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/rdemb/HyperQuant/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/rdemb/HyperQuant/compare/5b33b4b...v2.1.0
[2.0.0]: https://github.com/rdemb/HyperQuant/commit/5b33b4b
