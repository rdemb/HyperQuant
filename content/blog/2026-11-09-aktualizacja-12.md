---
title: "BTC wrócił pod VAL 74 444, model daje 69% na ponowne dotknięcie do 16:00"
description: "BTC 74 125, pod VWAP dnia 74 538. Od mapy dołek 73 698 o 09:00 i odbicie do VAL. Do 16:00 model daje 69% na powrót do 74 444 i 67% na otwarcie Londynu 73 836."
date: 2026-11-09T12:00:22+01:00
type: note
section: Aktualizacja 4h
price: 74125
levels:
  - { label: "Likwidacje shortów", price: 75350, note: "1,7 mln USD, 12% dotknięcia do 16:00" }
  - { label: "Likwidacje shortów", price: 75150, note: "4,5 mln USD, 20% dotknięcia do 16:00" }
  - { label: "Otwarcie tygodnia", price: 74820, note: "38% dotknięcia do 16:00" }
  - { label: "VWAP dnia", price: 74538, note: "61% dotknięcia do 16:00" }
  - { label: "VAL wczoraj", price: 74444, note: "69% dotknięcia do 16:00" }
  - { label: "Otwarcie Londynu", price: 73836, note: "67% dotknięcia do 16:00" }
  - { label: "Dołek Azji", price: 73715, note: "55% dotknięcia do 16:00" }
  - { label: "PDL", price: 73457, note: "35% dotknięcia do 16:00" }
  - { label: "Likwidacje longów", price: 73150, note: "19,4 mln USD, 19% dotknięcia do 16:00" }
scenarios:
  - label: "Cena o 16:00 poniżej 73 840"
    probability: 33
    note: "Cena musiałaby zejść pod otwarcie Londynu i tam zostać, co pasowałoby do dalszego przyrostu shortów przy ujemnej delcie."
  - label: "Cena o 16:00 między 73 840 a 74 440"
    probability: 30
    note: "Dalsze krążenie pod VAL i nad otwarciem Londynu, czyli w przedziale, w którym zamyka się każda świeca 5 min od 10:10."
  - label: "Cena o 16:00 powyżej 74 440"
    probability: 37
    note: "Potrzebny powrót nad VAL i utrzymanie go, najlepiej przy dodatniej delcie i rosnącym open interest."
---
Od porannej mapy cena zeszła najpierw pod 74 000 i dołek Azji, do 73 698 o 09:00, a potem odbiła i o 09:53 dotknęła VAL 74 444. Szczyt odbicia to 74 716 tuż po 10:00, ale od tamtej pory cena oddała prawie cały ruch i stoi na 74 125. Od 08:00 przepływ jest po stronie sprzedających: CVD −1268 BTC, kupno 41% obrotu, a open interest urósł o 0,51% przy cenie −0,22%, czyli przybywało nowych shortów.

[[wykres]]

W ostatnich 4 godzinach delta wyniosła −1268 BTC, cena straciła 172 USD, a open interest wzrósł o 209 BTC, więc spadek niosły nowe shorty. Ostatnia godzina wygląda inaczej: cena −136 USD przy delcie −337 BTC i open interest niższym o 285 BTC, to raczej zamykanie longów niż świeża podaż. VAL 74 444 cena przebiła o 09:50, ale od 10:10 każda świeca 5 min zamyka się pod nim, a teraz stoi 0,86σ pod VWAP dnia 74 538, więc obraz zmieni dopiero powrót nad VWAP razem z rosnącym open interest.

Do 16:00 model daje 69% na powrót do VAL 74 444 i 67% na zejście do otwarcia Londynu 73 836, a otwarcie tygodnia 74 820 ma 38%. Klaster likwidacji longów 73 150 (19,4 mln USD) to 19%. Prawdopodobieństwa pochodzą z modelu desku HAR + FHS i symulacji Monte Carlo, policzone o 12:00 i zapisane przed faktem. Następny wpis: rozliczenie Londynu o 13:05.
