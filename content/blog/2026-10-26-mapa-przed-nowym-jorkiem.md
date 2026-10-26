---
title: "Bitcoin przy 80 322 przed Nowym Jorkiem: 20,4 mln USD shortów w 1% nad ceną"
description: "BTC 80 322 przed otwarciem Nowego Jorku o 14:30. Zakres 68% do 18:30 to 79 487 do 81 233, a najbliższy klaster likwidacji shortów leży przy 80 650."
date: 2026-10-26T13:50:22+01:00
type: article
section: Mapa przed Nowym Jorkiem
price: 80322
levels:
  - { label: "VAH wczoraj", price: 80680, note: "68% dotknięcia do 18:30" }
  - { label: "Likwidacje shortów", price: 80650, note: "9,6 mln USD, 71% dotknięcia do 18:30" }
  - { label: "Szczyt Azji", price: 80349, note: "99% dotknięcia do 18:30" }
  - { label: "POC wczoraj", price: 80300, note: "95% dotknięcia do 18:30" }
  - { label: "Otwarcie tygodnia", price: 80109, note: "77% dotknięcia do 18:30" }
  - { label: "VAL wczoraj", price: 80080, note: "74% dotknięcia do 18:30" }
  - { label: "Otwarcie Londynu", price: 80004, note: "68% dotknięcia do 18:30" }
  - { label: "VWAP dnia", price: 79937, note: "61% dotknięcia do 18:30" }
  - { label: "PDL", price: 79817, note: "52% dotknięcia do 18:30" }
scenarios:
  - label: "Cena o 18:30 poniżej 80 000"
    probability: 34
    note: "Cena musi oddać otwarcie Londynu 80 004 i zejść pod VWAP dnia 79 937, a sprzedający muszą przejąć inicjatywę po odrzuceniu pasma +2σ."
  - label: "Cena o 18:30 między 80 000 a 80 680"
    probability: 31
    note: "Otwarcie Nowego Jorku nie wybija z obszaru wartości: cena rotuje wokół POC i nie przebija ani klastra 80 650, ani otwarcia Londynu."
  - label: "Cena o 18:30 powyżej 80 680"
    probability: 35
    note: "Cena musi zostać zaakceptowana nad klastrem shortów 80 650 i wczorajszym VAH 80 680; wtedy kolejnym magnesem jest PDH 81 014."
summary:
  - "Przed otwarciem Nowego Jorku o 14:30 BTC stoi przy 80 322, w środku obszaru wartości 24 h (79 825 do 80 650)."
  - "W 1% nad ceną leży 20,4 mln USD likwidacji shortów, a w 1% pod ceną praktycznie nic, więc mapa płynności jest wyraźnie asymetryczna."
  - "Model daje zakres 68% do 18:30 od 79 487 do 81 233 i prawie równy podział scenariuszy: 34%, 31% i 35%."
  - "Przepływ agresorów z 24 h jest ujemny (−8,3 mln USD), choć z ostatnich 4 h delta jest dodatnia (594 BTC) przy rosnącym open interest."
