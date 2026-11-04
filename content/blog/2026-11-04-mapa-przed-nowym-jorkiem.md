---
title: "BTC 78 354 przed Nowym Jorkiem: 18,3 mln USD shortów czeka przy 79 250"
description: "Cena stoi nad wczorajszym szczytem po nocnym zjeździe do 75 687. Model daje 54% szans, że o 19:30 będzie między 77 610 a 79 050. Nad ceną gęsto od shortów, pod ceną pusto."
date: 2026-11-04T14:50:23+01:00
type: article
section: Mapa przed Nowym Jorkiem
price: 78354
levels:
  - { label: "Likwidacje shortów", price: 79250, note: "18,3 mln USD, 33% dotknięcia do 19:30" }
  - { label: "Likwidacje shortów", price: 79050, note: "7,0 mln USD, 44% dotknięcia do 19:30" }
  - { label: "Szczyt Azji", price: 78356, note: "100% dotknięcia do 19:30" }
  - { label: "Otwarcie tygodnia", price: 78326, note: "98% dotknięcia do 19:30" }
  - { label: "Otwarcie Londynu", price: 78123, note: "81% dotknięcia do 19:30" }
  - { label: "PDH", price: 78046, note: "74% dotknięcia do 19:30" }
  - { label: "VAH wczoraj", price: 77610, note: "44% dotknięcia do 19:30" }
  - { label: "Likwidacje longów", price: 77450, note: "3,1 mln USD, 35% dotknięcia do 19:30" }
  - { label: "VWAP dnia", price: 77279, note: "27% dotknięcia do 19:30" }
scenarios:
  - label: "Cena o 19:30 poniżej 77 610"
    probability: 23
    note: "Cena musiałaby zamknąć się pod PDH 78 046 i zejść przez wczorajszy VAH w stronę longów przy 77 450 i VWAP dnia 77 279. Pod ceną jest mało dźwigni, więc taki spadek nie dostałby paliwa z likwidacji."
  - label: "Cena o 19:30 między 77 610 a 79 050"
    probability: 54
    note: "Nowy Jork nie przebija szczytu doby 78 707 ani nie wraca pod wczorajszy VAH; cena rotuje między otwarciem Londynu 78 123 a pasem 78 400 do 78 500, gdzie w południe weszli sprzedający."
  - label: "Cena o 19:30 powyżej 79 050"
    probability: 23
    note: "Potrzebne jest zamknięcie nad szczytem doby 78 707 i wejście w pierwszy klaster shortów przy 79 050. Wtedy likwidacje przy 79 250 (18,3 mln USD) mogą same dopchnąć ruch."
summary:
  - "Nocny zjazd do 75 687 o 4:00 został odrobiony, cena 78 354 stoi nad wczorajszym szczytem 78 046."
  - "Model daje 54% szans, że o 19:30 cena będzie między 77 610 a 79 050; zakres 68% to 77 397 do 79 317."
  - "W 1% nad ceną leży 19,5 mln USD shortów do likwidacji, w 1% pod ceną tylko 0,9 mln USD longów."
  - "Agresorzy sprzedali netto 88,1 mln USD w 24 h, z czego wieloryby 73 mln, a cena i tak urosła o 1,28%."
