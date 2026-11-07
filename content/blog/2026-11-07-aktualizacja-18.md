---
title: "BTC 75 722 po zejściu do 75 567, dołek Azji pękł, VWAP dnia ma 61%"
description: "Sobotnie popołudnie zdjęło dołek Azji i POC, knot zszedł do 75 567. Do 22:00 model daje 61% na powrót do VWAP dnia 75 881 i 21% na VAL 75 392."
date: 2026-11-07T18:00:25+01:00
type: note
section: Aktualizacja 4h
price: 75722
levels:
  - { label: "PDH", price: 76400, note: "2% dotknięcia do 22:00" }
  - { label: "Szczyt Azji", price: 76100, note: "22% dotknięcia do 22:00" }
  - { label: "Otwarcie Londynu", price: 76075, note: "25% dotknięcia do 22:00" }
  - { label: "VAH wczoraj", price: 76038, note: "30% dotknięcia do 22:00" }
  - { label: "VWAP dnia", price: 75881, note: "61% dotknięcia do 22:00" }
  - { label: "Dołek Azji", price: 75769, note: "93% dotknięcia do 22:00" }
  - { label: "POC wczoraj", price: 75753, note: "98% dotknięcia do 22:00" }
  - { label: "VAL wczoraj", price: 75392, note: "21% dotknięcia do 22:00" }
  - { label: "PDL", price: 74842, note: "0% dotknięcia do 22:00" }
scenarios:
  - label: "Cena o 22:00 poniżej 75 390"
    probability: 10
    note: "Potrzebny drugi zrzut jak ten z 16:45, tym razem z zamknięciem pod knotem 75 567 i zejściem przez VAL wczoraj."
  - label: "Cena o 22:00 między 75 390 a 75 880"
    probability: 58
    note: "Cena zostaje pod VWAP dnia i krąży wokół dołka Azji i POC wczoraj, co przy cienkiej weekendowej płynności jest najprostszą drogą."
  - label: "Cena o 22:00 powyżej 75 880"
    probability: 32
    note: "Wymaga odzyskania VWAP dnia 75 881, najlepiej z open interest rosnącym razem z ceną, a nie samym zamykaniem shortów."
---
Od mapy z 14:00 cena najpierw sprawdziła dolne pasmo VWAP o 14:11, a o 14:46 wróciła do samego VWAP dnia przy 75 956, ale tam się zatrzymała. Po 16:30 zeszła na dołek Azji 75 769 (16:34) i POC wczoraj 75 753 (16:35), a o 16:45 jedna świeca z deltą −545 BTC wybiła knot do 75 567. W weekend płynność jest cienka i takie zrzuty idą szybciej niż w tygodniu.

[[wykres]]

W ostatnich 4 godzinach cena straciła 155 USD przy delcie −311 BTC, a open interest spadł w tym czasie o 648 BTC, więc spadek niosło zamykanie longów, a nie nowe shorty. Po knocie do 75 567 z 16:45 cena odbiła o 16:55, ale żadna świeca nie zamknęła się nad dołkiem Azji 75 769 i od tamtej pory cena krąży tuż pod nim. Stoi 1,09σ pod VWAP dnia 75 881, a obraz zmieni dopiero powrót nad VWAP z rosnącym open interest.

Na 22:00 model daje 61% na powrót do VWAP dnia 75 881 i 21% na VAL wczoraj 75 392, a szczyt Azji 76 100 spadł z 67% do 22%.

Prawdopodobieństwa pochodzą z modelu zmienności HAR + FHS z symulacją Monte Carlo, policzone o 18:00 i zapisane przed faktem. Następny wpis to mapa na weekend o 22:00.
