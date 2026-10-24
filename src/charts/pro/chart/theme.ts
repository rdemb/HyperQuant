import { ColorType, CrosshairMode, LineStyle, TickMarkType } from 'lightweight-charts';
import type { ChartOptions, DeepPartial, Time } from 'lightweight-charts';
import type { HeatRamp } from '../../orderflow/heatColor';
import { C, MONO, rgba } from '../../orderflow/renderer';
import { fmtHm, fmtHms } from '../core/time';

/** Wygląd wykresu Pro: tokeny projektu (src/index.css), oś czasu w czasie lokalnym, polskie skróty miesięcy. */

const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

/**
 * Kolory płótna wykresu Pro w stylu terminali orderflow: bardzo ciemne granatowo-fioletowe tło bez siatki,
 * kupno w neonowej zieleni, sprzedaż w fiolecie, nierównowagi w cyjanie i magencie, żółta ramka POC,
 * pomarańczowy wolumen. Te same wartości są tokenami `of-*` w src/index.css (legenda i menu).
 * Gotowe napisy z kryciem — bez budowania w pętli rysowania.
 */
export const PRO = {
  ...C,
  bg: '#151521',
  cross: rgba(C.ink2, 0.5),
  axisText: '#d8dadc',
  buy: '#10ff21',
  sell: '#8a2be2',
  buyInk: '#3dff4f',
  sellInk: '#a66bff',
  buyWick: '#10ff21',
  sellWick: '#8a2be2',
  volBuy: rgba('#10ff21', 0.42),
  volSell: rgba('#8a2be2', 0.62),
  priceLine: '#2f8088',
  vwap: '#d0d3d9',
  svwap: '#14c8c8',
  va: rgba(C.ink2, 0.55),
  warn: '#fab219',
  partial: rgba('#fab219', 0.85),
  // Footprint: kafle komórek od szarości (mały wolumen) do nasyconego koloru strony, ciemne liczby
  fpNeutral: '#a0a0a0',
  fpBidRamp: ['#a0a0a0', '#a392b5', '#8d6fad', '#7a48aa', '#6725a3'],
  fpAskRamp: ['#a0a0a0', '#8ab88b', '#61b861', '#33b934', '#11b920'],
  // Delta wiersza: dodatnia niebieska, ujemna czerwona
  fpDeltaPosRamp: ['#a0a0a0', '#8a8bb9', '#6161b9', '#4a4ab8', '#3333b8'],
  fpDeltaNegRamp: ['#a0a0a0', '#b88a8a', '#b96161', '#b94a4b', '#b93234'],
  fpText: '#111326',
  fpTextLight: '#f2f3f5',
  fpTextProfile: '#d1dee5',
  fpRowLine: '#434343',
  imbBuy: '#00ffff',
  imbSell: '#ff00ff',
  pocFrame: '#ffff20',
  volBar: '#d08a10',
  deltaPosBar: '#159a10',
  deltaNegBar: '#4b1d80',
  // Profile wolumenu: obszar wartości szary, reszta przytłumiona szaromorska, POC pomarańczowy, nagi POC szary
  profileVa: '#555557',
  profileOut: '#3c6265',
  profilePoc: '#c58109',
  nakedPoc: '#5c6166',
  // Drabina DOM: aski fioletowe nad ceną, bidy zielone pod nią
  domBid: '#06af23',
  domAsk: '#8a2be2',
  domText: '#e4e6ea',
  // Giełdy w panelach „CVD giełd” i „ΔOI giełd” (paleta kategorii sprawdzona na tle wykresu, także dla daltonistów)
  venueHl: '#199e70',
  venueBinance: '#d95926',
  venueBybit: '#3987e5',
} as const;

/**
 * Rampa mapy ciepła arkusza: przezroczysty → ciemny morski (półprzezroczysty, świece widać przez niego) → jasny morski
 * (pasy płynności) → biel → żółty → pomarańcz → czerwień (ściany).
 */
export const LIQ_RAMP: HeatRamp = [
  { t: 0, color: '#151521', alpha: 0 },
  { t: 0.12, color: '#172526', alpha: 0.35 },
  { t: 0.28, color: '#124950', alpha: 0.55 },
  { t: 0.42, color: '#0d5c67', alpha: 0.7 },
  { t: 0.55, color: '#017979', alpha: 0.85 },
  { t: 0.68, color: '#c9e0eb', alpha: 1 },
  { t: 0.78, color: '#f5e611', alpha: 1 },
  { t: 0.86, color: '#f8c30c', alpha: 1 },
  { t: 0.94, color: '#f5620f', alpha: 1 },
  { t: 1, color: '#f5290d', alpha: 1 },
];

