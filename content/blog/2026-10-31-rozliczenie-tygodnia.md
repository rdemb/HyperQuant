---
title: "Rozliczenie tygodnia: Brier 0,157 wobec 0,228 dla stałej częstości w 635 ocenach"
description: "Opublikowane mapy od 26 do 30.10: 635 ocen dotknięć, Brier 0,157 wobec 0,228, zakres 68% trafiony w 22 z 30 map. Czwartek był najsłabszym dniem modelu."
date: 2026-10-31T10:00:24+01:00
type: article
section: Rozliczenie tygodnia
summary:
  - "Opublikowane mapy tygodnia dały 635 ocen dotknięć i Brier 0,157 wobec 0,228 dla stałej częstości, czyli BSS 0,31."
  - "Zakres 68% objął cenę w 22 z 30 map, to 73% przy celu 68%."
  - "Najsłabszy był czwartek: mapa przed Nowym Jorkiem miała Brier 0,414, a aktualizacja z 14:45 aż 0,443."
  - "Przy prognozach od 30 do 50% model dawał średnio 40%, a poziomy dotykano w 28% przypadków."
metrics:
  - { label: "Premia perp", value: "0,5 bp", note: "średnio 24 h −0,1 bp" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,12 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "−91,3 mln USD", bias: down, note: "kupno biorców 284,1, sprzedaż 375,4 mln USD" }
  - { label: "Likwidacje 24 h", value: "22,2 mln USD", note: "longi 19,2, shorty 3,0 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "0,5 mln USD", note: "do likwidacji między 76 537 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "10,1 mln USD", note: "do likwidacji między ceną a 78 083" }
  - { label: "Arkusz ±10 bp: bidy", value: "41% bidów", note: "zwykle o tej godzinie 51% (9 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "11,9 bp", note: "poprzednie dni robocze (5): 11,4 bp" }
---
## Co mówiły mapy tygodnia

Od poniedziałku do piątku opublikowałem 30 map i aktualizacji, a w nich 635 ocen dotknięć poziomów. Poziom został dotknięty w 223 przypadkach, czyli w 35%. Brier wszystkich opublikowanych map wyszedł 0,157, a prognoza, która każdemu poziomowi dawałaby tę samą stałą częstość, miałaby 0,228. To daje BSS 0,31, więc mapy były wyraźnie lepsze od zgadywania jedną liczbą.

Najlepiej wypadły spokojniejsze okna. [Mapa dnia](../2026-10-26-mapa-dnia/) z poniedziałku miała Brier 0,050, a piątkowa [aktualizacja z 20:00](../2026-10-30-aktualizacja-20/) 0,053. We wtorek wszystkie sześć map trafiło zakres 68%, od [mapy dnia](../2026-10-27-mapa-dnia/) z Brierem 0,089 po [otwarcie Londynu](../2026-10-27-otwarcie-londynu/) z 0,070.

Najgorzej poszedł czwartek. [Mapa przed Nowym Jorkiem](../2026-10-29-mapa-przed-nowym-jorkiem/) miała Brier 0,414, [otwarcie Nowego Jorku](../2026-10-29-otwarcie-nowego-jorku/) 0,443, a [aktualizacja z 20:00](../2026-10-29-aktualizacja-20/) 0,435. Wszystkie trzy chybiły zakres 68%. Model dawał 4% na dotknięcie PDH i 3% na klaster likwidacji shortów 5,1 mln, a cena doszła do obu. Wieczorem dawał 6% na klaster longów 16,1 mln i 4% na dołek Azji, i te poziomy też padły. Rynek przeszedł tego dnia dalej w obie strony, niż model zakładał.

## Jak przebiegł tydzień

Poniedziałek i wtorek kręciły się wokół 80k i 81k, mapy prawie zawsze trafiały zakres i Brier rzadko przekraczał 0,16. Wyjątkiem było poniedziałkowe [otwarcie Londynu](../2026-10-26-otwarcie-londynu/) z Brierem 0,209 i chybionym zakresem. W środę w południe zakres 68% znów nie objął ceny ([aktualizacja z 12:00](../2026-10-28-aktualizacja-12/), Brier 0,181). Czwartek od południa to cztery chybione zakresy z rzędu. W piątek poziomy na mapach zeszły już do 77k i 78k, rano [mapa dnia](../2026-10-30-mapa-dnia/) miała Brier 0,274 i dwie pierwsze mapy chybiły zakres, a od 12:00 do wieczora zakres znów był trafiany. Dziś rano cena stoi przy 77 310.

## Kalibracja

Zakres 68% objął cenę w 22 z 30 opublikowanych map, czyli w 73% przy celu 68%. Przy prognozach do 10% model dawał średnio 3%, a dotknięć było 7%. Przy prognozach od 10 do 30% średnio 19%, faktycznie 23%, więc tu był trochę zbyt ostrożny. Największy błąd był w środku skali: od 30 do 50% model dawał średnio 40%, a poziomy dotykano w 28% przypadków. Od 70 do 90% kalibracja wyszła równo, 79% wobec 79%, a na samej górze, od 90%, model dawał średnio 96% przy 87% faktycznych dotknięć.

Trzeba to powiedzieć wprost: 635 ocen brzmi dużo, ale te same poziomy powtarzają się w kilku mapach jednego dnia, więc to nie są niezależne próby. Przy tej liczbie ocen to jeszcze w dużej mierze szum, a jeden dzień taki jak czwartek potrafi przesunąć cały tydzień.

## Na co patrzę dalej

Najpierw środek skali: jeśli w kolejnym tygodniu prognozy około 40% znów będą dotykane rzadziej niż w co trzecim przypadku, to jest sygnał do przyjrzenia się, a nie przypadek. Drugie to dni z szerokim ruchem jak czwartek, bo tam model najmocniej zaniżał szanse odległych poziomów. Teraz nad ceną, do 78 083, leży 10,1 mln USD shortów do likwidacji, a pod ceną w 1% tylko 0,5 mln USD longów. Rozkład desku na 4 h stawia połowę wyników między 76 940 a 77 670.

## Rzetelność modelu

Dziennik desku pokazuje, że przedziały 4 h są raczej za szerokie niż za wąskie: 90% przedział obejmuje cenę w 92% przypadków, a 60% w 72% (n 837). Dotknięcia PDH, PDL i środka mają Brier 0,077 wobec 0,110 dla częstości bazowej (n 845), czyli model jest lepszy od bazy, ale nie nieomylny.

Wszystkie prawdopodobieństwa pochodzą z modelu desku HAR + FHS i symulacji Monte Carlo, każda mapa była zapisana przed faktem, a ocena idzie na świecach 5 minut. Następny wpis to aktualizacja 4h o 14:00.
