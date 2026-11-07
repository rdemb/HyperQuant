/**
 * Czwórka z danych wykresu: liczby (2) paliwo ±1% (stan mapy likwidacji i wiek migawki skanera jak w legendzie) i (4)
 * odległość od VWAP (liczba z nagłówka Kokpitu) oraz wejścia z magazynu rynku (`candlesFrom` jak nagłówek układu).
 * Czysta logika Czwórki bez modułów wykresu jest w `utils/fourNumbers`.
 */
import { tr } from '../../i18n';
import { DASH, fmtCompact, fmtFixed } from '../../ui/format';
import { liqScan, scannerAge } from '../../charts/pro/chart/layerSources';
import { type InputStore, candlesFrom, seriesCandles } from '../../charts/pro/chart/layoutInputs';
import { dayVwapOf, vwapNum } from '../../charts/pro/chart/layoutNumbers';
import { fmtPx } from '../../charts/pro/core/footprintBar';
import { fmtHm } from '../../charts/pro/core/time';
import type { Candle } from '../../charts/pro/hl/parse';
import type { BlogMapsState } from '../../state/useBlogMaps';
import { type VBar, toVBars } from '../../utils/auction';
import {
  FUEL_BAND,
  type FourInputs,
  type FourNumber,
  type FourNumbers,
  clarityNum,
  gotValue,
  gotWhy,
  hourWidthNum,
  lastClosedNy,
  liqFuel,
  nextSessionHour,
  nyMap,
  sessionHourSamples,
} from '../../utils/fourNumbers';
import { mapWindow } from '../../utils/mapSettlement';
import { type Got, WAIT_TEXT, isAbsent } from '../../utils/sessionText';

/** (2) Paliwo 1% pod i nad ceną z mapy likwidacji skanera: LIVE, po 2 min wiek migawki; poza BTC „—, tylko BTC”. */
export function fuelNum(x: FourInputs): FourNumber {
  const base = { id: 'fuel', title: tr('Paliwo ±1%', 'Fuel ±1%'), badge: 'LIVE' } as const;
  if (x.coin !== 'BTC') return { ...base, value: DASH, note: tr('tylko BTC', 'BTC only'), hint: tr('Tylko BTC: skaner mapuje pozycje na BTC', 'BTC only: the scanner maps BTC positions') };
  const ls = liqScan(x.liq);
  const map = x.liq.map;
  if ('why' in ls || !map) return { ...base, value: DASH, hint: 'why' in ls ? ls.why : WAIT_TEXT };
  const p = gotValue(x.price);
  if (p === null || !(p > 0)) return { ...base, value: DASH, hint: gotWhy(x.price) };
  const { below, above } = liqFuel(map, p);
  const delayed = x.liq.status === 'delayed';
  const note = scannerAge(map.asOf, x.now) ?? (delayed ? tr('opóźnione', 'delayed') : null);
  const late = delayed ? tr(' Połowa nominału z odczytów pozycji starszych niż 15 min — klastry mogły się przesunąć.', ' Half of the notional comes from position reads older than 15 min, so clusters may have moved.') : '';
  const share = `${fmtFixed(map.coverage.share * 100, 0)}%`;
  return {
    ...base,
    value: `${tr('pod', 'below')} ${fmtCompact(below)} · ${tr('nad', 'above')} ${fmtCompact(above)}`,
    hint: tr(
      `Mapa likwidacji skanera z pozycji on-chain Hyperliquid, stan z ${fmtHm(map.asOf)}: w 1% pod ceną ${fmtPx(p)} (do ${fmtPx(p * (1 - FUEL_BAND))}) ${fmtCompact(below)} USD likwidacji, w 1% nad nią (do ${fmtPx(p * (1 + FUEL_BAND))}) ${fmtCompact(above)} USD. Longi i shorty razem, po cenie kubełka; tylko pozycje śledzone przez skaner (${share} open interest).${late}`,
      `The scanner's liquidation map from Hyperliquid on-chain positions, as of ${fmtHm(map.asOf)}: within 1% below the price ${fmtPx(p)} (to ${fmtPx(p * (1 - FUEL_BAND))}) ${fmtCompact(below)} USD of liquidations, within 1% above it (to ${fmtPx(p * (1 + FUEL_BAND))}) ${fmtCompact(above)} USD. Longs and shorts together, by bucket price; only positions tracked by the scanner (${share} of open interest).${late}`
    ),
    ...(note ? { note } : {}),
  };
}

/** (4) Cena wobec VWAP doby UTC w σ — liczba z nagłówka Kokpitu (`vwapNum`), z tytułem Czwórki. */
export function vwapFour(x: FourInputs): FourNumber {
  const n = vwapNum({ coin: x.coin, now: x.now, price: x.price, dayVwap: x.dayVwap });
  return { id: 'vwap', title: tr('Od VWAP', 'From VWAP'), value: n.value, badge: n.badge, hint: n.hint };
}

/** Cztery liczby Czwórki (zawsze cztery, brak danych — „—” z powodem). */
export function fourNumbers(x: FourInputs): FourNumbers {
  return { coin: x.coin, now: x.now, items: [clarityNum(x), fuelNum(x), hourWidthNum(x), vwapFour(x)] };
}

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
  const m = store.coin === 'BTC' && maps.status === 'ready' ? nyMap(maps.maps, ny, now) : null;
  const w = m && mapWindow(m.kind, m.publishedAt);
  const at = nextSessionHour(now);
  const live = seriesCandles(store, '1m', now);
  return {
    coin: store.coin,
    now,
    price: lp > 0 ? lp : undefined,
    bars1m: vbars(candlesFrom(store, '1m', w ? Math.min(ny.start, w.from) : ny.start, now)),
    maps,
    liq,
    bars1h: vbars(candlesFrom(store, '1h', Math.min(at.hour, ...sessionHourSamples(at)), now)),
    dayVwap: live === undefined || isAbsent(live) ? live : dayVwapOf(live, now),
  };
}
