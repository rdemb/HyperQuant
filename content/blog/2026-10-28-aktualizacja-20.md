---
title: "BTC 81 003 po wyjściu nad PDH 81 281 i powrocie pod niego"
description: "BTC przy 81 003 o 20:00. Wieczorem cena dotknęła PDH 81 281, cofnęła się nad VWAP dnia, a model daje 57% na ponowne dotknięcie PDH do północy."
date: 2026-10-28T20:00:23+01:00
type: note
section: Aktualizacja 4h
price: 81003
levels:
  - { label: "Likwidacje shortów", price: 81850, note: "19,5 mln USD, 11% dotknięcia do 00:00" }
  - { label: "Likwidacje shortów", price: 81750, note: "11,3 mln USD, 15% dotknięcia do 00:00" }
  - { label: "PDH", price: 81281, note: "57% dotknięcia do 00:00" }
  - { label: "Szczyt Azji", price: 81205, note: "67% dotknięcia do 00:00" }
  - { label: "Otwarcie Londynu", price: 81056, note: "91% dotknięcia do 00:00" }
  - { label: "VWAP dnia", price: 80915, note: "90% dotknięcia do 00:00" }
  - { label: "Dołek Azji", price: 80573, note: "44% dotknięcia do 00:00" }
  - { label: "VAH wczoraj", price: 80560, note: "42% dotknięcia do 00:00" }
  - { label: "POC wczoraj", price: 80260, note: "17% dotknięcia do 00:00" }
scenarios:
  - label: "Cena w czwartek o 00:00 poniżej 80 570"
    probability: 23
    note: "Potrzebny powrót pod VWAP dnia i dalej pod dołek Azji, czyli oddanie całego wieczornego odbicia."
  - label: "Cena w czwartek o 00:00 między 80 570 a 81 210"
    probability: 44
    note: "Najbardziej prawdopodobne: cena zostaje w paśmie między dołkiem a szczytem Azji, wokół VWAP dnia."
  - label: "Cena w czwartek o 00:00 powyżej 81 210"
    probability: 33
    note: "Wymaga utrzymania się nad szczytem Azji, a nie tylko kolejnego wybicia z szybkim powrotem."
---
Po mapie z 13:50 rynek najpierw zszedł w dół: o 14:30 dotknął dołka Azji 80 573 i VAH 80 560, a o 14:48 VWAP −2σ przy 80 404. Wieczorem odwrócił się mocno. O 19:02 odzyskał 81 000 i otwarcie Londynu 81 056, a o 19:36 dotknął szczytu Azji 81 205 i PDH 81 281.

[[wykres]]

W ostatniej godzinie cena zyskała 171 USD przy delcie +1154 BTC, a open interest urósł o 1719 BTC, więc ruch niosły nowe longi, a nie samo zamykanie shortów. Szczyt 81 325 z 19:35 wyszedł tylko na chwilę nad PDH 81 281 i cena wróciła pod niego. Teraz stoi 0,28σ nad VWAP dnia 80 915, więc obraz zmieni dopiero utrzymanie się nad PDH albo zejście z powrotem pod VWAP.

Do północy model daje 57% na ponowne dotknięcie PDH 81 281 i 44% na powrót do dołka Azji 80 573. Prawdopodobieństwa pochodzą z modelu desku HAR + FHS i symulacji Monte Carlo, policzone o 20:00 i zapisane przed faktem. Następny wpis to podsumowanie dnia o 21:05.
