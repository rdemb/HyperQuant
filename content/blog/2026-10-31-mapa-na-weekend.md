---
title: "Sobota w środku wartości na 77 513. Nad ceną 12,3 mln USD shortów do likwidacji"
description: "BTC-PERP stoi na 77 513, w obszarze wartości doby i 0,8% nad piątkowym zamknięciem CME. Nad ceną leżą shorty, pod nią pusto do 76 500. Poziomy i prawdopodobieństwa do niedzieli 10:00."
date: 2026-10-31T22:00:20+01:00
type: article
section: Mapa na weekend
price: 77513
levels:
  - { label: "Likwidacje shortów", price: 78350, note: "4,4 mln USD, 14% dotknięcia do 10:00" }
  - { label: "Likwidacje shortów", price: 78250, note: "4,2 mln USD, 20% dotknięcia do 10:00" }
  - { label: "VAH wczoraj", price: 77766, note: "65% dotknięcia do 10:00" }
  - { label: "Szczyt Azji", price: 77633, note: "83% dotknięcia do 10:00" }
  - { label: "VWAP dnia", price: 77414, note: "86% dotknięcia do 10:00" }
  - { label: "Otwarcie Londynu", price: 77317, note: "73% dotknięcia do 10:00" }
  - { label: "POC wczoraj", price: 77084, note: "45% dotknięcia do 10:00" }
  - { label: "Dołek Azji", price: 77072, note: "44% dotknięcia do 10:00" }
  - { label: "VAL wczoraj", price: 76674, note: "15% dotknięcia do 10:00" }
scenarios:
  - label: "Cena w niedzielę o 10:00 poniżej 77 080"
    probability: 22
    note: "Cena musi zejść pod VWAP dnia 77 414 i pod dołek Azji 77 072. To po drodze zbliża ją do piątkowego zamknięcia CME na 76 899."
  - label: "Cena w niedzielę o 10:00 między 77 080 a 77 770"
    probability: 45
    note: "Wystarczy dalsza nocna rotacja wokół VWAP 77 414 i POC doby 77 400, bez wyjścia z obszaru wartości. Przy zmienności o połowę niższej niż w tygodniu to najprostsza droga."
  - label: "Cena w niedzielę o 10:00 powyżej 77 770"
    probability: 33
    note: "Cena musi utrzymać się nad szczytem doby 77 750, czyli wejść w pierwsze skupiska shortów z ceną likwidacji między 77 750 a 78 250."
summary:
  - "BTC stoi na 77 513, w środku obszaru wartości doby (77 100 do 77 625) i 0,8% nad piątkowym zamknięciem CME 76 899."
  - "W 1% nad ceną leży 12,3 mln USD shortów z ceną likwidacji, w 1% pod ceną praktycznie zero longów."
  - "Wieloryby kupowały agresywnie za 10,5 mln USD netto w 24 h, reszta rynku sprzedała za 3,1 mln USD."
  - "Zmienność 5 min to 6,3 bp wobec 11,4 bp w dni robocze, a zakres 68% do niedzieli 10:00 to 76 936 do 78 094."
metrics:
  - { label: "Premia perp", value: "0,6 bp", note: "średnio 24 h 1,3 bp" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,12 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "8,5 mln USD", note: "kupno biorców 45,8, sprzedaż 37,3 mln USD", bias: up }
  - { label: "Likwidacje 24 h", value: "1,5 mln USD", note: "longi 0,0, shorty 1,5 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "0,0 mln USD", note: "do likwidacji między 76 738 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "12,3 mln USD", note: "do likwidacji między ceną a 78 288" }
  - { label: "Arkusz ±10 bp: bidy", value: "52% bidów", note: "zwykle o tej godzinie 51% (10 dni)", bias: flat }
  - { label: "Zmienność 5 min, 24 h", value: "6,3 bp", note: "poprzednie dni robocze (5): 11,4 bp" }
