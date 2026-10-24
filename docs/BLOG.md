# Blog: format wpisu i publikacja

Blog to statyczne strony budowane razem z deskiem (`npm run build`): lista wpisów pogrupowana po dniach, strona każdego wpisu,
archiwum miesięcy, kanał RSS (`blog/feed.xml`), `sitemap.xml`, obrazek do podglądu linku (Open Graph / X, 1200×630) dla każdego wpisu
oraz przyciski udostępniania pod tytułem i pod treścią wpisu (X, Facebook, LinkedIn, Telegram, WhatsApp, kopiowanie linku, systemowe „Udostępnij” na telefonie).
Pełna analiza może mieć ramkę „W skrócie”, panel danych, mapę likwidacji, przepływy i scenariusze warunkowe, wstawiane w wybranych miejscach treści.
Kod: `scripts/blog/`, wpisy: `content/blog/`.

## Plik

`content/blog/RRRR-MM-DD-opis.md`, np. `content/blog/2026-10-26-mapa-dnia.md`. Nazwa pliku to adres wpisu
(`https://rdemb.github.io/HyperQuant/blog/2026-10-26-mapa-dnia/`), więc po publikacji się jej nie zmienia.
Data w nazwie to dzień publikacji w czasie polskim; kilka wpisów jednego dnia różni się opisem (`2026-10-26-aktualizacja-12`).

Obrazy wpisu leżą w katalogu o tej samej nazwie (`content/blog/2026-10-26-mapa-dnia/wykres.png`) i są wstawiane w treści jako `![Opis](wykres.png)`.
Link do wcześniejszego wpisu: `[mapa dnia](../2026-10-26-mapa-dnia/)`.

## Frontmatter

```yaml
---
title: "Sobota tuż nad dołkiem tygodnia. Pod 80 500 czekają longi do likwidacji"
description: "BTC-PERP stoi na 80 777, niecałe 300 dolarów nad piątkowym dołkiem. Poziomy i prawdopodobieństwa do 13:00."
date: 2026-10-24T09:30:00+02:00
type: article
section: Mapa dnia
price: 80777
levels:
  - { label: PDH, price: 82088, note: szczyt piątku w sesji NY }
  - { label: PDL, price: 80500, note: "dołek tygodnia, 34% dotknięcia do 11:00" }
scenarios:
  - { label: Cena o 13:00 poniżej 80 400, probability: 20, note: Zejście pod PDL otwiera strefę likwidacji longów. }
  - { label: Cena o 13:00 między 80 400 a 81 160, probability: 60 }
  - { label: Cena o 13:00 powyżej 81 160, probability: 20 }
---
```

| Pole | Wymagane | Opis |
|---|---|---|
| `title` | tak | Tytuł, do 90 znaków. |
| `description` | tak | Zajawka, 50–220 znaków: lead pod tytułem, opis w Google, tekst podglądu linku. |
| `date` | tak | Chwila publikacji, ISO 8601 ze strefą (`+01:00` zimą, `+02:00` latem, albo `Z`). |
| `type` | tak | `article` (pełna analiza, od 150 słów) albo `note` (krótka notka, 15–250 słów). |
| `section` | tak | Rubryka, do 40 znaków. Artykuły: Mapa dnia, Mapa przed Nowym Jorkiem, Podsumowanie dnia, Rozliczenie tygodnia, Mapa na weekend, Mapa tygodnia. Notki: Otwarcie Londynu, Rozliczenie Londynu, Otwarcie Nowego Jorku, Aktualizacja 4h. |
| `price` | przy `levels` | Cena BTC-PERP w chwili publikacji (USD). |
| `levels` | nie | Do 12 poziomów: `label` (do 20 znaków), `price`, opcjonalnie `note` (do 40 znaków). Rysowane jako mapa poziomów z odległością od ceny w %. |
| `scenarios` | nie | Do 4 scenariuszy **wykluczających się** (np. trzy przedziały ceny o tej samej godzinie): `label` (do 60 znaków, z horyzontem), `probability` (liczba całkowita 1–99, %), opcjonalnie `note` (do 240 znaków). Suma do 100%; brakująca reszta jest pokazana jako „inne przebiegi”. |
| `summary` | nie | „W skrócie”: 2–5 punktów (do 200 znaków), ramka pod leadem i lista na początku wpisu w RSS. |
| `metrics` | nie | Panel danych, do 12 kart: `label` (do 28 znaków), `value` (tekst z jednostką, do 20 znaków, np. `"−1,5 bp"`), opcjonalnie `note` (do 80 znaków) i `bias`: `up`, `down` albo `flat` (znak ▲ ▼ ◆ przy wartości). |
| `liquidations` | nie | Mapa likwidacji (wymaga `price`): `step` (szerokość przedziału w USD), `longs` i `shorts` jako pary `[cena od, mln USD]` z cenami będącymi wielokrotnością `step` (longi pod ceną, shorty nad nią; przedział shortów może zawierać cenę), opcjonalnie `coverage` (1–100, % otwartych pozycji objętych mapą) i `note` (do 200 znaków). Najwyżej 60 przedziałów od najniższego do najwyższego; puste przedziały pomiędzy są rysowane, żeby odległości były prawdziwe. |
| `flows` | nie | Przepływy: `title` (do 60 znaków), `unit` (do 12 znaków), `rows` 1–8 wierszy `{ label, value, note }`; `value` dodatnie to przewaga kupujących, ujemne sprzedających. Słupki od zera w obie strony. |
| `setups` | nie | Do 4 scenariuszy warunkowych (wymaga `price`): `name` (do 70 znaków), `bias` (`up`, `down`, `flat`), `zone: [od, do]` (strefa obserwacji), opcjonalnie `window` (horyzont, do 40 znaków), `triggers` (1–5 warunków, każdy do 180 znaków, w kolejności), `invalidation` (co unieważnia scenariusz, do 220 znaków), `reactions` (do 5 poziomów `{ label, price }`), `evidence` (co mówią dane historyczne, do 280 znaków). |
| `draft` | nie | `true`: wpis nie trafia na stronę (podgląd lokalny: `--drafts`). |

