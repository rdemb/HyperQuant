---
title: "BTC 64 337 pod VWAP przed Nowym Jorkiem, 13,7 mln USD longów przy 63 675"
description: "Bitcoin przed otwarciem w Nowym Jorku stoi pod VWAP dnia i pod obszarem wartości z 24 godzin. Zakres 68% do 19:30 to 63 268 do 65 481."
date: 2026-11-16T14:50:10+01:00
type: article
section: Mapa przed Nowym Jorkiem
price: 64337
levels:
  - { label: "Likwidacje shortów", price: 65225, note: "5,4 mln USD, 41% dotknięcia do 19:30" }
  - { label: "Otwarcie Londynu", price: 64949, note: "59% dotknięcia do 19:30" }
  - { label: "POC wczoraj", price: 64763, note: "70% dotknięcia do 19:30" }
  - { label: "Likwidacje shortów", price: 64725, note: "4,0 mln USD, 73% dotknięcia do 19:30" }
  - { label: "VWAP dnia", price: 64578, note: "84% dotknięcia do 19:30" }
  - { label: "Dołek Azji", price: 64262, note: "92% dotknięcia do 19:30" }
  - { label: "VAL wczoraj", price: 63723, note: "50% dotknięcia do 19:30" }
  - { label: "Likwidacje longów", price: 63675, note: "13,7 mln USD, 47% dotknięcia do 19:30" }
  - { label: "Likwidacje longów", price: 63575, note: "5,3 mln USD, 41% dotknięcia do 19:30" }
scenarios:
  - label: "Cena o 19:30 poniżej 63 720"
    probability: 25
    note: "Dołek dnia 63 875 musi puścić, a cena wejść w klaster longów przy 63 675 i tam zostać na zamknięciu okna."
  - label: "Cena o 19:30 między 63 720 a 64 760"
    probability: 38
    note: "Rynek dalej obraca się wokół dołka Azji i VWAP dnia, bez wybicia nad wczorajszy POC i bez zejścia pod wczorajszy VAL."
  - label: "Cena o 19:30 powyżej 64 760"
    probability: 37
    note: "Cena musi wrócić nad VWAP dnia 64 578, przejść przez shorty przy 64 725 i utrzymać się nad wczorajszym POC 64 763."
summary:
  - "Cena 64 337 stoi 0,76σ pod VWAP dnia 64 579 i pod obszarem wartości z 24 godzin (VAL 64 450)."
  - "O 13:15 rynek zrobił dołek doby 63 875, a od tamtej pory odbił o 462 USD, a open interest per saldo dalej spadał."
  - "W 1% nad ceną leży 10,4 mln USD shortów do likwidacji, pod ceną tylko 3,9 mln USD longów."
  - "Model daje 68% szans, że o 19:30 cena będzie między 63 268 a 65 481."
