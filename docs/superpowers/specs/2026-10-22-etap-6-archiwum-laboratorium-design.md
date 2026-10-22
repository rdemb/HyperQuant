# Etap 6 — archiwum świec i prerejestrowane laboratorium folkloru

Data: 2026-10-22. Realizuje rekomendację 1 z listy zatwierdzonej przez właściciela („startuj z kolejnymi
rekomendacjami”). Zasady produktu bez zmian: LIVE/MODEL/SZAC. uczciwie, „—” zamiast wypełniaczy, bez sygnałów
kupna/sprzedaży, tylko publiczne dane, zero kosztów, żadnych danych serwera w repo.

## Dlaczego

Day trading BTC stoi na regułach z folkloru: „luki CME się zamykają”, „okrągłe poziomy trzymają”, „zebranie
PDH to odwrót”, „dump o 10:00 w Nowym Jorku”, „wybicie IB jedzie dalej”, „z 2σ od VWAP cena wraca”. Nikt publicznie
nie testuje ich rzetelnie — zwykle są wybrane przykłady, brak hipotezy zerowej, brak korekty na wiele testów
i podglądanie wyników aż „wyjdzie”. Desk pokazuje dla każdej reguły:

1. **Test historyczny (eksploracyjny)** — jeden, jawny estymator, hipoteza zerowa z twierdzenia o opcjonalnym
   zatrzymaniu (cena = martyngał), korekta FDR Benjaminiego–Hochberga dla całej rodziny reguł.
2. **Test do przodu (prerejestrowany, potwierdzający)** — katalog reguł z parametrami zapisany w weryfikowalnym
   dzienniku (łańcuch hashy + OpenTimestamps) zanim pojawią się dane; ocena wyłącznie zdarzeń rozpoczętych po
   rejestracji, e-wartości z procesu zakładów (Waudby-Smith & Ramdas 2023) ważne przy ciągłym podglądaniu
   (nierówność Ville’a), FDR przez e-BH (Wang & Ramdas 2022) — poprawne przy dowolnej zależności między regułami,
   anytime-valid przedział ufności efektu (sekwencja ufności).
3. **Kontrole** — pozytywna (weekendy spokojniejsze — musi wyjść) i negatywna (placebo: te same testy przy
   nieokrągłych poziomach — nie powinno), żeby było widać, że maszyna działa, zanim ktoś uwierzy werdyktom.

Hyperliquid udostępnia tylko ~5000 ostatnich świec na interwał (1m ≈ 3,5 doby, 1h ≈ 208 dni). Bez archiwum
historia przepada — a z nią możliwość odtworzenia wyników laboratorium i rozstrzygnięć dziennika. Dlatego najpierw
archiwum.

## A. Archiwum świec (skaner)

- Dane BTC: świece 1m, 1h, 1d (`candleSnapshot`) i godzinowa historia finansowania (`fundingHistory`, stronicowana).
- Gałąź `archive` repo danych: historia przyrostowa, wyłącznie dopisywanie (ten sam mechanizm i ta sama kontrola
  „nowa treść zaczyna się od starej” co gałąź `ledger`, rozszerzona na `.csv`; reguła ochrony gałęzi jak dla `ledger`).
  - `BTC/1m/RRRR/MM-DD.csv` (dzień UTC), `BTC/1h/RRRR-MM.csv`, `BTC/1d/RRRR.csv` — nagłówek `t,o,h,l,c,v,n`
    (t = początek świecy, ms UTC), wyłącznie świece zamknięte, rosnąco, bez duplikatów.
  - `BTC/funding/RRRR-MM.csv` — `t,rate,premium`.
- Zasiew przy pierwszym uruchomieniu: wszystko, co oddaje API (1h ~208 dni, 1d cała historia, 1m ~3,5 doby,
  finansowanie od początku). Potem co godzinę (minuta 3): dopisanie zamkniętych świec nowszych niż ostatnia
  w archiwum; luki (brak świecy w API) zostają lukami — bez interpolacji. Commit + push tylko przy nowych wierszach.
- Koszt API: kilka zapytań na godzinę (wagi jak `candleSnapshot` w dzienniku), ten sam ogranicznik co skaner.
- Archiwum jest źródłem świec dla laboratorium (historia 1h rośnie z czasem ponad limit API).

## B. Laboratorium folkloru

### Ramy (jedna metoda dla wszystkich reguł barierowych)

