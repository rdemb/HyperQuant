---
title: "Mapa tygodnia: BTC 80 640, prawie 1% pod piątkowym CME, a w środę Fed"
description: "BTC 80 640 w niedzielę wieczorem, 0,95% pod piątkowym zamknięciem CME. Do poniedziałku 09:00 model daje 57% na zakres 79 800 do 81 000, nad ceną leży 14,7 mln USD shortów."
date: 2026-10-25T20:00:23+01:00
type: article
section: Mapa tygodnia
price: 80640
levels:
  - { label: "Likwidacje shortów", price: 81350, note: "4,2 mln USD, 32% dotknięcia do 09:00" }
  - { label: "PDH", price: 81214, note: "41% dotknięcia do 09:00" }
  - { label: "Likwidacje shortów", price: 81150, note: "7,7 mln USD, 46% dotknięcia do 09:00" }
  - { label: "Szczyt Azji", price: 81014, note: "59% dotknięcia do 09:00" }
  - { label: "VAH wczoraj", price: 81000, note: "60% dotknięcia do 09:00" }
  - { label: "POC wczoraj", price: 80740, note: "87% dotknięcia do 09:00" }
  - { label: "Otwarcie Londynu", price: 80650, note: "98% dotknięcia do 09:00" }
  - { label: "VWAP dnia", price: 80552, note: "91% dotknięcia do 09:00" }
  - { label: "Dołek Azji", price: 80394, note: "74% dotknięcia do 09:00" }
scenarios:
  - label: "Cena w poniedziałek o 09:00 poniżej 79 800"
    probability: 13
    note: "Otwarcie CME musiałoby pociągnąć cenę pod dołek niedzieli 80 051 i pod VAL 79 800, w stronę klastra longów 79 500. To wymaga wyraźnej sprzedaży w cienkiej nocy."
  - label: "Cena w poniedziałek o 09:00 między 79 800 a 81 000"
    probability: 57
    note: "Wystarczy, że luka CME domknie się bez kontynuacji, a cena dalej będzie krążyć wokół VWAP 80 552 i POC 80 740, tak jak przez całą niedzielę."
  - label: "Cena w poniedziałek o 09:00 powyżej 81 000"
    probability: 30
    note: "Potrzebne jest przyjęcie ceny nad szczytem doby 81 014, wtedy na drodze są shorty 81 150 i PDH 81 214, a dalej piątkowe zamknięcie CME 81 407."
summary:
  - "Tydzień zamyka się na 80 640, czyli 1,77% pod poniedziałkowym otwarciem 82 078, po zakresie od 79 184 do 84 850."
  - "Piątkowe CME zamknęło się przy 81 407, model spodziewa się luki na otwarciu od −1,33% do −0,58%."
  - "Nad ceną w 1% leży 14,7 mln USD shortów do likwidacji, pod ceną tylko 1,4 mln USD longów."
  - "Do poniedziałku 09:00 zakres 68% to 79 878 do 81 385, a w środę o 19:00 decyzja Fed."
