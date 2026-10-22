# Etap 5 — kontekst aukcji, dziennik zagrań, model vs rynek (HIP-4), rejestrator arkusza

Data: 2026-10-22. Realizuje rekomendacje 6 i 7 z listy zatwierdzonej przez właściciela („rozbuduj o wszystkie
rekomendacje”). Zasady produktu bez zmian: LIVE/MODEL/SZAC. uczciwie, „—” zamiast wypełniaczy, bez sygnałów
kupna/sprzedaży, tylko publiczne dane, dane użytkownika wyłącznie w localStorage, zero kosztów, żadnych danych VPS
w repo.

## Dlaczego

Desk ma już modele (zmienność, dotknięcia, mechanika arkusza) i dowód trafności (dziennik). Brakuje dwóch rzeczy,
których day trader używa codziennie i których żaden publiczny desk nie podaje rzetelnie:

1. **Kontekst aukcji z liczbami zamiast folkloru.** VWAP, Initial Balance, value area, „słabe” szczyty — wszyscy je
   rysują, nikt nie mówi, jak często na BTC faktycznie działają. Pokazujemy poziomy i obok empiryczne częstości
   z przedziałami ufności z ~200 sesji.
2. **Własna przewaga użytkownika.** Dziennik zagrań z playbookiem (setup → wynik w R, MAE/MFE ze świec) daje
   statystykę per setup z niepewnością — zamiast pamięci i wrażeń.

Rekomendacja 7 dokłada **porównanie modelu z rynkiem predykcyjnym** (HIP-4 na Hyperliquid: te same pytania co nasz
model — „BTC powyżej K w chwili T”, „dotknięcie K do T”) i **rejestrator arkusza** (historia płynności, której
publiczne API nie daje).

## A. Kontekst aukcji

Miejsce: widok Plan, karta „Kontekst aukcji” (nad dziennikiem desku) + skrót na Desku (odległość od VWAP w σ, stan IB).

Dane (publiczne `candleSnapshot` HL; `RangeBar` dostaje opcjonalny `volume`):
- świece 1m od początku bieżącego i poprzedniego dnia UTC — VWAP, IB, profil poprzedniego dnia;
- świece 1h (~5000 ≈ 208 dni) — statystyki historyczne.

Poziomy (sesja = dzień UTC, otwarcie 00:00 UTC):
- **VWAP sesji** z ceny typowej (H+L+C)/3 ważonej wolumenem świec 1m, pasma ±1σ i ±2σ (σ = odchylenie
  standardowe ceny typowej ważone wolumenem). Oznaczenie LIVE (wyliczone z publicznych świec; cena typowa
  przybliża ceny transakcji — zastrzeżenie w opisie).
- **Initial Balance** 00:00–01:00 UTC (max/min), rozszerzenia 1,5× i 2× zakresu IB.
- **Profil poprzedniego dnia**: POC, VAH, VAL (70%, wolumen świecy 1m rozłożony równomiernie w jej zakresie,
  koszyki 10 USD; funkcja `valueArea` z footprintu).
- **Słaby szczyt / słabe dno** poprzedniego dnia: co najmniej dwa różne 30-minutowe okna z ekstremum w odległości
  ≤ 0,02% od maksimum/minimum dnia (brak „ekscesu” — płaskie zakończenie aukcji). Reguła jawna w opisie.

Statystyki empiryczne (świece 1h, sesje UTC z kompletem 24 świec; przedział Wilsona 95%, n zawsze widoczne):
1. P(sesja przebija IB high), P(przebija IB low), P(oba), P(żadne) — IB = pierwsza świeca 1h dnia (dokładnie).
2. **Reguła 80%**: otwarcie poza VA poprzedniego dnia, potem dwie kolejne świece 1h z zamknięciem w VA →
   P(dotarcie do przeciwległej granicy VA w tej sesji). VA z profilu świec 1h (przybliżenie — w opisie).
3. **Słaby vs mocny szczyt/dno**: P(przebicie ekstremum poprzedniego dnia w kolejnej sesji) osobno dla słabych
   i mocnych (słabość z 1h: ≥ 2 świece z ekstremum ≤ 0,02%); różnica proporcji z przedziałem Newcombe'a.
4. P(dotknięcie PDH), P(dotknięcie PDL) wg położenia otwarcia (w VA / nad / pod).
- Bieżąca sesja: pokazujemy tylko statystyki pasujące do dzisiejszego stanu (np. otwarcie nad VA → odpowiedni
  wiersz), z dopiskiem „historycznie w N sesjach — nie prognoza”.
