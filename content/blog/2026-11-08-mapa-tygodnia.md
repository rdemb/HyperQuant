---
title: "BTC 75 912 przed tygodniem z CPI: 25,5 mln USD shortów w 1% nad ceną"
description: "Tydzień kończy się 3,08% pod otwarciem, cena stoi w środku wartości. Model daje 68% na zakres 75 395 do 76 431 do poniedziałku 09:00."
date: 2026-11-08T20:00:21+01:00
type: article
section: Mapa tygodnia
price: 75912
levels:
  - { label: "PDH", price: 76235, note: "52% dotknięcia do 09:00" }
  - { label: "VAH wczoraj", price: 76038, note: "80% dotknięcia do 09:00" }
  - { label: "Szczyt Azji", price: 75984, note: "88% dotknięcia do 09:00" }
  - { label: "Otwarcie Londynu", price: 75959, note: "92% dotknięcia do 09:00" }
  - { label: "VWAP dnia", price: 75869, note: "94% dotknięcia do 09:00" }
  - { label: "POC wczoraj", price: 75867, note: "94% dotknięcia do 09:00" }
  - { label: "VAL wczoraj", price: 75696, note: "67% dotknięcia do 09:00" }
  - { label: "Dołek Azji", price: 75640, note: "59% dotknięcia do 09:00" }
  - { label: "PDL", price: 75549, note: "48% dotknięcia do 09:00" }
scenarios:
  - label: "Cena w poniedziałek o 09:00 poniżej 75 700"
    probability: 35
    note: "Cena musi wrócić pod wczorajszy VAL i utrzymać się pod stosem sprzedaży 75 680 do 75 740 z wieczornego zjazdu, z ujemną deltą w nocy."
  - label: "Cena w poniedziałek o 09:00 między 75 700 a 76 240"
    probability: 39
    note: "Wystarczy, że noc i otwarcie CME zostaną w obecnym obszarze wartości, a PDH 76 235 i klaster shortów nad nim pozostaną nietknięte."
  - label: "Cena w poniedziałek o 09:00 powyżej 76 240"
    probability: 26
    note: "Potrzebne zamknięcie nad PDH 76 235 i wejście w klaster shortów przy 76 500, z dodatnią deltą i rosnącym OI."
summary:
  - "Tydzień otworzył się przy 78 326 i schodzi do weekendu przy 75 911, 3,08% niżej, z dołkiem 74 842 pod zeszłotygodniowym minimum."
  - "Nad ceną, w 1%, wisi 25,5 mln USD shortów do likwidacji, pod ceną w tym samym pasie tylko 0,6 mln USD longów."
  - "Model daje 68% na zakres 75 395 do 76 431 do poniedziałku 09:00, a spodziewana luka na otwarciu CME mieści się w 68% między −0,38% a +0,35%."
  - "Zmienność 5 min z doby to 4,1 bp wobec 13,9 bp w dni robocze, więc weekend był wyjątkowo cichy przed CPI we wtorek o 14:30."
