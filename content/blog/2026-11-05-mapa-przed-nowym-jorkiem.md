---
title: "BTC zjechał pod 80 000 przed Nowym Jorkiem. VWAP dnia 80 257 z 63% szans na dotknięcie"
description: "Godzinę przed otwarciem Nowego Jorku cena stoi na 79 745, pod obszarem wartości doby. Zakres 68% do 19:30 to od 78 881 do 80 796, nad ceną czeka 22,2 mln USD shortów do likwidacji."
date: 2026-11-05T14:50:22+01:00
type: article
section: Mapa przed Nowym Jorkiem
price: 79745
levels:
  - { label: "VAH wczoraj", price: 81040, note: "21% dotknięcia do 19:30" }
  - { label: "Szczyt Azji", price: 80888, note: "27% dotknięcia do 19:30" }
  - { label: "POC wczoraj", price: 80620, note: "40% dotknięcia do 19:30" }
  - { label: "Likwidacje shortów", price: 80550, note: "22,2 mln USD, 44% dotknięcia do 19:30" }
  - { label: "Otwarcie Londynu", price: 80359, note: "56% dotknięcia do 19:30" }
  - { label: "VWAP dnia", price: 80257, note: "63% dotknięcia do 19:30" }
  - { label: "Dołek Azji", price: 80217, note: "67% dotknięcia do 19:30" }
  - { label: "Likwidacje longów", price: 78750, note: "5,4 mln USD, 24% dotknięcia do 19:30" }
  - { label: "Likwidacje longów", price: 78650, note: "12,9 mln USD, 21% dotknięcia do 19:30" }
scenarios:
  - label: "Cena o 19:30 poniżej 78 750"
    probability: 13
    note: "Potrzebne jest zamknięcie pod dołkiem z 13:45 na 79 520 i dalsza sprzedaż z rosnącym OI, która dojdzie do skupisk longów na 78 750 i 78 650."
  - label: "Cena o 19:30 między 78 750 a 80 220"
    probability: 53
    note: "Najbardziej prawdopodobne jest dalsze krążenie pod obszarem wartości doby, między stosem kupna przy 79 600 a dołkiem Azji 80 217."
  - label: "Cena o 19:30 powyżej 80 220"
    probability: 34
    note: "Cena musi wrócić nad VAL doby 80 025 i nad dołek Azji, a wtedy na drodze stoją VWAP dnia i shorty do likwidacji na 80 550."
summary:
  - "Od 13:30 cena zamyka się pod obszarem wartości doby, którego dolna granica leży na 80 025."
  - "Przez ostatnie 4 godziny cena spadła o 560 USD, a OI wzrosło o 890,6 BTC, co wygląda na otwieranie nowych shortów."
  - "W 1% nad ceną leży 22,2 mln USD shortów do likwidacji, prawie dwa razy więcej niż longów w 1% pod ceną (11,6 mln)."
  - "Model daje 53% na to, że o 19:30 cena będzie między 78 750 a 80 220."
