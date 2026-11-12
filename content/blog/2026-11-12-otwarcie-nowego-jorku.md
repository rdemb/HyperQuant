---
title: "Nowy Jork otwiera pod 72 000, cztery poziomy mapy padły w 30 minut"
description: "BTC zjechał pod 72 000 tuż przed otwarciem Nowego Jorku. Model daje 12% na powrót do VWAP 72 801 i 14% na zejście do 70 550 do 19:30."
date: 2026-11-12T15:45:11+01:00
type: note
section: Otwarcie Nowego Jorku
price: 72179
levels:
  - { label: "VAL wczoraj", price: 73519, note: "1% dotknięcia do 19:30" }
  - { label: "Dołek Azji", price: 73379, note: "2% dotknięcia do 19:30" }
  - { label: "Likwidacje shortów", price: 73250, note: "1,3 mln USD, 3% dotknięcia do 19:30" }
  - { label: "PDL", price: 73174, note: "4% dotknięcia do 19:30" }
  - { label: "Likwidacje shortów", price: 73150, note: "29,2 mln USD, 4% dotknięcia do 19:30" }
  - { label: "VWAP dnia", price: 72801, note: "12% dotknięcia do 19:30" }
  - { label: "Likwidacje longów", price: 70550, note: "27,8 mln USD, 14% dotknięcia do 19:30" }
  - { label: "Likwidacje longów", price: 70050, note: "11,0 mln USD, 5% dotknięcia do 19:30" }
  - { label: "Likwidacje longów", price: 69750, note: "9,9 mln USD, 3% dotknięcia do 19:30" }
scenarios:
  - label: "Cena o 19:30 poniżej 70 550"
    probability: 8
    note: "Potrzebna kolejna fala wymuszonej sprzedaży pod 71 000, z open interest spadającym razem z ceną, aż do skupiska 27,8 mln przy 70 550."
  - label: "Cena o 19:30 między 70 550 a 72 800"
    probability: 86
    note: "Rynek trawi popołudniowy zjazd i krąży pod VWAP dnia. Tak model widzi zdecydowaną większość ścieżek do 19:30."
  - label: "Cena o 19:30 powyżej 72 800"
    probability: 6
    note: "Cena musiałaby odzyskać VWAP dnia przy rosnącym open interest, czyli z nowymi longami, a nie samym zamykaniem shortów."
---
Mapa przed Nowym Jorkiem z 14:50 dawała 95% na VWAP −1σ i dół mapy padł szybko: skupisko likwidacji longów 72 550 o 14:51, VWAP −2σ 72 142 o 15:11, a 72 000 i skupisko 45,8 mln przy 71 950 o 15:21. Cała górna część mapy, od PDL 73 174 w górę, została nietknięta.

[[wykres]]

W ostatniej godzinie taśmy, do 15:40, cena straciła 377 USD przy delcie −479 BTC, a open interest spadł o 655 BTC, więc zjazd niosło zamykanie longów i likwidacje, a nie nowe shorty. Najniżej taśma pokazała 71 722 o 15:25, potem odbicie do 72 179, ale to wciąż 1,06σ pod VWAP dnia 72 851. Obraz zmieni dopiero powrót nad VWAP z rosnącym open interest.

Ostatnie minuty po 15:40 są bez danych taśmy, a o 15:45 cena stała już na 71 632, niżej niż dołek z taśmy. Od tej ceny model daje 38% na dotknięcie 71 000 i 14% na skupisko 27,8 mln przy 70 550 do 19:30, a powrót do VWAP 72 801 tylko 12%.

Prawdopodobieństwa pochodzą z modelu desku HAR + FHS i symulacji Monte Carlo, policzone o 15:45 i zapisane przed faktem. Następny wpis to aktualizacja o 20:00.
