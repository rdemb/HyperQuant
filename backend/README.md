# Backend HyperQuant — skaner pozycji Hyperliquid

Mierzy **prawdziwą mapę likwidacji** BTC zamiast ją szacować: adresy portfeli pochodzą z publicznego strumienia transakcji
(pole `users`) i z publicznego rankingu kont Hyperliquid (zasiew 5000 największych kont co 6 h), a ich pozycje i ceny likwidacji
z publicznego `clearinghouseState`. Wykrywa też **zrealizowane likwidacje** śledzonych pozycji (potwierdzone fillami z polem `liquidation`)
i mierzy nimi precyzję mapy. Co minutę publikuje **wyłącznie agregaty i zdarzenia bez adresów**
(kubełki ceny likwidacji, pokrycie open interest, wiek danych, taśma likwidacji) — nigdy adresów ani identyfikatorów transakcji.

```
WebSocket trades + activeAssetCtx ──► książka adresów ──► harmonogram skanów ──► clearinghouseState (budżet wag)
          │ ceny (min/max na minutę)                                                 │ pozycja zmalała przy cenie likwidacji?
          └──────────────────────────────────────► kandydat ──► userFillsByTime (pole liquidation) ──► taśma likwidacji
                                                                                     │
       strona (przeglądarka) ◄── repo danych GitHub ◄── liq-map/BTC.json, liq-tape/BTC.json, status.json
```

