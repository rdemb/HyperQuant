---
title: "BTC 72 549 pod wczorajszym dołkiem: 51% na zakres 71 950–73 130 o 19:30"
description: "Bitcoin zszedł pod PDL 73 174, a zrzut o 14:00 sięgnął 72 112. Model daje 68% na zakres 71 675–73 480 do 19:30 i 51% na środkowy scenariusz."
date: 2026-11-12T14:50:11+01:00
type: article
section: Mapa przed Nowym Jorkiem
price: 72549
levels:
  - { label: "POC wczoraj", price: 73723, note: "17% dotknięcia do 19:30" }
  - { label: "Otwarcie Londynu", price: 73623, note: "21% dotknięcia do 19:30" }
  - { label: "VAL wczoraj", price: 73519, note: "26% dotknięcia do 19:30" }
  - { label: "Dołek Azji", price: 73379, note: "34% dotknięcia do 19:30" }
  - { label: "PDL", price: 73174, note: "47% dotknięcia do 19:30" }
  - { label: "Likwidacje shortów", price: 73150, note: "29,0 mln USD, 49% dotknięcia do 19:30" }
  - { label: "VWAP dnia", price: 73133, note: "51% dotknięcia do 19:30" }
  - { label: "Likwidacje longów", price: 72550, note: "10,7 mln USD, 98% dotknięcia do 19:30" }
  - { label: "Likwidacje longów", price: 71950, note: "45,8 mln USD, 45% dotknięcia do 19:30" }
scenarios:
  - label: "Cena o 19:30 poniżej 71 950"
    probability: 23
    note: "Cena musiałaby zejść pod dołek zrzutu 72 112 i pasmo VWAP −2σ, wejść w klaster longów przy 71 950 i zostać pod nim do końca okna."
  - label: "Cena o 19:30 między 71 950 a 73 130"
    probability: 51
    note: "Nowy Jork nie odzyskuje VWAP dnia 73 133, a cena krąży między dołkiem zrzutu a pasmami VWAP, tak jak od 14:00."
  - label: "Cena o 19:30 powyżej 73 130"
    probability: 26
    note: "Trzeba wrócić nad VWAP dnia 73 133 i PDL 73 174, czyli przejść przez klaster shortów przy 73 150 i utrzymać się nad nim."
summary:
  - "Cena 72 549 zeszła pod PDL 73 174, a zrzut o 14:00 doszedł do 72 112 przy likwidacjach longów za 44,2 mln USD w jednym kwadransie."
  - "Model daje 68% na zakres 71 675–73 480 do 19:30, a najbardziej prawdopodobny scenariusz to 71 950–73 130 z szansą 51%."
  - "W 1% pod ceną czeka 79,8 mln USD longów do likwidacji, nad ceną 30,2 mln USD shortów."
  - "Wieloryby sprzedały agresywnie netto 156 mln USD w 24 godziny, reszta rynku 31,8 mln USD."
