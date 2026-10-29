---
title: "BTC 79 946 po otwarciu Nowego Jorku: nowe shorty i 84% na test 79 826"
description: "Pierwsze 15 minut Nowego Jorku: CVD −8 BTC, open interest +0,37% przy cenie −0,35%. Model daje 84% na dotknięcie otwarcia Londynu 79 826 do 18:30."
date: 2026-10-29T14:45:20+01:00
type: note
section: Otwarcie Nowego Jorku
price: 79946
levels:
  - { label: "Likwidacje shortów", price: 81050, note: "5,4 mln USD, 13% dotknięcia do 18:30" }
  - { label: "Likwidacje shortów", price: 80850, note: "28,0 mln USD, 21% dotknięcia do 18:30" }
  - { label: "VAL wczoraj", price: 80606, note: "36% dotknięcia do 18:30" }
  - { label: "PDL", price: 80362, note: "56% dotknięcia do 18:30" }
  - { label: "VWAP dnia", price: 80118, note: "82% dotknięcia do 18:30" }
  - { label: "Otwarcie Londynu", price: 79826, note: "84% dotknięcia do 18:30" }
  - { label: "Dołek Azji", price: 79668, note: "65% dotknięcia do 18:30" }
  - { label: "Likwidacje longów", price: 79150, note: "12,2 mln USD, 24% dotknięcia do 18:30" }
  - { label: "Likwidacje longów", price: 78950, note: "26,0 mln USD, 15% dotknięcia do 18:30" }
scenarios:
  - label: "Cena o 18:30 poniżej 79 670"
    probability: 33
    note: "Cena musi zejść pod otwarcie Londynu i dołek Azji, a nowe shorty z otwarcia dalej dokładać; wtedy otwiera się droga do likwidacji longów przy 79 150."
  - label: "Cena o 18:30 między 79 670 a 80 360"
    probability: 37
    note: "Rynek zostaje w zakresie dnia: VWAP 80 118 przyciąga cenę, a PDL 80 362 dalej trzyma od góry."
  - label: "Cena o 18:30 powyżej 80 360"
    probability: 30
    note: "Potrzebny powrót nad VWAP i wybicie PDL 80 362, którego nie ruszył szczyt z 11:50, przy open interest rosnącym razem z ceną."
---
Mapa przed Nowym Jorkiem z 13:50 dostała dwa dotknięcia jeszcze przed otwarciem: 80 000 o 13:56 i VWAP dnia 80 122 o 14:01. Pierwsze 15 minut sesji to lekka przewaga strony sprzedającej: CVD −8 BTC, kupno 49% obrotu przy wolumenie 475 BTC, a open interest wzrósł o 0,37% przy cenie niżej o 0,35%, czyli wchodzą nowe shorty.

[[wykres]]

W ostatniej godzinie cena oddała 164 USD przy delcie −7,9 BTC, a open interest urósł w tym czasie o 110 BTC, więc spadek niosą nowe shorty, a nie zamykanie longów. Szczyt ostatnich 6 godzin 80 359 z 11:50 zatrzymał się tuż pod PDL 80 362, a dołek 79 800 z 08:45 leży zaraz pod otwarciem Londynu 79 826. Cena stoi 0,52σ pod VWAP dnia 80 118, więc obraz zmieni dopiero powrót nad VWAP z rosnącym open interest albo zejście pod 79 800.

Do 18:30 model daje 84% na dotknięcie otwarcia Londynu 79 826 i 65% na dołek Azji 79 668, a PDL 80 362 ma 56%. Zakres 68% to 79 232 do 80 694. Prawdopodobieństwa pochodzą z modelu desku HAR + FHS z Monte Carlo, liczone o 14:45 i zapisane przed faktem. Następny wpis to aktualizacja o 20:00.