metrics:
  - { label: "Premia perp", value: "0,2 bp", note: "średnio 24 h −3,5 bp" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,07 bp/h, około 11% w skali roku" }
  - { label: "Przepływ agresorów 24 h", value: "−16,6 mln USD", note: "kupno biorców 754,3, sprzedaż 770,9 mln USD" }
  - { label: "Likwidacje 24 h", value: "14,1 mln USD", note: "longi 5,7, shorty 8,4 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "11,6 mln USD", note: "do likwidacji między 78 948 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "22,2 mln USD", note: "do likwidacji między ceną a 80 542" }
  - { label: "Arkusz ±10 bp: bidy", value: "48% bidów", note: "zwykle o tej godzinie 50% (15 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "14,6 bp", note: "poprzednie dni robocze (5): 12,5 bp" }
liquidations:
  step: 250
  coverage: 47
  shorts: [[83250, 1.4], [83000, 10.7], [82750, 1.9], [82500, 47.9], [82250, 4.5], [82000, 14], [81750, 2.5], [81500, 14], [81250, 25], [81000, 29.7], [80750, 0.2], [80500, 27.7]]
  longs: [[79250, 5.1], [79000, 5.1], [78750, 3.3], [78500, 18.5], [78250, 1.8], [78000, 2.7], [77750, 4.7], [77500, 4.8], [77250, 3.7], [77000, 22.6], [76750, 0.5], [76500, 4.1], [76250, 34.1], [76000, 0.1]]
  note: "Mapa z 14:45, cena wtedy 79 780; pokrycie 47% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: -25.3, note: "120 kont" }
    - { label: "Reszta rynku", value: -7.6, note: "25 800 kont" }
    - { label: "Animatorzy rynku", value: 16.3, note: "230 kont" }
setups:
  - name: "Powrót do obszaru wartości doby po zjeździe pod 80 000"
    bias: up
    zone: [80025, 80268]
    window: "do 19:30"
    triggers:
      - "Świeca 15 min zamyka się nad VAL doby 80 025, czyli z powrotem w obszarze wartości."
      - "Delta tej świecy jest dodatnia, a kupujący nie oddają stosu kupna przy 79 600 do 79 700."
      - "OI spada albo stoi, co oznaczałoby zamykanie shortów otwartych od 13:30."
    invalidation: "Zamknięcie 15 min pod 79 520, dołkiem z 13:45, bez powrotu w kolejnej świecy."
    reactions:
      - { label: "VWAP dnia", price: 80257 }
      - { label: "Likwidacje shortów", price: 80550 }
      - { label: "POC wczoraj", price: 80620 }
    evidence: "Reguła powrotu do VWAP w historii desku: 35% z 183 przypadków wobec 43% losowo, czyli bez przewagi. Traktuję to jako opis, nie statystykę."
  - name: "Akceptacja pod wartością i zejście do skupisk longów"
    bias: down
    zone: [79520, 79700]
    window: "do 19:30"
    triggers:
      - "Świeca 15 min zamyka się pod 79 520, czyli pod dołkiem sesji Londynu."
      - "Delta jest wyraźnie ujemna, tak jak na świecy 13:30 (−653 BTC)."
      - "OI dalej rośnie, czyli dochodzą nowe shorty, a nie tylko zamykają się longi."
    invalidation: "Zamknięcie 30 min nad VAL doby 80 025."
    reactions:
      - { label: "Likwidacje longów", price: 78750 }
      - { label: "Likwidacje longów", price: 78650 }
---
## Co się stało

Wczoraj o 15:30, na otwarciu Nowego Jorku, cena wystrzeliła z 78 296 i w niecałą godzinę doszła do 81 177, szczytu doby (świeca 16:15). Dołek doby 78 178 padł chwilę wcześniej, w świecy 15:00. Od tego szczytu przez prawie całą dobę rynek krążył mniej więcej między 79 900 a 80 900. Azja zrobiła szczyt na 80 888 i dołek na 80 217, Londyn otworzył się na 80 359 i przez całe przedpołudnie zsuwał się powoli w dół.

Rozstrzygnięcie przyszło o 13:30. Jedna świeca 15 min zjechała z 80 080 do 79 634, z deltą −653 BTC, a likwidacje longów w tej chwili wyniosły 5,1 mln USD. O 14:45 cena stała na 79 745, pod obszarem wartości doby i pod VWAP dnia.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Wczorajszy dzień miał zakres od 75 687 (PDL) do 81 177 (PDH), więc cena wciąż stoi w górnej części tego ruchu. Wybicie do 81 177 nie dostało jednak kontynuacji: szczyt padł w pierwszej godzinie Nowego Jorku i od tamtej pory żadna z kolejnych prób nie doszła wyżej niż 80 923. Dziś po południu rynek wypadł z dołu tego dobowego pasa.

**Wartość.** POC z 24 godzin leży na 80 625, obszar wartości od 80 025 do 80 875, a cena jest pod nim. Po wczorajszym wybiciu tylko jedna świeca, o 20:45, zamknęła się pod tą granicą (79 948), a już następna wróciła nad 80 000, to było odrzucenie. Dziś jest inaczej: od 13:30 pięć kolejnych świec 15 min zamknęło się pod 80 025, czyli ponad dwie świece 30 min poza obszarem. To wygląda na akceptację niższych cen, przynajmniej do tej pory.

**VWAP.** VWAP dnia stoi na 80 268, a cena jest 1,3σ pod nim (σ 403 USD). Od 08:15 każda świeca 15 min zamknęła się pod VWAP, a od 13:15 każda zamknęła się także pod pasmem −1σ, które od tamtej pory działa jak opór; ostatnio leżało na 79 865. Knot świecy z 13:45 zszedł na chwilę pod pasmo −2σ (wtedy 79 570) do 79 520, ale zamknięcie wróciło nad nie.

**Przepływ i pozycje.** W ostatnich 4 godzinach cena spadła o 560 USD przy delcie −233,8 BTC i wzroście OI o 890,6 BTC. Cena w dół i OI w górę to obraz nowych shortów. W ostatniej godzinie cena dodała 45 USD, delta wyniosła +290,5 BTC, a OI wzrosło o 587,8 BTC: ktoś otwiera longi, ale cena prawie stoi w miejscu, więc kupno jest na razie wchłaniane. Taśma pokrywa pełne 24 godziny, delta za całe okno to −16,2 BTC.

## Footprint zjazdu pod 80 000

[[footprint]]

Inicjatywa należała do sprzedających. Świeca 13:30 ma stos nierównowag sprzedaży od 80 050 do 79 950 i jeszcze dwie przy 79 750 i 79 700, wolumen 1 779 BTC i deltę −653 BTC. Następna, 13:45, dała nowy dołek 79 520 przy wolumenie 1 272 BTC, ale delta wyniosła już tylko −90,9 BTC, a OI skoczyło o 312 BTC. Duży obrót bez dalszego postępu ceny to absorpcja po stronie kupujących. Potem wolumen malał (389, a potem 207 BTC), co wygląda na wyczerpanie sprzedaży, a o 14:30 kupujący odpowiedzieli stosem trzech nierównowag kupna od 79 600 do 79 700, z deltą +387 BTC i wzrostem OI o 280 BTC. Na samym szczycie tej świecy, przy 79 762, około 48,5 BTC kupna zostało wchłonięte przez sprzedających.

Linia frontu jest więc wąska. Na dole stos kupna od 79 600 do 79 700, gdzie leżą też POC ostatnich pięciu świec (79 600 do 79 700). Na górze stos sprzedaży od 79 950 do 80 050, tuż pod VAL doby. Dopóki cena jest między tymi dwoma stosami, żadna strona nie przejęła rynku.

## Gdzie leży płynność

[[likwidacje]]

Mapa pokazuje asymetrię na korzyść shortów. W 1% nad ceną jest 22,2 mln USD shortów do likwidacji, a w 1% pod ceną 11,6 mln USD longów. Pierwsze duże skupisko shortów leży w przedziale od 80 500 (27,7 mln), kolejne od 81 000 (29,7 mln) i od 81 250 (25 mln), a największe na mapie dopiero od 82 500 (47,9 mln). Pod ceną najbliżej jest 5,1 mln od 79 250 i 79 000, a większe skupiska to dopiero 78 500 (18,5 mln) i 77 000 (22,6 mln). Mapa obejmuje 47% otwartych pozycji, więc kwoty są niższe od rzeczywistych.

## Kto handluje

[[przeplywy]]

Przez 24 godziny agresywni sprzedający przeważyli o 16,6 mln USD. Najmocniej sprzedawały wieloryby, 120 kont na −25,3 mln USD, reszta rynku dodała −7,6 mln, a animatorzy rynku przyjęli to po drugiej stronie, +16,3 mln. Kontrakt wrócił z dyskonta: premia perp to 0,2 bp wobec średnio −3,5 bp z doby. Finansowanie 0,13 bp/h jest wyższe od średniej z 24 godzin (0,07 bp/h). Arkusz w ±10 bp od ceny ma 48% bidów, przy typowych 50% o tej godzinie.

## Zmienność i rozkład

[[scenariusze]]

Model liczy σ 120 bp do 19:30. Daje to zakres 68% od 78 881 do 80 796 i 95% od 77 941 do 81 771. Zmienność 5 min z ostatniej doby to 14,6 bp wobec 12,5 bp z pięciu poprzednich dni roboczych, a obecny reżim (9,1 bp na 5 min) trwa około 12 godzin; szansa jego zmiany w najbliższych 25 minutach to 2%. Prognoza desku na 4 godziny z 14:32 ma medianę 79 611 i 50% w przedziale od 79 036 do 80 160. Rynek HIP-4 „BTC powyżej 80 371” z terminem jutro o 07:00 wycenia 32%, model desku 35%, więc różnica jest niewielka.

## Struktura dnia

[[poziomy]]

Cena siedzi pod całym dzisiejszym obszarem odniesienia. Najbliżej nad nią są dołek Azji 80 217 (67% szans na dotknięcie do 19:30) i VWAP dnia 80 257 (63%), wyżej otwarcie Londynu 80 359 (56%) i skupisko shortów 80 550 (44%). Szczyt Azji 80 888 ma 27%, a VAH wczoraj 81 040 już 21%. Pod ceną okrągłe 79 000 ma 37%, a skupiska longów na 78 750 i 78 650 odpowiednio 24% i 21%.

## Co musiałoby się wydarzyć

[[setupy]]

Pierwszy scenariusz to powrót do wartości: zamknięcie nad 80 025 z dodatnią deltą i spadającym OI pokazałoby, że shorty otwarte od 13:30 się zamykają, a wtedy blisko są VWAP dnia i skupisko shortów od 80 500. Drugi to akceptacja niżej: zamknięcie pod 79 520 z ujemną deltą i dalej rosnącym OI otwierałoby drogę do skupisk longów przy 78 750 i 78 650.

## Na co patrzę dalej

Najważniejsze jest pierwsze pół godziny Nowego Jorku i to, czy rynek zostanie między stosami 79 600 a 80 050. Wczoraj otwarcie dało ruch o prawie 2 900 USD w niecałą godzinę, więc sama godzina 15:30 może rozstrzygnąć, który stos pęknie. Patrzę też na OI: jeśli dalej rośnie przy spadającej cenie, przewaga należy do nowych shortów; jeśli spada przy rosnącej cenie, zaczyna się ich zamykanie w stronę 80 550.

## Rzetelność modelu

Przedziały desku w ostatnich tygodniach były raczej za szerokie niż za wąskie: przedział 90% na 4 godziny obejmował 91% wyników, a przedział 60% aż 72% (n 1 336), podobnie na godzinę (92% i 71%, n 1 348). Prognozy dotknięć PDH, PDL i środka zakresu mają Brier 0,073 wobec 0,123 dla częstości bazowej (n 1 344), więc są lepsze niż samo zgadywanie z historii.

Prawdopodobieństwa w tym wpisie pochodzą z modelu desku HAR z bootstrapem filtrowanym (FHS) i symulacji Monte Carlo, liczone o 14:50 i zapisane przed faktem, a o 19:30 rozliczę je z tym, co zrobił rynek. Następny wpis to otwarcie Nowego Jorku o 15:45.
