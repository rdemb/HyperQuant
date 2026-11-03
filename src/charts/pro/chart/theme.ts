import { ColorType, CrosshairMode, LineStyle, TickMarkType } from 'lightweight-charts';
import type { ChartOptions, DeepPartial, Time } from 'lightweight-charts';
import type { HeatRamp } from '../../orderflow/heatColor';
import { C, MONO, rgba } from '../../orderflow/renderer';
import { fmtHm, fmtHms } from '../core/time';
import { locale, tr } from '../../../i18n';
import { type ChartPalette, PALETTE } from './palette';

/** Wygląd wykresu Pro: tokeny projektu (src/index.css), oś czasu w czasie lokalnym, polskie skróty miesięcy. */

const MONTHS = tr(
  ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'],
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
);

/**
 * Kolory płótna wykresu Pro w sześciu paletach (wybór w Ustawieniach wykresu, ./palette). Te same wartości są tokenami
 * `of-*` w src/index.css (legenda i menu). Gotowe napisy z kryciem — bez budowania w pętli rysowania.
 */

/** „Neon”: neonowa zieleń kupna i fiolet sprzedaży na grafitowym tle, nierównowagi w cyjanie i magencie, żółty POC. */
const NEON = {
  bg: '#151521',
  axisText: '#d8dadc',
  // Świece: korpusy i knoty
  buy: '#10ff21',
  sell: '#8a2be2',
  buyWick: '#10ff21',
  sellWick: '#8a2be2',
  // Kierunek przepływu w liczbach, opisach, likwidacjach i wielorybach
  buyInk: '#3dff4f',
  sellInk: '#a66bff',
  volBuy: rgba('#10ff21', 0.42),
  volSell: rgba('#8a2be2', 0.62),
  priceLine: '#2f8088',
  vwap: '#d0d3d9',
  svwap: '#14c8c8',
  /** Strefa ceny z linku powtórki (token zone). */
  zone: '#4a9eff',
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
  // Bąble agresji: środek, brzeg i obrys kuli (kupno morskie, sprzedaż magenta)
  bubbleBuy: ['#2fd8c8', '#0b6e66', '#78f0e4'],
  bubbleSell: ['#e23be9', '#7a1280', '#f68cfa'],
  // Giełdy w panelach „CVD giełd” i „ΔOI giełd” (paleta kategorii sprawdzona na tle wykresu, także dla daltonistów)
  venueHl: '#199e70',
  venueBinance: '#d95926',
  venueBybit: '#3987e5',
};

/** „Desk”: morska zieleń kupna i miedź sprzedaży na granatowym tle Desku. */
const DESK: typeof NEON = {
  bg: '#0b1019',
  axisText: '#c3ccd8',
  buy: '#19a88e',
  sell: '#d9582e',
  buyWick: '#19a88e',
  sellWick: '#d9582e',
  buyInk: '#35c9a8',
  sellInk: '#f07c55',
  volBuy: rgba('#19a88e', 0.5),
  volSell: rgba('#d9582e', 0.6),
  priceLine: '#3fc6dd',
  vwap: '#e6ebf2',
  svwap: '#9085e9',
  zone: '#9085e9',
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
  domBid: '#19a88e',
  domAsk: '#d9582e',
  domText: '#e4e8ee',
  bubbleBuy: ['#2fd1ae', '#0e5f52', '#8ef0d9'],
  bubbleSell: ['#ee7445', '#7a2c14', '#ffb592'],
  venueHl: '#3987e5',
  venueBinance: '#c98500',
  venueBybit: '#d55181',
};

/**
 * „Kobalt”: lazur kupna i szafran sprzedaży na atramentowej czerni — oś niebieski–żółty, którą rozróżnia też oko
 * z protanopią i deuteranopią; płynność w srebrze (kolor zostaje dla agresji), POC morski, VWAP sesji lawendowy.
 */
