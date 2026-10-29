---
title: "Otwarcie Londynu: BTC odzyskał 80 000, VWAP dnia 80 122 z szansą 75%"
description: "BTC 79 992 po pierwszych 15 minutach Londynu. Poziom 80 000 dotknięty o 09:10, VWAP dnia 80 122 ma 75% szans na dotknięcie do 13:00."
date: 2026-10-29T09:15:20+01:00
type: note
section: Otwarcie Londynu
price: 79992
levels:
  - { label: "POC wczoraj", price: 81160, note: "1% dotknięcia do 13:00" }
  - { label: "Likwidacje shortów", price: 80850, note: "29,9 mln USD, 5% dotknięcia do 13:00" }
  - { label: "VAL wczoraj", price: 80606, note: "15% dotknięcia do 13:00" }
  - { label: "PDL", price: 80362, note: "38% dotknięcia do 13:00" }
  - { label: "VWAP dnia", price: 80122, note: "75% dotknięcia do 13:00" }
  - { label: "Otwarcie Londynu", price: 79826, note: "68% dotknięcia do 13:00" }
  - { label: "Dołek Azji", price: 79668, note: "42% dotknięcia do 13:00" }
  - { label: "Likwidacje longów", price: 79550, note: "10,8 mln USD, 28% dotknięcia do 13:00" }
  - { label: "Likwidacje longów", price: 78950, note: "27,5 mln USD, 2% dotknięcia do 13:00" }
scenarios:
  - label: "Cena o 13:00 poniżej 79 830"
    probability: 34
    note: "Kupujący z otwarcia muszą odpuścić, a cena wrócić pod otwarcie Londynu 79 826. Wtedy następny w kolejce jest dołek Azji 79 668."
  - label: "Cena o 13:00 między 79 830 a 80 360"
    probability: 46
    note: "Najbardziej prawdopodobny wariant: krążenie wokół 80 000 i VWAP dnia 80 122, bez siły na powrót nad wczorajszy dołek."
  - label: "Cena o 13:00 powyżej 80 360"
    probability: 20
    note: "Potrzebny dalszy napływ kupna i odzyskanie wczorajszego dołka 80 362, a nad nim otwiera się droga do VAL 80 606."
---
Pierwsze 15 minut Londynu zaczęło się od kupujących. Od 09:00 CVD wzrósł o 38 BTC, kupno to 67% obrotu przy wolumenie 116 BTC, a open interest dodał 0,07% przy cenie wyżej o 0,21%. Okrągłe 80 000 z porannej mapy padło o 09:10, reszta poziomów stoi nietknięta.

[[wykres]]

W ostatnich 4 godzinach cena zyskała 139 USD przy delcie −18 BTC, a open interest spadł o 284 BTC, więc odbicie niosło głównie zamykanie shortów, a nie nowe longi. Dla ostatniej godziny taśma ma lukę w open interest, wiadomo tylko, że delta wyniosła +130 BTC przy cenie wyżej o 123 USD. Dołek z 03:45 na 79 667 wypadł dokładnie na dołku Azji 79 668 i od tamtej pory cena trzyma się nad nim, teraz 0,34σ pod VWAP dnia 80 122, więc obraz zmieni dopiero powrót nad VWAP z rosnącym open interest.

Świeże szanse do 13:00: VWAP dnia 80 122 ma 75%, otwarcie Londynu 79 826 ma 68%, wczorajszy dołek 80 362 już tylko 38% (rano 45%). Zakres 68% na 13:00 to 79 558 do 80 427.

Prawdopodobieństwa pochodzą z modelu desku HAR + FHS z symulacją Monte Carlo, policzone o 09:15 i zapisane przed faktem. Następna aktualizacja o 12:00.
