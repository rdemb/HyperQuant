---
title: "Londyn otwiera przy 73 851, kupno to tylko 19% obrotu w pierwszym kwadransie"
description: "Pierwsze 15 minut Londynu: cena 73 851, poziom 74 000 z porannej mapy padł o 08:12, a model daje 38% na dotknięcie PDL 73 457 do 13:00."
date: 2026-11-09T09:15:27+01:00
type: note
section: Otwarcie Londynu
price: 73851
levels:
  - { label: "Szczyt Azji", price: 75585, note: "0% dotknięcia do 13:00" }
  - { label: "Likwidacje shortów", price: 75150, note: "1,1 mln USD, 1% dotknięcia do 13:00" }
  - { label: "Otwarcie tygodnia", price: 74820, note: "6% dotknięcia do 13:00" }
  - { label: "VWAP dnia", price: 74600, note: "14% dotknięcia do 13:00" }
  - { label: "VAL wczoraj", price: 74444, note: "24% dotknięcia do 13:00" }
  - { label: "Otwarcie Londynu", price: 73836, note: "95% dotknięcia do 13:00" }
  - { label: "Dołek Azji", price: 73715, note: "73% dotknięcia do 13:00" }
  - { label: "PDL", price: 73457, note: "38% dotknięcia do 13:00" }
  - { label: "Likwidacje longów", price: 73050, note: "24,2 mln USD, 10% dotknięcia do 13:00" }
scenarios:
  - label: "Cena o 13:00 poniżej 73 460"
    probability: 20
    note: "Sprzedaż musi dalej przeważać, a cena zejść pod PDL 73 457 i tam zostać."
  - label: "Cena o 13:00 między 73 460 a 74 440"
    probability: 68
    note: "Najbardziej prawdopodobne krążenie wokół otwarcia Londynu, bez wyjścia nad VAL ani pod PDL."
  - label: "Cena o 13:00 powyżej 74 440"
    probability: 12
    note: "Potrzebny powrót nad VAL 74 444, czyli odrobienie całego porannego zejścia."
---
Poranna mapa szybko się zdezaktualizowała od dołu. O 08:12 cena zeszła przez 74 000 i ówczesne pasmo VWAP −2σ, a po otwarciu Londynu sprzedaż dalej dominuje: od 09:00 CVD to −420 BTC, kupno tylko 19% obrotu, a open interest urósł o 1,12% przy cenie praktycznie w miejscu.

[[wykres]]

W ostatniej godzinie cena straciła 107 USD przy delcie −1642 BTC, a open interest wzrósł w tym czasie o 123,5 BTC, więc spadek niosły nowe shorty, a nie zamykanie longów. Dołek 73 698 z 09:00 jest najniższym punktem ostatnich 6 godzin i od tamtej pory cena trzyma się tuż przy otwarciu Londynu 73 836. Stoi 1,46σ pod VWAP dnia 74 600, więc obraz zmieni dopiero powrót nad 74 000 przy spadającym open interest albo zejście pod PDL 73 457.

Do 13:00 model daje 38% na dotknięcie PDL 73 457 i 24% na powrót do VAL 74 444. Najbardziej prawdopodobny jest zakres 73 341 do 74 408 (68%).

Prawdopodobieństwa pochodzą z modelu desku HAR + FHS z symulacją Monte Carlo, policzone o 09:15 i zapisane przed faktem. Następna aktualizacja o 12:00.
