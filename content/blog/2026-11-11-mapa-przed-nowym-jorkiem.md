---
title: "BTC 73 722 przed Nowym Jorkiem: 42% na zakres 73 170–74 080 o 19:30"
description: "Bitcoin stoi przy VWAP dnia 73 772 po dwóch nieudanych podejściach Londynu pod 74 170. Model daje 68% na zakres 72 811–74 622 do 19:30."
date: 2026-11-11T14:50:21+01:00
type: article
section: Mapa przed Nowym Jorkiem
price: 73722
levels:
  - { label: "Likwidacje shortów", price: 74350, note: "7,2 mln USD, 45% dotknięcia do 19:30" }
  - { label: "VAH wczoraj", price: 74259, note: "52% dotknięcia do 19:30" }
  - { label: "Szczyt Azji", price: 74096, note: "66% dotknięcia do 19:30" }
  - { label: "Otwarcie Londynu", price: 74076, note: "67% dotknięcia do 19:30" }
  - { label: "POC wczoraj", price: 73797, note: "93% dotknięcia do 19:30" }
  - { label: "VWAP dnia", price: 73772, note: "95% dotknięcia do 19:30" }
  - { label: "Dołek Azji", price: 73174, note: "49% dotknięcia do 19:30" }
  - { label: "Likwidacje longów", price: 73050, note: "20,3 mln USD, 41% dotknięcia do 19:30" }
  - { label: "VAL wczoraj", price: 72779, note: "24% dotknięcia do 19:30" }
scenarios:
  - label: "Cena o 19:30 poniżej 73 170"
    probability: 24
    note: "Cena musiałaby zejść pod dołek Azji 73 174 i utrzymać się tam do końca okna, czyli wejść w klaster longów przy 73 050."
  - label: "Cena o 19:30 między 73 170 a 74 080"
    probability: 42
    note: "Nowy Jork nie rozstrzyga i cena dalej krąży wokół VWAP 73 772 w obszarze wartości z ostatniej doby."
  - label: "Cena o 19:30 powyżej 74 080"
    probability: 34
    note: "Trzeba przebić strefę 74 020–74 096, gdzie Londyn kilka razy się zatrzymał, i utrzymać cenę nad otwarciem Londynu."
summary:
  - "Cena 73 722 stoi tuż pod VWAP dnia 73 772, w środku obszaru wartości z 24 godzin (73 200–74 100)."
  - "Model daje 68% na zakres 72 811–74 622 do 19:30, a najbardziej prawdopodobny scenariusz to 73 170–74 080 z szansą 42%."
  - "Pod ceną w 1% czeka 21,7 mln USD longów do likwidacji, nad ceną tylko 8,9 mln USD shortów."
  - "Wieloryby sprzedały agresywnie netto 137,3 mln USD w 24 godziny, reszta rynku kupiła netto 12 mln USD."
