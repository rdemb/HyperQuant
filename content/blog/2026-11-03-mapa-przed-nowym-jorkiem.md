---
title: "BTC 77 589 nad wartością dnia przed Nowym Jorkiem, 52% szans na dotknięcie 78 109"
description: "Bitcoin odbił z 76 338 do 77 864 i stoi 1,73σ nad VWAP dnia. Do 19:30 model daje 68% na zakres 76 653–78 454, a 20,2 mln USD shortów czeka w 1% nad ceną."
date: 2026-11-03T14:50:22+01:00
type: article
section: Mapa przed Nowym Jorkiem
price: 77589
levels:
  - { label: "VAH wczoraj", price: 78698, note: "21% dotknięcia do 19:30" }
  - { label: "Otwarcie tygodnia", price: 78326, note: "38% dotknięcia do 19:30" }
  - { label: "Likwidacje shortów", price: 78250, note: "12,4 mln USD, 43% dotknięcia do 19:30" }
  - { label: "POC wczoraj", price: 78109, note: "52% dotknięcia do 19:30" }
  - { label: "Szczyt Azji", price: 77306, note: "78% dotknięcia do 19:30" }
  - { label: "VAL wczoraj", price: 77026, note: "54% dotknięcia do 19:30" }
  - { label: "VWAP dnia", price: 76995, note: "52% dotknięcia do 19:30" }
  - { label: "Otwarcie Londynu", price: 76804, note: "40% dotknięcia do 19:30" }
  - { label: "PDL", price: 76670, note: "32% dotknięcia do 19:30" }
scenarios:
  - label: "Cena o 19:30 poniżej 77 030"
    probability: 28
    note: "Odbicie z Londynu musiałoby się cofnąć pod szczyt Azji 77 306 i VAL wczorajszej sesji, czyli cena wraca do obszaru wartości z ostatniej doby i do VWAP dnia."
  - label: "Cena o 19:30 między 77 030 a 78 110"
    probability: 45
    note: "Wystarczy, że Nowy Jork nie wybierze kierunku: cena krąży między VAL a POC wczorajszej sesji, a ruch z popołudnia zostaje przetrawiony bez kontynuacji."
  - label: "Cena o 19:30 powyżej 78 110"
    probability: 27
    note: "Ceny nad obszarem wartości z 24 h muszą zostać zaakceptowane, a kupujący przejść przez szczyt dnia 77 864 i klaster shortów przy 78 000–78 250."
summary:
  - "Cena 77 589 stoi nad obszarem wartości z 24 h (76 650–77 425) i 1,73σ nad VWAP dnia 76 987."
  - "Model do 19:30 daje 68% na zakres 76 653–78 454 i 52% szans na dotknięcie POC wczorajszej sesji 78 109."
  - "W 1% nad ceną czeka 20,2 mln USD shortów do likwidacji, w 1% pod ceną praktycznie nic."
  - "Przepływ 24 h jest po stronie sprzedających: netto −93,2 mln USD, z czego −88,3 mln USD to wieloryby."
