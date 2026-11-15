---
title: "BTC 64 738 po zejściu pod POC, VWAP dnia 64 111 z szansą 60% do 20:00"
description: "Poranny szczyt 66 088 nie utrzymał się, o 15:40 cena zeszła do 64 399. Model daje 60% na dotknięcie VWAP dnia i 55% na powrót do POC do 20:00."
date: 2026-11-15T16:00:20+01:00
type: note
section: Aktualizacja 4h
price: 64738
levels:
  - { label: "Likwidacje shortów", price: 65575, note: "8,7 mln USD, 47% dotknięcia do 20:00" }
  - { label: "Szczyt Azji", price: 65574, note: "47% dotknięcia do 20:00" }
  - { label: "POC wczoraj", price: 65392, note: "55% dotknięcia do 20:00" }
  - { label: "Likwidacje shortów", price: 65375, note: "3,4 mln USD, 56% dotknięcia do 20:00" }
  - { label: "Likwidacje longów", price: 64275, note: "3,8 mln USD, 71% dotknięcia do 20:00" }
  - { label: "VWAP dnia", price: 64111, note: "60% dotknięcia do 20:00" }
  - { label: "Otwarcie Londynu", price: 63997, note: "54% dotknięcia do 20:00" }
  - { label: "Likwidacje longów", price: 63825, note: "4,3 mln USD, 45% dotknięcia do 20:00" }
  - { label: "Likwidacje longów", price: 63775, note: "3,9 mln USD, 42% dotknięcia do 20:00" }
scenarios:
  - label: "Cena o 20:00 poniżej 64 110"
    probability: 30
    note: "Sprzedający musieliby dokończyć ruch z 15:25 i przebić klaster likwidacji longów pod ceną, a potem utrzymać się pod VWAP dnia."
  - label: "Cena o 20:00 między 64 110 a 65 380"
    probability: 41
    note: "Najbardziej prawdopodobne w cienkim weekendzie: cena zostaje między VWAP dnia a POC, bez nowego impulsu z żadnej strony."
  - label: "Cena o 20:00 powyżej 65 380"
    probability: 29
    note: "Potrzebny powrót nad POC i klaster likwidacji shortów, najlepiej z open interest rosnącym razem z ceną."
---
Rano cena doszła do 66 088 o 10:10, przy likwidacjach shortów 11,88 mln USD o 10:00, ale wyżej już nie poszła. Przez większość dnia stała pod tym szczytem, a o 15:25 jedna świeca zabrała ją pod POC i VWAP +1σ. Dołek 64 399 wypadł o 15:40. Weekend ma cienką płynność, więc takie zejścia idą szybko. Luka do piątkowego zamknięcia CME 68 362 wynosi już 5,30%.

[[wykres]]

W ostatniej godzinie cena straciła 694 USD przy delcie −1 724 BTC, a open interest spadł o 1 931 BTC, więc spadek niosło zamykanie longów i likwidacje, a nie nowe shorty. Dołek 64 399 zatrzymał się tuż nad likwidacjami longów 64 275, a odbicie nie wróciło nad POC 65 392. Cena stoi 0,6σ nad VWAP dnia 64 111, a obraz zmieni dopiero powrót nad POC z rosnącym open interest albo zejście pod VWAP.

Do 20:00 model daje 71% na dotknięcie 64 275, 60% na VWAP dnia 64 111 i 55% na POC 65 392.

Prawdopodobieństwa liczy model desku HAR + FHS metodą Monte Carlo o 16:00 i są zapisane przed faktem. Następny wpis to mapa tygodnia o 20:00.