metrics:
  - { label: "Premia perp", value: "−4,2 bp", note: "średnio 24 h −3,4 bp" }
  - { label: "Funding", value: "0,09 bp/h", note: "średnio 24 h 0,12 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "−131,5 mln USD", note: "kupno biorców 425,3, sprzedaż 556,8 mln USD" }
  - { label: "Likwidacje 24 h", value: "31,3 mln USD", note: "longi 25,9, shorty 5,3 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "21,7 mln USD", note: "do likwidacji między 72 985 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "8,9 mln USD", note: "do likwidacji między ceną a 74 459" }
  - { label: "Arkusz ±10 bp: bidy", value: "50% bidów", note: "zwykle o tej godzinie 50% (21 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "14,0 bp", note: "poprzednie dni robocze (5): 14,6 bp" }
liquidations:
  step: 250
  coverage: 47
  shorts: [[77000, 1.8], [76750, 0.2], [76500, 3.6], [76250, 2.4], [76000, 11.4], [75750, 1], [75500, 1.8], [75250, 1.1], [75000, 8.2], [74750, 7.2], [74500, 31.3], [74250, 8.3], [74000, 0.6]]
  longs: [[73000, 21.7], [72750, 8.8], [72500, 41.2], [72250, 7.3], [72000, 11.9], [71750, 9.8], [71500, 52.9], [71250, 50.1], [71000, 11], [70750, 6], [70500, 69.3]]
  note: "Mapa z 14:44, cena wtedy 73 719; pokrycie 47% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: -137.3, note: "120 kont" }
    - { label: "Reszta rynku", value: 12, note: "23 690 kont" }
    - { label: "Animatorzy rynku", value: -6.2, note: "230 kont" }
setups:
  - name: "Wybicie nad szczyt Azji w stronę klastra shortów"
    bias: up
    zone: [74076, 74350]
    window: "do 19:30"
    triggers:
      - "Świeca 15 min zamyka się nad szczytem Azji 74 096, czyli nad strefą, w której Londyn kilka razy się zatrzymał."
      - "Delta tej świecy jest dodatnia i cena nie wraca od razu pod 74 020."
      - "Open interest rośnie razem z ceną, co oznacza nowe longi, a nie tylko zamykanie shortów."
    invalidation: "Zamknięcie świecy 15 min z powrotem pod VWAP dnia 73 772."
    reactions:
      - { label: "VAH wczoraj", price: 74259 }
      - { label: "Likwidacje shortów", price: 74350 }
  - name: "Zejście pod dołek Azji do klastra longów"
    bias: down
    zone: [73050, 73174]
    window: "do 19:30"
    triggers:
      - "Świeca 15 min zamyka się pod dołkiem z 14:30 (73 649) i pod pasmem VWAP −1σ (73 564)."
      - "Delta jest ujemna i tym razem nikt jej nie wchłania, inaczej niż o 14:00 przy 73 704."
      - "Open interest rośnie przy spadku (nowe shorty); jego spadek oznaczałby raczej zamykanie longów i likwidacje."
    invalidation: "Powrót i zamknięcie świecy 15 min nad VWAP dnia 73 772."
    reactions:
      - { label: "Dołek Azji", price: 73174 }
      - { label: "Likwidacje longów", price: 73050 }
      - { label: "VAL wczoraj", price: 72779 }
  - name: "Rotacja wokół VWAP i POC"
    bias: flat
    zone: [73564, 73980]
    window: "do 19:30"
    triggers:
      - "Świece 15 min zamykają się na przemian po obu stronach VWAP 73 772, bez zamknięcia poza pasmami ±1σ."
      - "Delta świec bliska zera, bez nowych stosów nierównowag."
      - "Open interest stoi w miejscu."
    invalidation: "Zamknięcie świecy 15 min nad pasmem +1σ (73 980) albo pod pasmem −1σ (73 564)."
    reactions:
      - { label: "VWAP dnia", price: 73772 }
      - { label: "POC wczoraj", price: 73797 }
    evidence: "Reguła powrotu do VWAP w laboratorium desku: n 189, częstość 36% wobec 43% losowej, bez przewagi. To wskazówka, nie statystyka."
---
## Co się stało

Wczoraj Nowy Jork otworzył się mocno: świeca z 15:30 wyniosła cenę do 74 409 z deltą 742 BTC, a o 16:00 szczyt doby sięgnął 74 850, tuż nad otwarciem tygodnia 74 820. Wybicie nie znalazło kontynuacji. Świeca z 16:30 zjechała do 72 810 z deltą −2 657 BTC, a dołek doby 72 647 padł w kwadransie od 17:30. W tym czasie zlikwidowano 12,1 mln USD longów o 16:30 i 13,7 mln USD o 17:30. Noc i Azja upłynęły w przedziale 73 174–74 096. Londyn otworzył się przy 74 076, dwa razy podszedł pod 74 150 i 74 170 i dwa razy wrócił. Teraz cena stoi przy 73 722, tuż pod VWAP dnia.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Cena jest 150 bp pod otwarciem tygodnia 74 820, między wczorajszym szczytem 75 401 a dołkiem 72 668. Ostatni ważny ruch to nieudane wybicie: wczorajszy atak na 74 850 nad otwarciem tygodnia skończył się spadkiem o ponad 2 200 dolarów w niespełna dwie godziny. Od tamtej pory rynek odrabia straty powoli i bez pośpiechu.

**Wartość.** POC z ostatnich 24 godzin to 73 775, obszar wartości 73 200–74 100, a cena 73 722 jest w samym środku. Wczoraj wieczorem rynek zaakceptował ceny pod VAL: świece od 16:30 do 19:00 w większości zamykały się poniżej 73 200. Od 19:15 każda świeca 15 min zamyka się już w obszarze wartości, a żadna nie zamknęła się nad VAH 74 100, choć świeca z 09:00 skończyła przy 74 099.

**VWAP.** VWAP dnia to 73 772 przy σ 207,8, cena jest 0,24σ pod nim. Od 11:15 do 14:15 każda świeca zamykała się nad VWAP, a świeca z 14:30 jest pierwszą od 11:00 z zamknięciem pod nim. Pasmo +1σ, około 73 980, działało jako opór: od 12:45 żadna świeca nie zamknęła się nad nim.

**Przepływ i pozycje.** Taśma obejmuje całą dobę do 14:45. W ostatniej godzinie cena spadła o 224 dolary, delta wyniosła −459,5 BTC, a open interest wzrósł o 311 BTC, czyli według macierzy pojawiły się nowe shorty. W ciągu 4 godzin cena jest 113 dolarów wyżej, OI wzrósł o 550,4 BTC przy delcie −70,4 BTC, więc wcześniejsze odbicie budowały raczej nowe longi otwierane limitami. Delta z całej doby to −2 656,9 BTC, w dużej części z wczorajszego zrzutu.

## Footprint ostatniego podejścia pod 74 000

[[footprint]]

Okno od 13:00 do 14:45 pokazuje wygasanie popytu pod 74 000. Świeca z 13:00 miała dodatnią deltę 102,8 BTC i najwyższy wolumen okna, 426,1 BTC. Kwadrans później cena dotknęła 74 070, ale odpowiedziała druga strona: stos czterech nierównowag sprzedaży od 73 860 do 73 920 i delta −67,3 BTC. Kolejne szczyty były coraz niższe (74 050, potem 74 038), a wolumen spadał do 250,2 i 265,8 BTC, co wygląda na wyczerpanie kupujących. O 14:00 sprzedający docisnęli z deltą −198,1 BTC do 73 704, lecz świeca zamknęła się przy 73 946, blisko szczytu: to absorpcja, sprzedaż wchłonięta bez postępu ceny, przy wzroście OI o 237 BTC. Ostatnia świeca z 14:30 zeszła do 73 649 przy najniższym wolumenie okna, 152,1 BTC.

Linia frontu biegnie teraz przez stos sprzedaży 73 860–73 920 nad ceną i przez nierównowagi kupna 74 020–74 040, które dwa razy z rzędu zatrzymały świece pod szczytem. Od dołu punktem odniesienia jest POC świecy z absorpcją, 73 740, a dalej dołek 73 649.

## Gdzie leży płynność

[[likwidacje]]

Mapa obejmuje 47% otwartych pozycji i jest wyraźnie przechylona w dół. W 1% pod ceną czeka 21,7 mln USD longów, nad ceną tylko 8,9 mln USD shortów. Najbliższy duży przedział longów to 73 000 z 21,7 mln USD, dalej 72 500 z 41,2 mln USD i 71 500 z 52,9 mln USD. Nad ceną wyróżnia się przedział 74 500 z 31,3 mln USD, a po drodze 74 250 z 8,3 mln USD. Model daje 45% na dotknięcie klastra shortów przy 74 350 i 41% na klaster longów przy 73 050 do 19:30.

## Kto handluje

[[przeplywy]]

Przez ostatnią dobę agresywna sprzedaż przeważała o 131,5 mln USD. Prawie całość to 120 kont wielorybów z wynikiem −137,3 mln USD, a ponad 23 tysiące mniejszych kont kupiło netto 12 mln USD. Animatorzy rynku są lekko po stronie sprzedaży, −6,2 mln USD. Perp handluje z premią −4,2 bp wobec indeksu, niżej niż średnio przez dobę (−3,4 bp), a funding 0,09 bp/h jest niski. Arkusz w ±10 bp jest zrównoważony, 50% bidów, tak jak zwykle o tej godzinie.

## Zmienność i rozkład

[[scenariusze]]

Do 19:30 model liczy σ 123 bp, co daje zakres 68% od 72 811 do 74 622 i 95% od 71 922 do 75 545. Zmienność 5 min z ostatniej doby to 14,0 bp wobec 14,6 bp w poprzednich pięciu dniach roboczych, więc rynek jest raczej spokojny. Reżim zmienności trwa około 20 godzin przy 11,2 bp na 5 minut, a szansa jego zmiany w najbliższych 25 minutach to 3%. Prognoza desku na 4 godziny daje medianę 73 742 i połowę wyników w 73 216–74 290. Na dziennym rynku HIP-4 „BTC powyżej 73 909” na jutro na 07:00 rynek płaci 43%, model desku daje 45%, różnica jest w granicach szumu.

## Struktura dnia

[[poziomy]]

Cena stoi tuż pod VWAP dnia 73 772 i wczorajszym POC 73 797, które model widzi dotknięte z szansą 95% i 93%. Nad nimi leżą otwarcie Londynu 74 076 i szczyt Azji 74 096 (67% i 66%), a wyżej wczorajszy VAH 74 259 z 52%. Pod ceną najbliższy jest dołek Azji 73 174 z 49%, potem klaster longów 73 050 i wczorajszy VAL 72 779 z 24%. Otwarcie Nowego Jorku o 15:30 wypada więc w środku zakresu.

## Co musiałoby się wydarzyć

[[setupy]]

Do wzrostu potrzebne jest zamknięcie kwadransa nad 74 096 z dodatnią deltą i rosnącym OI, czyli przebicie strefy, w której Londyn kilka razy się zatrzymał. Do spadku cena musiałaby zejść pod 73 564 bez takiej absorpcji jak o 14:00, a OI rósłby przy spadku. Jeśli żadne z tych zdarzeń nie nastąpi, najbardziej prawdopodobna jest dalsza rotacja wokół VWAP, na którą model daje 42%.

## Na co patrzę dalej

Najpierw pierwsza godzina Nowego Jorku: czy powtórzy się wczorajszy schemat, czyli szybki ruch w górę i zrzut, czy rynek zostanie w wartości. Obserwuję, czy wieloryby dalej sprzedają przy wzroście OI i czy longi przy 73 000 wytrzymają test. Obraz zmienia zamknięcie kwadransa poza pasmami ±1σ VWAP, czyli nad 73 980 albo pod 73 564.

## Rzetelność modelu

Przedziały desku na 4 godziny są dobrze skalibrowane: przedział 90% obejmuje 91% wyników, a 60% obejmuje 74% (n 1912), więc węższy przedział jest raczej zbyt ostrożny. Dla dotknięć PDH, PDL i środka Brier wynosi 0,073 wobec 0,082 dla bazy odległości i 0,123 dla częstości bazowej, czyli BSS 0,10 wobec odległości i 0,40 wobec częstości (n 1920). Przewaga nad samą odległością jest więc skromna.

Prawdopodobieństwa pochodzą z modelu desku HAR + FHS i symulacji Monte Carlo, policzone o 14:50 i zapisane przed faktem, a o 19:30 rozliczymy je z tym, co się stało. Następny wpis po otwarciu Nowego Jorku, o 15:45.
