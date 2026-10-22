# Etap 7 — ensemble model + rynek w dzienniku, koszt wykonania wg godziny

Data: 2026-10-22. Rekomendacje 2 i 3 z listy zatwierdzonej przez właściciela. Zasady bez zmian (LIVE/MODEL uczciwie,
„—” zamiast wypełniaczy, bez sygnałów, publiczne dane, zero kosztów, żadnych danych serwera w repo).

## A. Ensemble model + rynek (pooling logarytmiczny z wagami z dziennika)

**Dlaczego.** Dziennik porównuje co 15 min p modelu desku z ceną rolującego rynku HIP-4 na tym samym pytaniu.
Naturalne następne pytanie day tradera: „ile wart jest model, gdy znam cenę rynku?”. Odpowiedź: kombinacja, której
wagi uczą się wyłącznie z wcześniej rozstrzygniętych pytań — zapisywana przed faktem i oceniana tak samo jak oba
źródła. Waga modelu bliska zera = model nic nie dodaje do rynku (uczciwa informacja zwrotna).

**Metoda** (`src/utils/ensemble.ts`): `logit p_e = a + b_m·logit(p_model) + b_k·logit(środek rynku)`; regresja
logistyczna IRLS z priorem normalnym (τ = 0,5) w stronę równego poolingu (a = 0, b_m = b_k = ½), wagi obserwacji
z okresem półtrwania 14 dni, poniżej 50 par — prior. Literatura: Genest & Zidek (1986), Ranjan & Gneiting (2010),
Satopää i in. (2014, ekstremizacja).

**Zapis.** Rekord „mkt” w chwili wydania dostaje `pe` (p ensemble) i `ens: {a, bm, bk, n}` — wagi dopasowane na
parach rozstrzygniętych przed chwilą wydania (tylko notowania z wąskim spreadem, z dala od progu). Brak notowania →
`pe` null.

**Ocena.** Brier i log score ensemble obok modelu i rynku (oba poziomy płynności), różnica ensemble − rynek
z bootstrapem parowanym; karta w panelu dziennika; panel „Model vs rynek” pokazuje p ensemble dla bieżących rynków
z ostatnich opublikowanych wag (MODEL).

**Weryfikator.** `pe` = σ(a + b_m·logit p + b_k·logit środek) z zapisanych wartości; `ens.n` ≤ liczba par
rozstrzygniętych przed wydaniem (brak zaglądania w przyszłość).

## B. Koszt wykonania wg godziny

**Dlaczego.** Ten sam rozmiar zlecenia kosztuje inaczej o 03:00 i o 14:30 UTC. Rejestrator płynności zna głębokość
arkusza wg godziny; trader potrzebuje liczby: „ile bp zapłacę za X USD teraz vs w typowej godzinie, kiedy najtaniej”.

**Dane.** Profil płynności dostaje mediany głębokości osobno dla bidów i asków (±10 / ±20 bp) wg godziny oraz
25. percentyl sumy (warunki cienkie). Pola opcjonalne — starsze pliki dalej poprawne.

**Metoda** (`src/utils/execCost.ts`): skumulowana głębokość strony jako funkcja odległości od środka — liniowo przez
(0, 0), (10 bp, D10), (20 bp, D20); powyżej 20 bp prawo pierwiastka kwadratowego (Tóth i in. 2011, Bouchaud i in.
2018) skalibrowane w punkcie 20 bp: x(q) = 20·√(q/D20). Średni poślizg = (1/Q)∫₀^Q x(q) dq; do tego opłata takera
Hyperliquid (poziom bazowy). Kupno — aski, sprzedaż — bidy.

**UI.** Panel „Płynność arkusza w ciągu doby”: pole wielkości (domyślnie z Analizatora planu), koszt wg godziny UTC
(mediana i warunki cienkie), teraz vs typowo, najtańsze / najdroższe godziny; Analizator planu: koszt typowy tej
godziny obok poślizgu z bieżącego arkusza.

**Zastrzeżenia (w UI).** Widoczne zlecenia, bez ukrytych; zlecenie rynkowe zmienia arkusz (koszt rośnie szybciej
dla dużych rozmiarów — prawo pierwiastka to średnia, nie gwarancja); nie uwzględnia opóźnienia ani przesunięcia
ceny w trakcie wykonania.
