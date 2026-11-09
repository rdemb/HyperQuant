---
title: "BTC 74 599 przed Nowym Jorkiem: 62% na cenę o 19:30 między 73 840 a 75 590"
description: "BTC przed otwarciem Nowego Jorku po 74 599, tuż nad VWAP dnia. Model daje 62% na cenę o 19:30 między 73 840 a 75 590, a przy 75 500 czeka 11,2 mln USD shortów do likwidacji."
date: 2026-11-09T14:50:22+01:00
type: article
section: Mapa przed Nowym Jorkiem
price: 74599
levels:
  - { label: "Likwidacje shortów", price: 75850, note: "2,8 mln USD, 28% dotknięcia do 19:30" }
  - { label: "Likwidacje shortów", price: 75650, note: "7,2 mln USD, 38% dotknięcia do 19:30" }
  - { label: "Szczyt Azji", price: 75585, note: "42% dotknięcia do 19:30" }
  - { label: "Likwidacje shortów", price: 75150, note: "4,3 mln USD, 73% dotknięcia do 19:30" }
  - { label: "Otwarcie tygodnia", price: 74820, note: "99% dotknięcia do 19:30" }
  - { label: "VWAP dnia", price: 74557, note: "81% dotknięcia do 19:30" }
  - { label: "VAL wczoraj", price: 74444, note: "71% dotknięcia do 19:30" }
  - { label: "Otwarcie Londynu", price: 73836, note: "32% dotknięcia do 19:30" }
  - { label: "Dołek Azji", price: 73715, note: "26% dotknięcia do 19:30" }
scenarios:
  - label: "Cena o 19:30 poniżej 73 840"
    probability: 17
    note: "Cena musiałaby zejść pod VWAP dnia i pasmo −1σ przy 74 107, a potem pod otwarcie Londynu 73 836, gdzie od 73 500 w dół zaczynają się skupiska longów do likwidacji."
  - label: "Cena o 19:30 między 73 840 a 75 590"
    probability: 62
    note: "Wystarczy, że po otwarciu Nowego Jorku cena zostanie w obszarze wartości doby i nie wyjdzie trwale ani nad szczyt Azji 75 585, ani pod otwarcie Londynu."
  - label: "Cena o 19:30 powyżej 75 590"
    probability: 21
    note: "Kupujący musieliby zamknąć się nad 75 000 i VAH 24 h 75 175, przejść przez likwidacje shortów przy 75 150 i utrzymać cenę nad szczytem Azji."
summary:
  - "Po nocnej kaskadzie cena zrobiła o 09:00 dołek 73 698 i wróciła do 74 599, tuż nad VWAP dnia 74 557."
  - "Od 13:15 każde zamknięcie 15 min jest nad VWAP, ale dwa podejścia do 75 000 zamknęły się pod pasmem +1σ 75 007."
  - "W 1% nad ceną leży 5,7 mln USD shortów do likwidacji, pod ceną 2,8 mln USD longów, odwrotnie niż rano."
  - "Model daje 62% na cenę o 19:30 między 73 840 a 75 590, przy zakresie 68% od 73 745 do 75 862."
