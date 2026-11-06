---
title: "BTC 75 791 przed Nowym Jorkiem, zakres 68% do 19:30 od 74 850 do 76 977"
description: "Cena wróciła pod VWAP dnia 75 904 tuż przed otwarciem NY. Pod nią 22,6 mln USD longów do likwidacji w 1%, nad nią tylko 1,6 mln USD shortów."
date: 2026-11-06T14:50:27+01:00
type: article
section: Mapa przed Nowym Jorkiem
price: 75791
levels:
  - { label: "Likwidacje shortów", price: 76650, note: "5,8 mln USD, 47% dotknięcia do 19:30" }
  - { label: "Szczyt Azji", price: 76400, note: "63% dotknięcia do 19:30" }
  - { label: "POC wczoraj", price: 76057, note: "88% dotknięcia do 19:30" }
  - { label: "VWAP dnia", price: 75904, note: "100% dotknięcia do 19:30" }
  - { label: "Otwarcie Londynu", price: 75591, note: "74% dotknięcia do 19:30" }
  - { label: "Likwidacje longów", price: 75350, note: "10,0 mln USD, 58% dotknięcia do 19:30" }
  - { label: "Dołek Azji", price: 75292, note: "55% dotknięcia do 19:30" }
  - { label: "VAL wczoraj", price: 75202, note: "49% dotknięcia do 19:30" }
  - { label: "PDL", price: 75189, note: "48% dotknięcia do 19:30" }
scenarios:
  - label: "Cena o 19:30 poniżej 75 350"
    probability: 31
    note: "Sprzedający z 14:30 muszą dostać kontynuację: zamknięcia pod otwarciem Londynu 75 591, potem zjazd w klaster longów przy 75 350 i test nocnego dołka 75 189."
  - label: "Cena o 19:30 między 75 350 a 76 400"
    probability: 37
    note: "Rynek zostaje w rotacji, którą zna od nocy: między dołkiem Azji a jej szczytem, z VWAP dnia 75 904 jako środkiem ciężkości."
  - label: "Cena o 19:30 powyżej 76 400"
    probability: 32
    note: "Cena musi odzyskać 76 050 do 76 100, gdzie stoją nierównowagi sprzedaży z 14:30, i przebić szczyt Azji 76 400, najlepiej przy spadającym OI."
summary:
  - "Po wczorajszym zjeździe z 79 872 do 75 189 BTC od nocy chodzi w wąskiej rotacji, a teraz stoi przy 75 791, 0,42σ pod VWAP dnia 75 904."
  - "Model do 19:30 daje zakres 68% od 74 850 do 76 977, a VWAP dnia ma 100% szans dotknięcia przy odchyleniu 140 bp."
  - "W ostatniej godzinie cena spadła o 425 USD, a OI wzrósł o 71,6 BTC, czyli przybyło nowych shortów."
  - "Wieloryby sprzedały w 24 h netto za 223,6 mln USD, a pod ceną leży 22,6 mln USD longów do likwidacji w 1%."