Tekst z przecinkiem w nawiasach klamrowych YAML ujmuje się w cudzysłów (`note: "dołek, 34%"`), inaczej przecinek tworzy nowe pole i walidacja to zgłosi.

### Analiza rozszerzona

Pełna analiza łączy liczby z desku z diagramami i scenariuszami warunkowymi. Przykład pól (wartości skrócone):

```yaml
summary:
  - "Pod ceną czeka osiem razy więcej longów do likwidacji niż shortów nad nią."
  - "Przepływ jest po stronie sprzedających, perp notuje się pod indeksem."
metrics:
  - { label: Premia perp, value: "−1,5 bp", note: "perp pod indeksem od rana", bias: down }
  - { label: Likwidacje 24 h, value: "13,3 mln USD", note: same longi }
liquidations:
  step: 250
  coverage: 43
  shorts: [[82750, 13.4], [82500, 7.6]]
  longs: [[80000, 42.9], [79750, 57.4]]
flows:
  title: Przepływ agresorów netto, 24 h
  unit: mln USD
  rows:
    - { label: Wieloryby, value: -37.5, note: 100 największych kont }
    - { label: Reszta rynku, value: -23.3 }
setups:
  - name: Wypłukanie longów pod 80 000 i powrót nad dołek tygodnia
    bias: up
    zone: [79750, 80250]
    window: do 18:00
    triggers:
      - Cena wchodzi w klaster, a likwidacje longów rosną skokowo.
      - W ciągu godziny świeca 15 min zamyka się z powrotem nad 80 500.
    invalidation: Dwa zamknięcia 15 min pod 79 750 bez powrotu.
    reactions:
      - { label: VWAP soboty, price: 80836 }
    evidence: Po pierwszym dotknięciu minimum poprzedniego dnia cena doszła do środka zakresu w 44% z 85 przypadków (losowo 48%).
```

Scenariusze warunkowe opisują, co musiałoby się wydarzyć na rynku (strefa, warunki potwierdzenia, unieważnienie, poziomy reakcji). Nad kartami jest stała uwaga, że to opis warunków, a nie zlecenie ani rekomendacja. Bezpieczniki obejmują wszystkie teksty tych pól, więc nie przejdą w nich poziomy TP/SL, „long od …” ani tryb rozkazujący.

**Miejsce bloków w treści.** Blok danych można wstawić w wybranym miejscu treści znacznikiem w osobnej linii: `[[dane]]` (panel danych), `[[wykres]]` i `[[footprint]]` (zob. Wykresy), `[[poziomy]]`, `[[likwidacje]]`, `[[przeplywy]]`, `[[scenariusze]]`, `[[setupy]]`. Wstawiony blok dostaje podpis zamiast nagłówka sekcji, więc dobrze stoi pod własnym `##`. Bloki bez znacznika trafiają przed treść w tej kolejności, każdy z nagłówkiem. Znacznik bez danych, nieznany, powtórzony albo w środku akapitu to błąd wpisu. W RSS diagramy są pomijane, a scenariusze warunkowe zostają jako tekst.

### Wykresy

Mapa sesji i footprint rysuje generator z pliku `content/blog/<id>/wykresy.json` (katalog mediów wpisu). Plik tworzy skrypt z publicznych danych desku (archiwum świec 1 min, taśma transakcji z gałęzi `history`, taśma likwidacji):

