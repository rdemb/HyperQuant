---
title: "Mapa tygodnia BTC: 77 856 po tygodniu −2,8%, luka CME +1,2% i NFP w piątek"
description: "BTC zaczyna tydzień przy 77 856. Model daje 68% na zakres 77 296–78 418 do poniedziałku 09:00, a cena stoi 1,24% nad piątkowym zamknięciem CME."
date: 2026-11-01T20:00:25+01:00
type: article
section: Mapa tygodnia
price: 77856
levels:
  - { label: "Szczyt Azji", price: 78016, note: "76% dotknięcia do 09:00" }
  - { label: "Otwarcie Londynu", price: 77932, note: "88% dotknięcia do 09:00" }
  - { label: "VWAP dnia", price: 77922, note: "90% dotknięcia do 09:00" }
  - { label: "PDH", price: 77750, note: "83% dotknięcia do 09:00" }
  - { label: "VAH wczoraj", price: 77610, note: "63% dotknięcia do 09:00" }
  - { label: "Dołek Azji", price: 77478, note: "48% dotknięcia do 09:00" }
  - { label: "POC wczoraj", price: 77396, note: "39% dotknięcia do 09:00" }
  - { label: "VAL wczoraj", price: 77298, note: "30% dotknięcia do 09:00" }
  - { label: "Likwidacje longów", price: 77150, note: "9,6 mln USD, 20% dotknięcia do 09:00" }
scenarios:
  - label: "Cena w poniedziałek o 09:00 poniżej 77 610"
    probability: 32
    note: "Sprzedający z wieczora muszą utrzymać inicjatywę, zepchnąć cenę pod VAL doby 77 675 i dołek Azji 77 478. Niżej czeka klaster longów 77 000–77 250."
  - label: "Cena w poniedziałek o 09:00 między 77 610 a 78 420"
    probability: 52
    note: "Wystarczy, że niedzielna rotacja potrwa: cena krąży wokół VWAP 77 922 i POC doby 77 975, a otwarcie CME nie zmienia charakteru nocy."
  - label: "Cena w poniedziałek o 09:00 powyżej 78 420"
    probability: 16
    note: "Kupujący muszą odzyskać strefę 77 920–78 020, w której wieczorem wygrała podaż, i wybić szczyt doby 78 238 przy rosnącym OI."
summary:
  - "Tydzień od otwarcia 80 109 spadł do dołka 76 264, a cena 77 856 jest 2,8% niżej niż w poniedziałek."
  - "Cena stoi 1,24% nad piątkowym zamknięciem CME 76 899, model daje lukę na otwarciu od +0,87% do +1,61%."
  - "Model bez przewagi daje 68% na zakres 77 296–78 418 do poniedziałku 09:00 i 52% na środkowy scenariusz."
  - "Zmienność 5 min z doby to 4,8 bp wobec 12,4 bp w dni robocze, a w piątek o 14:30 dane z rynku pracy USA."
