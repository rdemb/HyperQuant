# Etap 3a: prawdziwa mapa likwidacji i symulator kaskady — projekt

Data: 2026-10-22 · Status: zatwierdzone przez właściciela (zgoda na backend na VPS, kanał publikacji: Cloudflare R2).

## Po co

Desk dziś pokazuje **syntetyczną** heatmapę likwidacji (ekstrema świec × założone dźwignie 5/20/100×). Na Hyperliquid pozycje
i ceny likwidacji każdego portfela są publiczne (`clearinghouseState`), a każda transakcja ma adresy obu stron — mapę można
**zmierzyć**. To przewaga, której nie mają narzędzia oparte na giełdach scentralizowanych (CoinGlass i podobne szacują).
Na mapie stoi symulator kaskady: ile ruchu ceny dodają likwidacje uruchamiane przez szok.

## Cele

1. **Skaner pozycji (backend, VPS):** adresy z WebSocketu `trades` BTC (pole `users`), odpytywanie `clearinghouseState`
   według harmonogramu zależnego od wielkości pozycji, własny budżet wag API (domyślnie 240/min z limitu 1200/min/IP —
   ten sam IP obsługuje inne usługi właściciela), wycofanie przy 429/5xx.
2. **Mapa likwidacji (czysta funkcja współdzielona przez backend i stronę):** kubełki ceny likwidacji (stały krok USD),
   osobno longi i shorty, nominał przy cenie likwidacji, **pokrycie OI** (Σ|szi| / (2·OI)), wiek danych (p50/p90).
   Publikowane są **wyłącznie agregaty** — żadnych adresów.
3. **Publikacja:** co 60 s `liq-map/BTC.json` i `status.json` do Cloudflare R2 (SigV4 bez zależności, `Cache-Control: max-age=30`);
   bez konfiguracji R2 — zapis lokalny. Przeglądarka nigdy nie łączy się z VPS.
4. **Symulator kaskady (strona):** szok δ → likwidacje z mapy z ceną po złej stronie → zlecenia rynkowe → wpływ ceny z prawa
   pierwiastka kwadratowego (Tóth i in. 2011; Bouchaud i in. 2018) `Δp/p = Y·σ_d·√(Q/V_d)` → nowe likwidacje → punkt stały.
   Wynik: krzywa wzmocnienia A(δ) = ruch końcowy / szok dla δ ∈ [−5%, +5%], pasmo dla Y ∈ {0.5, 1, 1.5} (Y = 1 to założenie
   z literatury, oznaczone). Wpływ szczytowy (bez wygaszania) — górna granica.
5. **UI:** panel „Mapa likwidacji (pozycje on-chain)” z histogramem wokół ceny, pokryciem OI, wiekiem danych, klastrami
   i krzywą A(δ); w Analizatorze ostrzeżenie, gdy stop leży w klastrze likwidacji (ryzyko przestrzelenia). Bez danych
   (brak konfiguracji, dane > 10 min) — „—” i syntetyczna heatmapa zostaje oznaczona jako szacunek.
6. **Wdrożenie na VPS:** użytkownik systemowy `hyperquant`, Node 24 LTS z oficjalnego archiwum (weryfikacja SHA-256),
   kod z publicznego repo, usługa systemd z ograniczeniami (MemoryMax 512M, CPUQuota 50%, Nice 10, ProtectSystem=strict).
   Sekrety R2 tylko w `/etc/hyperquant/scanner.env` na VPS (wpisuje właściciel).

## Poza zakresem (3b i dalej)

Kohorty portfeli i markouty, wnioskowane likwidacje (taśma), rekorder historii L2, węzeł L4, walidacja kaskady na 10.10.2025.

## Ograniczenia twarde

- Żadnych danych VPS (adres, host, alias SSH, użytkownik, ścieżki konfiguracyjne właściciela, klucze) w repo, commitach, PR i na stronie.
- Nie czytamy i nie dotykamy usług ani danych innych projektów na VPS.
- Backend bez zależności npm (Node 24: wbudowane `fetch`, `WebSocket`, uruchamianie TypeScriptu); kod współdzielony z UI bez importów zewnętrznych.
- Cena likwidacji pozycji cross zależy od całego konta i zmienia się z ceną innych aktywów — oznaczone w UI.
- Likwidacje HL: zlecenia rynkowe do arkusza, pozycje > 100k USDC po 20% na blok z 30 s przerwą, przejęcie przez Liquidator Vault
  poniżej 2/3 depozytu utrzymaniowego — symulator zakłada pełne trafienie w arkusz (górna granica).
