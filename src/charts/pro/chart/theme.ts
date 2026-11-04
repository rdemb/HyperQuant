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
 * Kolory płótna wykresu Pro w siedmiu paletach (wybór w Ustawieniach wykresu, ./palette). Te same wartości są tokenami
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
 * „Drzeworyt”: jasny papier japońskiego drzeworytu — kupno pruskim błękitem, sprzedaż cynobrem, płynność jak
 * rozmyty tusz (szarości, ściany średnio ciemne, żeby świece zostały na wierzchu), VWAP czarnym tuszem, POC zielony.
 */
const DRZEWORYT: typeof NEON = {
  bg: '#f2eadb',
  axisText: '#4a4338',
  buy: '#1f4f8f',
  sell: '#c43b22',
  buyWick: '#1f4f8f',
  sellWick: '#c43b22',
  buyInk: '#1a467f',
  sellInk: '#b0321b',
  volBuy: rgba('#1f4f8f', 0.55),
  volSell: rgba('#c43b22', 0.5),
  priceLine: '#6b6254',
  vwap: '#1c1a17',
  svwap: '#6b3d1a',
  zone: '#7a3fa0',
  fpNeutral: '#e3dccd',
  fpBidRamp: ['#e3dccd', '#e0b6a3', '#da907a', '#d16951', '#c43b22'],
  fpAskRamp: ['#e3dccd', '#b0b8c0', '#7f95b1', '#5072a1', '#1f4f8f'],
  fpDeltaPosRamp: ['#e3dccd', '#b0b8c0', '#7f95b1', '#5072a1', '#1f4f8f'],
  fpDeltaNegRamp: ['#e3dccd', '#e0b6a3', '#da907a', '#d16951', '#c43b22'],
  fpText: '#1c1a17',
  fpTextLight: '#fbf7ef',
  fpTextProfile: '#fbf7ef',
  fpRowLine: '#ddd4c3',
  imbBuy: '#5cb8ff',
  imbSell: '#ff9a5c',
  pocFrame: '#1f6a48',
  volBar: '#9a9080',
  deltaPosBar: '#1f4f8f',
  deltaNegBar: '#c43b22',
  profileVa: '#d6cdbb',
  profileOut: '#e6dfd0',
  profilePoc: '#1f6a48',
  nakedPoc: '#8a8172',
  domBid: '#1f4f8f',
  domAsk: '#c43b22',
  domText: '#1c1a17',
  bubbleBuy: ['#2c5fa3', '#9fb6d6', '#123a6e'],
  bubbleSell: ['#d24a30', '#efb3a5', '#8a2412'],
  venueHl: '#2e7d5b',
  venueBinance: '#b0700a',
  venueBybit: '#7a3fa0',
};

/**
 * „Porcelana”: biała porcelana z kobaltem i złoceniem — kupno kobaltowe, sprzedaż w ciemnym złocie, płynność jak
 * seledynowa polewa, POC karminowy, VWAP grafitowy, VWAP sesji morski.
 */
const PORCELANA: typeof NEON = {
  bg: '#f4f6f9',
  axisText: '#3a4250',
  buy: '#1d4fc4',
  sell: '#9c6a00',
  buyWick: '#1d4fc4',
  sellWick: '#9c6a00',
  buyInk: '#1a46b0',
  sellInk: '#8a5d00',
  volBuy: rgba('#1d4fc4', 0.5),
  volSell: rgba('#9c6a00', 0.5),
  priceLine: '#5f6b7d',
  vwap: '#151a24',
  svwap: '#00695c',
  zone: '#7a4fc0',
  fpNeutral: '#e2e7ee',
  fpBidRamp: ['#e2e7ee', '#d1c7ba', '#c0a887', '#ae8952', '#9c6a00'],
  fpAskRamp: ['#e2e7ee', '#afc2e7', '#7d9edd', '#4d78d2', '#1d4fc4'],
  fpDeltaPosRamp: ['#e2e7ee', '#afc2e7', '#7d9edd', '#4d78d2', '#1d4fc4'],
  fpDeltaNegRamp: ['#e2e7ee', '#d1c7ba', '#c0a887', '#ae8952', '#9c6a00'],
  fpText: '#151a24',
  fpTextLight: '#fafbfd',
  fpTextProfile: '#fafbfd',
  fpRowLine: '#dde3ea',
  imbBuy: '#6fa8ff',
  imbSell: '#ffc94d',
  pocFrame: '#c41e4a',
  volBar: '#8e99aa',
  deltaPosBar: '#1d4fc4',
  deltaNegBar: '#9c6a00',
  profileVa: '#d5dce6',
  profileOut: '#e6eaf0',
  profilePoc: '#c41e4a',
  nakedPoc: '#7f8a9b',
  domBid: '#1d4fc4',
  domAsk: '#9c6a00',
  domText: '#151a24',
  bubbleBuy: ['#2a5fd6', '#a9bfee', '#103a9a'],
  bubbleSell: ['#b07c0a', '#e8d2a0', '#6e4a00'],
  venueHl: '#0f8a7a',
  venueBinance: '#c41e4a',
  venueBybit: '#7a4fc0',
};

