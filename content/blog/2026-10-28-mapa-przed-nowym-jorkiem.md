---
title: "BTC 80 803 przed Nowym Jorkiem: VWAP 81 064 nad ceną, 61% na powrót do otwarcia Londynu"
description: "Bitcoin zjechał spod 81 807 do 80 803 i stoi pod VWAP dnia. Model daje 68% na zakres od 80 066 do 81 414 do 18:30 i 61% na dotknięcie 81 056."
date: 2026-10-28T13:50:20+01:00
type: article
section: Mapa przed Nowym Jorkiem
price: 80803
levels:
  - { label: "Likwidacje shortów", price: 81850, note: "7,3 mln USD, 9% dotknięcia do 18:30" }
  - { label: "PDH", price: 81281, note: "39% dotknięcia do 18:30" }
  - { label: "Szczyt Azji", price: 81205, note: "45% dotknięcia do 18:30" }
  - { label: "VWAP dnia", price: 81061, note: "60% dotknięcia do 18:30" }
  - { label: "Otwarcie Londynu", price: 81056, note: "61% dotknięcia do 18:30" }
  - { label: "Dołek Azji", price: 80573, note: "80% dotknięcia do 18:30" }
  - { label: "VAH wczoraj", price: 80560, note: "79% dotknięcia do 18:30" }
  - { label: "POC wczoraj", price: 80260, note: "46% dotknięcia do 18:30" }
  - { label: "Otwarcie tygodnia", price: 80109, note: "33% dotknięcia do 18:30" }
scenarios:
  - label: "Cena o 18:30 poniżej 80 260"
    probability: 24
    note: "Sprzedający muszą przebić dołek Azji 80 573 i wczorajszy POC 80 260, a open interest dalej rosnąć przy spadku. Wtedy otwiera się droga do otwarcia tygodnia 80 109."
  - label: "Cena o 18:30 między 80 260 a 81 060"
    probability: 46
    note: "Wystarczy, że Nowy Jork nie przyniesie impulsu: cena zostaje w obszarze wartości doby, pod VWAP dnia i nad wczorajszym POC."
  - label: "Cena o 18:30 powyżej 81 060"
    probability: 30
    note: "Kupujący muszą odzyskać VWAP dnia i otwarcie Londynu w okolicy 81 060 i utrzymać cenę nad nimi zamknięciami świec, najlepiej przy spadającym OI."
summary:
  - "Cena 80 803 po zjeździe o 847 USD w 4 godziny, z 24 h szczytu 81 807 o 9:30, pod VWAP dnia 81 064 (−0,79σ)."
  - "Open interest w 4 godziny wzrósł o 145,7 BTC przy spadającej cenie, co w macierzy ceny i OI oznacza dopisywanie nowych shortów."
  - "Model daje 68% na zakres od 80 066 do 81 414 do 18:30 i 61% na powrót do otwarcia Londynu 81 056."
  - "Na mapie likwidacji w 1% pod ceną leży 7,9 mln USD longów, nad ceną tylko 1,3 mln USD shortów."
metrics:
  - { label: "Premia perp", value: "−3,3 bp", note: "średnio 24 h −2,8 bp" }
  - { label: "Funding", value: "0,13 bp/h", note: "średnio 24 h 0,12 bp/h" }
  - { label: "Przepływ agresorów 24 h", value: "50,8 mln USD", bias: up, note: "kupno biorców 229,4, sprzedaż 178,6 mln USD" }
  - { label: "Likwidacje 24 h", value: "17,2 mln USD", note: "longi 0,0, shorty 17,2 mln USD" }
  - { label: "Longi w 1% pod ceną", value: "7,9 mln USD", note: "do likwidacji między 79 995 a ceną" }
  - { label: "Shorty w 1% nad ceną", value: "1,3 mln USD", note: "do likwidacji między ceną a 81 611" }
  - { label: "Arkusz ±10 bp: bidy", value: "50% bidów", bias: flat, note: "zwykle o tej godzinie 50% (6 dni)" }
  - { label: "Zmienność 5 min, 24 h", value: "8,9 bp", note: "poprzednie dni robocze (5): 10,7 bp" }
liquidations:
  step: 250
  coverage: 44
  shorts: [[84250, 2.2], [84000, 3.3], [83750, 38.7], [83500, 2.5], [83250, 2.2], [83000, 8.6], [82750, 5.4], [82500, 7.7], [82250, 12.7], [82000, 2.3], [81750, 34.3], [81500, 2.2], [81250, 0.3]]
  longs: [[80500, 0.9], [80250, 0.9], [80000, 6.1], [79750, 2.9], [79500, 4.3], [79250, 3.5], [79000, 12.1], [78750, 23.3], [78500, 22.4], [78250, 3], [78000, 10], [77750, 5.5], [77500, 12], [77250, 11.6], [77000, 14.5]]
  note: "Mapa z 13:46, cena wtedy 80 754; pokrycie 44% otwartych pozycji."
