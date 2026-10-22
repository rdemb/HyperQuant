# Etap 4 — weryfikowalny dziennik prognoz desku

## Intencja

Każdy desk może pokazywać „prawdopodobieństwa”. Prawie żaden nie pozwala sprawdzić, czy były trafne, a żaden publiczny nie
dowodzi, że prognozy nie zostały poprawione po fakcie. HyperQuant pre-rejestruje swoje prognozy, rozstrzyga je automatycznie
i publikuje wyniki z dowodem integralności, który każdy może sprawdzić bez zaufania do autora.

## Co jest prognozowane (co 15 min, slot UTC; bez wydawania wstecz)

- **Rozkład log-zwrotu BTC** na 1 h i 4 h: 13 kwantyli (τ = 0.025 … 0.975) z tego samego modelu co Analizator i pas MC
  (sezonowy log-HAR + innowacje FHS, Monte Carlo 4000 ścieżek, martyngał ceny). Razem z prognozą zapisywane są kwantyle
  **benchmarku** (normalny, σ godzinowa z 30 dni) i bieżące **α ACI** — wszystko przed faktem.
- **Dotknięcie PDH / PDL / D-EQ w 2 h** — ten sam silnik co pas „Zasięg 2h” na Desku.

## Rozstrzygnięcie (ze świec 1m Hyperliquid)

- Zwrot: y = ln(close(t+h) / close(t)); CRPS modelu i benchmarku (siatka kwantyli, Gneiting & Raftery), PIT, trafienie
  przedziałów 90% / 60% i przedziału ACI.
- Dotknięcia: max(high) / min(low) w oknie 2 h (D-EQ — przejście na drugą stronę względem ceny startu).
- Brak danych przez 6 h po horyzoncie → jawne unieważnienie (`void`), nie ciche pominięcie.

## Wyniki (30 dni, w `summary.json`)

CRPSS względem benchmarku, histogram PIT, pokrycia z testem Kupca, pokrycie ACI (Gibbs & Candès 2021: α_{t+1} = α_t + γ(α − err_t),
γ = 0.005), Brier i BSS względem klimatologii, diagram niezawodności, mapa kalibracji izotonicznej (PAV) i predyktory
**Venna–Abersa** (przedział [p0, p1]) dla najnowszych prawdopodobieństw. Wyniki pokazywane od 20 rozstrzygnięć.

## Integralność

- Pliki dzienne `BTC/RRRR-MM-DD.jsonl` na gałęzi `ledger` repo danych — historia przyrostowa (push bez `--force`).
- Każda linia: `prev` = hash poprzedniej linii (także między dniami), `hash` = SHA-256 kanonicznego JSON linii bez `hash`.
- Po 00:10 UTC plik poprzedniego dnia jest zakotwiczany przez **OpenTimestamps** (darmowe kalendarze → blok Bitcoina):
  `BTC/ots/RRRR-MM-DD.jsonl.ots`; użytkownik: `ots upgrade` + `ots verify`.
- `scripts/verify-ledger.mjs` — niezależna implementacja weryfikacji łańcucha i przeliczenia wyników.
- Zepsuty łańcuch przy starcie → skaner wstrzymuje dopisywanie (nie dokłada do zepsutej historii).

## UI

- Widok Plan: panel „Weryfikowalny dziennik desku” — przedziały 90/60% i ACI w cenie, wyniki, PIT, tabela poziomów
  (model vs skalibrowane Venn–Abers), Brier/BSS, niezawodność, głowa łańcucha, kotwice, instrukcja weryfikacji.
- Desk, pas „Zasięg 2h”: wartości skalibrowane izotonicznie z dziennika (od 20 rozstrzygnięć), obok surowych.

## Koszt

Zero: kalendarze OTS i GitHub są darmowe; świece w budżecie wag skanera (~5 wag/min średnio).

## Decyzje z realizacji

- Pola łańcucha `prev` i `hash` (zarezerwowane) — pierwotne `h` kolidowało z horyzontem prognozy `h` (wykryte testem).
- Zapis liczb zaokrąglony (kwantyle 1e-6, prawdopodobieństwa 1e-4) — rozmiar dziennika ~250 KB/dzień.
- Silnik MC dotknięć wydzielony do `src/utils/touchMc.ts` (importy z `.ts`) — ten sam kod w przeglądarce i w Node 24.
