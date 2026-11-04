---
title: "Wybicie do 81 177 rozbiło zakres mapy, Brier map 0,109 wobec 0,192"
description: "Nowy Jork wyniósł BTC z 78 296 do 81 177 w 47 minut. Obie mapy sesji przestrzeliły zakres 68%, a Brier opublikowanych map dnia to 0,109 wobec 0,192 dla stałej częstości."
date: 2026-11-04T22:05:23+01:00
type: article
section: Podsumowanie dnia
price: 80094
summary:
  - "Sesja NY przeszła od 78 296 o 15:30 do 81 177 o 16:17 i zamknęła się przy 80 094, zakres 3,68%."
  - "Obie mapy sesji miały cenę na koniec okna poza zakresem 68%; Brier mapy przed Nowym Jorkiem 0,226, aktualizacji z 15:45 0,082."
  - "Opublikowane mapy dnia: 85 ocen dotknięć, Brier 0,109 wobec 0,192 dla stałej częstości, przy tej liczbie ocen to wciąż w dużej mierze szum."
  - "OI w sesji spadł o 0,40% przy cenie wyżej o 2,29%, więc wzrost niosło głównie krycie shortów."
metrics:
  - { label: "Premia perp", value: "−5,5 bp", note: "średnio 24 h −3,2 bp" }
  - { label: "Funding", value: "−0,07 bp/h", note: "średnio 24 h 0,09 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "−74,9 mln USD", note: "kupno biorców 1 012,4, sprzedaż 1 087,3 mln USD" }
  - { label: "Likwidacje 24 h", value: "43,4 mln USD", note: "longi 16,3, shorty 27,1 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "13,1 mln USD", note: "do likwidacji między 79 293 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "1,5 mln USD", note: "do likwidacji między ceną a 80 895" }
  - { label: "Arkusz ±10 bp: bidy", value: "42% bidów", note: "zwykle o tej godzinie 49% (14 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "16,7 bp", note: "poprzednie dni robocze (5): 12,4 bp" }
liquidations:
  step: 250
  coverage: 47
  shorts: [[83500, 7], [83250, 9.6], [83000, 13], [82750, 2.8], [82500, 46.8], [82250, 3.8], [82000, 42.7], [81750, 3.3], [81500, 24.1], [81250, 15.9], [81000, 15.7], [80750, 24.7], [80500, 0.3], [80250, 0.4], [80000, 0.3]]
  longs: [[79750, 0.3], [79500, 8.9], [79250, 3.8], [79000, 4.5], [78750, 14.3], [78500, 1.6], [78250, 15.1], [78000, 0.4], [77750, 0.7], [77500, 3], [77250, 2.7], [77000, 5.9], [76750, 2.1], [76500, 7.6]]
  note: "Mapa z 22:01, cena wtedy 80 132; pokrycie 47% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: -82.4, note: "130 kont" }
    - { label: "Reszta rynku", value: -6.6, note: "30 080 kont" }
    - { label: "Animatorzy rynku", value: 14, note: "240 kont" }
---
## Co mówiły dzisiejsze mapy

W [mapie przed Nowym Jorkiem](../2026-11-04-mapa-przed-nowym-jorkiem/) z 14:50 zakres 68% na okno do 19:30 sięgał od 77 393 do 79 320. Cena o 19:30 stała na 80 562, czyli wyraźnie nad zakresem. Górne poziomy, które miały małe szanse, padły jeden po drugim: 79k (48%), VWAP +2σ na 79 005 (47%) i klaster likwidacji shortów 7,0 mln na 79 050 (44%) o 15:41, klaster 18,3 mln na 79 250 (33%) o 15:42, a klaster 7,2 mln na 79 750 przy szansie 14% o 16:04. Pudła były po drugiej stronie: VWAP +1σ 78 142 (83%), otwarcie Londynu 78 123 (81%), PDH 78 046 (74%) i 78k (71%) zostały nietknięte, bo cena po 15:30 nie wróciła już pod 78 296. Brier tej mapy 0,226, słabo.

Notka z [otwarcia Nowego Jorku](../2026-11-04-otwarcie-nowego-jorku/) o 15:45 poszła lepiej. Klaster shortów 3,6 mln na 79 450 (97%) i VWAP +2σ 79 412 (99%) dotknięte, klaster 6,8 mln na 79 750 (63%) też, a 80k przy 40% padło o 16:04. Klaster 4,5 mln na 80 550 miał tylko 11% i został zdjęty o 16:08. 79k przy 54% nie wróciło. Zakres 68% od 78 715 do 80 137 znów okazał się za wąski, cena na koniec okna 80 562. Brier 0,082.

Wcześniejsze wpisy dnia: [mapa dnia](../2026-11-04-mapa-dnia/), [otwarcie Londynu](../2026-11-04-otwarcie-londynu/), [rozliczenie Londynu](../2026-11-04-rozliczenie-londynu/), [aktualizacja 4h](../2026-11-04-aktualizacja-20/).

## Jak przebiegł dzień

Sesja nowojorska od 15:30 do 22:00 zaczęła się od dołka 78 296 i w 47 minut doszła do szczytu 81 177 o 16:17. Zakres 2881 USD, czyli 3,68%. Potem cena oddała część ruchu i skończyła na 80 094. Mimo wzrostu o 2,29% CVD sesji wyszło na −731 BTC, kupno biorców stanowiło 49% obrotu przy wolumenie 31 878 BTC, a open interest spadł o 0,40%. To obraz krycia shortów, a nie fali nowych longów.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** W nocy cena zeszła do 75 687 o 04:00, pod PDL 76 342, a dzień skończyła nad PDH 78 046. Zakres 24 godzin to od 75 687 do 81 177. Wybicie nad PDH dostało kontynuację o ponad 3000 USD, ale szczyt 81 177 nie utrzymał się, więc na razie to wybicie z kontynuacją i z odrzuceniem samego ekstremum.

**Wartość.** POC 24 h stoi na 80 575, obszar wartości od 77 500 do 81 050, a cena 80 094 jest w środku. W nocy ceny pod VAL zostały zaakceptowane: od 00:45 do 06:15 każda świeca 15 min zamknęła się pod 77 500. Nad VAH było odwrotnie, świeca z 16:15 sięgnęła 81 177 i zamknęła się na 80 600, długi knot i szybki powrót do wartości.

**VWAP.** VWAP dnia to 78 665, a cena stoi 0,89σ nad nim przy σ 1603. Od świecy z 05:00 każde zamknięcie 15 min było nad VWAP. Pasmo +1σ trzymało zamknięcia od 13:15 do 20:15 i było wsparciem w spokojnej końcówce po 18:00, ale od 20:30 każde zamknięcie jest pod nim; teraz to około 80 268, czyli opór tuż nad ceną.

**Przepływ i pozycje.** Taśma obejmuje całą dobę. Delta 24 h to −1598 BTC przy wyższej cenie, więc wzrost nie szedł za agresywnym kupnem. W ostatnich 4 godzinach cena spadła o 381 USD, a OI o 1525 BTC, czyli zamykanie longów. W ostatniej godzinie cena wyżej o 145 USD przy delcie −274 BTC i OI prawie bez zmian (−5,4 BTC). Sam rozjazd delty z ceną nie jest sygnałem, dopóki cena na niego nie zareaguje.

## Footprint szczytu doby

[[footprint]]

Świeca z 15:45 to odpowiedź sprzedających po pierwszym wybiciu: delta −676 BTC, POC 79 400, cena zawróciła z 79 630. Świeca z 16:00 przyniosła inicjatywę kupujących: stos czterech nierównowag kupna od 79 700 do 80 000, delta +568 BTC, wolumen 5553 BTC i OI wyżej o 719 BTC, więc w samym impulsie przybywało pozycji. Na 16:15 przyszedł szczyt 81 177 z deltą −260 BTC i zamknięciem na 80 600. Kolejne świece od 16:30 do 17:15 miały ujemną deltę (od −143 do −447 BTC), a dołki nie zeszły pod 80 121, co wygląda na absorpcję sprzedaży nad stosem. Wolumen malał od 5553 do 762 BTC na świecy z 17:30, z jednym odbiciem do 1866 BTC o 17:00, to raczej wyczerpanie ruchu niż nowa inicjatywa.

Linia frontu to stos nierównowag kupna od 79 700 do 80 000 i POC świec 80 500 do 80 600. O 20:45 i 21:00 cena zeszła do 79 905 i 79 904, czyli w górną część stosu. Świeca z 20:45 zamknęła się na 79 948, ale każda następna wróciła nad 80 000. Dopóki stos się trzyma, impuls z 16:00 ma swoje oparcie; zamknięcia pod 79 700 by je zdjęły.

## Gdzie leży płynność

[[likwidacje]]

Pod ceną w 1% jest 13,1 mln USD longów do likwidacji, z czego największy przedział to 8,9 mln na 79 500. Głębiej leżą klastry 14,3 mln na 78 750 i 15,1 mln na 78 250. Nad ceną w 1% tylko 1,5 mln shortów, ale dalej stoją przedziały 24,7 mln na 80 750, 24,1 mln na 81 500 i największe 42,7 mln na 82 000 oraz 46,8 mln na 82 500. Mapa obejmuje 47% otwartych pozycji.

## Kto handluje

[[przeplywy]]

Przez 24 godziny agresorzy sprzedali netto za 74,9 mln USD. Prawie całość to wieloryby, 130 kont i −82,4 mln USD, reszta rynku −6,6 mln, a animatorzy rynku kupili netto za 14 mln. Funding jest lekko ujemny, −0,07 bp/h, premia perp −5,5 bp, a w arkuszu ±10 bp bidy mają 42% wobec zwykłych 49% o tej godzinie.

## Kalibracja

Opublikowane mapy dnia dały 85 ocen dotknięć i 22 trafienia, czyli 26%. Brier 0,109 wobec 0,192 dla stałej częstości, BSS 0,43. Najsłabiej wypadł przedział 70 do 90%: 9 ocen przy średniej szansie 79%, a dotknięć 56%. Na drugim końcu 37 ocen poniżej 10%, średnio 2%, bez żadnego trafienia. Te same poziomy wracają w kilku mapach, więc oceny nie są niezależne, a przy kilkudziesięciu ocenach to jeszcze w dużej mierze szum.

## Na co patrzę dalej

Na noc patrzę na stos od 79 700 do 80 000 i pasmo +1σ VWAP przy 80 268. Zamknięcia pod 79 700 otworzyłyby drogę do longów na 79 500 i dalej do 78 750, powrót nad +1σ i nad POC 80 575 przybliżyłby klaster shortów na 80 750. Zmienność 5 min z doby to 16,7 bp wobec 12,4 bp z poprzednich dni roboczych, więc noc nie musi być spokojna. Prognoza desku na 4 godziny daje medianę 80 109, połowę rozkładu od 79 619 do 80 630 i 90% od 78 927 do 81 302.

## Rzetelność modelu

Przedziały desku na 4 godziny trzymają poziom: 90% obejmuje 90% wyników, a 60% obejmuje 71% przy 1269 ocenach, więc 60% jest raczej za szerokie. Dotknięcia PDH, PDL i środka mają Brier 0,076 wobec 0,128 dla częstości bazowej (1277 ocen). Dzisiejsze przestrzelenie zakresu w obu mapach sesji to przypomnienie, że w dniu jednostronnego impulsu zakres 68% bywa za wąski.

Wszystkie prawdopodobieństwa pochodzą z modelu desku (HAR i FHS, Monte Carlo), zostały zapisane przed faktem, a rozliczenie powstało na świecach o 22:05. Następny wpis to mapa dnia w czwartek o 08:00.
