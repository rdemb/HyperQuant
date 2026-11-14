---
title: "BTC po zrzucie do 64 372: 68% zakresu do niedzieli 10:00 to 63 369 do 66 339"
description: "Sobotni zrzut doszedł do pasma −2σ VWAP. Pod ceną 83,7 mln USD longów w 1%, nad nią żadnych shortów. Model daje 32% na cenę pod 64 130 w niedzielę o 10:00."
date: 2026-11-14T22:00:13+01:00
type: article
section: Mapa na weekend
price: 64727
levels:
  - { label: "Otwarcie Londynu", price: 67143, note: "10% dotknięcia do 10:00" }
  - { label: "Likwidacje shortów", price: 66675, note: "2,4 mln USD, 20% dotknięcia do 10:00" }
  - { label: "Dołek Azji", price: 66434, note: "26% dotknięcia do 10:00" }
  - { label: "Likwidacje shortów", price: 66425, note: "3,1 mln USD, 27% dotknięcia do 10:00" }
  - { label: "Likwidacje shortów", price: 66275, note: "4,6 mln USD, 31% dotknięcia do 10:00" }
  - { label: "VWAP dnia", price: 66228, note: "32% dotknięcia do 10:00" }
  - { label: "Likwidacje longów", price: 64575, note: "15,7 mln USD, 85% dotknięcia do 10:00" }
  - { label: "Likwidacje longów", price: 64425, note: "12,9 mln USD, 75% dotknięcia do 10:00" }
  - { label: "Likwidacje longów", price: 64125, note: "8,8 mln USD, 60% dotknięcia do 10:00" }
scenarios:
  - label: "Cena w niedzielę o 10:00 poniżej 64 130"
    probability: 32
    note: "Sprzedający muszą utrzymać ceny pod VAL 64 725 i przejść przez klaster longów przy 64 125, a OI dalej spadać na likwidacjach."
  - label: "Cena w niedzielę o 10:00 między 64 130 a 66 230"
    probability: 52
    note: "Wystarczy, że noc uspokoi się po zrzucie i cena zostanie między dołkiem dnia a VWAP, czyli w obszarze wartości doby."
  - label: "Cena w niedzielę o 10:00 powyżej 66 230"
    probability: 16
    note: "Potrzebny powrót nad VWAP dnia 66 228 i przejście przez shorty przy 66 275, przy dodatniej delcie i rosnącym OI."
summary:
  - "Sobota zjechała od szczytu doby 68 885 do 64 372, a od 12:00 każda świeca 15 min zamykała się pod VWAP dnia."
  - "Ostatni zrzut o 21:45 zdjął 40,9 mln USD longów w kwadrans, przy delcie −881,6 BTC i spadku OI o 533,7 BTC."
  - "W 1% pod ceną czeka 83,7 mln USD longów do likwidacji, nad ceną w tym samym pasie 0,0 mln USD shortów."
  - "Model daje 68% na cenę od 63 369 do 66 339 w niedzielę o 10:00, a luka do piątkowego zamknięcia CME wynosi −5,32%."