const KOBALT: typeof NEON = {
  bg: '#0c0f16',
  axisText: '#c3cad6',
  buy: '#3d8ef5',
  sell: '#f4a62a',
  buyWick: '#3d8ef5',
  sellWick: '#f4a62a',
  buyInk: '#6aa9ff',
  sellInk: '#ffbd55',
  volBuy: rgba('#3d8ef5', 0.55),
  volSell: rgba('#f4a62a', 0.5),
  priceLine: '#9aa8bd',
  vwap: '#f2f4f8',
  svwap: '#c9b8ff',
  zone: '#c9b8ff',
  fpNeutral: '#262d3a',
  fpBidRamp: ['#262d3a', '#554a41', '#876843', '#bc873e', '#f4a62a'],
  fpAskRamp: ['#262d3a', '#2e4465', '#355c92', '#3a75c3', '#3d8ef5'],
  fpDeltaPosRamp: ['#262d3a', '#2e4465', '#355c92', '#3a75c3', '#3d8ef5'],
  fpDeltaNegRamp: ['#262d3a', '#554a41', '#876843', '#bc873e', '#f4a62a'],
  fpText: '#0c0f16',
  fpTextLight: '#eef2f7',
  fpTextProfile: '#d3dae4',
  fpRowLine: '#1a202b',
  imbBuy: '#5cc8ff',
  imbSell: '#ffcf3f',
  pocFrame: '#45e3c8',
  volBar: '#5f6b80',
  deltaPosBar: '#3d8ef5',
  deltaNegBar: '#f4a62a',
  profileVa: '#3a4457',
  profileOut: '#20262f',
  profilePoc: '#45e3c8',
  nakedPoc: '#8a94a6',
  domBid: '#3d8ef5',
  domAsk: '#f4a62a',
  domText: '#e4e8ee',
  bubbleBuy: ['#5aa2ff', '#173c75', '#a8ccff'],
  bubbleSell: ['#ffb43f', '#7a4c0c', '#ffd99a'],
  venueHl: '#2fc5b0',
  venueBinance: '#c9b8ff',
  venueBybit: '#eef1f5',
};

/**
 * „Zorza”: noc polarna — miętowe kupno i malinowa sprzedaż (różna jasność, czytelne także przy daltonizmie), płynność
 * jak niebo zorzy od purpury do orchidei, złoty POC, nierównowagi w limonce i różu.
 */
const ZORZA: typeof NEON = {
  bg: '#0a0b1d',
  axisText: '#c8cbe0',
  buy: '#5ef2b5',
  sell: '#e0407e',
  buyWick: '#5ef2b5',
  sellWick: '#e0407e',
  buyInk: '#7af5c4',
  sellInk: '#ff6a9e',
  volBuy: rgba('#5ef2b5', 0.45),
  volSell: rgba('#e0407e', 0.55),
  priceLine: '#a9b0d6',
  vwap: '#f5f3ff',
  svwap: '#7fd0ff',
  zone: '#7fd0ff',
  fpNeutral: '#24263f',
  fpBidRamp: ['#24263f', '#51314f', '#7f395e', '#af3f6e', '#e0407e'],
  fpAskRamp: ['#24263f', '#36545c', '#458679', '#52bb97', '#5ef2b5'],
  fpDeltaPosRamp: ['#24263f', '#36545c', '#458679', '#52bb97', '#5ef2b5'],
  fpDeltaNegRamp: ['#24263f', '#51314f', '#7f395e', '#af3f6e', '#e0407e'],
  fpText: '#0a0b1d',
  fpTextLight: '#f0f1fa',
  fpTextProfile: '#d6d8ea',
  fpRowLine: '#181a30',
  imbBuy: '#e2ff5c',
  imbSell: '#ffa3c8',
  pocFrame: '#ffcf5c',
  volBar: '#6a6f9a',
  deltaPosBar: '#5ef2b5',
  deltaNegBar: '#e0407e',
  profileVa: '#363a5c',
  profileOut: '#1f2238',
  profilePoc: '#ffcf5c',
  nakedPoc: '#8a8eb0',
  domBid: '#5ef2b5',
  domAsk: '#e0407e',
  domText: '#e6e7f2',
  bubbleBuy: ['#6ff5c0', '#11634a', '#b5fbe0'],
  bubbleSell: ['#ea5a8e', '#6e1438', '#ffa6c6'],
  venueHl: '#7fd0ff',
  venueBinance: '#ffcf5c',
  venueBybit: '#f5f3ff',
};

/**
 * „Laka”: czarna laka, złoto kupna i cynober sprzedaży, płynność w indygo, POC nefrytowy, VWAP w kolorze kości
 * słoniowej.
 */
