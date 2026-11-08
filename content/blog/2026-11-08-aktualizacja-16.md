---
title: "BTC 76 017 po wybiciu nad 76 000, szczyt PDH 76 235 ma 45% do 20:00"
description: "Niedziela po południu: BTC przy 76 017, nad 76 000 od 12:21. Szczyt poprzedniego dnia 76 235 ma 45% szans dotknięcia do 20:00, VWAP dnia 75 887 65%."
date: 2026-11-08T16:00:23+01:00
type: note
section: Aktualizacja 4h
price: 76017
levels:
  - { label: "PDH", price: 76235, note: "45% dotknięcia do 20:00" }
  - { label: "VAH wczoraj", price: 76038, note: "95% dotknięcia do 20:00" }
  - { label: "Szczyt Azji", price: 75984, note: "92% dotknięcia do 20:00" }
  - { label: "Otwarcie Londynu", price: 75959, note: "84% dotknięcia do 20:00" }
  - { label: "VWAP dnia", price: 75887, note: "65% dotknięcia do 20:00" }
  - { label: "POC wczoraj", price: 75867, note: "60% dotknięcia do 20:00" }
  - { label: "VAL wczoraj", price: 75696, note: "27% dotknięcia do 20:00" }
  - { label: "Dołek Azji", price: 75640, note: "20% dotknięcia do 20:00" }
  - { label: "PDL", price: 75549, note: "11% dotknięcia do 20:00" }
scenarios:
  - label: "Cena o 20:00 poniżej 75 890"
    probability: 34
    note: "Cena musiałaby oddać wybicie i zejść pod VWAP dnia, czyli wrócić do zakresu z nocy."
  - label: "Cena o 20:00 między 75 890 a 76 240"
    probability: 43
    note: "Najbardziej prawdopodobny wariant: krążenie wokół 76 000 bez dojścia do szczytu poprzedniego dnia."
  - label: "Cena o 20:00 powyżej 76 240"
    probability: 23
    note: "Potrzebne zamknięcie nad szczytem poprzedniego dnia, najlepiej z rosnącym open interest."
---
Od sobotniej mapy cena przeszła przez okrągłe 76 000 o 12:21, a po 14:00 dotknęła kolejno VAH 76 038 o 14:11, otwarcia Londynu 76 075 i szczytu Azji 76 100 o 14:13 oraz VWAP +2σ 76 151 o 14:18. Poziomy pod ceną z mapy, VAL 75 392 i 75 000, zostały nietknięte. Luka CME jest niewielka, piątkowe zamknięcie 75 922 leży 0,13% pod ceną.

[[wykres]]

Od 12:00 cena zyskała 125 USD przy delcie −255 BTC, a open interest spadł w tym czasie o 352 BTC, więc wzrost niosło zamykanie shortów, a nie nowe longi. Szczyt 76 173 z 14:20 zatrzymał się pod PDH 76 235 i cena wróciła w okolice VAH 76 038. Stoi 1,11σ nad VWAP dnia 75 887, a o kontynuacji przesądzi dopiero open interest rosnący razem z ceną.

Na najbliższe godziny model daje 45% na dotknięcie PDH 76 235 do 20:00 i 65% na powrót do VWAP dnia 75 887. Weekendowa płynność jest cienka, więc pojedyncze zlecenia ruszają ceną mocniej niż w tygodniu. Prawdopodobieństwa pochodzą z modelu desku HAR + FHS z symulacją Monte Carlo, policzone o 16:00 i zapisane przed faktem. Następny wpis to mapa tygodnia o 20:00.