metrics:
  - { label: "Premia perp", value: "−4,6 bp", note: "średnio 24 h −4,5 bp" }
  - { label: "Funding", value: "0,06 bp/h", note: "średnio 24 h 0,05 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "−133,7 mln USD", bias: down, note: "kupno biorców 932,0, sprzedaż 1 065,8 mln USD" }
  - { label: "Likwidacje 24 h", value: "89,6 mln USD", note: "longi 81,9, shorty 7,7 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "83,7 mln USD", note: "do likwidacji między 64 080 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "0,0 mln USD", note: "do likwidacji między ceną a 65 374" }
  - { label: "Arkusz ±10 bp: bidy", value: "37% bidów", note: "zwykle o tej godzinie 50% (24 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "18,4 bp", note: "poprzednie dni robocze (5): 13,4 bp" }
liquidations:
  step: 250
  coverage: 48
  shorts: [[67500, 1.5], [67250, 1.7], [67000, 3.9], [66750, 6.8], [66500, 6.8], [66250, 10], [66000, 2.6]]
  longs: [[64250, 31.4], [64000, 16.8], [63750, 10.1], [63500, 6], [63250, 10.1], [63000, 9.2], [62750, 11.5], [62500, 17.7], [62250, 6.1], [62000, 4.2], [61750, 17.5]]
  note: "Mapa z 21:57, cena wtedy 64 905; pokrycie 48% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: -110.7, note: "150 kont" }
    - { label: "Reszta rynku", value: -7.3, note: "30 230 kont" }
    - { label: "Animatorzy rynku", value: -15.7, note: "250 kont" }
setups:
  - name: "Akceptacja pod obszarem wartości doby"
    bias: down
    zone: [64000, 64725]
    window: "do 10:00 w niedzielę"
    triggers:
      - "Dwie świece 15 min zamykają się pod VAL 24 h 64 725."
      - "Delta tych świec zostaje ujemna, sprzedający nadal biorą ofertę."
      - "OI dalej spada, a likwidacje longów rosną skokowo przy klastrze 64 125."
    invalidation: "Zamknięcie 30 min z powrotem nad VWAP −1σ 65 300."
    reactions:
      - { label: "Likwidacje longów", price: 64125 }
      - { label: "Klaster longów", price: 63750 }
      - { label: "Klaster longów", price: 62500 }
  - name: "Odrzucenie zrzutu i powrót do wartości"
    bias: up
    zone: [64372, 64800]
    window: "do 10:00 w niedzielę"
    triggers:
      - "Świeca 15 min zamyka się nad POC świecy zrzutu 64 800."
      - "Delta przechodzi na plus i utrzymuje się przez kolejne świece."
      - "OI przestaje spadać; wzrost ceny przy rosnącym OI to nowe longi, przy spadającym tylko zamykanie shortów."
    invalidation: "Zamknięcie 15 min pod dołkiem dnia 64 372."
    reactions:
      - { label: "VWAP −1σ", price: 65300 }
      - { label: "POC 24 h", price: 65375 }
      - { label: "VWAP dnia", price: 66228 }
    evidence: "Reguła powrotu do VWAP w laboratorium desku: n 191, częstość 37% wobec 43% losowo, czyli bez przewagi. To wskazówka, nie statystyka."
---
## Co się stało

Sobota była jednym długim zjazdem. Szczyt doby to 68 885 z piątku o 22:00, potem o 03:15 pierwszy zrzut do 66 875 przy delcie −1 307,3 BTC, a dołek Azji ustawił się na 66 434. Londyn otworzył się przy 67 143 i do południa cena stała w wąskim pasie pod VWAP. Od 14:00 zaczęła się druga fala: przez popołudnie cena zeszła pod 65 000, o 18:30 odbiła do 66 231, ale nie dotarła do VWAP. O 21:45 przyszedł zrzut do 64 372, zamknięty przy 64 727. Do piątkowego zamknięcia CME przy 68 362 brakuje teraz 5,32%.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Piątkowy dołek 67 474 został przebity w nocy i od 04:15 żadna świeca 15 min nie zamknęła się nad nim; o 10:45 był tylko knot do 67 486. To wybicie dołem z kontynuacją, a nie nieudane wybicie. PDH 71 507 jest daleko i w tym horyzoncie nie gra roli.

**Wartość.** POC 24 h stoi przy 65 375, obszar wartości to od 64 725 do 67 150. Cena zamknęła się dokładnie na dolnym brzegu, przy VAL 64 725. Pod obszarem była na razie jedna świeca z długim dolnym knotem, więc niższych cen rynek jeszcze nie zaakceptował; o tym zdecydują najbliższe dwie, trzy świece 30 min.

**VWAP.** VWAP dnia to 66 254, a cena jest 1,67σ pod nim (σ 916,6). Ostatnie zamknięcie nad VWAP było o 11:45, od 12:00 każda świeca 15 min zamykała się pod nim. Pasmo −1σ działało jak wsparcie od 18:15 do 21:15, o 21:30 pękło, a dołek 64 372 wypadł dokładnie na paśmie −2σ.

**Przepływ i pozycje.** Delta z ostatniej godziny to −1 197,9 BTC przy spadku ceny o 972 USD, z czterech godzin −1 431 BTC przy spadku o 601 USD. OI spadło w godzinę o 850 BTC, a w cztery godziny o 1 180,5 BTC, do 36 613,2 BTC. Cena w dół i OI w dół to zamykanie longów i likwidacje, nie nowe shorty. Taśma ma krótką lukę od 09:34 do 09:36, poza tym obejmuje całą dobę do 22:00.

## Footprint zrzutu do 64 372

[[footprint]]

Inicjatywę po stronie kupujących widać było o 20:30: trzy nierównowagi kupna na 65 500, 65 700 i 65 800, delta +251,8 BTC i zamknięcie na szczycie świecy. Odpowiedź przyszła szybko. O 21:00 cena doszła do 65 854 i zamknęła się na dole przy 65 522, z deltą −359,3 BTC. O 21:45 wolumen skoczył do 2 984,2 BTC, delta wyniosła −881,6 BTC, a OI spadło o 533,7 BTC: sprzedaż przeszła przez cały arkusz z pięcioma nierównowagami sprzedaży od 65 200 do 64 300. Dół tej świecy przyjął jednak nierównowagę kupna przy 64 800 i świeca zamknęła się wyraźnie nad dołkiem, co wygląda na pierwszą absorpcję.

Linia frontu na noc to POC świecy zrzutu 64 800 razem z VAL 24 h 64 725. Nad nimi leżą nierównowagi sprzedaży z 65 000 i 65 200, a wyżej POC świec z 21:15 i 21:30 przy 65 400. Dopóki cena jest pod 65 400, sprzedający bronią swojego terenu.

## Gdzie leży płynność

[[likwidacje]]

Mapa jest mocno jednostronna. W 1% pod ceną czeka 83,7 mln USD longów do likwidacji, najwięcej w przedziale od 64 250 (31,4 mln USD) i od 64 000 (16,8 mln USD). Niżej kolejne skupiska są od 62 500 (17,7 mln USD) i od 61 750 (17,5 mln USD). Nad ceną w 1% nie ma shortów wcale, pierwsze sensowne skupisko to 10 mln USD od 66 250. Mapa widzi 48% otwartych pozycji.

## Kto handluje

[[przeplywy]]

Przez 24 godziny agresorzy sprzedali netto za 133,7 mln USD, z czego 110,7 mln USD to wieloryby. Reszta rynku jest prawie płaska, −7,3 mln USD. Premia perp to −4,6 bp, funding 0,06 bp/h, więc kontrakt nie płaci za shorty żadnej premii. Arkusz w pasie ±10 bp ma tylko 37% bidów, a zwykle o tej godzinie jest ich 50%.

## Zmienność i rozkład

[[scenariusze]]

Model daje 68% na cenę od 63 369 do 66 339 w niedzielę o 10:00, a 95% od 61 935 do 67 875. Zmienność zwrotów 5 min z ostatniej doby to 18,4 bp wobec 13,4 bp w poprzednich dniach roboczych. Rynek HIP-4 na „BTC > 67 231” wycenia 3%, model też 3%, czyli tu nie ma rozjazdu.

## Struktura dnia

[[poziomy]]

Cena siedzi na dolnym brzegu wartości doby, między klastrami longów przy 64 575 (85% dotknięcia do 10:00) i 64 425 (75%). VWAP dnia 66 228 ma 32%, dołek Azji 66 434 ma 26%, a otwarcie Londynu 67 143 tylko 10%. Pod ceną klaster 64 125 ma 60%.

## Co musiałoby się wydarzyć

[[setupy]]

Spadkowy obraz wymaga akceptacji pod VAL: dwóch zamknięć pod 64 725, dalej ujemnej delty i spadającego OI. Wzrostowy zaczyna się od odzyskania 64 800 z dodatnią deltą, ale reguła powrotu do VWAP w laboratorium desku nie dała przewagi (n 191, 37% wobec 43% losowo), więc traktuję ją jako wskazówkę.

## Na co patrzę dalej

Najpierw na to, czy nocne świece zostaną nad 64 372 i czy OI przestanie spadać. Odzyskanie VWAP −1σ przy 65 300 zmieniłoby obraz na neutralny, a dwa zamknięcia pod 64 725 otworzyłyby drogę do 64 125. Luka CME o 5,32% w dół to tło na niedzielny wieczór, ale reguła zamykania luk w laboratorium ma tylko 23 przypadki i 48% wobec 50% losowo.

## Rzetelność modelu

Przedziały 4 h z dziennika desku: 90% obejmuje 91% wyników, 60% obejmuje 73% (n 2229), więc węższy przedział bywa zbyt ostrożny. Dotknięcia PDH, PDL i środka mają Brier 0,069 wobec 0,077 dla bazy odległości i 0,118 dla częstości bazowej, czyli BSS 0,10 wobec odległości i 0,41 wobec częstości (n 2237).

Prawdopodobieństwa pochodzą z modelu desku HAR + FHS i symulacji Monte Carlo, policzone o 22:00 i zapisane przed faktem, żeby dało się je potem rozliczyć. Następny wpis w niedzielę o 10:00, a mapa tygodnia w niedzielę o 20:00.
