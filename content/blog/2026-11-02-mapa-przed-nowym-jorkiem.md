---
title: "BTC przed Nowym Jorkiem: odbicie z 77 597 do 78 156 i 36% na zakres do 78 330"
description: "Jedna świeca o 14:30 wyciągnęła BTC z dołka doby do 78 156. Zakres 68% do 19:30 to 77 271 do 78 664, a w 1% nad ceną stoi 8,8 mln USD shortów."
date: 2026-11-02T14:50:22+01:00
type: article
section: Mapa przed Nowym Jorkiem
price: 78156
levels:
  - { label: "PDH", price: 78410, note: "50% dotknięcia do 19:30" }
  - { label: "Otwarcie tygodnia", price: 78326, note: "58% dotknięcia do 19:30" }
  - { label: "VWAP dnia", price: 78169, note: "75% dotknięcia do 19:30" }
  - { label: "VAH wczoraj", price: 78117, note: "82% dotknięcia do 19:30" }
  - { label: "Otwarcie Londynu", price: 78079, note: "87% dotknięcia do 19:30" }
  - { label: "POC wczoraj", price: 78020, note: "94% dotknięcia do 19:30" }
  - { label: "Dołek Azji", price: 77882, note: "91% dotknięcia do 19:30" }
  - { label: "VAL wczoraj", price: 77688, note: "68% dotknięcia do 19:30" }
  - { label: "PDL", price: 77478, note: "47% dotknięcia do 19:30" }
scenarios:
  - label: "Cena o 19:30 poniżej 77 690"
    probability: 35
    note: "Odbicie z 14:30 musiałoby się cofnąć w całości, a sprzedający przebić strefę 77 600 do 77 700, gdzie przed chwilą ich sprzedaż została wchłonięta."
  - label: "Cena o 19:30 między 77 690 a 78 330"
    probability: 36
    note: "Wystarczy, że rynek dalej obraca się wokół VWAP dnia i POC, bez akceptacji nad otwarciem tygodnia i bez zamknięć pod VAL."
  - label: "Cena o 19:30 powyżej 78 330"
    probability: 29
    note: "Potrzebne zamknięcia nad VAH 24 h (78 225) i nad otwarciem tygodnia przy dalej rosnącym OI, czyli ciąg dalszy nowych longów z 14:30."
summary:
  - "Jedna świeca 15 min o 14:30 podniosła cenę z 77 692 do 78 156 przy delcie +892 BTC i wzroście OI o 344,5 BTC."
  - "Model daje 35% na cenę o 19:30 pod 77 690, 36% na środek zakresu i 29% na wynik nad 78 330."
  - "W 1% nad ceną czeka 8,8 mln USD shortów do likwidacji, pod ceną tylko 1,4 mln USD longów."
  - "Zmienność 5 min z ostatniej doby to 7,3 bp wobec 12,4 bp w poprzednich dniach roboczych."
