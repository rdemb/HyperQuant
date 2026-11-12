---
title: "BTC 73 426 pod VWAP dnia, dołek Azji 73 379 przebity o 10:10"
description: "Londyn zszedł do 73 209 i wrócił w okolice dołka Azji. Model daje 67% na dotknięcie POC 73 723 i 26% na likwidacje shortów 74 250 do 16:00."
date: 2026-11-12T12:00:10+01:00
type: note
section: Aktualizacja 4h
price: 73426
levels:
  - { label: "Likwidacje shortów", price: 74250, note: "18,6 mln USD, 26% dotknięcia do 16:00" }
  - { label: "VAH wczoraj", price: 74222, note: "28% dotknięcia do 16:00" }
  - { label: "Szczyt Azji", price: 74180, note: "30% dotknięcia do 16:00" }
  - { label: "POC wczoraj", price: 73723, note: "67% dotknięcia do 16:00" }
  - { label: "VWAP dnia", price: 73633, note: "77% dotknięcia do 16:00" }
  - { label: "Otwarcie Londynu", price: 73623, note: "78% dotknięcia do 16:00" }
  - { label: "VAL wczoraj", price: 73519, note: "90% dotknięcia do 16:00" }
  - { label: "Dołek Azji", price: 73379, note: "95% dotknięcia do 16:00" }
  - { label: "PDL", price: 73174, note: "71% dotknięcia do 16:00" }
scenarios:
  - label: "Cena o 16:00 poniżej 72 550"
    probability: 13
    note: "Potrzebne zamknięcie pod PDL 73 174 i dalsze zejście do likwidacji longów przy 72 550, czyli ciąg dalszy nowych shortów z ostatniej godziny."
  - label: "Cena o 16:00 między 72 550 a 73 720"
    probability: 53
    note: "Rynek zostaje w zakresie poranka i krąży między dołkiem Azji a POC wczoraj, bez wyraźnej przewagi żadnej ze stron."
  - label: "Cena o 16:00 powyżej 73 720"
    probability: 34
    note: "Wymaga powrotu nad VWAP dnia 73 633 i POC wczoraj 73 723, najlepiej przy open interest rosnącym razem z ceną."
---
Od otwarcia Londynu o 09:00 przy 73 623 cena schodziła. VAL wczoraj 73 519 padł o 09:25, o 10:10 rynek przebił dołek Azji 73 379, a o 10:20 zszedł do 73 209, zatrzymując się nad PDL 73 174. Teraz BTC stoi przy 73 426, znów tuż nad dołkiem Azji.

[[wykres]]

W ostatniej godzinie delta wyniosła −173 BTC, cena spadła o 39 USD, a open interest wzrósł o 143,5 BTC, więc spadek niosły nowe shorty, a nie samo zamykanie longów. Dołek 73 209 z 10:20 nie sięgnął PDL i od tamtej pory cena krąży wokół dołka Azji 73 379. Cena jest 1,03σ pod VWAP dnia 73 633, a obraz zmieni dopiero powrót nad VWAP albo zamknięcie pod PDL przy rosnącym open interest. Między 11:43 a 11:47 taśma ma krótką lukę.

Na 16:00 model daje 67% na dotknięcie POC wczoraj 73 723 i 26% na likwidacje shortów przy 74 250, a PDL 73 174 ma 71%. Najbardziej prawdopodobny jest scenariusz środkowy: cena o 16:00 między 72 550 a 73 720 z szansą 53%.

Prawdopodobieństwa pochodzą z modelu desku HAR + FHS z symulacją Monte Carlo, policzone o 12:00 i zapisane przed faktem. Następny wpis to rozliczenie Londynu o 13:05.