/**
 * „Głębina”: morze od turkusowej toni u góry do czerni dna — kupno świeci jak plankton, sprzedaż koralowa, płynność
 * jak meduzy od fioletu do różu, POC żółty, VWAP biały, VWAP sesji błękitny.
 */
const GLEBINA: typeof NEON = {
  bg: '#01070d',
  axisText: '#bfe3ee',
  buy: '#4dffc3',
  sell: '#ff6b5a',
  buyWick: '#4dffc3',
  sellWick: '#ff6b5a',
  buyInk: '#6fffd0',
  sellInk: '#ff8a7a',
  volBuy: rgba('#4dffc3', 0.42),
  volSell: rgba('#ff6b5a', 0.55),
  priceLine: '#6fa6b8',
  vwap: '#ffffff',
  svwap: '#7fd4ff',
  zone: '#7fd4ff',
  fpNeutral: '#13262f',
  fpBidRamp: ['#13262f', '#4c3a3c', '#854c48', '#c15c52', '#ff6b5a'],
  fpAskRamp: ['#13262f', '#235651', '#318b76', '#3fc39c', '#4dffc3'],
  fpDeltaPosRamp: ['#13262f', '#235651', '#318b76', '#3fc39c', '#4dffc3'],
  fpDeltaNegRamp: ['#13262f', '#4c3a3c', '#854c48', '#c15c52', '#ff6b5a'],
  fpText: '#01070d',
  fpTextLight: '#eefbff',
  fpTextProfile: '#d5eef5',
  fpRowLine: '#0a1c24',
  imbBuy: '#c9fff0',
  imbSell: '#ffb3a8',
  pocFrame: '#ffe45c',
  volBar: '#4f7f8f',
  deltaPosBar: '#4dffc3',
  deltaNegBar: '#ff6b5a',
  profileVa: '#1d3a46',
  profileOut: '#0f242d',
  profilePoc: '#ffe45c',
  nakedPoc: '#7aa3b0',
  domBid: '#4dffc3',
  domAsk: '#ff6b5a',
  domText: '#e2f5fa',
  bubbleBuy: ['#5fffc9', '#0d6b52', '#b5ffe6'],
  bubbleSell: ['#ff7a6a', '#7a2018', '#ffb8ae'],
  venueHl: '#7fd4ff',
  venueBinance: '#ffe45c',
  venueBybit: '#c98cff',
};

/**
 * „Zmierzch”: niebo nad pustynią od fioletu u góry do nocy u dołu — kupno turkusowe, sprzedaż terakotowa, płynność
 * w różach zachodu, POC słoneczny, VWAP kremowy, VWAP sesji lawendowy.
 */
const ZMIERZCH: typeof NEON = {
  bg: '#140a17',
  axisText: '#e8d3e6',
  buy: '#3fe0cf',
  sell: '#f06a3c',
  buyWick: '#3fe0cf',
  sellWick: '#f06a3c',
  buyInk: '#62eadb',
  sellInk: '#ff8a5c',
  volBuy: rgba('#3fe0cf', 0.45),
  volSell: rgba('#f06a3c', 0.55),
  priceLine: '#a985a8',
  vwap: '#fff4e6',
  svwap: '#a99bff',
  zone: '#a99bff',
  fpNeutral: '#2e1a31',
  fpBidRamp: ['#2e1a31', '#592e3a', '#89423f', '#bb5640', '#f06a3c'],
  fpAskRamp: ['#2e1a31', '#404755', '#4a777c', '#4baaa4', '#3fe0cf'],
  fpDeltaPosRamp: ['#2e1a31', '#404755', '#4a777c', '#4baaa4', '#3fe0cf'],
  fpDeltaNegRamp: ['#2e1a31', '#592e3a', '#89423f', '#bb5640', '#f06a3c'],
  fpText: '#140a17',
  fpTextLight: '#fbf2f8',
  fpTextProfile: '#ecdcea',
  fpRowLine: '#22122a',
  imbBuy: '#c6fff8',
  imbSell: '#ffb08a',
  pocFrame: '#ffd25a',
  volBar: '#7d5f80',
  deltaPosBar: '#3fe0cf',
  deltaNegBar: '#f06a3c',
  profileVa: '#3e2742',
  profileOut: '#26162a',
  profilePoc: '#ffd25a',
  nakedPoc: '#a0859f',
  domBid: '#3fe0cf',
  domAsk: '#f06a3c',
  domText: '#f2e6f0',
  bubbleBuy: ['#55e8d8', '#106b62', '#b0f7ef'],
  bubbleSell: ['#f47c50', '#7a2c12', '#ffb89a'],
  venueHl: '#a99bff',
  venueBinance: '#ffd25a',
  venueBybit: '#fff4e6',
};