- Próba poniżej 30 sesji dla warunku → „—” z liczbą n.

## B. Dziennik zagrań i playbook

Miejsce: widok Plan, trzecia zakładka „Dziennik zagrań”. Dane wyłącznie w localStorage (`hq.playbook.v1`,
`hq.trades.v1`), eksport/import JSON; nic nie jest wysyłane.

- **Playbook**: setupy użytkownika — nazwa, kontekst, lokalizacja, wyzwalacz, wykonanie, unieważnienie
  (szablon Kontekst → Lokalizacja → Wyzwalacz → Wykonanie).
- **Zagranie**: kierunek, wejście (czas, cena), stop początkowy, wyjście (czas, cena), wielkość (opcjonalnie),
  setup, notatka. Automatycznie: wynik w R (od stopu początkowego), **MAE/MFE w R** ze świec 1m HL (dla zagrań do
  ~3,5 doby wstecz; starsze — „—”), migawka kontekstu aukcji przy wejściu (VWAP σ, położenie względem VA, stan IB).
- **Statystyki per setup**: n, trafność z przedziałem Wilsona 95%, średnie R z przedziałem bootstrap 90%
  (2000 losowań, stałe ziarno), oczekiwanie w R, profit factor, mediany MAE zwycięskich i MFE przegranych
  (pomoc przy stopie i celu); ostrzeżenie przy n < 20.
- Bez rekomendacji wielkości pozycji poza tym, co już jest (stałe ryzyko %).

## C. Model vs rynek (HIP-4)

Fakty (sprawdzone 2026-10-22 na publicznym API): `{"type":"outcomeMeta"}` zwraca rynki wynikowe; dla BTC:
- `Recurring` `class:priceBinary|underlying:BTC|expiry:YYYYMMDD-0600|targetPrice:K|period:1d` — rozliczenie
  codziennie 06:00 UTC po cenie mark BTC z HyperCore (dokumentacja HIP-4), arkusz płynny (spread ~0,02);
- `template:binaryPrice` (Pyth BTC/USD, `seconds:90`, `threshold`, `time`) — drabinki progów; arkusze często puste;
- `template:priceTouch` (mark perp, `target`, `time`) — dotknięcie do terminu.
Ceny: `allMids` z kluczem `#<10·outcome + strona>` (strona 0 = Yes), arkusz `l2Book` z `coin: "#<…>"`.

C1 (strona): panel „Model vs rynek” w widoku Rynek:
- pytania BTC z płynnym arkuszem (spread ≤ 0,10 i ≥ 500 USD w 3 najlepszych poziomach po obu stronach); pozostałe
  — „—” z adnotacją „arkusz pusty”;
- obok ceny rynku (bid/ask/mid) prawdopodobieństwo modelu z tego samego silnika co dziennik (HAR + FHS, Monte
  Carlo): P(S_T > K) z rozkładu zwrotu do T, P(dotknięcia K przed T) z symulacji ścieżek;
- uczciwie: cena rynku to nie czyste prawdopodobieństwo (premia za ryzyko, płynność); różne źródła ceny
  (Pyth vs mark HL); różnica model − rynek to porównanie kalibracji, nie sygnał.

C2 (dziennik skanera): co godzinę dla dziennego `Recurring` rekord z bid/ask/mid rynku i p modelu, rozstrzygnięcie
o 06:00 UTC (świeca 1m HL; mark ≈ cena ostatnia — rozbieżność jawna); wyniki: Brier i log score modelu i rynku
na tych samych pytaniach, różnica z bootstrapem. Weryfikator przelicza je jak resztę dziennika.

## D. Rejestrator arkusza (VPS)

- Co 10 s profil głębokości ±50 bp w koszykach 2,5 bp (bid/ask), najlepsze kwotowania i spread; plik dzienny
  gzip, rotacja 7 dni, tylko na VPS (< 5 MB/dzień).
- Publikowane wyłącznie agregaty (repo danych): profil głębokości wg godziny dnia, odporność płynności (czas
  powrotu głębokości po ruchu > 10 bp), β OFI→ΔP i n Hawkesa w czasie — historia, której strona sama nie ma.

## Kolejność realizacji

A → C1 → B → C2 → D. Każda część: testy jednostkowe reguł, test na prawdziwych danych, PR, CI, scalenie.

## Poza zakresem

Sygnały kupna/sprzedaży, automatyczne zlecenia, dane kont użytkownika na giełdzie, płatne źródła danych.
