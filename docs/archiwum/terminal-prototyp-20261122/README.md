# Archiwum: osobny terminal prototypu (do 22.11.2026)

Źródła dawnego `public/nowy/desk.html` z bazy `main` b6b6d57. Od 23.11.2026 terminal jest częścią jednej aplikacji (Dziś, Przed sesją, W sesji, Po sesji, Order Flow), a `nowy/desk.html` tylko przekierowuje do niej z rynkiem i językiem.

**Ten katalog nie jest publikowany:** build (`vite build`, `scripts/blog/build.mjs`) kopiuje wyłącznie `public/` i strony generowane, więc pliki stąd nie mają adresu na hyperquant.tech. Zostają w repozytorium jako materiał do przeniesienia funkcji do aplikacji.

| Plik | Funkcje do ewentualnego przeniesienia |
|---|---|
| `desk.js` | Pasek odczytu ceny (Δ, obrót, BID/ASK z wiekiem pomiaru, pokrycie taśmy), kotwica chwili `[`/`]`, nić kontekstu (`HQ.ctxStore`: rynek, cena, krok, przypięcie, kursor, okno), paleta poziomów ⌘K, księga z kroplą wydruku |
| `desk-plus.js`, `desk-plus.css` | Kropla na poziomie księgi, świeżość LIVE/STALE palety i księgi |
| `views.js` | Widoki terminala, chip „Wróć do sesji” i karta „Kontynuuj” |
| `m4.js`, `m4-btc-20xi.json` | Model „Co było pierwsze?” z prototypu i próbka BTC z 20.11 |
| `desk-links.js`, `desk.html` | Odnośniki i dokument terminala |

Z aplikacji: rynek, interwał, rodzaj wykresu, chwila nagrania i obserwacja Order Flow wracają kartą „Wróć do ostatniego miejsca pracy” na Dziś (`src/shell/nic.ts`).
