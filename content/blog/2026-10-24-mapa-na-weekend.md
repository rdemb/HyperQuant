---
title: "Weekend po zrzucie 58,5 mln USD longów. BTC na 80 505, luka CME 1,17% wyżej"
description: "BTC-PERP odbił do 80 505 po sobotnim zrzucie longów. Nad ceną leży 9,4 mln USD shortów w zasięgu 1%, a piątkowe zamknięcie CME to 81 407. Poziomy i szanse do niedzieli 10:00."
date: 2026-10-24T22:00:20+02:00
type: article
section: Mapa na weekend
price: 80505
levels:
  - { label: "POC wczoraj", price: 81611, note: "18% dotknięcia do 10:00" }
  - { label: "Likwidacje shortów", price: 81350, note: "2,2 mln USD, 30% dotknięcia do 10:00" }
  - { label: "VAL wczoraj", price: 81303, note: "32% dotknięcia do 10:00" }
  - { label: "Szczyt Azji", price: 81214, note: "38% dotknięcia do 10:00" }
  - { label: "Likwidacje shortów", price: 81150, note: "3,4 mln USD, 43% dotknięcia do 10:00" }
  - { label: "Otwarcie Londynu", price: 80774, note: "74% dotknięcia do 10:00" }
  - { label: "Dołek Azji", price: 80592, note: "91% dotknięcia do 10:00" }
  - { label: "PDL", price: 80500, note: "99% dotknięcia do 10:00" }
  - { label: "VWAP dnia", price: 80147, note: "64% dotknięcia do 10:00" }
scenarios:
  - label: "Cena w niedzielę o 10:00 poniżej 80 150"
    probability: 33
    note: "Odbicie musiałoby wygasnąć, a cena wrócić pod VWAP dnia. Wtedy w zasięgu jest 80 000 i dalej gęsty klaster longów przy 79 000."
  - label: "Cena w niedzielę o 10:00 między 80 150 a 81 150"
    probability: 46
    note: "Spokojna noc w pasie między VWAP dnia a pierwszym skupiskiem shortów. Cienki weekendowy arkusz bez nowego impulsu zwykle tak wygląda."
  - label: "Cena w niedzielę o 10:00 powyżej 81 150"
    probability: 21
    note: "Kupujący musieliby przejść otwarcie Londynu 80 774 i 81 000, a likwidacje shortów przy 81 150 dołożyć paliwa w stronę luki CME na 81 407."
summary:
  - "Ostatnie 24 h zlikwidowały 59,3 mln USD pozycji, z czego 58,5 mln to longi, a cena odbiła do 80 505."
  - "Od 18:00 kupujący biorcy mają przewagę: CVD +674 BTC przy OI −0,10%, więc odbicie niosło raczej zamykanie shortów niż nowe pozycje."
  - "Piątkowe zamknięcie CME było na 81 407, cena jest 1,17% niżej, a szansa dotknięcia 81 150 do 10:00 to 43%."
  - "Model daje 68% na cenę między 79 682 a 81 337 w niedzielę o 10:00."
