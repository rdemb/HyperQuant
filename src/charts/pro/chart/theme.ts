import { ColorType, CrosshairMode, LineStyle, TickMarkType } from 'lightweight-charts';
import type { ChartOptions, DeepPartial, Time } from 'lightweight-charts';
import type { HeatRamp } from '../../orderflow/heatColor';
import { C, MONO, rgba } from '../../orderflow/renderer';
import { fmtHm, fmtHms } from '../core/time';

/** Wygląd wykresu Pro: tokeny projektu (src/index.css), oś czasu w czasie lokalnym, polskie skróty miesięcy. */

const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

/**
 * Kolory płótna wykresu Pro, paleta HyperQuant „Desk”: morska zieleń kupna i miedź sprzedaży na granatowym tle Desku.
 * Te same wartości są tokenami `of-*` w src/index.css (legenda i menu).
 * Gotowe napisy z kryciem — bez budowania w pętli rysowania.
 */
export const PRO = {
  ...C,
  bg: '#0b1019',
  cross: rgba(C.ink2, 0.5),
  axisText: '#c3ccd8',
  // Świece: korpusy i knoty
  buy: '#19a88e',
  sell: '#d9582e',
  buyWick: '#19a88e',
  sellWick: '#d9582e',
  // Kierunek przepływu w liczbach, opisach, likwidacjach i wielorybach
  buyInk: '#35c9a8',
  sellInk: '#f07c55',
  volBuy: rgba('#19a88e', 0.5),
  volSell: rgba('#d9582e', 0.6),
  priceLine: '#3fc6dd',
  vwap: '#e6ebf2',
  svwap: '#9085e9',
  va: rgba(C.ink2, 0.55),
  warn: '#fab219',
  partial: rgba('#fab219', 0.85),
  // Footprint: kafle komórek od grafitu (mały wolumen) do nasyconego koloru strony; delta wiersza w tych samych kolorach
  fpNeutral: '#2a3446',
  fpBidRamp: ['#2a3446', '#4c3532', '#743d2e', '#a6492f', '#d9582e'],
  fpAskRamp: ['#2a3446', '#1f4b52', '#1a6d63', '#19907d', '#1fb597'],
  fpDeltaPosRamp: ['#2a3446', '#1f4b52', '#1a6d63', '#19907d', '#1fb597'],
  fpDeltaNegRamp: ['#2a3446', '#4c3532', '#743d2e', '#a6492f', '#d9582e'],
  fpText: '#0b1019',
  fpTextLight: '#eef2f7',
  fpTextProfile: '#c9d4df',
  fpRowLine: '#1b2533',
  // Nierównowagi: rozjaśnione kolory stron
  imbBuy: '#5cf2cf',
  imbSell: '#ff9a6a',
  pocFrame: '#e0a045',
  volBar: '#5b7aa6',
  deltaPosBar: '#19a88e',
  deltaNegBar: '#d9582e',
  // Profile wolumenu: obszar wartości grafitowy, reszta przygaszona, POC bursztynowy, nagi POC szary
  profileVa: '#34425a',
  profileOut: '#1f2b3d',
  profilePoc: '#e0a045',
  nakedPoc: '#7a889c',
  // Drabina DOM: aski nad ceną w kolorze sprzedaży, bidy pod nią w kolorze kupna
  domBid: '#19a88e',
  domAsk: '#d9582e',
  domText: '#e4e8ee',
  // Bąble agresji: środek, brzeg i obrys kuli
  bubbleBuy: ['#2fd1ae', '#0e5f52', '#8ef0d9'],
  bubbleSell: ['#ee7445', '#7a2c14', '#ffb592'],
  // Giełdy w panelach „CVD giełd” i „ΔOI giełd” (paleta kategorii sprawdzona na tle wykresu, także dla daltonistów)
  venueHl: '#3987e5',
  venueBinance: '#c98500',
  venueBybit: '#d55181',
  // Grupa „Kto handluje” w Tablicy liczb: neutralna jasna (to nie giełda, nie bierze koloru z palety giełd)
  players: '#e4e8ee',
} as const;

/**
 * Rampa mapy ciepła arkusza: przezroczysty → granat (półprzezroczysty, świece widać przez niego) → błękit
 * (pasy płynności) → lód → biel (ściany).
 */
export const LIQ_RAMP: HeatRamp = [
  { t: 0, color: '#0b1019', alpha: 0 },
  { t: 0.12, color: '#14284a', alpha: 0.45 },
  { t: 0.28, color: '#1b4373', alpha: 0.65 },
  { t: 0.42, color: '#22609a', alpha: 0.8 },
  { t: 0.55, color: '#2a80b8', alpha: 0.9 },
  { t: 0.68, color: '#3fa9d6', alpha: 1 },
  { t: 0.8, color: '#7fdcee', alpha: 1 },
  { t: 0.9, color: '#c9f2f9', alpha: 1 },
  { t: 1, color: '#ffffff', alpha: 1 },
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