metrics:
  - { label: "Premia perp", value: "−2,9 bp", note: "średnio 24 h −1,9 bp, perp pod indeksem mimo odbicia" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,12 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "−93,2 mln USD", note: "kupno biorców 229,5, sprzedaż 322,7 mln USD", bias: down }
  - { label: "Likwidacje 24 h", value: "25,6 mln USD", note: "longi 21,3, shorty 4,3 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "0,0 mln USD", note: "do likwidacji między 76 813 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "20,2 mln USD", note: "do likwidacji między ceną a 78 365", bias: up }
  - { label: "Arkusz ±10 bp: bidy", value: "47% bidów", note: "zwykle o tej godzinie 50% (13 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "11,3 bp", note: "poprzednie dni robocze (5): 12,4 bp" }
liquidations:
  step: 250
  coverage: 46
  shorts: [[80750, 4.1], [80500, 1.6], [80250, 1.6], [80000, 1.5], [79750, 1.5], [79500, 7.3], [79250, 6.4], [79000, 24.7], [78750, 1.8], [78500, 5.6], [78250, 1.1], [78000, 17.1], [77750, 1.7], [77500, 0.7]]
  longs: [[76500, 0.7], [76250, 7.4], [76000, 10.3], [75750, 48.6], [75500, 55.4], [75250, 5.7], [75000, 6.7], [74750, 6.2], [74500, 11.5], [74250, 3.9], [74000, 3.8]]
  note: "Mapa z 14:49, cena wtedy 77 497; pokrycie 46% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: -88.3, note: "100 kont" }
    - { label: "Reszta rynku", value: -11.9, note: "19 750 kont" }
    - { label: "Animatorzy rynku", value: 7, note: "210 kont" }
setups:
  - name: "Akceptacja nad obszarem wartości z 24 h"
    bias: up
    zone: [77425, 77650]
    window: "do 19:30"
    triggers:
      - "Druga z rzędu świeca 30 min zamyka się nad VAH 24 h 77 425, bez powrotu do wartości."
      - "Delta świec 15 min przy kolejnym podejściu pod 77 864 jest dodatnia, a cena nie zostaje pod szczytem."
      - "Open interest rośnie razem z ceną, czyli wchodzą nowe longi, a nie tylko zamykają się shorty."
    invalidation: "Zamknięcie świecy 30 min pod VAH 24 h 77 425."
    reactions:
      - { label: "POC wczoraj", price: 78109 }
      - { label: "Likwidacje shortów", price: 78250 }
      - { label: "Otwarcie tygodnia", price: 78326 }
  - name: "Odrzucenie szczytu dnia i powrót do wartości"
    bias: down
    zone: [76987, 77425]
    window: "do 19:30"
    triggers:
      - "Świeca 15 min zamyka się pod 77 500, dolnym brzegiem stosu nierównowag kupna z 14:15."
      - "Delta jest ujemna, a open interest rośnie, jak na świecy z 14:30, czyli przybywa shortów."
      - "Zamknięcie 30 min wraca pod VAH 24 h 77 425."
    invalidation: "Zamknięcie świecy 30 min nad szczytem dnia 77 864."
    reactions:
      - { label: "Szczyt Azji", price: 77306 }
      - { label: "VWAP dnia", price: 76995 }
      - { label: "PDL", price: 76670 }
    evidence: "Powrót do VWAP w laboratorium wypadał gorzej niż losowo: 36% wobec 43% w 182 przypadkach, bez potwierdzenia. To wskazówka z wykresu, nie statystyka."
---
## Co się stało

Ostatnia doba to spadek i odbicie. Wczoraj o 14:45 cena była przy 78 220, potem przez wieczór i noc zjechała pod 77 000, a dziś o 07:00 świeca z deltą −1 247 BTC wybiła PDL 76 670 i dotknęła 76 338. To był dołek doby i największy skok likwidacji longów, 6,39 mln USD. Już następna świeca zamknęła się z powrotem nad PDL, na 76 699. Od 10:15 cena zamyka się nad VWAP dnia, a po 14:00 wyszła nad obszar wartości z ostatnich 24 godzin i dotknęła 77 864.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Cena 77 589 stoi pod otwarciem tygodnia 78 326 i pod PDH 78 854, więc w ujęciu tygodnia to wciąż odbicie wewnątrz spadku. Wybicie pod PDL o 07:00 okazało się nieudane: cena wróciła nad 76 670 w ciągu kwadransa i od tego czasu doszła do 77 864.

**Wartość.** POC z 24 godzin leży na 76 875, obszar wartości to 76 650–77 425. Cena jest nad nim, ale dopiero jedna pełna półgodzina zamknęła się nad VAH, więc o akceptacji wyższych cen jeszcze nie można mówić. Obecna półgodzina ma za sobą odrzucenie szczytu 77 864 długim górnym knotem.

**VWAP.** VWAP dnia to 76 987, cena jest 1,73σ nad nim. Po stronie wzrostów jest od świecy z 10:15, a od 11:45 każde zamknięcie 15 min wypadło nad pasmem +1σ. Pasmo działało jak wsparcie o 12:30 i 12:45, gdy zamknięcia wypadły zaledwie 4 i 5 dolarów nad nim.

**Przepływ i pozycje.** Z taśmy, która obejmuje ostatnie 24 godziny do 14:45, delta z całej doby to −2 208 BTC, ale z ostatnich 4 godzin +725 BTC, a z godziny +70,3 BTC. Cena w tych oknach urosła o 570 i 216 dolarów, a open interest o 311 i 65 BTC, czyli w ujęciu 4 godzin przybywa nowych longów. Same świece wzrostowe pokazują jednak głównie zamykanie shortów (OI w dół przy cenie w górę o 13:15 i 14:15), a ostatnia świeca to spadek z ujemną deltą i OI wyżej o 182,7 BTC, czyli nowe shorty pod szczytem.

## Footprint wybicia nad wartość dnia

[[footprint]]

Okno to dwie godziny przed wpisem. Pierwsze dwie świece, 12:45 i 13:00, to spokojny handel między 76 980 a 77 189 i wolumenie około 180 BTC. O 13:15 przyszła inicjatywa kupujących: cztery nierównowagi kupna w jednej świecy (77 150, 77 200, 77 350, 77 400), wolumen 1 593,6 BTC, delta +288,4 BTC, a OI spadło o 60,2 BTC, więc wybicie niosły głównie zamykane shorty. Potem trzy świece z malejącym wolumenem (194,7, 162,7 i 120,4 BTC) trzymały się przy 77 300 i wyżej. O 14:15 drugi stos, nierównowagi kupna od 77 500 do 77 650, delta +208,6 BTC i znowu OI w dół o 106,3 BTC. Świeca z 14:30 doszła do 77 864, ale tam kupno zostało wchłonięte: delta −91 BTC przy wolumenie 1 160,2 BTC, OI wyżej o 182,7 BTC i zamknięcie na 77 589.

Linia frontu jest teraz wąska. Od dołu podpiera ją stos nierównowag 77 500–77 650 z 14:15, niżej stos 77 350–77 400 z 13:15 i POC tamtej świecy 77 200. Od góry punktem odniesienia jest POC ostatniej świecy 77 750 z nierównowagą sprzedaży i szczyt 77 864, przy którym zatrzymały się zakupy.

## Gdzie leży płynność

[[likwidacje]]

Mapa jest wyraźnie asymetryczna. W 1% nad ceną, do 78 365, jest 20,2 mln USD shortów do likwidacji, głównie w przedziale od 78 000 (17,1 mln USD), a dalej duży klaster od 79 000 (24,7 mln USD). W 1% pod ceną nie ma praktycznie nic. Pierwsze większe longi to dopiero przedziały od 76 250 i 76 000 (7,4 i 10,3 mln USD), a główna masa leży od 75 750 i 75 500 (48,6 i 55,4 mln USD). Mapa obejmuje 46% otwartych pozycji, więc to obraz częściowy.

## Kto handluje

[[przeplywy]]

Mimo popołudniowego odbicia doba należy do sprzedających: biorcy sprzedali netto za 93,2 mln USD, a prawie całość to wieloryby (−88,3 mln USD na 100 kont). Reszta rynku jest lekko po stronie sprzedaży, animatorzy po stronie kupna. Perp notuje się 2,9 bp pod indeksem, niżej niż średnio z doby, funding stoi na 0,13 bp/h. W arkuszu ±10 bp bidy mają 47%, trochę mniej niż zwykle o tej godzinie.

## Zmienność i rozkład

[[scenariusze]]

Do 19:30 model daje 68% na zakres 76 653–78 454 i 95% na 75 768–79 370, przy σ 116 bp. Zmienność 5 min z doby to 11,3 bp wobec 12,4 bp z poprzednich dni roboczych, a obecny reżim (8,8 bp na 5 min) trwa około 6 godzin i model daje tylko 4% na jego zmianę w ciągu 25 minut. Prognoza desku na 4 godziny ma medianę 77 585 i 50% w 77 029–78 180. Na rynku HIP-4 „BTC > 76 637” na jutro do 07:00 rynek wycenia 81%, model 73%.

## Struktura dnia

[[poziomy]]

Najbliżej pod ceną jest szczyt Azji 77 306 (78% na dotknięcie do 19:30), potem VAL wczorajszej sesji 77 026 i VWAP dnia 76 995, odpowiednio 54% i 52%. Nad ceną POC wczorajszej sesji 78 109 ma 52%, klaster shortów 78 250 43%, otwarcie tygodnia 78 326 38%. Cena siedzi w dolnej części wczorajszego obszaru wartości 77 026–78 698, ale nad wartością z ostatnich 24 godzin.

## Co musiałoby się wydarzyć

[[setupy]]

Pierwszy obraz wymaga akceptacji nad 77 425: kolejnych zamknięć 30 min nad VAH z 24 godzin, dodatniej delty przy ponownym podejściu pod 77 864 i rosnącego OI. Drugi zaczyna się od zamknięcia pod stosem 77 500 i powrotu pod VAH, wtedy naturalnym magnesem jest wartość dnia i VWAP. Reguła powrotu do VWAP nie ma potwierdzenia w danych historycznych, więc traktuję ją jako wskazówkę.

## Na co patrzę dalej

Pierwsze pół godziny Nowego Jorku od 15:30 pokaże, czy szczyt 77 864 był tylko wyczerpaniem zakupów, czy przerwą. Jeśli cena utrzyma stos 77 500–77 650, a OI zacznie rosnąć razem z ceną, droga do shortów przy 78 000–78 250 jest krótka. Jeśli świeca z 14:30 okaże się początkiem odrzucenia, najbliżej jest szczyt Azji 77 306.

## Rzetelność modelu

W dzienniku desku przedziały 4 godzinne 90% obejmowały 93% wyników, a 60% obejmowały 74% (1 145 prognoz), więc model raczej przeszacowuje niepewność niż ją zaniża. Dotknięcia PDH, PDL i środka zakresu mają Brier 0,073 wobec 0,122 dla częstości bazowej (1 152 prognozy).

Prawdopodobieństwa pochodzą z modelu zmienności desku HAR + FHS i symulacji Monte Carlo, policzone o 14:50 i zapisane przed faktem, żeby można je było potem rozliczyć. Następny wpis po otwarciu Nowego Jorku, około 15:45.
