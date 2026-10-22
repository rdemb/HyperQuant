# Etap 9 — symulator kaskady likwidacji 2.0

Data: 2026-10-22. Rekomendacja 4 z listy zatwierdzonej przez właściciela.

## Dlaczego

Dotychczasowa kaskada na mapie likwidacji to deterministyczna górna granica: wpływ ceny z ogólnego prawa pierwiastka
Y·σ·√(Q/V) z dziennego obrotu, pełne trafienie w arkusz, bez odbudowy, tylko zmierzone pozycje. Desk ma teraz lepsze
dane — zmierzony arkusz wg godziny i jego odporność (rejestrator płynności) — i może pokazać rozkład wyniku zamiast
jednej liczby oraz to, czy pętla „ruch → likwidacje → wpływ” jest blisko krytyczności.

## Metoda (`src/utils/cascadeSim.ts`)

- Monte Carlo (400 ścieżek), krok 30 s, horyzont 60 min. Szok obejmuje cały rynek (wyrocznia, giełdy): cena idzie do
  `base`, pozycje między ceną a `base` są likwidowane od razu.
- Likwidacje wchodzą transzami (20% nominału na krok; Hyperliquid likwiduje duże pozycje częściami) i zjadają zmierzoną
  stronę arkusza HL (longi — bidy, shorty — aski) wzdłuż krzywej głębokości z rejestratora: liniowo do ±10 / ±20 bp,
  dalej prawo pierwiastka (ta sama krzywa co koszt wykonania; Tóth i in. 2011, Bouchaud i in. 2018).
- Kolejne likwidacje wyzwala cena mark, nie środek arkusza. Mark HL to mediana (wyrocznia + EMA 150 s różnicy środka HL
  od wyroczni, ceny HL, mediana perpów CEX); gdy wpływ dotyczy tylko arkusza HL, mark podąża za nim z opóźnieniem
  EMA 150 s. W tym czasie arkusz się odbudowuje: zużyta głębokość wygasa, τ = (mediana minut do powrotu do 80%) / ln 5
  (brak pomiaru → 5 min). Kaskada rozkręca się, gdy wpływ trwa dłużej niż odbudowa — założenie: zewnętrzne ceny nie
  podążają za wpływem na HL (recenzja: bez tego czas nie miał wpływu na wynik, a wyzwalanie po środku zawyżało kaskadę).
- Niepewność: pozycje spoza mapy — nominał × 1/pokrycie strony (longBtc/OI, shortBtc/OI; ≥ 5%) × czynnik wspólny ścieżki
  (log-normalny, σ = 0,5) × czynnik kubełka (σ = 0,3), oba o średniej 1; w arkusz trafia U(0,6; 1) nominału (resztę
  przejmuje Liquidator Vault).
- Wynik: ruch szczytowy ceny HL (p10 / p50 / p90), zlikwidowany nominał, P(ruch ≥ 2 × szok); brak głębokości strony →
  wiersz „—” (nie „brak kaskady”).
- Wzmocnienie lokalne (przybliżenie liniowe, bez opóźnienia mark i odbudowy): największy stosunek wpływu likwidacji
  uruchomionych ruchem o δ = 5…50 bp do δ (sieczna, zgodna z krzywą symulacji).
- Głębokość: bieżąca minuta rejestratora, gdy profil świeży (≤ 15 min), inaczej mediana godziny (≥ 30 min danych)
  z oznaczeniem; strony z median godziny (±10 bp — b10/a10, ±20 bp — b20/a20).

## UI

Mapa likwidacji na Desku: pod deterministyczną górną granicą sekcja „Kaskada 2.0” — wzmocnienie lokalne ▼/▲ z interpretacją,
tabela szoków ±0,5 / 1 / 2 / 3%: ruch szczytowy (mediana i ×), przedział 10–90%, P(≥ 2×), likwidacje. Bez profilu
płynności sekcja się nie pokazuje (zostaje górna granica).

## Poza zakresem (decyzje)

- Pełny wielowymiarowy proces Hawkesa kalibrowany na taśmie likwidacji — taśma obejmuje tylko pozycje śledzone przez
  skaner (dziesiątki zdarzeń na dobę), za mało do stabilnego MLE; zamiast tego współczynnik rozgałęzienia z mapy
  i arkusza (wzmocnienie lokalne); jedyna dynamika „samowzbudzenia” to pętla mark → likwidacje → wpływ z opóźnieniem i odbudową.
- Kalibracja symulatora na zrealizowanych kaskadach wymaga historii map (nie archiwizowanej) — kolejny etap.