const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Rampa n + 1 nieprzezroczystych kolorów przez równo rozłożone punkty `stops` (bez budowania napisów w pętli rysowania). */
export function mixRamp(stops: readonly string[], n: number): string[] {
  const rgb = stops.map(hexRgb);
  return Array.from({ length: n + 1 }, (_, i) => {
    const u = (i / n) * (rgb.length - 1);
    const k = Math.min(rgb.length - 2, Math.floor(u));
    const f = u - k;
    const m = (c: number) => Math.round(rgb[k][c] + (rgb[k + 1][c] - rgb[k][c]) * f);
    return `rgb(${m(0)},${m(1)},${m(2)})`;
  });
}

/** Jasność względna koloru `rgb(r,g,b)` albo `#rrggbb` (WCAG) — wybór ciemnych albo jasnych liczb na kaflu. */
export function luminance(color: string): number {
  const v = color.startsWith('#') ? hexRgb(color) : (color.match(/\d+/g) ?? []).slice(0, 3).map(Number);
  const lin = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(v[0]) + 0.7152 * lin(v[1]) + 0.0722 * lin(v[2]);
}

export { MONO, rgba };

/** Odstęp najnowszej świecy od osi ceny (px), ten sam przy każdym zbliżeniu. */
export const RIGHT_GAP_PX = 48;
/** Szerokość drabiny DOM (arkusz na żywo) przy prawej krawędzi panelu ceny, gdy mapa ciepła jest włączona. */
export const DOM_W_PX = 64;

const unix = (time: Time) => (time as number) * 1000;

/** Etykiety osi czasu (czas lokalny przeglądarki). */
export function tickMarkFormatter(time: Time, type: TickMarkType): string {
  const t = unix(time);
  const d = new Date(t);
  switch (type) {
    case TickMarkType.Year:
      return String(d.getFullYear());
    case TickMarkType.Month:
      return MONTHS[d.getMonth()];
    case TickMarkType.DayOfMonth:
      return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
    case TickMarkType.TimeWithSeconds:
      return fmtHms(t);
    default:
      return fmtHm(t);
  }
}

/** Etykieta czasu na krzyżu (czas lokalny). */
export function crosshairTimeFormatter(time: Time): string {
  const t = unix(time);
  const d = new Date(t);
  const wd = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'][d.getDay()];
  return `${wd} ${d.getDate()} ${MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}  ${fmtHm(t)}`;
}

export function chartOptions(): DeepPartial<ChartOptions> {
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: PRO.bg },
      textColor: PRO.axisText,
      fontSize: 11,
      fontFamily: MONO,
      // Logo TradingView zostaje — wymaga go licencja biblioteki (link do tradingview.com)
      attributionLogo: true,
      panes: { separatorColor: C.divider, separatorHoverColor: rgba(C.ink3, 0.18), enableResize: true },
    },
    // Bez siatki: poziomy wyznaczają komórki footprintu i wskaźniki
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: PRO.cross, style: LineStyle.Solid, width: 1, labelBackgroundColor: C.tip },
      horzLine: { color: PRO.cross, style: LineStyle.Solid, width: 1, labelBackgroundColor: C.tip },
    },
    rightPriceScale: { borderColor: C.grid, scaleMargins: { top: 0.06, bottom: 0.06 } },
    timeScale: {
      borderColor: C.grid,
      timeVisible: true,
      secondsVisible: false,
      rightOffsetPixels: RIGHT_GAP_PX,
      // Zbliżenie kółkiem zachowuje odstęp najnowszej świecy od osi (inaczej rośnie razem z odstępem świec)
      rightBarStaysOnScroll: true,
      barSpacing: 9,
      minBarSpacing: 0.6,
      // Przy największym zbliżeniu komórki footprintu z kolumnami delty i wolumenu wciąż mieszczą kilka świec
      maxBarSpacing: 240,
      tickMarkFormatter,
    },
    localization: { locale: 'pl-PL', timeFormatter: crosshairTimeFormatter },
  };
}