metrics:
  - { label: "Premia perp", value: "−3,4 bp", bias: down, note: "średnio 24 h −1,9 bp, kontrakt głębiej pod indeksem niż w ciągu doby" }
  - { label: "Funding", value: "0,13 bp/h", bias: flat, note: "średnio 24 h 0,12 bp/h, poziom bazowy" }
  - { label: "Przepływ agresorów 24 h", value: "−158,0 mln USD", bias: down, note: "kupno biorców 334,9, sprzedaż 492,9 mln USD" }
  - { label: "Likwidacje 24 h", value: "59,3 mln USD", note: "longi 58,5, shorty 0,8 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "2,5 mln USD", note: "do likwidacji między 79 700 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "9,4 mln USD", note: "do likwidacji między ceną a 81 310" }
  - { label: "Arkusz ±10 bp: bidy", value: "51% bidów", bias: flat, note: "zwykle o tej godzinie 52% (3 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "9,6 bp", note: "poprzednie dni robocze (4): 10,6 bp" }
liquidations:
  step: 250
  coverage: 44
  shorts: [[84000, 2.9], [83750, 1.7], [83500, 3.2], [83250, 1], [83000, 1.5], [82750, 2.2], [82500, 2.1], [82250, 0.6], [82000, 1.7], [81750, 12.2], [81500, 2.2], [81250, 3.7], [81000, 4.2], [80750, 0.8], [80500, 2.1]]
  longs: [[80250, 0.2], [80000, 0.6], [79750, 1.1], [79500, 5.4], [79250, 8.4], [79000, 42.8], [78750, 17], [78500, 39.4], [78250, 13.9], [78000, 13.1], [77750, 4.3], [77500, 11.3], [77250, 9.3], [77000, 50.3], [76750, 2.6]]
  note: "Mapa z 21:58, cena wtedy 80 479; pokrycie 44% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: -106.1, note: "110 kont" }
    - { label: "Reszta rynku", value: -38.3, note: "24 260 kont" }
    - { label: "Animatorzy rynku", value: -13.6, note: "190 kont" }
setups:
  - name: "Dalsze odbicie przez skupisko shortów w stronę luki CME"
    bias: up
    zone: [81000, 81250]
    window: "do 10:00 w niedzielę"
    triggers:
      - "Cena utrzymuje się nad dołkiem Azji 80 592 i wraca nad otwarcie Londynu 80 774."
      - "CVD dalej rośnie, a premia perp wraca w stronę średniej z doby."
      - "Przebicie 81 150 uruchamia likwidacje shortów z klastra 81 000 do 81 250."
    invalidation: "Zamknięcie świecy 1 h pod VWAP dnia 80 147."
    reactions:
      - { label: "Szczyt Azji", price: 81214 }
      - { label: "VAL wczoraj", price: 81303 }
      - { label: "Likwidacje shortów", price: 81350 }
      - { label: "POC wczoraj", price: 81611 }
    evidence: "Hipoteza domykania luki CME ma w laboratorium tylko 20 przypadków i częstość 50% wobec losowej 50%, czyli na razie nic nie mówi."
  - name: "Wygaśnięcie odbicia i powrót do klastra longów pod 80 000"
    bias: down
    zone: [79000, 79500]
    window: "do 10:00 w niedzielę"
    triggers:
      - "Cena traci PDL 80 500 i dołek Azji, a CVD od 18:00 przestaje rosnąć."
      - "Zamknięcie świecy 1 h pod VWAP dnia 80 147."
      - "Przebicie 80 000 bez wyraźnego wchłaniania sprzedaży."
    invalidation: "Zamknięcie świecy 1 h z powrotem nad otwarciem Londynu 80 774."
    reactions:
      - { label: "VWAP dnia", price: 80147 }
      - { label: "Likwidacje longów", price: 80000 }
      - { label: "Likwidacje longów", price: 79250 }
      - { label: "Likwidacje longów", price: 79000 }
    evidence: "Odbicia od okrągłych poziomów w laboratorium: n 308, częstość 52% wobec losowej 49%, czyli szum."
  - name: "Noc w pasie między VWAP dnia a otwarciem Londynu"
    bias: flat
    zone: [80147, 80774]
    window: "do 10:00 w niedzielę"
    triggers:
      - "Cena oscyluje wokół PDL 80 500 bez zamknięć poza VWAP dnia i otwarciem Londynu."
      - "Zmienność 5 min zostaje poniżej 9,6 bp z ostatniej doby."
    invalidation: "Zamknięcie świecy 1 h poza pasem 80 147 do 80 774."
    reactions:
      - { label: "Dołek Azji", price: 80592 }
      - { label: "PDL", price: 80500 }
      - { label: "VWAP dnia", price: 80147 }
---
## Co się stało

Piątek na CME zamknął się przy 81 407 i od tego czasu rynek szedł w dół. Sobotnie popołudnie przyniosło gwałtowny zjazd, który w ciągu doby wyczyścił 59,3 mln USD pozycji z ceną likwidacji, z czego aż 58,5 mln to longi. Po tym zrzucie cena odbiła i o 22:00 stoi na 80 505, czyli praktycznie na wczorajszym dołku 80 500 i 1,17% pod piątkowym zamknięciem CME.

Od 18:00 przewagę mają kupujący biorcy: CVD +674 BTC, kupno to 55% obrotu przy wolumenie 6351 BTC. Otwarte pozycje spadły przy tym o 0,10%, gdy cena urosła o 0,90%. Takie odbicie częściej niesie zamykanie shortów niż nowe pieniądze.

## Gdzie leży płynność

[[likwidacje]]

Obraz odwrócił się względem rana. Longi tuż pod ceną zostały w dużej części wyczyszczone, w zasięgu 1% w dół zostało ich tylko 2,5 mln USD. Duże skupiska są dopiero niżej: 42,8 mln przy 79 000 i 39,4 mln przy 78 500. Nad ceną w zasięgu 1% leży 9,4 mln USD shortów, a pierwsze większe skupisko to 12,2 mln przy 81 750. Mapa obejmuje 44% otwartych pozycji, więc kwoty są zaniżone, ale proporcje dobrze pokazują, gdzie jest paliwo.

## Kto handluje

[[przeplywy]]

W ciągu doby biorcy sprzedali netto za 158,0 mln USD. Najwięcej dołożyły wieloryby, 106,1 mln po stronie sprzedaży przy 110 kontach. Reszta rynku to 38,3 mln, animatorzy 13,6 mln. Kontrakt jest notowany 3,4 bp pod indeksem, głębiej niż średnio w dobie (−1,9 bp), a finansowanie stoi na bazowych 0,13 bp/h. Longi płacą tylko stawkę bazową, bez śladu przegrzania w żadną stronę.

## Zmienność i rozkład

[[scenariusze]]

Do niedzieli 10:00 model daje 68% na cenę między 79 682 a 81 337, a 95% między 78 867 a 82 177. Zmienność 5 minut z ostatniej doby to 9,6 bp wobec 10,6 bp w poprzednich dniach roboczych, mimo sobotniego zjazdu. Prognoza desku na 4 godziny ma medianę 80 504 i połowę rozkładu między 80 180 a 80 853, czyli bez przechyłu. Rynek HIP-4 na „BTC powyżej 80 751” płaci 37%, model liczy 36%, więc tu nie ma rozjazdu.

## Struktura dnia

[[poziomy]]

Cena siedzi na PDL 80 500, który model uznaje za praktycznie pewny do dotknięcia (99%). Dołek Azji 80 592 ma 91%, otwarcie Londynu 80 774 ma 74%, a okrągłe 81 000 to rzut monetą, 54%. W dół VWAP dnia 80 147 ma 64%, a 80 000 ma 52%. Wszystko powyżej obszaru wartości wczoraj (VAL 81 303) to już mniej niż jedna szansa na trzy.

## Co musiałoby się wydarzyć

[[setupy]]

Żeby noc zmieniła obraz, cena musi wyjść z pasa między VWAP dnia a otwarciem Londynu. W górę kluczem jest 81 150, gdzie 3,4 mln USD shortów może dołożyć paliwa w stronę piątkowego zamknięcia CME. W dół wygaśnięcie odbicia pod 80 147 otwiera drogę do 80 000 i dalej do klastra longów przy 79 000.

## Na co patrzę dalej

Patrzę, czy CVD od 18:00 dalej rośnie, czy kupno wygasa przy stojących otwartych pozycjach. Drugi sygnał to premia perp: powrót w stronę średniej z doby oznaczałby, że sprzedaż przestaje naciskać. Trzeci to zachowanie przy 81 000 i 81 150, bo tam zaczyna się pierwsze realne paliwo nad ceną.

## Rzetelność modelu

Przedziały modelu są raczej za szerokie niż za wąskie: w horyzoncie 4 godzin przedział 90% objął cenę w 99% przypadków, a przedział 60% w 83% (n 209). Prognozy dotknięć PDH, PDL i środka dnia mają Brier 0,037 wobec 0,038 dla częstości bazowej (n 217), czyli są lepsze od niej tylko symbolicznie.

Prawdopodobieństwa pochodzą z modelu desku (HAR + FHS) i symulacji Monte Carlo, policzone o 22:00 i zapisane przed faktem. Następny wpis to aktualizacja w niedzielę o 10:00, a mapa tygodnia w niedzielę o 20:00.