Zdarzenie: chwila startu `t0` z ceną `C` i dwie bariery — „przewidywana przez folklor” `B⁺` i przeciwna `B⁻`.
Wynik `x = 1`, gdy cena dotknie `B⁺` przed `B⁻`. Pod hipotezą zerową „cena jest martyngałem” (brak przewidywalnego
kierunku) z twierdzenia o opcjonalnym zatrzymaniu: `P(x = 1) = p₀ = |C − B⁻| / |B⁺ − B⁻|` — dokładnie, bez
założeń o rozkładzie czy zmienności. Folklor twierdzi `P(x = 1) > p₀`. Dryf BTC w skali godzin jest pomijalny
(odchylenie p₀ < 0,2 pp — zapisane w opisie).

- Ścieżka z barów 1h (`high`/`low`). Start zawsze na zamknięciu bara, który wywołał zdarzenie (bez zaglądania
  w przyszłość wewnątrz bara).
- Limit czasu albo luka w danych → wynik ułamkowy `x = |C_T − porażka| / |sukces − porażka|` z ostatniego zamknięcia
  (liniowy w cenie, więc pod H0 nadal `E[x] = p0` dokładnie). Odrzucanie takich zdarzeń faworyzowałoby bliższą
  barierę — symulacja martyngału pokazała obciążenie −1,9 pp dla PDH, po poprawce brak.
- Bar dotykający obu barier → niejednoznaczne, odrzucone. Odrzucenie przy p0 ≠ 0,5 obciąża wynik (symulacja: VWAP
  +1,7 pp, z = 4,4), dlatego reguły z p0 ≠ 0,5 wymagają w chwili startu pasma ≥ 2 × mediana zakresu 24 poprzednich
  godzin: w symulacji brak obciążenia, na danych BTC niejednoznaczne ≤ 1% zdarzeń.
- Ocena do przodu od zdarzeń rozpoczętych 24 h po rekordzie prerejestracji (pokwitowanie w Bitcoinie powstaje
  z opóźnieniem — dowód „katalog przed danymi” ma być ścisły).
- Zdarzenia jednej reguły nie nakładają się: następne zaczyna się nie wcześniej niż rozstrzygnięcie poprzedniego
  (warunek poprawności procesu zakładów).
- Reguły niebarierowe mają `p₀ = 0,5` z symetrii (dokładne pod hipotezą zerową wymienialności / symetrii znaku).

### Katalog v1 (prerejestrowany; parametry w katalogu, kod definicji publiczny)

| id | reguła (folklor) | zdarzenie i sukces |
|---|---|---|
| `round-res` | okrągły poziom jest oporem | pierwsze przebicie od dołu poziomu `1000·k` w barze; sukces: `L − d` przed `L + d`, d = 1% ceny |
| `round-sup` | okrągły poziom jest wsparciem | lustrzanie od góry; sukces: `L + d` przed `L − d` |
| `pdh-sweep` | zebranie PDH → powrót | pierwsze dotknięcie maksimum poprzedniego dnia UTC; bariery PDH ± (PDH − PDmid); sukces: dół |
| `pdl-sweep` | zebranie PDL → powrót | lustrzanie dla minimum; sukces: góra |
| `ib-break` | wybicie IB jedzie dalej | pierwsze wyjście z IB (00–01 UTC) po 01:00; bariery krawędź ± zakres IB; sukces: w stronę wybicia |
| `vwap-revert` | z 2σ od VWAP cena wraca | zamknięcie 1h poza VWAP ± 2σ sesji (od 4. godziny); sukces: dotknięcie VWAP przed VWAP ± 4σ |
| `cme-gap` | luka CME przyciąga cenę | otwarcie CME w niedzielę (22/23 UTC wg czasu w Chicago), luka ≥ 0,3% względem zamknięcia piątkowego; bariery: poziom luki i lustro; sukces: luka; limit: piątkowe zamknięcie |
| `funding-flush` | skrajne finansowanie → flush | finansowanie w górnych/dolnych 5% z 30 dni (ze znakiem); bariery ± 1%; sukces: przeciw tłumowi |
| `ny-10am` | dump o 10:00 w Nowym Jorku | dzień roboczy USA; sukces: zwrot godziny 10:00–11:00 czasu NY w dolnej połowie 24 zwrotów godzinowych dnia UTC; p₀ = 0,5 |
| `intraday-mom` | momentum śróddzienne (Gao i in. 2018) | dzień UTC; sukces: znak ostatniej godziny = znak pierwszej; p₀ = 0,5 |
| `ctrl-weekend` | kontrola pozytywna: weekend spokojniejszy | tydzień; sukces: log-zakres (sob + nd) < (śr + czw); p₀ = 0,5 |
| `ctrl-placebo` | kontrola negatywna | jak `round-res` i `round-sup` łącznie, ale poziomy `1000·k + 437` |