metrics:
  - { label: "Premia perp", value: "−4,6 bp", note: "średnio 24 h −4,4 bp" }
  - { label: "Funding", value: "0,06 bp/h", note: "średnio 24 h 0,07 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "−187,8 mln USD", note: "kupno biorców 505,2, sprzedaż 692,9 mln USD" }
  - { label: "Likwidacje 24 h", value: "65,7 mln USD", note: "longi 53,9, shorty 11,8 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "79,8 mln USD", note: "do likwidacji między 71 824 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "30,2 mln USD", note: "do likwidacji między ceną a 73 274" }
  - { label: "Arkusz ±10 bp: bidy", value: "44% bidów", note: "zwykle o tej godzinie 49% (22 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "11,5 bp", note: "poprzednie dni robocze (5): 15,1 bp" }
liquidations:
  step: 250
  coverage: 47
  shorts: [[75750, 0.6], [75500, 2.1], [75250, 2.7], [75000, 27.1], [74750, 10.9], [74500, 4], [74250, 3.9], [74000, 1], [73750, 24.8], [73500, 1.7], [73000, 30.2]]
  longs: [[72250, 6], [72000, 17.3], [71750, 53.3], [71500, 9.7], [71250, 9.2], [71000, 8], [70750, 7.7], [70500, 42.3], [70250, 5.4], [70000, 23.6], [69750, 9.1], [69500, 19.6], [69250, 16.7]]
  note: "Mapa z 14:47, cena wtedy 72 565; pokrycie 47% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: -156, note: "110 kont" }
    - { label: "Reszta rynku", value: -31.8, note: "21 300 kont" }
    - { label: "Animatorzy rynku", value: 0.1, note: "220 kont" }
setups:
  - name: "Powrót nad wczorajszy dołek przez klaster shortów"
    bias: up
    zone: [73000, 73174]
    window: "do 19:30"
    triggers:
      - "Świeca 15 min zamyka się nad PDL 73 174, a więc i nad VWAP dnia 73 133, czego od 12:30 nie zrobiła żadna świeca."
      - "Delta tej świecy jest dodatnia i cena nie wraca od razu pod 73 000."
      - "Open interest spada przy wzroście (zamykanie shortów z klastra 73 000); jego wzrost oznaczałby nowe longi."
    invalidation: "Zamknięcie świecy 15 min z powrotem pod 72 750, gdzie w południe stały świece z POC."
    reactions:
      - { label: "Dołek Azji", price: 73379 }
      - { label: "VAL wczoraj", price: 73519 }
      - { label: "Otwarcie Londynu", price: 73623 }
    evidence: "Hipoteza zbierania PDL w laboratorium desku: n 95, częstość 46% wobec 48% losowej, bez przewagi. To wskazówka, nie statystyka."
  - name: "Drugi test dołka zrzutu i klastra longów"
    bias: down
    zone: [71950, 72142]
    window: "do 19:30"
    triggers:
      - "Świeca 15 min zamyka się pod dołkiem zrzutu 72 112 i pod pasmem VWAP −2σ 72 142."
      - "Delta jest ujemna i nikt jej nie wchłania przy stosie sprzedaży 72 100–72 200."
      - "Open interest rośnie przy spadku (nowe shorty); jego spadek oznaczałby kolejną falę likwidacji longów."
    invalidation: "Zamknięcie świecy 15 min nad pasmem VWAP −1σ (72 638)."
    reactions:
      - { label: "72k", price: 72000 }
      - { label: "Likwidacje longów", price: 71950 }
      - { label: "Likwidacje longów", price: 71750 }
  - name: "Konsolidacja po zrzucie między pasmami VWAP"
    bias: flat
    zone: [72142, 72638]
    window: "do 19:30"
    triggers:
      - "Świece 15 min zamykają się między pasmem −2σ 72 142 a pasmem −1σ 72 638."
      - "Delta świec bliska zera, bez nowych stosów nierównowag."
      - "Open interest stoi w miejscu albo powoli spada."
    invalidation: "Zamknięcie świecy 15 min nad 72 638 albo pod 72 112."
    reactions:
      - { label: "Likwidacje longów", price: 72550 }
      - { label: "VWAP −1σ", price: 72638 }
    evidence: "Reguła powrotu do VWAP w laboratorium desku: n 190, częstość 37% wobec 43% losowej, bez przewagi. To wskazówka, nie statystyka."
---
## Co się stało

Wczoraj Nowy Jork długo stał w miejscu, między 73 360 a 73 800. Ruch przyszedł o 16:30: świeca wyniosła cenę do 74 492, zlikwidowano wtedy 8,1 mln USD shortów, a kolejne kwadranse z deltą 511,8 i 555,9 BTC pociągnęły rynek wyżej. Szczyt doby 74 778 padł o 22:30 i od tamtej chwili rynek oddaje teren. Tuż po północy cena zeszła do 73 432, Azja krążyła między 73 379 a 74 180, a Londyn otworzył się przy 73 623. Pierwsza słabość przyszła o 10:00 (dołek 73 259), ale zejście pod PDL 73 174 nastąpiło dopiero o 12:30. O 14:00 przyszedł zrzut do 72 112 z deltą −1 192 BTC. Teraz cena stoi przy 72 549, pod VWAP dnia i pod obszarem wartości.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Od wczorajszego szczytu 74 778 cena zeszła o 2 229 dolarów i jest 625 dolarów pod PDL 73 174. To wybicie w dół z kontynuacją: od 12:30 żadna świeca 15 min nie zamknęła się nad wczorajszym dołkiem, a od 12:45 żadna go nawet nie dotknęła, najwyżej doszła do 73 127 o 13:00. Dopóki tak zostaje, nie da się mówić o nieudanym wybiciu.

**Wartość.** POC z ostatnich 24 godzin to 73 575, obszar wartości 73 375–74 550, a cena 72 549 jest wyraźnie pod nim. Rano rynek raz zamknął kwadrans pod VAL (o 10:00, przy 73 316) i od razu wrócił, kwadrans później zamknięcie było przy 73 388. Od 12:15 każda świeca zamyka się już pod 73 375, a to znacznie więcej niż dwie świece 30 min, więc ceny pod wartością są na razie zaakceptowane.

**VWAP.** VWAP dnia to 73 135 przy σ 498,3, cena jest 1,18σ pod nim. Od 04:30 kwadranse zamykają się pod VWAP. Od 13:15 żadna świeca nie zamknęła się nad pasmem −1σ, a o 14:15 i 14:30 szczyty na chwilę je przebiły (72 684 i 72 728), po czym zamknięcia wróciły pod nie, więc pasmo −1σ działa jak opór. Dołek zrzutu 72 112 zatrzymał się tuż pod pasmem −2σ (72 142).

**Przepływ i pozycje.** Taśma obejmuje dobę do 14:45, z krótkimi lukami wczoraj o 21:57 i dziś między 11:43 a 12:08, dlatego delty z 4 godzin nie podaję. W ostatniej godzinie cena spadła o 313 dolarów, delta wyniosła −1 299,5 BTC, a open interest spadł o 391,5 BTC: cena w dół i OI w dół to według macierzy zamykanie longów i likwidacje, co zgadza się z 44,2 mln USD zlikwidowanych longów o 14:00. W 4 godziny cena straciła 829 dolarów, a OI prawie się nie zmienił (+9,4 BTC), czyli wcześniejsze zejście budowały też nowe shorty. Delta całej doby to −3 072,7 BTC.

## Footprint zrzutu do 72 112

[[footprint]]

Okno od 12:45 do 14:30 zaczyna się od obrony 72 750: świeca z 12:45 zeszła tam z nierównowagą kupna i zamknęła się przy 72 930, blisko szczytu, przy wzroście OI o 232,6 BTC. Odbicie o 13:00 doszło do 73 127, pod PDL, z wolumenem 1 824,3 BTC i deltą −178,9 BTC, a kwadrans później sprzedający zepchnęli cenę do 72 790 przy wzroście OI o 416,7 BTC, czyli z nowymi shortami. Potem dwie spokojne świece (wolumen 277,4 i 388,8 BTC) i o 14:00 inicjatywa sprzedaży: zejście do 72 112, delta −1 192 BTC, wolumen 3 278,4 BTC, stos nierównowag sprzedaży 72 100–72 200 i spadek OI o 257,1 BTC. Świeca zamknęła się jednak 299 dolarów nad dołkiem, przy 72 411. Dwa kolejne kwadranse to wyczerpanie: wolumen spadł do 664,6 i 448,6 BTC, delta ledwie ujemna (−18,7 i −29,5 BTC), a cena utknęła między 72 388 a 72 728.

Linia frontu biegnie teraz przez POC ostatnich świec, 72 500 i 72 550, gdzie w obu ostatnich kwadransach pojawiły się nierównowagi kupna. Od dołu punktem odniesienia jest stos sprzedaży 72 100–72 200 z dołkiem zrzutu, od góry pasmo VWAP −1σ przy 72 638 i POC świec z południa przy 72 750.

## Gdzie leży płynność

[[likwidacje]]

Mapa obejmuje 47% otwartych pozycji i wciąż jest przechylona w dół, mimo że zrzut część longów już zabrał. W 1% pod ceną czeka 79,8 mln USD longów, nad ceną 30,2 mln USD shortów. Pod ceną wyróżnia się przedział 71 750 z 53,3 mln USD, wyżej 72 000 z 17,3 mln USD, a dalej 70 500 z 42,3 mln USD. Nad ceną najbliższy jest przedział 73 000 z 30,2 mln USD, potem 73 750 z 24,8 mln USD i 75 000 z 27,1 mln USD. Model daje 49% na dotknięcie klastra shortów przy 73 150 i 45% na klaster longów przy 71 950 do 19:30.

## Kto handluje

[[przeplywy]]

Przez ostatnią dobę agresywna sprzedaż przeważała o 187,8 mln USD. Większość to 110 kont wielorybów z wynikiem −156 mln USD, ale tym razem sprzedawała też reszta rynku, ponad 21 tysięcy kont z wynikiem −31,8 mln USD. Animatorzy rynku są na zero. Perp handluje z premią −4,6 bp wobec indeksu, podobnie jak średnio przez dobę (−4,4 bp), a funding jest bliski zera. Arkusz w ±10 bp ma 44% bidów wobec zwykłych 49% o tej godzinie, więc strona kupna jest cieńsza niż zwykle.

## Zmienność i rozkład

[[scenariusze]]

Do 19:30 model liczy σ 124 bp, co daje zakres 68% od 71 675 do 73 480 i 95% od 70 790 do 74 399. Zmienność 5 min z całej doby to 11,5 bp wobec 15,1 bp w poprzednich pięciu dniach roboczych, ale obecny reżim jest żywszy: 13,8 bp na 5 minut, trwa około 2 godzin, a szansa jego zmiany w najbliższych 25 minutach to 6%. Prognoza desku na 4 godziny daje medianę 72 567 i połowę wyników w 72 043–73 133. Na dziennym rynku HIP-4 „BTC powyżej 73 567” na jutro na 07:00 rynek płaci 22%, model desku daje 21%, różnica jest w granicach szumu.

## Struktura dnia

[[poziomy]]

Cena siedzi na klastrze longów 72 550 i tuż pod pasmem VWAP −1σ, więc oba poziomy model widzi dotknięte prawie na pewno (98% i 95%). Nad ceną najbliżej jest okrągłe 73 000 z 61%, potem ciasna strefa VWAP dnia 73 133, klastra shortów 73 150 i PDL 73 174 z szansą 47–51%. Wyżej dołek Azji 73 379 (34%), wczorajszy VAL 73 519 (26%) i otwarcie Londynu 73 623 (21%). Pod ceną pasmo −2σ 72 142 ma 58%, a klaster longów 71 950 45%. Otwarcie Nowego Jorku o 15:30 wypada więc w dolnej części zakresu dnia.

## Co musiałoby się wydarzyć

[[setupy]]

Do wzrostu potrzebne jest zamknięcie kwadransa nad PDL 73 174 z dodatnią deltą, czyli powrót przez strefę, której od 12:45 nie dotknęła żadna świeca; spadek OI przy takim ruchu znaczyłby zamykanie shortów z klastra 73 000. Do spadku cena musiałaby zamknąć kwadrans pod dołkiem 72 112 bez absorpcji przy stosie sprzedaży, a OI decydowałby, czy to nowe shorty, czy kolejne likwidacje longów. Bez żadnego z tych zdarzeń zostaje konsolidacja między pasmami VWAP, a środkowy scenariusz model wycenia na 51%.

## Na co patrzę dalej

Najpierw pierwsza godzina Nowego Jorku: czy rynek wróci do dołka 72 112, czy odbicie dojdzie do 73 000 i strefy PDL. Obserwuję, czy wieloryby dalej sprzedają i czy OI zacznie rosnąć przy spadkach, bo to oznaczałoby nowe shorty zamiast samych likwidacji. Obraz zmienia zamknięcie kwadransa nad pasmem −1σ 72 638 albo pod 72 112.

## Rzetelność modelu

Przedziały desku na 4 godziny są dobrze skalibrowane: przedział 90% obejmuje 92% wyników, a 60% obejmuje 74% (n 2008), więc węższy przedział jest raczej zbyt ostrożny. Dla dotknięć PDH, PDL i środka Brier wynosi 0,074 wobec 0,082 dla bazy odległości i 0,123 dla częstości bazowej, czyli BSS 0,10 wobec odległości i 0,40 wobec częstości (n 2016). Przewaga nad samą odległością jest więc skromna.

Prawdopodobieństwa pochodzą z modelu desku HAR + FHS i symulacji Monte Carlo, policzone o 14:50 i zapisane przed faktem, a o 19:30 rozliczymy je z tym, co się stało. Następny wpis po otwarciu Nowego Jorku, o 15:45.
