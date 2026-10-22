# Etap 9 — symulator kaskady likwidacji 2.0

Data: 2026-10-22. Rekomendacja 4 z listy zatwierdzonej przez właściciela.

## Dlaczego

Dotychczasowa kaskada na mapie likwidacji to deterministyczna górna granica: wpływ ceny z ogólnego prawa pierwiastka
Y·σ·√(Q/V) z dziennego obrotu, pełne trafienie w arkusz, bez odbudowy, tylko zmierzone pozycje. Desk ma teraz lepsze
dane — zmierzony arkusz wg godziny i jego odporność (rejestrator płynności) — i może pokazać rozkład wyniku zamiast
jednej liczby oraz to, czy pętla „ruch → likwidacje → wpływ” jest blisko krytyczności.

## Metoda (`src/utils/cascadeSim.ts`)

- Monte Carlo (400 ścieżek), krok 1 min, horyzont 60 min. Szok przesuwa cenę; kubełki mapy po właściwej stronie
  przekroczone przez cenę stają się zleceniami rynkowymi.
- Wpływ ceny z krzywej głębokości zmierzonej strony arkusza (longi — bidy, shorty — aski): liniowo do ±10 / ±20 bp,
  dalej prawo pierwiastka kwadratowego skalibrowane na ±20 bp (ta sama krzywa co koszt wykonania; Tóth i in. 2011,
  Bouchaud i in. 2018). Głębokość teraz = bieżąca minuta rejestratora, podział na strony jak w medianie tej godziny.
- Odbudowa arkusza: zużyta głębokość wygasa wykładniczo, τ = (mediana minut do powrotu do 80%) / ln 5; brak pomiaru →
  5 min (jawnie w UI).
- Niepewność: pozycje spoza mapy — nominał kubełka × 1/pokrycie × rozrzut log-normalny (σ = 0,5, średnia 1, niezależnie
  na kubełek); udział likwidacji trafiających w arkusz U(0,6; 1) na ścieżkę (resztę przejmuje Liquidator Vault).
- Wynik: ruch szczytowy (p10 / p50 / p90), zlikwidowany nominał, P(ruch szczytowy ≥ 2 × szok).
- Lokalny współczynnik rozgałęzienia pętli kaskady (analogia procesu Hawkesa): gęstość likwidacji w pierwszych 50 bp
  [USD/bp] (z przeskalowaniem i średnim udziałem 0,8) × wpływ krańcowy pustego arkusza 10 / D10 [bp/USD]. n ≥ 1 —
  nadkrytycznie (mały ruch może się sam podtrzymać).

## UI

Mapa likwidacji na Desku: pod deterministyczną górną granicą sekcja „Kaskada 2.0” — rozgałęzienie ▼/▲ z interpretacją,
tabela szoków ±0,5 / 1 / 2 / 3%: ruch szczytowy (mediana i ×), przedział 10–90%, P(≥ 2×), likwidacje. Bez profilu
płynności sekcja się nie pokazuje (zostaje górna granica).

## Poza zakresem (decyzje)

- Pełny wielowymiarowy proces Hawkesa kalibrowany na taśmie likwidacji — taśma obejmuje tylko pozycje śledzone przez
  skaner (dziesiątki zdarzeń na dobę), za mało do stabilnego MLE; zamiast tego współczynnik rozgałęzienia z mapy
  i arkusza.
- Kalibracja symulatora na zrealizowanych kaskadach wymaga historii map (nie archiwizowanej) — kolejny etap.
