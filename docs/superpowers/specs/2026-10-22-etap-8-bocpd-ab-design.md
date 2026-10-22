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

- **Plan prerejestrowany**: `AB_DESIGN` (pytanie, modele, wzór skali, miara, okresy, HAC, wartość krytyczna, minimum
  par, zapas, reguła wniosku) zapisany w łańcuchu dziennika jako rekord `k: 'p'` (`ab-v1`, SHA-256 kanonicznego JSON)
  przy pierwszym przebiegu z wariantem B — przed pierwszym rekordem B i przed AB_EPOCH. Weryfikator sprawdza, że
  zapisany plan jest identyczny z planem w kodzie i że żaden rekord B nie poprzedza rejestracji; zmiana planu = nowy
  identyfikator.
- Okresy oceny ustalone z góry: kolejne, rozłączne bloki **14 dni od 2026-10-23 00:00 UTC** (`AB_EPOCH`). Pary
  sprzed tej chwili nie wchodzą do oceny. Blok mieści się w 31-dniowym oknie pamięci skanera.
- Okres w toku i okres w rozliczaniu (po końcu, przed upływem zapasu): liczności i średnie CRPS, bez przedziału.
  Zapas = horyzont 60 min + unieważnienie po 6 h + 15 min — wniosek nie zmienia się po pokazaniu.
- Okres zakończony: różnica B − A z 95% przedziałem **Neweya–Westa** (jądro Bartletta, opóźnienie 96 slotów = 24 h) na
  wszystkich parach slotów okresu i wartością krytyczną **fixed-b** (Kiefer & Vogelsang 2005:
  1,96 + 2,9694b + 0,416b² − 0,5324b³, b = 97/n) — przy opóźnieniu będącym znaczącą częścią próby zwykłe 1,96 daje
  za wąski przedział (symulacja AR(1), φ = 0,9: pokrycie 74% przy n = 192). Przedział od 672 par (7 dób).
- Wniosek z ostatniego zakończonego okresu: B trafniejsze (przedział < 0), A trafniejsze (> 0) albo różnica
  nieudowodniona.

## Interpretacja

σ_A to σ modelu HAR (miary zakresowe Garmana–Klassa z korektą), a σ reżimu pochodzi z przyrostów cen zamknięcia 5m.
Wersja B koryguje więc nie tylko opóźnienie reakcji na zmianę reżimu, ale też ewentualną systematyczną różnicę
poziomu między tymi miarami. „B trafniejsza” znaczy: mieszanina z bieżącą zmiennością zamknięć 5m daje lepiej
skalibrowaną szerokość rozkładu 1 h — nie rozstrzyga, który z tych dwóch mechanizmów za to odpowiada.

## Weryfikator (`checkVariants`, `checkAbPlan`, `recompute`)

- Te same chwile, horyzont, cena, τ, benchmark i ACI co A; kwantyle = A × skala; horyzont 1 h, model B;
  skala = √(½ + ½·σ5²·(h/5)·seas/σ_A²) z zapisanych wielkości (±10⁻⁵), więc ≥ √½; σ_A wiarygodne względem kwantyli
  A: (q₀.₉₇₅ − q₀.₀₂₅)/(3,92·σ_A) ∈ [0,5; 2].
- Plan A/B: zgodny z kodem, jeden hash, wariant B po rejestracji.
- Przeliczenie okresów A/B z CRPS liczonych z kwantyli (nie z zapisu) tą samą funkcją co skaner; w trybie szybkim
  (ostatnie dni) okres zaczęty przed pierwszym pobranym dniem oznaczony jako niepełny, bez przedziału.
- Błąd pobrania reżimu nie wstrzymuje wersji A (slot bez B). Uszkodzona sekcja `ab` w podsumowaniu ukrywa tylko
  kartę A/B, nie cały panel dziennika.

## Poza zakresem

- Wersja B dla 4 h i dotknięć — po pierwszym wyniku A/B.