const LAKA: typeof NEON = {
  bg: '#100d0c',
  axisText: '#d6cfc6',
  buy: '#e6bb4f',
  sell: '#e5482f',
  buyWick: '#e6bb4f',
  sellWick: '#e5482f',
  buyInk: '#f2cc6b',
  sellInk: '#ff6a4d',
  volBuy: rgba('#e6bb4f', 0.5),
  volSell: rgba('#e5482f', 0.55),
  priceLine: '#bfb4a6',
  vwap: '#efe6d8',
  svwap: '#9fb4ff',
  zone: '#9fb4ff',
  fpNeutral: '#2a2420',
  fpBidRamp: ['#2a2420', '#563027', '#833a2b', '#b3422e', '#e5482f'],
  fpAskRamp: ['#2a2420', '#54462e', '#816b3b', '#b29246', '#e6bb4f'],
  fpDeltaPosRamp: ['#2a2420', '#54462e', '#816b3b', '#b29246', '#e6bb4f'],
  fpDeltaNegRamp: ['#2a2420', '#563027', '#833a2b', '#b3422e', '#e5482f'],
  fpText: '#100d0c',
  fpTextLight: '#f4efe6',
  fpTextProfile: '#ddd5ca',
  fpRowLine: '#1d1916',
  imbBuy: '#ffe69a',
  imbSell: '#ff9a82',
  pocFrame: '#3fd4a4',
  volBar: '#6e6358',
  deltaPosBar: '#e6bb4f',
  deltaNegBar: '#e5482f',
  profileVa: '#3d3631',
  profileOut: '#231f1c',
  profilePoc: '#3fd4a4',
  nakedPoc: '#8e857a',
  domBid: '#e6bb4f',
  domAsk: '#e5482f',
  domText: '#ece5da',
  bubbleBuy: ['#f0c75e', '#6e5318', '#ffe3a0'],
  bubbleSell: ['#f05a3e', '#74210f', '#ffa08a'],
  venueHl: '#3fd4a4',
  venueBinance: '#efe6d8',
  venueBybit: '#c9a0ff',
};

/**
 * „Atrament”: na nocne sesje — stonowana morska mgła kupna i przygaszony róż sprzedaży (różna jasność), mniej blasku,
 * przyciemniona fioletowa płynność bez bieli, VWAP barwinkowy, POC w matowym złocie.
 */
const ATRAMENT: typeof NEON = {
  bg: '#100f12',
  axisText: '#b9b6c2',
  buy: '#a6dccd',
  sell: '#b9707f',
  buyWick: '#a6dccd',
  sellWick: '#b9707f',
  buyInk: '#b5e3d6',
  sellInk: '#d48b99',
  volBuy: rgba('#a6dccd', 0.4),
  volSell: rgba('#b9707f', 0.5),
  priceLine: '#8f8a9c',
  vwap: '#8fb3ff',
  svwap: '#f0ede6',
  zone: '#8fb3ff',
  fpNeutral: '#25232b',
  fpBidRamp: ['#25232b', '#47353f', '#6b4853', '#915c69', '#b9707f'],
  fpAskRamp: ['#25232b', '#434c4f', '#627977', '#83a9a1', '#a6dccd'],
  fpDeltaPosRamp: ['#25232b', '#434c4f', '#627977', '#83a9a1', '#a6dccd'],
  fpDeltaNegRamp: ['#25232b', '#47353f', '#6b4853', '#915c69', '#b9707f'],
  fpText: '#100f12',
  fpTextLight: '#e8e6ee',
  fpTextProfile: '#cfccd8',
  fpRowLine: '#1b1a20',
  imbBuy: '#d9fff2',
  imbSell: '#ff9fb3',
  pocFrame: '#d9b26a',
  volBar: '#5f5a6a',
  deltaPosBar: '#a6dccd',
  deltaNegBar: '#b9707f',
  profileVa: '#37343f',
  profileOut: '#211f26',
  profilePoc: '#d9b26a',
  nakedPoc: '#7f7a8a',
  domBid: '#a6dccd',
  domAsk: '#b9707f',
  domText: '#dcd9e2',
  bubbleBuy: ['#b0e3d5', '#3b6a5e', '#dcf5ee'],
  bubbleSell: ['#c47c8a', '#5a2e37', '#e8b0ba'],
  venueHl: '#a6dccd',
  venueBinance: '#d9b26a',
  venueBybit: '#8fb3ff',
};

export const PALETTES: Record<ChartPalette, typeof NEON> = { neon: NEON, desk: DESK, kobalt: KOBALT, zorza: ZORZA, laka: LAKA, atrament: ATRAMENT };

