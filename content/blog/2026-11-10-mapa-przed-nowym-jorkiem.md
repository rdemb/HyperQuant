---
title: "BTC przed Nowym Jorkiem: 73 879 po zejściu pod PDL, longi 18,5 mln przy 73 150"
description: "Cena zeszła do 73 595 i wróciła nad wczorajszy dołek. Do 19:30 zakres 68% to 73 041 do 74 824, a klaster longów przy 73 150 ma 34% szans dotknięcia."
date: 2026-11-10T14:50:22+01:00
type: article
section: Mapa przed Nowym Jorkiem
price: 73879
levels:
  - { label: "Likwidacje shortów", price: 75150, note: "3,2 mln USD, 15% dotknięcia do 19:30" }
  - { label: "POC wczoraj", price: 74879, note: "26% dotknięcia do 19:30" }
  - { label: "Otwarcie tygodnia", price: 74820, note: "29% dotknięcia do 19:30" }
  - { label: "Otwarcie Londynu", price: 74816, note: "29% dotknięcia do 19:30" }
  - { label: "VAL wczoraj", price: 74366, note: "60% dotknięcia do 19:30" }
  - { label: "VWAP dnia", price: 74353, note: "61% dotknięcia do 19:30" }
  - { label: "Dołek Azji", price: 74347, note: "61% dotknięcia do 19:30" }
  - { label: "PDL", price: 73698, note: "77% dotknięcia do 19:30" }
  - { label: "Likwidacje longów", price: 73150, note: "18,5 mln USD, 34% dotknięcia do 19:30" }
scenarios:
  - label: "Cena o 19:30 poniżej 73 150"
    probability: 18
    note: "Cena musi zejść pod dzisiejszy dołek 73 595 i wejść w klaster 18,5 mln USD longów, a open interest spadać razem z rosnącymi likwidacjami."
  - label: "Cena o 19:30 między 73 150 a 74 350"
    probability: 50
    note: "Wystarczy, że otwarcie Nowego Jorku nie przejmie inicjatywy: cena zostaje pod VWAP dnia i dołkiem Azji, ale nad klastrem longów."
  - label: "Cena o 19:30 powyżej 74 350"
    probability: 32
    note: "Potrzebny powrót nad VWAP dnia i dołek Azji, czyli zamknięcia nad 74 350 z dodatnią deltą i rosnącym open interest."
summary:
  - "O 14:30 cena zeszła pod wczorajszy dołek 73 698 aż do 73 595 i zamknęła kwadrans przy 73 879, na wolumenie 3 939,5 BTC."
  - "Pod ceną w 1% leży 18,0 mln USD longów do likwidacji, nad ceną tylko 0,3 mln USD shortów."
  - "Wieloryby sprzedały agresywnie netto 38,3 mln USD w 24 h, reszta rynku kupiła netto 7,9 mln USD."
  - "Model daje 50% na cenę między 73 150 a 74 350 o 19:30, przy zakresie 68% od 73 041 do 74 824."
