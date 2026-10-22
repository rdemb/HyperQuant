# Etap 8 — reżim zmienności (BOCPD) i A/B wersji modelu w weryfikowalnym dzienniku

Data: 2026-10-22. Rekomendacja 5 z listy zatwierdzonej przez właściciela.

## Dlaczego

Model zmienności desku (sezonowy log-HAR + FHS) reaguje na zmianę reżimu z opóźnieniem — HAR uśrednia dzień, tydzień
i miesiąc. Bayesowskie wykrywanie punktów zmiany online (BOCPD, Adams & MacKay 2007) daje bieżący reżim i jego σ.
Czy to poprawia prognozy, ma rozstrzygnąć nie intuicja, tylko **test A/B w weryfikowalnym dzienniku**: obie wersje
zapisane przed faktem w tych samych slotach, ocenione tą samą miarą (CRPS), z niepewnością.

## Metoda

- `src/utils/bocpd.ts`: BOCPD dla zwrotów o średniej 0 i nieznanej precyzji (prior Gamma, predykcja t-Studenta),
  stałe ryzyko zmiany H = 1/288 (oczekiwany reżim: doba świec 5m), rozkład długości przebiegu obcięty do 600 (ogon
  scalany). Wynik: najbardziej prawdopodobna długość, P(zmiany w 5 świecach), σ reżimu = √(β/(α − 1)).
- Wejście: log-zwroty ciągłych świec 5m z 3 dni (≤ 864); prior: średnia wariancji = mediana r² / 0,4549 (odporna).
- Wersja B prognozy zwrotu 1 h: σ_B² = ½σ_A² + ½σ²_reżimu·(h/5); kwantyle B = kwantyle A × skala (kształt FHS bez
  zmian), te same chwile, benchmark i ACI co A; ACI aktualizuje tylko wersja A.

## Zapis i ocena

- Rekord `<slot>-ret60b` (`variant: 'B'`, `scale`, `regime`, `model: 'ledger-har-fhs-bocpd-v1'`) w tej samej partii co
  A — to samo pokwitowanie OpenTimestamps slotu. Reżim odświeżany raz na slot przed ustaleniem chwili wydania; starszy
  niż 20 min → bez wersji B.
- Podsumowanie `ab`: CRPS A i B na tych samych slotach, różnica B − A z bootstrapem na podpróbie rozłącznej (sloty
  co 1 h — prognozy co 15 min z horyzontem 1 h nakładają się), najnowszy reżim i skala. Wniosek od 30 rozłącznych par.
- Weryfikator (`checkVariants`): te same chwile, horyzont, cena, τ, benchmark i ACI co A; kwantyle = A × skala.

## Poza zakresem

- Wersja B dla 4 h i dotknięć — po pierwszym wyniku A/B.
