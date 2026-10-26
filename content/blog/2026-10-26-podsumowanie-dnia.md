---
title: "Poniedziałek rozliczony: Brier opublikowanych map 0,128 wobec 0,250 stałej częstości"
description: "BTC zamyka Nowy Jork przy 79 984 po szczycie 80 835 i odrzuceniu. Rozliczam 87 ocen dotknięć z opublikowanych map: 45 trafień, Brier 0,128, a górne poziomy nad 81 000 zostały nietknięte."
date: 2026-10-26T21:05:34+01:00
type: article
section: Podsumowanie dnia
price: 79984
summary:
  - "Opublikowane mapy dnia dały 87 ocen dotknięć i 45 trafień, Brier 0,128 wobec 0,250 dla stałej częstości."
  - "Sesja Nowego Jorku zrobiła szczyt 80 835 o 16:21 i zeszła do 79 984; zakres sesji 1405 USD, czyli 1,77%."
  - "Przy szczycie delta świecy wynosiła +447,5 BTC, a cena zamknęła 288 USD niżej; kupujący zostali wchłonięci."
  - "Pod ceną w 1% stoi 20,6 mln USD longów do likwidacji, nad ceną tylko 0,2 mln USD shortów."
metrics:
  - { label: "Premia perp", value: "−3,4 bp", note: "średnio 24 h −3,8 bp" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,09 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "−28,5 mln USD", bias: down, note: "kupno biorców 334,0, sprzedaż 362,5 mln USD" }
  - { label: "Likwidacje 24 h", value: "9,9 mln USD", note: "longi 7,1, shorty 2,8 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "20,6 mln USD", note: "do likwidacji między 79 184 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "0,2 mln USD", note: "do likwidacji między ceną a 80 784" }
  - { label: "Arkusz ±10 bp: bidy", value: "46% bidów", note: "zwykle o tej godzinie 50% (5 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "12,5 bp", note: "poprzednie dni robocze (5): 10,5 bp" }
liquidations:
  step: 250
  coverage: 44
  shorts: [[83500, 0.2], [83250, 1.9], [83000, 6.1], [82750, 1.4], [82500, 3.4], [82250, 1.1], [82000, 0.8], [81750, 27.8], [81500, 4.1], [81250, 4.7], [81000, 12], [80750, 25.7], [80500, 0.2]]
  longs: [[79500, 4.7], [79250, 6.3], [79000, 24], [78750, 24.5], [78500, 24.6], [78250, 10.6], [78000, 8.3], [77750, 3.8], [77500, 16.5], [77250, 11.1], [77000, 18.6], [76750, 3.7], [76500, 31.2], [76250, 0.4]]
  note: "Mapa z 21:02, cena wtedy 79 907; pokrycie 44% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: -19, note: "80 kont" }
    - { label: "Reszta rynku", value: -5.7, note: "18 560 kont" }
    - { label: "Animatorzy rynku", value: -3.9, note: "210 kont" }
---
## Co mówiły dzisiejsze mapy

Przed Nowym Jorkiem opublikowałem dwie mapy z oknem do 18:30. W mapie z 13:50 ([mapa przed nowym jorkiem](../2026-10-26-mapa-przed-nowym-jorkiem/)) zakres 68% wynosił od 79 484 do 81 236 i cena na koniec okna, 80 324, w nim została. Dołem trafiły wszystkie bliskie poziomy: PDL 79 817 przy 52% dotknięty o 14:30 i VWAP −1σ 79 638 przy 39% o 14:35. Górą dotknięte zostały VAH 80 680 przy 68% i klaster shortów 80 650 przy 71%, oba o 16:21. Nie doszły za to PDH 81 014 przy 42%, okrągłe 81 000 przy 43% i shorty przy 81 050 przy 40%. Brier tej mapy to 0,091.

Aktualizacja z 14:45 ([otwarcie nowego jorku](../2026-10-26-otwarcie-nowego-jorku/)) wypadła słabiej, Brier 0,160. Po porannym zjeździe dała VAH 80 680 tylko 21%, shortom przy 80 650 23%, a VWAP +2σ 80 502 32%, i wszystkie trzy zostały dotknięte. Dół z kolei nie przyszedł: VWAP −2σ 79 351 i Azja L 79 347, oba po 49%, zostały nietknięte. Zakres 68% od 79 098 do 80 541 objął cenę końca okna. Wszystkie opublikowane mapy dnia razem: 87 ocen dotknięć, 45 trafień, Brier 0,128 wobec 0,250 dla stałej częstości. Wcześniejsze wpisy: [mapa dnia](../2026-10-26-mapa-dnia/), [otwarcie londynu](../2026-10-26-otwarcie-londynu/), [aktualizacja 4h](../2026-10-26-aktualizacja-12/), [rozliczenie londynu](../2026-10-26-rozliczenie-londynu/), [aktualizacja 4h](../2026-10-26-aktualizacja-20/).

## Jak przebiegł dzień

Sesja Nowego Jorku od 14:30 do 21:00 zaczęła się od zejścia do dołka 79 430 o 14:36, potem przyszło odbicie do szczytu 80 835 o 16:21, a na koniec cena oddała większość ruchu i stoi przy 79 984. Zakres sesji to 1405 USD, czyli 1,77%. Agresywni kupujący mieli lekką przewagę: CVD sesji +692 BTC, kupno 52% obrotu przy wolumenie 15 194 BTC. Open interest spadł o 0,60% przy cenie wyżej o 0,08%, więc sesja bardziej zamykała pozycje, niż je otwierała.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Cena stoi między PDH 81 014 a PDL 79 817, bliżej dolnej granicy. Zakres ostatnich 24 godzin to od 79 347 (02:45) do 80 835 (16:15), a popołudniowe wyjście w górę nie doszło do PDH i zostało odrzucone. To było nieudane wybicie, a nie ruch z kontynuacją.

**Wartość.** POC z 24 godzin to 80 250, obszar wartości od 79 775 do 80 450. Cena 79 984 jest w środku wartości. Wyjście nad VAH po 16:00 nie zostało zaakceptowane: cena wróciła do obszaru w ciągu godziny, a świeca szczytu zostawiła długi górny knot.

**VWAP.** VWAP dnia to 80 040,6 przy σ 309,5, cena jest 0,18σ pod nim, czyli praktycznie na nim. Pasmo +2σ zadziałało jako opór na szczycie, a wieczorem cena kręci się wokół samego VWAP, co pokazuje rynek w równowadze.

**Przepływ i pozycje.** Taśma obejmuje pełną dobę od 21:00 w niedzielę. Delta z całej doby to −1001,8 BTC. W ostatnich 4 godzinach cena spadła o 424 USD, delta wyniosła −153,9 BTC, a OI spadło o 285,5 BTC: cena w dół i OI w dół to zamykanie longów. W ostatniej godzinie cena +31 USD, delta +21,5 BTC i OI +223,6 BTC, więc wieczorem pozycje znów lekko przybywają, ale bez kierunku w cenie.

## Footprint szczytu dnia

[[footprint]]

Inicjatywę mieli kupujący od świecy 15:45 (delta +146,7 BTC, OI +242,5 BTC, nowe longi) i po spokojnej świecy 16:00 przyszło wybicie o 16:15: szczyt 80 835, wolumen 972,7 BTC, delta +447,5 BTC i nierównowagi kupna na 80 550, 80 600, 80 750 i 80 800. Mimo tej delty świeca zamknęła się przy 80 547. To jest absorpcja: duża delta kupna bez utrzymania ceny. Kolejna świeca zrobiła 80 801 przy delcie tylko +9 BTC i spadku OI o 145,9 BTC, czyli wyczerpanie. Odpowiedź sprzedających przyszła o 17:00 (delta −350,2 BTC, OI −304,6 BTC, zamykanie longów) i o 17:15 (delta −273,7 BTC, OI +589,8 BTC, nowe shorty), a o 17:30 przy dołku 79 759 delta +296,4 BTC i OI −561,6 BTC pokazały zamykanie shortów.

Linia frontu po tej sekwencji: POC świecy szczytu 80 800 to górna granica, nierównowagi sprzedaży na 80 400 i 80 500 z 16:45 to strefa, którą sprzedający bronili w drodze w dół, a nierównowagi kupna na 79 800 i 79 850 z 17:30 to miejsce, gdzie kupujący odpowiedzieli. Cena stoi dziś wieczorem pomiędzy tymi dwoma pasami.

## Gdzie leży płynność

[[likwidacje]]

Mapa jest asymetryczna. W 1% pod ceną czeka 20,6 mln USD longów do likwidacji, a w 1% nad ceną tylko 0,2 mln USD shortów. Największe skupiska shortów są dalej, przy 80 750 (25,7 mln USD) i 81 750 (27,8 mln USD). Pod ceną gęsto robi się od 79 000 do 78 500, po około 24 mln USD na przedział. W ciągu doby zlikwidowano 9,9 mln USD, z czego 7,1 mln USD to longi, głównie w nocy o 02:30.

## Kto handluje

[[przeplywy]]

Przez dobę agresorzy netto sprzedali za 28,5 mln USD. Największą część dały wieloryby, −19 mln USD z 80 kont, reszta rynku dołożyła −5,7 mln USD, a animatorzy −3,9 mln USD. Funding 0,13 bp/h przy premii perp −3,4 bp nie pokazuje przegrzania po żadnej stronie.

## Zmienność i rozkład

Zmienność zwrotów 5 min z ostatniej doby to 12,5 bp wobec 10,5 bp w poprzednich dniach roboczych, więc rynek był dziś żywszy niż zwykle. Prognoza desku na 4 godziny z 21:01 przy cenie 79 968 daje medianę 79 967, połowę rozkładu od 79 556 do 80 387, a 90% od 78 947 do 81 006.

## Kalibracja

Liczę tylko opublikowane prognozy: 87 ocen dotknięć, 45 trafień, czyli 52%. Brier 0,128 wobec 0,250 dla stałej częstości, BSS 0,49. W koszyku 50 do 70% było 13 ocen ze średnią prognozą 61%, a dotknięć 100%, w koszyku 70 do 90% 16 ocen przy 80% prognozy i 94% dotknięć. Przy poziomach poniżej 10% (16 ocen, średnio 4%) nic nie zostało dotknięte. Dziś model był więc raczej zbyt ostrożny w środku rozkładu. Prognozy dnia nakładają się, te same poziomy wracają w kilku mapach, więc to nie są niezależne próby. Przy kilkudziesięciu ocenach to wciąż w dużej mierze szum.

## Na co patrzę dalej

Na noc patrzę na pas 79 800 do 79 850, gdzie kupujący odpowiedzieli po szczycie, i na VAL 79 775 tuż pod nim. Zejście pod ten pas otwiera drogę w gęstą płynność longów od 79 000 do 78 500. Z góry punktem odniesienia jest POC 80 250 i strefa 80 400 do 80 500, gdzie sprzedający bronili się po południu. Dopiero akceptacja nad VAH 80 450 zmieniłaby obraz z dnia odrzuconego wybicia.

## Rzetelność modelu

Przedziały desku są na razie zbyt szerokie: przedział 90% na 1 godzinę objął 95% wyników, a 60% objął 72% (n 414); na 4 godziny odpowiednio 98% i 78% (n 402). Dotknięcia PDH, PDL i środka mają Brier 0,067 wobec 0,096 dla częstości bazowej (n 410), więc tu model jest lepszy od samej częstości.

Wszystkie prawdopodobieństwa pochodzą z modelu desku HAR + FHS i symulacji Monte Carlo, zostały zapisane przed faktem i są ocenione na świecach po zamknięciu okna. Następny wpis to mapa dnia we wtorek o 08:00.