export const PRO = {
  ...C,
  cross: rgba(C.ink2, 0.5),
  va: rgba(C.ink2, 0.55),
  warn: '#fab219',
  partial: rgba('#fab219', 0.85),
  // Grupa „Kto handluje” w Tablicy liczb: neutralna jasna (to nie giełda, nie bierze koloru z palety giełd)
  players: '#e4e8ee',
  ...PALETTES[PALETTE],
} as const;

/**
 * Rampy mapy ciepła arkusza, od przezroczystej (świece widać przez słabą płynność) do ścian. Neon: ciemny morski →
 * jasny morski → biel → żółty → pomarańcz → czerwień. Desk: granat → błękit → lód → biel. Kobalt: grafit → srebro →
 * biel. Zorza: purpura → fiolet → orchidea. Laka: indygo → barwinek → lawenda. Atrament: przygaszony fiolet bez bieli
 * (najjaśniejsza ściana ciemniejsza od świec).
 */
export const LIQ_RAMPS: Record<ChartPalette, HeatRamp> = {
  neon: [
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
  ],
  desk: [
    { t: 0, color: '#0b1019', alpha: 0 },
    { t: 0.12, color: '#14284a', alpha: 0.45 },
    { t: 0.28, color: '#1b4373', alpha: 0.65 },
    { t: 0.42, color: '#22609a', alpha: 0.8 },
    { t: 0.55, color: '#2a80b8', alpha: 0.9 },
    { t: 0.68, color: '#3fa9d6', alpha: 1 },
    { t: 0.8, color: '#7fdcee', alpha: 1 },
    { t: 0.9, color: '#c9f2f9', alpha: 1 },
    { t: 1, color: '#ffffff', alpha: 1 },
  ],
  kobalt: [
    { t: 0, color: '#0c0f16', alpha: 0 },
    { t: 0.12, color: '#1b2130', alpha: 0.4 },
    { t: 0.28, color: '#2a3346', alpha: 0.58 },
    { t: 0.42, color: '#3c475e', alpha: 0.72 },
    { t: 0.55, color: '#56627b', alpha: 0.85 },
    { t: 0.68, color: '#7d899f', alpha: 1 },
    { t: 0.8, color: '#a9b3c4', alpha: 1 },
    { t: 0.9, color: '#d3d9e3', alpha: 1 },
    { t: 1, color: '#ffffff', alpha: 1 },
  ],
  zorza: [
    { t: 0, color: '#0a0b1d', alpha: 0 },
    { t: 0.12, color: '#1c1745', alpha: 0.4 },
    { t: 0.28, color: '#2c1d68', alpha: 0.58 },
    { t: 0.42, color: '#40248c', alpha: 0.72 },
    { t: 0.55, color: '#5a2ba6', alpha: 0.85 },
    { t: 0.68, color: '#7a37c2', alpha: 1 },
    { t: 0.8, color: '#9f50d8', alpha: 1 },
    { t: 0.9, color: '#c47fe6', alpha: 1 },
    { t: 1, color: '#e6b8f4', alpha: 1 },
  ],
  laka: [
    { t: 0, color: '#100d0c', alpha: 0 },
    { t: 0.12, color: '#15142e', alpha: 0.4 },
    { t: 0.28, color: '#1f1d4d', alpha: 0.58 },
    { t: 0.42, color: '#2b2970', alpha: 0.72 },
    { t: 0.55, color: '#3a3794', alpha: 0.85 },
    { t: 0.68, color: '#4f4bb8', alpha: 1 },
    { t: 0.8, color: '#7470d6', alpha: 1 },
    { t: 0.9, color: '#aaa6ee', alpha: 1 },
    { t: 1, color: '#e4e2ff', alpha: 1 },
  ],
  atrament: [
    { t: 0, color: '#100f12', alpha: 0 },
    { t: 0.12, color: '#1f1a28', alpha: 0.4 },
    { t: 0.28, color: '#2c2338', alpha: 0.55 },
    { t: 0.42, color: '#3a2e4b', alpha: 0.7 },
    { t: 0.55, color: '#4b3a60', alpha: 0.82 },
    { t: 0.68, color: '#5a466f', alpha: 0.92 },
    { t: 0.8, color: '#66507c', alpha: 1 },
    { t: 0.9, color: '#6e5786', alpha: 1 },
    { t: 1, color: '#765e8f', alpha: 1 },
  ],
};

export const LIQ_RAMP: HeatRamp = LIQ_RAMPS[PALETTE];

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
  const wd = tr(['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'], ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])[d.getDay()];
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
    localization: { locale, timeFormatter: crosshairTimeFormatter },
  };
}
