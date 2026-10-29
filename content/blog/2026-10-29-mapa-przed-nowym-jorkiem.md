---
title: "BTC 80 109 przed Nowym Jorkiem: shorty za 30,2 mln USD w 1% nad ceną"
description: "Cena stoi na VWAP dnia po nocnym zejściu do 79 667. Zakres 68% do 18:30 to od 79 203 do 80 897, a nad ceną czeka klaster likwidacji shortów 28,0 mln USD przy 80 850."
date: 2026-10-29T13:50:22+01:00
type: article
section: Mapa przed Nowym Jorkiem
price: 80109
levels:
  - { label: "POC wczoraj", price: 81160, note: "18% dotknięcia do 18:30" }
  - { label: "Likwidacje shortów", price: 80850, note: "28,0 mln USD, 33% dotknięcia do 18:30" }
  - { label: "VAL wczoraj", price: 80606, note: "50% dotknięcia do 18:30" }
  - { label: "PDL", price: 80362, note: "70% dotknięcia do 18:30" }
  - { label: "VWAP dnia", price: 80122, note: "93% dotknięcia do 18:30" }
  - { label: "Otwarcie Londynu", price: 79826, note: "78% dotknięcia do 18:30" }
  - { label: "Dołek Azji", price: 79668, note: "63% dotknięcia do 18:30" }
  - { label: "Likwidacje longów", price: 79350, note: "12,9 mln USD, 38% dotknięcia do 18:30" }
  - { label: "Likwidacje longów", price: 78950, note: "27,1 mln USD, 18% dotknięcia do 18:30" }
scenarios:
  - label: "Cena o 18:30 poniżej 79 670"
    probability: 32
    note: "Cena musi zamknąć się pod nocnym dołkiem 79 667 i wejść w klaster longów przy 79 350, czyli sprzedający muszą przebić miejsce, którego w nocy nie dali rady ruszyć."
  - label: "Cena o 18:30 między 79 670 a 80 360"
    probability: 32
    note: "Rotacja w nocnym zakresie: VWAP dnia 80 122 i okrągłe 80 000 dalej trzymają cenę, a ani wczorajsze minimum, ani dołek Azji nie zostają przebite na zamknięcie."
  - label: "Cena o 18:30 powyżej 80 360"
    probability: 36
    note: "Cena musi wrócić nad wczorajsze minimum 80 362 i się tam utrzymać. Po drodze wyżej leży klaster shortów między 80 750 a 81 000."
summary:
  - "Nocna wyprzedaż zepchnęła BTC do 79 667, a od rana cena kręci się wokół VWAP dnia 80 122 pod wczorajszym minimum 80 362."
  - "W 1% nad ceną leży 30,2 mln USD likwidacji shortów, a w 1% pod ceną tylko 5,8 mln USD longów."
  - "Wieloryby sprzedały netto 18,1 mln USD w 24 h, a reszta rynku kupiła 14,7 mln USD."
  - "Model daje 68% szans na cenę od 79 203 do 80 897 o 18:30, a scenariusze rozkładają się prawie po równo: 32, 32 i 36%."
