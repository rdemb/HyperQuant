---
title: "BTC 75 684 pod VWAP w sobotę wieczorem, 36% na powrót nad 75 860 do niedzieli"
description: "Bitcoin od 13:30 zamyka każdą świecę 15 min pod VWAP dnia. Zakres 68% do niedzieli 10:00 to 75 171 do 76 166, a piątkowe zamknięcie CME leży przy 75 922."
date: 2026-11-07T22:00:22+01:00
type: article
section: Mapa na weekend
price: 75684
levels:
  - { label: "PDH", price: 76400, note: "14% dotknięcia do 10:00" }
  - { label: "Szczyt Azji", price: 76100, note: "38% dotknięcia do 10:00" }
  - { label: "Otwarcie Londynu", price: 76075, note: "41% dotknięcia do 10:00" }
  - { label: "VAH wczoraj", price: 76038, note: "45% dotknięcia do 10:00" }
  - { label: "VWAP dnia", price: 75861, note: "69% dotknięcia do 10:00" }
  - { label: "Dołek Azji", price: 75769, note: "83% dotknięcia do 10:00" }
  - { label: "POC wczoraj", price: 75753, note: "86% dotknięcia do 10:00" }
  - { label: "VAL wczoraj", price: 75392, note: "56% dotknięcia do 10:00" }
  - { label: "Likwidacje longów", price: 74850, note: "19,8 mln USD, 10% dotknięcia do 10:00" }
scenarios:
  - label: "Cena w niedzielę o 10:00 poniżej 75 390"
    probability: 28
    note: "Cena musiałaby zostać pod VAL z 24 godzin 75 725, przejść przez dołek dnia 75 567 i zejść pod VAL wczoraj. Niżej leżą likwidacje longów, więc taki ruch mógłby przyspieszyć."
  - label: "Cena w niedzielę o 10:00 między 75 390 a 75 860"
    probability: 36
    note: "Wystarczy spokojna noc: przy zmienności 4,2 bp na 5 minut cena krąży między dołkiem dnia a VWAP i nie wraca nad 75 860."
  - label: "Cena w niedzielę o 10:00 powyżej 75 860"
    probability: 36
    note: "Cena musi wrócić do obszaru wartości i zamknąć się nad VWAP dnia, a shorty otwarte wieczorem musiałyby zacząć się zamykać w drodze do zamknięcia CME 75 922."
summary:
  - "Sobota kończy się przy 75 684, pod VWAP dnia 75 861 (−1,22σ) i pod obszarem wartości z 24 godzin, którego dół to 75 725."
  - "Model daje 68% na cenę między 75 171 a 76 166 w niedzielę o 10:00 i 36% na powrót nad VWAP."
  - "Agresorzy sprzedali netto 19,8 mln USD w ciągu doby, z czego 11,5 mln USD przypada na wieloryby."
  - "Zmienność 5 min spadła do 4,2 bp wobec 14,3 bp w dni robocze, a likwidacje z doby to tylko 0,1 mln USD."
