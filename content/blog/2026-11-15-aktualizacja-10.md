---
title: "BTC 65 233 po nocnym zjeździe do 64 000, POC 65 392 z szansą 82% do 14:00"
description: "Noc zdjęła longi do 64 000, rano cena odbiła od VWAP dnia i stoi pod 65 325. Model daje 87% na dotknięcie tego poziomu do 14:00."
date: 2026-11-15T10:00:10+01:00
type: note
section: Aktualizacja 4h
price: 65233
levels:
  - { label: "VAH wczoraj", price: 66624, note: "14% dotknięcia do 14:00" }
  - { label: "Likwidacje shortów", price: 65625, note: "8,1 mln USD, 63% dotknięcia do 14:00" }
  - { label: "Szczyt Azji", price: 65574, note: "67% dotknięcia do 14:00" }
  - { label: "Likwidacje shortów", price: 65525, note: "5,1 mln USD, 71% dotknięcia do 14:00" }
  - { label: "POC wczoraj", price: 65392, note: "82% dotknięcia do 14:00" }
  - { label: "Likwidacje shortów", price: 65325, note: "5,0 mln USD, 87% dotknięcia do 14:00" }
  - { label: "Otwarcie Londynu", price: 63997, note: "24% dotknięcia do 14:00" }
  - { label: "VWAP dnia", price: 63814, note: "17% dotknięcia do 14:00" }
  - { label: "Likwidacje longów", price: 63725, note: "1,2 mln USD, 15% dotknięcia do 14:00" }
scenarios:
  - label: "Cena o 14:00 poniżej 64 000"
    probability: 13
    note: "Poranne odbicie musiałoby się w całości cofnąć, a cena zejść z powrotem pod otwarcie Londynu w stronę VWAP dnia."
  - label: "Cena o 14:00 między 64 000 a 65 570"
    probability: 54
    note: "Najbardziej prawdopodobne: cena zbiera płynność przy 65 325 i POC, ale nie przechodzi trwale nad szczyt Azji."
  - label: "Cena o 14:00 powyżej 65 570"
    probability: 33
    note: "Wymaga, żeby nowe pozycje dalej rosły razem z ceną i zdjęły shorty z 65 525 i 65 625."
---
Od sobotniej mapy z 22:00 noc była gwałtowna. Między 22:02 a 22:18 cena przeszła przez strefy likwidacji longów 64 575, 64 425 i 64 125 aż do 64 000, a o 03:59 i 04:01 wróciła na 65 000 i 65 300. Rano przyszedł drugi zjazd, a ostatnia godzina go odrobiła, więc cena jest o 0,48% wyżej niż przy poprzedniej aktualizacji. Piątkowe zamknięcie CME było przy 68 362, luka w górę to 4,58%.

[[wykres]]

W ostatniej godzinie cena zyskała 1 236 USD przy delcie +2 046 BTC, a open interest urósł w tym czasie o 1 355 BTC, więc wzrost niosły nowe longi, a nie samo zamykanie shortów. Dołek 63 738 z 08:50 wypadł chwilę pod VWAP dnia i stamtąd cena wróciła, teraz stoi tuż pod strefą likwidacji shortów 65 325 i POC 65 392. Cena jest 1,5σ nad VWAP dnia 63 814, a obraz zmieni dopiero wyjście nad nocny szczyt 65 644 albo powrót pod 64 000.

Do 14:00 model daje 87% na dotknięcie 65 325 i 82% na POC 65 392, w dół 24% na 63 997. Rozkład na 14:00: 54% między 64 000 a 65 570, 33% wyżej, 13% niżej. W niedzielę płynność jest cieńsza, więc ruchy bywają szarpane.

Prawdopodobieństwa pochodzą z modelu desku HAR + FHS i symulacji Monte Carlo, policzone o 10:00 i zapisane przed faktem. Następna aktualizacja o 16:00.
