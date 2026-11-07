---
title: "Rozliczenie tygodnia: Brier 0,121 wobec 0,208, zakres 68% trafiony 21 razy na 28"
description: "574 oceny dotknięć z opublikowanych map od 02.11 do 07.11. Model wyraźnie lepszy od stałej częstości, ale w przedziale 30–50% przeszacował."
date: 2026-11-07T10:00:22+01:00
type: article
section: Rozliczenie tygodnia
summary:
  - "Opublikowane mapy dały Brier 0,121 wobec 0,208 dla stałej częstości, czyli BSS 0,42 na 574 ocenach dotknięć."
  - "Zakres 68% objął cenę w 21 z 28 map (75%), a wszystkie 7 pudeł przypadło na okolice otwarcia Nowego Jorku i środek dnia."
  - "Poziomy z szansą 30–50% padały w 27% przypadków przy średniej prognozie 40%, to główne przeszacowanie tygodnia."
  - "Najsłabsza mapa tygodnia to ta przed Nowym Jorkiem 05.11 z Brierem 0,358, najlepsza aktualizacja 04.11 wieczorem z 0,019."
metrics:
  - { label: "Premia perp", value: "−2,4 bp", note: "średnio 24 h −1,4 bp" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,12 bp/h" }
  - { label: "Longi w 1% pod ceną", value: "0,0 mln USD", note: "do likwidacji między 75 367 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "17,9 mln USD", note: "do likwidacji między ceną a 76 889" }
  - { label: "Arkusz ±10 bp: bidy", value: "48% bidów", note: "zwykle o tej godzinie 51% (16 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "11,1 bp", note: "poprzednie dni robocze (5): 14,3 bp, spokojniej niż w tygodniu" }
---
## Co mówiły mapy tygodnia

Od poniedziałku do piątku opublikowałem 28 map i aktualizacji. Razem dały 574 oceny dotknięć poziomów, z czego 170 poziomów cena faktycznie dotknęła, czyli 30%. Brier dla całości wyszedł 0,121. Gdybym każdemu poziomowi dawał tę samą stałą szansę, wyszłoby 0,208. Różnica to BSS 0,42, więc mapy niosły realną informację ponad zgadywanie częstości.

Najlepiej poszła wieczorna aktualizacja ze środy, 04.11 o 20:00, z Brierem 0,019: VWAP +1σ z szansą 86% i 80k z szansą 65% oba padły. Podobnie wieczór czwartku, Brier 0,031, gdzie 76k z 93% zostało dotknięte. Najgorzej wypadła [mapa przed Nowym Jorkiem](../2026-11-05-mapa-przed-nowym-jorkiem/) z 05.11, Brier 0,358. Dawała VAL tylko 3%, a kilku klastrom likwidacji longów od 4% do 24%, a cena zeszła niżej, niż model zakładał. Ta sama środa po południu ([mapa przed Nowym Jorkiem](../2026-11-04-mapa-przed-nowym-jorkiem/)) miała Brier 0,226, bo klastry shortów z szansą 14% i 33% też zostały zebrane.

## Jak przebiegł tydzień

Poniedziałek to zejście: [mapa przed Nowym Jorkiem](../2026-11-02-mapa-przed-nowym-jorkiem/) dawała klastrowi likwidacji longów 20,7 mln tylko 14%, a wieczorem dotknięte było już 77k. Wtorek i środa to odbicie, najpierw przez Azja H i VWAP +2σ, potem w środę po południu przez kolejne klastry shortów aż do 80k. Czwartek znów w dół: od 80k przez 79k i 78k do 76k wieczorem, z klastrami longów 12,2 mln i 11,1 mln po drodze. W piątek cena kręciła się wokół POC, 76k i VWAP, a po południu dotknięte zostało nawet 75k, któremu mapy dawały 36% do 38%. Teraz cena stoi przy 76 128, a zmienność 5 min z ostatniej doby to 11,1 bp wobec 14,3 bp z dni roboczych.

## Kalibracja

Zakres 68% objął cenę w 21 z 28 map, czyli 75% przy celu 68%. Wszystkie siedem pudeł przypadło na środek dnia i godziny wokół otwarcia Nowego Jorku: poniedziałek, środa i czwartek. Tam ruch był większy, niż przewidywał rozkład. W dołach skali było dobrze: poziomy z szansą 0–10% (średnio 3%) padały w 2%, a te z 90–100% (średnio 96%) w 95%. Słabiej w środku: przedział 10–30% średnio 18%, faktycznie 9%, a przedział 30–50% średnio 40%, faktycznie 27%. To ten drugi uznaję za główny problem tygodnia, model przeszacowywał poziomy z umiarkowaną szansą.

Uczciwie: mapy się nakładają, te same poziomy wracają w kilku aktualizacjach jednego dnia, więc 574 oceny to dużo mniej niezależnych prób. Przy tej liczbie to jeszcze w dużej mierze szum i nie zmieniam niczego w modelu po jednym tygodniu.

## Na co patrzę dalej

Sprawdzam, czy przeszacowanie w środkowych przedziałach utrzyma się kolejny tydzień i czy pudła zakresu dalej skupiają się przy otwarciu Nowego Jorku. Na weekend obraz jest spokojniejszy: nad ceną do 76 889 leży 17,9 mln USD shortów do likwidacji, a pod ceną do 75 367 mapa nie pokazuje longów. Arkusz w ±10 bp ma 48% bidów wobec zwykłych 51% o tej godzinie. Wcześniejsze rozliczenie jest tu: [rozliczenie tygodnia](../2026-10-31-rozliczenie-tygodnia/), a tydzień zaczęła [mapa tygodnia](../2026-11-01-mapa-tygodnia/).

## Rzetelność modelu

Na dłuższej historii przedziały 4 h modelu desku obejmują cenę w 91% przy nominalnych 90% i w 73% przy nominalnych 60% (n 1509), więc węższy przedział jest raczej za szeroki. Dotknięcia PDH, PDL i środka mają Brier 0,072 wobec 0,117 dla częstości bazowej (n 1517).

Wszystkie prawdopodobieństwa pochodzą z modelu desku HAR + FHS i symulacji Monte Carlo, zapisane przed faktem i ocenione później na świecach 5 min. Następny wpis to aktualizacja 4h o 14:00.
