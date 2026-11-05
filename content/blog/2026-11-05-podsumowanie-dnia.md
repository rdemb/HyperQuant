---
title: "BTC zjeżdża w sesji NY do 75 538, a moje dwie mapy mają Brier 0,358 i 0,211"
description: "Zakres sesji 4065 USD, cena poza oboma przedziałami 68% z map przed i po otwarciu Nowego Jorku. Rozliczam 40 dotknięć i kalibrację dnia."
date: 2026-11-05T22:05:17+01:00
type: article
section: Podsumowanie dnia
price: 76231
summary:
  - "Sesja Nowego Jorku od szczytu 79 603 do dołka 75 538, zakres 4065 USD, czyli 5,38%."
  - "Cena 76 168 na koniec okna wypadła poza oba przedziały 68%, a Brier map wyszedł 0,358 i 0,211."
  - "Opublikowane prognozy dnia: 79 ocen, Brier 0,206 wobec 0,195 dla stałej częstości, więc tym razem gorzej od klimatologii."
  - "OI urosło o 7,06% przy cenie niższej o 4,13%, a wieloryby sprzedały netto 129,4 mln USD w 24 h."
metrics:
  - { label: "Premia perp", value: "1,0 bp", note: "średnio 24 h −1,9 bp" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,11 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "−135,0 mln USD", note: "kupno biorców 812,9, sprzedaż 947,9 mln USD" }
  - { label: "Likwidacje 24 h", value: "31,9 mln USD", note: "longi 30,5, shorty 1,5 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "12,6 mln USD", note: "do likwidacji między 75 469 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "1,2 mln USD", note: "do likwidacji między ceną a 76 993" }
  - { label: "Arkusz ±10 bp: bidy", value: "52% bidów", note: "zwykle o tej godzinie 49% (15 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "16,3 bp", note: "poprzednie dni robocze (5): 12,5 bp" }
liquidations:
  step: 250
  coverage: 46
  shorts: [[79500, 21.8], [79250, 0.4], [79000, 0.7], [78750, 2.9], [78500, 1.9], [78250, 0.7], [78000, 0.2], [77750, 1.3], [77500, 0.5], [77250, 0.3], [77000, 3.6], [76750, 1], [76500, 0.2]]
  longs: [[75750, 0.5], [75500, 11.7], [75250, 25.8], [75000, 46.7], [74750, 17.3], [74500, 9.8], [74250, 4.8], [74000, 8], [73750, 3.5], [73500, 16.4], [73250, 56.9], [73000, 17.2], [72750, 1.2]]
  note: "Mapa z 21:59, cena wtedy 76 184; pokrycie 46% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: -129.4, note: "140 kont" }
    - { label: "Reszta rynku", value: 7.7, note: "29 190 kont" }
    - { label: "Animatorzy rynku", value: -13.3, note: "230 kont" }
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

Dziś rozliczam dwie mapy z okolic otwarcia Nowego Jorku, obie z oknem do 19:30. W [mapie przed Nowym Jorkiem](../2026-11-05-mapa-przed-nowym-jorkiem/) z 14:50 przedział 68% na koniec okna stał od 78 881 do 80 797. Cena skończyła okno na 76 168, czyli wyraźnie pod nim. Żaden poziom nad ceną nie został dotknięty, choć model dawał 98% na VWAP −1σ przy 79 854, 85% na 80 000 i 63% na VWAP przy 80 257. Na dole za to padło wszystko: VWAP −2σ 79 451 (66%) o 15:14, 79 000 (37%) o 15:38, klastry likwidacji longów 78 750 (24%) i 78 650 (21%), a o 16:01 nawet 77 850 i VAL 77 760, którym mapa dawała tylko 4% i 3%. Brier tej mapy to 0,358, słaby wynik.

Mapa z [otwarcia Nowego Jorku](../2026-11-05-otwarcie-nowego-jorku/) z 15:45 była już przesunięta w dół, przedział 68% od 78 173 do 79 576, i znów cena skończyła pod nim. Trafiła klaster longów 78 850 (98%, dotknięty o 15:46) i 78 550 (62%), ale 79 000 z 85% i VWAP −2σ 78 966 z 89% zostały nad ceną. Poziomy 78 000 (20%), VAL 77 760 (10%) i klaster 77 050 (1%) padły w kwadrans po 16:00. Brier 0,211. Cały dzień opublikowanych map, także [mapa dnia](../2026-11-05-mapa-dnia/), [otwarcie Londynu](../2026-11-05-otwarcie-londynu/), [aktualizacja z 12:00](../2026-11-05-aktualizacja-12/), [rozliczenie Londynu](../2026-11-05-rozliczenie-londynu/) i [aktualizacja z 20:00](../2026-11-05-aktualizacja-20/), daje Brier 0,206 wobec 0,195 dla stałej częstości.

## Jak przebiegł dzień

Sesja Nowego Jorku zaczęła się od szczytu 79 603 o 15:30 i właściwie od razu poszła w dół. Dołek 75 538 przyszedł o 16:53, zakres sesji to 4065 USD, czyli 5,38%, a ostatni odczyt to 76 231. CVD sesji wyszło −363 BTC przy wolumenie 38 245 BTC, a kupno stanowiło 50% obrotu, więc sama proporcja agresorów była wyrównana. Ważniejsze jest open interest: plus 7,06% przy cenie niższej o 4,13%, czyli w spadek wchodziły nowe shorty, a nie tylko wypadały longi.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Doba zaczęła się wysoko, szczyt 24 h to 80 923 o 23:45 we środę, a dołek 75 538 dziś po 16:45. Cena zeszła pod PDL 75 687 trzy razy, w świecach od 16:45, 17:00 i 19:00, i za każdym razem zamknęła się nad nim. Na razie to więc nieudane wybicie dołu poprzedniego dnia, a nie przyjęcie niższych cen. PDH 81 177 jest daleko i dziś nie miał znaczenia.

**Wartość.** Obszar wartości z 24 h rozciąga się od VAL 75 525 do VAH 79 725, a POC stoi na 76 100. Cena 76 231 jest w środku wartości, tuż nad POC, bo większość wolumenu doby przehandlowano już po spadku. Dołek 75 538 zatrzymał się 13 USD nad VAL, więc pod obszarem wartości nie było w ogóle handlu, a najniższe zamknięcie 15 min to 75 924.

**VWAP.** VWAP dnia to 77 695 przy σ 1727, cena jest 0,85σ pod nim. Każde zamknięcie 15 min od 08:15 jest pod VWAP. Wsparciem było pasmo −1σ: między 18:00 a 18:45 cena zamykała się pod nim, ale od 19:00 wszystkie zamknięcia są nad pasmem, które teraz stoi przy 75 968.

**Przepływ i pozycje.** Delta z ostatniej godziny to −128,1 BTC, z czterech godzin −319 BTC, a cena w tym czasie spadła o 139 i 167 USD. OI urosło o 216,5 BTC w godzinę i 796,5 BTC w cztery godziny, do 41 691 BTC. Cena w dół i OI w górę to według macierzy nowe shorty. Duża ujemna delta przy spadku tylko o 167 USD oznacza jednak, że sprzedający w ostatnich godzinach mało przesunęli cenę, i to jest dla mnie ciekawsze niż sama delta.

## Footprint wieczornej konsolidacji przy 76 000

[[footprint]]

Ostatnie dwie godziny to walka o 76 000. W świecy od 20:15 sprzedający postawili stos nierównowag 76 050, 76 100, 76 150 i zamknęli ją na 76 045 przy delcie −78,1 BTC. Odpowiedź przyszła od razu: świeca od 20:30 z deltą +73,7 BTC zamknęła się na 76 420, a OI spadło o 101,1 BTC, więc część shortów zamykała pozycje. Potem dwie świece z deltą −119,9 i −129,3 BTC zeszły najniżej do 76 010, a kolejne dołki 75 957 i 75 953 przyszły przy wolumenie spadającym z 347,5 do 208,1 BTC. To wygląda na absorpcję i wyczerpanie podaży w okolicy 75 900, przynajmniej na ten wieczór.

Linia frontu to dziś stos nierównowag sprzedaży 76 050 do 76 150 i POC świec przy 76 000 i 76 050 pod nim. Ostatnie POC świec stoją na 76 200 i 76 250. Dopóki cena trzyma się nad 75 950, gdzie w świecach od 21:30 była nierównowaga kupna, sprzedający nie mają kontynuacji.

## Gdzie leży płynność

[[likwidacje]]

W 24 h zlikwidowano 31,9 mln USD, z czego 30,5 mln to longi, a największy skok przyszedł w kwadransie od 16:00. W 1% pod ceną wisi jeszcze 12,6 mln USD longów, najwięcej w przedziałach 75 000 (46,7 mln) i 75 250 (25,8 mln), a niżej duży klaster przy 73 250 (56,9 mln). Nad ceną w 1% jest tylko 1,2 mln USD shortów, większa kupka dopiero przy 79 500 (21,8 mln). Mapa pokazuje 46% otwartych pozycji.

## Kto handluje

[[przeplywy]]

Przepływ agresorów z 24 h to −135,0 mln USD. Prawie całość to wieloryby, 140 kont i −129,4 mln USD, animatorzy rynku dołożyli −13,3 mln, a reszta rynku, 29 190 kont, kupowała netto 7,7 mln USD. Funding 0,13 bp/h przy średniej z doby 0,11 bp/h i premia perp 1,0 bp przy średniej −1,9 bp nie pokazują przegrzania w żadną stronę.

## Zmienność i rozkład

Odchylenie zwrotów 5 min z 24 h to 16,3 bp wobec 12,5 bp z poprzednich pięciu dni roboczych. Prognoza desku na 4 h z 21:47 przy cenie 76 222 ma medianę 76 247, połowę rozkładu od 75 760 do 76 734 i 90% od 75 043 do 77 431. Model zakłada brak kierunku, więc to opis szerokości, nie przewidywanie strony.

## Kalibracja

Opublikowane mapy dnia dały 79 ocen dotknięć i 21 trafień, czyli 27%. Brier 0,206 wobec 0,195 dla stałej częstości, więc dziś model wypadł trochę gorzej niż proste zgadywanie średniej. Widać też, gdzie: poziomom z szansą od 0 do 10% (średnio 2%) wpadło 12%, a tym z przedziału 70 do 90% (średnio 81%) tylko 50%. To typowy obraz dnia z jednym dużym ruchem w jedną stronę, kiedy poziomy blisko ceny po drugiej stronie zostają nietknięte. Mapy nakładają się na siebie i powtarzają te same poziomy, więc to nie są niezależne próby. Przy kilkudziesięciu ocenach to jeszcze w dużej mierze szum, ale zapisuję to bez upiększania.

## Na co patrzę dalej

Na noc patrzę na 75 950 i PDL 75 687. Zamknięcia pod nimi przy rosnącym OI znaczyłyby, że nowe shorty dalej dociskają, a pod ceną czeka gruby klaster longów przy 75 000 i 75 250. Z drugiej strony powrót nad 76 450 przy spadającym OI byłby zamykaniem shortów z dzisiejszego spadku. Pasmo VWAP −1σ przy 75 968 jest teraz najbliższym punktem odniesienia z wykresu.

## Rzetelność modelu

Na dłuższym dzienniku desku przedziały 90% na 1 h obejmują 92% wyników, a 60% obejmuje 70% (n 1377); na 4 h odpowiednio 90% i 71% (n 1365), więc węższe przedziały są raczej za szerokie. Dotknięcia PDH, PDL i środka doby mają Brier 0,076 wobec 0,125 dla częstości bazowej (n 1373). Dzisiejszy słabszy wynik map nie zmienia tego obrazu, ale pokazuje, że w dni trendowe przedział 68% potrafi zostać daleko za ceną.

Wszystkie prawdopodobieństwa pochodzą z modelu zmienności desku HAR + FHS i symulacji Monte Carlo, zapisane przed faktem i ocenione na świecach z taśmy. Następny wpis to mapa dnia w piątek o 08:00.
