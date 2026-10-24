# HyperQuant — przewodnik stylu UI, danych i ruchu (v2)

Obowiązuje każdy nowy i przerabiany komponent. Kod i identyfikatory po angielsku, **komentarze po polsku**.

## 1. Zasady nadrzędne
1. **Uczciwość danych.** Liczba bez źródła nie istnieje. Każda wartość jest: `LIVE` (realne dane), `MODEL` (wynik modelu z danych realnych — podpisz metodę) albo `SIM` (symulacja — tylko w trybie modelu, zawsze oznaczona). Brak danych = `—` lub `n/a`, nigdy liczba zastępcza.
2. **Desk ocenia plan, nie podsuwa wejść.** Żadnych automatycznych sygnałów LONG/SHORT. Przyciski „Signal” w panelach przekazują kierunek i poziomy do Analizatora planu (`onPrefillPlan`).
3. **Jeden bohater na ekran.** Każdy widok ma jeden główny element (hero); reszta jest cichsza (ink-2/ink-3, mniejsza waga).
4. **Mobile first dla treści, desktop dla gęstości.** Każdy widok działa od 360 px (gutter 16 px, brak poziomego scrolla strony; szerokie tabele przewijają się w ramce).

## 2. Tokeny (zdefiniowane w `src/index.css` przez `@theme`, używaj klas Tailwind)
| Rola | Token / klasa | Wartość |
|---|---|---|
| Tło strony | `bg-page` | `#070A11` |
| Panel | `bg-surface-1` | `#0B1019` |
| Panel podniesiony | `bg-surface-2` | `#101826` |
| Hover / pole | `bg-surface-3` | `#16202F` |
| Linia (hairline) | `border-line` | `#1B2533` |
| Linia mocna | `border-line-strong` | `#283447` |
| Tekst główny | `text-ink-1` | `#EEF2F7` |
| Tekst drugorzędny | `text-ink-2` | `#A9B4C4` |
| Tekst wyciszony (min. 4.5:1) | `text-ink-3` | `#7A889C` |
| Akcent marki (HL) | `text-accent` / `bg-accent` | `#3FC6DD` |
| Kupno (znak/słupek) | `bg-buy` / `text-buy-ink` | `#19A88E` / `#35C9A8` |
| Sprzedaż (znak/słupek) | `bg-sell` / `text-sell-ink` | `#D9582E` / `#F07C55` |
| Poziomy HTF (PDH/PDL) | `level` | `#E0A045` |
| Strefy OB | `zone` | `#9085E9` |
| Status | `good` / `warn` / `critical` | `#0CA30C` / `#FAB219` / `#D03B3B` (zawsze z ikoną + etykietą) |

Para kupno/sprzedaż przeszła walidator palety (CVD ΔE 11.8, kontrast ≥ 3:1). **Zawsze z drugim kanałem**: znak `+/−`, strzałka ▲▼ lub pozycja (bid pod ceną, ask nad).

Serie kategoryczne na wykresach (kolejność stała, nigdy cyklicznie): `series-1…8` = `#3987e5 #d95926 #199e70 #c98500 #d55181 #008300 #9085e9 #e66767`. Powyżej 3 serii na scatter/mapie → „Inne” lub small multiples.
Wyjątek — panele przepływu (kierunek kupno/sprzedaż w tle): pomijamy `series-2` i `series-3`, bo są zbyt bliskie `sell`/`buy`. Kohorty uczestników: `series-1` market makerzy, `series-4` poinformowani, `series-5` wieloryby, `series-7` reszta (zestaw sprawdzony walidatorem palet na `surface-1`: pasmo jasności, chroma, CVD ΔE ≥ 13, kontrast ≥ 3:1).

## 3. Typografia
- `font-display` (Outfit 600/700): tylko nagłówki sekcji i nazwa aplikacji. **Nigdy na liczbach.**
- `font-sans` (Plus Jakarta Sans): UI i liczby-bohaterowie (cyfry proporcjonalne).
- `font-mono` (IBM Plex Mono) + `tabular-nums`: kolumny liczb, tabele, osie, taśma.
- Skala: 11 / 12 / 13 / 14 / 16 / 20 / 28 / 44 px. Etykiety „eyebrow”: 11 px, uppercase, tracking 0.08em, `text-ink-3`.

## 4. Wykresy (skill `dataviz`)
- Linie 2 px, słupki ≤ 24 px z zaokrąglonym końcem 4 px, wypełnienie obszaru ~10% krycia, siatka hairline 1 px **ciągła** (nigdy przerywana).
- Jedna oś Y na wykres — nigdy dwóch skal. Różne jednostki = dwa wykresy albo indeks = 100.
- Etykiety selektywnie (ostatnia wartość, ekstremum). Tekst w kolorach ink, kolor niesie znacznik obok.
- Hover: crosshair + tooltip na liniach, tooltip per element na słupkach/komórkach; cel trafienia ≥ 24 px.
- Odświeżanie danych: trzymaj poprzedni render (bez szkieletów i skoków układu).

