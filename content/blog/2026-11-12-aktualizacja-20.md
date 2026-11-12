---
title: "BTC 71 735 po zjeździe w NY, model daje 33% na powrót do VWAP 72 359"
description: "BTC o 20:00 na 71 735, 0,82σ pod VWAP dnia. Do północy model daje 31% na dotknięcie 71 150 i 33% na powrót do 72 359."
date: 2026-11-12T20:00:09+01:00
type: note
section: Aktualizacja 4h
price: 71735
levels:
  - { label: "Otwarcie Londynu", price: 73623, note: "0% dotknięcia do 00:00" }
  - { label: "VAL wczoraj", price: 73519, note: "1% dotknięcia do 00:00" }
  - { label: "Dołek Azji", price: 73379, note: "1% dotknięcia do 00:00" }
  - { label: "Likwidacje shortów", price: 73250, note: "1,8 mln USD, 2% dotknięcia do 00:00" }
  - { label: "PDL", price: 73174, note: "3% dotknięcia do 00:00" }
  - { label: "Likwidacje shortów", price: 72550, note: "1,5 mln USD, 19% dotknięcia do 00:00" }
  - { label: "VWAP dnia", price: 72359, note: "33% dotknięcia do 00:00" }
  - { label: "Likwidacje longów", price: 71150, note: "21,3 mln USD, 31% dotknięcia do 00:00" }
  - { label: "Likwidacje longów", price: 70550, note: "33,4 mln USD, 6% dotknięcia do 00:00" }
scenarios:
  - label: "Cena w piątek o 00:00 poniżej 71 150"
    probability: 17
    note: "Trzeba zejść pod dzisiejszy dołek 71 227 i wejść w klaster likwidacji longów 21,3 mln USD, który mógłby przyspieszyć ruch."
  - label: "Cena w piątek o 00:00 między 71 150 a 72 360"
    probability: 67
    note: "Wieczór w obecnym przedziale: cena zostaje pod VWAP dnia, a dołek z 16:00 trzyma."
  - label: "Cena w piątek o 00:00 powyżej 72 360"
    probability: 16
    note: "Potrzebny powrót nad VWAP dnia, najlepiej przy rosnącym open interest, a nie tylko na zamykaniu shortów."
---
Od mapy z 14:50 zjazd zabrał wszystkie poziomy pod ceną: likwidacje longów 72 550 o 14:51, VWAP −2σ 72 142 o 15:11, a okrągłe 72 000 i klaster likwidacji longów 71 950 o 15:21. Dołek 71 227 przyszedł o 16:00, tuż nad kolejnym klastrem 71 150, i od tamtej pory BTC chodzi w wąskim przedziale, teraz 71 735.

[[wykres]]

W ostatnich czterech godzinach cena zyskała 124 USD przy delcie +1 237 BTC, ale open interest spadł o 311 BTC, więc odbicie od dołka niosło zamykanie shortów, a nie nowe longi. Ostatnia godzina to spadek o 161 USD przy delcie −842 BTC i open interest niższym o 331 BTC, czyli zamykanie longów, a od 16:00 żadna świeca nie dosięgła VWAP dnia 72 359. Cena stoi 0,82σ pod nim i dopiero powrót nad VWAP przy rosnącym open interest zmieniłby obraz.

Do północy model daje 31% na dotknięcie klastra 71 150 i 33% na powrót do VWAP 72 359, a najbardziej prawdopodobne zamknięcie dnia to przedział 71 150 do 72 360 (67%).

Prawdopodobieństwa pochodzą z modelu desku HAR + FHS z symulacją Monte Carlo, policzone o 20:00 i zapisane przed faktem. Następny wpis to podsumowanie dnia o 22:05.