flows:
  title: "Przepływ agresorów netto, 24 h"
  unit: "mln USD"
  rows:
    - { label: "Wieloryby", value: 57.4, note: "70 kont" }
    - { label: "Reszta rynku", value: 1.8, note: "19 090 kont" }
    - { label: "Animatorzy rynku", value: -8.4, note: "200 kont" }
setups:
  - name: "Powrót nad VWAP dnia i otwarcie Londynu"
    bias: up
    zone: [81056, 81064]
    window: "do 18:30"
    triggers:
      - "Zamknięcie świecy 15 min nad VWAP dnia 81 064 po teście dolnego pasma."
      - "Delta świecy wybicia dodatnia, a nie tylko odbicie bez inicjatywy kupujących."
      - "Open interest spada przy wzroście ceny, czyli zamykają się shorty dopisane przy zjeździe."
    invalidation: "Zamknięcie 15 min z powrotem pod 81 000 w ciągu godziny od odzyskania VWAP."
    reactions:
      - { label: "PDH", price: 81281 }
      - { label: "Likwidacje shortów", price: 81850 }
    evidence: "Laboratorium desku dla powrotu do VWAP: n 174, częstość 36% wobec losowej 43%, bez potwierdzenia przewagi. To wskazówka, nie statystyka."
  - name: "Przebicie dołka Azji i wczorajszego POC"
    bias: down
    zone: [80260, 80573]
    window: "do 18:30"
    triggers:
      - "Zamknięcie świecy 15 min pod dołkiem Azji 80 573 i pod VWAP −1σ."
      - "Delta ujemna na świecach spadku, bez knotów odrzucenia na dole."
      - "Open interest dalej rośnie przy spadku, czyli nowe shorty, a nie tylko zamykanie longów."
    invalidation: "Powrót i zamknięcie godzinowe nad 80 803 po wyjściu pod 80 573."
    reactions:
      - { label: "POC wczoraj", price: 80260 }
      - { label: "Otwarcie tygodnia", price: 80109 }
    evidence: "Okrągłe 80 000 jako wsparcie w laboratorium desku: n 311, częstość 53% wobec losowej 49%, werdykt bez przewagi, więc w granicach szumu."
---
## Co się stało

Doba zaczęła się od dołka 79 868 wczoraj o 15:00, skąd bitcoin przez noc i Azję wspinał się wolno, ale równo. Rano Londyn dokończył ruch: o 9:30 cena wybiła szczyt doby 81 807 i wyrzuciła przy tym 9,6 mln USD shortów w jednym kwadransie, a w całej dobie zlikwidowanych shortów było 17,2 mln USD przy zerze po stronie longów. Wybicie się jednak nie rozwinęło. Przez kilka godzin cena trzymała się w okolicy 81 300 do 81 550, a po 13:00 zjechała o 552 USD w godzinę i o 847 USD w cztery godziny, do 80 803 w chwili wpisu.

## Analiza wykresu

[[wykres]]

**Szerszy obraz.** Wczorajszy zakres to od 79 489 do 81 281, a otwarcie tygodnia było na 80 109, więc cena wciąż stoi nad otwarciem tygodnia i w środku wczorajszego przedziału. Poranne wyjście nad wczorajszy szczyt dało 81 807, ale nie miało kontynuacji i dziś wygląda jak nieudane wybicie, które oddało prawie cały zysk z nocy.

**Wartość.** Obszar wartości z 24 godzin to od 80 300 do 81 275 z POC na 80 625. Rano ceny nad górną granicą były akceptowane przez kilka godzin, ale zjazd po 13:00 sprowadził cenę z powrotem do środka wartości. Najbliższy magnes to więc POC 24 h, nieco ponad 170 USD pod ceną.

**VWAP.** VWAP dnia stoi na 81 064, a cena jest 0,79σ pod nim, przy σ 328 USD. Przez całe przedpołudnie VWAP był pod ceną i nie był testowany. W ostatniej godzinie przed wpisem cena zeszła pod niego, a dolne pasmo −1σ przy około 80 733 zadziałało jak pierwsze wsparcie: świeca od 13:30 zeszła do 80 703 i zamknęła się z powrotem na 80 803.

**Przepływ i pozycje.** Taśma w tym oknie ma luki, więc delty z ostatniej godziny i czterech godzin oraz zmiany OI z ostatniej godziny tu nie podaję. W całym nagranym okresie od wczoraj 13:45 skumulowana delta jest dodatnia, 214,6 BTC. Open interest w cztery godziny wzrósł o 145,7 BTC, do 42 972 BTC, przy cenie niżej o 847 USD. Według macierzy to nowe shorty, a nie tylko zamykanie longów.

## Footprint zjazdu spod 81 500

[[footprint]]

