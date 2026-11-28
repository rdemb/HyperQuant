# Node Hyperliquid dla HyperQuant

Własny node bez walidacji (non-validator) daje skanerowi pełny stan giełdy zamiast odpytywania publicznego API: likwidacje
wszystkich kont, arkusz na poziomie zleceń z właścicielami (pełna głębokość) i lokalne `/info` bez publicznych limitów.
Źródło: [github.com/hyperliquid-dex/node](https://github.com/hyperliquid-dex/node) i „L1 data schemas” w dokumentacji Hyperliquid.

## Wymagania (dokumentacja noda)

| | |
|---|---|
| System | tylko Ubuntu 24.04 |
| Sprzęt | 16 vCPU, 128 GB RAM, 500 GB SSD |
| Sieć | porty 4001 i 4002 (gossip) publicznie otwarte; najniższe opóźnienie w Tokio |
| Dysk | ok. 100 GB danych dziennie przy domyślnych ustawieniach — rotacja co godzinę (`hyperliquid-prune.timer`) |

## Instalacja

```bash
sudo ./install-node.sh            # Mainnet; CHAIN=Testnet dla sieci testowej
journalctl -u hyperliquid-node -f # „applied block …” = strumień na żywo
```

Skrypt jest idempotentny. `hl-visor` jest weryfikowany podpisem GPG z przypiętym odciskiem klucza Hyperliquid
(`CF2C 2EA3 DC3E 8F04 2A55 FB65 0325 4A93 49F1 820B`); inny klucz albo zły podpis przerywa instalację. Węzły startowe
(`override_gossip_config.json`) pochodzą z publicznego `gossipRootIps`. Zapora: 4001–4002 otwarte, lokalne `/info`
(port 3001) tylko z localhost.

## Dane (flagi w `hyperliquid-node.service`)

| Flaga | Katalog `~/hl/data/…` | Do czego w HyperQuant |
|---|---|---|
| `--write-fills` | `node_fills/hourly/<data>/<godzina>` | taśma z adresami obu stron, pozycje kont z każdego wypełnienia (`startPosition`), TWAP |
| `--write-misc-events` | `misc_events/hourly/…` | likwidacje wszystkich kont (dziś skaner widzi tylko śledzone), finansowanie, wpłaty i wypłaty |
| `--write-raw-book-diffs` | `node_raw_book_diffs/hourly/…` | arkusz L4: pełna głębokość, właściciel ściany, zjedzona czy zdjęta, miejsce w kolejce |
| `--serve-info` | `localhost:3001/info` | `clearinghouseState` dla każdego aktywnego konta bez publicznych limitów (mapa likwidacji) |

`l2Book` nie jest obsługiwane lokalnie — przeglądarki dalej pobierają je z publicznego API.

## Integracja ze skanerem (stan)

- **Gotowe:** parsery rekordów (`backend/node/records.ts`: wypełnienia, likwidacje, linie blokowe) i arkusz L4
  (`backend/node/l4book.ts`) z testami na schematach z dokumentacji.
- **Po uruchomieniu noda:** potwierdzenie formatów na prawdziwych plikach, czytnik plików godzinowych na bieżąco, przepięcie
  odczytów pozycji skanera na lokalne `/info`, taśma likwidacji z `misc_events`, publikacja przez przekaźnik `workers/live`.
  Skaner powinien działać na tej samej maszynie (czyta pliki noda lokalnie).
