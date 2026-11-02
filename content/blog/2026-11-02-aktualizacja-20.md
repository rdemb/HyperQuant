---
title: "BTC pod PDL 77 478, model daje 67% na dotknięcie 76 750 do północy"
description: "Od 14:50 cena zeszła z 78 tys. do 76 989 i przebiła VAL oraz PDL. Szanse do 00:00: skupisko 76 750 67%, powrót do PDL 77 478 40%."
date: 2026-11-02T20:00:19+01:00
type: note
section: Aktualizacja 4h
price: 76996
levels:
  - { label: "Likwidacje shortów", price: 78050, note: "8,2 mln USD, 8% dotknięcia do 00:00" }
  - { label: "POC wczoraj", price: 78020, note: "9% dotknięcia do 00:00" }
  - { label: "Likwidacje shortów", price: 77950, note: "9,1 mln USD, 11% dotknięcia do 00:00" }
  - { label: "Dołek Azji", price: 77882, note: "14% dotknięcia do 00:00" }
  - { label: "VWAP dnia", price: 77833, note: "16% dotknięcia do 00:00" }
  - { label: "VAL wczoraj", price: 77688, note: "24% dotknięcia do 00:00" }
  - { label: "PDL", price: 77478, note: "40% dotknięcia do 00:00" }
  - { label: "Likwidacje longów", price: 76750, note: "16,5 mln USD, 67% dotknięcia do 00:00" }
  - { label: "Likwidacje longów", price: 75950, note: "25,8 mln USD, 8% dotknięcia do 00:00" }
scenarios:
  - label: "Cena we wtorek o 00:00 poniżej 76 750"
    probability: 33
    note: "Zejście musiałoby przejść przez skupisko likwidacji longów 16,5 mln przy 76 750, a sprzedający dalej mieliby przewagę w przepływie."
  - label: "Cena we wtorek o 00:00 między 76 750 a 77 480"
    probability: 46
    note: "Cena zostaje między dołkiem 76 800 a PDL i rynek trawi zejście bez nowego impulsu w żadną stronę."
  - label: "Cena we wtorek o 00:00 powyżej 77 480"
    probability: 21
    note: "Potrzebny powrót nad PDL 77 478 i open interest rosnący razem z ceną, a nie samo krycie shortów."
---
Od mapy z 14:50 cena zeszła z okolic 78 tys. do 76 989. O 15:34 jeszcze testowała VAH 78 117, ale o 15:52 dotknęła VAL 77 688, o 16:58 PDL 77 478, a o 18:45 doszła do skupiska likwidacji longów 76 950. Od 16:00 CVD to −1673 BTC przy kupnie 41% obrotu, a open interest spadł o 0,40% przy cenie niższej o 1,10%.

[[wykres]]

W ostatnich 4 godzinach cena straciła 848 USD przy delcie −1670 BTC, a open interest spadł o 163 BTC, więc zejście niosło zamykanie longów i likwidacje. Dołek 76 800 z 18:45 zatrzymał się tuż nad skupiskiem 76 750, a odbicie do 77 357 o 19:10 nie wróciło do PDL 77 478. Ostatnia godzina to cena niższa o 133 USD, delta −50 BTC i open interest wyższy o 306 BTC, czyli wchodzą nowe shorty, a cena stoi 1,76σ pod VWAP dnia 77 833; obraz zmieni dopiero powrót nad PDL.

Do północy model daje 84% na dotknięcie VWAP −2σ 76 881 i 67% na skupisko 76 750, a powrót do PDL 77 478 to 40%. Na 00:00 rozkład ceny daje 33% poniżej 76 750, 46% między 76 750 a 77 480 i 21% powyżej.

Prawdopodobieństwa pochodzą z modelu HAR + FHS z symulacją Monte Carlo, policzone o 20:00 i zapisane przed faktem. Następny wpis to podsumowanie dnia o 22:05.