Inicjatywę widać na świecy od 12:00: stos trzech nierównowag sprzedaży na 81 450, 81 400 i 81 350 i delta −43,2 BTC. Kupujący odpowiedzieli kwadrans później nierównowagą kupna na 81 300 i deltą prawie zerową, ale bez postępu w górę. Świeca od 12:45 to znowu sprzedaż, delta −61,2 BTC przy spadku OI o 45,3 BTC, czyli wtedy domykały się longi. Najciekawsza jest ostatnia świeca od 13:30: wolumen 599,7 BTC, kilka razy więcej niż wcześniej, delta tylko −9,1 BTC i OI w górę o 264,3 BTC. Duży obrót bez przewagi agresorów i z dopisanymi pozycjami wygląda na absorpcję po stronie kupujących przy dołku 80 703.

Linia frontu na teraz to stos sprzedaży między 81 350 a 81 450 nad ceną, POC ostatniej świecy na 80 750 i nierównowaga kupna na 80 700 pod nim. Dopóki cena trzyma się nad 80 700, ostatnia fala sprzedaży została zatrzymana. Zamknięcie pod tym poziomem oznaczałoby, że absorpcja się wyczerpała.

## Gdzie leży płynność

[[likwidacje]]

Nad ceną największe skupiska shortów są w przedziałach od 81 750 (34,3 mln USD) i od 83 750 (38,7 mln USD), a w rekordzie najbliższe dwa klastry to 81 850 z 7,3 mln USD i 81 950 z 27,0 mln USD. Szansa ich dotknięcia do 18:30 to 9% i 7%. Pod ceną gęsto robi się dopiero od 79 000 w dół, z przedziałami od 78 750 (23,3 mln USD) i od 78 500 (22,4 mln USD). Blisko ceny asymetria jest po stronie longów: w 1% pod ceną leży 7,9 mln USD, w 1% nad ceną 1,3 mln USD. Mapa widzi 44% otwartych pozycji.

## Kto handluje

[[przeplywy]]

Przez ostatnią dobę agresywni kupujący przeważali o 50,8 mln USD, z czego 57,4 mln USD to 70 kont wielorybów. Reszta rynku jest prawie na zero, a animatorzy rynku oddali netto 8,4 mln USD. Premia perpa jest lekko ujemna, −3,3 bp wobec −2,8 bp średnio w dobie, a funding 0,13 bp na godzinę nie wskazuje na przegrzanie po żadnej stronie. Arkusz w ±10 bp jest dokładnie po równo, 50% bidów, tak jak zwykle o tej godzinie.

## Zmienność i rozkład

[[scenariusze]]

Do 18:30 model daje σ 84 bp, co przekłada się na zakres 68% od 80 066 do 81 414 i 95% od 79 400 do 82 097. Zmienność z ostatniej doby to 8,9 bp na 5 minut wobec 10,7 bp w poprzednich pięciu dniach roboczych, a bieżący reżim 10,5 bp na 5 minut trwa około 4 godzin. Prognoza desku na 4 godziny ma medianę 80 751 i 50% przedziału od 80 322 do 81 160. Rynek HIP-4 „BTC powyżej 80 872” na jutro na 7:00 wycenia 47%, model 46%, więc tu rozjazdu nie ma.

## Struktura dnia

[[poziomy]]

Cena stoi między dwoma pasmami poziomów. Nad nią, w odległości około 250 USD, leży ciasne skupisko otwarcia Londynu 81 056 i VWAP dnia 81 061 z szansą dotknięcia 61% i 60%, a dalej szczyt Azji 81 205 i PDH 81 281. Pod nią są dołek Azji 80 573 i wczorajszy VAH 80 560, oba blisko 80% dotknięcia, a niżej wczorajszy POC 80 260 i otwarcie tygodnia 80 109.

## Co musiałoby się wydarzyć

[[setupy]]

Żeby obraz wrócił na stronę kupujących, cena musi odzyskać VWAP dnia zamknięciem świecy, a OI powinien wtedy spadać, bo to oznaczałoby wyjście shortów dopisanych przy zjeździe. Obraz spadkowy wymaga zejścia pod dołek Azji z ujemną deltą i dalszym wzrostem OI. Ani jedna, ani druga reguła nie ma w laboratorium desku potwierdzonej przewagi.

## Na co patrzę dalej

Pierwsze pół godziny Nowego Jorku od 14:30 rozstrzygnie, czy absorpcja przy 80 703 się utrzyma. Patrzę na zachowanie OI przy pierwszym ruchu, na wcześniejszą absorpcję kupna 53,6 BTC przy 81 027 tuż pod VWAP i na to, czy dolne pasmo VWAP zostanie przebite zamknięciem.

## Rzetelność modelu

Przedziały 4 h desku są raczej za szerokie niż za wąskie: 90% przedział obejmował cenę w 98% przypadków, a 60% w 80% (n 564). Dla dotknięć PDH, PDL i środka Brier wynosi 0,073 wobec 0,103 dla częstości bazowej (n 572), więc model dotknięć jest lepszy od samego zgadywania z historii.

Prawdopodobieństwa pochodzą z modelu zmienności desku HAR z filtrowaną symulacją historyczną i Monte Carlo, policzone o 13:50 i zapisane przed faktem, a po 18:30 rozliczę je z tym, co zrobił rynek. Następny wpis to otwarcie Nowego Jorku o 14:45.
