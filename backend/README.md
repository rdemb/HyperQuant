# Backend HyperQuant — skaner pozycji Hyperliquid

Mierzy **prawdziwą mapę likwidacji** BTC zamiast ją szacować: adresy portfeli pochodzą z publicznego strumienia transakcji
(pole `users`), a ich pozycje i ceny likwidacji z publicznego `clearinghouseState`. Co minutę publikuje **wyłącznie agregaty**
(kubełki ceny likwidacji, pokrycie open interest, wiek danych) — nigdy adresów.

```
WebSocket trades + activeAssetCtx ──► książka adresów ──► harmonogram skanów ──► clearinghouseState (budżet wag)
                                                                                     │
                         strona (przeglądarka) ◄── Cloudflare R2 ◄── liq-map/BTC.json, status.json
```

- **Bez zależności npm.** Node ≥ 24 uruchamia TypeScript bezpośrednio (`node backend/scanner/main.ts`), `fetch` i `WebSocket` są wbudowane, podpis S3 (SigV4) jest własny i sprawdzony oficjalnym wektorem AWS.
- **Ostrożny wobec API.** Własny budżet wag (domyślnie 240 z limitu 1200/min na IP), połowa tempa przez 5 min po odpowiedzi 429.
- **Harmonogram.** Nowy adres od razu; pozycja ≥ 1 mln USD co 2 min, ≥ 100 tys. co 10 min, inna co 30 min, bez pozycji co 2 h; adresy bez pozycji nieaktywne > 3 dni są usuwane.
- **Prywatność serwera.** Przeglądarki czytają publiczny bucket R2, nigdy serwer skanera. Konfiguracja tylko ze zmiennych środowiskowych w pliku na serwerze.

Metodę mapy i symulator kaskady opisują `src/utils/liqMap.ts` i `src/utils/cascade.ts` (współdzielone ze stroną).

## Uruchomienie lokalne (test)

```bash
HQ_STATE_DIR=./.scanner/state HQ_OUT_DIR=./.scanner/out HQ_PUBLISH_EVERY_S=15 HQ_RUN_MINUTES=2 node backend/scanner/main.ts
```

Bez zmiennych `R2_*` pliki trafiają tylko do `HQ_OUT_DIR`.

## Wdrożenie na serwerze (Ubuntu)

Jako root na serwerze:

```bash
curl -fsSL https://raw.githubusercontent.com/rdemb/HyperQuant/main/backend/deploy/install.sh | bash
```

albo z lokalnej kopii repo: `ssh <serwer> 'bash -s' < backend/deploy/install.sh`. Skrypt jest idempotentny (tak samo aktualizuje):
tworzy użytkownika systemowego `hyperquant`, instaluje Node z nodejs.org (weryfikacja SHA-256), klonuje repo do `/opt/hyperquant/app`
i uruchamia usługę `hyperquant-scanner` (Nice 10, CPUQuota 50%, MemoryMax 512M, ProtectSystem=strict).

Podgląd: `journalctl -u hyperquant-scanner -f`, wynik: `/var/lib/hyperquant/out/`.

## Publikacja do Cloudflare R2

1. Cloudflare → R2 → **Create bucket** (np. `hyperquant-data`).
2. Publiczny odczyt: **Settings → Custom Domains** (zalecane, z CDN) albo **Public Development URL** (`*.r2.dev`, z limitami — do testów).
3. **Settings → CORS Policy**:
   ```json
   [{ "AllowedOrigins": ["https://rdemb.github.io", "http://localhost:3000"], "AllowedMethods": ["GET"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600 }]
   ```
4. R2 → **Manage API Tokens → Create API Token**: uprawnienie *Object Read & Write*, tylko ten bucket.
5. Na serwerze uzupełnij `/etc/hyperquant/scanner.env` (`R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) i `systemctl restart hyperquant-scanner`.
6. W repozytorium GitHub: **Settings → Secrets and variables → Actions → Variables** → `DATA_BASE_URL` = publiczny adres bucketu (bez `/` na końcu). Następny build strony zacznie czytać mapę.