- **Bez zależności npm.** Node ≥ 24 uruchamia TypeScript bezpośrednio (`node backend/scanner/main.ts`), `fetch` i `WebSocket` są wbudowane, podpis S3 (SigV4) jest własny i sprawdzony oficjalnym wektorem AWS.
- **Ostrożny wobec API.** Własny budżet wag (domyślnie 240 z limitu 1200/min na IP — IP bywa współdzielone z innymi usługami). Każdy kolejny błąd (429, 5xx, timeout) halvuje tempo aż do 1/8 budżetu, 429 dodatkowo wstrzymuje zapytania na 30 s; powrót stopniowy po minucie spokoju. Nieudany adres wraca do kolejki po minucie.
- **Harmonogram z udziałami.** Pozycje (50% skanów) wg spóźnienia względem celu: ≥ 1 mln USD co 2 min, ≥ 100 tys. co 10 min, inne co 30 min, a z ceną likwidacji < 1% od ceny mark co 1 min (< 3%: najwyżej co 2 min) — tam mapa musi być najświeższa; adresy, które handlowały od ostatniego odczytu lub są nowe (40%); bezpiecznik dla adresów bez pozycji raz na 24 h (10%). Pozycja BTC zmienia się tylko przez transakcję BTC, więc adres bez pozycji wraca do kolejki, gdy znów pojawi się na taśmie. Przy przeciążeniu najdłużej czekają małe pozycje — faktyczny wiek odczytów (mediana ważona nominałem) jest publikowany, a strona przy wieku > 15 min pokazuje „OPÓŹNIONE” zamiast LIVE.
- **Odporność.** WebSocket ze strażnikiem ciszy (90 s) i przerwą 1 → 60 s resetowaną dopiero po minucie stabilnego połączenia; błędy zadań (np. pełny dysk) są logowane, proces działa dalej; publikacja wstrzymana, gdy kontekst rynku (mark, OI) ma ponad 5 min.
- **Likwidacje bez zgadywania.** Hyperliquid nie publikuje strumienia likwidacji wszystkich kont (kanały likwidacji są per użytkownik, do 10 adresów). Kandydat powstaje, gdy ponowny odczyt pokazuje mniejszą pozycję, a cena z taśmy od poprzedniego odczytu weszła w pasmo jej ceny likwidacji (do 0.5% przed poziomem z mapy — likwidacja bywa wcześniejsza przy koncie cross — i dowolnie za nim); zdarzenie trafia na taśmę dopiero po potwierdzeniu fillem z polem `liquidation` (`userFillsByTime` od pierwszego dotknięcia pasma, do 3 zapytań/min i tylko przy pełnym tempie API, faktyczna waga odpowiedzi doliczana do budżetu, kandydat ważny 30 min). Deduplikacja po identyfikatorach fillów — likwidacja w kilku krokach nie jest liczona podwójnie. Taśma (24 h) i ceny na minutę przetrwają restart; ciągłość obserwacji (`since`) tylko przy przerwie < 2 min — także w WebSocket — po dłuższej obserwacja zaczyna się od nowa. Publikowane zdarzenia: czas do minuty, rozmiar do 2 cyfr znaczących, bez adresów i identyfikatorów transakcji.
- **Przepływ kohort (tylko WebSocket).** Strony każdej transakcji (pole `users`, strona agresora `side`) trafiają do kohort: market makerzy (≥ 80% nominału jako maker i ≥ 1 mln USD, wygaszanie z połową po 7 dniach), poinformowani (markout biorcy po 5 min z ceny z sekundy t + 5 min; test jednostronny na adresach z n ≥ 30, Benjamini–Hochberg q = 10%, dodatnia średnia a posteriori w empirycznym Bayesie; klasyfikacja co 10 min), wieloryby (pozycja ≥ 1 mln USD albo konto z rankingu ≥ 10 mln USD), reszta. Obserwacją testu jest blok 5 min adresu (jedno zlecenie zamiatające arkusz = jedna obserwacja), a wariancja jest konserwatywnie podwojona (horyzonty sąsiednich bloków się nakładają). Publikacja `cohorts/BTC.json`: tylko zamknięte kubełki 15 min z 24 h (kupno/sprzedaż wszystkich fillów i biorców), markouty 1/5/60 min wg kohorty z chwili transakcji (poza próbą) — tylko średnie z 24 ostatnich w pełni rozliczonych godzin, każda godzina z tą samą regułą ukrywania (bez liczności i nominału, które pozwalałyby odtwarzać ukryte godziny z publicznych sum taśmy). Prywatność: suma kohort w kubełku to publiczny wolumen, więc oprócz ukrycia komórki z < 5 uczestnikami albo z uczestnikiem > 50% obrotu ukrywane są kolejne (dla „poinformowanych” najpierw „reszta”, bo MM i wieloryby da się odtworzyć z danych publicznych; poza tym najmniejsze), aż suma ukrytych spełnia te warunki — osobno dla warstwy agresora; kwoty do 10 tys. USD, liczności do dziesiątek. Transakcje deduplikowane po (czas, tid). Statystyki per adres (z limitem 100 tys. adresów) zostają w `/var/lib/hyperquant`.
- **Rejestrator płynności arkusza.** Subskrypcja `l2Book` z agregacją dobieraną do ceny tak, by 20 poziomów pokrywało ±20 bp (4 albo 5 cyfr znaczących, mantysa 2/5; histereza, ~co 5 s): głębokość obu stron w ±10 i ±20 bp od środka, minutowe mediany w `HQ_STATE_DIR/liquidity-BTC.jsonl` (30 dni, ~130 KB/dzień, kompaktowanie przy starcie i co dobę); co 10 min profil `liquidity/BTC.json` (mediana wg godziny UTC, bieżąca vs norma, odporność). Publikowane tylko agregaty.
- **Weryfikowalny dziennik prognoz.** Co 15 min (slot UTC, bez wydawania wstecz) prognozy: kwantyle log-zwrotu na 1 h i 4 h z modelu zmienności (świece 1h/5m odświeżane co godzinę) z benchmarkiem i α ACI zapisanymi od razu oraz szanse dotknięcia PDH/PDL/D-EQ w 2 h. Rozstrzygnięcia ze świec 1m z cenami źródłowymi (`c0`/`c1` zwrotu, `hi`/`lo` okna dotknięć — do niezależnej kontroli z rynkiem; brak danych 6 h po horyzoncie → jawne `void`). Początek horyzontu = pełna minuta po faktycznym wydaniu (bez podglądania); slot bez prognozy → jawny rekord `skip` (przerwa dłuższa niż doba → jeden rekord zakresowy `slot`…`until`). Gałąź `ledger` repo danych: pliki `BTC/RRRR-MM-DD.jsonl` z łańcuchem hashy (`prev`, `hash` = SHA-256 kanonicznego JSON), commit odrzucany, jeśli nie jest czystym dopisaniem, push bez `--force`; po każdym slocie pokwitowanie OpenTimestamps głowy łańcucha (`BTC/ots/slots/RRRR-MM-DD/<slot>.ots`, ponawiane do skutku z kolejki, także po restarcie — sloty bez pliku `.ots` wracają do kolejki przy starcie), po 00:10 UTC kotwice zakończonych dni (`BTC/ots/RRRR-MM-DD.jsonl.ots`). Model vs rynek: 5–10 min przed końcem slotu migawka aktywnego 15-minutowego rynku HIP-4 na BTC (`outcomeMeta` + `l2Book` strony „Tak” + `allMids`, ~24 wag; tylko w slocie z prognozami głównymi, notowanie ≤ 30 s) i p modelu — rekord `kind: "mkt"` z osobnym pokwitowaniem `BTC/ots/slots/RRRR-MM-DD/<slot>-m.ots`, rozstrzygany ze świecy 1m w terminie. Podsumowanie `ledger/BTC/summary.json` publikowane na `main`. Zepsuty łańcuch albo klon w tyle za `origin` → dopisywanie wstrzymane. Zalecane: ochrona gałęzi `ledger` na GitHubie (blokada force-push i usunięcia). Bez HQ_GIT_REMOTE dziennik działa lokalnie w HQ_STATE_DIR.
- **Prywatność serwera.** Przeglądarki czytają publiczne repo danych, nigdy serwer skanera. Konfiguracja tylko ze zmiennych środowiskowych w pliku na serwerze.

Metodę mapy, taśmy i symulator kaskady opisują `src/utils/liqMap.ts`, `src/utils/liqTape.ts` i `src/utils/cascade.ts` (współdzielone ze stroną).

## Uruchomienie lokalne (test)

```bash
HQ_STATE_DIR=./.scanner/state HQ_OUT_DIR=./.scanner/out HQ_PUBLISH_EVERY_S=15 HQ_RUN_MINUTES=2 node backend/scanner/main.ts
```

