---
title: "BTC wraca z 74 842 na 75 874, opublikowane mapy dnia z Brierem 0,132"
description: "Nowy Jork zszedł pod PDL 75 189 i w tej samej świecy wrócił. Obie mapy sesji trafiły zakres 68%, a 79 ocen dnia dało Brier 0,132 wobec 0,247 dla stałej częstości."
date: 2026-11-06T22:05:25+01:00
type: article
section: Podsumowanie dnia
price: 75874
summary:
  - "Sesja NY miała zakres 1313 USD: szczyt 76 155 o 15:51, dołek 74 842 o 16:05 i ostatnia cena 75 874."
  - "Mapa przed Nowym Jorkiem dostała Brier 0,171, a aktualizacja z 15:45 Brier 0,110; cena na koniec okna 75 842 w obu zakresach 68%."
  - "Opublikowane prognozy dnia: 79 ocen, 35 dotknięć, Brier 0,132 wobec 0,247 dla stałej częstości, czyli BSS 0,46."
  - "Agresorzy sprzedawali przez dobę per saldo za 137,3 mln USD, z czego wieloryby za 126,1 mln USD."
metrics:
  - { label: "Premia perp", value: "−0,7 bp", note: "średnio 24 h −1,4 bp" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,12 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "−137,3 mln USD", note: "kupno biorców 820,5, sprzedaż 957,8 mln USD" }
  - { label: "Likwidacje 24 h", value: "18,9 mln USD", note: "longi 15,4, shorty 3,5 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "0,8 mln USD", note: "do likwidacji między 75 115 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "27,6 mln USD", note: "do likwidacji między ceną a 76 633" }
  - { label: "Arkusz ±10 bp: bidy", value: "49% bidów", note: "zwykle o tej godzinie 49% (16 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "14,4 bp", note: "poprzednie dni robocze (5): 14,1 bp" }
liquidations:
  step: 250
  coverage: 47
  shorts: [[79000, 0.8], [78750, 0.9], [78500, 5.8], [78250, 0.8], [78000, 2], [77750, 0.7], [77500, 0.5], [77250, 2.4], [77000, 3.5], [76750, 5.5], [76500, 38.3], [76250, 2.2], [76000, 0.4]]
  longs: [[75250, 0.3], [75000, 3], [74750, 14.4], [74500, 24.5], [74250, 13.8], [74000, 29.7], [73750, 5.2], [73500, 23.4], [73250, 10.4], [73000, 31.4], [72750, 14.7], [72500, 33.9]]
  note: "Mapa z 21:59, cena wtedy 75 873; pokrycie 47% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: -126.1, note: "120 kont" }
    - { label: "Reszta rynku", value: 5.8, note: "24 670 kont" }
    - { label: "Animatorzy rynku", value: -17, note: "220 kont" }
# setups: 2–3 scenariusze warunkowe w tym kształcie (docs/BLOG.md desku), liczby z danych, potem znacznik setupów w treści
#   - name: "Zjawisko rynkowe, nie transakcja (do 70 znaków)"
#     bias: up                      # up, down albo flat
#     zone: [79750, 80250]          # [od, do]: klaster likwidacji, dołek/szczyt, wartość sesji
#     window: "do 10:00 w niedzielę"
#     triggers:                     # 2–4 obserwowalne warunki w kolejności, każdy do 180 znaków
#       - "Cena wchodzi w klaster, a likwidacje longów rosną skokowo."
#     invalidation: "Dwa zamknięcia 15 min pod 79 750 bez powrotu."
#     reactions:                    # 2–4 poziomy z levels albo mapy likwidacji
#       - { label: "PDL", price: 80500 }
#     evidence: "Tylko gdy hipoteza laboratorium pasuje: n, częstość wobec losowej, uczciwie o szumie."
---
## Co mówiły dzisiejsze mapy

Dzień zaczął się od [mapy dnia](../2026-11-06-mapa-dnia/), potem były [otwarcie Londynu](../2026-11-06-otwarcie-londynu/), [aktualizacja w południe](../2026-11-06-aktualizacja-12/) i [rozliczenie Londynu](../2026-11-06-rozliczenie-londynu/). Na Nowy Jork rozliczam dwie mapy z oknem do 19:30.

[Mapa przed Nowym Jorkiem](../2026-11-06-mapa-przed-nowym-jorkiem/) z 14:50 dawała zakres 68% od 74 851 do 76 976. Cena na koniec okna to 75 842, więc w zakresie. Z 20 poziomów dotknięte zostało 11. Dobrze wyszła strona dolna aż do 75 000: VWAP −1σ 75 637 przy 78%, otwarcie Londynu 75 591 przy 74%, VWAP −2σ 75 370 przy 60%, VAL 75 202 przy 49%, PDL 75 189 przy 48% i okrągłe 75 000 przy 38%, dotknięte o 16:05. Pudła były na górze: VWAP +1σ 76 171 przy 79% nie padł, tak samo Azja H 76 400 przy 63% i VWAP +2σ 76 438 przy 61%. Brier tej mapy to 0,171.

[Otwarcie Nowego Jorku](../2026-11-06-otwarcie-nowego-jorku/) z 15:45 miało zakres 74 901 do 76 675, też trafiony. Tu VWAP +1σ leżał niżej, na 76 125 przy 69%, i padł o 15:51. Nietrafione 47% dla Azji H 76 400 i 48% dla VWAP +2σ 76 394, za to 36% dla 75 000 zostało dotknięte. Brier 0,110, wyraźnie lepiej niż mapa sprzed otwarcia. Ostatnia [aktualizacja z 20:00](../2026-11-06-aktualizacja-20/) ma okno, które jeszcze trwa, więc rozliczę ją później.

## Jak przebiegł dzień

Sesja nowojorska od 15:30 do 22:00 zrobiła szczyt 76 155 o 15:51, czternaście minut później zeszła do 74 842 i skończyła przy 75 874. Zakres 1313 USD, czyli 1,75%. Przepływ był po stronie sprzedających: CVD sesji −834 BTC, kupno 47% obrotu przy wolumenie 15 960 BTC. Mimo to cena skończyła sesję 0,32% wyżej, a open interest urósł o 0,55%, co w prostym odczycie oznacza dopisane longi.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Cena stoi ponad 5000 USD pod PDH 80 888, więc dzień w całości rozegrał się w dolnej części szerszego ruchu. Zakres doby to 74 834 do 76 400, szczyt wypadł już o 01:45, a dołek w świecy od 16:00. Zejście pod PDL 75 189 nie miało kontynuacji: ta sama świeca 15 min zamknęła się na swoim szczycie 75 840. To wygląda na nieudane wybicie dołem, a nie na początek nowej nogi.

**Wartość.** POC doby leży na 75 750, obszar wartości od 75 400 do 76 025, a cena 75 874 jest w jego środku. Zejścia pod VAL o 16:00 i 16:30 zostały odrzucone szybko i długim knotem, bez dwóch świec 30 min poza obszarem. Rynek przez cały wieczór handlował wokół POC, co pasuje do akceptacji tej wartości na dziś.

**VWAP.** VWAP dnia to 75 736,6, cena jest 0,44σ nad nim przy σ 309,6. Od 17:45 większość świec zamyka się nad VWAP, wyjątki to 18:30 i 20:15. Górne pasmo +1σ działało jak sufit: świece z 17:45 i 18:00 przebiły je knotem i zamknęły się pod nim, a od 18:15 żadna świeca go nie dotknęła.

**Przepływ i pozycje.** Delta całego okna nagrania to −3143,6 BTC, z ostatnich 4 godzin −172,4 BTC, z ostatniej godziny +136,3 BTC. W 4 godziny cena spadła o 130 USD, a OI o 1060,8 BTC, czyli według macierzy zamykanie longów, a nie nowe shorty. W ostatniej godzinie cena prawie stoi (−7 USD) przy OI −120,8 BTC. Największy skok likwidacji doby to 9,04 mln USD longów w godzinie od 16:00. Taśma ma jedną krótką lukę około 11:43.

## Footprint dołka pod PDL

[[footprint]]

Sekwencja zaczyna się od świecy 15:45, która zrobiła szczyt sesji 76 155 i od razu oddała go do 75 541. Nierównowagi kupna stoją w niej na 75 800, 75 400 i 75 300, ale nie tworzą stosu trzech poziomów obok siebie, więc trudno mówić o czystej inicjatywie. Świeca 16:00 to kluczowe miejsce dnia: wolumen 3759 BTC, delta −202,4 BTC, OI +323,5 BTC, dołek 74 834 i zamknięcie na samym szczycie 75 840. Duża ujemna delta bez postępu ceny w dół to obraz absorpcji, sprzedający dociskali, a cena wróciła o ponad tysiąc dolarów w tej samej świecy. Potem wolumen gaśnie do 439,9 BTC o 17:00, a delta zostaje przeważnie lekko ujemna bez nowego dołka, co wygląda na wyczerpanie strony podażowej.

Linia frontu na teraz to POC świecy dołka 75 200, czyli prawie dokładnie PDL, oraz 75 700, gdzie nierównowaga kupna wraca w świecach 16:00, 16:45 i 17:15. Nad ceną punktem odniesienia jest 75 800 z nierównowagami sprzedaży w świecach 16:15 i 17:00. To wskazówki z jednego popołudnia, nie statystyka.

## Kalibracja

Liczę tylko opublikowane prognozy dnia: 79 ocen dotknięć, 35 trafień, czyli 44%. Brier 0,132 wobec 0,247 dla stałej częstości, BSS 0,46. Najsłabszy koszyk to 10 do 30%: 14 ocen ze średnią 21% i żadnego dotknięcia, więc te poziomy wyceniałem za wysoko. W koszyku 30 do 50% było odwrotnie, średnio 43%, a dotknięć 56% przy 18 ocenach. Wyżej wszystko leży blisko przekątnej: 70 do 90% przy średniej 80% dało 86%. Mapy dnia nakładają się, te same poziomy wracają w kilku wpisach, więc to nie są niezależne próby. Przy kilkudziesięciu ocenach to jeszcze w dużej mierze szum.

## Na co patrzę dalej

Na noc najważniejsze jest, czy 75 200 i obszar wokół PDL dalej trzymają. Pod ceną w 1% jest tylko 0,8 mln USD longów do likwidacji, ale niżej skupiska rosną: 14,4 mln USD w przedziale od 74 750 i 24,5 mln USD od 74 500. Nad ceną w 1% stoi 27,6 mln USD shortów, z czego 38,3 mln USD w przedziale od 76 500 to największy klaster po obu stronach blisko ceny. Prognoza desku na 4 godziny daje medianę 75 930, połowę rozkładu między 75 493 a 76 338 i 90% między 74 886 a 76 973, czyli spokojną noc w obecnym zakresie.

## Rzetelność modelu

W dzienniku desku przedziały 4 h z deklarowanym pokryciem 90% obejmują 90% wyników, a 60% obejmuje 72% przy 1461 prognozach, więc węższy przedział jest za szeroki. Dotknięcia PDH, PDL i środka mają Brier 0,073 wobec 0,120 dla częstości bazowej przy 1469 ocenach.

Wszystkie prawdopodobieństwa pochodzą z modelu desku HAR + FHS i symulacji Monte Carlo, zostały zapisane przed faktem, a ocena idzie na świecach rynku. Podsumowanie powstało o 22:05. Następny wpis to rozliczenie tygodnia w sobotę o 10:00.
