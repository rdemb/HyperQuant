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
- pytania BTC z płynnym arkuszem (spread ≤ 5 pp i ≥ 50 USDC w zleceniach do ±5 pp od środka po obu stronach — decyzja
  z realizacji: na żywych danych próg 500 USD wykluczał wszystkie rynki poza dziennym, a liczenie „3 najlepszych poziomów”
  łapało dalekie śmieciowe zlecenia); pozostałe — „—” z adnotacją; błąd pobierania pokazywany jako błąd, nie brak rynku;
- obok ceny rynku (bid/ask/mid) prawdopodobieństwo modelu z tego samego silnika co dziennik (HAR + FHS, Monte
  Carlo): P(S_T > K) z rozkładu zwrotu do T, P(dotknięcia K przed T) z symulacji ścieżek;
- uczciwie: cena rynku to nie czyste prawdopodobieństwo (premia za ryzyko, płynność); różne źródła ceny
  (Pyth vs mark HL); różnica model − rynek to porównanie kalibracji, nie sygnał.

C2 (dziennik skanera): Hyperliquid wystawia rolujący 15-minutowy rynek binarny na BTC (`binaryPrice`, mark perpa, próg =
cena przy utworzeniu, termin = koniec kwadransa) — dokładnie jeden aktywny naraz, ~96 pytań dziennie z p blisko 0,5.
W każdym slocie, 5–10 min przed terminem, skaner zapisuje w dzienniku rekord z bid/ask/mid strony „Tak” i p modelu
(ten sam silnik, horyzont dokładny co do minuty); po terminie rozstrzygnięcie ze świecy 1m (zamknięcie minuty kończącej
się w terminie) z flagą „blisko progu” (≤ 0,02% — mark ≠ cena transakcji). Wyniki: Brier i log score modelu i rynku
na tych samych pytaniach (tylko płynne notowania), różnica z bootstrapem parowanym, liczności, przypadki blisko progu
osobno. Weryfikator przelicza wynik z ceny i progu i sprawdza ceny ze świecami (`--market`).

## D. Rejestrator arkusza (VPS)

- Co 10 s profil głębokości ±50 bp w koszykach 2,5 bp (bid/ask), najlepsze kwotowania i spread; plik dzienny
  gzip, rotacja 7 dni, tylko na VPS (< 5 MB/dzień).
- Publikowane wyłącznie agregaty (repo danych): profil głębokości wg godziny dnia, odporność płynności (czas
  powrotu głębokości po ruchu > 10 bp), β OFI→ΔP i n Hawkesa w czasie — historia, której strona sama nie ma.

## Decyzje z realizacji (A, C1)

- Horyzont modelu HIP-4 dokładny co do minuty (ostatni krok częściowy) — zaokrąglenie do kroków 5 min zawyżało σ przy
  kilku minutach do terminu. Krok 5 min do doby, 15 min do 3 dni, 60 min dalej; innowacje FHS sumowane do długości kroku.
- Obliczenia modelu w Web Workerze (~0,1–0,2 s co minutę poza wątkiem strony).
- Pole `seconds` w opisie rynku nie ma oficjalnie udokumentowanego znaczenia — bez korekty na uśrednianie, jawnie w opisie.
- Kontekst aukcji: świece 1h tylko zamknięte, odświeżane po północy UTC; słabość ekstremów i VA do warunków „dziś” z 1h
  (ta sama definicja co statystyka). Wierzchołek na granicy godzin liczy się jako dwa okna — jak dwa TPO w Market Profile.
- Ograniczenie próby: API daje ~208 dni świec 1h, więc część reguł (reguła 80%, słabe ekstrema) ma n ≈ 20 i pokazuje „—”.
  Kierunek: archiwizacja świec 1h w repo danych przez skaner, żeby n rosło z czasem.

## Decyzje z realizacji (C2)

- Rekord „model vs rynek” powstaje w połowie slotu, po prognozach głównych — dostaje osobne pokwitowanie (`<slot>-m.ots`),
  bo dopisanie do partii głównej zmieniłoby hash jej ostatniej prognozy (pokwitowania są niezmienne). Weryfikator sprawdza
  pokwitowania per partia slotu.
- p modelu liczone od chwili wydania (po pobraniu notowania i ceny), horyzont dokładny co do sekundy, 4000 ścieżek.
- Rozstrzygnięcie ze świecy 1m (cena transakcji), rynek rozlicza po mark w oknie z opisu: wyniki z |c1 − K| ≤ 0,05% K
  oznaczone i pomijane w ocenie (pasmo ostrożne — zakres świecy 1m to zwykle 2–10 bp).
- Dwa poziomy oceny: „płynne” (spread ≤ 5 pp i ≥ 50 USDC po obu stronach) i „wąski spread” (≤ 5 pp, także płytkie) —
  w teście na żywo wiele rynków 15-minutowych miało wąski spread przy kilku USDC głębokości; obie liczby jawne.
- Rekord rynku tylko w slocie z prognozami głównymi (inaczej skip i prognoza w tym samym slocie); cena = środek z migawki
  (świeży), notowanie ≤ 30 s; dokładnie jeden rynek „BTC-USDC perp mark” z terminem = koniec slotu, inaczej brak rekordu.
- Werdykt „kto trafniejszy (Brier)” dopiero od 100 pytań z płynnym notowaniem (ocena co 15 min — ryzyko przypadkowego
  „dowodu” przy wielokrotnym zaglądaniu).
- Najwyżej 2 próby pobrania rynku na slot (~24 wag każda).

## Decyzje z realizacji (D)

- Arkusz domyślny (20 poziomów z dokładnością do 1 USD) obejmuje tylko kilka bp — rejestrator subskrybuje `l2Book`
  zagregowany tak, by 20 poziomów pokrywało ±20 bp (najdrobniejsza z: 5 cyfr, 5 cyfr z mantysą 2/5, 4 cyfry; histereza;
  zmiana = nowa subskrypcja), stąd pasma ±10 i ±20 bp (zamiast ±50 bp z projektu). Po recenzji: stałe 4 cyfry dawały
  przy cenie ≥ 100 tys. koszyki 100 USD (pomiar ±10 bp 38–84%). Koszyk wyznaczany z danych, koszyk brzegowy
  proporcjonalnie, pokrycie sprawdzane (±20 bp = brak, gdy arkusz go nie sięga).
- „Teraz” tylko ze świeżej minuty; norma tej godziny z ≥ 3 innych dni; odporność tylko z ciągłych minut (przerwy =
  cenzurowane), ruchy bez wycofania płynności osobno.
- Na serwerze tylko minutowe mediany (JSONL, 30 dni); publikowany wyłącznie profil — bez surowych migawek.
- Odporność: zdarzenie po ruchu ≥ 15 bp w minutę, powrót = 80% mediany z poprzedniej godziny, kolejne zdarzenie
  dopiero po powrocie (jeden epizod liczony raz); brak powrotu w 1 h liczony osobno.

## Kolejność realizacji

A → C1 → B → C2 → D. Każda część: testy jednostkowe reguł, test na prawdziwych danych, PR, CI, scalenie.

## Poza zakresem

Sygnały kupna/sprzedaży, automatyczne zlecenia, dane kont użytkownika na giełdzie, płatne źródła danych.