metrics:
  - { label: "Premia perp", value: "−2,2 bp", note: "średnio 24 h −0,4 bp", bias: down }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,12 bp/h", bias: flat }
  - { label: "Przepływ agresorów 24 h", value: "−3,8 mln USD", note: "kupno biorców 42,7, sprzedaż 46,5 mln USD", bias: down }
  - { label: "Likwidacje 24 h", value: "2,8 mln USD", note: "longi 0,0, shorty 2,8 mln USD, głównie przy porannym szczycie" }
  - { label: "Longi w 1% pod ceną", value: "10,4 mln USD", note: "do likwidacji między 77 077 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "9,7 mln USD", note: "do likwidacji między ceną a 78 635" }
  - { label: "Arkusz ±10 bp: bidy", value: "47% bidów", note: "zwykle o tej godzinie 49% (11 dni)", bias: flat }
  - { label: "Zmienność 5 min, 24 h", value: "4,8 bp", note: "poprzednie dni robocze (5): 12,4 bp" }
liquidations:
  step: 250
  coverage: 46
  shorts: [[81000, 1.6], [80750, 3.9], [80500, 3.4], [80250, 0.9], [80000, 6.8], [79750, 0.9], [79500, 27.8], [79250, 26.3], [79000, 2.2], [78750, 7.9], [78500, 3.7], [78250, 6.7], [78000, 1.5]]
  longs: [[77000, 12.7], [76750, 3.2], [76500, 5.9], [76250, 5.7], [76000, 10.1], [75750, 31], [75500, 32.5], [75250, 5.2], [75000, 22.9], [74750, 3.9], [74500, 11.2], [74250, 2.4]]
  note: "Mapa z 19:58, cena wtedy 77 859; pokrycie 46% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: -2.1, note: "60 kont" }
    - { label: "Reszta rynku", value: -2.7, note: "12 480 kont" }
    - { label: "Animatorzy rynku", value: 1, note: "190 kont" }
setups:
  - name: "Odzyskanie wieczornej strefy podaży 77 920–78 020"
    bias: up
    zone: [77920, 78020]
    window: "do 09:00 w poniedziałek"
    triggers:
      - "Świeca 15 min zamyka się nad 78 020, czyli nad całym stosem nierównowag sprzedaży z 18:45."
      - "Delta tej świecy jest dodatnia, a kolejne świece nie oddają poziomu 77 920."
      - "OI rośnie razem z ceną albo spada przy skoku likwidacji shortów."
    invalidation: "Zamknięcie 15 min z powrotem pod VWAP dnia 77 922."
    reactions:
      - { label: "Szczyt Azji", price: 78016 }
      - { label: "Shorty 78 250 (6,7 mln USD)", price: 78250 }
      - { label: "Shorty 79 250 (26,3 mln USD)", price: 79250 }
  - name: "Zejście do klastra longów 77 000–77 250"
    bias: down
    zone: [77000, 77250]
    window: "do 09:00 w poniedziałek"
    triggers:
      - "Świeca 15 min zamyka się pod VAL doby 77 675."
      - "Delta pozostaje ujemna, bez absorpcji po stronie kupna przy dołku Azji 77 478."
      - "OI najpierw rośnie (nowe shorty), a w klastrze spada skokowo przy likwidacjach longów."
    invalidation: "Zamknięcie 15 min z powrotem nad VWAP dnia 77 922."
    reactions:
      - { label: "Dołek Azji", price: 77478 }
      - { label: "Likwidacje longów", price: 77150 }
      - { label: "PDL", price: 77072 }
    evidence: "Laboratorium desku dla wsparcia na okrągłym poziomie: n 319, częstość 53% wobec losowej 49%, bez przewagi ponad szum."
  - name: "Rotacja w obszarze wartości doby 77 675–78 175"
    bias: flat
    zone: [77675, 78175]
    window: "do 09:00 w poniedziałek"
    triggers:
      - "Świece 15 min zamykają się wewnątrz obszaru wartości, wokół POC 77 975."
      - "Delta na kolejnych świecach zmienia znak i nie buduje stosów nierównowag."
      - "OI stoi w miejscu albo powoli spada."
    invalidation: "Dwie świece 30 min zamknięte poza obszarem 77 675–78 175."
    reactions:
      - { label: "VWAP dnia", price: 77922 }
      - { label: "Otwarcie Londynu", price: 77932 }
    evidence: "Powrót do VWAP w laboratorium desku: n 179, częstość 36% wobec losowej 43%, czyli bez przewagi."
---
## Co się stało

Ten tydzień był wyraźnie słabszy od poprzedniego. Otwarcie w poniedziałek przy 80 109, szczyt 81 955, a potem zejście aż do 76 264, czyli pod dołek poprzedniego tygodnia 79 184. Teraz cena stoi przy 77 856, 2,8% pod otwarciem tygodnia, ale wyraźnie nad dołkiem. Weekend był spokojny: dołek doby 77 390 padł w sobotę o 22:00, szczyt 78 238 w niedzielę o 9:45, a wieczorem cena zeszła spod 78 000 z powrotem pod VWAP dnia. Piątkowe zamknięcie CME wypadło przy 76 899, więc kontrakty otworzą się dziś o północy z luką w górę.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Świece dzienne pokazują wybicie dołem z poprzedniego zakresu 79 184–84 850 i kontynuację do 76 264. Od tego dołka cena odbiła, ale stoi w dolnej części zakresu tygodnia 76 264–81 955. Weekendowy zakres doby to tylko 77 390–78 238, więc odbicie na razie bardziej się zatrzymało, niż odwróciło trend.

**Wartość.** POC z 24 godzin to 77 975, obszar wartości 77 675–78 175, a cena 77 856 jest w środku tego obszaru, trochę pod POC. Poranne wyjście do 78 238 nad VAH nie zostało zaakceptowane: cena wróciła do wartości, zamiast zbudować nad nią dwie świece 30 min.

**VWAP.** VWAP dnia to 77 922, σ 162,3, a cena jest 0,41σ pod nim. Od nocy aż do ostatniej godziny VWAP działał jak wsparcie i cena trzymała się nad nim. Ostatnia świeca 15 min przed 20:00 zamknęła się pod VWAP i to jest pierwsza taka zmiana od rana.

**Przepływ i pozycje.** Taśma obejmuje pełne 24 godziny do 20:00. Delta z ostatniej godziny to −75,2 BTC przy cenie −92 dolary, z czterech godzin −616,1 BTC przy cenie −168, a z całej doby −335,1 BTC. OI spadł w ciągu godziny o 281,9 BTC i w ciągu czterech godzin o 77,4 BTC. Cena w dół i OI w dół to według macierzy zamykanie longów, a nie budowanie nowych shortów. Likwidacje z doby to wyłącznie shorty, 2,8 mln USD, najwięcej (1,35 mln) o 9:30 przy wyjściu na szczyt doby.

## Footprint zejścia spod 78 000

[[footprint]]

Do 18:15 rynek stał przy 78 100 i świeca z 18:15 pokazała już coś ciekawego: delta −93 BTC, OI −182,1 BTC i brak postępu w dół, czyli pierwsza próba podaży bez skutku. Inicjatywa przyszła w świecy z 18:45: zejście z 78 057 do 77 921, delta −531,6 BTC przy wolumenie 557,3 BTC, stos sześciu nierównowag sprzedaży od 78 020 do 77 920 i OI +131,3 BTC, czyli tym razem nowe shorty. Potem wolumen spadł do około 100 BTC na świecę, delta była bliska zera, a OI spadał, więc druga strona nie odpowiedziała, tylko rynek wyhamował. Świeca z 19:30 dała krótkie nierównowagi kupna przy 77 900 i 77 940, ale ostatnia świeca zeszła do 77 837 z kolejnym stosem sprzedaży.

Linia frontu jest więc dość czytelna. Nad ceną stoi stos nierównowag sprzedaży 77 920–78 020 z POC świecy 77 940, który jeszcze nie został ponownie dotknięty. Niżej świeży stos 77 840–77 900 z POC ostatniej świecy 77 840. Dopóki cena jest pod 77 920, to sprzedający z wieczora mają punkt odniesienia po swojej stronie.

## Gdzie leży płynność

[[likwidacje]]

W 1% od ceny mapa jest prawie zrównoważona: 10,4 mln USD longów do likwidacji między 77 077 a ceną i 9,7 mln USD shortów między ceną a 78 635. Dalej robi się asymetrycznie. Pod ceną najbliższy większy klaster to 12,7 mln USD w przedziale 77 000–77 250, a potem duże skupisko 75 500–76 000 (31 i 32,5 mln USD) i 22,9 mln przy 75 000. Nad ceną najwięcej leży przy 79 250 i 79 500 (26,3 i 27,8 mln USD). Mapa pokrywa 46% otwartych pozycji, więc to obraz częściowy.

## Kto handluje

[[przeplywy]]

Przez ostatnie 24 godziny agresorzy sprzedawali netto za 3,8 mln USD. Wieloryby dały −2,1 mln, reszta rynku −2,7 mln, a animatorzy rynku kupowali netto za 1 mln USD. Premia perpa spadła do −2,2 bp przy średniej z doby −0,4 bp, a funding stoi na 0,13 bp/h, praktycznie bez zmian. Arkusz w promieniu 10 bp ma 47% bidów, odrobinę mniej niż zwykle o tej godzinie (49%).

## Zmienność i rozkład

[[scenariusze]]

Model bez przewagi daje 68% na zakres 77 296–78 418 do poniedziałku 09:00 i 95% na 76 740–78 986. Najwięcej, 52%, przypada na środkowy przedział 77 610–78 420, 32% na zejście pod 77 610 i 16% na wyjście nad 78 420. Zmienność 5 min z doby to 4,8 bp wobec 12,4 bp w poprzednie dni robocze, a bieżący reżim to 3,5 bp na 5 minut od około pięciu godzin. Prognoza desku na 4 godziny ma medianę 77 949, 50% w 77 723–78 167 i 90% w 77 408–78 486. Rynek predykcyjny na „BTC > 77 886” wycenia 48%, dokładnie tyle co model.

Otwarcie CME o północy to osobny temat. Model daje 68% na cenę 77 570–78 141 w chwili otwarcia, czyli lukę od +0,87% do +1,61% wobec piątku. Reguła domykania luki CME ma w laboratorium desku tylko 21 przypadków i częstość 52% wobec losowej 50%, więc traktuję ją jako ciekawostkę, nie statystykę.

## Struktura dnia

[[poziomy]]

Cena jest tuż pod skupiskiem poziomów: VWAP dnia 77 922 i otwarcie Londynu 77 932 mają 90% i 88% szansy dotknięcia do 09:00, szczyt Azji 78 016 ma 76%. Pod ceną PDH 77 750 ma 83%, VAH z soboty 77 610 63%, a dołek Azji 77 478 48%. Klaster longów przy 77 150 to już tylko 20%, bo przy tak niskiej zmienności to daleko.

## Co musiałoby się wydarzyć

[[setupy]]

Dla scenariusza wzrostowego kluczowe jest odzyskanie strefy 77 920–78 020, w której wieczorem wygrała podaż. Bez zamknięcia nad nią i bez dodatniej delty to tylko powrót do wartości. Spadkowy wariant zaczyna się od zamknięcia pod VAL doby 77 675; wtedy dołek Azji i klaster longów przy 77 000–77 250 stają się realnym celem płynności. Najbardziej prawdopodobna według modelu jest jednak nudna noc w obszarze wartości.

## Na co patrzę dalej

Pierwsza rzecz to reakcja na otwarcie CME o północy i to, czy luka w górę przyciągnie cenę w stronę piątkowego 76 899, czy rynek ją zignoruje. Od poniedziałku sesja w Nowym Jorku znów otwiera się o 15:30 naszego czasu. W kalendarzu USA mamy we wtorek wybory do Kongresu, a w piątek o 14:30 komplet danych z rynku pracy: zatrudnienie poza rolnictwem (prognoza 63 tys., poprzednio 29 tys.), stopa bezrobocia (prognoza 4,2%) i płace godzinowe (prognoza 0,3% m/m). Przy zmienności o ponad połowę niższej niż w tygodniu każde z tych wydarzeń może łatwo wybić rynek z weekendowego zakresu.

## Rzetelność modelu

W dzienniku desku przedziały 90% na 4 godziny objęły 93% przypadków, a przedziały 60% aż 75% (n 973), więc model jest raczej za ostrożny niż za odważny. Dla dotknięć PDH, PDL i środka zakresu Brier wynosi 0,073 wobec 0,114 dla samej częstości bazowej (n 981).

Prawdopodobieństwa w tym wpisie pochodzą z modelu desku HAR + FHS i symulacji Monte Carlo, policzone o 20:00 i zapisane przed faktem, żeby dało się je potem uczciwie rozliczyć. Następny wpis to mapa dnia w poniedziałek rano, przed otwarciem Londynu.