Rodzina FDR = 10 reguł folkloru (kontrole poza rodziną).

### Statystyka

- **Historycznie** (eksploracyjnie, wszystkie zdarzenia z archiwum): `n`, odsetek sukcesów vs średnie `p₀`,
  efekt = średnia `(x − p₀)` w pp z przedziałem 90% (normalny z wariancją `Σ p₀(1 − p₀)`), p-wartość jednostronna
  z dokładnego rozkładu Poissona–dwumianowego (DP), q-wartości BH w rodzinie. Werdykt eksploracyjny:
  „wspiera” (q ≤ 0,10), „przeciw” (efekt ujemny z q ≤ 0,10 w teście przeciwnym), „brak dowodu”.
- **Do przodu** (tylko zdarzenia z `t0` > czas rekordu w dzienniku + 24 h): proces zakładów
  `E = Π (1 + λᵢ (xᵢ − p₀ᵢ))` z przewidywalnym `λᵢ` (aGRAPA, obcięte do `[0, 0,5/p₀ᵢ]`); osobno e-proces przeciw tezie
  (lustrzane zdarzenia). e-BH dla potwierdzeń i osobno dla obaleń, każda rodzina na 5% (łącznie FDR ≤ 10%; reguła
  potwierdzona, gdy jej e-wartość ≥ 10/(0,05·k) dla k reguł odrzucanych łącznie), sekwencja ufności 90% dla efektu
  (hedged capital, siatka). Werdykt: „potwierdzona”, „obalona” (efekt przeciwny), „efekt wykluczony poza ±5 pp”
  (cała sekwencja ufności w ±5 pp), „zbieram dane”. Kontrole: pojedynczy test na 5%.
- Minimum do pokazania werdyktu historycznego: 30 zdarzeń; poniżej — „za mało zdarzeń”.

### Prerejestracja

- Katalog (id, opis, parametry, wersja definicji) → kanoniczny JSON → SHA-256. Przy starcie skaner dopisuje do
  dziennika rekord `{k: 'p', id: 'lab-v1', t, hash, catalog}`, jeśli rekordu z tym hashem jeszcze nie ma. Łańcuch
  hashy i pokwitowanie OTS najbliższego slotu dowodzą, że katalog istniał przed danymi oceny.
- Zmiana definicji = nowa wersja katalogu i nowy rekord; ocena do przodu nowej wersji startuje od nowa (stara
  zostaje opublikowana do końca jako historia).

### Publikacja i UI

- `lab/BTC.json` (gałąź `main`, co godzinę): rejestracja (wersja, hash, czas, id rekordu), dla każdej reguły
  wynik historyczny, wynik do przodu z trajektorią e-wartości (próbkowana) i pełną listą zdarzeń do przodu
  (`t0, t1, x, p0`) — każdy może przeliczyć e-wartości. Nadzór danych pilnuje świeżości pliku (opcjonalny).
- Widok Plan, karta „Laboratorium folkloru”: tabela reguł (historia: n, sukces vs p₀, efekt ± przedział, q, werdykt;
  do przodu: n, e-wartość, werdykt e-BH, sekwencja ufności), osobny wiersz kontroli, rozwinięcie reguły: definicja
  z katalogu, krzywa e-wartości z linią 1/α, skumulowane `x − p₀`. Opis metody z odnośnikami do literatury.

## Literatura

- Doob, optional stopping; gambler’s ruin dla martyngałów ciągłych.
- Benjamini, Hochberg (1995); Benjamini, Yekutieli (2001).
- Waudby-Smith, Ramdas (2023), *Estimating means of bounded random variables by betting*, JRSS B.
- Wang, Ramdas (2022), *False discovery rate control with e-values*, JRSS B.
- Ramdas, Grünwald, Vovk, Shafer (2023), *Game-theoretic statistics and safe anytime-valid inference*.
- Osler (2000, 2003) — poziomy okrągłe i zlecenia warunkowe na rynku walutowym.
- Gao, Han, Li, Zhou (2018), *Market intraday momentum*, JFE.

## Poza zakresem (decyzje)

- Rozdzielczość 1m w laboratorium (v2, gdy archiwum 1m urośnie) — v1 liczy wszystko z barów 1h, identycznie
  historycznie i do przodu.
- Inne giełdy (dłuższa historia) — nie, desk opiera się na publicznym API Hyperliquid.
