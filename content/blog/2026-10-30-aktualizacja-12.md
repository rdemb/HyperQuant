---
title: "BTC 77 807 po zjeździe przez PDL, 95% na powrót do 77 856 do 16:00"
description: "Od porannej mapy cena zeszła przez VAL, 78 000, PDL i VWAP dnia do 77 304. Model daje 95% na dotknięcie PDL 77 856 i 84% na VWAP do 16:00."
date: 2026-10-30T12:00:20+01:00
type: note
section: Aktualizacja 4h
price: 77807
levels:
  - { label: "POC wczoraj", price: 78995, note: "28% dotknięcia do 16:00" }
  - { label: "Likwidacje shortów", price: 78950, note: "26,8 mln USD, 29% dotknięcia do 16:00" }
  - { label: "Likwidacje shortów", price: 78850, note: "6,8 mln USD, 34% dotknięcia do 16:00" }
  - { label: "Szczyt Azji", price: 78772, note: "38% dotknięcia do 16:00" }
  - { label: "VAL wczoraj", price: 78156, note: "74% dotknięcia do 16:00" }
  - { label: "Otwarcie Londynu", price: 78134, note: "75% dotknięcia do 16:00" }
  - { label: "PDL", price: 77856, note: "95% dotknięcia do 16:00" }
  - { label: "VWAP dnia", price: 77556, note: "84% dotknięcia do 16:00" }
  - { label: "Dołek Azji", price: 76443, note: "23% dotknięcia do 16:00" }
scenarios:
  - label: "Cena o 16:00 poniżej 76 440"
    probability: 12
    note: "Rynek musiałby zejść pod dołek z 11:15 i pod dołek Azji 76 443, w stronę likwidacji longów przy 76 150."
  - label: "Cena o 16:00 między 76 440 a 78 770"
    probability: 69
    note: "Po zamknięciu longów cena krąży między VWAP dnia a otwarciem Londynu 78 134 i czeka na nowy impuls."
  - label: "Cena o 16:00 powyżej 78 770"
    probability: 19
    note: "Potrzebny powrót nad PDL i VAL 78 156, a potem test szczytu Azji 78 772 przy rosnącym open interest."
---
Od porannej mapy cena zjechała przez całą górną część planszy: VAL 78 156 o 8:42, 78 000 o 8:56, PDL 77 856 o 9:43, likwidacje longów przy 77 650 o 10:21 i VWAP dnia o 11:04. Od 8:00 CVD to −1235 BTC, a open interest spadł o 5,84% przy cenie niżej o 1,06%.

[[wykres]]

W ostatnich 4 godzinach cena straciła 804 USD przy delcie −1254 BTC, a open interest spadł o 2494 BTC, więc zjazd niosło zamykanie longów i likwidacje, a nie nowe shorty. Dołek 77 304 z 11:15 odbił, ostatnia godzina to +152 USD przy delcie +485 BTC i open interest niżej o 159 BTC, czyli głównie zamykanie shortów, a cena krąży tuż pod PDL 77 856. Stoi 0,46σ nad VWAP dnia 77 556, a obraz zmieniłby dopiero powrót nad PDL razem z rosnącym open interest.

Na 16:00 model daje 95% na ponowne dotknięcie PDL 77 856 i 84% na VWAP dnia 77 556. Szczyt Azji 78 772 ma już tylko 38%, dołek Azji 76 443 to 23%.

Prawdopodobieństwa pochodzą z modelu desku HAR + FHS z Monte Carlo, policzone o 12:00 i zapisane przed faktem. Następny wpis to rozliczenie Londynu o 13:05.