metrics:
  - { label: "Premia perp", value: "−2,9 bp", note: "średnio 24 h −4,1 bp" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,09 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "−8,3 mln USD", note: "kupno biorców 235,7, sprzedaż 244,0 mln USD" }
  - { label: "Likwidacje 24 h", value: "6,7 mln USD", note: "longi 6,7, shorty 0,1 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "0,0 mln USD", note: "do likwidacji między 79 519 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "20,4 mln USD", bias: up, note: "do likwidacji między ceną a 81 125" }
  - { label: "Arkusz ±10 bp: bidy", value: "52% bidów", bias: flat, note: "zwykle o tej godzinie 50% (4 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "10,5 bp", bias: flat, note: "poprzednie dni robocze (5): 10,5 bp" }
liquidations:
  step: 250
  coverage: 44
  shorts: [[83750, 37.5], [83500, 3.1], [83250, 1.8], [83000, 1.5], [82750, 2.1], [82500, 1.2], [82250, 3.3], [82000, 2.6], [81750, 1.8], [81500, 13.2], [81250, 3.3], [81000, 11.6], [80750, 1.5], [80500, 10.1]]
  longs: [[79500, 0.7], [79250, 3.1], [79000, 36.8], [78750, 22.9], [78500, 21.4], [78250, 12.7], [78000, 13.1], [77750, 5.4], [77500, 25], [77250, 15.3], [77000, 19.8], [76750, 2.2]]
  note: "Mapa z 13:48, cena wtedy 80 355; pokrycie 44% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: -4.5, note: "80 kont" }
    - { label: "Reszta rynku", value: 7.1, note: "15 800 kont" }
    - { label: "Animatorzy rynku", value: -10.9, note: "200 kont" }
setups:
  - name: "Wyciskanie shortów nad klastrem 80 650"
    bias: up
    zone: [80537, 80680]
    window: "do 18:30"
    triggers:
      - "Świeca 15 min zamyka się nad wczorajszym VAH 80 680, a nie tylko wybija knotem."
      - "Delta świecy wybicia jest wyraźnie dodatnia, z co najmniej trzema nierównowagami kupna jedna nad drugą."
      - "Open interest spada skokowo przy wybiciu, co wskazuje na likwidacje shortów, a nie tylko nowe longi."
    invalidation: "Powrót i zamknięcie świecy 15 min pod pasmem VWAP +2σ 80 537."
    reactions:
      - { label: "PDH", price: 81014 }
      - { label: "Likwidacje shortów", price: 81050 }
  - name: "Powrót do VWAP po odrzuceniu pasma +2σ"
    bias: down
    zone: [79937, 80109]
    window: "do 18:30"
    triggers:
      - "Świeca 15 min zamyka się pod VWAP +1σ 80 237."
      - "Delta jest ujemna, a nierównowagi sprzedaży układają się w stos pod 80 320."
      - "Open interest spada razem z ceną, czyli zamykają się longi otwarte rano."
    invalidation: "Zamknięcie świecy 15 min z powrotem nad 80 537."
    reactions:
      - { label: "Otwarcie Londynu", price: 80004 }
      - { label: "VWAP dnia", price: 79937 }
      - { label: "PDL", price: 79817 }
    evidence: "Reguła powrotu do VWAP w laboratorium desku: n 172, częstość 35% wobec losowej 43%, bez przewagi. To raczej szum niż statystyka."
  - name: "Rotacja w obszarze wartości 24 h"
    bias: flat
    zone: [79825, 80650]
    window: "do 18:30"
    triggers:
      - "Świece 15 min zamykają się wewnątrz obszaru 79 825 do 80 650."
      - "Delta zmienia znak co kilka świec i nie tworzy stosów nierównowag."
      - "Open interest stoi w miejscu."
    invalidation: "Dwa zamknięcia 15 min poza obszarem wartości po tej samej stronie."
    reactions:
      - { label: "POC 24 h", price: 80250 }
      - { label: "VAL 24 h", price: 79825 }
      - { label: "VAH 24 h", price: 80650 }
---
## Co się stało

Wczoraj o 18:15 bitcoin dotarł do 80 927, najwyżej w ostatnich 24 godzinach, ale nie dał rady wczorajszemu szczytowi 81 014. W nocy zszedł pod wczorajszy dołek 79 817 i o 2:45 dotknął 79 347, czyli dołka Azji. Tam zeszła większość nocnych likwidacji longów. Rano rynek wrócił nad otwarcie Londynu 80 004 i otwarcie tygodnia 80 109, a przed Nowym Jorkiem cena stoi przy 80 322.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Doba zamyka się w zakresie od 79 347 do 80 927, a cena jest niemal w środku. Nocne zejście pod PDL 79 817 nie znalazło kontynuacji: rynek szybko wrócił nad ten poziom, więc traktuję je jako nieudane wybicie w dół, a nie początek trendu.

**Wartość.** POC z 24 godzin to 80 250, obszar wartości od 79 825 do 80 650. Cena jest w środku wartości, tuż nad POC. Nocne ceny pod 79 825 zostały odrzucone, bo rynek szybko wrócił do obszaru.

**VWAP.** VWAP dnia to 79 937, a cena jest 1,29σ nad nim (σ wynosi 299,6). Od porannego odbicia cena trzyma się nad VWAP. Pasmo +2σ przy 80 537 zadziałało jako opór: o 13:15 szczyt świecy doszedł do 80 544 i cena się cofnęła.

**Przepływ i pozycje.** Z ostatnich 4 godzin delta to +594 BTC, cena wyżej o 45 USD, a open interest wzrósł o 203,2. Cena w górę i OI w górę to nowe longi, ale ruch był mały jak na taką deltę, więc ktoś pasywnie sprzedawał. Z ostatniej godziny delta +130,5 BTC przy cenie niżej o 36 USD; to dopiero rozjazd, który sam w sobie niczego nie przesądza. W całym oknie taśmy, od wczoraj 13:45, delta jest ujemna: −922,5 BTC.

## Footprint szczytu przy 80 544

[[footprint]]

Inicjatywa kupujących przyszła o 12:45: świeca 15 min z deltą +152,4 i stosem sześciu nierównowag kupna od 80 320 do 80 480, a open interest wzrósł o 142,6, więc to były nowe longi. O 13:15 kupujący spróbowali jeszcze raz, ze stosem 80 320 do 80 360 i szczytem 80 544 przy paśmie +2σ, ale delta była już mniejsza (+85,2), a OI prawie się nie zmienił. Odpowiedź przyszła o 13:30: delta −73,5, OI w dół o 95,6, zamknięcie 80 322. Cena w dół i OI w dół to zamykanie longów z poprzednich świec.

Linia frontu to dziś pas 80 300 do 80 320, gdzie w ostatniej świecy pojawiły się nierównowagi sprzedaży, a wcześniej siedział stos kupna. Nad nim POC świecy wybicia 80 480 i szczyt 80 544. Pod ceną POC ostatniej świecy 80 260 i POC doby 80 250.

## Gdzie leży płynność

[[likwidacje]]

Mapa jest wyraźnie przechylona. W 1% nad ceną czeka 20,4 mln USD likwidacji shortów, z grupami przy 80 500 (10,1 mln) i 81 000 (11,6 mln), a dalej 81 500 (13,2 mln). W 1% pod ceną longów do likwidacji praktycznie nie ma; duże grupy zaczynają się dopiero przy 79 000 (36,8 mln) i 78 750 (22,9 mln). Mapa obejmuje 44% otwartych pozycji, więc to obraz częściowy.

## Kto handluje

[[przeplywy]]

Przez 24 godziny agresywna sprzedaż przeważała o 8,3 mln USD. Najmocniej sprzedawali animatorzy rynku (−10,9 mln) i wieloryby (−4,5 mln), a reszta rynku kupowała za 7,1 mln. Premia perp jest ujemna (−2,9 bp), ale płytsza niż średnio przez dobę (−4,1 bp), a funding wzrósł do 0,13 bp/h ze średnio 0,09 bp/h. W arkuszu ±10 bp bidy mają 52%, prawie tyle co zwykle o tej godzinie.

## Zmienność i rozkład

[[scenariusze]]

Do 18:30 model liczy σ 109 bp, co daje zakres 68% od 79 487 do 81 233 i 95% od 78 628 do 82 120. Zmienność 5 min z doby to 10,5 bp, dokładnie tyle co średnio w poprzednich dniach roboczych. Reżim zmienności trwa około 4 godzin przy 9,5 bp na 5 min, a szansa jego zmiany w najbliższych 25 minutach to 2%. Prognoza 4 h z dziennika desku ma medianę 80 335 i przedział 50% od 79 793 do 80 898. Na rynku HIP-4 „BTC > 80 234” na jutro 7:00 rynek płaci 54%, model desku daje 53%, więc nie ma tu rozbieżności.

## Struktura dnia

[[poziomy]]

Cena siedzi tuż pod szczytem Azji 80 349 i nad wczorajszym POC 80 300, oba mają szansę dotknięcia powyżej 95%. Nad ceną najbliższe są klaster shortów 80 650 (71%) i wczorajszy VAH 80 680 (68%). Pod ceną otwarcie tygodnia 80 109 (77%), otwarcie Londynu 80 004 (68%) i VWAP dnia 79 937 (61%). PDL 79 817 ma 52%.

## Co musiałoby się wydarzyć

[[setupy]]

Trzy obrazy na sesję. Wzrostowy wymaga zaakceptowania cen nad 80 680 z dodatnią deltą i skokowym spadkiem OI, czyli likwidacjami shortów. Spadkowy zaczyna się od zamknięcia pod 80 237 i spadającego OI, z celem w okolicy VWAP. Jeśli nic z tego nie zajdzie, rynek zostaje w obszarze wartości. Reguła powrotu do VWAP nie dała w laboratorium przewagi, więc traktuję ją jako wskazówkę, nie statystykę.

## Na co patrzę dalej

Pierwsza godzina Nowego Jorku: czy cena znów podejdzie pod 80 537 i 80 650 i czy tym razem OI zacznie spadać skokowo. Po stronie spadkowej patrzę na zamknięcia względem otwarcia Londynu 80 004, bo pod nim mapa jest pusta aż do 79 000.

## Rzetelność modelu

Przedziały 4 h z dziennika desku są raczej za szerokie: 90% obejmuje 98% wyników, a 60% obejmuje 78% (n 373). Dla 1 h jest podobnie, 96% i 74% (n 385). Dotknięcia PDH, PDL i środka mają Brier 0,056 wobec 0,075 dla częstości bazowej (n 381), czyli model jest tu lepszy od prostego odniesienia.

Prawdopodobieństwa pochodzą z modelu desku HAR + FHS i symulacji Monte Carlo, policzone o 13:50 i zapisane przed faktem, a model zakłada brak przewagi. Następny wpis po otwarciu Nowego Jorku, o 14:45.
