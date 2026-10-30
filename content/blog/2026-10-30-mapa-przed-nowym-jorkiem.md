---
title: "BTC 77 273 pod VWAP przed Nowym Jorkiem: 46% na koniec między 76 440 a 78 130"
description: "Przed otwarciem Nowego Jorku o 14:30 BTC stoi na 77 273, pod VWAP dnia 77 549. Model daje 68% na zakres 76 037 do 78 859 do 18:30, a pod ceną czeka 16 mln USD longów w 1%."
date: 2026-10-30T13:50:27+01:00
type: article
section: Mapa przed Nowym Jorkiem
price: 77273
levels:
  - { label: "Likwidacje shortów", price: 78850, note: "4,4 mln USD, 29% dotknięcia do 18:30" }
  - { label: "Szczyt Azji", price: 78772, note: "32% dotknięcia do 18:30" }
  - { label: "Likwidacje shortów", price: 78350, note: "4,4 mln USD, 51% dotknięcia do 18:30" }
  - { label: "VAL wczoraj", price: 78156, note: "60% dotknięcia do 18:30" }
  - { label: "Otwarcie Londynu", price: 78134, note: "61% dotknięcia do 18:30" }
  - { label: "PDL", price: 77856, note: "76% dotknięcia do 18:30" }
  - { label: "VWAP dnia", price: 77549, note: "94% dotknięcia do 18:30" }
  - { label: "Dołek Azji", price: 76443, note: "45% dotknięcia do 18:30" }
  - { label: "Likwidacje longów", price: 76350, note: "13,3 mln USD, 41% dotknięcia do 18:30" }
scenarios:
  - label: "Cena o 18:30 poniżej 76 440"
    probability: 23
    note: "Potrzebne zejście pod nocny dołek 76 443 i wejście w longi do likwidacji przy 76 350, ze spadającym OI jako śladem wymuszonego zamykania."
  - label: "Cena o 18:30 między 76 440 a 78 130"
    probability: 46
    note: "Rynek zostaje między nocnym dołkiem a otwarciem Londynu i rotuje wokół VWAP 77 549 i POC 24 h 77 075, bez akceptacji cen poza tym pasem."
  - label: "Cena o 18:30 powyżej 78 130"
    probability: 31
    note: "Cena musi odzyskać VWAP 77 549 i wczorajszy dołek 77 856, a potem utrzymać się nad otwarciem Londynu 78 134; wyżej czekają shorty przy 78 350."
summary:
  - "BTC stoi na 77 273, 0,52σ pod VWAP dnia 77 549 i pod wczorajszym dołkiem 77 856, po spadku z 81 955 do 76 442 w niecałe 10 godzin."
  - "W ostatnich 4 godzinach OI spadł o 2 072,8 BTC przy cenie niżej o 629 USD, więc to głównie zamykanie longów, a nie nowe shorty."
  - "Pod ceną w 1% leży 16,0 mln USD longów do likwidacji, nad ceną tylko 0,6 mln USD shortów."
  - "Model daje 68% na zakres 76 037 do 78 859 o 18:30, a zmienność 5 min z doby to 18,4 bp wobec 9,9 bp w poprzednich dniach roboczych."