metrics:
  - { label: "Premia perp", value: "−3,2 bp", bias: down, note: "średnio 24 h −2,4 bp, perp lekko pod indeksem" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,12 bp/h, neutralnie" }
  - { label: "Przepływ agresorów 24 h", value: "−7,8 mln USD", bias: down, note: "kupno biorców 47,4, sprzedaż 55,3 mln USD" }
  - { label: "Likwidacje 24 h", value: "0,0 mln USD", note: "longi 0,0, shorty 0,0 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "0,6 mln USD", note: "do likwidacji między 75 153 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "25,5 mln USD", bias: up, note: "do likwidacji między ceną a 76 671" }
  - { label: "Arkusz ±10 bp: bidy", value: "55% bidów", note: "zwykle o tej godzinie 49% (18 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "4,1 bp", note: "poprzednie dni robocze (5): 13,9 bp" }
liquidations:
  step: 250
  coverage: 47
  shorts: [[79250, 0.5], [79000, 4], [78750, 3.9], [78500, 2.6], [78250, 0.5], [78000, 2.5], [77750, 0.5], [77500, 5.4], [77250, 3.6], [77000, 2], [76750, 8.2], [76500, 25.2], [76250, 1.6]]
  longs: [[75000, 12.1], [74750, 15.2], [74500, 17.6], [74250, 17.7], [74000, 26.8], [73750, 8.3], [73500, 8.3], [73250, 6.8], [73000, 34.2], [72750, 19.3], [72500, 38.5]]
  note: "Mapa z 20:01, cena wtedy 75 883; pokrycie 47% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: -4.2, note: "50 kont" }
    - { label: "Reszta rynku", value: -2.9, note: "10 950 kont" }
    - { label: "Animatorzy rynku", value: -0.7, note: "180 kont" }
setups:
  - name: "Wyciąganie shortów z klastra nad PDH"
    bias: up
    zone: [76235, 76750]
    window: "do 09:00 w poniedziałek"
    triggers:
      - "Zamknięcie świecy 15 min nad VWAP +1σ 75 985 i nad wczorajszym VAH 76 038."
      - "Delta dodatnia na tych świecach, bez sprzedaży wchłanianej przy 75 900."
      - "OI rośnie razem z ceną, a przy 76 500 pojawiają się likwidacje shortów."
    invalidation: "Zamknięcie 30 min z powrotem pod POC 24 h 75 900."
    reactions:
      - { label: "PDH", price: 76235 }
      - { label: "Klaster shortów 25,2 mln", price: 76500 }
      - { label: "Klaster shortów 8,2 mln", price: 76750 }
    evidence: "Wybicie PDH w laboratorium: n 98, częstość 44% wobec 47% losowo, bez przewagi; to wskazówka, nie statystyka."
  - name: "Powrót pod VAL i test nocnego dołka"
    bias: down
    zone: [75549, 75680]
    window: "do 09:00 w poniedziałek"
    triggers:
      - "Zamknięcie świecy 15 min pod VAL 24 h 75 675, czyli pod stosem sprzedaży 75 680 do 75 740."
      - "Delta ujemna i brak odpowiedzi kupujących przy 75 650, gdzie wieczorem było odbicie."
      - "OI rośnie przy spadku (nowe shorty) albo spada skokowo z likwidacjami longów."
    invalidation: "Zamknięcie 30 min nad VWAP dnia 75 869."
    reactions:
      - { label: "Dołek Azji", price: 75640 }
      - { label: "PDL", price: 75549 }
      - { label: "Klaster longów 12,1 mln", price: 75000 }
    evidence: "Zdjęcie PDL w laboratorium: n 94, częstość 46% wobec 48% losowo, bez przewagi."
  - name: "Rotacja w obszarze wartości przed CME"
    bias: flat
    zone: [75675, 75950]
    window: "do 09:00 w poniedziałek"
    triggers:
      - "Zamknięcia 15 min zostają między VAL 75 675 a VAH 75 950."
      - "Delta zmienia znak co kilka świec, bez stosu trzech nierównowag w jedną stronę."
      - "OI stoi w miejscu, a luka CME o północy mieści się w zakresie 68%."
    invalidation: "Dwa zamknięcia 30 min poza obszarem wartości po tej samej stronie."
    reactions:
      - { label: "POC 24 h", price: 75900 }
      - { label: "VWAP dnia", price: 75869 }
      - { label: "VAL wczoraj", price: 75696 }
    evidence: "Powrót do VWAP w laboratorium: n 185, częstość 36% wobec 43% losowo, bez przewagi."
---
## Co się stało

Ten tydzień zaczął się przy 78 326, dotarł do 81 177 i zjechał aż do 74 842, czyli pod zeszłotygodniowy dołek 76 264. Teraz cena stoi przy 75 912, 3,08% pod otwarciem tygodnia. Weekend był bardzo spokojny: cała doba zmieściła się między 75 549 (sobota, 22:30) a 76 173 (niedziela, 14:15). Piątkowe zamknięcie CME wypadło przy 75 922, więc dziś cena jest praktycznie w tym samym miejscu. Po południu, od 15:45 do 17:15, świece zamykały się nad 76 000, a o 17:45 jeden ruch sprowadził go do 75 709 i chwilę później do 75 650. Od 19:00 cena wróciła do środka wartości.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Trend tygodnia jest spadkowy: szczyt 81 177 został daleko w tyle, a wybicie pod 76 264 dało kontynuację do 74 842. Weekend to konsolidacja w wąskim pasie nad tym dołkiem, bez próby powrotu ku otwarciu tygodnia. Cena stoi w dolnej części tygodniowego zakresu, 1 070 dolarów nad jego minimum.

**Wartość.** POC z 24 godzin leży przy 75 900, obszar wartości od 75 675 do 75 950, a cena jest w jego środku. Nad VAH rynek był zaakceptowany: od 15:30 do 17:15 wszystkie świece 15 min zamknęły się nad 75 950. Pod VAL przeciwnie, zamknięcia 18:00 (75 661) i 18:15 (75 670) dały tylko pół godziny poza wartością i szybki powrót, czyli odrzucenie.

**VWAP.** VWAP dnia to 75 869, cena jest 0,37σ nad nim przy σ 116. Od 07:45 do 17:30 każda świeca 15 min zamknęła się nad VWAP. Pasmo +1σ działało jak sufit: o 14:00 zamknięcie poszło nad nie, ale już o 14:30 cena wróciła do 75 910. Od 17:45 do 18:45 świece zamykały się pod pasmem −1σ, a od 19:00 cena znów jest nad VWAP.

**Przepływ i pozycje.** Taśma obejmuje pełną dobę. Delta z 24 godzin to −344,6 BTC, z ostatnich 4 godzin −435,5 BTC przy cenie niżej o 106 dolarów, a OI w tym czasie spadło o 4,1 BTC, więc spadek to raczej zamykanie longów niż nowe shorty. W ostatniej godzinie delta +83,3 BTC, cena wyżej o 175 dolarów i OI wyżej o 19,7 BTC, co wygląda na nowe longi przy odbiciu. Sam rozjazd delty z ceną nic jeszcze nie przesądza.

## Footprint odbicia od 75 650

[[footprint]]

Świeca 18:00 to inicjatywa sprzedających: delta −195,8 BTC, stos trzech nierównowag sprzedaży od 75 680 do 75 740 i OI wyżej o 126,2 BTC, czyli nowe shorty. Następna świeca zeszła do 75 650 już na wolumenie 81,4 BTC zamiast 335,5, co wygląda na wyczerpanie. O 18:30 przyszła odpowiedź kupujących, a o 19:00 przejęli inicjatywę: wolumen 642,9 BTC, delta +119 BTC, OI wyżej o 79 BTC. O 19:15 kolejny stos trzech nierównowag kupna od 75 880 do 75 940. Ostatnia świeca, 19:45, ma deltę −114,9 BTC przy cenie, która nie spadła, to absorpcja sprzedaży przy 75 900.

Linia frontu jest więc wyraźna. Od dołu stos sprzedaży 75 680 do 75 740, który wieczorem zepchnął cenę, od góry stos kupna 75 880 do 75 940 z odbicia. POC ostatnich świec siedzą przy 75 900 i 75 920, w tym samym miejscu co POC doby. Dopóki cena trzyma się nad 75 880, kupujący bronią odbicia; zamknięcia pod 75 680 oddałyby pole sprzedającym.

## Gdzie leży płynność

[[likwidacje]]

Asymetria jest duża. Nad ceną największy klaster to 25,2 mln USD shortów w przedziale od 76 500, dalej 8,2 mln przy 76 750, a wyżej już tylko pojedyncze miliony. W 1% nad ceną leży 25,5 mln USD shortów, w 1% pod ceną tylko 0,6 mln USD longów. Longi zaczynają się dopiero od 75 000 (12,1 mln), a większe klastry są przy 74 000 (26,8 mln) i 73 000 (34,2 mln). Mapa pokrywa 47% otwartych pozycji, więc to obraz częściowy.

## Kto handluje

[[przeplywy]]

Przez dobę agresorzy sprzedali netto za 7,8 mln USD: wieloryby −4,2 mln, reszta rynku −2,9 mln, animatorzy rynku −0,7 mln. Perp jest 3,2 bp pod indeksem, a funding to 0,13 bp/h, czyli bez przegrzania po żadnej stronie. W arkuszu w paśmie ±10 bp bidy mają 55%, wobec zwykłych 49% o tej godzinie. Likwidacji w ciągu doby nie było wcale.

## Zmienność i rozkład

[[scenariusze]]

Zakres 68% do poniedziałku 09:00 to 75 395 do 76 431, a 95% to 74 882 do 76 954. Zmienność 5 min z doby to 4,1 bp wobec 13,9 bp w ostatnie dni robocze, choć teraz reżim podniósł się do 5,0 bp na 5 min. Na otwarciu CME o północy model spodziewa się luki w 68% od −0,38% do +0,35%, czyli ceny od 75 634 do 76 189. Prognoza desku na 4 godziny ma medianę 75 906 i 50% w pasie 75 718 do 76 103. Rynek HIP-4 „BTC > 75 788” wycenia 60%, model 59%, więc tu się zgadzają.

## Struktura dnia

[[poziomy]]

Cena siedzi tuż nad VWAP dnia 75 869 i wczorajszym POC 75 867, które model widzi jako niemal pewne do dotknięcia (94%). Nad nią otwarcie Londynu 75 959 (92%) i szczyt Azji 75 984 (88%), dalej VAH 76 038 (80%) i PDH 76 235 (52%). Pod nią VAL 75 696 (67%), dołek Azji 75 640 (59%) i PDL 75 549 (48%). Klastry likwidacji przy 76 550 i 76 650 mają 21% i 15%, a 75 000 tylko 9%.

## Co musiałoby się wydarzyć

[[setupy]]

Ruch w górę wymaga zamknięć nad +1σ i VAH, a potem wejścia w klaster shortów przy 76 500 z rosnącym OI. Ruch w dół zaczyna się od zamknięcia pod VAL 75 675, pod stosem sprzedaży z wieczora. Najbardziej prawdopodobny według rozkładu jest środek: 39% na cenę między 75 700 a 76 240 o 09:00. Żadna z reguł laboratorium (wybicie PDH, zdjęcie PDL, powrót do VWAP) nie pokazała przewagi nad losowością.

## Na co patrzę dalej

Najpierw otwarcie CME o północy i to, czy luka zmieści się w zakresie 68%. W laboratorium luka CME ma za mało przypadków (n 22, 50% wobec 50%), żeby coś z niej wnosić. Potem tydzień makro: we wtorek 10.11 o 14:30 CPI i bazowy CPI (prognozy 0,3% i 0,2% m/m), w piątek 13.11 o 14:30 PPI i bazowy PPI (0,4% i 0,3%). Przy zmienności tak niskiej jak w weekend dane z USA mogą łatwo przestawić cały zakres tygodnia.

## Rzetelność modelu

Przedziały 90% na godzinę obejmowały 92% wyników, a 60% obejmowały 72% (n 1657), więc węższe przedziały są zbyt ostrożne. Na 4 godziny 90% obejmowało 91%, 60% obejmowało 75% (n 1645). Dotknięcia PDH, PDL i środka mają Brier 0,073 wobec 0,118 dla częstości bazowej (n 1653), czyli model wyraźnie bije samą częstość.

Prawdopodobieństwa pochodzą z modelu desku HAR + FHS i symulacji Monte Carlo, policzone o 20:00 i zapisane przed faktem, żeby dało się je potem rozliczyć. Model zakłada brak przewagi. Następny wpis to mapa dnia w poniedziałek rano, około 08:00, przed otwarciem Londynu.
