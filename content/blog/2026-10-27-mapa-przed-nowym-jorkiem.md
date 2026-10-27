---
title: "Przed Nowym Jorkiem BTC na 80 323, tuż nad wartością. PDH 80 835 ma 62% dotknięcia"
description: "Godzinę przed otwarciem w USA cena wyszła 1,62σ nad VWAP dnia, a OI urosło o 740 BTC w godzinę. Nad ceną 10,1 mln USD shortów w 1%. Poziomy i rozkład do 18:30."
date: 2026-10-27T13:50:30+01:00
type: article
section: Mapa przed Nowym Jorkiem
price: 80323
levels:
  - { label: "Likwidacje shortów", price: 81150, note: "3,0 mln USD, 41% dotknięcia do 18:30" }
  - { label: "PDH", price: 80835, note: "62% dotknięcia do 18:30" }
  - { label: "VAH wczoraj", price: 80360, note: "97% dotknięcia do 18:30" }
  - { label: "Szczyt Azji", price: 80360, note: "97% dotknięcia do 18:30" }
  - { label: "Otwarcie tygodnia", price: 80109, note: "72% dotknięcia do 18:30" }
  - { label: "POC wczoraj", price: 80020, note: "64% dotknięcia do 18:30" }
  - { label: "VWAP dnia", price: 79960, note: "59% dotknięcia do 18:30" }
  - { label: "Otwarcie Londynu", price: 79784, note: "47% dotknięcia do 18:30" }
  - { label: "VAL wczoraj", price: 79680, note: "40% dotknięcia do 18:30" }
scenarios:
  - label: "Cena o 18:30 poniżej 80 020"
    probability: 33
    note: "Wybicie z 13:15 musiałoby się nie utrzymać: powrót pod obszar wartości 24 h i pod stos kupna 80 000 do 80 050, a potem zejście w okolice VWAP dnia."
  - label: "Cena o 18:30 między 80 020 a 80 840"
    probability: 35
    note: "Najczęstszy przypadek: Nowy Jork nie rozstrzyga, cena krąży między POC a wczorajszym szczytem, a świeże pozycje z ostatniej godziny się bilansują."
  - label: "Cena o 18:30 powyżej 80 840"
    probability: 32
    note: "Potrzebne jest przejście nad PDH 80 835 i utrzymanie go. Wtedy w zasięgu są shorty do likwidacji na 81 000 i 81 150."
summary:
  - "Cena 80 323 stoi tuż nad obszarem wartości 24 h (VAH 80 300) i 1,62σ nad VWAP dnia 79 956, po wybiciu o 13:15."
  - "Wzrost o 457 USD w godzinę szedł z OI większym o 740 BTC i z ujemną deltą agresorów (−30 BTC), więc pasywni kupujący wchłaniali sprzedaż."
  - "Nad ceną w 1% jest 10,1 mln USD shortów do likwidacji, pod ceną w tym samym pasie praktycznie nic."
  - "Model daje do 18:30 zakres 68% od 79 484 do 81 325 i 62% szansy dotknięcia PDH 80 835."
