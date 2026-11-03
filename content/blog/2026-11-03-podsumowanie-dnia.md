---
title: "BTC kończy dzień przy 77 836, Brier opublikowanych map 0,101 wobec 0,171"
description: "Obie mapy Nowego Jorku utrzymały zakres 68%, trzy dotknięcia nad ceną się spełniły, a 78 000 przy 60% nie padło. Rozliczenie i kalibracja dnia."
date: 2026-11-03T22:05:20+01:00
type: article
section: Podsumowanie dnia
price: 77836
summary:
  - "Obie mapy Nowego Jorku trafiły zakresem 68%: o 19:30 cena 77 644 stała w jego środku."
  - "Trzy dotknięcia nad ceną z szansą od 65% do 98% się spełniły, a 78 000 z szansą 60% nie padło; szczyt sesji to 77 926."
  - "Opublikowane prognozy dnia: 87 ocen, Brier 0,101 wobec 0,171 dla stałej częstości, przy tej liczbie ocen to nadal w dużej mierze szum."
  - "Wieloryby sprzedały agresywnie netto 31,8 mln USD w 24 h, a mimo to cena przez całe popołudnie zamykała się nad VWAP dnia."
metrics:
  - { label: "Premia perp", value: "−2,3 bp", note: "średnio 24 h −2,0 bp" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,12 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "−32,6 mln USD", note: "kupno biorców 191,0, sprzedaż 223,6 mln USD" }
  - { label: "Likwidacje 24 h", value: "12,1 mln USD", note: "longi 6,8, shorty 5,3 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "0,0 mln USD", note: "do likwidacji między 77 058 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "27,5 mln USD", note: "do likwidacji między ceną a 78 614" }
  - { label: "Arkusz ±10 bp: bidy", value: "40% bidów", note: "zwykle o tej godzinie 50% (13 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "10,3 bp", note: "poprzednie dni robocze (5): 12,4 bp" }
liquidations:
  step: 250
  coverage: 46
  shorts: [[81250, 2.8], [81000, 0.9], [80750, 4.3], [80500, 2], [80250, 1.4], [80000, 6.1], [79750, 1.2], [79500, 4.4], [79250, 6.1], [79000, 28.1], [78750, 1.7], [78500, 3.3], [78250, 5], [78000, 19.7], [77750, 0.5]]
  longs: [[76750, 3.3], [76500, 19.8], [76250, 6.9], [76000, 8.5], [75750, 47.1], [75500, 53.3], [75250, 15.2], [75000, 7.1], [74750, 3.5], [74500, 12.2], [74250, 3.3]]
  note: "Mapa z 22:01, cena wtedy 77 813; pokrycie 46% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: -31.8, note: "90 kont" }
    - { label: "Reszta rynku", value: -5.3, note: "18 090 kont" }
    - { label: "Animatorzy rynku", value: 4.4, note: "200 kont" }
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

Rano była [mapa dnia](../2026-11-03-mapa-dnia/), potem [otwarcie Londynu](../2026-11-03-otwarcie-londynu/), [aktualizacja w południe](../2026-11-03-aktualizacja-12/) i [rozliczenie Londynu](../2026-11-03-rozliczenie-londynu/). Tu rozliczam dwie mapy Nowego Jorku z oknem do 19:30.

W [mapie przed Nowym Jorkiem](../2026-11-03-mapa-przed-nowym-jorkiem/) z 14:50 zakres 68% szedł od 76 654 do 78 453. O 19:30 cena była na 77 644, czyli w środku. Trzy najbardziej prawdopodobne dotknięcia nad ceną się spełniły: VWAP +1σ 77 346 przy 82% o 15:00, szczyt Azji 77 306 przy 78% o 15:02 i VWAP +2σ 77 697 przy 87% o 16:46. Pudła były po obu stronach. 78 000 miało 60% i nie padło, POC 78 109 miał 52% i też nie. Na dole VAL 77 026 przy 54%, 77 000 przy 52% i VWAP 76 995 przy 52% zostały nietknięte, bo cena po otwarciu już nie wróciła pod 77 104. Brier tej mapy to 0,109.

[Otwarcie Nowego Jorku](../2026-11-03-otwarcie-nowego-jorku/) z 15:45 zawęziło zakres 68% do przedziału od 76 618 do 78 156 i on też utrzymał cenę. VWAP +1σ 77 366 przy 98% padło o 15:46, szczyt Azji 77 306 przy 93% o 15:47, VWAP +2σ 77 710 przy 65% o 16:46. Nie spełniły się VAL 77 026 i VWAP 77 022 przy 62% oraz 77 000 przy 60%, a 78 000 przy 40% znów zostało nad ceną. Brier 0,097. Wieczorna [aktualizacja](../2026-11-03-aktualizacja-20/) ma okno, które jeszcze trwa.

Wszystkie opublikowane prognozy dnia razem: Brier 0,101 wobec 0,171 dla stałej częstości.

## Jak przebiegł dzień

Sesja nowojorska od 15:30 do 22:00 zaczęła się od dołka 77 104 dokładnie na otwarciu i od tego miejsca cena szła w górę schodami. Szczyt 77 926 przyszedł o 21:58, ostatni odczyt to 77 836. Zakres sesji wyniósł 822 USD, czyli 1,07%, więc spokojnie jak na otwarcie w USA.

Przepływ sesji był wyrównany: CVD +25 BTC, kupno 50% obrotu przy wolumenie 6155 BTC. Open interest urósł o 1,46% przy cenie wyżej o 0,92%, co czytam jako dopisywanie nowych longów, a nie samo zamykanie shortów.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Cena stoi między wczorajszym dołkiem 76 670 a wczorajszym szczytem 78 854. Rano o 7:00 zeszła pod PDL do 76 338, to był dołek doby, ale nie zostało tam nic poza jedną mocną świecą sprzedaży. Do 8:15 cena kręciła się tuż pod i nad PDL, potem wróciła wyżej. Zejście pod wczorajszy dołek okazało się więc nieudanym wybiciem, a dzień zamyka się blisko swojego szczytu 77 926 z 21:45.

**Wartość.** POC z 24 godzin leży na 76 800, obszar wartości od 76 525 do 77 450. Cena jest nad wartością. Od świecy 16:30 każda kolejna świeca 15 min zamykała się nad VAH 77 450, więc ceny nad obszarem wartości zostały zaakceptowane, a nie odrzucone. Wcześniejsza próba o 14:15 skończyła się powrotem do środka już o 14:45.

**VWAP.** VWAP dnia to 77 170, cena jest 1,66σ nad nim. Od świecy 10:15 każde zamknięcie 15 min wypadało nad VWAP. Pasmo +1σ działało wieczorem jak wsparcie: od 16:30 tylko świeca z 20:00 zamknęła się pod nim, o 11 USD, i następna od razu wróciła nad.

**Przepływ i pozycje.** Taśma obejmuje pełne 24 godziny do 22:00. Delta z całej doby to −1739,4 BTC, z ostatnich 4 godzin −335 BTC, a cena w tym czasie wzrosła o 118 USD przy OI wyższym o 233,6 BTC. Cena w górę i OI w górę to nowe longi, tyle że wchodzące limitami, bo agresorzy po stronie sprzedaży dominowali. W ostatniej godzinie cena dodała 245 USD przy OI niższym o 86,2 BTC i delcie −239 BTC, czyli część ruchu to zamykanie shortów. Rozjazd delty z ceną sam w sobie nie jest sygnałem, ale tu sprzedaż agresywna przez cały wieczór nie zdołała zepchnąć ceny.

## Footprint szczytu dnia

[[footprint]]

Od 20:00 do 21:00 cena stała w wąskim pudełku między 77 500 a 77 650, z POC świec na 77 540 i 77 580 i deltą zmieniającą znak co świecę. Świeca 21:00 wybiła do 77 732, ale zamknęła się na 77 603 z deltą −94 BTC, spadkiem OI o 172,4 BTC i trzema nierównowagami sprzedaży: to była odpowiedź sprzedających. Świeca 21:15 wyglądała jak absorpcja: delta −75,6 BTC, a cena wyżej do 77 747. O 21:30 przyszła inicjatywa kupujących, stos nierównowag kupna od 77 840 do 77 880 przy wolumenie 139,6 BTC, mniejszym niż w dwóch poprzednich świecach. Ostatnia świeca 21:45 zrobiła szczyt 77 926, ale z deltą −115,1 BTC, czterema nierównowagami sprzedaży i OI wyższym o 94,6 BTC, czyli na szczycie otwierano nowe shorty. Wolumen na ekstremum wzrósł do 280,4 BTC, więc nie nazwałbym tego wyczerpaniem.

Linia frontu na noc to stos kupna 77 840 do 77 880 z 21:30 i POC ostatniej świecy na 77 840, a pod nimi nierównowagi sprzedaży z 21:45 od 77 780 do 77 840. Niżej punktem odniesienia jest 77 580, POC trzech świec z wieczornej konsolidacji.

## Gdzie leży płynność

[[likwidacje]]

Nad ceną najbliższe większe skupiska shortów do likwidacji są w przedziale 78 000 (19,7 mln USD) i 79 000 (28,1 mln USD); w 1% nad ceną łącznie 27,5 mln USD. Pod ceną w 1% nie ma praktycznie nic, pierwsze większe skupisko longów to 76 500 z 19,8 mln USD, a największe dopiero 75 750 i 75 500 (47,1 i 53,3 mln USD). Mapa pokrywa 46% otwartych pozycji.

## Kto handluje

[[przeplywy]]

W ciągu 24 godzin agresorzy sprzedali netto za 32,6 mln USD, z czego 31,8 mln USD to 90 kont wielorybów. Reszta rynku sprzedała netto 5,3 mln USD, animatorzy rynku kupili 4,4 mln USD. Cena mimo tego rosła od porannego dołka, więc po drugiej stronie stał spokojny popyt z limitów. Arkusz w promieniu 10 bp ma teraz 40% bidów, a zwykle o tej godzinie to 50%.

## Zmienność i rozkład

Zmienność zwrotów 5 min z ostatniej doby to 10,3 bp wobec 12,4 bp w poprzednich pięciu dniach roboczych, dzień był spokojniejszy niż ostatnio. Funding stoi na 0,13 bp/h, a premia perp na −2,3 bp. Prognoza desku na 4 godziny daje medianę 77 804, połowa scenariuszy mieści się między 77 450 a 78 151, a 90% między 76 952 a 78 663.

## Kalibracja

Z opublikowanych prognoz dnia mam 87 ocen dotknięć, z czego 19 się spełniło, czyli 22%. Brier 0,101 wobec 0,171 dla stałej częstości daje BSS 0,41. Rozbicie pokazuje, gdzie model się myli: w przedziale 30 do 50% średnio dawał 38%, a faktycznie dotknięć było 14% (n 21), w przedziale 50 do 70% dawał średnio 60%, a padło 38% (n 13). Przy wysokich szansach było dobrze: 70 do 90% to 79% wobec 75%, a 90 do 100% to 97% wobec 100%. Dziś środek skali był za optymistyczny, co pasuje do dnia z wąskim zakresem. Prognozy z kolejnych map dotyczą tych samych poziomów, więc to nie są niezależne próby, a przy kilkudziesięciu ocenach to wciąż w dużej mierze szum.

## Na co patrzę dalej

Na noc patrzę na to, czy cena utrzyma się nad VAH 77 450 i nad pasmem +1σ. Nad ceną czeka 78 000 ze skupiskiem shortów, a dalej wczorajszy szczyt 78 854. Szczyt dnia przyszedł z nowymi shortami i ujemną deltą, więc pierwsze zamknięcia pod 77 780 byłyby znakiem, że sprzedający przejmują inicjatywę. Dopóki tak nie jest, wieczorny obraz to akceptacja ceny nad wartością przy agresywnej podaży, którą ktoś cierpliwie zbiera.

## Rzetelność modelu

Na 1173 ocenach przedział 90% na 4 godziny obejmuje 93% wyników, a przedział 60% aż 74%, więc model jest na razie trochę zbyt ostrożny i daje za szerokie przedziały. Dotknięcia PDH, PDL i środka mają Brier 0,074 wobec 0,124 dla częstości bazowej (n 1181).

Wszystkie prawdopodobieństwa pochodzą z modelu zmienności HAR z bootstrapem reszt i symulacji Monte Carlo, zapisane przed faktem i rozliczone na świecach po zamknięciu okna. Następna jest mapa dnia w środę około 8:00.