liquidations:
  step: 250
  coverage: 46
  shorts: [[80750, 0.6], [80500, 2.4], [80250, 2.3], [80000, 3], [79750, 0.5], [79500, 19.1], [79250, 3.8], [79000, 3.5], [78750, 3.6], [78500, 4.4], [78250, 5.5], [78000, 6.3], [77750, 5.9]]
  longs: [[76500, 12.6], [76250, 2.5], [76000, 30.2], [75750, 28.2], [75500, 33.5], [75250, 7.2], [75000, 21.9], [74750, 2.7], [74500, 13.3], [74250, 4.9], [74000, 6]]
  note: "Mapa z 22:02, cena wtedy 77 423; pokrycie 46% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: 10.5, note: "60 kont" }
    - { label: "Reszta rynku", value: -3.1, note: "13 950 kont" }
    - { label: "Animatorzy rynku", value: 1.1, note: "180 kont" }
setups:
  - name: "Wejście w skupiska shortów nad szczytem doby"
    bias: up
    zone: [77750, 78250]
    window: "do 10:00 w niedzielę"
    triggers:
      - "Świeca 15 min zamyka się nad VAH doby 77 625 i nad pasmem +1σ VWAP 77 568, które od 20:15 trzyma cenę."
      - "Delta godzinowa odwraca się z minusa na plus."
      - "Open interest spada przy rosnącej cenie, czyli shorty zamykają pozycje, a likwidacje shortów rosną skokowo."
    invalidation: "Zamknięcie świecy 15 min z powrotem pod VWAP dnia 77 414."
    reactions:
      - { label: "VAH wczoraj", price: 77766 }
      - { label: "Likwidacje shortów", price: 78250 }
      - { label: "Likwidacje shortów", price: 78350 }
    evidence: "Opór na okrągłym poziomie, tu 78 000, w laboratorium desku zadziałał w 47% z 326 przypadków wobec 49% losowo. To szum, nie przewaga."
  - name: "Zejście w stronę piątkowego zamknięcia CME"
    bias: down
    zone: [76899, 77100]
    window: "do 10:00 w niedzielę"
    triggers:
      - "Świeca 15 min zamyka się pod VWAP dnia 77 414, a potem pod VAL doby 77 100."
      - "Delta zostaje ujemna jak w ostatniej godzinie, kiedy wyniosła −205 BTC."
      - "Open interest dalej spada, czyli to zamykanie longów, a nie nowe shorty."
    invalidation: "Zamknięcie świecy 15 min z powrotem nad VWAP dnia 77 414."
    reactions:
      - { label: "POC wczoraj", price: 77084 }
      - { label: "Dołek Azji", price: 77072 }
      - { label: "VAL wczoraj", price: 76674 }
      - { label: "Likwidacje longów", price: 76500 }
    evidence: "Domknięcie luki CME w laboratorium desku: 52% z 21 przypadków wobec 50% losowo. Za mało obserwacji, żeby z tego coś wnioskować."
  - name: "Nocna rotacja w obszarze wartości doby"
    bias: flat
    zone: [77100, 77625]
    window: "do 10:00 w niedzielę"
    triggers:
      - "Świece 15 min zamykają się między VAL 77 100 a VAH 77 625, a wybicia kończą się knotem."
      - "Delta kręci się wokół zera, bez serii w jedną stronę."
      - "Open interest stoi w miejscu albo powoli spada."
    invalidation: "Dwie świece 30 min zamknięte poza obszarem wartości doby."
    reactions:
      - { label: "VWAP dnia", price: 77414 }
      - { label: "Otwarcie Londynu", price: 77317 }
    evidence: "Powrót do VWAP w laboratorium desku wyszedł w 36% ze 178 przypadków wobec 43% losowo, więc to wskazówka, nie statystyka."
---
## Co się stało

