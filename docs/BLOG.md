# Blog: format wpisu i publikacja

Blog to statyczne strony budowane razem z deskiem (`npm run build`): lista wpisów pogrupowana po dniach, strona każdego wpisu,
archiwum miesięcy, kanał RSS (`blog/feed.xml`), `sitemap.xml`, obrazek do podglądu linku (Open Graph / X, 1200×630) dla każdego wpisu
oraz przyciski udostępniania pod wpisem (X, Facebook, LinkedIn, Telegram, WhatsApp, kopiowanie linku, systemowe „Udostępnij” na telefonie).
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
| `draft` | nie | `true`: wpis nie trafia na stronę (podgląd lokalny: `--drafts`). |

Tekst z przecinkiem w nawiasach klamrowych YAML ujmuje się w cudzysłów (`note: "dołek, 34%"`), inaczej przecinek tworzy nowe pole i walidacja to zgłosi.

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