/**
 * „Malachit”: polerowany malachit od jasnej zieleni u góry do ciemnej u dołu — kupno w kości słoniowej, sprzedaż
 * miedziana, płynność w pasach malachitu, POC złoty, VWAP błękitny, VWAP sesji różowy.
 */
const MALACHIT: typeof NEON = {
  bg: '#03170f',
  axisText: '#cfe8dc',
  buy: '#fff3d6',
  sell: '#ff7a3d',
  buyWick: '#fff3d6',
  sellWick: '#ff7a3d',
  buyInk: '#fff6e2',
  sellInk: '#ff9663',
  volBuy: rgba('#fff3d6', 0.42),
  volSell: rgba('#ff7a3d', 0.55),
  priceLine: '#7fae98',
  vwap: '#9fd8ff',
  svwap: '#ff9ec7',
  zone: '#9fd8ff',
  fpNeutral: '#173a2c',
  fpBidRamp: ['#173a2c', '#544d34', '#8c5e39', '#c46d3c', '#ff7a3d'],
  fpAskRamp: ['#173a2c', '#4e6452', '#85917b', '#c1c1a8', '#fff3d6'],
  fpDeltaPosRamp: ['#173a2c', '#4e6452', '#85917b', '#c1c1a8', '#fff3d6'],
  fpDeltaNegRamp: ['#173a2c', '#544d34', '#8c5e39', '#c46d3c', '#ff7a3d'],
  fpText: '#03170f',
  fpTextLight: '#f4fbf7',
  fpTextProfile: '#dcefe5',
  fpRowLine: '#0d2a1f',
  imbBuy: '#ffffff',
  imbSell: '#ffb28a',
  pocFrame: '#ffcf4a',
  volBar: '#5f8f78',
  deltaPosBar: '#fff3d6',
  deltaNegBar: '#ff7a3d',
  profileVa: '#21503d',
  profileOut: '#123526',
  profilePoc: '#ffcf4a',
  nakedPoc: '#86a898',
  domBid: '#fff3d6',
  domAsk: '#ff7a3d',
  domText: '#eaf6ef',
  bubbleBuy: ['#fff6e0', '#7a7258', '#ffffff'],
  bubbleSell: ['#ff8a50', '#7a3214', '#ffbf9e'],
  venueHl: '#9fd8ff',
  venueBinance: '#ffcf4a',
  venueBybit: '#ff9ec7',
};

export const PALETTES: Record<ChartPalette, typeof NEON> = {
  neon: NEON,
  desk: DESK,
  drzeworyt: DRZEWORYT,
  porcelana: PORCELANA,
  glebina: GLEBINA,
  zmierzch: ZMIERZCH,
  malachit: MALACHIT,
};

/**
 * Płótno inne niż ciemne neutralne kolory Desku (src/charts/orderflow/renderer): jasny papier — napisy, siatka i dymki
 * osi w ciemnym tuszu — albo tło z gradientem od `bgTop` u góry do `bg` u dołu. Palety bez wpisu: płótno jednolite.
 */
type Canvas = Partial<Record<'bgTop' | 'ink1' | 'ink2' | 'ink3' | 'tip' | 'grid' | 'divider', string>>;
const CANVAS: Partial<Record<ChartPalette, Canvas>> = {
  drzeworyt: { ink1: '#1c1a17', ink2: '#4a4338', ink3: '#7a7264', tip: '#e2d8c4', grid: '#d6ccb8', divider: '#c7bba4' },
  porcelana: { ink1: '#151a24', ink2: '#3a4250', ink3: '#6b7686', tip: '#e3e8ef', grid: '#d8dee7', divider: '#c5cdd8' },
  glebina: { bgTop: '#0b3b4f' },
  zmierzch: { bgTop: '#4a2254' },
  malachit: { bgTop: '#11523c' },
};
const N = { ...C, ...CANVAS[PALETTE] };

export const PRO = {
  ...N,
  cross: rgba(N.ink2, 0.5),
  va: rgba(N.ink2, 0.55),
  warn: '#fab219',
  partial: rgba('#fab219', 0.85),
  // Grupa „Kto handluje” w Tablicy liczb: neutralna jasna (to nie giełda, nie bierze koloru z palety giełd)
  players: CANVAS[PALETTE]?.ink1 ?? '#e4e8ee',
  ...PALETTES[PALETTE],
} as const;

