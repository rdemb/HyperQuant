---
title: "Wybicie do 81 955 i nieudany powrót nad PDH: mapy z Brierem 0,255 wobec 0,234"
description: "Czwartek rozliczony: cena doszła do 81 955, wszystkie poziomy nad ceną padły, żaden pod ceną. Opublikowane mapy dnia z Brierem 0,255 wobec 0,234 dla stałej częstości."
date: 2026-10-29T21:05:33+01:00
type: article
section: Podsumowanie dnia
price: 80817
summary:
  - "Sesja Nowego Jorku zrobiła 2065 USD zakresu (2,58%), od 79 890 o 14:38 do 81 955 o 17:09, i skończyła na 80 817."
  - "Mapa z 13:50 dawała PDH 81 804 tylko 4%, a cena doszła tam o 16:46; wszystkie poziomy pod ceną zostały nietknięte."
  - "Opublikowane mapy dnia mają Brier 0,255 wobec 0,234 dla stałej częstości (83 oceny), więc dziś wypadły gorzej niż prosta reguła."
  - "OI spadło o 1,99% przy cenie wyżej o 0,73%, czyli wzrost w sesji niosło głównie krycie shortów."
metrics:
  - { label: "Premia perp", value: "−2,8 bp", note: "średnio 24 h −2,6 bp" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,12 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "41,1 mln USD", bias: up, note: "kupno biorców 242,4, sprzedaż 201,3 mln USD" }
  - { label: "Likwidacje 24 h", value: "21,0 mln USD", note: "longi 11,5, shorty 9,5 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "4,5 mln USD", note: "do likwidacji między 80 009 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "5,7 mln USD", note: "do likwidacji między ceną a 81 625" }
  - { label: "Arkusz ±10 bp: bidy", value: "48% bidów", note: "zwykle o tej godzinie 50% (8 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "11,8 bp", note: "poprzednie dni robocze (5): 10,3 bp" }
liquidations:
  step: 250
  coverage: 45
  shorts: [[84250, 1.3], [84000, 7.2], [83750, 1.1], [83500, 4.9], [83250, 3.1], [83000, 11.5], [82750, 2.5], [82500, 17.8], [82250, 3.6], [82000, 3.9], [81750, 7.8], [81500, 5.9], [81250, 0.2], [81000, 0.4], [80750, 0.1]]
  longs: [[80500, 0.7], [80250, 1.7], [80000, 3.1], [79750, 2.8], [79500, 19.3], [79250, 5], [79000, 10], [78750, 24.8], [78500, 16.8], [78250, 4.2], [78000, 10.6], [77750, 4.6], [77500, 10.4], [77250, 12.5], [77000, 13.5]]
  note: "Mapa z 21:01, cena wtedy 80 805; pokrycie 45% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: 16.6, note: "90 kont" }
    - { label: "Reszta rynku", value: 5.7, note: "21 790 kont" }
    - { label: "Animatorzy rynku", value: 18.7, note: "210 kont" }
---
## Co mówiły dzisiejsze mapy

Dzień miał kilka wpisów: [mapa dnia](../2026-10-29-mapa-dnia/), [otwarcie Londynu](../2026-10-29-otwarcie-londynu/), [aktualizacja z południa](../2026-10-29-aktualizacja-12/), [rozliczenie Londynu](../2026-10-29-rozliczenie-londynu/), [mapa przed Nowym Jorkiem](../2026-10-29-mapa-przed-nowym-jorkiem/), [otwarcie Nowego Jorku](../2026-10-29-otwarcie-nowego-jorku/) i [aktualizacja z 20:00](../2026-10-29-aktualizacja-20/).

Mapa z 13:50 dawała 68% na zamknięcie okna w przedziale od 79 201 do 80 898. O 18:30 cena była na 81 075, więc poza zakresem. Na górze model był zbyt ostrożny: PDH 81 804 miał 4%, klaster likwidacji shortów przy 81 850 tylko 3%, a oba padły o 16:46. Azja H 81 350 i VAH 81 344 z 12% padły już o 15:36, okrągłe 81 000 z 25% minutę wcześniej. Trafione były też pewniaki: 80 000 z 96% i VWAP 80 122 z 93%.

Pudła są po drugiej stronie i są wyraźne. Otwarcie Londynu 79 826 miało 78%, VWAP −1σ 79 779 miało 74%, Azja L 79 668 miała 63%. Żaden z tych poziomów nie został dotknięty. Brier tej mapy to 0,414. Aktualizacja z 14:45 miała podobny obraz: przedział od 79 232 do 80 694, PDH z 1% dotknięty, Otwarcie Londynu z 84% nie, Brier 0,443. Rynek poszedł w stronę, której model dawał mało, i nie wrócił tam, gdzie dawał dużo.

## Jak przebiegł dzień

Sesja od 14:30 do 21:00 zaczęła się od dołka 79 890 o 14:38. Potem przyszło szybkie podejście: VWAP +1σ o 15:13, VAL 80 606 o 15:32, klaster 80 850 o 15:35 i cała grupa poziomów przy 81 000 do 81 350 do 15:36. Szczyt 81 955 przyszedł o 17:09, a sesja skończyła się na 80 817. Zakres wyniósł 2065 USD, czyli 2,58%.

CVD sesji to +672 BTC, kupno stanowiło 52% obrotu przy wolumenie 15 107 BTC. Open interest spadło przy tym o 1,99%, a cena była wyżej o 0,73%. To obraz krycia shortów, a nie budowania nowych longów.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Z 24 godzin mamy zakres od 79 667 nocą do 81 955 po południu. Cena przebiła PDH 81 804, ale nie utrzymała się nad nim i zjechała z powrotem pod 81 000. To wygląda na nieudane wybicie, a nie na wybicie z kontynuacją. Dołek sesji 79 890 był jeszcze pod PDL 80 362, więc w ciągu dnia cena przeszła cały zakres poprzedniej doby.

**Wartość.** POC z 24 godzin stoi na 81 300, obszar wartości od 80 250 do 81 900. Cena 80 817 jest w środku obszaru. Wyjście ponad VAH 81 900 trwało krótko: świeca ze szczytem 81 955 zamknęła się na 81 691, z długim górnym knotem. Ceny ponad wartością zostały odrzucone.

**VWAP.** VWAP dnia to 80 694 przy σ 635,6, cena jest 0,19σ nad nim, czyli praktycznie przy linii. VWAP +1σ padł o 15:13, VWAP +2σ o 15:33, a wieczorem cena oddała cały ten ruch i wróciła do VWAP z góry.

**Przepływ i pozycje.** Na 4 godziny delta jest dodatnia, +185,4 BTC, a cena niżej o 925 USD i OI niżej o 1 244,9 BTC. Spadek ceny ze spadkiem OI to zamykanie longów, więc mimo dodatniej delty wieczorny zjazd był głównie wychodzeniem z pozycji. W ostatniej godzinie delta −66,5 BTC, cena praktycznie płaska (−25 USD), a OI wzrosło o 130,5 BTC: trochę nowych pozycji bez ruchu ceny. Taśma kończy się o 21:00, pięć minut przed wpisem.

## Footprint szczytu dnia

[[footprint]]

Inicjatywa była po stronie kupujących od 16:30: świeca 15 min z deltą +150 BTC i nierównowagami kupna na 81 450 i 81 550, potem kolejna z +101,6 BTC. Świeca o 17:00 przyniosła szczyt 81 955 przy największym wolumenie w tym oknie, 1 189,6 BTC, delcie +310 BTC i trzech nierównowagach kupna (81 600, 81 750, 81 850). Mimo to OI spadało, a świeca zamknęła się na 81 691. Kupno uderzało w ścianę sprzedających i to była absorpcja na ekstremum. Odpowiedź przyszła od razu: o 17:15 delta −113,8 BTC i zjazd do 81 373, a o 18:00 stos trzech nierównowag sprzedaży na 81 050, 81 100 i 81 200 i zamknięcie na 80 942. Świeca o 18:15 odbiła z deltą +221,5 BTC, ale przy spadku OI o 370 BTC, czyli znów krycie, nie nowe longi.

Linia frontu jest teraz między 81 050 a 81 200, gdzie stoi stos nierównowag sprzedaży, i na 81 000, gdzie POC dwóch świec spotkał się z nierównowagą kupna. Nad tym zostaje POC świecy szczytowej 81 750. Dopóki cena nie wróci nad pas 81 050 do 81 200 z akceptacją, ten obszar traktuję jako opór, który rynek już raz pokazał.

## Gdzie leży płynność

[[likwidacje]]

Według mapy z 21:01 najbliżej ceny jest niewiele: 4,5 mln USD longów w 1% pod ceną i 5,7 mln USD shortów w 1% nad. Większe skupiska są dalej. Pod ceną 19,3 mln USD przy 79 500 i 24,8 mln USD przy 78 750, nad ceną 7,8 mln USD przy 81 750 i 17,8 mln USD przy 82 500. W ciągu doby zlikwidowano 21,0 mln USD, z czego longi 11,5, a shorty 9,5 mln USD.

## Kto handluje

[[przeplywy]]

Przez 24 godziny agresorzy kupili netto za 41,1 mln USD. Najwięcej netto po stronie kupna dały animatorzy rynku, 18,7 mln USD, wieloryby 16,6 mln USD, a reszta rynku 5,7 mln USD. Przy spadku OI w sesji to raczej domykanie krótkich pozycji niż świeży popyt.

## Kalibracja

Wszystkie opublikowane mapy dnia razem dały 83 oceny dotknięć i 31 trafień, czyli 37%. Brier wyniósł 0,255 wobec 0,234 dla stałej częstości, BSS −0,09. Dziś model był gorszy od reguły, która każdemu poziomowi daje tę samą szansę. Najbardziej widać to na krańcach: poziomy z szansą od 0 do 10% (n 27, średnio 3%) zostały dotknięte w 26% przypadków, a te od 70 do 90% (n 8, średnio 80%) tylko w 38%. To znaczy, że rozkład był za wąski i ustawiony w złą stronę. Mapy dnia nakładają się i oceniają te same poziomy, więc to nie są niezależne próby, a przy kilkudziesięciu ocenach to wciąż w dużej mierze szum.

## Na co patrzę dalej

Na noc patrzę na pas 81 050 do 81 200 i na VWAP 80 694. Prognoza desku na 4 godziny ma medianę 80 826, połowę rozkładu od 80 431 do 81 193 i 90% od 79 844 do 81 748. Arkusz w ±10 bp ma 48% bidów przy zwykłych 50% o tej godzinie, a funding 0,13 bp/h jest spokojny. Powrót nad 81 200 z rosnącym OI zmieniłby obraz z krycia na nowe pozycje; zejście pod PDL 80 362 przybliżyłoby skupisko longów przy 79 500.

## Rzetelność modelu

W dzienniku desku przedziały 90% na godzinę obejmują 93% wyników, a przedziały 60% obejmują 71% (n 701). Na 4 godziny to 95% i 75% (n 689), więc przedziały są raczej za szerokie niż za wąskie. Dotknięcia PDH, PDL i środka mają Brier 0,081 wobec 0,117 dla częstości bazowej (n 697), to wyraźnie lepiej niż reguła stała, w przeciwieństwie do dzisiejszych map dnia.

Prawdopodobieństwa pochodzą z modelu desku HAR + FHS i symulacji Monte Carlo, każda mapa była zapisana przed faktem, a ocena idzie na świecach. Rozliczenie liczone o 21:05. Następny wpis to mapa dnia w piątek o 08:00.