metrics:
  - { label: "Premia perp", value: "−1,6 bp", note: "średnio 24 h −2,7 bp" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,12 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "−88,1 mln USD", note: "kupno biorców 518,7, sprzedaż 606,9 mln USD" }
  - { label: "Likwidacje 24 h", value: "35,1 mln USD", note: "longi 15,7, shorty 19,4 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "0,9 mln USD", note: "do likwidacji między 77 570 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "19,5 mln USD", note: "do likwidacji między ceną a 79 138" }
  - { label: "Arkusz ±10 bp: bidy", value: "49% bidów", note: "zwykle o tej godzinie 50% (14 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "13,0 bp", note: "poprzednie dni robocze (5): 12,4 bp" }
liquidations:
  step: 250
  coverage: 47
  shorts: [[81750, 0.8], [81500, 2.6], [81250, 1], [81000, 6.1], [80750, 4], [80500, 4.8], [80250, 2.2], [80000, 4.9], [79750, 2.2], [79500, 9.1], [79250, 7.5], [79000, 29.3], [78750, 6], [78500, 2.3], [78250, 0.2]]
  longs: [[77500, 2.5], [77250, 4.1], [77000, 6.2], [76750, 2], [76500, 2.8], [76250, 1.9], [76000, 2.4], [75750, 0.9], [75500, 6.9], [75250, 24], [75000, 8.8], [74750, 16.7]]
  note: "Mapa z 14:45, cena wtedy 78 376; pokrycie 47% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: -73, note: "120 kont" }
    - { label: "Reszta rynku", value: -6.7, note: "24 370 kont" }
    - { label: "Animatorzy rynku", value: -8.5, note: "220 kont" }
setups:
  - name: "Wyciśnięcie shortów nad szczytem doby"
    bias: up
    zone: [79000, 79250]
    window: "do 19:30"
    triggers:
      - "Zamknięcie świecy 15 min nad VAH 24 h 78 625 i nad szczytem doby 78 707, czego Londyn nie utrzymał."
      - "Dodatnia delta na świecach wybicia, bez nowego stosu nierównowag sprzedaży w pasie 78 400 do 78 500."
      - "OI rośnie razem z ceną (nowe longi), a przy wejściu w 79 000 spada skokowo (likwidacje shortów)."
    invalidation: "Zamknięcie świecy 15 min z powrotem pod PDH 78 046."
    reactions:
      - { label: "Likwidacje shortów", price: 79050 }
      - { label: "Likwidacje shortów", price: 79250 }
      - { label: "Likwidacje shortów", price: 79750 }
    evidence: "Okrągła liczba jako opór w laboratorium desku: 47% wobec 49% losowo (n 332), czyli szum, a nie przewaga."
  - name: "Utrata wczorajszego szczytu i powrót do wartości"
    bias: down
    zone: [77610, 78046]
    window: "do 19:30"
    triggers:
      - "Zamknięcie świecy 15 min pod PDH 78 046 i pod popołudniowym dołkiem 77 980."
      - "Ujemna delta i ponowna inicjatywa sprzedających z pasa 78 250 do 78 350."
      - "OI spada razem z ceną, czyli longi z porannego wzrostu się zamykają."
    invalidation: "Zamknięcie świecy 15 min z powrotem nad szczytem Azji 78 356."
    reactions:
      - { label: "POC 24 h", price: 77800 }
      - { label: "VAH wczoraj", price: 77610 }
      - { label: "Likwidacje longów", price: 77450 }
      - { label: "VWAP dnia", price: 77279 }
  - name: "Rotacja między wczorajszym szczytem a VAH doby"
    bias: flat
    zone: [78046, 78625]
    window: "do 19:30"
    triggers:
      - "Kolejne świece 15 min zamykają się między 78 046 a 78 625."
      - "Delta bliska zera, bez stosów nierównowag w żadną stronę."
      - "OI stoi w miejscu, bez nowych pozycji po żadnej stronie."
    invalidation: "Zamknięcie świecy 15 min poza pasem 78 046 do 78 625."
    reactions:
      - { label: "Otwarcie Londynu", price: 78123 }
      - { label: "Otwarcie tygodnia", price: 78326 }
---
## Co się stało

Noc była nerwowa. Od 0:30 cena zjechała z okolic 77 900 i o 4:00 dotknęła 75 687, czyli dołka całej doby, wyraźnie pod wczorajszym minimum 76 342. Po drodze w kwadransach 3:45 i 4:00 zlikwidowano około 11,5 mln USD longów. Zejście nie znalazło jednak kontynuacji. O 5:45 likwidacje przeszły na drugą stronę (7,3 mln USD shortów w jednej świecy), a cena doszła do 77 583. Rano poszła dalej, przed 8:00 przebiła wczorajszy szczyt 78 046, a o 12:45 zrobiła szczyt doby 78 707. Potem sprzedający zepchnęli ją o 13:15 do 77 980 i od 13:30 cena stoi w pasie 78 105 do 78 522, teraz 78 354.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** W ciągu doby cena przeszła cały wczorajszy zakres 76 342 do 78 046 i wyszła górą. Nocne przebicie wczorajszego dołka było nieudane: po około godzinie cena była z powrotem w zakresie. Wybicie nad wczorajszy szczyt ma za to kontynuację, bo od 8:00 każde zamknięcie 15 min jest nad 78 046. Cena jest też praktycznie na otwarciu tygodnia 78 326, więc tydzień na razie stoi w miejscu.

**Wartość.** POC z 24 godzin leży na 77 800, obszar wartości od 76 925 do 78 625, a cena jest w jego górnej części. Ceny pod VAL nocą zostały odrzucone: zamknięcia pod 76 925 trwały bez przerwy od 3:15 do 5:15, a od 5:30 cena już tam się nie zamknęła. Nad VAH zamknęły się tylko dwie świece 15 min (12:15 i 12:30), czyli pół godziny, więc wyjścia górą nie można nazwać akceptacją. Kolejna świeca zaczęła spadek do 77 980.

**VWAP.** VWAP dnia stoi na 77 276, a cena jest 1,25σ nad nim (σ 862). Od świecy 5:00 każda świeca 15 min zamykała się nad VWAP. Pasmo +1σ działało jako wsparcie: od 5:45 zamknięcia były nad nim z jednym wyjątkiem o 13:00, kiedy świeca zamknęła się 9 dolarów pod pasmem, po czym następna wróciła nad nie. Najdłużej pod pasmem −1σ cena zamykała się nocą od 3:15 do 4:00 i tam skończył się spadek.

**Przepływ i pozycje.** Delta całego okna taśmy (od wczoraj 14:45 do 14:45 dziś) wynosi −1 610 BTC, a cena w tym czasie urosła, więc agresywna sprzedaż trafiała na pasywnych kupujących. W ostatniej godzinie cena urosła o 110 dolarów przy delcie +73 BTC i wzroście OI o 118 BTC, co według macierzy oznacza nowe longi. W ostatnich czterech godzinach cena spadła o 62 dolary, delta to −221 BTC, a OI prawie się nie zmienił (−6 BTC), więc w tym oknie nie widać ani wyraźnego budowania shortów, ani wyprzedaży longów.

## Footprint szczytu Londynu

[[footprint]]

Okno zaczyna się na szczycie doby. Świeca 12:45 dała 78 707 i od razu stos trzech nierównowag sprzedaży od 78 400 do 78 500, z deltą −286 BTC i spadkiem OI o 197 BTC, czyli longi zamykały się na szczycie. Świeca 13:00 miała największy wolumen w oknie (802 BTC), deltę −398 BTC i nierównowagi sprzedaży rozsiane od 78 050 do 78 450, a OI spadł o kolejne 134 BTC. Odpowiedź przyszła o 13:15: cena zeszła do 77 980, ale zamknęła się na 78 276 przy delcie tylko −53 BTC i wzroście OI o 178 BTC, co wygląda na absorpcję sprzedaży pod wczorajszym szczytem. Potem wolumen wyraźnie siadł (170 i 228 BTC na świecę), a o 14:15 pojawiły się nierównowagi kupna na 78 250, 78 300 i 78 450 przy delcie +107 BTC.

Linia frontu jest teraz wąska. Od góry pas 78 400 do 78 500, gdzie stoi stos sprzedaży ze szczytu, i drugi stos sprzedaży 78 250 do 78 350 z 13:00. Od dołu 78 300, gdzie leżał POC trzech ostatnich świec, i dołek reakcji 77 980. Ostatnia świeca 14:30 znów dała nierównowagi sprzedaży na 78 350 i 78 400, przy spadku OI o 67 BTC, więc pas nad ceną nadal jest bronioną stroną.

## Gdzie leży płynność

[[likwidacje]]

Asymetria jest duża. W 1% nad ceną, do 79 138, mapa pokazuje 19,5 mln USD shortów z ceną likwidacji, a w przedziale od 79 000 do 79 250 jest największe skupisko na całej mapie, 29,3 mln USD. W 1% pod ceną leży tylko 0,9 mln USD longów. Pierwsze większe longi to 77 000 (6,2 mln USD), a naprawdę gęsto robi się dopiero przy 75 250 (24 mln USD), poniżej nocnego dołka. Mapa obejmuje 47% otwartych pozycji, więc kwoty są zaniżone, ale proporcja zostaje: paliwo dla przyspieszenia leży nad ceną, nie pod nią.

## Kto handluje

[[przeplywy]]

Przez ostatnią dobę biorcy sprzedali netto 88,1 mln USD. Prawie całość to wieloryby (−73 mln USD na 120 kontach), animatorzy rynku dołożyli −8,5 mln, a reszta rynku, ponad 24 tysiące kont, tylko −6,7 mln. Mimo tego cena urosła o 1,28%. Kontrakt jest notowany 1,6 bp pod indeksem, mniej niż średnio w ciągu doby (−2,7 bp), a funding 0,13 bp/h jest bliski bazowego. Arkusz w pasie ±10 bp ma 49% bidów, czyli tyle, ile zwykle o tej godzinie. Rynek nie jest przegrzany longami.

## Zmienność i rozkład

[[scenariusze]]

Model liczy σ 123 bp do 19:30, co daje zakres 68% od 77 397 do 79 317 i 95% od 76 454 do 80 294. Zmienność 5 min z ostatniej doby to 13,0 bp, niewiele ponad 12,4 bp z poprzednich dni roboczych, a bieżący reżim to 8,7 bp na 5 min, trwający od około godziny. Prognoza desku z 14:32 na 4 godziny ma medianę 78 320 i 50% w przedziale 77 737 do 78 960. Rynek HIP-4 na „BTC > 77 719” do jutra 7:00 płaci 74%, model desku daje 66%, więc rynek jest o 8 pp bardziej optymistyczny niż model.

## Struktura dnia

[[poziomy]]

Cena stoi praktycznie na szczycie Azji 78 356 i otwarciu tygodnia 78 326, oba mają prawie pewne dotknięcie. Pod spodem są otwarcie Londynu 78 123 (81%) i wczorajszy szczyt 78 046 (74%), który teraz jest podłogą wybicia. Dalej pod ceną wczorajszy VAH 77 610 (44%), longi przy 77 450 (35%) i VWAP dnia 77 279 (27%). Nad ceną najbliżej są klastry shortów 79 050 (44%) i 79 250 (33%).

## Co musiałoby się wydarzyć

[[setupy]]

Do wyciśnięcia shortów potrzeba zamknięcia nad szczytem doby 78 707 z dodatnią deltą i rosnącym OI; dopiero wejście w 79 000 może uruchomić likwidacje. Scenariusz spadkowy wymaga utraty wczorajszego szczytu 78 046 przy spadającym OI, wtedy celem są wartość i VWAP dnia niżej. Pomiędzy zostaje rotacja w pasie 78 046 do 78 625, którą model uważa za najbardziej prawdopodobną.

## Na co patrzę dalej

Pierwsze pół godziny po otwarciu Nowego Jorku o 15:30 rozstrzyga, czy pas 78 400 do 78 500 nadal jest broniony. Jeśli świeca 15 min zamknie się nad nim przy rosnącym OI, obraz przesuwa się w stronę klastrów shortów. Jeśli zamknie się pod 78 046, nocne odbicie traci podłogę, a pod ceną jest mało dźwigni, która mogłaby zatrzymać spadek przed VWAP dnia.

## Rzetelność modelu

Przedziały desku są na razie trochę za szerokie: 90% przedziałów 4 h obejmuje 91% wyników, a 60% obejmuje 72% (n 1 240). Prognozy dotknięć wczorajszego szczytu, dołka i środka mają Brier 0,077 wobec 0,129 dla samej częstości bazowej (n 1 248), czyli są wyraźnie lepsze od zgadywania.

Prawdopodobieństwa pochodzą z modelu desku HAR + FHS z symulacją Monte Carlo, policzone o 14:50 i zapisane przed faktem. Następna notka po otwarciu Nowego Jorku, o 15:45.
