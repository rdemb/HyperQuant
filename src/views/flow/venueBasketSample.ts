// Publiczna próbka koszyka giełd (pakiet 6), wejście z odbioru Astry: integracja/odbior-astra/minuty-publiczne.json (22.11.2026).
// Wartości w jednostce 0,00001 BTC jako tekst (bigint). Źródła: pliki publiczne z sumami SHA-256; aplikacja nie łączy się tu z giełdami.
export const VENUE_BASKET_SAMPLE = {
  "revision": "btc-hl-bnusdm-20261120-v1",
  "scope": "BTC-perp",
  "unit": "BTC",
  "scale": 5,
  "sources": {
    "trades": {
      "url": "https://raw.githubusercontent.com/rdemb/hyperquant-data/d5441197494010261f41c22accaf8c10f6d7949e/BTC/2026-11-20/07.trades.json.gz",
      "sha256": "05863db150305b9231887eb4fdab9ad9a913425ac0962e4c509934d2d06ab083"
    },
    "candles": {
      "url": "https://raw.githubusercontent.com/rdemb/hyperquant-data/24574bd0b96abf324c16f923df1dbc88757e9ea9/BTC/1m/2026/11-20.csv",
      "sha256": "15478538e6ad81394d42207a6a8c19112a773bab0c83fc9dd17c3956113a6d2b"
    },
    "binance": {
      "url": "https://data.binance.vision/data/futures/um/daily/klines/BTCUSDT/1m/BTCUSDT-1m-2026-11-20.zip",
      "sha256": "967651c78d2fe0e1786dd56127803de2f26e5f6e961c8232ac29f6a709046d91"
    }
  },
  "minutes": [
    {
      "from": 1795159200000,
      "hyperliquid": {
        "market": "BTC",
        "volume": "2850277",
        "buy": "277627"
      },
      "binance": {
        "market": "BTCUSDT",
        "volume": "4097600",
        "buy": "1869000"
      }
    },
    {
      "from": 1795159260000,
      "hyperliquid": {
        "market": "BTC",
        "volume": "1944282",
        "buy": "405410"
      },
      "binance": {
        "market": "BTCUSDT",
        "volume": "5629600",
        "buy": "3065200"
      }
    }
  ]
} as const;
