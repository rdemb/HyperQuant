# Backend HyperQuant — skaner pozycji Hyperliquid

Mierzy **prawdziwą mapę likwidacji** BTC zamiast ją szacować: adresy portfeli pochodzą z publicznego strumienia transakcji
(pole `users`) i z publicznego rankingu kont Hyperliquid (zasiew 5000 największych kont co 6 h), a ich pozycje i ceny likwidacji
z publicznego `clearinghouseState`. Co minutę publikuje **wyłącznie agregaty**
(kubełki ceny likwidacji, pokrycie open interest, wiek danych) — nigdy adresów.

```
WebSocket trades + activeAssetCtx ──► książka adresów ──► harmonogram skanów ──► clearinghouseState (budżet wag)
                                                                                     │
                         strona (przeglądarka) ◄── repo danych GitHub ◄── liq-map/BTC.json, status.json
```

- **Bez zależności npm.** Node ≥ 24 uruchamia TypeScript bezpośrednio (`node backend/scanner/main.ts`), `fetch` i `WebSocket` są wbudowane, podpis S3 (SigV4) jest własny i sprawdzony oficjalnym wektorem AWS.
- **Ostrożny wobec API.** Własny budżet wag (domyślnie 240 z limitu 1200/min na IP — IP bywa współdzielone z innymi usługami). Każdy kolejny błąd (429, 5xx, timeout) halvuje tempo aż do 1/8 budżetu, 429 dodatkowo wstrzymuje zapytania na 30 s; powrót stopniowy po minucie spokoju. Nieudany adres wraca do kolejki po minucie.
- **Harmonogram z udziałami.** Pozycje (50% skanów) wg spóźnienia względem celu: ≥ 1 mln USD co 2 min, ≥ 100 tys. co 10 min, inne co 30 min; adresy, które handlowały od ostatniego odczytu lub są nowe (40%); bezpiecznik dla adresów bez pozycji raz na 24 h (10%). Pozycja BTC zmienia się tylko przez transakcję BTC, więc adres bez pozycji wraca do kolejki, gdy znów pojawi się na taśmie. Przy przeciążeniu najdłużej czekają małe pozycje — faktyczny wiek odczytów (mediana ważona nominałem) jest publikowany, a strona przy wieku > 15 min pokazuje „OPÓŹNIONE” zamiast LIVE.
- **Odporność.** WebSocket ze strażnikiem ciszy (90 s) i przerwą 1 → 60 s resetowaną dopiero po minucie stabilnego połączenia; błędy zadań (np. pełny dysk) są logowane, proces działa dalej; publikacja wstrzymana, gdy kontekst rynku (mark, OI) ma ponad 5 min.
- **Prywatność serwera.** Przeglądarki czytają publiczny bucket R2, nigdy serwer skanera. Konfiguracja tylko ze zmiennych środowiskowych w pliku na serwerze.

Metodę mapy i symulator kaskady opisują `src/utils/liqMap.ts` i `src/utils/cascade.ts` (współdzielone ze stroną).

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
