---
title: "BTC 13,53% pod otwarciem tygodnia i 5,35% pod piątkowym CME: mapa tygodnia"
description: "BTC na 64 706 po tygodniu, który zabrał 13,53%. Luka CME, klastry likwidacji przy 65 250 i 63 750 oraz zakres do poniedziałku 09:00."
date: 2026-11-15T20:00:16+01:00
type: article
section: Mapa tygodnia
price: 64706
levels:
  - { label: "Szczyt Azji", price: 65574, note: "55% dotknięcia do 09:00" }
  - { label: "Likwidacje shortów", price: 65525, note: "5,3 mln USD, 57% dotknięcia do 09:00" }
  - { label: "POC wczoraj", price: 65392, note: "64% dotknięcia do 09:00" }
  - { label: "Likwidacje shortów", price: 65275, note: "6,4 mln USD, 69% dotknięcia do 09:00" }
  - { label: "VWAP dnia", price: 64163, note: "69% dotknięcia do 09:00" }
  - { label: "Likwidacje longów", price: 64075, note: "5,8 mln USD, 64% dotknięcia do 09:00" }
  - { label: "Otwarcie Londynu", price: 63997, note: "61% dotknięcia do 09:00" }
  - { label: "Likwidacje longów", price: 63875, note: "6,4 mln USD, 55% dotknięcia do 09:00" }
  - { label: "VAL wczoraj", price: 63296, note: "32% dotknięcia do 09:00" }
scenarios:
  - label: "Cena w poniedziałek o 09:00 poniżej 64 080"
    probability: 33
    note: "Cena musi zejść pod VWAP dnia 64 163 i przejść przez klaster longów przy 64 000, czyli oddać dużą część odbicia od nocnego dołka. Luka CME w dół na otwarciu może to przyspieszyć."
  - label: "Cena w poniedziałek o 09:00 między 64 080 a 65 280"
    probability: 31
    note: "Rotacja w obszarze wartości wokół POC 24 h 64 725, bez zamknięcia nad pasmem +1σ VWAP 65 164 i bez zejścia pod VWAP dnia."
  - label: "Cena w poniedziałek o 09:00 powyżej 65 280"
    probability: 36
    note: "Kupujący muszą odzyskać pasmo +1σ VWAP 65 164 i dojść do klastra shortów przy 65 250, gdzie mapa pokazuje 14,4 mln USD do likwidacji."
summary:
  - "Tydzień od otwarcia 74 820 kończy się na 64 696, czyli 13,53% niżej, z dołkiem 61 970 w nocy z soboty na niedzielę."
  - "BTC stoi 5,35% pod piątkowym zamknięciem CME 68 362, a model daje 68% na cenę otwarcia CME między 63 868 a 65 535."
  - "Zakres 68% do poniedziałku 09:00 to 63 182 do 66 246, a w 1% nad ceną czeka 9,8 mln USD shortów do likwidacji wobec 1,5 mln longów pod ceną."
  - "W 24 godziny zlikwidowano 174,9 mln USD pozycji, z czego 139,7 mln to longi."