metrics:
  - { label: "Premia perp", value: "−3,0 bp", note: "średnio 24 h −3,8 bp" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,11 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "6,4 mln USD", bias: up, note: "kupno biorców 22,5, sprzedaż 16,1 mln USD" }
  - { label: "Likwidacje 24 h", value: "0,0 mln USD", note: "longi 0,0, shorty 0,0 mln USD, spokojna niedziela" }
  - { label: "Longi w 1% pod ceną", value: "1,4 mln USD", note: "do likwidacji między 79 834 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "14,7 mln USD", note: "do likwidacji między ceną a 81 446" }
  - { label: "Arkusz ±10 bp: bidy", value: "48% bidów", note: "zwykle o tej godzinie 50% (4 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "6,2 bp", note: "poprzednie dni robocze (5): 10,5 bp" }
liquidations:
  step: 250
  coverage: 44
  shorts: [[84000, 1.4], [83750, 7.8], [83500, 3.1], [83250, 2.9], [83000, 1], [82750, 1.1], [82500, 2.4], [82250, 4.2], [82000, 2.9], [81750, 2.8], [81500, 15.8], [81250, 5.8], [81000, 8.9]]
  longs: [[79750, 4.9], [79500, 28], [79250, 7.1], [79000, 23.1], [78750, 18.6], [78500, 43.3], [78250, 13], [78000, 9.9], [77750, 2.7], [77500, 12.3], [77250, 14], [77000, 15.3]]
  note: "Mapa z 19:58, cena wtedy 80 610; pokrycie 44% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: 4.9, note: "70 kont" }
    - { label: "Reszta rynku", value: 0, note: "13 400 kont" }
    - { label: "Animatorzy rynku", value: 1.6, note: "180 kont" }
setups:
  - name: "Wybicie nad szczyt doby w klaster shortów"
    bias: up
    zone: [81000, 81250]
    window: "do 09:00 w poniedziałek"
    triggers:
      - "Świeca 15 min zamyka się nad szczytem doby 81 014."
      - "Delta na świecy wybicia jest wyraźnie dodatnia."
      - "OI rośnie przy wybiciu (nowe longi) albo spada skokowo, gdy shorty 81 150 są zamykane."
    invalidation: "Powrót i zamknięcie świecy 30 min pod VAH 24 h 80 775."
    reactions:
      - { label: "PDH", price: 81214 }
      - { label: "Likwidacje shortów", price: 81350 }
      - { label: "Likwidacje shortów 15,8 mln", price: 81500 }
    evidence: "Wybicia PDH w laboratorium desku: n 92, kontynuacja 43% wobec losowej 47%, bez przewagi."
  - name: "Luka CME ciągnie cenę pod dołek niedzieli"
    bias: down
    zone: [80051, 80250]
    window: "od otwarcia CME o 23:00 do 09:00"
    triggers:
      - "Świeca 15 min zamyka się pod VAL 24 h 80 250."
      - "Delta jest ujemna i układa się w stos nierównowag sprzedaży."
      - "OI spada (zamykanie longów) albo rośnie przy spadku (nowe shorty)."
    invalidation: "Zamknięcie świecy 30 min z powrotem nad VWAP dnia 80 552."
    reactions:
      - { label: "Dołek Azji", price: 80394 }
      - { label: "Likwidacje longów", price: 79750 }
      - { label: "Likwidacje longów 28 mln", price: 79500 }
    evidence: "Reguła luki CME w laboratorium: n 20, 50% wobec losowej 50%, za mało prób na wniosek."
  - name: "Rotacja w obszarze wartości przed Fed"
    bias: flat
    zone: [80250, 80775]
    window: "do 09:00 w poniedziałek"
    triggers:
      - "Świece 15 min zamykają się z powrotem w obszarze po każdym wyjściu za jego brzeg."
      - "Delta zmienia znak co kilka świec, bez stosów nierównowag."
      - "OI stoi w miejscu."
    invalidation: "Dwie świece 30 min zamknięte poza obszarem 80 250 do 80 775."
    reactions:
      - { label: "VWAP dnia", price: 80552 }
      - { label: "Otwarcie Londynu", price: 80650 }
      - { label: "POC wczoraj", price: 80740 }
    evidence: "Powrót do VWAP w laboratorium: n 171, 35% wobec losowej 43%, wypada gorzej niż przypadek, więc to tylko wskazówka."
---
## Co się stało

Tydzień otworzył się w poniedziałek na 82 078, w środę dotknął szczytu 84 850, a potem oddał wszystko i jeszcze trochę. Dołek tygodnia to 79 184, czyli PDL z soboty. W niedzielę wieczorem BTC stoi na 80 640, 1,77% pod otwarciem tygodnia. Dla porównania poprzedni tydzień miał szczyt 84 315, dołek 79 732 i zamknął się na 82 079, więc w tym tygodniu przebiliśmy oba ekstrema, a zamykamy niżej.

Niedziela była spokojna. Szczyt doby 81 014 padł o 04:15, dołek 80 051 o 10:15, a od południa cena wraca w okolice 80 600. Piątkowe CME zamknęło się przy 81 407, więc rynek kryptowalut stoi teraz 0,95% niżej. Model spodziewa się na otwarciu CME o 23:00 ceny w zakresie 68% od 80 324 do 80 933, czyli luki od −1,33% do −0,58%.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Świece dzienne od środy schodzą w dół: od 84 850 do 79 184, a weekend to konsolidacja w dolnej części zakresu tygodnia. Sobotnie zejście pod dołek poprzedniego tygodnia 79 732 nie znalazło kontynuacji, cena wróciła nad 80 000 i tam została. To bardziej nieudane wybicie dołem niż nowy trend, ale do odzyskania środka zakresu tygodnia jest daleko.

**Wartość.** Obszar wartości z 24 godzin to 80 250 do 80 775 z POC na 80 500. Cena 80 640 jest w środku. Wyjście pod VAL o 10:00 skończyło się szybkim powrotem i długim dolnym knotem na 80 051, więc ceny pod wartością zostały odrzucone. Szczyt nocy 81 014 też nie utrzymał się nad VAH.

**VWAP.** VWAP dnia stoi na 80 550 przy σ 226 dolarów, cena jest 0,4σ nad nim. Pasmo −1σ okolice 80 329 zatrzymało przecenę rano, a od popołudnia cena trzyma się nad VWAP i dwa razy testowała strefę pasma +1σ (80 775) bez zamknięcia nad nią.

**Przepływ i pozycje.** Taśma obejmuje okres od soboty 21:00, z krótką przerwą o 10:33. W tym czasie delta wynosi +296 BTC, w ostatnich 4 godzinach +463 BTC przy cenie +5 dolarów i OI +152,8 BTC, czyli nowe longi, które nie ruszyły ceny. W ostatniej godzinie cena spadła o 129 dolarów, a delta była dodatnia (+79 BTC) przy OI +104,7 BTC. Kupujący agresywnie nie przesunęli ceny, ktoś pasywnie sprzedawał w ich zlecenia. Sam rozjazd nic nie przesądza, liczy się reakcja ceny przy 80 640.

## Footprint dołka niedzieli

[[footprint]]

Świeca od 10:00 była inicjatywą sprzedających: zejście z 80 371 do 80 123, delta −274 BTC i stos pięciu nierównowag sprzedaży od 80 100 do 80 200. OI spadł o 134,9 BTC, więc to było zamykanie longów, nie nowe shorty. Kolejna świeca zrobiła dołek 80 051 przy największym wolumenie w sekwencji (371 BTC), ale mimo nierównowag sprzedaży na 80 040 i 80 060 zamknęła się wyżej, na 80 149, z deltą +58,6 BTC. To jest absorpcja: sprzedaż na samym dole nie dała postępu. Potem odbicie do 80 385 szło przy spadającym OI (−87,5 i −68,5 BTC), czyli shorty zamykały pozycje, a nie nowi kupujący budowali longi.

Linia frontu z tego miejsca to POC świecy dołka 80 100 i dawny stos sprzedaży 80 100 do 80 200, który został przejęty. Wyżej świece od 11:15 zostawiły nierównowagi sprzedaży na 80 300 do 80 340 i to tam odbicie pierwszy raz się zatrzymało. Dopóki cena jest nad 80 200, poranna sprzedaż jest odrzucona.

## Gdzie leży płynność

[[likwidacje]]

Asymetria jest wyraźna. W 1% nad ceną jest 14,7 mln USD shortów do likwidacji, w 1% pod ceną tylko 1,4 mln USD longów. Najbliższe klastry nad ceną to 81 000 (8,9 mln), 81 250 (5,8 mln) i 81 500 (15,8 mln). Pod ceną pierwsze większe skupiska są dopiero na 79 500 (28 mln) i 79 000 (23,1 mln), a największe na 78 500 (43,3 mln). Mapa obejmuje 44% otwartych pozycji, więc kwoty są zaniżone, ale proporcja zostaje.

## Kto handluje

[[przeplywy]]

Przez 24 godziny agresywni kupujący przeważyli o 6,4 mln USD (22,5 mln kupna wobec 16,1 mln sprzedaży). Prawie całość to wieloryby, 4,9 mln USD na 70 kontach, animatorzy rynku dołożyli 1,6 mln, a reszta rynku, 13 400 kont, wyszła na zero. Kontrakt jest notowany 3,0 bp pod indeksem (średnio 24 h −3,8 bp), finansowanie 0,13 bp na godzinę jest neutralne. Arkusz w ±10 bp ma 48% bidów wobec zwykłych o tej godzinie 50%.

## Zmienność i rozkład

[[scenariusze]]

Zmienność jest weekendowa: odchylenie zwrotów 5 min z 24 godzin to 6,2 bp wobec 10,5 bp w poprzednich dniach roboczych. Do poniedziałku 09:00 zakres 68% to 79 878 do 81 385, a 95% to 79 135 do 82 149. Najwięcej, 57%, przypada na środek między VAL 79 800 a VAH 81 000. Prognoza desku na 4 godziny daje medianę 80 645 i 50% w przedziale 80 373 do 80 935. Rynek HIP-4 na „BTC > 80 572” wycenia 53%, model 52%, czyli praktycznie bez różnicy.

## Struktura dnia

[[poziomy]]

Cena siedzi na otwarciu Londynu 80 650 (98% szans dotknięcia do 09:00), tuż nad VWAP 80 552 (91%) i pod wczorajszym POC 80 740 (87%). Nad nim leżą szczyt Azji 81 014 i wczorajszy VAH 81 000 (oba około 60%), shorty 81 150 (46%) i PDH 81 214 (41%). Pod ceną najbliżej jest dołek Azji 80 394 (74%). Na taśmie widać jeszcze nietkniętą strefę sprzedaży 80 740 do 80 780 i niedawną absorpcję 22,3 BTC sprzedaży przy 80 635.

## Co musiałoby się wydarzyć

[[setupy]]

Wzrostowy obraz potrzebuje zamknięcia nad 81 014 z dodatnią deltą, wtedy w zasięgu jest klaster shortów 81 150 do 81 500. Spadkowy zaczyna się od luki CME i zamknięcia pod 80 250, a pierwszym większym paliwem są longi na 79 500. Najbardziej prawdopodobna jest jednak dalsza rotacja w obszarze wartości.

## Na co patrzę dalej

Pierwsza rzecz to otwarcie CME o 23:00 i to, czy luka w okolicach −1% przyciągnie cenę w stronę 81 407, czy zostanie zignorowana. W poniedziałek o 09:00 Londyn. Tydzień ma dwa duże punkty: w środę 28.10 o 19:00 decyzja Fed (prognoza 4,00%, poprzednio 4,00%) i konferencja o 19:30, a w czwartek 29.10 o 13:30 wstępny PKB za kwartał (prognoza 3,2%, poprzednio 1,5%) i bazowy PCE m/m (prognoza 0,3%, poprzednio 0,2%). Do środy zmienność zwykle zostaje niska, potem rozkład się poszerza.

## Rzetelność modelu

W przedziałach 4 h model jest za ostrożny: przedział 90% obejmuje 99% wyników, a 60% obejmuje 82% (n 301). Dla dotknięć PDH, PDL i środka Brier wynosi 0,046 wobec 0,049 dla częstości bazowej (n 309), czyli tylko odrobinę lepiej niż sama częstość.

Prawdopodobieństwa pochodzą z modelu desku HAR + FHS z symulacją Monte Carlo, policzone o 20:00 i zapisane przed faktem w dzienniku prognoz. Następna mapa dnia w poniedziałek o 08:00, przed otwarciem Londynu.