/**
 * Rampy mapy ciepła arkusza, od przezroczystej (świece widać przez słabą płynność) do ścian. Neon: ciemny morski →
 * jasny morski → biel → żółty → pomarańcz → czerwień. Desk: granat → błękit → lód → biel. Drzeworyt: szarości tuszu na
 * papierze (ściany średnio ciemne). Porcelana: seledynowa polewa. Głębina: fiolet → róż meduz. Zmierzch: róże
 * zachodu. Malachit: pasy zieleni.
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
  drzeworyt: [
    { t: 0, color: '#f2eadb', alpha: 0 },
    { t: 0.12, color: '#e8e0d0', alpha: 0.4 },
    { t: 0.28, color: '#ddd5c4', alpha: 0.58 },
    { t: 0.42, color: '#cfc6b4', alpha: 0.72 },
    { t: 0.55, color: '#c1b7a4', alpha: 0.85 },
    { t: 0.68, color: '#b2a893', alpha: 1 },
    { t: 0.8, color: '#a39985', alpha: 1 },
    { t: 0.9, color: '#968c7b', alpha: 1 },
    { t: 1, color: '#8a8172', alpha: 1 },
  ],
  porcelana: [
    { t: 0, color: '#f4f6f9', alpha: 0 },
    { t: 0.12, color: '#e6efeb', alpha: 0.4 },
    { t: 0.28, color: '#d3e3dc', alpha: 0.58 },
    { t: 0.42, color: '#bcd4ca', alpha: 0.72 },
    { t: 0.55, color: '#a6c6b9', alpha: 0.85 },
    { t: 0.68, color: '#90b8a8', alpha: 1 },
    { t: 0.8, color: '#7fab9a', alpha: 1 },
    { t: 0.9, color: '#6f9e8c', alpha: 1 },
    { t: 1, color: '#5f8f7f', alpha: 1 },
  ],
  glebina: [
    { t: 0, color: '#01070d', alpha: 0 },
    { t: 0.12, color: '#1a1238', alpha: 0.4 },
    { t: 0.28, color: '#2a1650', alpha: 0.58 },
    { t: 0.42, color: '#3a1c70', alpha: 0.72 },
    { t: 0.55, color: '#4a2390', alpha: 0.85 },
    { t: 0.68, color: '#7a3fd8', alpha: 1 },
    { t: 0.8, color: '#9b5cff', alpha: 1 },
    { t: 0.9, color: '#c98cff', alpha: 1 },
    { t: 1, color: '#f2b8ff', alpha: 1 },
  ],
  zmierzch: [
    { t: 0, color: '#140a17', alpha: 0 },
    { t: 0.12, color: '#2a1228', alpha: 0.4 },
    { t: 0.28, color: '#3a1834', alpha: 0.58 },
    { t: 0.42, color: '#52203f', alpha: 0.72 },
    { t: 0.55, color: '#6a2650', alpha: 0.85 },
    { t: 0.68, color: '#9a3a6a', alpha: 1 },
    { t: 0.8, color: '#c2507e', alpha: 1 },
    { t: 0.9, color: '#cc5d8a', alpha: 1 },
    { t: 1, color: '#d46a95', alpha: 1 },
  ],
  malachit: [
    { t: 0, color: '#03170f', alpha: 0 },
    { t: 0.12, color: '#0a2a1d', alpha: 0.4 },
    { t: 0.28, color: '#0f3d2c', alpha: 0.58 },
    { t: 0.42, color: '#154c37', alpha: 0.72 },
    { t: 0.55, color: '#1a5c42', alpha: 0.85 },
    { t: 0.68, color: '#2f8f64', alpha: 1 },
    { t: 0.8, color: '#3fa474', alpha: 1 },
    { t: 0.9, color: '#4fb884', alpha: 1 },
    { t: 1, color: '#6fd8a4', alpha: 1 },
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
      background: PRO.bgTop ? { type: ColorType.VerticalGradient, topColor: PRO.bgTop, bottomColor: PRO.bg } : { type: ColorType.Solid, color: PRO.bg },
      textColor: PRO.axisText,
      fontSize: 11,
      fontFamily: MONO,
      // Logo TradingView zostaje — wymaga go licencja biblioteki (link do tradingview.com)
      attributionLogo: true,
      panes: { separatorColor: PRO.divider, separatorHoverColor: rgba(PRO.ink3, 0.18), enableResize: true },
    },
    // Bez siatki: poziomy wyznaczają komórki footprintu i wskaźniki
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: PRO.cross, style: LineStyle.Solid, width: 1, labelBackgroundColor: PRO.tip },
      horzLine: { color: PRO.cross, style: LineStyle.Solid, width: 1, labelBackgroundColor: PRO.tip },
    },
    rightPriceScale: { borderColor: PRO.grid, scaleMargins: { top: 0.06, bottom: 0.06 } },
    timeScale: {
      borderColor: PRO.grid,
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
