# Etap 7 — ensemble model + rynek w dzienniku, koszt wykonania wg godziny

Data: 2026-10-22. Rekomendacje 2 i 3 z listy zatwierdzonej przez właściciela. Zasady bez zmian (LIVE/MODEL uczciwie,
„—” zamiast wypełniaczy, bez sygnałów, publiczne dane, zero kosztów, żadnych danych serwera w repo).

## A. Ensemble model + rynek (pooling logarytmiczny z wagami z dziennika)

**Dlaczego.** Dziennik porównuje co 15 min p modelu desku z ceną rolującego rynku HIP-4 na tym samym pytaniu.
Naturalne następne pytanie day tradera: „ile wart jest model, gdy znam cenę rynku?”. Odpowiedź: kombinacja, której
wagi uczą się wyłącznie z wcześniej rozstrzygniętych pytań — zapisywana przed faktem i oceniana tak samo jak oba
źródła. Waga modelu bliska zera = model nic nie dodaje do rynku (uczciwa informacja zwrotna).

**Metoda** (`src/utils/ensemble.ts`): `logit p_e = a + b_m·logit(p_model) + b_k·logit(środek rynku)`; regresja
logistyczna z priorem normalnym (τ = 0,5) w stronę równego poolingu (a = 0, b_m = b_k = ½), wagi obserwacji z okresem
półtrwania 14 dni, okno 30 dni przed chwilą dopasowania, poniżej 50 par — prior. Metoda Newtona z ograniczeniem kroku
(|Δ| ≤ 1) i backtrackingiem na karanej funkcji celu; brak zbieżności albo cel gorszy niż w priorze → prior (recenzja
pokazała, że czysty krok Newtona rozbiega się przy p modelu = 0/1 z błędnym wynikiem). Punkt odniesienia: rynek
skalibrowany `a + b_k·logit(środek)` (prior a = 0, b_k = 1) — ta sama procedura; dopiero przewaga ensemble nad nim
pokazuje wartość dodaną modelu (sama rekalibracja usuwa np. błąd faworyt–outsider). Literatura: Genest & Zidek (1986),
Ranjan & Gneiting (2010), Satopää i in. (2014, ekstremizacja).

**Zapis.** Rekord „mkt” w chwili wydania dostaje `pe`, `ens`, `pr`, `rec` — wagi dopasowane na parach rozstrzygniętych
w 30 dniach przed chwilą wydania (tylko notowania z wąskim spreadem, z dala od progu; kolejność: czas rozstrzygnięcia,
id). Brak notowania → `pe`/`pr` null.

**Ocena.** Na pytaniach z zapisanym p_e: Brier modelu, rynku, rynku skalibrowanego i ensemble (porównanie jak z jak),
różnice parowane ensemble − rynek i ensemble − rynek skalibrowany (wartość dodana modelu) z bootstrapem; karta w panelu
dziennika; panel „Model vs rynek” pokazuje p_e tylko dla pytania wybieranego tak samo jak w dzienniku (jedyny rolujący
rynek „perp mark” z terminem na pełnym kwadransie, 5–10 min przed terminem).

**Weryfikator.** Wzory `pe`/`pr` z zapisanych wag; przy pełnym dzienniku ponowne dopasowanie wag tym samym publicznym
kodem na parach rozstrzygniętych przed wydaniem (ostatnie 30 dni wydań) — wagi muszą się zgadzać do 2·10⁻⁶; przeliczony
Brier ensemble w `recompute`.

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
