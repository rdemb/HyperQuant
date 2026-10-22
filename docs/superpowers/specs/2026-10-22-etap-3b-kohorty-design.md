# Etap 3b — przepływ kohort (kto naprawdę kupuje i sprzedaje)

## Intencja

CVD (skumulowana delta wolumenu) mówi, *ile* agresora kupiło lub sprzedało — nie mówi *kto*. Na Hyperliquid każda transakcja
z publicznej taśmy ma adresy obu stron (`users: [kupujący, sprzedający]`), a strona agresora (`side`) wskazuje biorcę płynności.
To pozwala rozłożyć przepływ na kohorty uczestników — czego żaden publiczny desk nie robi z mierzoną, a nie zgadywaną, przynależnością
i z jawną walidacją poza próbą.

## Kohorty (rozłączne, w tej kolejności)

1. **Market makerzy** — udział zleceń maker w nominale ≥ 80% i nominał maker (z wygaszaniem, połowa po 7 dniach) ≥ 1 mln USD.
2. **Poinformowani (statystycznie)** — adresy, których markout biorcy po 5 min jest istotnie dodatni:
   - markout transakcji = kierunek × (cena po h − cena transakcji) / cena, w bp, h ∈ {1, 5, 60} min (cena = ostatnia transakcja w sekundzie);
   - na adres: n, Σm, Σm² z wygaszaniem (połowa po 7 dniach), tylko transakcje biorcy;
   - empiryczny Bayes (normalny–normalny): rozkład a priori średnich N(μ₀, τ²) z przekroju adresów metodą momentów,
     średnia a posteriori = (τ²·m̄ + (s²/n)·μ₀) / (τ² + s²/n);
   - wybór: test jednostronny H₀: średnia ≤ 0 na adresach z n ≥ 30, kontrola FDR Benjaminiego–Hochberga przy q = 0.10;
   - przeliczane co 10 min na danych z przeszłości — przynależność stosowana do *przyszłych* transakcji.
3. **Wieloryby** — śledzona pozycja BTC ≥ 1 mln USD albo wartość konta z publicznego rankingu ≥ 10 mln USD.
4. **Reszta.**

## Walidacja poza próbą (uczciwość)

Dla każdej kohorty publikujemy markout transakcji wykonanych **po** zaklasyfikowaniu (1/5/60 min, średnia ważona nominałem i liczność).
Jeżeli „poinformowani” nie mają dodatniego markoutu poza próbą, UI to pokazuje — klasyfikacja nie jest wtedy reklamowana jako przewaga.

## Prywatność

- Adresy, przynależność i statystyki per adres zostają na serwerze.
- k-anonimowość z regułą dominacji: komórka (kohorta × kubełek) z mniej niż 5 uczestnikami albo z jednym uczestnikiem powyżej 50% obrotu
  ma wartość `null` (nie da się z niej odczytać handlu pojedynczego konta); sumy liczone tylko z komórek widocznych, z liczbą ukrytych.
- Publikowane: kubełki **15 min** z 24 h (dłuższe niż pierwotne 5 min — przy 5 min zbyt wiele komórek mniejszych kohort byłoby ukrytych),
  sumy 1 h / 24 h, liczności kohort, markouty poza próbą.

## Decyzje z realizacji (po recenzji prywatności)

- **Ukrywanie wtórne**: suma kohort w kubełku to publiczny wolumen z taśmy, więc pojedynczą ukrytą komórkę dałoby się odtworzyć
  odejmowaniem — przy ukryciu jednej ukrywane są kolejne (najmniejsze), aż suma ukrytych sama spełnia k i dominację.
  Osobno dla warstwy agresora (takerBuy/takerSell może być null przy widocznej komórce).
- **Tylko zamknięte kubełki** z widocznością ustaloną raz — różnicowanie kolejnych publikacji otwartego kubełka ujawniałoby pojedyncze transakcje.
- **Zaokrąglenia**: kwoty do 10 tys. USD, liczności (adresy, kandydaci, wybrani) w dół do dziesiątek, markouty do 0.1 bp.
- **Markouty poza próbą** tylko z w pełni rozliczonych godzin; każda godzina z bramką k-anonimowości biorców kohorty.
- **Pseudoreplikacja**: obserwacją testu „poinformowanych” jest blok 5 min adresu (średnia ważona nominałem), nie pojedynczy fill.
- **Pamięć**: statystyki nieaktywnych małych adresów wypadają po 7 dniach, twardy limit 100 tys. adresów.

- **Przepływ netto = zmiana zapasów kohorty**: kupno − sprzedaż wszystkich fillów kohorty (obie strony transakcji), obok agresywnego CVD
  (tylko biorcy). Co jedna kohorta kupuje, inna sprzedaje — netto sumuje się do zera po kohortach (zasada zachowania pozycji), co pokazuje
  wprost, która kohorta przejmuje zapasy od której.
- Paleta kohort bez `series-2`/`series-3` (zbyt bliskie barwom sprzedaży/kupna) — zwalidowana na ciemnym tle.

## Publikacja

`cohorts/BTC.json` w repo danych (co 2 min razem z mapą i taśmą), rozmiar rzędu kilkudziesięciu KB.

## UI

Panel „Przepływ kohort” na Desku: skumulowana delta per kohorta (24 h, jedna oś USD, kolory kategoryczne w stałej kolejności,
legenda i etykiety bezpośrednie), netto 1 h per kohorta, karta walidacji poza próbą, tabela liczb. Etykieta LIVE dla przepływu,
MODEL dla klasyfikacji „poinformowani”.

## Nie-cele

- Żadnych sygnałów kup/sprzedaj ani „kopiuj wieloryba”.
- Bez publikowania rankingów adresów.

## Koszt

Zero zapytań REST (wyłącznie strumień WebSocket, który skaner już subskrybuje); pamięć: ~10–50 tys. adresów × kilka liczb, kolejka
markoutów ≤ 60 min transakcji.