metrics:
  - { label: "Premia perp", value: "−3,7 bp", note: "średnio 24 h −3,1 bp" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,12 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "−32,1 mln USD", note: "kupno biorców 270,9, sprzedaż 303,0 mln USD" }
  - { label: "Likwidacje 24 h", value: "8,4 mln USD", note: "longi 5,0, shorty 3,4 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "18,0 mln USD", note: "do likwidacji między 73 140 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "0,3 mln USD", note: "do likwidacji między ceną a 74 618" }
  - { label: "Arkusz ±10 bp: bidy", value: "53% bidów", note: "zwykle o tej godzinie 50% (20 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "11,6 bp", note: "poprzednie dni robocze (5): 13,9 bp" }
liquidations:
  step: 250
  coverage: 47
  shorts: [[77000, 2.5], [76750, 2.5], [76500, 2.6], [76250, 1.8], [76000, 2.3], [75750, 3.9], [75500, 3.9], [75250, 2.1], [75000, 6.3], [74750, 3.3], [74500, 1.5], [74250, 0.1]]
  longs: [[73500, 5.6], [73250, 9.9], [73000, 25.9], [72750, 12.6], [72500, 21.3], [72250, 16.2], [72000, 16.2], [71750, 22.4], [71500, 54.3], [71250, 7.6], [71000, 57.1], [70750, 2.7], [70500, 5]]
  note: "Mapa z 14:49, cena wtedy 73 985; pokrycie 47% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: -38.3, note: "90 kont" }
    - { label: "Reszta rynku", value: 7.9, note: "18 670 kont" }
    - { label: "Animatorzy rynku", value: -1.7, note: "220 kont" }
setups:
  - name: "Powrót nad VAL i VWAP dnia po zejściu pod PDL"
    bias: up
    zone: [74325, 74392]
    window: "do 19:30"
    triggers:
      - "Zamknięcie świecy 15 min nad VWAP dnia 74 392, pierwszy raz od 09:00."
      - "Delta tej świecy dodatnia, bez dużej sprzedaży agresorów przy VAL 74 325."
      - "Open interest rośnie razem z ceną, czyli nowe longi, a nie samo zamykanie shortów."
    invalidation: "Zamknięcie 15 min z powrotem pod VAL 24 h 74 325 zaraz po wejściu nad VWAP."
    reactions:
      - { label: "Otwarcie Londynu", price: 74816 }
      - { label: "POC wczoraj", price: 74879 }
      - { label: "Likwidacje shortów", price: 75150 }
    evidence: "Hipoteza powrotu do VWAP w laboratorium: n 188, częstość 36% wobec losowej 43%, czyli bez przewagi. Traktuję ją jako wskazówkę, nie statystykę."
  - name: "Drugie zejście pod PDL do klastra longów"
    bias: down
    zone: [73000, 73250]
    window: "do 19:30"
    triggers:
      - "Zamknięcie świecy 15 min pod dzisiejszym dołkiem 73 595."
      - "Delta ujemna, bez nierównowag kupna przy 73 600 i 73 650 jak o 14:30."
      - "Open interest spada, a likwidacje longów rosną skokowo, czyli zamykanie longów."
    invalidation: "Zamknięcie 30 min nad 74 000 zanim cena dojdzie do strefy."
    reactions:
      - { label: "PDL", price: 73698 }
      - { label: "Likwidacje longów", price: 73150 }
    evidence: "Hipoteza o PDL w laboratorium: n 94, częstość 46% wobec losowej 48%, nie odróżnia się od szumu."
  - name: "Balans między PDL a VAL"
    bias: flat
    zone: [73698, 74325]
    window: "do 19:30"
    triggers:
      - "Zamknięcia świec 15 min zostają między 73 698 a 74 325."
      - "Delta kolejnych świec zmienia znak, bez stosu nierównowag w jedną stronę."
      - "Open interest stoi w miejscu po skoku o 406 BTC z 14:30."
    invalidation: "Zamknięcie 30 min pod 73 595 albo nad VWAP dnia 74 392."
    reactions:
      - { label: "PDL", price: 73698 }
      - { label: "VWAP dnia", price: 74353 }
---
## Co się stało

Doba zaczęła się od szczytu 75 573 wczoraj o 16:45, a potem rynek przez noc i Azję trzymał się okolic 75 000. O 05:30 sprzedawcy zepchnęli cenę do 74 342, Londyn otworzył się przy 74 816 i od 09:00 każde zamknięcie 15 min stało już pod VWAP dnia. O 14:30 przyszedł najmocniejszy ruch dnia: w jednym kwadransie cena przeszła od 74 602 do 73 595, czyli pod wczorajszy dołek 73 698, i zamknęła się przy 73 879. Za 24 h to spadek o 1,04%, a BTC stoi pod obszarem wartości i 1,29σ pod VWAP dnia.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Cała doba zmieściła się między 75 573 a 73 595 i cena stoi teraz przy samym dnie tego zakresu. Wczorajszy szczyt 75 585 nie został przebity, za to wczorajszy dołek 73 698 tak. Czy to wybicie z kontynuacją, czy nieudane wybicie, rozstrzygnie dopiero kolejna świeca: na razie jedna zeszła pod PDL i zamknęła się nad nim.

**Wartość.** POC z 24 h to 74 850, obszar wartości 74 325 do 75 250, a cena jest pod nim. Od 11:15 zamknięcia pod VAL przeplatały się z powrotami nad nią, więc do 14:30 rynek nie zaakceptował cen pod wartością. Dopiero zamknięcie przy 73 879 jest wyraźnie niżej; na akceptację potrzeba jeszcze drugiej świecy 30 min pod 74 325.

**VWAP.** VWAP dnia stoi na 74 392 przy σ 398, cena jest 1,29σ pod nim. Od 09:00 żadne zamknięcie 15 min nie wróciło nad VWAP, a od 10:00 cena krążyła wokół pasma −1σ, raz nad nim, raz pod. Ostatnia świeca zamknęła się 115 USD pod tym pasmem.

**Przepływ i pozycje.** W ostatniej godzinie cena spadła o 297 USD, a open interest wzrósł o 439,4 BTC, co według macierzy oznacza nowe shorty. W tej samej godzinie delta agresorów była dodatnia, +509 BTC, czyli kupujący z rynku nie przesunęli ceny w górę. W 4 h cena straciła 518 USD przy OI niższym o 119,6 BTC, a to obraz zamykania longów. Taśma obejmuje ostatnie 24 h do 14:45.

## Footprint zejścia pod PDL

[[footprint]]

Sekwencję zaczęła świeca 13:15: stos trzech nierównowag sprzedaży 74 300, 74 250 i 74 200, delta −350,1 BTC i OI niższy o 369,8 BTC, czyli inicjatywa sprzedających i wyjście longów. O 13:30 sprzedaż już słabła (delta −117,6), a o 13:45 przyszła odpowiedź: nierównowagi kupna na 74 300 i 74 250 i powrót do 74 367. Potem dwie spokojne świece i o 14:30 kwadrans z wolumenem 3 939,5 BTC, wielokrotnie większym niż w każdej z poprzednich świec. Cena przeszła od 74 602 do 73 595, likwidacje longów sięgnęły 1,84 mln USD, a mimo to delta wyszła dodatnia, +278,4 BTC, przy OI wyższym o 406,4 BTC. Kupno agresorów zostało wchłonięte bez postępu ceny w górę, a na samym dole pojawiły się nierównowagi kupna na 73 600 i 73 650.

Linia frontu na teraz: od góry stos sprzedaży 74 200 do 74 300 z 13:15, który cena musi odzyskać, żeby wrócić do wartości. Niżej POC świecy z 14:30 na 73 850, tuż pod ceną, i nierównowagi kupna 73 600 i 73 650 przy dzisiejszym dołku. Zamknięcie pod 73 595 zdjęłoby tę obronę.

## Gdzie leży płynność

[[likwidacje]]

Mapa jest mocno przechylona w dół. W 1% pod ceną czeka 18,0 mln USD longów do likwidacji, a w 1% nad ceną tylko 0,3 mln USD shortów. Najbliższy duży klaster to 73 150 z 18,5 mln USD, a w przedziale od 73 000 leży 25,9 mln USD. Dalej w dół są jeszcze większe skupiska: 54,3 mln USD od 71 500 i 57,1 mln USD od 71 000, ale to daleko poza dzisiejszym zakresem 68%. Nad ceną największy przedział to 6,3 mln USD od 75 000. Mapa widzi 47% otwartych pozycji, więc to obraz części rynku, nie całości.

## Kto handluje

[[przeplywy]]

Przez dobę agresywna sprzedaż przeważyła o 32,1 mln USD: 303,0 mln USD po stronie sprzedających z rynku wobec 270,9 mln USD kupna. Prawie całą tę różnicę zrobiło 90 kont wielorybów, netto −38,3 mln USD. Reszta rynku, 18 670 kont, kupowała netto 7,9 mln USD, a animatorzy rynku byli blisko zera, −1,7 mln USD. Premia kontraktu wobec spotu to −3,7 bp przy średniej z doby −3,1 bp, a funding 0,13 bp/h, czyli 11,0% w skali roku. Ujemna premia przy dodatnim fundingu mówi, że kontrakt handluje się taniej niż spot, ale bez paniki. W arkuszu ±10 bp od ceny bidy mają 53%, przy zwykłych 50% o tej godzinie.

## Zmienność i rozkład

[[scenariusze]]

Do 19:30 model liczy σ 121 bp, co daje zakres 68% od 73 041 do 74 824 i 95% od 72 166 do 75 731. Środkowy scenariusz, cena między 73 150 a 74 350, ma 50%, wyjście nad 74 350 ma 32%, a zejście pod klaster longów 18%. Zmienność 5 min z ostatniej doby to 11,6 bp, mniej niż 13,9 bp ze średniej pięciu poprzednich dni roboczych. Reżim trwa około 26 h przy 11,3 bp na 5 min, a szansa jego zmiany w 25 min to 2%; jeden mocny kwadrans o 14:30 tego jeszcze nie przestawił. Prognoza desku na 4 h z 14:32 daje medianę 73 982 i 50% w przedziale 73 422 do 74 511. Na rynku HIP-4 „BTC powyżej 74 798” do jutra 07:00 rynek płaci 27%, model 28%, więc tu nie ma rozjazdu.

## Struktura dnia

[[poziomy]]

Cena stoi między PDL 73 698 pod spodem a grupą poziomów nad sobą. Najbliżej nad ceną są dołek Azji 74 347, VWAP dnia 74 353 i VAL wczoraj 74 366, wszystkie w wąskim pasie i każdy z szansą dotknięcia około 60% do 19:30. Wyżej leżą otwarcie Londynu 74 816 i otwarcie tygodnia 74 820, po 29%, i POC wczoraj 74 879 z 26%. PDL ma 77% szans na ponowne dotknięcie, a klaster longów 73 150 34%. Na górze likwidacje shortów 75 150 mają już tylko 15%.

## Co musiałoby się wydarzyć

[[setupy]]

Pierwszy obraz to powrót nad VAL i VWAP dnia, czyli odrzucenie zejścia pod PDL. Musiałoby się to zacząć od zamknięcia nad 74 392 z dodatnią deltą i rosnącym OI; dopiero wtedy otwarcie Londynu i POC wczoraj wracają do gry. Drugi to dokończenie ruchu z 14:30: zamknięcie pod 73 595, ujemna delta i spadające OI razem z likwidacjami otwierają drogę do klastra 73 150. Trzeci, najbardziej prawdopodobny w rozkładzie, to balans między PDL a VAL. Żadna z hipotez laboratorium dla tych miejsc nie odróżnia się od szumu, więc to wskazówki, nie statystyka.

## Na co patrzę dalej

Patrzę na to, co zrobi pierwsza godzina po otwarciu Nowego Jorku o 15:30 z dołkiem 73 595. Utrzymanie się nad nim przy rosnącym OI i dodatniej delcie oznaczałoby, że wolumen z 14:30 był wypłukaniem longów. Drugie zejście pod ten dołek przy spadającym OI zmienia obraz na kontynuację w stronę 73 150. Nad ceną kluczowy jest pas 74 347 do 74 392; bez powrotu nad VWAP dnia każde odbicie jest tylko odbiciem w trendzie dnia.

## Rzetelność modelu

Przedziały 90% na 4 h obejmują 91% wyników, a przedziały 60% aż 74%, czyli model jest raczej za ostrożny niż za pewny siebie (n 1816). Na 1 h jest podobnie: 92% i 71% (n 1828). Szanse dotknięcia PDH, PDL i środka mają Brier 0,073 wobec 0,122 dla samej częstości bazowej (n 1824), więc model wnosi coś ponad prostą statystykę.

Prawdopodobieństwa pochodzą z modelu desku HAR + FHS i symulacji Monte Carlo, liczone o 14:50 i zapisane przed faktem, a po 19:30 zostaną rozliczone. Następny wpis to krótka notka po otwarciu Nowego Jorku, o 15:45.