metrics:
  - { label: "Premia perp", value: "−2,5 bp", note: "średnio 24 h −2,8 bp" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,12 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "−37,5 mln USD", note: "kupno biorców 342,0, sprzedaż 379,5 mln USD; rano −70,3 mln USD" }
  - { label: "Likwidacje 24 h", value: "44,3 mln USD", note: "longi 42,3, shorty 2,0 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "2,8 mln USD", note: "do likwidacji między 73 853 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "5,7 mln USD", note: "do likwidacji między ceną a 75 345" }
  - { label: "Arkusz ±10 bp: bidy", value: "52% bidów", note: "zwykle o tej godzinie 50% (19 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "16,0 bp", note: "poprzednie dni robocze (5): 13,9 bp" }
liquidations:
  step: 250
  coverage: 47
  shorts: [[77750, 2.4], [77500, 3.7], [77250, 7], [77000, 0.8], [76750, 2.8], [76500, 2.3], [76250, 0.9], [76000, 1.7], [75750, 5.5], [75500, 11.2], [75250, 2.3], [75000, 4.8], [74750, 0.2], [74500, 0.1]]
  longs: [[74250, 0.2], [74000, 0.8], [73750, 6.9], [73500, 19], [73250, 7.9], [73000, 25.2], [72750, 4.1], [72500, 21.9], [72250, 36.9], [72000, 9.7], [71750, 21.8], [71500, 16.9], [71250, 6]]
  note: "Mapa z 14:49, cena wtedy 74 723; pokrycie 47% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: -34.1, note: "130 kont" }
    - { label: "Reszta rynku", value: 6, note: "27 480 kont" }
    - { label: "Animatorzy rynku", value: -9.5, note: "220 kont" }
setups:
  - name: "Akceptacja nad pasmem +1σ VWAP i okrągłym 75 000"
    bias: up
    zone: [75000, 75175]
    window: "do 19:30"
    triggers:
      - "Zamknięcie świecy 15 min nad pasmem +1σ 75 007, a potem 30 min nad VAH 24 h 75 175."
      - "Delta tych świec dodatnia, bez nierównowag sprzedaży na górze świecy jak o 14:00."
      - "OI rośnie razem z ceną albo spada przy wzroście, czyli likwidacje shortów przy 75 150."
    invalidation: "Zamknięcie 30 min pod VWAP dnia 74 557."
    reactions:
      - { label: "Likwidacje shortów", price: 75150 }
      - { label: "Szczyt Azji", price: 75585 }
      - { label: "Likwidacje shortów", price: 75650 }
    evidence: "Laboratorium desku dla oporu na okrągłym poziomie: n 340, częstość 47% wobec 49% losowo, czyli bez przewagi; to opis mechaniki, nie statystyka."
  - name: "Utrata VWAP i powrót do dołka Londynu"
    bias: down
    zone: [73836, 74107]
    window: "do 19:30"
    triggers:
      - "Zamknięcie świecy 15 min pod VWAP dnia 74 557 i pod POC 24 h 74 500."
      - "Ujemna delta tej świecy, a kolejne nie odzyskują strefy 74 650 z POC ostatnich świec."
      - "OI spada przy spadku ceny, a zamknięcie 15 min wypada pod pasmem −1σ 74 107."
    invalidation: "Zamknięcie 30 min z powrotem nad otwarciem tygodnia 74 820."
    reactions:
      - { label: "Otwarcie Londynu", price: 73836 }
      - { label: "Dołek Azji", price: 73715 }
      - { label: "Likwidacje longów", price: 73500 }
---
## Co się stało

Wczoraj o 22:45 jedna świeca 15 minut zepchnęła cenę z 75 576 do 73 413, a likwidacje longów w tym kwadransie wyniosły 39,7 mln USD. Noc odbiła do 75 697 o 00:15, potem rynek osuwał się aż do otwarcia Londynu przy 73 836. O 09:00 przyszedł dołek dnia 73 698, ale już o 09:45 kupujący wrzucili świecę z deltą +630 BTC i cena wróciła nad 74 500. Do 12:00 rynek krążył między 74 019 a 74 716, a od 13:15 ruszył w górę i o 13:45 dotknął 75 088. Ostatnie zamknięcie z taśmy, o 14:30, to 74 599.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Zakres ostatnich 24 godzin to od 73 413 do 76 081, a wczorajsze ekstrema PDH i PDL leżą przy 76 173 i 73 457. Cena stoi w dolnej połowie tego zakresu i tuż pod otwarciem tygodnia 74 820. Poranne zejście pod otwarcie Londynu skończyło się szybkim powrotem, więc to było nieudane wybicie w dół, a popołudniowe podejście do 75 000 też nie dało kontynuacji.

**Wartość.** POC z 24 godzin jest przy 74 500, obszar wartości od 73 900 do 75 175, a cena stoi w środku, blisko POC. Pod VAL zamknęły się tylko dwie świece 15 minut, o 08:45 i 09:00, i od 09:15 cena była już z powrotem w środku, czyli odrzucenie. Nad VAH nocą od 03:00 do 03:45 zamknęły się cztery kolejne świece 15 minut, ale o 04:00 cena zeszła do 74 975 i tej akceptacji już nie odzyskała.

**VWAP.** VWAP dnia jest przy 74 557, przy σ 450, a cena stoi 0,09σ nad nim, czyli praktycznie na nim. Od 04:45 do 12:15 każde zamknięcie 15 minut wypadało pod VWAP, a od 13:15 każde jest nad nim. Pasmo +1σ przy 75 007 zadziałało jak opór: świeca 13:45 przebiła je knotem do 75 088 i zamknęła się pod nim. Od 09:15 każde zamknięcie wypada nad pasmem −1σ.

**Przepływ i pozycje.** W ostatnich 4 godzinach delta jest dodatnia, +170,5 BTC, cena wzrosła o 386 USD, a OI o 229,1 BTC, czyli wzrost niosły nowe longi. W ostatniej godzinie obraz się zmienia: delta +157 BTC, cena 166 USD niżej, OI w górę o 270,8 BTC. Spadek ceny przy rosnącym OI to według macierzy nowe shorty, a dodatnia delta mówi, że agresywne kupno trafia na pasywną podaż. Samo w sobie to jeszcze nie sygnał, liczy się dopiero reakcja ceny. Delta z całej doby, −2 520,7 BTC, to w większości wczorajsza kaskada.

## Footprint podejścia pod 75 000

[[footprint]]

Sekwencja zaczyna się o 12:45 od sprzedaży z deltą −105,9 BTC i POC przy 74 400. O 13:15 kupujący przejęli inicjatywę: delta +218,1 BTC, wolumen 488,2 BTC i OI w górę o 431,6 BTC. Świeca 13:30 miała prawie tyle samo wolumenu, 476,9 BTC, i dodatnią deltę, ale z 75 000 zamknęła się przy 74 764, co wygląda na absorpcję kupna przez podaż. O 13:45 powstał jedyny stos nierównowag w tym oknie, cztery poziomy kupna od 74 850 do 75 050, tyle że przy mniejszym wolumenie 269,5 BTC, czyli z oznakami wyczerpania na ekstremum. O 14:00 odpowiedziała sprzedaż z nierównowagami przy 74 900 i 74 850, a o 14:15 sprzedaż schodząca do 74 570 została tam wchłonięta i świeca zamknęła się przy 74 757.

Linia frontu to teraz dwie strefy. Od dołu POC dwóch ostatnich świec przy 74 650, który cena właśnie zamknęła od spodu, i dołek 74 570 z wchłoniętą sprzedażą. Od góry stos kupna od 74 850 do 75 050, który rynek oddał zamknięciem pod nim, więc z dawnego wsparcia zrobił się obszar, w którym wygasło całe popołudniowe podejście.

## Gdzie leży płynność

[[likwidacje]]

Rano mapa była przechylona w dół, teraz jest odwrotnie. W 1% nad ceną leży 5,7 mln USD shortów do likwidacji, a pod ceną 2,8 mln USD longów. Największe skupisko nad ceną to 11,2 mln USD przy 75 500, a bliżej są 4,8 mln USD przy 75 000. Pod spodem duże kwoty zaczynają się dopiero od 73 500 (19,0 mln USD), dalej 25,2 mln USD przy 73 000 i 36,9 mln USD przy 72 250. Mapa pokrywa 47% otwartych pozycji, więc to obraz części rynku.

## Kto handluje

[[przeplywy]]

Przez ostatnią dobę agresorzy sprzedali netto o 37,5 mln USD więcej, niż kupili, a rano ta różnica wynosiła 70,3 mln USD, więc popołudnie przyniosło przewagę kupna. Prawie cały minus to 130 kont wielorybów z wynikiem −34,1 mln USD, animatorzy rynku dołożyli −9,5 mln USD, a reszta rynku, 27 480 kont, jest na plusie 6 mln USD. Premia perp jest ujemna, −2,5 bp, przy średniej z doby −2,8 bp, funding 0,13 bp/h prawie jak średnio. Arkusz w paśmie ±10 bp ma 52% bidów wobec zwykłych 50% o tej godzinie.

## Zmienność i rozkład

[[scenariusze]]

Model daje do 19:30 odchylenie 141 bp, co przekłada się na zakres 68% od 73 745 do 75 862 i zakres 95% od 72 709 do 76 942. Zmienność 5 minut z ostatniej doby to 16,0 bp wobec 13,9 bp w poprzednich dniach roboczych, a obecny reżim trwa około 2 godzin przy 11,0 bp na 5 minut. Niezależna prognoza desku na 4 godziny ma medianę 74 660 i połowę rozkładu między 74 028 a 75 298. Na rynku dziennym „BTC powyżej 74 456” do jutra 07:00 rynek wycenia 60%, model 59%, czyli bez różnicy wartej uwagi.

## Struktura dnia

[[poziomy]]

Cena stoi między VWAP dnia 74 557 a otwarciem tygodnia 74 820, a model daje odpowiednio 81% i 99% na dotknięcie każdego z nich do 19:30. Likwidacje shortów przy 75 150 mają 73%, VAL wczoraj 74 444 ma 71%. Dalej szanse spadają szybko: szczyt Azji 75 585 to 42%, otwarcie Londynu 73 836 to 32%, a dołek Azji 73 715 to 26%. Otwarcie Nowego Jorku jest o 15:30.

## Co musiałoby się wydarzyć

[[setupy]]

Pierwszy obraz to akceptacja nad 75 000: zamknięcie nad pasmem +1σ, a potem 30 minut nad VAH 24 h z dodatnią deltą i rosnącym OI wciągnęłoby cenę w shorty przy 75 150 i dalej w stronę szczytu Azji. Laboratorium desku nie widzi przewagi w oporze na okrągłych poziomach, więc to opis mechaniki. Drugi obraz to utrata VWAP: zamknięcie pod 74 557 i POC 24 h z ujemną deltą i spadającym OI otwiera drogę do pasma −1σ i otwarcia Londynu. Reguła powrotu do obszaru wartości nie była sprawdzana w laboratorium desku, więc traktuję ją jako wskazówkę, nie statystykę.

## Na co patrzę dalej

Najważniejsza jest pierwsza godzina po 15:30 i to, po której stronie VWAP dnia zamknie się rynek. Patrzę na OI: jeśli dalej rośnie przy cenie stojącej w miejscu, przybywa pozycji, które ustawią następny ruch. Obraz zmienia zamknięcie 30 minut nad 75 175 albo pod 74 107.

## Rzetelność modelu

Na 4 godziny przedział 90% objął 90% wyników, ale przedział 60% objął 73%, więc jest za szeroki; na 1 godzinę podobnie, 92% i 71% (n 1 732). Prognozy dotknięć PDH, PDL i środka mają Brier 0,074 wobec 0,120 dla samej częstości bazowej.

Prawdopodobieństwa w tym wpisie pochodzą z modelu desku HAR + FHS i symulacji Monte Carlo, policzone o 14:50 i zapisane przed faktem, żeby po 19:30 dało się je uczciwie rozliczyć. Następny wpis o 15:45, po otwarciu Nowego Jorku.
