# Etap 8 — reżim zmienności (BOCPD) i A/B wersji modelu w weryfikowalnym dzienniku

Data: 2026-10-22. Rekomendacja 5 z listy zatwierdzonej przez właściciela.

## Dlaczego

Model zmienności desku (sezonowy log-HAR + FHS) reaguje na zmianę reżimu z opóźnieniem — HAR uśrednia dzień, tydzień
i miesiąc. Bayesowskie wykrywanie punktów zmiany online (BOCPD, Adams & MacKay 2007) daje bieżący reżim i jego σ.
Czy to poprawia prognozy, ma rozstrzygnąć nie intuicja, tylko **test A/B w weryfikowalnym dzienniku**: obie wersje
zapisane przed faktem w tych samych slotach, ocenione tą samą miarą (CRPS), z niepewnością i bez podglądania.

## Metoda

- `src/utils/bocpd.ts`: BOCPD dla zwrotów o średniej 0 i nieznanej precyzji (prior Gamma, predykcja t-Studenta),
  stałe ryzyko zmiany H = 1/288 (oczekiwany reżim: doba świec 5m), rozkład długości przebiegu obcięty do 600 (ogon
  scalany). Wynik: najbardziej prawdopodobna długość (opisowo), P(zmiany w ostatnich 5 świecach) i σ reżimu =
  √(Σ_r P(r)·β_r/(α_r − 1)) — predykcyjna wariancja uśredniona po rozkładzie długości (nie tylko przy najbardziej
  prawdopodobnej długości).
- Wejście: log-zwroty zamkniętych, ciągłych świec 5m z 3 dni (≤ 865 świec; świeca w toku pomijana), **odsezonowane**
  profilem godzinowym modelu A: r / √f(godzina UTC świecy) — inaczej zwykły rytm doby (otwarcie USA) wyglądałby jak
  zmiana reżimu. Prior: średnia wariancji = max(mediana r² / 0,4549, ¼ średniej r², 10⁻¹⁰). Mniej niż 100 zwrotów
  albo ponad połowa zerowych → brak reżimu.
- Wersja B prognozy zwrotu 1 h: σ²_reżimu,h = σ5² · Σ f(godzina kroku) po krokach 5m horyzontu od `t` (ten sam profil),
  σ_B² = ½σ_A² + ½σ²_reżimu,h; kwantyle B = kwantyle A × skala, skala = √(½ + ½·σ²_reżimu,h/σ_A²) (kształt FHS bez
  zmian), te same chwile, benchmark i ACI co A; ACI aktualizuje tylko wersja A.

## Zapis

- Rekord `<slot>-ret60b` (`variant: 'B'`, `scale`, `regime`, `sigmaA` = σ_A, `seas` = średni współczynnik godzin na
  krokach horyzontu, `model: 'ledger-har-fhs-bocpd-v1'`) w tej samej partii co A — to samo pokwitowanie OpenTimestamps
  slotu. Skala liczona z zapisanych (zaokrąglonych) `sigmaA` i `seas`, więc da się ją odtworzyć bez modelu.
- Reżim liczony raz na slot, przed wydaniem prognoz slotu; wersja B tylko z reżimem policzonym w slocie wydania
  (nieudana próba nie jest ponawiana — slot bez wersji B).
- Liczniki `pending` / `voided` i wyniki wersji głównej nie obejmują wersji B; statystyki `--bitcoin` weryfikatora też.

## Ocena bez podglądania (`src/utils/abTest.ts`)

- Okresy oceny ustalone z góry: kolejne, rozłączne bloki **14 dni od 2026-10-23 00:00 UTC** (`AB_EPOCH`). Pary
  sprzed tej chwili nie wchodzą do oceny. Blok 14 dni mieści się w 31-dniowym oknie pamięci skanera.
- Okres w toku: liczności i średnie CRPS (punktowa różnica bez przedziału). Okres zakończony (koniec + h + 1 h na
  rozstrzygnięcia): różnica B − A z 95% przedziałem **Neweya–Westa** (jądro Bartletta, opóźnienie 96 slotów = 24 h) na
  wszystkich parach slotów okresu — prognozy co 15 min z horyzontem 1 h nakładają się, a zmienność skupia się w czasie.
  Przedział tylko przy co najmniej 192 parach (2 doby).
- Wniosek z ostatniego zakończonego okresu: B trafniejsze (przedział < 0), A trafniejsze (> 0) albo różnica
  nieudowodniona. Wniosek nie zmienia się w trakcie okresu, więc nie da się przerwać testu w dogodnej chwili.

## Weryfikator (`checkVariants`, `recompute`)

- Te same chwile, horyzont, cena, τ, benchmark i ACI co A; kwantyle = A × skala; horyzont 1 h, model B;
  skala = √(½ + ½·σ5²·(h/5)·seas/σ_A²) z zapisanych wielkości (±10⁻⁵), więc ≥ √½.
- Przeliczenie okresów A/B z CRPS liczonych z kwantyli (nie z zapisu) tą samą funkcją co skaner.

## Poza zakresem

- Wersja B dla 4 h i dotknięć — po pierwszym wyniku A/B.