metrics:
  - { label: "Premia perp", value: "−4,9 bp", note: "średnio 24 h −3,6 bp" }
  - { label: "Funding", value: "0,02 bp/h", note: "średnio 24 h 0,09 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "36,3 mln USD", note: "kupno biorców 2 586,2, sprzedaż 2 549,8 mln USD" }
  - { label: "Likwidacje 24 h", value: "174,9 mln USD", note: "longi 139,7, shorty 35,2 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "1,5 mln USD", note: "do likwidacji między 64 059 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "9,8 mln USD", note: "do likwidacji między ceną a 65 353" }
  - { label: "Arkusz ±10 bp: bidy", value: "40% bidów", note: "zwykle o tej godzinie 49% (25 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "25,7 bp", note: "poprzednie dni robocze (5): 14,2 bp" }
liquidations:
  step: 250
  coverage: 48
  shorts: [[67500, 0.6], [67250, 2], [67000, 5], [66750, 5.7], [66500, 3.5], [66250, 8.9], [66000, 6.3], [65750, 0.4], [65500, 7.8], [65250, 14.4], [65000, 0.8]]
  longs: [[64250, 0.7], [64000, 7.5], [63750, 11], [63500, 5.3], [63250, 5.2], [63000, 4.5], [62750, 1.9], [62500, 3.1], [62250, 0.6], [62000, 5.9], [61750, 12]]
  note: "Mapa z 19:56, cena wtedy 64 635; pokrycie 48% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: -71.6, note: "150 kont" }
    - { label: "Reszta rynku", value: 124.3, note: "32 500 kont" }
    - { label: "Animatorzy rynku", value: -16.4, note: "240 kont" }
setups:
  - name: "Powrót nad pasmo +1σ VWAP i stos nierównowag 65 000 do 65 200"
    bias: up
    zone: [65000, 65300]
    window: "do 09:00 w poniedziałek"
    triggers:
      - "Świeca 15 min zamyka się nad 65 300, czyli nad VAH 24 h i pasmem +1σ VWAP."
      - "Delta na świecy wybicia jest dodatnia, a kolejna świeca nie oddaje 65 164."
      - "OI rośnie razem z ceną (nowe longi) albo spada przy wzroście w klastrze shortów przy 65 250 (zamykanie shortów)."
    invalidation: "Zamknięcie 15 min z powrotem pod 65 000, w obszarze wartości."
    reactions:
      - { label: "Likwidacje shortów", price: 65525 }
      - { label: "Szczyt Azji", price: 65574 }
      - { label: "Klaster shortów 8,9 mln USD", price: 66250 }
  - name: "Zejście pod VWAP dnia w klaster longów 63 750 do 64 100"
    bias: down
    zone: [63750, 64163]
    window: "do 09:00 w poniedziałek"
    triggers:
      - "Świeca 15 min zamyka się pod VWAP dnia 64 163, pierwszy raz od 03:00."
      - "Delta tej świecy jest ujemna i nie pojawia się absorpcja przy 64 000."
      - "OI spada razem z ceną (zamykanie longów i likwidacje) albo rośnie przy spadku (nowe shorty)."
    invalidation: "Zamknięcie 15 min z powrotem nad 64 725, czyli nad POC 24 h."
    reactions:
      - { label: "Otwarcie Londynu", price: 63997 }
      - { label: "Likwidacje longów", price: 63875 }
      - { label: "VAL wczoraj", price: 63296 }
  - name: "Rotacja między VWAP a pasmem +1σ do otwarcia CME"
    bias: flat
    zone: [64163, 65164]
    window: "do 00:00 w poniedziałek"
    triggers:
      - "Świece 15 min zamykają się między VWAP dnia 64 163 a pasmem +1σ 65 164."
      - "Delta kolejnych świec zmienia znak bez serii w jedną stronę."
      - "OI stoi w miejscu, bez skoku likwidacji po żadnej stronie."
    invalidation: "Zamknięcie 15 min poza pasmem 64 163 do 65 164."
    reactions:
      - { label: "VWAP dnia", price: 64163 }
      - { label: "Likwidacje shortów", price: 65275 }
    evidence: "Hipoteza zamykania luki CME w laboratorium desku: n 23, częstość 48% wobec losowej 50%. Za mało przypadków i bez przewagi, więc traktuję to jako szum."
---
## Co się stało

To był ciężki tydzień. BTC otworzył go na 74 820, dotknął 75 585, a potem zjechał aż do 61 970. Teraz stoi na 64 696, czyli 13,53% pod otwarciem tygodnia. Poprzedni tydzień miał zakres od 73 457 do 81 177 i zamknął się na 74 821, więc cały ten zakres został za nami.

Ostatnia doba to dwie fale. W sobotę wieczorem cena zeszła z okolic 65 800 do 63 280 o 23:00, a w nocy przebiła PDL 63 272 i o 02:45 zrobiła dołek 61 970. Ta świeca zamknęła się już na 62 603 z deltą +1 373,4 BTC, a następna na 63 835. Do 10:00 rynek odbił do 66 088, przez kilka godzin trzymał się nad 65 300, a o 15:15 jedna świeca z deltą −1 051,5 BTC sprowadziła go z powrotem w okolice 64 600 do 64 800.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Trend z kilku dni jest spadkowy, a cena stoi w dolnej części zakresu tygodnia, ponad 10 000 dolarów pod jego szczytem. Nocne przebicie PDL 63 272 było nieudanym wybiciem dołem: dołek 61 970 trzymał się jedną świecę 15 min, potem cena wróciła nad PDL. Odbicie nie dotarło jednak do PDH 68 414 i zatrzymało się na 66 088.

**Wartość.** POC 24 h jest na 64 725, obszar wartości od 63 350 do 65 300, a cena stoi w jego środku, praktycznie na POC. Ceny nad VAH zostały zaakceptowane na kilka godzin: od 10:00 do 14:45 każda świeca 15 min zamknęła się nad 65 300. Po 15:15 rynek wrócił do wartości. Pod VAL cena była w nocy niecałą godzinę, od 02:00 do 02:45, i wyszła stamtąd jedną świecą z długim knotem.

**VWAP.** VWAP dnia to 64 163, a cena jest 0,54σ nad nim. Od 03:00 każda świeca 15 min zamknęła się nad VWAP, więc to on jest dziś wsparciem. Pasmo +1σ (teraz 65 164) działało jako wsparcie od 10:00 do 15:00, a od 15:15 jest oporem: od tej chwili żadne zamknięcie nie wróciło nad nie.

**Przepływ i pozycje.** Delta całej doby to −2 229,1 BTC, z ostatnich 4 godzin −738,5 BTC, z ostatniej godziny +61,3 BTC. W 4 godziny cena zmieniła się o −32 USD, a open interest spadło o 1 340,6 BTC, czyli rynek zamykał longi. W ostatniej godzinie cena wzrosła o 169 USD przy OI wyższym o 180,2 BTC, to drobne nowe longi. Sam rozjazd delty z ceną niczego jeszcze nie przesądza, liczy się reakcja ceny przy VWAP i paśmie +1σ.

## Footprint szczytu odbicia

[[footprint]]

Inicjatywa była po stronie kupujących od 09:30: delta +500,7 BTC przy OI wyższym o 624,9 BTC, a o 09:45 stos nierównowag kupna od 65 000 do 65 200. Świeca z 10:00 to szczyt dnia: wolumen 2 476,3 BTC, delta +899 BTC, OI +829,2 BTC, stos nierównowag kupna od 65 400 do 65 600 i POC na 65 900, tuż pod szczytem 66 088. Odpowiedź przyszła od razu: o 10:15 delta −173,2 BTC i OI niższe o 192 BTC, o 10:30 nierównowagi sprzedaży na 65 500 i 65 600. Potem wolumen malał (279,6 BTC o 10:45, 254,2 BTC o 11:00), czyli kupujący się wyczerpali, zanim rynek odpuścił po 15:00.

Linia frontu to dziś dwa stosy nierównowag kupna: 65 400 do 65 600 z 10:00 oraz 65 000 do 65 200 z 09:45. Oba zostały oddane po 15:15, więc teraz są nad ceną. POC świec z 10:45 do 11:15 leżał na 65 300 i 65 400, a POC 64 700 ze świecy z 09:30 to miejsce, w którym cena stoi teraz.

## Gdzie leży płynność

[[likwidacje]]

Mapa jest wyraźnie asymetryczna. W 1% nad ceną czeka 9,8 mln USD shortów do likwidacji, a w 1% pod ceną tylko 1,5 mln USD longów. Największy klaster nad ceną to 14,4 mln USD w przedziale od 65 250, dalej 7,8 mln przy 65 500 i 8,9 mln przy 66 250. Pod ceną longi zbierają się niżej: 7,5 mln przy 64 000, 11 mln przy 63 750 i 12 mln przy 61 750, pod nocnym dołkiem. Mapa obejmuje 48% otwartych pozycji, więc to obraz częściowy.

## Kto handluje

[[przeplywy]]

Przez 24 godziny agresorzy kupili netto za 36,3 mln USD, ale to suma przeciwnych ruchów. Wieloryby sprzedały netto 71,6 mln USD, reszta rynku kupiła 124,3 mln, a animatorzy rynku sprzedali 16,4 mln. Premia perpa to −4,9 bp wobec średnio −3,6 bp z doby, a funding spadł do 0,02 bp/h przy średniej 0,09 bp/h. Arkusz w ±10 bp ma 40% bidów, gdy zwykle o tej godzinie jest ich 49%.

## Zmienność i rozkład

[[scenariusze]]

Zakres 68% do poniedziałku 09:00 to 63 182 do 66 246, a 95% to 61 704 do 67 833. Odchylenie zwrotów 5 min z ostatnich 24 godzin wynosi 25,7 bp wobec 14,2 bp w poprzednich dniach roboczych, choć model widzi bieżący reżim niżej, na 15,5 bp na 5 min, trwający około 10 godzin. Prognoza desku na 4 godziny daje medianę 64 575 i 50% w przedziale 63 968 do 65 200. Na HIP-4 kontrakt „BTC powyżej 64 477” rynek wycenia na 61%, model na 58%.

Najważniejsza rzecz tej nocy to otwarcie CME o 00:00. Piątkowe zamknięcie było na 68 362, więc luka wynosi teraz 5,35%. Model daje 68% na cenę otwarcia od 63 868 do 65 535, czyli lukę od 4,14% do 6,57% w dół.

## Struktura dnia

[[poziomy]]

Cena stoi między VWAP dnia 64 163 a pasmem +1σ 65 164, praktycznie na POC 24 h 64 725. Nad nią najbliżej leżą klaster shortów 65 275 (69% dotknięcia do 09:00), wczorajszy POC 65 392 (64%) i szczyt Azji 65 574 (55%). Pod nią VWAP dnia (69%), klaster longów 64 075 (64%) i otwarcie Londynu 63 997 (61%). Wczorajszy VAL 63 296 ma 32%.

## Co musiałoby się wydarzyć

[[setupy]]

Wzrost wymaga odzyskania 65 300 i obrony stosu 65 000 do 65 200, a wtedy w zasięgu jest klaster shortów 14,4 mln USD. Spadek zaczyna się od pierwszego od 03:00 zamknięcia pod VWAP 64 163. Pomiędzy tymi poziomami rynek może po prostu kręcić się do otwarcia CME. Reguła powrotu do obszaru wartości nie była sprawdzana w laboratorium desku, więc traktuję ją jako wskazówkę, a nie statystykę.

## Na co patrzę dalej

Najpierw otwarcie CME o 00:00 i to, czy luka 5,35% się poszerzy, czy zawęzi. W poniedziałek o 18:00 przemawia przewodniczący Fed Warsh, we wtorek o 14:30 wychodzi sprzedaż detaliczna (prognoza 0,2% m/m, poprzednio 0,8%; bazowa 0,4% wobec 0,9%), a w środę o 20:00 protokół z posiedzenia FOMC. Do poniedziałku 09:00 obraz zmienia zamknięcie poza pasmem od VWAP 64 163 do 65 300.

## Rzetelność modelu

Przedziały desku są dobrze skalibrowane: w horyzoncie 1 godziny przedział 90% objął 91% wyników, a 60% objął 70% (n 2 329), w horyzoncie 4 godzin odpowiednio 90% i 72% (n 2 317), więc węższe przedziały są trochę za szerokie. Dla dotknięć PDH, PDL i środka Brier wynosi 0,070 wobec 0,077 dla bazy odległości i 0,115 dla częstości bazowej, czyli BSS 0,09 wobec odległości i 0,40 wobec częstości (n 2 325, niższy Brier lepszy). Przewaga nad prostą bazą odległości jest więc niewielka.

Prawdopodobieństwa w tym wpisie pochodzą z modelu desku HAR + FHS i symulacji Monte Carlo, policzone o 20:00 i zapisane przed faktem, żeby dało się je później rozliczyć. Następny wpis to mapa dnia w poniedziałek o 08:00.