metrics:
  - { label: "Premia perp", value: "−2,1 bp", note: "średnio 24 h −3,1 bp" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,12 bp/h, około 11% w skali roku" }
  - { label: "Przepływ agresorów 24 h", value: "7,1 mln USD", note: "kupno biorców 199,9, sprzedaż 192,8 mln USD" }
  - { label: "Likwidacje 24 h", value: "4,0 mln USD", note: "longi 1,1, shorty 2,8 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "0,0 mln USD", note: "do likwidacji między 79 520 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "10,1 mln USD", note: "do likwidacji między ceną a 81 126" }
  - { label: "Arkusz ±10 bp: bidy", value: "50% bidów", note: "zwykle o tej godzinie 51% (5 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "9,8 bp", note: "poprzednie dni robocze (5): 10,5 bp" }
liquidations:
  step: 250
  coverage: 44
  shorts: [[83750, 36.5], [83500, 3.2], [83250, 17.4], [83000, 6.6], [82750, 1.2], [82500, 2.1], [82250, 1.2], [82000, 0.8], [81750, 14.1], [81500, 1.8], [81250, 1.9], [81000, 6.4], [80750, 3.6], [80500, 1.6]]
  longs: [[79250, 4.2], [79000, 24.3], [78750, 24.3], [78500, 27.5], [78250, 10.5], [78000, 10.3], [77750, 4.7], [77500, 13.7], [77250, 11.9], [77000, 18.7], [76750, 2.6]]
  note: "Mapa z 13:44, cena wtedy 80 334; pokrycie 44% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: 21.7, note: "70 kont" }
    - { label: "Reszta rynku", value: -18.3, note: "16 370 kont" }
    - { label: "Animatorzy rynku", value: 3.8, note: "190 kont" }
setups:
  - name: "Przejście nad wczorajszy szczyt w stronę shortów do likwidacji"
    bias: up
    zone: [80835, 81150]
    window: "do 18:30"
    triggers:
      - "Zamknięcie świecy 15 min nad PDH 80 835, a nie tylko knot nad nim."
      - "Delta agresorów po stronie kupna na tej świecy, bez powtórki ujemnej delty z 13:30."
      - "OI nie spada przy wybiciu, czyli ruchu nie niesie samo zamykanie shortów."
    invalidation: "Dwa zamknięcia 15 min z powrotem pod 80 300, czyli pod obszarem wartości 24 h."
    reactions:
      - { label: "PDH", price: 80835 }
      - { label: "Likwidacje shortów", price: 81150 }
      - { label: "Klaster shortów", price: 81750 }
    evidence: "Laboratorium desku dla wybicia wczorajszego szczytu: n 92, częstość 43% wobec losowej 47%, bez przewagi ponad szum."
  - name: "Nieudane wybicie i powrót do wartości"
    bias: down
    zone: [79925, 80050]
    window: "do 18:30"
    triggers:
      - "Zamknięcie świecy 15 min pod 80 300 po teście szczytu, czyli powrót do obszaru wartości."
      - "Delta agresorów dalej ujemna, a cena tym razem ustępuje zamiast stać."
      - "OI spada razem z ceną, czyli świeże longi z 13:30 zamykają pozycje."
    invalidation: "Zamknięcie świecy 30 min nad PDH 80 835."
    reactions:
      - { label: "POC wczoraj", price: 80020 }
      - { label: "VWAP dnia", price: 79960 }
      - { label: "VAL wczoraj", price: 79680 }
    evidence: "Powrót do VWAP w laboratorium desku: n 173, częstość 36% wobec losowej 43%, bez przewagi. Reguła powrotu do obszaru wartości nie była sprawdzana, to tylko wskazówka."
---
## Co się stało

Wczoraj o 14:30 cena zebrała dołek doby na 79 430, a o 16:15, już w sesji nowojorskiej, wyszła na szczyt 80 835 i zlikwidowała przy tym 2,8 mln USD shortów. To był najmocniejszy moment całej doby i od tamtej pory ten poziom jest wczorajszym szczytem. Później cena zeszła z powrotem do środka zakresu, noc i Azja zamknęły się między 79 552 a 80 360, a Londyn otworzył na 79 784. Do 13:00 rynek stał nisko, przy minimach koło 79 840 i na bardzo małym wolumenie.

Ruch przyszedł nagle o 13:15. W dwóch świecach 15 min cena przeszła z 79 913 do 80 371 i teraz stoi na 80 323, czyli w ciągu godziny wyżej o 457 USD. Doba jako całość jest jednak prawie płaska, z wynikiem +0,11%.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Dwie ostatnie doby to zakres od 79 347 (PDL) do 80 835 (PDH), a cena wróciła do jego górnej połowy i stoi nad otwarciem tygodnia 80 109. Wczorajsze wyjście na 80 835 okazało się nieudanym wybiciem: po likwidacjach shortów nie było kontynuacji. Dzisiejszy ruch na razie zatrzymał się na 80 371, więc to jeszcze nie test szczytu, tylko powrót w jego stronę.

**Wartość.** POC z 24 godzin jest na 80 000, obszar wartości od 79 725 do 80 300. Cena jest nad wartością, ale ledwie o kilkadziesiąt dolarów i dopiero od jednej świecy 15 min. To jeszcze nie akceptacja, do tego trzeba co najmniej dwóch świec 30 min zamkniętych nad 80 300. Jeśli najbliższe świece wrócą pod ten poziom, wybicie trzeba będzie czytać jako odrzucenie.

**VWAP.** VWAP dnia leży na 79 956, a cena jest 1,62σ nad nim, czyli między pasmem +1σ a +2σ. Przez całe przedpołudnie cena trzymała się pod VWAP i dopiero świeca z 13:15 przeniosła ją na drugą stronę. Pasmo +2σ jest tuż nad ceną i to ono jest pierwszym oporem z tej rodziny poziomów.

**Przepływ i pozycje.** W ostatniej godzinie cena wzrosła o 457 USD, a OI o 740 BTC, w ciągu 4 godzin odpowiednio o 568 USD i 1 212,7 BTC. Według macierzy cena w górę i OI w górę to nowe longi. Delta agresorów była jednak ujemna: −30 BTC w godzinę i −50,8 BTC w 4 godziny, przy +485,6 BTC dla całej doby. Agresywni sprzedający otwierali więc pozycje, a cena i tak szła w górę, bo po drugiej stronie stały pasywne zlecenia kupna. Ten rozjazd sam nic nie przesądza; liczy się, czy cena utrzyma się nad 80 300.

## Footprint wybicia nad wartość

[[footprint]]

Sekwencja jest czytelna. O 12:00 świeca z ujemną deltą −108,2 BTC zrzuciła cenę z 80 132 do 79 918, a kolejne świece od 12:15 do 13:00 miały coraz mniejszy wolumen (134,5, potem 46,9, 33,1 i 91,1 BTC) przy dołkach od 79 835 do 79 864. To wygląda na wyczerpanie strony sprzedającej. Inicjatywę przejęła świeca z 13:15: delta +197,4 BTC, OI +109,6 BTC i stos nierównowag kupna od 80 000 do 80 050. Odpowiedź przyszła od razu w świecy z 13:30, największej w całym oknie, z wolumenem 1 051 BTC. Delta wyniosła tam −255,3 BTC, a OI wzrosło o 574 BTC, mimo to cena zamknęła się wyżej, na 80 323. Duża przeciwna delta bez postępu ceny w dół to absorpcja: sprzedaż została wchłonięta.

Linią frontu jest teraz stos kupna 80 000 do 80 050 i POC świecy z 13:15 na 79 925 pod ceną oraz POC ostatniej świecy na 80 250 z nierównowagami sprzedaży na 80 200 i 80 300 tuż obok. Dopóki cena trzyma się nad 80 250, inicjatywa z 13:15 jest nienaruszona. Zejście pod stos 80 000 do 80 050 oznaczałoby, że świeże pozycje z wybicia są pod kreską.

## Gdzie leży płynność

[[likwidacje]]

Asymetria jest duża. W pasie 1% nad ceną, do 81 126, mapa pokazuje 10,1 mln USD shortów do likwidacji, z czego najwięcej na 81 000 (6,4 mln) i 80 750 (3,6 mln). W pasie 1% pod ceną longów praktycznie nie ma. Większe skupiska longów zaczynają się dopiero na 79 000 i 78 750 (po 24,3 mln) oraz 78 500 (27,5 mln), czyli ponad 1,5% niżej. Nad ceną kolejny duży klaster to 81 750 (14,1 mln), a dalej 83 250 i 83 750. Mapa obejmuje 44% otwartych pozycji, więc kwoty są zaniżone, ale proporcja zostaje.

## Kto handluje

[[przeplywy]]

Przez ostatnie 24 godziny kupujący agresywnie przeważyli o 7,1 mln USD. Za tym stoi 70 kont wielorybów z wynikiem +21,7 mln, podczas gdy reszta rynku, ponad 16 tysięcy kont, sprzedawała netto za 18,3 mln. Animatorzy rynku dołożyli 3,8 mln po stronie kupna. Kontrakt jest notowany 2,1 bp pod indeksem, mniej niż średnio przez dobę (−3,1 bp), a funding 0,13 bp/h to zwykłe 11% w skali roku. Arkusz w pasie ±10 bp jest zrównoważony, 50% bidów wobec typowych 51% o tej godzinie.

## Zmienność i rozkład

[[scenariusze]]

Model liczy do 18:30 odchylenie 114 bp, co daje zakres 68% od 79 484 do 81 325 i 95% od 78 579 do 82 261. Rozkład jest prawie symetryczny: po około jednej trzeciej na zamknięcie pod POC, w środku i nad wczorajszym szczytem. Zmienność 5 min z ostatniej doby to 9,8 bp, trochę mniej niż 10,5 bp z poprzednich dni roboczych, a reżim trwa od około 14 godzin. Prognoza desku na 4 godziny ma medianę 80 309 i 50% w przedziale 79 748 do 80 886. Na rynku HIP-4 zakład „BTC powyżej 79 957” do jutra 7:00 wyceniany jest na 66%, model daje 61%, więc rynek jest nieco bardziej optymistyczny.

## Struktura dnia

[[poziomy]]

Cena stoi tuż pod wczorajszym VAH i szczytem Azji na 80 360, które mają 97% szansy dotknięcia do 18:30. Wyżej najważniejszy jest PDH 80 835 z 62% i shorty na 81 150 z 41%. Pod ceną gęsto: otwarcie tygodnia 80 109 (72%), wczorajszy POC 80 020 (64%), VWAP dnia 79 960 (59%), a niżej otwarcie Londynu 79 784 (47%) i wczorajszy VAL 79 680 (40%).

## Co musiałoby się wydarzyć

[[setupy]]

Pierwszy obraz to przejście nad wczorajszy szczyt. Wczoraj na 80 835 skończyło się likwidacjami bez kontynuacji, więc tym razem liczyłoby się zamknięcie świecy nad poziomem, delta po stronie kupna i OI, które nie spada. Drugi obraz to nieudane wybicie: powrót pod 80 300 z ujemną deltą, przy której cena już nie stoi, i spadającym OI. Wtedy świeże longi z ostatniej godziny byłyby pod kreską, a cel ruchu to okolice POC i VWAP dnia. Żadna z tych reguł nie ma w laboratorium desku przewagi ponad szum.

## Na co patrzę dalej

Najważniejsze będzie pierwsze pół godziny po otwarciu o 14:30: czy dwie świece 30 min zamkną się nad 80 300, czyli czy rynek zaakceptuje ceny nad wartością. Patrzę też na OI. Po wzroście o 1 212,7 BTC w 4 godziny dużo świeżych pozycji stoi blisko ceny i jeśli zacznie spadać razem z ceną, ruch w dół może przyspieszyć. Obraz zmienia zamknięcie nad 80 835 albo pod stosem 80 000 do 80 050.

## Rzetelność modelu

Przedziały modelu desku są raczej za szerokie niż za wąskie: w horyzoncie 4 godzin przedział 90% obejmował cenę w 98% przypadków, a 60% w 80% (n 469), w horyzoncie godziny odpowiednio 95% i 72% (n 481). Prognozy dotknięć PDH, PDL i środka mają Brier 0,073 wobec 0,101 dla częstości bazowej (n 477), więc są lepsze od samej statystyki.

Prawdopodobieństwa w tym wpisie pochodzą z modelu desku (HAR + FHS, symulacja Monte Carlo), policzone o 13:50 i zapisane przed faktem, a o 18:30 zostaną rozliczone. Następny wpis to notka po otwarciu Nowego Jorku, około 14:45.