metrics:
  - { label: "Premia perp", value: "−2,1 bp", bias: down, note: "średnio 24 h −3,0 bp, perp poniżej indeksu" }
  - { label: "Funding", value: "0,13 bp/h", bias: flat, note: "średnio 24 h 0,11 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "−141,5 mln USD", bias: down, note: "kupno biorców 928,3, sprzedaż 1 069,8 mln USD" }
  - { label: "Likwidacje 24 h", value: "77,9 mln USD", note: "longi 52,5, shorty 25,4 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "16,0 mln USD", note: "do likwidacji między 76 500 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "0,6 mln USD", note: "do likwidacji między ceną a 78 046" }
  - { label: "Arkusz ±10 bp: bidy", value: "40% bidów", note: "zwykle o tej godzinie 50% (8 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "18,4 bp", note: "poprzednie dni robocze (5): 9,9 bp" }
liquidations:
  step: 250
  coverage: 46
  shorts: [[80500, 2.3], [80250, 2], [80000, 4.4], [79750, 26.7], [79500, 2.9], [79250, 1.6], [79000, 1.3], [78750, 29.9], [78500, 1.6], [78250, 7.5], [78000, 1.3], [77750, 0.4], [77500, 0.1]]
  longs: [[77000, 3.3], [76750, 8.4], [76500, 10.9], [76250, 17.2], [76000, 18.5], [75750, 22.2], [75500, 12.1], [75250, 5.2], [75000, 16.9], [74750, 3.9], [74500, 28.8], [74250, 6], [74000, 9.6], [73750, 6]]
  note: "Mapa z 13:44, cena wtedy 77 266; pokrycie 46% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: -130.3, note: "160 kont" }
    - { label: "Reszta rynku", value: -10.6, note: "36 740 kont" }
    - { label: "Animatorzy rynku", value: -0.7, note: "240 kont" }
setups:
  - name: "Odzyskanie VWAP i powrót nad wczorajszy dołek"
    bias: up
    zone: [77856, 78134]
    window: "do 18:30"
    triggers:
      - "Zamknięcie świecy 15 min nad VWAP dnia 77 549 i nad stosem nierównowag sprzedaży 77 450."
      - "Delta 15 min dodatnia przy wejściu w pas 77 856 do 78 134, bez nowych stosów sprzedaży."
      - "OI rośnie razem z ceną, czyli wchodzą nowe longi, a nie tylko zamykają się shorty."
    invalidation: "Zamknięcie świecy 15 min z powrotem pod 77 450."
    reactions:
      - { label: "Otwarcie Londynu", price: 78134 }
      - { label: "Likwidacje shortów", price: 78350 }
      - { label: "Szczyt Azji", price: 78772 }
  - name: "Zejście pod nocny dołek do klastra longów"
    bias: down
    zone: [76250, 76443]
    window: "do 18:30"
    triggers:
      - "Zamknięcie świecy 15 min pod POC 24 h 77 075 i pod VWAP −1σ 77 021."
      - "Delta ujemna bez absorpcji przy 77 173, gdzie w Londynie wchłonięto sprzedaż."
      - "OI dalej spada, a likwidacje longów rosną skokowo przy wejściu pod 76 750."
    invalidation: "Powrót i zamknięcie świecy 15 min nad VWAP dnia 77 549."
    reactions:
      - { label: "VAL 24 h", price: 76750 }
      - { label: "Dołek Azji", price: 76443 }
      - { label: "Likwidacje longów", price: 76350 }
  - name: "Rotacja wokół POC 24 h pod VWAP"
    bias: flat
    zone: [76750, 77549]
    window: "do 18:30"
    triggers:
      - "Świece 15 min zamykają się w pasie 76 750 do 77 549, z knotami poza nim."
      - "Delta zmienia znak co kilka świec bez stosów nierównowag w jedną stronę."
      - "OI stoi w miejscu, bez nowej fali zamykania ani otwierania pozycji."
    invalidation: "Dwa zamknięcia świecy 30 min poza pasem 76 750 do 77 549."
    reactions:
      - { label: "POC 24 h", price: 77075 }
      - { label: "VWAP dnia", price: 77549 }
    evidence: "Laboratorium nie potwierdza powrotu do VWAP: n 178, częstość 36% wobec 43% losowo, więc to tylko wskazówka."
---
## Co się stało

Wczoraj o 17:00 BTC zrobił szczyt doby na 81 955 i od tego miejsca zaczął się zjazd. Wieczorem przyszła fala likwidacji longów: w kwadransie od 21:30 zamknięto 13,8 mln USD, w następnym 14,3 mln USD. Dno wypadło dziś o 03:00 na 76 442. Rano rynek odbił, ale otwarcie Londynu na 78 134 okazało się sufitem, a o 10:15 przyszła kolejna seria likwidacji longów za 10,2 mln USD. Przed Nowym Jorkiem cena stoi na 77 273, pod VWAP dnia i pod wczorajszym dołkiem 77 856.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Wczorajszy ruch nad 81 000 był nieudanym wybiciem: szczyt na 81 955 nie dostał kontynuacji, a cały zakres doby to 81 955 do 76 442. Cena jest dziś pod wczorajszym dołkiem 77 856, więc rynek przyjął niższe ceny, a nocne odbicie nie odzyskało wczorajszego obszaru.

**Wartość.** POC z 24 godzin leży na 77 075, obszar wartości na 76 750 do 79 275, a cena 77 273 jest w jego środku, tuż nad POC. Nocne wyjście pod VAL do 76 442 zostało odrzucone szybkim powrotem, więc ceny poniżej wartości nie zostały zaakceptowane.

**VWAP.** VWAP dnia to 77 549, cena jest 0,52σ pod nim przy σ 528,6 USD. Od świecy 12:30 cena jest pod VWAP, a dwie próby powrotu (13:00 i 13:15) zatrzymały się na nim, więc teraz działa jak opór. Najbliższe pasmo pod ceną to VWAP −1σ na 77 021.

**Przepływ i pozycje.** W ostatniej godzinie delta to −548,9 BTC przy cenie niżej o 143 USD, a w 4 godziny delta jest prawie zerowa (75,1 BTC) przy spadku o 629 USD. OI spadł o 294,5 BTC w godzinę i o 2 072,8 BTC w 4 godziny. Cena w dół i OI w dół to zamykanie longów i likwidacje, a nie budowanie nowych shortów. Na całej dobie taśmy delta to −5 591,2 BTC.

## Footprint zjazdu pod VWAP

[[footprint]]

Od 11:45 do 12:30 rynek próbował iść w górę: trzy świece z nierównowagami kupna na 77 650 do 77 750, dodatnią deltą i rosnącym OI, czyli nowe longi. O 12:30 przyszła inicjatywa drugiej strony: stos czterech nierównowag sprzedaży od 77 600 do 77 450, delta −444,7 BTC, OI −322,3 BTC i zamknięcie na dołku 77 415. Kwadrans później cena zeszła do 77 173 przy największym wolumenie okna (589,9 BTC), ale zamknęła się wyżej, na 77 339, bo sprzedaż została tam wchłonięta. Odbicie do VWAP o 13:00 szło mimo ujemnej delty i skończyło się na 77 548. Ostatnia świeca, 13:30, to znów stos trzech nierównowag sprzedaży od 77 450 do 77 250 i zamknięcie na 77 273.

Linia frontu jest teraz wąska. Nad ceną stos sprzedaży 77 450 do 77 600 i VWAP 77 549, które dwa razy zatrzymały odbicie. Pod ceną absorpcja przy 77 173 i POC świecy z dołka 77 150. Dopóki te dwa miejsca trzymają, rynek jest zamknięty w wąskim pasie między nimi.

## Gdzie leży płynność

[[likwidacje]]

Mapa jest wyraźnie asymetryczna. W 1% pod ceną leży 16,0 mln USD longów do likwidacji, a w 1% nad ceną tylko 0,6 mln USD shortów. Największe skupiska longów to 76 000 (18,5 mln USD), 75 750 (22,2 mln USD) i dalej 74 500 (28,8 mln USD). Shorty zbierają się wyżej, przy 78 750 (29,9 mln USD) i 79 750 (26,7 mln USD). Mapa obejmuje 46% otwartych pozycji, więc to obraz częściowy.

## Kto handluje

[[przeplywy]]

Przez dobę agresorzy sprzedali netto za 141,5 mln USD, z czego 130,3 mln USD to 160 kont wielorybów. Reszta rynku, prawie 37 tys. kont, sprzedała netto tylko 10,6 mln USD. Perp jest 2,1 bp pod indeksem (średnio w dobie −3,0 bp), a funding 0,13 bp/h jest niski. W arkuszu ±10 bp bidy to 40% wobec zwykłych 50% o tej godzinie.

## Zmienność i rozkład

[[scenariusze]]

Model daje do 18:30 odchylenie 182 bp, co przekłada się na 68% szans na zakres 76 037 do 78 859 i 95% na 74 665 do 80 308. Zmienność 5 min z ostatniej doby to 18,4 bp, prawie dwa razy więcej niż 9,9 bp w poprzednich dniach roboczych, a obecny reżim (13,9 bp na 5 min) trwa około 9 godzin. Prognoza desku na 4 godziny z 13:33 ma medianę 77 487 i 50% w 76 582 do 78 371. Rynek prognoz na cenę nad 78 521 jutro o 07:00 wycenia to na 18%, model na 31%.

## Struktura dnia

[[poziomy]]

Cena jest między POC 24 h 77 075 a VWAP dnia 77 549, a VWAP ma 94% szans na dotknięcie do 18:30. Wczorajszy dołek 77 856 to 76%, otwarcie Londynu 78 134 to 61%. Nocny dołek 76 443 ma 45%, szczyt Azji 78 772 32%.

## Co musiałoby się wydarzyć

[[setupy]]

Żeby obraz się poprawił, cena musiałaby zamknąć się nad VWAP i stosem sprzedaży 77 450, a potem wejść w pas 77 856 do 78 134 z rosnącym OI. Drugą stronę otwiera zamknięcie pod 77 021 i spadające OI, wtedy klaster longów przy 76 350 i 76 000 staje się celem płynności. Pomiędzy tymi miejscami zostaje rotacja wokół POC.

## Na co patrzę dalej

Pierwsze 30 minut Nowego Jorku od 14:30 pokaże, czy VWAP 77 549 dalej trzyma jako opór. Patrzę na OI: jeśli przestanie spadać, a cena zostanie nad 77 173, wymuszone zamykanie longów się kończy. Jeśli OI spada dalej przy zejściu pod 77 021, następne miejsce to nocny dołek.

## Rzetelność modelu

Przedziały 90% na 4 godziny obejmowały 91% wyników, a 60% obejmowały 69% (n 756), więc węższe przedziały są trochę za szerokie. Dla dotknięć wczorajszego szczytu, dołka i środka Brier wynosi 0,080 wobec 0,116 dla częstości bazowej (n 764).

Prawdopodobieństwa pochodzą z modelu desku HAR + FHS i symulacji Monte Carlo, policzone o 13:50 i zapisane przed faktem, więc da się je rozliczyć po 18:30. Następny wpis to otwarcie Nowego Jorku o 14:45.
