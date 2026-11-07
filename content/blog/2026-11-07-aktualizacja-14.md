---
title: "BTC 75 876 pod VWAP dnia, 83% na dołek Azji 75 769 do 18:00"
description: "Cena zeszła ze szczytu 76 235 do 75 876 przy spadającym open interest. Model daje 89% na powrót do VWAP 75 956 i 83% na dołek Azji do 18:00."
date: 2026-11-07T14:00:22+01:00
type: note
section: Aktualizacja 4h
price: 75876
levels:
  - { label: "PDH", price: 76400, note: "32% dotknięcia do 18:00" }
  - { label: "Szczyt Azji", price: 76100, note: "67% dotknięcia do 18:00" }
  - { label: "Otwarcie Londynu", price: 76075, note: "71% dotknięcia do 18:00" }
  - { label: "VAH wczoraj", price: 76038, note: "76% dotknięcia do 18:00" }
  - { label: "VWAP dnia", price: 75956, note: "89% dotknięcia do 18:00" }
  - { label: "Dołek Azji", price: 75769, note: "83% dotknięcia do 18:00" }
  - { label: "POC wczoraj", price: 75753, note: "81% dotknięcia do 18:00" }
  - { label: "VAL wczoraj", price: 75392, note: "35% dotknięcia do 18:00" }
  - { label: "Likwidacje longów", price: 75150, note: "9,6 mln USD, 16% dotknięcia do 18:00" }
scenarios:
  - label: "Cena o 18:00 poniżej 75 390"
    probability: 17
    note: "Zamykanie longów musiałoby przyspieszyć, przebić dołek Azji i POC wczoraj, a potem zejść pod VAL w stronę skupiska likwidacji longów."
  - label: "Cena o 18:00 między 75 390 a 76 080"
    probability: 47
    note: "Weekendowe krążenie wokół VWAP dnia, bez wyjścia nad otwarcie Londynu i bez zejścia pod VAL wczoraj."
  - label: "Cena o 18:00 powyżej 76 080"
    probability: 36
    note: "Powrót nad VWAP dnia i otwarcie Londynu, najlepiej z open interest rosnącym razem z ceną, a nie tylko z kryciem shortów."
---
Sobotni ranek stał nad 76 000. Szczyt Azji 76 100 cena dotknęła o 8:55, a szczyt dnia 76 235 zrobiła o 10:00. Od tamtej pory rynek oddaje: o 11:25 pierwsze zamknięcie pod VWAP dnia, a o 13:40 dołek 75 806. Teraz 75 876. Weekend to cieńsza płynność, więc pojedyncze świece ruszają cenę mocniej niż w tygodniu.

[[wykres]]

W ostatnich 4 godzinach cena straciła 296 USD przy delcie −235 BTC, a open interest spadł o 331 BTC, więc spadek to zamykanie longów, a nie nowe shorty. Dołek 75 806 z 13:40 zatrzymał się nad dołkiem Azji 75 769, którego cena nie dotknęła, i od razu odbił. Cena stoi 0,83σ pod VWAP dnia 75 956, a obraz zmieni dopiero powrót nad VWAP z rosnącym open interest albo zejście pod dołek Azji.

Do 18:00 model daje 89% na dotknięcie VWAP dnia 75 956 i 83% na dołek Azji 75 769. Szczyt Azji 76 100 ma 67%, a VAL wczoraj 75 392 już tylko 35%.

Prawdopodobieństwa pochodzą z modelu desku HAR + FHS (Monte Carlo), policzone o 14:00 i zapisane przed faktem. Następna aktualizacja o 18:00.