```sh
node scripts/blog/chartdata.mjs --at 2026-10-25T06:00Z --out content/blog/2026-10-25-mapa-dnia/wykresy.json [--fp 2026-10-25T04:00Z] [--source <adres|katalog>]
node scripts/blog/chartdata.mjs --notka --at 2026-10-25T12:00Z --out content/blog/2026-10-25-aktualizacja-14/wykresy.json
```

`--at` to chwila danych (ostatnia pełna świeca 15 min przed nią), `--fp` początek footprintu (osiem świec 15 min, domyślnie ostatnie dwie godziny), `--source` adres repozytorium danych albo katalog o tym samym układzie (`archive/`, `history/`, `main/`). Na wyjściu standardowym skrypt drukuje odczyt wykresu: cenę, zakres doby, POC i obszar wartości, VWAP dnia z odległością w σ, deltę i zmianę OI z 1 i 4 godzin, największe likwidacje oraz dla każdej świecy footprintu deltę, wolumen, zmianę OI, POC i poziomy nierównowag. Tekst analizy pisze się z tych liczb, tych samych co na rysunku.

- `[[wykres]]`: mapa sesji z 24 godzin. Świece 15 min (na telefonie 30 min), VWAP dnia od północy UTC z pasmami ±1σ i ±2σ, profil wolumenu z POC i obszarem wartości (70% obrotu), szczyt i dołek dnia poprzedniego (PDH, PDL; poza zakresem jako znacznik przy krawędzi), likwidacje jako koła przy świecach, strefy z `setups` (kolor kierunku) i panele delty agresorów, CVD oraz open interest, każdy z własną skalą. Bez taśmy panele są zakreskowane z napisem „brak taśmy”.
- `[[wykres]]` w notce: z flagą `--notka` skrypt buduje krótsze okno, ostatnie 6 godzin w świecach 5 min (na telefonie 10 min), bez footprintu. Wykres jest lżejszy: świece, VWAP dnia z pasmami, poziomy z `levels` wpisu podpisane w kolumnie przy osi (najbliższy poziom nad i pod zakresem jako znacznik ze strzałką), likwidacje oraz panele delty i CVD. Bez profilu wolumenu i open interest. Odczyt ma `zakres6h` zamiast `zakres24h` i nie ma POC ani obszaru wartości, bo nie ma ich na rysunku.
- `[[footprint]]`: sprzedaż i kupno agresorów na każdym poziomie ceny (krok dobrany do zakresu, do 26 wierszy), kafle w odcieniu strony według wolumenu, POC świecy w ramce, nierównowagi po przekątnej 3:1 (pasek przy krawędzi i pogrubiona liczba; komórki poniżej 10% największej w świecy pomijane), pod spodem delta, wolumen i zmiana OI. Tylko świece w pełni nagrane na taśmie.

Oba wykresy to SVG w treści strony w dwóch układach: szerokim (od 640 px) i wąskim na telefon. Najechanie na świecę albo komórkę pokazuje liczby. W RSS wykresów nie ma. Walidator sprawdza kształt pliku, a znacznik wykresu bez danych w pliku to błąd wpisu.

## Treść

Markdown (GFM): sekcje od `##`, akapity, tabele, listy, linki, obrazy. Surowy HTML jest wyświetlany jako tekst.
Liczby po polsku ze spacją w grupach cyfr (`80 777`, `3,8 bp`); generator dokleja twarde spacje, żeby liczba nie łamała się między wierszami.

## Bezpieczniki

Ten sam walidator działa przed publikacją (`npm run blog:check`) i przy każdym buildzie. Błędny wpis zatrzymuje build, więc nic nie trafia na stronę po cichu.

- **Prywatność:** adresy portfeli i hashe transakcji (`0x…`), adresy IP, e-maile, tokeny i klucze dostępu.
- **Analiza, nie sygnały:** tryb rozkazujący („kup”, „sprzedaj”, „wejdź w longa”), gotowe wejścia („long od 80 500”), poziomy TP/SL.
- **Styl:** bez myślników (— oraz – ze spacjami) i strzałek. Zakresy liczb z półpauzą bez spacji (`80 100–80 200`) są w porządku.
- **Schemat:** pola i długości z tabeli wyżej, dzień w nazwie pliku zgodny z `date`, brak nagłówka `#` w treści, istniejące pliki obrazów.

## Publikacja

```bash
npm run blog:check -- content/blog/2026-10-26-mapa-dnia.md   # walidacja jednego wpisu
git add content/blog/2026-10-26-mapa-dnia.md
git commit -m "docs(blog): Mapa dnia 26.10.2026"
git push origin main                                          # GitHub Pages publikuje w ~2 min
```

Podgląd lokalny (razem ze szkicami): `npm run build && node scripts/blog/build.mjs --drafts && npm run preview`, potem `http://localhost:4173/blog/`.

Każdy wpis jest w publicznej historii repozytorium od chwili publikacji; strona wpisu linkuje do historii zmian pliku.