Doba zaczęła się w piątek o 22:00 dołkiem 76 567, praktycznie w chwili zamknięcia CME, które wypadło na 76 899. Od tego miejsca cena powoli wspinała się przez całą sobotę i o 18:45 zrobiła szczyt doby 77 750. Teraz stoi na 77 513, czyli 0,8% nad piątkowym zamknięciem CME. Cały sobotni ruch zmieścił się w zakresie piątku, między PDL 76 264 a PDH 78 772, więc to klasyczny dzień wewnętrzny: rynek odpoczywa po piątkowej huśtawce.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Piątek dał szeroki zakres od 76 264 do 78 772, a sobota nie wyszła ani nad jego szczyt, ani pod dołek. Ostatni ruch w górę do 77 750 nie był wybiciem, tylko odbiciem w środku piątkowego zakresu, które od wieczora oddaje część zysku. Do PDH brakuje 1 259 dolarów, do PDL 1 249, więc cena stoi niemal dokładnie w połowie.

**Wartość.** POC doby leży na 77 400, obszar wartości od 77 100 do 77 625, a cena jest w jego środku. Wyjście do 77 750 nad VAH nie zostało zaakceptowane: cena wróciła do wartości, a od 20:15 żadna świeca 15 min nie zamknęła się nad 77 600.

**VWAP.** VWAP dnia liczony od północy UTC to 77 414, odchylenie 154 dolary, a cena jest 0,64σ nad nim. Pasmo +1σ na 77 568 zadziałało wieczorem jak opór: po świecy z 20:00, zamkniętej na 77 649, kolejne świece kończyły się już pod nim. VWAP pod ceną jest najbliższym wsparciem i najbliższym miejscem, do którego model daje 86% szansy dotknięcia do rana.

**Przepływ i pozycje.** W ostatniej godzinie delta wyniosła −205 BTC, a w ostatnich czterech −202 BTC, przy cenie niżej o 24 i o 66 dolarów. Open interest spadł w tym czasie o 297 BTC w godzinę i o 163 BTC w cztery godziny. Cena w dół i OI w dół to zamykanie longów, nie budowanie nowych shortów. Sprzedaży było dużo, a cena prawie stała, i to jest ważniejsze niż sama ujemna delta.

## Footprint zejścia z 77 649

[[footprint]]

Okno zaczyna się o 20:00 inicjatywą kupujących: stos trzech nierównowag kupna od 77 600 do 77 620, delta +47 BTC i zamknięcie na 77 649 przy spadku OI o 59 BTC, czyli domykanie shortów. Odpowiedź przyszła od razu o 20:15: stos pięciu nierównowag sprzedaży od 77 560 do 77 600 i zamknięcie na 77 551. Potem wolumen wyraźnie spadł, a świece od 20:30 do 21:15 kręciły się w kilkudziesięciu dolarach. Ostatnie pół godziny to absorpcja: o 21:45 delta −142 BTC przy wolumenie 155 BTC, a cena przesunęła się tylko z 77 536 do 77 513. OI spadło w tej świecy o 238 BTC, więc sprzedawali głównie ci, którzy zamykali longi, a pasywne bidy przy 77 507 to wchłonęły.

Linia frontu jest teraz wąska. Od góry stos sprzedaży 77 560 do 77 600 z 20:15, od dołu POC ostatniej świecy 77 510 ze stosem sprzedaży od 77 510 do 77 530. Dopóki cena jest między nimi, żadna strona nie przejęła inicjatywy. Wyżej nietknięta zostaje strefa kupna 77 730 do 77 760, a niżej niedokończony POC po sesji na 76 765.

## Gdzie leży płynność

[[likwidacje]]

Asymetria jest wyraźna. W 1% nad ceną, do 78 288, leży 12,3 mln USD shortów z ceną likwidacji, a pierwsze skupiska to 77 750 (5,9 mln), 78 000 (6,3 mln) i 78 250 (5,5 mln). Największe skupisko nad ceną to dopiero 79 500 z 19,1 mln. Pod ceną w 1% nie ma praktycznie nic, pierwsze longi to 76 500 (12,6 mln), a potem duże pakiety od 76 000 do 75 500, w sumie ponad 90 mln USD. Mapa obejmuje 46% otwartych pozycji, więc realne kwoty są większe, ale proporcja zostaje: paliwo jest nad ceną blisko, pod ceną daleko.

