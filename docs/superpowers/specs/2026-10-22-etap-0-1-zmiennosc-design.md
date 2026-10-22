# Etap 0–1: spójność opisów i silnik zmienności — projekt

Data: 2026-10-22 · Status: zatwierdzone przez właściciela („Do dzieła”) po roadmapie w rozmowie.

## Po co

HyperQuant ocenia plan tradera prawdopodobieństwami. Dziś σ to Parkinson z 60 świec bieżącego interwału, ścieżki są gaussowskie,
a Monte Carlo zakłada natychmiastowe wypełnienie — podczas gdy dziennik rozlicza plan dopiero po dotknięciu wejścia, w pozostałym
czasie horyzontu. README twierdzi, że w barierach są skoki Mertona (nie ma). Cel: każda liczba ma metodę, którą deklaruje, a model
prognozuje dokładnie to, co dziennik potem rozlicza.

## Cele

1. **Etap 0 — spójność:** README, komentarze i etykiety opisują faktyczną matematykę (Merton w barierach, „Neural … Signal Generator”,
   pasek MC 2h, rodowód).
2. **Silnik zmienności (`src/utils/volatility.ts`, czyste funkcje):**
   - estymatory zakresowe: Parkinson, Garman–Klass, Rogers–Satchell, Yang–Zhang;
   - RV, wariancja dwupotęgowa (BNS 2004), udział skoków Σmax(RV−BV,0)/ΣRV z pełnych dni UTC świec 5m;
   - test skoków Lee–Mykland (2008) na zwrotach 5m oczyszczonych z sezonowości, α = 1%, okno K = 288;
   - profil sezonowy godziny UTC (24 współczynniki, średnia 1, ściąganie do 1 z K = 20 obserwacjami);
   - sezonowy log-HAR (Corsi 2009) na godzinowych wariancjach GK: y_t = ln(GK_t / f_h(t)), regresory y_t, średnia 24 h, średnia 168 h;
     OLS; korekta Duana (smearing) przy powrocie do poziomu; prognoza iterowana godzina po godzinie;
   - diagnostyka poza próbą: dopasowanie na pierwszych 70%, prognozy 1-krokowe na ostatnich 30%, średni QLIKE (Patton 2011) HAR vs
     naiwny (średnia GK z ostatnich 24 h, bez sezonowości);
   - innowacje FHS (Barone-Adesi i in. 1999): zwroty 5m / lokalne σ (sezonowość × średnia z poprzednich 288 świec), wyśrodkowane
     i znormalizowane do wariancji 1.
3. **Dane:** `candleSnapshot` BTC 1h (≈5000 świec ≈ 208 dni) i 5m (≈5000 ≈ 17 dni), bez świecy w toku; odświeżanie co 60 min,
   pauza w ukrytej karcie; brak danych → model niedostępny (nigdy liczby zastępcze).
4. **Analizator planu:** krok 5 min z σ_k z prognozy HAR × sezonowość (wariancja kroku = suma udziałów godzin), innowacje FHS,
   korekta mostu BGK z lokalnym σ_k. Start od bieżącej ceny: faza wypełnienia (dotknięcie wejścia, także most), potem wyścig cel/stop
   w pozostałym czasie. Wynik: P(wypełnienia) oraz P(cel|wypełnione), P(stop|…), P(żadne|…). Gdy wypełnień < 200 ścieżek —
   symulacja od wejścia z pełnym horyzontem i flaga `fillRare` (UI mówi to wprost). Mnożnik makro bez zmian (cała wariancja horyzontu).
   Wersja modelu `plan-fhs-har-v2`.
5. **Dziennik:** zapisuje prawdopodobieństwa warunkowe (jak dotąd rozlicza warunkowo) i nowe `pFill`; metryka Brier wypełnienia
   z wpisów z `pFill` (rozstrzygnięte + `nofill`). Stare wpisy bez `pFill` nadal się wczytują.
6. **Pas „Zasięg 2h · MC”:** ten sam silnik (σ_k HAR + FHS), 2000 ścieżek, deterministyczne ziarno z wejść, bez przyciągania OU
   (nieestymowane); gdy model niedostępny — dotychczasowy Merton z etykietą „założenie”.
7. **Przejrzystość w UI:** karta „Model zmienności” (σ horyzontu, udział skoków, skoki LM, QLIKE HAR vs naiwny, liczność danych),
   metodologia i źródła w Analizatorze, wiersze w Rodowodzie.

## Poza zakresem (kolejne etapy)

Kalibracja mnożników makro z danych, warunkowanie selekcją negatywną przy wypełnieniu (wymaga empirii z dziennika), Web Workers,
publiczny dziennik desku, Hawkes MLE, prawdziwe OFI.

## Ograniczenia

- Statyczna strona (GitHub Pages), wszystko w przeglądarce, tylko publiczne API Hyperliquid; budżet 1200 wag/min/IP
  (`candleSnapshot` 5000 świec ≈ 20 + 5000/60 ≈ 104 wagi; dwa zapytania na godzinę).
- Zasady README: LIVE/MODEL/SIM, „—” zamiast zastępczych liczb, zero sygnałów kierunkowych.
- Polski w UI i komentarzach, styl istniejącego kodu.