metrics:
  - { label: "Premia perp", value: "−2,3 bp", note: "średnio 24 h −2,1 bp" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,12 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "−19,8 mln USD", note: "kupno biorców 65,7, sprzedaż 85,4 mln USD" }
  - { label: "Likwidacje 24 h", value: "0,1 mln USD", note: "longi 0,0, shorty 0,1 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "6,7 mln USD", note: "do likwidacji między 74 927 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "2,6 mln USD", note: "do likwidacji między ceną a 76 441" }
  - { label: "Arkusz ±10 bp: bidy", value: "49% bidów", note: "zwykle o tej godzinie 50% (17 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "4,2 bp", note: "poprzednie dni robocze (5): 14,3 bp" }
liquidations:
  step: 250
  coverage: 47
  shorts: [[79000, 1.1], [78750, 7.1], [78500, 2.1], [78250, 0.4], [78000, 2], [77750, 0.5], [77500, 1.6], [77250, 2.9], [77000, 2.3], [76750, 6.4], [76500, 10.2], [76250, 2.6]]
  longs: [[75000, 6.7], [74750, 23.1], [74500, 20.4], [74250, 13.6], [74000, 28.2], [73750, 4.8], [73500, 13.1], [73250, 6.8], [73000, 39], [72750, 30.3], [72500, 37.1], [72250, 11.6]]
  note: "Mapa z 21:59, cena wtedy 75 653; pokrycie 47% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: -11.5, note: "50 kont" }
    - { label: "Reszta rynku", value: -7.5, note: "11 670 kont" }
    - { label: "Animatorzy rynku", value: -0.8, note: "180 kont" }
setups:
  - name: "Powrót do wartości i do piątkowego zamknięcia CME"
    bias: up
    zone: [75725, 75861]
    window: "do 10:00 w niedzielę"
    triggers:
      - "Świeca 15 min zamyka się z powrotem nad VAL z 24 godzin 75 725, ponad stosem nierównowag sprzedaży 75 660 do 75 700."
      - "Delta na świecy powrotu jest dodatnia, a kolejne świece nie oddają jej od razu."
      - "Open interest spada przy rosnącej cenie, czyli zamykają się shorty otwarte o 21:45."
    invalidation: "Dwa zamknięcia 15 min pod VWAP −2σ 75 570."
    reactions:
      - { label: "VWAP dnia", price: 75861 }
      - { label: "VAH wczoraj", price: 76038 }
      - { label: "Otwarcie Londynu", price: 76075 }
    evidence: "Zamknięcie luki CME w laboratorium desku: n 22, częstość 50% wobec losowej 50%, za mało przypadków i brak przewagi."
  - name: "Akceptacja pod obszarem wartości"
    bias: down
    zone: [75570, 75725]
    window: "do 10:00 w niedzielę"
    triggers:
      - "Dwie świece 30 min zamykają się pod VAL z 24 godzin 75 725."
      - "Delta zostaje ujemna, a stos nierównowag sprzedaży 75 660 do 75 700 nie zostaje przejedzony od dołu."
      - "Open interest dalej rośnie przy spadającej cenie, czyli przybywa nowych shortów."
    invalidation: "Zamknięcie 30 min z powrotem nad 75 725."
    reactions:
      - { label: "VWAP −2σ", price: 75570 }
      - { label: "VAL wczoraj", price: 75392 }
      - { label: "Likwidacje longów", price: 74850 }
---
## Co się stało

Piątek zostawił szeroki zakres od 74 842 do 76 400, a CME zamknęło tydzień przy 75 922. Sobota zmieściła się w całości w środku tego zakresu. Rano cena doszła do 76 235 o 10:00, potem zaczęło się powolne oddawanie. O 13:30 świeca 15 min zjechała do 75 806 i od tej chwili każda kolejna świeca zamykała się pod VWAP dnia. Najmocniejszy ruch przyszedł o 16:45: zejście do 75 567, dołka całej doby, przy delcie −365,9 BTC. Wieczorem cena wróciła na chwilę w okolice 75 850, a ostatnia świeca przed 22:00 sięgnęła 75 592 i zamknęła się przy 75 684, 0,31% pod piątkowym zamknięciem CME.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Sobotni zakres to tylko 668 USD, od 75 567 do 76 235, i leży w całości w piątkowym przedziale od 74 842 (PDL) do 76 400 (PDH). Nie było więc ani wybicia, ani nieudanego wybicia, tylko dzień wewnętrzny. Cena stoi tuż nad środkiem piątkowego zakresu, a poranny szczyt dnia zatrzymał się 165 USD pod PDH.

**Wartość.** Obszar wartości z 24 godzin to 75 725 do 76 050 z POC przy 75 875, a cena jest pod nim. Wcześniejsze wyjścia pod 75 725 o 17:15 i 17:45 zostały odrzucone, bo już o 18:00 świeca zamknęła się z powrotem w środku. Teraz pod VAL zamknęły się dwie ostatnie świece 15 min, 21:30 i 21:45. To jeszcze nie akceptacja, do niej potrzebuję dwóch zamknięć 30 min poza obszarem.

**VWAP.** VWAP dnia stoi przy 75 861, odchylenie 145 USD, a cena jest 1,22σ pod nim. Od 13:30 żadna świeca 15 min nie zamknęła się nad VWAP. Pasmo −1σ, dziś przy 75 716, działało jak oś: cena wielokrotnie zamykała się pod nim po południu i za każdym razem wracała, ostatnio przebiła je o 21:30.

**Przepływ i pozycje.** W ostatniej godzinie cena spadła o 96 USD, a open interest wzrósł o 112 BTC, przy delcie tylko +11,5 BTC. Cena w dół i OI w górę to nowe shorty, i to otwierane raczej limitami niż agresywnie. W 4 godziny cena oddała 38 USD przy OI wyższym o 168,1 BTC i delcie +12,9 BTC. Na całej taśmie z doby delta wynosi −469,8 BTC, z czego większość przypada na zejście o 16:45; taśma ma dwie kilkuminutowe luki, przed 04:45 i przed 09:22, które tej liczby nie zmieniają w istotny sposób.

## Footprint zejścia do 75 592

[[footprint]]

Sekwencja zaczęła się o 20:00 od trzech świec z ujemną deltą, kolejno −16,8, −28,4 i −57,1 BTC, a świeca 20:30 zostawiła stos trzech nierównowag sprzedaży od 75 730 do 75 750. Open interest w tym czasie spadał, łącznie o prawie 100 BTC, więc to longi wychodziły z rynku. O 20:45 przyszła odpowiedź z nierównowagami kupna przy 75 770 i 75 780, a o 21:15 delta wyniosła +20,8 BTC, tylko że cena zamknęła się niżej, przy 75 746. Dodatnia delta bez postępu ceny to absorpcja kupujących przez limity sprzedaży. Ostatnia świeca, 21:45, miała największy wolumen całego okna, 244,8 BTC, zeszła do 75 592 i zamknęła się 92 USD wyżej przy prawie zerowej delcie −6,9 BTC, a open interest skoczył o 105,3 BTC.

Linia frontu jest teraz bardzo blisko ceny. Nad nią stoi stos pięciu nierównowag sprzedaży od 75 660 do 75 700, a wyżej stos z 20:30 przy 75 730 do 75 750. Pod ceną POC ostatniej świecy 75 610 i nierównowaga kupna 75 620, czyli miejsce, w którym knot został odkupiony. Dopóki cena siedzi w stosie 75 660 do 75 700, sprawa jest otwarta.

## Gdzie leży płynność

[[likwidacje]]

Pod ceną jest wyraźnie więcej do zabrania niż nad nią. W 1% pod ceną mapa pokazuje 6,7 mln USD longów do likwidacji, w 1% nad ceną 2,6 mln USD shortów. Większe skupiska longów to 23,1 mln USD w przedziale od 74 750 i 20,4 mln USD od 74 500, a dalej 28,2 mln USD od 74 000. Nad ceną największy przedział to 10,2 mln USD od 76 500, czyli tuż nad PDH. Mapa pokrywa 47% otwartych pozycji, więc to obraz częściowy.

## Kto handluje

[[przeplywy]]

Przez dobę biorcy sprzedali o 19,8 mln USD więcej niż kupili. Wieloryby, 50 kont, odpowiadają za 11,5 mln USD tej nadwyżki, reszta rynku za 7,5 mln USD, animatorzy za 0,8 mln USD. Perp handluje z premią −2,3 bp wobec średniej z doby −2,1 bp, funding to 0,13 bp na godzinę, więc rynek nie płaci za longi więcej niż zwykle. Arkusz w ±10 bp jest zrównoważony, 49% bidów wobec typowych 50% o tej godzinie.

## Zmienność i rozkład

[[scenariusze]]

Zmienność 5 min z ostatniej doby to 4,2 bp wobec 14,3 bp w poprzednie dni robocze, typowy weekendowy spokój. Bieżący reżim to 8,1 bp na 5 minut i dopiero się zaczął. Model daje 68% na cenę między 75 171 a 76 166 w niedzielę o 10:00 i 95% między 74 679 a 76 668. Prognoza desku na 4 godziny ma medianę 75 702 i 50% w przedziale 75 518 do 75 876. Na HIP-4 kontrakt na BTC powyżej 76 012 rynek wycenia na 22% i model daje dokładnie tyle samo.

## Struktura dnia

[[poziomy]]

Cena jest pod dołkiem Azji 75 769 i pod POC wczoraj 75 753, które model widzi z szansą dotknięcia 83% i 86%, bo leżą tuż nad nią. VWAP dnia 75 861 ma 69%, VAH wczoraj 76 038 już tylko 45%, otwarcie Londynu 41%, a szczyt Azji 38%. W dół najbliższy jest VAL wczoraj przy 75 392 z szansą 56%, a klaster likwidacji longów przy 74 850 to 10%, podobnie jak PDH w drugą stronę z 14%.

## Co musiałoby się wydarzyć

[[setupy]]

Pierwszy obraz to powrót do wartości. Potrzebuję zamknięcia 15 min nad 75 725, dodatniej delty, która się utrzyma, i spadku open interest przy rosnącej cenie, bo to znaczyłoby, że wieczorne shorty się zamykają. Drugi obraz to akceptacja pod wartością: dwa zamknięcia 30 min pod 75 725, ujemna delta i dalszy wzrost OI. Reguła powrotu do obszaru wartości to wskazówka z praktyki, nie statystyka, a podobna reguła powrotu do VWAP wypadła w laboratorium desku słabo, 35% wobec losowych 43% przy 184 przypadkach.

## Na co patrzę dalej

Najważniejsze jest pierwsze zamknięcie 30 min po 22:00 i to, czy cena wyjdzie z wąskiego pasa 75 660 do 75 700. Patrzę też na 105 BTC open interest dobudowane na ostatniej świecy: jeśli cena wróci nad 75 750, te pozycje będą pod presją. Okrągłe 75 000 model widzi z szansą 18%, a laboratorium nie znalazło przewagi na takich poziomach jako wsparciu, 53% wobec losowych 49% przy 329 przypadkach. Luka do piątkowego zamknięcia CME rozstrzygnie się dopiero po otwarciu CME, poza horyzontem tej mapy.

## Rzetelność modelu

Przedziały 4 godzinne są skalibrowane na brzegach: 90% przedział obejmuje cenę w 91% przypadków, ale 60% przedział w 74%, więc środek rozkładu jest za szeroki. Przy przedziałach godzinnych jest podobnie, 93% i 72% przy 1569 prognozach. Szanse dotknięcia PDH, PDL i środka mają Brier 0,072 wobec 0,115 dla samej częstości bazowej przy 1565 prognozach.

Prawdopodobieństwa pochodzą z modelu desku HAR + FHS i symulacji Monte Carlo, policzone o 22:00 i zapisane przed faktem, a w niedzielę rozliczę je z tym, co zrobiła cena. Następny wpis to aktualizacja w niedzielę o 10:00, a mapa tygodnia w niedzielę o 20:00.