## Kto handluje

[[przeplywy]]

W ostatnich 24 godzinach biorcy kupili za 45,8 mln USD i sprzedali za 37,3 mln, netto 8,5 mln po stronie kupna. Prawie całość to 60 kont wielorybów z wynikiem +10,5 mln USD, podczas gdy 13 950 kont reszty rynku sprzedało netto za 3,1 mln. Kontrakt jest notowany 0,6 bp nad indeksem przy średniej z doby 1,3 bp, a funding 0,13 bp na godzinę jest blisko średniej. Nic tu nie wskazuje na przegrzanie. W arkuszu w paśmie ±10 bp bidy mają 52% przy typowych 51% o tej godzinie, więc to stan neutralny.

## Zmienność i rozkład

[[scenariusze]]

Sobota była cicha. Odchylenie zwrotów 5 min z doby to 6,3 bp wobec 11,4 bp w poprzednich pięciu dniach roboczych, a model liczy obecny reżim na 3,9 bp na 5 minut. Zakres 68% do niedzieli 10:00 to 76 936 do 78 094, zakres 95% od 76 363 do 78 680. Prognoza desku na 4 godziny daje medianę 77 506 i połowę rozkładu między 77 268 a 77 753. Rynek HIP-4 „BTC powyżej 77 231” wycenia 74%, model 73%, czyli zgodnie.

## Struktura dnia

[[poziomy]]

Cena jest nad VWAP dnia 77 414 i nad otwarciem Londynu 77 317, ale pod szczytem Azji 77 633 i wczorajszym VAH 77 766. Szczyt Azji ma 83% szansy dotknięcia do 10:00, VWAP 86%, więc model spodziewa się, że noc zahaczy o oba brzegi tego pasa. Wczorajszy POC 77 084 i dołek Azji 77 072 leżą razem i mają po około 45%. Dalej od ceny szanse szybko spadają: VAL wczoraj 76 674 ma 15%, a skupiska shortów na 78 250 i 78 350 mają 20% i 14%.

## Co musiałoby się wydarzyć

[[setupy]]

Do wzrostu potrzebne jest zamknięcie nad wartością doby i przejście przez pasmo +1σ, które wieczorem zatrzymało cenę, z deltą na plusie i spadającym OI, bo wtedy ruch napędzają zamykane shorty. Do spadku potrzebne jest zamknięcie pod VWAP i VAL 77 100, a wtedy najbliższy cel ceny to piątkowe zamknięcie CME. Najbardziej prawdopodobna jest jednak zwykła nocna rotacja w obszarze wartości, bo zmienność jest o połowę niższa niż w tygodniu.

## Na co patrzę dalej

Patrzę na to, czy absorpcja z 21:45 przy 77 507 się utrzyma. Jeśli bidy oddadzą ten poziom przy dalszym spadku OI, droga do VWAP i dołka Azji jest otwarta. Jeśli cena wróci nad 77 600 z dodatnią deltą, wraca temat skupisk shortów nad 77 750. Weekendowy arkusz jest płytki, więc pojedynczy większy przepływ przesunie cenę dalej niż w tygodniu.

## Rzetelność modelu

Przedziały desku są raczej za szerokie niż za wąskie: przedział 90% na 4 godziny objął cenę w 92% z 885 przypadków, a przedział 60% w 73%. Dla dotknięć PDH, PDL i środka zakresu Brier wynosi 0,078 wobec 0,112 dla częstości bazowej (893 przypadki), więc model dodaje informację ponad samą historię.

Prawdopodobieństwa pochodzą z modelu desku (HAR + FHS) i symulacji Monte Carlo, policzone o 22:00 i zapisane przed faktem. Następny wpis to aktualizacja w niedzielę o 10:00, a mapa tygodnia w niedzielę o 20:00.