metrics:
  - { label: "Premia perp", value: "−1,5 bp", note: "średnio 24 h −2,7 bp" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,12 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "58,7 mln USD", note: "kupno biorców 162,9, sprzedaż 104,2 mln USD" }
  - { label: "Likwidacje 24 h", value: "9,8 mln USD", note: "longi 0,5, shorty 9,3 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "1,4 mln USD", note: "do likwidacji między 77 374 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "8,8 mln USD", note: "do likwidacji między ceną a 78 938" }
  - { label: "Arkusz ±10 bp: bidy", value: "44% bidów", note: "zwykle o tej godzinie 50% (12 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "7,3 bp", note: "poprzednie dni robocze (5): 12,4 bp" }
liquidations:
  step: 250
  coverage: 46
  shorts: [[81500, 0.8], [81250, 0.5], [81000, 3.1], [80750, 3.3], [80500, 10.9], [80250, 5], [80000, 2.3], [79750, 1.6], [79500, 24.5], [79250, 8.1], [79000, 7.8], [78750, 5.5], [78500, 3.3]]
  longs: [[77500, 0.5], [77250, 5], [77000, 12], [76750, 22.5], [76500, 8.6], [76250, 6.7], [76000, 22.5], [75750, 29.7], [75500, 31.5], [75250, 5.1], [75000, 10.4], [74750, 2.7], [74500, 3.1]]
  note: "Mapa z 14:45, cena wtedy 78 182; pokrycie 46% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: 21.8, note: "80 kont" }
    - { label: "Reszta rynku", value: 9.2, note: "15 530 kont" }
    - { label: "Animatorzy rynku", value: 27.8, note: "200 kont" }
setups:
  - name: "Utrzymanie odbicia nad VWAP dnia"
    bias: up
    zone: [78150, 78225]
    window: "do 19:30"
    triggers:
      - "Zamknięcie świecy 15 min nad VAH 24 h (78 225), czyli nad stosem sprzedaży 78 150 do 78 175 z górnego knota świecy z 14:30."
      - "Delta tej świecy dodatnia, kupujący dalej biorą ofertę."
      - "OI rośnie razem z ceną, czyli dochodzą nowe longi, a nie tylko zamykanie shortów."
    invalidation: "Zamknięcie świecy 15 min pod 77 900, dolnym brzegiem stosu kupna z 14:30."
    reactions:
      - { label: "Otwarcie tygodnia", price: 78326 }
      - { label: "PDH", price: 78410 }
      - { label: "Klaster shortów", price: 79500 }
  - name: "Cofnięcie odbicia i powrót do dołka doby"
    bias: down
    zone: [77594, 77700]
    window: "do 19:30"
    triggers:
      - "Zamknięcie świecy 15 min pod 77 900, czyli pod stosem kupna, który zbudował odbicie o 14:30."
      - "Delta ujemna na tym zamknięciu, sprzedający znów inicjują."
      - "OI spada (zamykanie longów z 14:30) albo rośnie przy spadku ceny (nowe shorty)."
    invalidation: "Powrót i zamknięcie świecy 15 min nad 78 075, POC świecy z 14:30."
    reactions:
      - { label: "VAL wczoraj", price: 77688 }
      - { label: "PDL", price: 77478 }
      - { label: "Klaster longów", price: 77000 }
    evidence: "Laboratorium: przebicie PDL n 90, dalszy ruch w 45% przypadków wobec 47% losowo, czyli bez przewagi, to szum."
---
## Co się stało

Noc należała do kupujących. Po północy cena weszła nad PDH (78 410), od 03:00 do 06:30 większość zamknięć 15 min wypadła nad nim (wyjątki o 03:45 i 04:00), a o 04:45 dotknęła 78 854, szczytu doby. Od 06:45 każde zamknięcie 15 min wypadło już pod VWAP dnia i rynek przez całą sesję Londynu powoli schodził w dół. O 14:15 cena zeszła do 77 597, trzy dolary nad wczorajszym dołkiem doby z 20:00 (77 594), i stamtąd jedną świecą 15 min o 14:30 wróciła na 78 156. W chwili liczenia rozkładu, o 14:50, mark stał na 77 965, więc część tego skoku już się cofnęła.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Cena stoi między PDL (77 478) a PDH (78 410), poniżej otwarcia tygodnia (78 326), a zmiana z 24 godzin to tylko −0,06%. Nocne wyjście nad PDH dało szczyt 78 854, ale się nie utrzymało: od 06:45 cena wróciła pod PDH i oddała cały ruch aż do dołka doby. To było nieudane wybicie, a popołudniowy test dołka zakończył się odrzuceniem.

**Wartość.** Z 24 godzin POC wypada na 78 100, obszar wartości to 77 700 do 78 225, a cena jest w jego środku. Zamknięcia 15 min pod VAL zdarzyły się trzy razy (20:00, 23:15 i 14:15), żadne nie miało drugiej świecy z rzędu, więc ceny pod wartością zostały odrzucone. Nad VAH rynek był natomiast zaakceptowany w nocy i nad ranem, a potem i tak wrócił do środka.

**VWAP.** VWAP dnia to 78 172 przy σ 262,5, a ostatnie zamknięcie jest 0,06σ pod nim, czyli praktycznie na linii. Od 11:00 zamknięcia trzymały się pod pasmem −1σ, z jednym wyjątkiem o 13:00 (4 dolary nad nim), więc pasmo działało jako opór. Świeca z 14:30 przebiła je od dołu i zamknęła się 16 dolarów pod VWAP; od 06:45 nie było żadnego zamknięcia 15 min nad nim.

**Przepływ i pozycje.** W ostatniej godzinie delta wyniosła +915,9 BTC, cena urosła o 302 dolary, a OI o 280,7 BTC. Cena w górę i OI w górę to nowe longi, nie samo zamykanie shortów. Z 4 godzin delta to +1 110,3 BTC przy cenie wyżej o 91 dolarów i OI wyżej o 922 BTC, więc pozycji przybywało przez cały spadek w Londynie, a obraz rozstrzygnęła dopiero świeca z 14:30.

## Footprint odbicia od dołka doby

[[footprint]]

Sekwencja zaczyna się o 12:45: cztery nierównowagi sprzedaży między 77 750 a 77 850 i delta −126,1 BTC, ale świeca zamknęła się prawie na otwarciu, na 77 866. O 13:00 odpowiedzieli kupujący stosem pięciu nierównowag od 77 900 do 78 000 i deltą +516,2 BTC, lecz o 13:15 cena odbiła się od 78 087 i znów zeszła. Kolejne świece schodziły do 77 597 przy niewielkich deltach (od +93,1 do −58,6 BTC), a o 14:15 OI spadł o 57,2 BTC, czyli longi się zamykały. Tam sprzedaż została wchłonięta, po czym świeca z 14:30 przyniosła wolumen 2 852,3 BTC, ponad trzynaście razy więcej niż poprzednia, deltę +892 BTC i wzrost OI o 344,5 BTC. To czysta inicjatywa kupujących.

Linia frontu przebiega teraz tak: stos kupna 77 900 do 77 975 i nierównowagi 78 025 do 78 050 z tej świecy to pierwsze oparcie, jej POC na 78 075 to punkt odniesienia, a dwie nierównowagi sprzedaży 78 150 i 78 175 w górnym knocie pokazują, gdzie odbicie się zatrzymało. Niżej leży stos sprzedaży 77 750 do 77 850 z 12:45 i dołek 77 597.

## Gdzie leży płynność

[[likwidacje]]

Mapa likwidacji jest wyraźnie asymetryczna. W 1% nad ceną czeka 8,8 mln USD shortów do likwidacji, a w 1% pod ceną tylko 1,4 mln USD longów. Największy klaster shortów to 79 500 z 24,5 mln USD, mniejsze stoją na 79 250 (8,1 mln) i 79 000 (7,8 mln). Pod ceną pierwsza większa grupa longów to 77 000 z 12 mln USD, a najgrubsze leżą daleko: 76 750 i 76 000 po 22,5 mln, 75 750 z 29,7 mln i 75 500 z 31,5 mln USD. Mapa pokrywa 46% otwartych pozycji, więc to obraz częściowy.

## Kto handluje

[[przeplywy]]

Z ostatniej doby agresorzy kupili netto za 58,7 mln USD (162,9 mln kupna wobec 104,2 mln sprzedaży biorców). Wieloryby dołożyły 21,8 mln na 80 kontach, animatorzy rynku 27,8 mln na 200 kontach, a reszta rynku 9,2 mln na 15 530 kontach. Likwidacje z doby to 9,8 mln USD, prawie wyłącznie shorty (9,3 mln), największa porcja 5,99 mln o 04:15. Premia perp jest lekko ujemna, −1,5 bp przy średniej z doby −2,7 bp, funding to 0,13 bp/h. W arkuszu ±10 bp bidy mają 44%, a zwykle o tej godzinie 50%.

## Zmienność i rozkład

[[scenariusze]]

Model daje do 19:30 σ 89 bp, co przekłada się na zakres 68% od 77 271 do 78 664 i 95% od 76 584 do 79 370. Zmienność 5 min z ostatniej doby to 7,3 bp wobec 12,4 bp w poprzednich dniach roboczych, a obecny reżim (10,1 bp na 5 min) trwa około 19 godzin, z 6% szansy na zmianę w najbliższych 25 minutach. Prognoza desku na 4 godziny z 14:47 ma medianę 78 193 i 50% w przedziale 77 753 do 78 615. Na rynku HIP-4 „BTC > 78 340” z terminem jutro o 07:00 cena to 35%, a model desku daje 37%, więc różnica jest w granicach szumu.

## Struktura dnia

[[poziomy]]

Wokół ceny jest ciasno. POC wczoraj (78 020) ma 94% szansy dotknięcia do 19:30, otwarcie Londynu (78 079) 87%, VAH wczoraj (78 117) 82%, a VWAP dnia (78 169) 75%. Niżej dołek Azji (77 882) ma 91%, VAL wczoraj (77 688) 68%, a PDL (77 478) 47%. Nad ceną otwarcie tygodnia ma 58%, a PDH 50%. Szczyt Azji 78 854 to już tylko 19%, okrągłe 79 000 14%, a klaster longów na 76 950 również 14%.

## Co musiałoby się wydarzyć

[[setupy]]

Pierwszy obraz to utrzymanie odbicia: zamknięcia nad 78 225 z dodatnią deltą i rosnącym OI otwierają drogę do otwarcia tygodnia i PDH, a dalej do shortów na 79 500. Drugi to cofnięcie: zamknięcie pod 77 900 oznaczałoby, że kupujący z 14:30 nie obronili własnego stosu, i wtedy wraca temat 77 600 do 77 700 oraz PDL. Laboratorium nie pokazuje przewagi przy przebiciu PDL, to wskazówka, nie statystyka.

## Na co patrzę dalej

Najważniejsza jest pierwsza godzina po otwarciu Nowego Jorku o 15:30: czy cena zamknie się nad VWAP dnia, czego nie było od 06:45, czy też wróci pod stos kupna 77 900. Patrzę też na OI. Jeśli przy wzroście będzie spadał, to odbicie robią zamykane shorty, a nie nowe pieniądze. Ruch o 1% w górę trafiłby w 8,8 mln USD shortów do likwidacji, a pod ceną podobnego paliwa prawie nie ma aż do 77 250.

## Rzetelność modelu

Przedziały desku są raczej za szerokie niż za wąskie: w horyzoncie 1 godziny przedział 90% obejmował 93% wyników, a 60% obejmował 71% (n 1 060); w horyzoncie 4 godzin odpowiednio 92% i 73% (n 1 048). Szanse dotknięć PDH, PDL i środka mają Brier 0,074 wobec 0,118 dla częstości bazowej (n 1 056, niższy lepszy).

Prawdopodobieństwa pochodzą z modelu desku HAR + FHS i symulacji Monte Carlo, policzone o 14:50 i zapisane przed faktem, a o 19:30 rozliczę je z tym, co zrobił rynek. Następny wpis to otwarcie Nowego Jorku o 15:45.