metrics:
  - { label: "Premia perp", value: "−0,8 bp", note: "średnio 24 h −1,0 bp" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,12 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "−230,5 mln USD", note: "kupno biorców 947,7, sprzedaż 1 178,2 mln USD", bias: down }
  - { label: "Likwidacje 24 h", value: "37,0 mln USD", note: "longi 32,4, shorty 4,6 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "22,6 mln USD", note: "do likwidacji między 75 033 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "1,6 mln USD", note: "do likwidacji między ceną a 76 549" }
  - { label: "Arkusz ±10 bp: bidy", value: "47% bidów", note: "zwykle o tej godzinie 50% (16 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "18,0 bp", note: "poprzednie dni robocze (5): 14,1 bp" }
liquidations:
  step: 250
  coverage: 47
  shorts: [[79000, 0.8], [78750, 2.4], [78500, 6.8], [78250, 0.8], [78000, 0.8], [77750, 0.8], [77500, 2.8], [77250, 4.6], [77000, 3.7], [76750, 26.3], [76500, 2.4], [76250, 0.2], [76000, 0.1]]
  longs: [[75250, 10.5], [75000, 15.4], [74750, 9.4], [74500, 29.7], [74250, 15.3], [74000, 32.3], [73750, 5.5], [73500, 10.6], [73250, 7.9], [73000, 17.9], [72750, 11.8], [72500, 40.1], [72250, 19.2]]
  note: "Mapa z 14:49, cena wtedy 75 913; pokrycie 47% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: -223.6, note: "170 kont" }
    - { label: "Reszta rynku", value: 18.9, note: "31 650 kont" }
    - { label: "Animatorzy rynku", value: -25.8, note: "230 kont" }
setups:
  - name: "Odzyskanie VWAP i test klastra shortów nad szczytem Azji"
    bias: up
    zone: [76400, 76650]
    window: "do 19:30"
    triggers:
      - "Zamknięcie świecy 15 min nad VWAP dnia 75 904 i nad 76 050, gdzie o 14:30 stały nierównowagi sprzedaży."
      - "Delta tej świecy dodatnia, bez nowego stosu nierównowag sprzedaży nad 76 000."
      - "OI stoi albo spada, czyli zamykają się shorty dobrane o 14:30, a nie dochodzą nowe."
    invalidation: "Zamknięcie 15 min z powrotem pod VWAP dnia 75 904."
    reactions:
      - { label: "POC wczoraj", price: 76057 }
      - { label: "Szczyt Azji", price: 76400 }
      - { label: "Likwidacje shortów", price: 76650 }
  - name: "Kontynuacja sprzedaży z 14:30 do klastra longów"
    bias: down
    zone: [75189, 75350]
    window: "do 19:30"
    triggers:
      - "Zamknięcie świecy 15 min pod otwarciem Londynu 75 591 i pod VAL 24 h 75 475."
      - "Delta wyraźnie ujemna, bez absorpcji sprzedaży przy 75 600 do 75 700."
      - "OI rośnie dalej (nowe shorty), a potem spada skokowo razem z likwidacjami longów."
    invalidation: "Powrót i zamknięcie 30 min nad VWAP dnia 75 904."
    reactions:
      - { label: "Likwidacje longów", price: 75350 }
      - { label: "Dołek Azji", price: 75292 }
      - { label: "PDL", price: 75189 }
    evidence: "Laboratorium desku dla przebicia PDL: 45% przy 48% dla losowego poziomu (n 93), czyli bez przewagi, to tylko opis zjawiska."
  - name: "Rotacja wokół VWAP w paśmie ±1σ"
    bias: flat
    zone: [75637, 76172]
    window: "do 19:30"
    triggers:
      - "Zamknięcia 15 min na przemian po obu stronach VWAP dnia 75 904."
      - "Delta kolejnych świec zmienia znak, bez stosu nierównowag w jedną stronę."
      - "OI płaskie, bez skoku likwidacji z żadnej strony."
    invalidation: "Zamknięcie 30 min poza pasmem, pod 75 637 albo nad 76 172."
    reactions:
      - { label: "VWAP dnia", price: 75904 }
      - { label: "POC wczoraj", price: 76057 }
      - { label: "Otwarcie Londynu", price: 75591 }
    evidence: "Powrót do VWAP w laboratorium desku: 35% przy 43% dla losowego punktu (n 184), czyli bez przewagi; traktuję to jako wskazówkę, nie statystykę."
---
## Co się stało

Wczoraj o 14:45 BTC stał jeszcze przy 79 872. Sprzedaż ruszyła po 15:30, a między 15:45 a 16:30 poszły największe paczki likwidacji longów: 5,76, 7,56 i 5,2 mln USD w trzech kolejnych kwadransach. O północy rynek dobił do 75 189 i to jest dołek doby. Od 00:30 nic wielkiego się nie dzieje: rynek chodzi między 75 292 a 76 400, Londyn otworzył na 75 591, o 10:00 cena wyszła nad VWAP dnia i trzymała się nad nim do 14:00. Ostatnia świeca przed wpisem, z 14:30, zjechała do 75 605 i zamknęła na 75 791, znowu pod VWAP. Rano w [mapie dnia](../2026-11-06-mapa-dnia/) opisałem noc; teraz patrzę na to, co zostawił Londyn.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Wczorajsza świeca dzienna rozciąga się od 80 888 (PDH) do 75 189 (PDL), a dziś od kilkunastu godzin rynek nie umie ani odbić, ani zejść niżej. Ruch w dół był wybiciem z kontynuacją, ale po nocnym dołku kontynuacji już nie ma. Cena stoi w dolnym skraju tej świecy, blisko wczorajszego minimum.

**Wartość.** POC z 24 godzin to 76 100, obszar wartości od 75 475 do 76 725, a cena 75 791 jest w jego środku. Ceny pod wartością pojawiały się kilka razy: o północy zejście do 75 189 wróciło nad 75 800 już w następnym kwadransie, z długim knotem, o 07:00 pod 75 475 zamknął jeden kwadrans, a od 08:00 dwa kolejne, po czym świeca z 08:30 zamknęła na 75 699. Żadne wyjście w dół nie utrzymało się dłużej niż pół godziny, więc wszystkie zostały odrzucone, nie zaakceptowane.

**VWAP.** VWAP dnia to 75 904, odchylenie pasma 267,8 USD, a cena stoi 0,42σ pod nim. Od 10:00 do 13:45 każde zamknięcie 15 min było nad VWAP, a górne pasmo +1σ działało jak sufit: zamknięcia tylko trochę nad nim, najwyżej o 13:15 przy 76 329, i za każdym razem powrót pod pasmo. Od 14:00 cena chodzi po obu stronach VWAP i ostatnia świeca zamknęła pod nim.

**Przepływ i pozycje.** W ostatniej godzinie delta wynosi −278 BTC, cena spadła o 425 USD, a OI wzrósł o 71,6 BTC. W ostatnich 4 godzinach delta −168,7 BTC, cena niżej o 316 USD, OI wyżej o 182,3 BTC. Cena w dół przy rosnącym OI to według macierzy nowe shorty, a nie zamykanie longów. Taśma kończy się o 14:45, pięć minut przed wpisem, więc ostatnie minuty są bez danych.

## Footprint końcówki Londynu

[[footprint]]

Ostatnie dwie godziny to przeciąganie liny. O 13:15 kupujący zrobili inicjatywę: stos nierównowag kupna od 76 100 do 76 300, delta +232,3 BTC i OI wyżej o 194,3 BTC, czyli nowe longi, z ekstremum 76 377. Odpowiedź przyszła od razu: o 13:30 nierównowaga sprzedaży przy 76 250 i ujemna delta, o 14:00 delta −242,7 BTC przy OI niżej o 141,1 BTC, czyli zamykanie tych longów, do 75 794. Kwadrans 14:15 dał stos nierównowag kupna od 75 900 do 76 000 i deltę +273,7 BTC, ale OI spadło, więc to głównie zamykanie shortów, i cena nie przebiła 76 067. O 14:30 przyszła najcięższa świeca okna: 1 078,2 BTC wolumenu, delta −252,9 BTC, OI wyżej o 181,4 BTC i zjazd do 75 605.

Linia frontu to teraz pas od 75 900 do 76 050. Jeszcze o 14:15 trzymały go nierównowagi kupna, a o 14:30 te same ceny przejęły nierównowagi sprzedaży (75 900, 76 000 i 76 050). Niżej punktem odniesienia jest POC świecy z 14:30 przy 75 700, a wyżej stos kupna z 13:15 od 76 100 do 76 300, który teraz jest nad ceną.

## Gdzie leży płynność

[[likwidacje]]

Mapa jest wyraźnie przechylona w dół. W 1% pod ceną czeka 22,6 mln USD longów do likwidacji, w 1% nad ceną tylko 1,6 mln USD shortów. Najbliżej pod ceną są przedziały 75 250 (10,5 mln USD) i 75 000 (15,4 mln USD), głębiej 74 500 z 29,7 mln USD i 74 000 z 32,3 mln USD. Nad ceną jedyny duży klaster to 76 750 z 26,3 mln USD; reszta to drobne kwoty. Mapa widzi 47% otwartych pozycji, więc to obraz częściowy.

## Kto handluje

[[przeplywy]]

Przez 24 godziny agresorzy sprzedali netto za 230,5 mln USD, a prawie całość to wieloryby: 223,6 mln USD po stronie sprzedaży na 170 kontach. Reszta rynku, 31 650 kont, była lekko po stronie kupna, 18,9 mln USD. Premia perpa jest ujemna, −0,8 bp przy średniej 24 h −1,0 bp, a funding 0,13 bp/h jest blisko średniej z doby (0,12 bp/h). W arkuszu w paśmie ±10 bp bidy mają 47%, przy typowych 50% o tej godzinie.

## Zmienność i rozkład

[[scenariusze]]

Do 19:30 model liczy odchylenie 140 bp: zakres 68% od 74 850 do 76 977, zakres 95% od 73 808 do 78 064. Rozkład dzieli się prawie po równo: 31% na zamknięcie okna pod 75 350, 37% w środku i 32% nad 76 400. Zmienność 5 min z doby to 18,0 bp wobec 14,1 bp w poprzednich dniach roboczych, a bieżący reżim to 9,0 bp na 5 min, trwa około 5 godzin i ma 1% szans na zmianę w najbliższych 25 minutach. Prognoza desku na 4 godziny z 14:47 ma medianę 75 911 i przedział 50% od 75 246 do 76 601. Rynek dzienny HIP-4 „BTC powyżej 75 679” na jutro 07:00 płaci 60%, model desku daje 54%.

## Struktura dnia

[[poziomy]]

Cena siedzi w samym środku dnia. VWAP 75 904 ma 100% szans dotknięcia do 19:30, wczorajszy POC 76 057 ma 88%, a otwarcie Londynu 75 591 ma 74%. Dalej od ceny symetria jest zaskakująco duża: szczyt Azji 76 400 ma 63%, klaster longów 75 350 ma 58%, dołek Azji 75 292 ma 55%, a wczorajszy dołek 75 189 ma 48%. Nad 76 400 jest już tylko klaster shortów przy 76 650 z 47%.

## Co musiałoby się wydarzyć

[[setupy]]

Żeby obraz przechylił się w górę, cena musi odzyskać pas 75 900 do 76 050, który o 14:30 zmienił właściciela, i to przy spadającym OI, bo wtedy wiadomo, że zamykają się świeże shorty. Wariant w dół wymaga zamknięć pod otwarciem Londynu i pod VAL 75 475, a dopiero potem wejścia w klaster longów przy 75 350; wcześniejsze wyjścia pod wartość zostały dziś odrzucone, więc kolejne musiałoby wyglądać inaczej. Rotacja wokół VWAP to po prostu ciąg dalszy tego, co rynek robi od nocy.

## Na co patrzę dalej

Pierwsze półgodziny po otwarciu Nowego Jorku o 15:30 zdecydują, czy nowe shorty z 14:30 dostaną kontynuację. Patrzę na zamknięcia 15 min wobec VWAP 75 904, na OI przy pierwszym ruchu i na to, czy pod 75 600 pojawi się absorpcja sprzedaży, czy skok likwidacji longów. Wyjście nad 76 400 przy rosnącym OI albo zamknięcia pod 75 475 przy rosnących likwidacjach zmieniają mapę.

## Rzetelność modelu

Prognozy desku są rozliczane w dzienniku. Przedział 90% na 4 godziny objął cenę w 90% przypadków (n 1433), a przedział 60% w 71%, więc środek rozkładu jest raczej za szeroki niż za wąski. Szanse dotknięcia PDH, PDL i środka mają Brier 0,074 wobec 0,121 dla samej częstości bazowej (n 1441), czyli wyraźnie lepiej niż zgadywanie z historii.

Prawdopodobieństwa w tym wpisie pochodzą z modelu desku HAR + FHS i symulacji Monte Carlo, policzone o 14:50 i zapisane przed faktem, żeby dało się je potem rozliczyć. Następny wpis to notka po otwarciu Nowego Jorku, o 15:45.
