# Jak współtworzyć HyperQuant

Dzięki za chęć pomocy. HyperQuant to publiczny desk analityczny BTC na Hyperliquid — liczy się w nim przede wszystkim **uczciwość liczb**. Zanim zaczniesz, przeczytaj zasady z [README](README.md#zasady).

## Uruchomienie

Wymagany Node.js 22.

```bash
npm ci --legacy-peer-deps
npm run dev      # http://localhost:3000
```

| Skrypt | Co robi |
|---|---|
| `npm run lint` | sprawdzenie typów (`tsc --noEmit`) |
| `npm test` | testy Vitest |
| `npm run build` | build produkcyjny do `dist/` |
| `npm run data` | pobranie danych publicznych do `public/data/feeds` |

## Zasady merytoryczne

1. **Każda liczba ma źródło i metodę.** Wartość z API to `LIVE`, wynik modelu z realnych danych to `MODEL` (metoda opisana w UI i w [Rodowodzie](src/views/sources/LineageTable.tsx)), symulacja to `SIM`. Brak danych = „—”, nigdy liczba zastępcza.
2. **Nazwa = matematyka.** Jeśli coś nazywa się „Hawkes”, „OFI” czy „VPIN”, implementuje dokładnie tę metodę (z cytatem) albo jest jawnie oznaczone jako heurystyka.
3. **Desk ocenia plan, nie podsuwa wejść.** Żadnych automatycznych sygnałów LONG/SHORT.
4. **Tylko publiczne, legalne dane.** Rdzeń to publiczne API Hyperliquid; giełdy CEX wyłącznie opt-in w przeglądarce użytkownika.
5. **Metody z literatury.** Nowy model lub estymator dostaje cytat (autor, rok, czasopismo) w komentarzu i w sekcji metodologii UI oraz test na danych o znanym rozkładzie.

## Kod

- TypeScript strict; czyste funkcje obliczeniowe w `src/utils/` (bez sieci i stanu), hooki z danymi w `src/state/`, widoki w `src/views/`.
- Teksty UI i komentarze po polsku, identyfikatory po angielsku.
- Każda zmiana zachowania ma test, który najpierw nie przechodzi (TDD). Losowość w testach i symulacjach — deterministyczne ziarno.
- Commity w stylu Conventional Commits: `feat(...)`, `fix(...)`, `docs:`, `ci:`, `chore:`.

## Pull request

1. Gałąź od `main`, jeden temat na PR.
2. `npm run lint && npm test && npm run build` lokalnie — CI uruchamia to samo na każdym PR.
3. Uzupełnij [CHANGELOG](CHANGELOG.md) (sekcja „Nieopublikowane” lub nowa wersja).
4. Zmiany w UI: zrzut ekranu (desktop i telefon).

Scalenie na `main` publikuje stronę na GitHub Pages.