metrics:
  - { label: "Premia perp", value: "−2,1 bp", note: "średnio 24 h −2,8 bp" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,12 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "−12,1 mln USD", bias: down, note: "kupno biorców 120,1, sprzedaż 132,2 mln USD" }
  - { label: "Likwidacje 24 h", value: "12,9 mln USD", note: "longi 11,8, shorty 1,0 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "5,8 mln USD", note: "do likwidacji między 79 308 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "30,2 mln USD", note: "do likwidacji między ceną a 80 910" }
  - { label: "Arkusz ±10 bp: bidy", value: "45% bidów", note: "zwykle o tej godzinie 50% (7 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "9,8 bp", note: "poprzednie dni robocze (5): 10,3 bp" }
liquidations:
  step: 250
  coverage: 44
  shorts: [[83500, 2.3], [83250, 2.8], [83000, 7.6], [82750, 4.3], [82500, 3.8], [82250, 2.4], [82000, 1.5], [81750, 5.6], [81500, 4.4], [81250, 3], [81000, 22.8], [80750, 29.9], [80500, 0.3]]
  longs: [[79500, 4.9], [79250, 13.8], [79000, 19.9], [78750, 33.8], [78500, 18.5], [78250, 10.2], [78000, 8], [77750, 4.7], [77500, 9.1], [77250, 11.8], [77000, 28.8], [76750, 3.2], [76500, 1.3]]
  note: "Mapa z 13:47, cena wtedy 80 065; pokrycie 44% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: -18.1, note: "70 kont" }
    - { label: "Reszta rynku", value: 14.7, note: "20 200 kont" }
    - { label: "Animatorzy rynku", value: -8.7, note: "220 kont" }
setups:
  - name: "Powrót nad wczorajsze minimum i domykanie shortów"
    bias: up
    zone: [80362, 80850]
    window: "do 18:30"
    triggers:
      - "Zamknięcie świecy 15 min nad PDL 80 362, a potem nad VWAP +1σ 80 464."
      - "Delta na świecach wybicia dodatnia, bez szybkiego powrotu pod 80 362."
      - "OI spada przy wzroście ceny, co oznacza zamykanie shortów, a nie nowe longi."
    invalidation: "Zamknięcie 15 min z powrotem pod VWAP dnia 80 122."
    reactions:
      - { label: "VAL wczoraj", price: 80606 }
      - { label: "Likwidacje shortów", price: 80850 }
      - { label: "POC wczoraj", price: 81160 }
  - name: "Drugie podejście pod nocny dołek"
    bias: down
    zone: [79350, 79826]
    window: "do 18:30"
    triggers:
      - "Zamknięcie świecy 15 min pod otwarciem Londynu 79 826."
      - "Ujemna delta przy próbie zejścia pod dołek Azji 79 668."
      - "OI spada razem z ceną i rosną likwidacje longów, czyli zamykanie longów."
    invalidation: "Zamknięcie 15 min z powrotem nad VWAP dnia 80 122."
    reactions:
      - { label: "Dołek Azji", price: 79668 }
      - { label: "Likwidacje longów", price: 79350 }
      - { label: "Likwidacje longów", price: 78950 }
  - name: "Rotacja wokół VWAP i okrągłych 80 000"
    bias: flat
    zone: [79826, 80362]
    window: "do 18:30"
    triggers:
      - "Zamknięcia świec 15 min po obu stronach VWAP dnia 80 122 bez kontynuacji."
      - "Delta naprzemienna, bez stosów nierównowag w jedną stronę."
      - "OI płaski, bez skoku likwidacji."
    invalidation: "Zamknięcie 15 min poza zakresem od 79 826 do 80 362."
    reactions:
      - { label: "VWAP dnia", price: 80122 }
      - { label: "PDL", price: 80362 }
      - { label: "Otwarcie Londynu", price: 79826 }
    evidence: "Reguła wsparcia na okrągłej cenie: n 312, częstość 53% wobec losowej 49%, laboratorium nie widzi przewagi, to szum."
---
## Co się stało

Wczoraj o 21:00 BTC był jeszcze przy 81 780, blisko wczorajszego maksimum 81 804. W nocy przyszła wyprzedaż: między 02:30 a 03:45 cena zjechała pod wczorajsze minimum 80 362 i dalej, aż do 79 667. Od rana rynek stoi w wąskim pasie od mniej więcej 79 800 do 80 300 i teraz, około 80 100, siedzi praktycznie na VWAP dnia. Przez ostatnie 24 h zlikwidowano 12,9 mln USD pozycji, z czego 11,8 mln USD to longi.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Wczorajszy dzień zamknął się w zakresie od 80 362 do 81 804. Nocne zejście pod jego dół miało kontynuację o kolejne 700 dolarów, ale potem się zatrzymało i od kilkunastu godzin cena nie wróciła nad wczorajsze minimum. To wybicie w dół, które na razie zostało przyjęte, tylko bez dalszego ciągu.

**Wartość.** Obszar wartości z 24 godzin to od 80 175 do 81 500, z POC przy 81 150. Cena jest pod wartością i jest tam od nocy, więc to nie jest szybkie odrzucenie, tylko akceptacja niższych cen. Ostatnie podejście w świecy od 13:30 sięgnęło 80 261, czyli lekko nad VAL, i cena zeszła z powrotem.

**VWAP.** VWAP dnia wynosi 80 122, odchylenie pasma 343 dolary, a cena jest 0,04σ pod nim, czyli dokładnie na linii. Od rana VWAP działa jak środek rotacji. Pasmo +1σ przy 80 464 i pasmo −1σ przy 79 779 wyznaczają brzegi, które nie zostały dziś zamknięte poza.

**Przepływ i pozycje.** W ostatnich 4 godzinach cena wzrosła o 136 dolarów, delta wyniosła +15,1 BTC, a OI wzrósł o 106 BTC, więc to drobne nowe longi. W ostatniej godzinie cena spadła o 63 dolary przy delcie −7,1 BTC i spadku OI o 106 BTC, czyli te longi częściowo się zamknęły. Nic z tego nie przesądza kierunku, dopóki cena nie wyjdzie poza nocny zakres.

## Footprint nocnej wyprzedaży

[[footprint]]

Inicjatywa była po stronie sprzedających: świeca od 02:30 zostawiła stos czterech nierównowag sprzedaży od 80 800 do 80 500, a świeca od 02:45 kolejne cztery od 80 400 do 80 000 przy delcie −731,5 BTC, wolumenie 1 464 BTC i spadku OI o 142 BTC. To było zamykanie longów i likwidacje, nie nowe shorty. W świecy od 03:00 kupujący oddali deltę +227 BTC, a cena i tak zeszła niżej, więc ich kupno zostało wchłonięte. Ostatnie pchnięcie przyszło o 03:30 do 79 671 przy wolumenie 690 BTC, o połowę mniejszym niż w świecy wybicia, a o 03:45 cena zrobiła dołek 79 667, tylko 4 dolary niżej, i zamknęła się przy 79 934 z dodatnią deltą. To wygląda na wyczerpanie sprzedaży.

Linia frontu z tej nocy to 80 000, gdzie wypadł POC świecy wybicia, i stos nierównowag sprzedaży od 80 100 do 80 400 nad nim. Pod ceną punktem odniesienia są nierównowagi kupna przy 79 700 i 79 800 ze świecy dołka. Z dzisiejszej taśmy dochodzi nietknięta strefa kupna od 80 180 do 80 210 i absorpcja 38,1 BTC sprzedaży przy 80 156.

## Gdzie leży płynność

[[likwidacje]]

Mapa jest wyraźnie asymetryczna. Nad ceną w przedziale od 80 750 stoi 29,9 mln USD likwidacji shortów, a od 81 000 kolejne 22,8 mln USD. Pod ceną najbliżej jest tylko 4,9 mln USD od 79 500, większe skupiska zaczynają się od 79 250 (13,8 mln USD) i 78 750 (33,8 mln USD). Mapa obejmuje 44% otwartych pozycji, więc to obraz częściowy.

## Kto handluje

[[przeplywy]]

Przez dobę agresorzy sprzedali netto za 12,1 mln USD. Sprzedawały głównie wieloryby, 18,1 mln USD z 70 kont, a reszta rynku, ponad 20 tysięcy kont, kupowała za 14,7 mln USD. Premia perpetuala jest ujemna, −2,1 bp przy średniej −2,8 bp, a funding 0,13 bp/h jest blisko średniej. Nikt tu nie płaci dużo za kierunek.

## Zmienność i rozkład

[[scenariusze]]

Model liczy σ 106 bp do 18:30, co daje zakres 68% od 79 203 do 80 897 i 95% od 78 369 do 81 758. Zmienność 5 minut z doby to 9,8 bp wobec 10,3 bp w poprzednich dniach roboczych, a reżim trwa około 11 godzin przy 2% szans na zmianę w najbliższych 25 minutach. Dzienny rynek HIP-4 na BTC powyżej 80 207 rano 30.10 wycenia 43% i model desku daje dokładnie tyle samo. Prognoza desku na 4 godziny ma medianę 80 052 i połowę rozkładu od 79 517 do 80 593.

## Struktura dnia

[[poziomy]]

Cena siedzi na VWAP dnia 80 122, który model dotyka z szansą 93%. Wczorajsze minimum 80 362 ma 70%, otwarcie Londynu 79 826 ma 78%, a dołek Azji 79 668 ma 63%. Dalej od ceny szanse szybko maleją: klaster shortów 80 850 ma 33%, wczorajszy POC 81 160 ma 18%.

## Co musiałoby się wydarzyć

[[setupy]]

Żeby obraz się przechylił w górę, cena musi wrócić nad wczorajsze minimum i zostać tam przy spadającym OI, bo wtedy klaster shortów od 80 750 staje się magnesem. W dół potrzebne jest zamknięcie pod otwarciem Londynu i drugie podejście pod nocny dołek. Bez jednego z tych zdarzeń najbardziej naturalna jest dalsza rotacja wokół VWAP, ale model daje każdej z trzech stron podobne szanse.

## Na co patrzę dalej

Pierwsze pół godziny po otwarciu w Nowym Jorku o 14:30. Patrzę, czy wieloryby dalej sprzedają, czy cena wyjdzie poza pas od 79 826 do 80 362 na zamknięciu świecy 15 minut i co zrobi przy tym OI.

## Rzetelność modelu

Przedziały desku są raczej za szerokie niż za wąskie: przedział 90% na 4 godziny objął cenę w 96% przypadków, a 60% w 76% (n 660). Dotknięcia wczorajszego szczytu, dołka i środka model trafia z Brierem 0,075 wobec 0,110 dla częstości bazowej (n 668), więc lepiej niż samo liczenie częstości.

Prawdopodobieństwa pochodzą z modelu zmienności desku HAR + FHS i symulacji Monte Carlo, liczone o 13:50 i zapisane przed faktem, żeby dało się je potem rozliczyć. Następny wpis po otwarciu Nowego Jorku, o 14:45.
