/**
 * Wejścia Czwórki z magazynu rynku wykresu (`candlesFrom` jak nagłówek układu). Same cztery liczby — paliwo ±1% (stan mapy
 * likwidacji i wiek migawki skanera jak w legendzie) i odległość od VWAP (liczba z nagłówka Kokpitu) też — są w
 * `utils/fourNumbers` bez modułów wykresu (te same funkcje liczy serwer MCP); tu re-eksport w dawnym miejscu.
 */
import { type InputStore, candlesFrom, seriesCandles } from '../../charts/pro/chart/layoutInputs';
import type { Candle } from '../../charts/pro/hl/parse';
import type { BlogMapsState } from '../../state/useBlogMaps';
import { capsOf, chartMarkets } from '../../state/markets';
import { type VBar, toVBars } from '../../utils/auction';
import { dayVwapOf } from '../../utils/dayVwap';
import { type FourInputs, lastClosedNy, nextSessionHour, nyMap, sessionHourSamples } from '../../utils/fourNumbers';
import { mapWindow } from '../../utils/mapSettlement';
import { type Got, isAbsent } from '../../utils/sessionText';

export { fourNumbers, fuelNum, vwapFour } from '../../utils/fourNumbers';

const vbars = (c: Got<readonly Candle[]> | undefined): Got<readonly VBar[]> | undefined => (c === undefined || isAbsent(c) ? c : toVBars(c));

/**
 * Wejścia Czwórki z magazynu rynku wykresu (jak nagłówek układu): świece 1m od otwarcia ostatniej sesji NY, a z mapą z bloga
 * (BTC) od jej wpisu, jeśli wcześniej; świece 1h od najwcześniejszej próby typowej szerokości godziny (seria doczytuje starsze
 * strony, do tego czasu — undefined); VWAP doby ze świec 1m już wczytanych (jak Kokpit, bez czekania na starsze strony).
 */
export function readFourInputs(store: InputStore, liq: FourInputs['liq'], maps: BlogMapsState): FourInputs {
  const now = store.serverNow();
  const lp = store.lastPrice();
  const ny = lastClosedNy(now);
  const m = capsOf(store.coin).blog && maps.status === 'ready' ? nyMap(maps.maps, ny, now) : null;
  const w = m && mapWindow(m.kind, m.publishedAt);
  const at = nextSessionHour(now);
  const live = seriesCandles(store, '1m', now);
  return {
    coin: store.coin,
    markets: chartMarkets(),
    now,
    price: lp > 0 ? lp : undefined,
    bars1m: vbars(candlesFrom(store, '1m', w ? Math.min(ny.start, w.from) : ny.start, now)),
    maps,
    liq,
    bars1h: vbars(candlesFrom(store, '1h', Math.min(at.hour, ...sessionHourSamples(at)), now)),
    dayVwap: live === undefined || isAbsent(live) ? live : dayVwapOf(live, now),
  };
}
