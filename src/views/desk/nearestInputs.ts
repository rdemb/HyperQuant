/**
 * Wejścia panelu „Najbliższe poziomy” z magazynu rynku wykresu (jak Czwórka i nagłówek układu): świece dzienne magazynu
 * (te same co poziomy dnia na wykresie), świece 1m od 00:00 UTC (VWAP doby, IB, zakres Azji; seria doczytuje starsze
 * strony), 1h (profil wczorajszej doby, jak nagłówek Mapy dnia) i 5m (ATR). Same liczby — w `utils/nearestLevels`.
 */
import { type InputStore, candlesFrom, seriesCandles } from '../../charts/pro/chart/layoutInputs';
import { utcDayStart } from '../../charts/pro/core/sessions';
import type { Candle } from '../../charts/pro/hl/parse';
import { capsOf, marketOf, noScannerWhyOf } from '../../state/markets';
import type { LevelInputs } from '../../utils/nearestLevels';

/** Magazyn rynku (ProStore) z polami czytanymi przez panel; opisany strukturalnie, więc test podaje atrapę. */
export type LevelStore = InputStore & { daily: readonly Candle[] };

export function readLevelInputs(store: LevelStore, scan: Pick<LevelInputs, 'liq' | 'entry' | 'ledger'>): LevelInputs {
  const now = store.serverNow();
  const lp = store.lastPrice();
  const caps = capsOf(store.coin);
  return {
    coin: store.coin,
    now,
    szDecimals: marketOf(store.coin)?.szDecimals,
    price: lp > 0 ? lp : undefined,
    scanner: caps.scanner,
    forecasts: caps.forecasts,
    noScannerWhy: noScannerWhyOf(store.coin),
    // Świece dzienne magazyn pobiera raz na dobę UTC; do tego czasu pusta lista
    daily: store.daily.length > 0 ? store.daily : undefined,
    c1m: candlesFrom(store, '1m', utcDayStart(now), now),
    c1h: seriesCandles(store, '1h', now),
    c5m: seriesCandles(store, '5m', now),
    ...scan,
  };
}
