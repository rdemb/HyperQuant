---
title: "BTC wraca nad 77 000, szczyt Azji 77 306 ma 77% szans do 16:00"
description: "Po porannym dołku cena odrobiła VWAP, VAL i 77 000. Model daje 77% na dotknięcie szczytu Azji 77 306 i 39% na klaster likwidacji shortów 77 750 do 16:00."
date: 2026-11-03T12:00:20+01:00
type: note
section: Aktualizacja 4h
price: 77101
levels:
  - { label: "POC wczoraj", price: 78109, note: "20% dotknięcia do 16:00" }
  - { label: "Likwidacje shortów", price: 77750, note: "4,6 mln USD, 39% dotknięcia do 16:00" }
  - { label: "Likwidacje shortów", price: 77650, note: "3,5 mln USD, 46% dotknięcia do 16:00" }
  - { label: "Szczyt Azji", price: 77306, note: "77% dotknięcia do 16:00" }
  - { label: "VAL wczoraj", price: 77026, note: "93% dotknięcia do 16:00" }
  - { label: "VWAP dnia", price: 76813, note: "71% dotknięcia do 16:00" }
  - { label: "Otwarcie Londynu", price: 76804, note: "70% dotknięcia do 16:00" }
  - { label: "PDL", price: 76670, note: "57% dotknięcia do 16:00" }
  - { label: "Dołek Azji", price: 76342, note: "31% dotknięcia do 16:00" }
scenarios:
  - label: "Cena o 16:00 poniżej 76 810"
    probability: 35
    note: "Cena musiałaby oddać cały ruch z przedpołudnia i zejść z powrotem pod VWAP dnia, a z nim pod otwarcie Londynu 76 804."
  - label: "Cena o 16:00 między 76 810 a 77 650"
    probability: 40
    note: "Najczęstszy wynik w modelu: rynek krąży między VWAP dnia a szczytem Azji 77 306, bez dojścia do pierwszego klastra likwidacji shortów."
  - label: "Cena o 16:00 powyżej 77 650"
    probability: 25
    note: "Potrzebne wybicie nad szczyt Azji 77 306 i wejście w klaster likwidacji shortów 3,5 mln USD na 77 650."
---
Rano rynek najpierw zszedł w dół i o 08:13 dotknął VWAP −1σ 76 567, a o 08:19 wczorajszego dołka 76 670. Potem przyszło odbicie: VWAP dnia o 08:29, okrągłe 77 000 o 10:37, VAL wczoraj 77 026 o 10:38 i VWAP +1σ o 11:00. Od 08:00 CVD wynosi +264 BTC, kupno ma 54% obrotu, a open interest spadł o 1,12% przy cenie wyższej o 0,69%.

[[wykres]]

W ostatnich 4 godzinach cena zyskała 544 USD przy delcie +234 BTC, ale open interest spadł w tym czasie o 451 BTC, więc wzrost niosło zamykanie shortów, a nie nowe longi. Cena przebiła VAL 77 026 i doszła do 77 126 o 11:55, a następny poziom nad nią to szczyt Azji 77 306. Ostatnia godzina to delta −28 BTC i cena 1,25σ nad VWAP dnia 76 813, więc impuls słabnie, a obraz zmieni dopiero open interest rosnący razem z ceną albo powrót pod VAL.

Na dziś do 16:00 model daje 77% na dotknięcie szczytu Azji 77 306 i 39% na klaster likwidacji shortów 77 750, a w dół 57% na wczorajszy dołek 76 670. Prawdopodobieństwa pochodzą z modelu desku HAR + FHS z symulacją Monte Carlo, policzone o 12:00 i zapisane przed faktem. Następny wpis to rozliczenie Londynu o 13:05.