### Wykres orderflow (zakładka Wykresy)
Płótno ma własną paletę HyperQuant „Desk” (tokeny `of-*`, te same wartości w `src/charts/pro/chart/theme.ts`): morska zieleń kupna i miedź sprzedaży na granatowym tle Desku. Obramowanie, pasek narzędzi i menu zostają w tokenach strony. Kolory kupna i sprzedaży przechodzą walidator palety także dla daltonistów.

| Rola | Token / klasa | Wartość |
|---|---|---|
| Tło płótna (bez siatki) | `of-bg` | `#0B1019` |
| Świeca kupna / sprzedaży | `of-buy` / `of-sell` | `#19A88E` / `#D9582E` |
| Przepływ kupna / sprzedaży (tekst, bąble, likwidacje, wieloryby) | `text-of-buy-ink` / `text-of-sell-ink` | `#35C9A8` / `#F07C55` |
| Nierównowaga kupna / sprzedaży | `of-imb-buy` / `of-imb-sell` | `#5CF2CF` / `#FF9A6A` |
| Ramka POC w świecy | `of-poc` | `#E0A045` |
| Wolumen wiersza | `of-vol` | `#5B7AA6` |
| Profil sesji: obszar wartości / reszta / POC / nagi POC | — | `#34425A` / `#1F2B3D` / `#E0A045` / `#7A889C` |
| Drabina DOM: bidy / aski | — | `#19A88E` / `#D9582E` |
| VWAP / VWAP sesji | `of-vwap` / `of-svwap` | `#E6EBF2` / `#9085E9` |
| Mapa ciepła arkusza (granat → błękit → biel ścian) | `of-heat-1…3` | `#1B4677` → `#5FD3E6` → `#FFFFFF` |
| Giełdy: Hyperliquid / Binance / Bybit | — | `#3987E5` / `#C98500` / `#D55181` |

Komórki footprintu Bid × Ask to kafle od grafitu `#2A3446` (mały wolumen) do nasyconego koloru strony; liczby ciemne na jasnym kaflu, jasne na ciemnym. Style Delta i Wolumen to paski od lewej krawędzi świecy (delta i wolumen w kolorze strony przewagi) z jasnymi liczbami bid i ask. Drugi kanał: pozycja (sprzedaż po lewej, kupno po prawej), a liczba nierównowagi jest pogrubiona i obrysowana.

## 5. Ruch (Motion — `motion/react`, tokeny w `src/ui/motion.ts`)
- Sprężyna domyślna: `stiffness 260, damping 26, mass 1` (ζ ≈ 0.8, „premium”). Pozycja i rozmiar mogą sprężynować; **krycie i kolor nigdy**.
- Czasy: feedback 100–160 ms; ruch UI 200–300 ms; wejście bohatera 600–720 ms. Wyjścia o 40–50% krótsze od wejść.
- Krzywe: wejście `ease-out-quint` `cubic-bezier(0.22,1,0.36,1)`; wyjście `ease-in-quint` `cubic-bezier(0.64,0,0.78,0)`; przejazd przez ekran `ease-in-out-quint` `cubic-bezier(0.83,0,0.17,1)`. Liniowo tylko obrót, pasek postępu, faza pętli.
- Stagger list 40–60 ms, **tylko przy pierwszym montażu**; następny element startuje przy 30–50% poprzedniego.
- Ruch danych: zmiana liczby = krótki błysk tła 160 ms (max 3 błyski/s na element), słupki głębokości przesuwają się sprężyną, nowe świece bez animacji wejścia.
- `prefers-reduced-motion`: brak transformacji; tylko krycie ≤ 120 ms.
- **Zakazane:** gradienty fiolet/niebieski jako tło, poświaty (glow), flary, dekoracyjne cząsteczki, wszystko pojawiające się naraz, fade+slide-up na każdym elemencie, wycentrowane układy treści, tekst w ruchu podczas czytania, migotanie > 3/s. (Sceny 3D w Labie mogą mieć subtelny bloom — tylko tam.)

## 6. Komponenty bazowe (`src/ui/`)
`Panel` (nagłówek + eyebrow + akcje + treść), `Stat` (etykieta, wartość, delta, sparkline), `Badge` (LIVE/MODEL/SIM/STALE), `Segmented`, `AnimatedNumber`, `Sparkline`, `EmptyState`. Używaj ich zamiast własnych kart. Przyciski: realne `<button>`, cel dotyku ≥ 44 px na mobile, `aria-label` dla ikon.

## 7. Dostępność
Kontrast tekstu ≥ 4.5:1 (sprawdzone dla tokenów ink na wszystkich surface). Fokus klawiatury widoczny (`focus-visible:ring-2 ring-accent`). Kolor nigdy jako jedyny nośnik znaczenia.
