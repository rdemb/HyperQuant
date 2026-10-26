---
title: "Otwarcie Nowego Jorku: cena zeszła do 79 430 i wróciła pod PDL 79 817"
description: "BTC po pierwszych 15 minutach Nowego Jorku przy 79 749. Padł PDL i VWAP −1σ, model daje 49% na dotknięcie dołka Azji 79 347 do 18:30."
date: 2026-10-26T14:45:21+01:00
type: note
section: Otwarcie Nowego Jorku
price: 79749
levels:
  - { label: "Szczyt Azji", price: 80349, note: "44% dotknięcia do 18:30" }
  - { label: "POC wczoraj", price: 80300, note: "48% dotknięcia do 18:30" }
  - { label: "Otwarcie tygodnia", price: 80109, note: "67% dotknięcia do 18:30" }
  - { label: "VAL wczoraj", price: 80080, note: "69% dotknięcia do 18:30" }
  - { label: "Otwarcie Londynu", price: 80004, note: "79% dotknięcia do 18:30" }
  - { label: "VWAP dnia", price: 79926, note: "88% dotknięcia do 18:30" }
  - { label: "PDL", price: 79817, note: "100% dotknięcia do 18:30" }
  - { label: "Dołek Azji", price: 79347, note: "49% dotknięcia do 18:30" }
  - { label: "Likwidacje longów", price: 79150, note: "23,3 mln USD, 33% dotknięcia do 18:30" }
scenarios:
  - label: "Cena o 18:30 poniżej 79 350"
    probability: 25
    note: "Potrzebne przebicie dołka Azji 79 347 przy rosnącym open interest, wtedy w zasięgu są likwidacje longów 23,3 mln przy 79 150."
  - label: "Cena o 18:30 między 79 350 a 80 080"
    probability: 40
    note: "Cena krąży wokół VWAP dnia 79 926 i PDL 79 817, bez odzyskania VAL 80 080 i bez zejścia pod dołek Azji."
  - label: "Cena o 18:30 powyżej 80 080"
    probability: 35
    note: "Rynek musi odzyskać VWAP dnia i otwarcie Londynu 80 004, a potem utrzymać się nad VAL 80 080."
---
Mapa z 13:50 dostała mocną weryfikację jeszcze przed dzwonkiem. Od szczytu Azji 80 349 o 13:51 cena zeszła przez otwarcie tygodnia 80 109 i okrągłe 80 000 o 14:24, a po otwarciu Nowego Jorku padł PDL 79 817 o 14:30 i VWAP −1σ 79 638 o 14:35. Od 14:30 CVD wynosi +108 BTC przy 52% kupna, a open interest spadł o 0,18% przy cenie niższej o 0,15%.

[[wykres]]

W ostatniej godzinie cena straciła 573 USD przy delcie −49 BTC, a open interest wzrósł w tym czasie o 81 BTC, więc spadek niosły nowe shorty, a nie samo zamykanie longów. Dołek 79 430 z 14:35 zatrzymał się nad dołkiem Azji 79 347 i cena wróciła pod PDL 79 817, gdzie teraz krąży. Stoi 0,62σ pod VWAP dnia 79 926 i obraz zmieni dopiero powrót nad VWAP albo zejście pod 79 347.

Do 18:30 model daje 88% na powrót do VWAP dnia 79 926 i 49% na dotknięcie dołka Azji 79 347, a likwidacje longów 23,3 mln przy 79 150 mają 33%.

Prawdopodobieństwa pochodzą z modelu desku HAR + FHS z symulacją Monte Carlo, liczone o 14:45 i zapisane przed faktem. Następny wpis o 20:00.