metrics:
  - { label: "Premia perp", value: "−3,9 bp", bias: flat, note: "średnio 24 h −4,1 bp" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,07 bp/h, czyli 11,0% w skali roku" }
  - { label: "Przepływ agresorów 24 h", value: "−19,3 mln USD", note: "kupno biorców 825,3, sprzedaż 844,6 mln USD" }
  - { label: "Likwidacje 24 h", value: "16,8 mln USD", note: "longi 14,2, shorty 2,6 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "3,9 mln USD", note: "do likwidacji między 63 694 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "10,4 mln USD", note: "do likwidacji między ceną a 64 980" }
  - { label: "Arkusz ±10 bp: bidy", value: "47% bidów", note: "zwykle o tej godzinie 49% (26 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "16,7 bp", note: "poprzednie dni robocze (5): 14,2 bp" }
liquidations:
  step: 250
  coverage: 48
  shorts: [[67000, 4.8], [66750, 3.8], [66500, 5.8], [66250, 3.8], [66000, 4.5], [65750, 3], [65500, 4.2], [65250, 2.1], [65000, 6.7], [64750, 6.3], [64500, 4.1]]
  longs: [[63750, 1.3], [63500, 25.8], [63250, 3.3], [63000, 8.6], [62750, 1.6], [62500, 2.6], [62250, 4.5], [62000, 3.2], [61750, 12], [61500, 13.5], [61250, 1.3]]
  note: "Mapa z 14:44, cena wtedy 64 346; pokrycie 48% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: 1.7, note: "110 kont" }
    - { label: "Reszta rynku", value: -24.4, note: "21 420 kont" }
    - { label: "Animatorzy rynku", value: 3.5, note: "220 kont" }
setups:
  - name: "Powrót do obszaru wartości nad VAL 24 h"
    bias: up
    zone: [64450, 64600]
    window: "do 19:30"
    triggers:
      - "Świeca 15 min zamyka się nad 64 450, czyli z powrotem w obszarze wartości z 24 godzin."
      - "Delta na tej świecy jest dodatnia, kupujący biorą ofertę, a nie tylko znikają sprzedający."
      - "Open interest rośnie razem z ceną, co oznacza nowe longi zamiast samego zamykania shortów."
    invalidation: "Zamknięcie 15 min z powrotem pod 64 200, dolnym brzegiem stosu sprzedaży z 13:00."
    reactions:
      - { label: "VWAP dnia", price: 64578 }
      - { label: "Likwidacje shortów", price: 64725 }
      - { label: "Otwarcie Londynu", price: 64949 }
  - name: "Zejście w klaster likwidacji longów pod dołkiem doby"
    bias: down
    zone: [63500, 63875]
    window: "do 19:30"
    triggers:
      - "Świeca 15 min zamyka się pod 63 875, dołkiem doby z 13:15."
      - "Delta na świecy wybicia jest wyraźnie ujemna, sprzedający biorą bid."
      - "Open interest spada razem z ceną, czyli longi zamykają się i są likwidowane."
    invalidation: "Zamknięcie 15 min z powrotem nad 64 200, górnym brzegiem nierównowag kupna z 13:30."
    reactions:
      - { label: "VAL wczoraj", price: 63723 }
      - { label: "Likwidacje longów", price: 63675 }
      - { label: "Likwidacje longów", price: 63575 }
  - name: "Rotacja między dołkiem doby a VWAP dnia"
    bias: flat
    zone: [63875, 64578]
    window: "do 19:30"
    triggers:
      - "Kolejne świece 15 min zamykają się między 63 875 a 64 578, bez akceptacji poza tym pasem."
      - "Delta zmienia znak ze świecy na świecę i nie buduje stosu nierównowag w jedną stronę."
      - "Open interest stoi w miejscu, nowe pozycje nie dochodzą."
    invalidation: "Dwa zamknięcia 15 min poza pasem 63 875 do 64 578."
    reactions:
      - { label: "Dołek Azji", price: 64262 }
      - { label: "VWAP dnia", price: 64578 }
    evidence: "Reguła powrotu do VWAP w laboratorium: n 192, częstość 36% wobec 43% losowej, bez przewagi. To wskazówka, nie statystyka."
---
## Co się stało

Szczyt ostatnich 24 godzin to 65 548 wczoraj o 14:45. Potem cena zeszła do 64 229 o 17:15, a wieczorem odbiła mocno: świeca z 20:00 miała deltę +1 372,7 BTC i wyniosła cenę nad 65 000. Noc i Azja upłynęły w paśmie wokół 65 000, ze szczytem Azji 65 383. Od 06:45 zaczęło się zsuwanie. Dołek Azji wypadł na 64 262, Londyn otworzył się na 64 949 i od razu oddał, a o 13:00 przyszło najmocniejsze zejście dnia, z dołkiem doby 63 875 o 13:15 i 2,29 mln USD zlikwidowanych longów około 13:00. Teraz cena wróciła na 64 337.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Wczorajszy zakres był szeroki, od 61 970 do 66 134, a cena stoi niewiele nad jego środkiem. Do otwarcia tygodnia na 65 330 brakuje 150 bp, a w 24 godziny BTC stracił 1,63%. Wieczorne wybicie nad 65 000 nie znalazło kontynuacji: rynek przez noc nie zdołał wyjść nad 65 548 i od rana oddaje cały ruch.

**Wartość.** POC z 24 godzin leży na 64 600, obszar wartości od 64 450 do 65 200. Cena jest pod nim. Od 13:00 każda świeca 15 min zamknęła się pod VAL 64 450, więc ceny poniżej wartości są na razie akceptowane, a nie odrzucone. Już rano między 10:00 a 11:00 rynek trzymał się pod VAL, wtedy wrócił, teraz siedzi tam dłużej.

**VWAP.** VWAP dnia wynosi 64 579, a cena jest 0,76σ pod nim. Od 09:00, czyli od otwarcia Londynu, każde zamknięcie 15 min wypadło pod VWAP; o 12:15 knot sięgnął 64 782, ale zamknięcie zostało niżej. Pasmo −1σ (teraz 64 259) zostało przebite o 13:00 i 13:15, od tamtej pory cena oscyluje wokół niego, a ostatnia świeca zamknęła się 78 USD nad nim.

**Przepływ i pozycje.** W godzinie delta wynosi −473,2 BTC, a cena zrobiła +18 USD; w czterech godzinach delta −107,4 BTC i cena −56 USD. Open interest spadł w 4 godziny o 1 021,2 BTC, czyli spadek ceny szedł z zamykaniem longów i likwidacjami. W ostatniej godzinie OI dołożył 93,9 BTC przy lekko rosnącej cenie, więc pierwsze nowe pozycje wracają. Ujemna delta bez dalszego spadku ceny to na razie tylko obserwacja, liczy się reakcja ceny na kolejnych świecach.

## Footprint zejścia pod 64 000

[[footprint]]

O 13:00 sprzedający przejęli inicjatywę: świeca zeszła z 64 423 do 64 023 przy delcie −605,2 BTC, wolumenie 1 090,5 BTC i stosie pięciu nierównowag sprzedaży od 64 200 do 64 400. OI spadł o 174,6 BTC, więc to głównie wymuszone wyjścia longów. Świeca z 13:15 zrobiła dołek doby 63 875, ale przy mniejszym wolumenie 663,8 BTC i słabszej delcie −247,1 BTC, co wygląda na wyczerpanie. Odpowiedź przyszła o 13:30: zamknięcie na szczycie 64 319, delta +223 BTC, nierównowagi kupna na 64 000, 64 100 i 64 200, przy spadku OI o 203,6 BTC, czyli zamykanie shortów. Ostatnia świeca z 14:30 ma deltę −300,5 BTC przy wolumenie 1 030,7 BTC, a mimo to zamknęła się 152 USD wyżej, na 64 337, z OI +228 BTC. Agresywna sprzedaż została tu wchłonięta przez zlecenia z limitem.

Linia frontu biegnie teraz w dwóch miejscach. Od góry jest stos sprzedaży z 13:00 między 64 200 a 64 400, w którym cena właśnie stoi, i nierównowagi sprzedaży z 14:30 na 64 350. Od dołu pas 63 950 do 64 000, gdzie leżą POC świec z 13:00 i 13:15, a nad nim nierównowagi kupna z 13:30. POC ostatniej świecy to 64 300.

## Gdzie leży płynność

[[likwidacje]]

Mapa jest wyraźnie asymetryczna blisko ceny. W 1% nad ceną czeka 10,4 mln USD shortów do likwidacji, z koszykami 4,1 mln przy 64 500, 6,3 mln przy 64 750 i 6,7 mln przy 65 000. W 1% pod ceną longów jest tylko 3,9 mln USD. Większa masa longów leży dalej: 25,8 mln USD w koszyku 63 500, a w tabeli poziomów klaster 13,7 mln przy 63 675. Mapa obejmuje 48% otwartych pozycji, więc to obraz części rynku.

## Kto handluje

[[przeplywy]]

W 24 godziny agresorzy sprzedali per saldo za 19,3 mln USD. Całość tej strony robi reszta rynku, 21 420 kont i −24,4 mln USD, podczas gdy wieloryby (110 kont) dokupiły per saldo 1,7 mln USD, a animatorzy rynku 3,5 mln USD. Premia perp jest ujemna, −3,9 bp przy średniej z doby −4,1 bp, a funding 0,13 bp/h stoi nad swoją średnią 0,07 bp/h. Na arkuszu w pasie ±10 bp bidy mają 47%, wobec typowych 49% o tej godzinie.

## Zmienność i rozkład

[[scenariusze]]

Model daje do 19:30 σ 172 bp. Zakres 68% to 63 268 do 65 481, a 95% od 62 190 do 66 616. Zmienność 5 min z ostatniej doby to 16,7 bp wobec 14,2 bp w poprzednich pięciu dniach roboczych, a obecny reżim (16,3 bp na 5 min) trwa około 29 godzin, z 3% szans na zmianę w najbliższych 25 minutach. Na rynku HIP-4 „BTC powyżej 64 420” z terminem 17.11 o 07:00 rynek wycenia 47%, model desku daje 48%, więc praktycznie się zgadzają. Prognoza desku na 4 godziny z 14:47 ma medianę 64 493 i 50% przedziału od 63 799 do 65 144.

## Struktura dnia

[[poziomy]]

Najbliżej ceny jest dołek Azji 64 262 z 92% szansy dotknięcia do 19:30 i VWAP dnia 64 578 z 84%. Wyżej shorty przy 64 725 (73%) i wczorajszy POC 64 763 (70%), potem otwarcie Londynu 64 949 (59%). Pod ceną wczorajszy VAL 63 723 ma 50%, a klaster longów 13,7 mln przy 63 675 47%. Najmniej prawdopodobny w tym oknie jest koszyk shortów przy 65 225 (41%) i longów przy 63 575 (41%).

## Co musiałoby się wydarzyć

[[setupy]]

Żeby obraz przechylił się w górę, cena musi wrócić do obszaru wartości nad 64 450 z dodatnią deltą i rosnącym OI. Wtedy kolejne są VWAP dnia i shorty przy 64 725. Żeby poszła w dół, musi puścić dołek doby 63 875 przy ujemnej delcie i spadającym OI, a pod nim stoi klaster longów 63 675. Bez tego najbardziej naturalna jest rotacja między dołkiem doby a VWAP.

## Na co patrzę dalej

Patrzę, czy otwarcie Nowego Jorku o 15:30 utrzyma cenę nad pasem 63 950 do 64 000 i czy pierwsza godzina zamknie się nad VAL 64 450. Ważne będzie też, czy dzisiejsza absorpcja sprzedaży przy rosnącym OI przejdzie w ruch ceny, czy w kolejne zejście.

## Rzetelność modelu

W dzienniku desku przedziały 4 godzinne 90% obejmują 90% wyników, a 60% obejmują 72% (n 2 392), więc węższe przedziały są trochę za szerokie. Dla dotknięć PDH, PDL i środka Brier wynosi 0,068 wobec 0,075 dla bazy odległości, czyli BSS 0,09, i wobec 0,113 dla częstości bazowej, czyli BSS 0,39 (n 2 400). Przewaga nad samą odległością jest niewielka.

Prawdopodobieństwa pochodzą z modelu zmienności desku HAR + FHS i symulacji Monte Carlo, policzone o 14:50 i zapisane przed faktem, a o 19:30 je rozliczę. Następny wpis to notka na otwarcie Nowego Jorku o 15:45.