Bez zmiennych `R2_*` pliki trafiają tylko do `HQ_OUT_DIR`. Katalog `.scanner/` jest w `.gitignore` — stan zawiera adresy portfeli i nie może trafić do repozytorium.

## Wdrożenie na serwerze (Ubuntu)

Jako root na serwerze:

```bash
curl -fsSL https://raw.githubusercontent.com/rdemb/HyperQuant/main/backend/deploy/install.sh | bash
```

albo z lokalnej kopii repo: `ssh <serwer> 'bash -s' < backend/deploy/install.sh` (stabilniej: z tagu wydania zamiast `main`). Skrypt jest idempotentny (tak samo aktualizuje):
tworzy użytkownika systemowego `hyperquant`, instaluje Node z nodejs.org (weryfikacja SHA-256), klonuje repo do `/opt/hyperquant/app`
i uruchamia usługę `hyperquant-scanner` (Nice 10, CPUQuota 50%, MemoryMax 512M, TasksMax 64, ProtectSystem=strict, filtr wywołań systemowych).
Node jest rozpakowywany jako `root:root` (`--no-same-owner`), plik z sekretami ma `0600 root:root` przy każdym uruchomieniu.
Suma SHA-256 wykrywa uszkodzenie archiwum; podpis GPG pliku sum nie jest sprawdzany.

Podgląd: `journalctl -u hyperquant-scanner -f`, wynik: `/var/lib/hyperquant/out/`.

## Publikacja do publicznego repo danych (zalecane, bez kosztów)

Skaner co 2 min wypycha jeden commit z bieżącymi plikami do publicznego repo [rdemb/hyperquant-data](https://github.com/rdemb/hyperquant-data)
(`--force`, więc repo zawsze ma tylko bieżący stan). Strona czyta `https://raw.githubusercontent.com/rdemb/hyperquant-data/main` (CORS otwarty, cache do 5 min).
Metadane commitów są neutralne (autor noreply, czas UTC) — bez nazwy hosta i strefy czasowej serwera.

1. Utwórz publiczne repo danych (np. `gh repo create <konto>/hyperquant-data --public`).
2. Na serwerze wygeneruj klucz wdrożeniowy (zostaje na serwerze):
   `sudo -u hyperquant ssh-keygen -t ed25519 -N "" -C hyperquant-data -f /var/lib/hyperquant/deploy_key`
3. Dodaj **publiczną** część jako deploy key z prawem zapisu: `gh repo deploy-key add deploy_key.pub --repo <konto>/hyperquant-data --allow-write`.
4. W `/etc/hyperquant/scanner.env`: `HQ_GIT_REMOTE=git@github.com:<konto>/hyperquant-data.git`, `HQ_GIT_SSH_KEY=/var/lib/hyperquant/deploy_key`, potem `systemctl restart hyperquant-scanner`.
5. W repozytorium strony: zmienna Actions `DATA_BASE_URL` = `https://raw.githubusercontent.com/<konto>/hyperquant-data/main` i ponowne wdrożenie.

**Nadzór (bez kosztów):** workflow [`data-health.yml`](../.github/workflows/data-health.yml) co 30 min sprawdza wiek `status.json` i mapy,
pokrycie open interest, opóźnienie odczytów pozycji oraz to, czy publikacja nie zawiera adresu portfela ani adresu IP
([scripts/check-data-health.mjs](../scripts/check-data-health.mjs)). Problem otwiera zgłoszenie z etykietą `alert-danych`
(GitHub wysyła powiadomienie), a powrót świeżych danych zamyka je automatycznie. Ręcznie: `node scripts/check-data-health.mjs`.

## Publikacja do Cloudflare R2 (opcjonalnie)

Wymaga konta Cloudflare z metodą płatności (darmowy limit: 10 GB, 1 mln zapisów, 10 mln odczytów miesięcznie).

1. Cloudflare → R2 → **Create bucket** (np. `hyperquant-data`).
2. Publiczny odczyt: **Settings → Custom Domains** (z CDN) albo **Public Development URL** (`*.r2.dev`, z limitami ruchu).
   **Prywatność serwera:** nie używaj domeny ze strefy Cloudflare, w której jest też serwer skanera — DNS mógłby powiązać stronę z serwerem. Bezpiecznie: `*.r2.dev` albo osobna domena.
3. **Settings → CORS Policy**:
   ```json
   [{ "AllowedOrigins": ["https://rdemb.github.io", "http://localhost:3000"], "AllowedMethods": ["GET"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600 }]
   ```
4. R2 → **Manage API Tokens → Create API Token**: uprawnienie *Object Read & Write*, tylko ten bucket.
5. Na serwerze uzupełnij `/etc/hyperquant/scanner.env` (`R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) i `systemctl restart hyperquant-scanner`.
6. W repozytorium GitHub: **Settings → Secrets and variables → Actions → Variables** → `DATA_BASE_URL` = publiczny adres bucketu (bez `/` na końcu). Następny build strony zacznie czytać mapę.
