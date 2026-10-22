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

## Decyzje po recenzji (integralność i statystyka)

- **Pre-rejestracja dowodliwa**: sama kotwica pliku dnia (po 00:10 UTC) przychodziła po rozstrzygnięciu prognoz 1–4 h.
  Teraz po każdym slocie głowa łańcucha jest znakowana w OpenTimestamps (`ots/slots/<dzień>/<slot>.ots`, skrót = hash
  ostatniej prognozy slotu, ponawiane do godziny): kalendarze (niezależni operatorzy) potwierdzają przyjęcie od razu, blok
  Bitcoina — zwykle po 1–6 h. Dla horyzontu 1 h dowodem pre-rejestracji są więc kalendarze; blok potwierdza je później
  (weryfikator `--bitcoin` raportuje osobno, ile prognoz ma blok przed rozstrzygnięciem).
- **Ceny źródłowe w rozstrzygnięciach** (`c0`/`c1`, `hi`/`lo`): weryfikator `--market` porównuje je ze świecami 1m
  Hyperliquid — wynik nie opiera się na zaufaniu do skanera.
- **Kolejność**: weryfikator sprawdza, że slot zgadza się z chwilą wydania, początek horyzontu to pełna minuta po wydaniu,
  rozstrzygnięcie nie przed końcem horyzontu, brak duplikatów i cofania czasu; przerwa dłuższa niż doba = jeden rekord
  zakresowy `skip`.
- **Historia tylko dopisywana**: commit odrzucany, gdy zmienia zapisane linie, usuwa plik albo zmienia pokwitowanie;
  weryfikator sprawdza każdą parę kolejnych commitów (prefiks) i łańcuch od GENESIS. Zalecana dodatkowo ochrona gałęzi
  `ledger` na GitHubie (blokada force-push i usunięcia).
- **Bez podglądania**: początek horyzontu = pełna minuta po faktycznym wydaniu (cena czytana po pobraniu danych),
  nie początek slotu; rozstrzygnięcie od tej chwili.
- **Jawne braki**: slot bez prognozy dostaje rekord `skip` z powodem (brak modelu, ceny, przerwa); podsumowanie pokazuje
  wydane vs pominięte.
- **Nakładanie się prognoz**: pokrycia opisowo ze wszystkich, test Kupca na podpróbie rozłącznej (slot ≡ 0 mod h) z nEff.
- **BSS**: odniesienie = klimatologia każdego poziomu osobno.
- **ACI**: α bez przycinania do 0 (α ≤ 0 = przedział nieskończony), ogony poza siatką ekstrapolowane w skali normalnej;
  stan odtwarzany z α zapisanego przy wydaniu.
- **Kalibracja pasa na Desku**: tylko przy ≥ 300 ocenionych parach, aktualnym podsumowaniu i tej samej metodzie (HAR+FHS).
- **Podsumowanie** publikowane na `main` (nie setki commitów dziennie w historii `ledger`); weryfikator porównuje głowę.
- **Odporność**: klon przez katalog tymczasowy, odmowa przy klonie w tyle za `origin`, blokada inicjalizacji, log błędów
  push; po nieudanej budowie modelu 10 min przerwy; model starszy niż 3 h — bez wydania; `.gitattributes` (bajty JSONL
  bez konwersji końców linii).

## Decyzje z realizacji

- Pola łańcucha `prev` i `hash` (zarezerwowane) — pierwotne `h` kolidowało z horyzontem prognozy `h` (wykryte testem).
- Zapis liczb zaokrąglony (kwantyle 1e-6, prawdopodobieństwa 1e-4) — rozmiar dziennika ~250 KB/dzień.
- Silnik MC dotknięć wydzielony do `src/utils/touchMc.ts` (importy z `.ts`) — ten sam kod w przeglądarce i w Node 24.
