---
title: "BTC zszedł do 76 670, a mapy przed Nowym Jorkiem miały Brier 0,129 i 0,157"
description: "Sesja NY od 78 138 do 76 670, cena pod całym zakresem 68% z mapy. Rozliczam obie opublikowane mapy, wartość, VWAP i footprint dołka dnia."
date: 2026-11-02T22:05:18+01:00
type: article
section: Podsumowanie dnia
price: 76776
summary:
  - "Mapa przed Nowym Jorkiem dała zakres 68% od 77 274 do 78 661, a cena na koniec okna stała na 76 948, czyli pod zakresem."
  - "Dziesięć dotknięć z mapy się zrealizowało, w tym poziom 76 950 wyceniony na 14%; Brier mapy 0,129, aktualizacji 0,157."
  - "Sesja NY: CVD −697 BTC, OI +1,49% przy cenie −1,32%, czyli dzień nowych shortów, a cena kończy 1,72σ pod VWAP dnia."
  - "Opublikowane prognozy dnia: 66 ocen, Brier 0,115 wobec 0,246 dla stałej częstości, ale przy tej liczbie to wciąż w dużej mierze szum."
metrics:
  - { label: "Premia perp", value: "−2,9 bp", note: "średnio 24 h −2,8 bp" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,12 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "−40,1 mln USD", bias: down, note: "kupno biorców 275,6, sprzedaż 315,6 mln USD" }
  - { label: "Likwidacje 24 h", value: "23,4 mln USD", note: "longi 14,1, shorty 9,3 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "40,7 mln USD", note: "do likwidacji między 76 008 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "0,0 mln USD", note: "do likwidacji między ceną a 77 544" }
  - { label: "Arkusz ±10 bp: bidy", value: "49% bidów", note: "zwykle o tej godzinie 50% (12 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "10,8 bp", note: "poprzednie dni robocze (5): 12,4 bp" }
liquidations:
  step: 250
  coverage: 46
  shorts: [[80000, 3.5], [79750, 3.1], [79500, 27.2], [79250, 2.4], [79000, 5.3], [78750, 2.5], [78500, 1.3], [78250, 0.8], [78000, 5.7], [77750, 6.1], [77500, 8.2]]
  longs: [[76500, 16.6], [76250, 14], [76000, 13.8], [75750, 48.9], [75500, 21], [75250, 4.9], [75000, 10.1], [74750, 2.3], [74500, 7.5], [74250, 6.4], [74000, 14.6], [73750, 13.8], [73500, 8.7], [73250, 3.5]]
  note: "Mapa z 22:03, cena wtedy 76 840; pokrycie 46% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: -62.8, note: "100 kont" }
    - { label: "Reszta rynku", value: 1, note: "19 130 kont" }
    - { label: "Animatorzy rynku", value: 21.8, note: "210 kont" }
---
## Co mówiły dzisiejsze mapy

W [mapie przed Nowym Jorkiem](../2026-11-02-mapa-przed-nowym-jorkiem/) o 14:50 zakres 68% na okno do 19:30 sięgał od 77 274 do 78 661. Cena na koniec okna stała na 76 948, więc wyszła dołem poza zakres. Dolna połowa mapy zadziałała: VAH 78 117 (82%), POC 78 020 (94%), 78 000 (97%), VAL 77 688 (68%), VWAP −2σ 77 661 (65%) i PDL 77 478 (47%) zostały dotknięte. Dotknięty został też klaster likwidacji longów przy 76 950, któremu dałem tylko 14%, o 18:45. Górna połowa nie zadziałała: VWAP 78 169 przy 75%, otwarcie tygodnia 78 326 przy 58% i PDH 78 410 przy 50% zostały nietknięte. Brier tej mapy 0,129.

[Otwarcie Nowego Jorku](../2026-11-02-otwarcie-nowego-jorku/) o 15:45 przesunęło zakres na 77 260 do 78 515 i też skończyło pod nim. Tam pudłem był VWAP 78 151 przy 64% i VAH 78 117 przy 69%, a niespodzianką 77 000 przy 15%, dotknięte o 18:35. Brier 0,157. Rano były jeszcze [otwarcie Londynu](../2026-11-02-otwarcie-londynu/), [aktualizacja w południe](../2026-11-02-aktualizacja-12/), [rozliczenie Londynu](../2026-11-02-rozliczenie-londynu/) i [aktualizacja o 20:00](../2026-11-02-aktualizacja-20/).

## Jak przebiegł dzień

Sesja NY od 15:30 do 22:00 zrobiła szczyt 78 138 już o 15:35, a potem przez resztę dnia schodziła w dół. Dołek 76 670 przyszedł o 20:48, zamknięcie okna na 76 776. Zakres sesji 1468 USD, czyli 1,91%. CVD sesji −697 BTC, kupno to 48% obrotu przy wolumenie 13 922 BTC. Open interest wzrósł o 1,49% przy cenie niższej o 1,32%, co czytam jako dzień, w którym otwierały się nowe shorty, a nie tylko wypadały longi.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Szczyt doby 78 854 padł o 04:45 w nocy, dołek 76 670 o 20:48. Cena jest pod PDL 77 478 i pod PDH 78 410, czyli wybicie dołem z poprzedniego dnia trzyma się do zamknięcia. Pierwsze zejście pod PDL przyszło świecą z 16:45, która spadła z 78 065 do 77 280 z deltą −544,6 BTC, drugie pchnięcie świecą z 18:15 z deltą −628,2 BTC. Po każdym z nich odbicie było płytkie, więc to wybicie z kontynuacją, nie nieudane.

**Wartość.** POC 24 godzin stoi na 78 125, obszar wartości od 77 350 do 78 700. Cena 76 776 jest pod wartością. Od świecy z 18:15 każda świeca 15 min zamknęła się pod VAL 77 350, to prawie cztery godziny, więc ceny pod obszarem wartości zostały zaakceptowane, a nie odrzucone.

**VWAP.** VWAP dnia 77 705, σ 541,6, cena 1,72σ pod nim. Od świecy z 06:45 każda świeca 15 min zamknęła się pod VWAP, a od 16:45 każda także pod pasmem −1σ. Pasmo −1σ działało jako opór: odbicie z 21:15 doszło do 77 212, gdy pasmo stało na 77 191, i cena od razu wróciła niżej.

**Przepływ i pozycje.** W ostatnich 4 godzinach cena spadła o 695 USD przy delcie −42,1 BTC i wzroście OI o 815,7 BTC, czyli cena w dół i OI w górę, nowe shorty. W ostatniej godzinie delta wyniosła +917,8 BTC, OI wzrósł o 983,4 BTC, a cena i tak straciła 301 USD. Kupujący agresywnie trafili w pasywną podaż i nie przesunęli ceny, co liczy się dopiero dlatego, że cena po tym zeszła niżej. Taśma obejmuje całą dobę do 22:00.

## Footprint dołka dnia i odbicia o 21:15

[[footprint]]

Świeca z 20:30 to inicjatywa sprzedających: stos nierównowag sprzedaży od 76 900 w dół do 76 750, delta −202,4 BTC i OI −227 BTC, czyli zamykanie longów razem z likwidacjami. Świeca z 20:45 zrobiła dołek 76 670 i zamknęła się na 77 077 z długim dolnym knotem, to odpowiedź kupujących. O 21:15 przyszła druga fala: jedenaście nierównowag kupna od 76 950 do 77 200, delta +907,8 BTC, OI +788,5 BTC, ale szczyt 77 212 i zamknięcie 77 004. To absorpcja, duża delta bez postępu ceny, a dwie kolejne świece zeszły do 76 776.

Linia frontu na noc to stos kupna od 76 950 do 77 200 z POC świecy 77 150, który teraz jest nad ceną, i POC ostatniej świecy na 76 700 tuż nad dołkiem dnia 76 670. Powrót nad 77 200 unieważniałby obraz absorpcji, zejście pod 76 670 otwiera klastry longów niżej.

## Gdzie leży płynność

[[likwidacje]]

Pod ceną stoi 40,7 mln USD longów w promieniu 1%, najwięcej w przedziale 76 500 (16,6 mln) i dalej przy 75 750 (48,9 mln). Nad ceną w promieniu 1% shortów praktycznie nie ma, najbliższy większy klaster to 79 500 z 27,2 mln.

## Kto handluje

[[przeplywy]]

W 24 godzinach biorcy sprzedali netto za 40,1 mln USD. Wieloryby to −62,8 mln USD, reszta rynku jest na zerze, animatorzy rynku dokupili 21,8 mln USD. Likwidacje doby to 23,4 mln USD, z czego 14,1 mln longów.

## Kalibracja

Wszystkie opublikowane dziś prognozy dały 66 ocen dotknięć i 29 trafień, czyli 44%. Brier 0,115 wobec 0,246 dla stałej częstości. Poziomy wyceniane na 70 do 90% trafiły w 90% przypadków (n 10), a te z 30 do 50% tylko w 14% (n 7), więc dziś wysokie szanse były raczej niedoszacowane, a te ze środka skali przeszacowane. Mapy dnia nakładają się poziomami, więc to nie są niezależne próby, a przy kilkudziesięciu ocenach to wciąż w dużej mierze szum.

## Na co patrzę dalej

Na noc patrzę na dołek 76 670 i klaster longów od 76 500 w dół. Prognoza desku na 4 godziny daje medianę 76 735, połowę rozkładu od 76 320 do 77 152 i 90% od 75 756 do 77 736. Z drugiej strony ważny jest powrót nad 77 200 i pasmo −1σ VWAP. Zmienność 5 min z doby to 10,8 bp wobec 12,4 bp z poprzednich dni roboczych, a finansowanie stoi spokojnie na 0,13 bp/h przy premii −2,9 bp.

## Rzetelność modelu

W dłuższym archiwum prognoz przedziały 90% na godzinę obejmują 93% wyników, a 60% obejmują 71% (n 1089), więc model jest raczej zbyt ostrożny niż zbyt pewny. Dotknięcia PDH, PDL i środka mają Brier 0,074 wobec 0,121 dla częstości bazowej (n 1085).

Prawdopodobieństwa z map pochodzą z modelu desku HAR z FHS i symulacji Monte Carlo, zapisane przed faktem i ocenione na świecach po zamknięciu okna. Następny wpis to mapa dnia we wtorek rano przed otwarciem Londynu.
