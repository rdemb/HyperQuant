---
title: "Rozliczenie tygodnia: Brier map 0,120 wobec 0,207 dla stałej częstości"
description: "23 opublikowane mapy, 489 ocen dotknięć i 20 z 23 zakresów 68% trafionych. Gdzie mapy działały, gdzie przesadzały i co z tego wynika na kolejny tydzień."
date: 2026-11-14T10:00:16+01:00
type: article
section: Rozliczenie tygodnia
summary:
  - "Opublikowane mapy tygodnia mają Brier 0,120 wobec 0,207 dla stałej częstości, czyli BSS 0,42 na 489 ocenach dotknięć."
  - "Zakres 68% objął cenę w 20 z 23 map (87%), więc przedziały były wyraźnie za szerokie."
  - "Poziomy z szansą od 90 do 100% (średnio 96%) zostały dotknięte tylko w 78% przypadków, to największe przeszacowanie tygodnia."
  - "Najsłabsza mapa to czwartek 12:00 z Brierem 0,291, najlepsza piątek 08:05 z Brierem 0,028."
metrics:
  - { label: "Premia perp", value: "−4,6 bp", note: "średnio 24 h −3,9 bp" }
  - { label: "Funding", value: "0,05 bp/h", note: "średnio 24 h 0,07 bp/h" }
  - { label: "Longi w 1% pod ceną", value: "10,3 mln USD", note: "do likwidacji między 66 330 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "3,3 mln USD", note: "do likwidacji między ceną a 67 670" }
  - { label: "Arkusz ±10 bp: bidy", value: "52% bidów", note: "zwykle o tej godzinie 50% (23 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "18,0 bp", note: "poprzednie dni robocze (5): 13,4 bp" }
---
## Co mówiły mapy tygodnia

Od poniedziałku do piątku opublikowałem 23 mapy i aktualizacje. Razem dały 489 ocen dotknięć poziomów, z czego 143 poziomy zostały faktycznie dotknięte, czyli 29%. Brier wszystkich opublikowanych map wyszedł 0,120. Dla porównania ktoś, kto każdemu poziomowi dawałby tę samą stałą szansę, miałby 0,207. Niższy Brier jest lepszy, więc mapy wyraźnie biły zgadywanie średniej, BSS wynosi 0,42.

Najlepiej wypadły poranki. [Mapa dnia](../2026-11-13-mapa-dnia/) z piątku miała Brier 0,028, a VWAP (77%) i 69k (88%) zostały dotknięte. Podobnie [mapa dnia](../2026-11-09-mapa-dnia/) z poniedziałku z Brierem 0,031, gdzie dotknięte były VAL, VWAP −1σ, VWAP −2σ, 74k i dołek Azji. Najgorzej poszła [aktualizacja](../2026-11-12-aktualizacja-12/) z czwartku 12:00: Brier 0,291 i nietrafiony zakres 68%, bo cena doszła do klastrów likwidacji longów 44,0 mln i 41,6 mln, którym mapa dawała tylko 7% i 3%. Zakres 68% nie objął ceny jeszcze dwa razy, we wtorek i w środę po otwarciu Nowego Jorku o 15:45 ([otwarcie nowego jorku](../2026-11-10-otwarcie-nowego-jorku/), [otwarcie nowego jorku](../2026-11-11-otwarcie-nowego-jorku/)).

## Jak przebiegł tydzień

Tydzień zaczął się wysoko. W poniedziałek mapy dotykały 75k i otwarcia tygodnia, a [mapa przed Nowym Jorkiem](../2026-11-09-mapa-przed-nowym-jorkiem/) trafiła w strefę likwidacji shortów 4,3 mln. We wtorek rynek zszedł do 74k i niżej, w środę wrócił pod VAH i szczyt Azji. Czwartek przyniósł mocniejszy zjazd przez 73k i 72k z klastrami likwidacji longów po drodze ([podsumowanie dnia](../2026-11-12-podsumowanie-dnia/)), a w piątek rano mapa wskazywała już okolice 69k.

## Kalibracja

Przy niskich szansach mapy były w porządku. Poziomy z szansą do 10% dostały średnio 3% i faktycznie dotknięte było 2%. Między 10 a 30% model dawał średnio 19%, a wyszło 13%, czyli lekko za dużo. Najwyraźniej nie zadziałała górna półka: przy szansie od 90 do 100%, średnio 96%, dotknięcia wyszły tylko w 78% przypadków. Model był za to zbyt ostrożny w środku skali, przy szansach od 50 do 70% dawał średnio 60%, a dotknięć było 64%. Zakres 68% objął cenę w 20 z 23 map, czyli 87% wobec celu 68%, więc przedziały były za szerokie. Trzeba to powiedzieć wprost: to jeden tydzień, a mapy powtarzają te same poziomy, więc oceny nie są niezależne. Przy tej liczbie ocen to wciąż w dużej mierze szum.

## Na co patrzę dalej

Na kolejny tydzień najważniejsze są dwie rzeczy. Czy przeszacowanie poziomów powyżej 90% się powtórzy, i czy zakres 68% dalej łapie cenę częściej, niż powinien. Jeśli tak, to sygnał, że model zawyża szanse blisko ceny i jednocześnie rysuje zbyt szerokie przedziały. Zmienność 5 min z ostatniej doby to 18,0 bp wobec 13,4 bp z poprzednich dni roboczych, więc weekend zaczyna się w żywszym rynku niż zwykle.

## Rzetelność modelu

W dłuższym dzienniku desku przedziały 1 h o pokryciu 90% obejmują cenę w 92% przypadków, a przedziały 60% w 71% (n 2193), czyli ten drugi jest za szeroki, tak jak zakres 68% w tym tygodniu. Dotknięcia PDH, PDL i środka mają Brier 0,070 wobec 0,079 dla bazy odległości i 0,119 dla częstości bazowej, czyli BSS 0,10 wobec odległości i 0,41 wobec częstości (n 2189). Przewaga nad samą odległością od ceny jest więc niewielka.

Wszystkie prawdopodobieństwa pochodzą z modelu desku HAR + FHS i symulacji Monte Carlo, każda mapa była zapisana przed faktem, a ocena idzie na świecach 5 min. Kolejny wpis to aktualizacja o 14:00, a mapa na weekend o 22:00.
