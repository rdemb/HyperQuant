import { type ChartPalette, PALETTE } from '../../charts/pro/chart/palette';

/**
 * Kolory rycin, których nie ma w tokenach `of-*`: kafle footprintu, delta wiersza i profil wolumenu, w palecie wybranej
 * w Wykresach. To kopia wartości z src/charts/pro/chart/theme.ts, żeby lekcje nie ładowały biblioteki wykresów;
 * test pilnuje zgodności z Wykresami we wszystkich paletach.
 */

const NEON = {
  fpBidRamp: ['#a0a0a0', '#a392b5', '#8d6fad', '#7a48aa', '#6725a3'],
  fpAskRamp: ['#a0a0a0', '#8ab88b', '#61b861', '#33b934', '#11b920'],
  fpDeltaPosRamp: ['#a0a0a0', '#8a8bb9', '#6161b9', '#4a4ab8', '#3333b8'],
  fpDeltaNegRamp: ['#a0a0a0', '#b88a8a', '#b96161', '#b94a4b', '#b93234'],
  fpText: '#111326',
  fpTextLight: '#f2f3f5',
  profileVa: '#555557',
  profileOut: '#3c6265',
};

const DESK: typeof NEON = {
  fpBidRamp: ['#2a3446', '#4c3532', '#743d2e', '#a6492f', '#d9582e'],
  fpAskRamp: ['#2a3446', '#1f4b52', '#1a6d63', '#19907d', '#1fb597'],
  fpDeltaPosRamp: ['#2a3446', '#1f4b52', '#1a6d63', '#19907d', '#1fb597'],
  fpDeltaNegRamp: ['#2a3446', '#4c3532', '#743d2e', '#a6492f', '#d9582e'],
  fpText: '#0b1019',
  fpTextLight: '#eef2f7',
  profileVa: '#34425a',
  profileOut: '#1f2b3d',
};

const SWIATLOKOPIA: typeof NEON = {
  fpBidRamp: ['#22487a', '#615373', '#96596a', '#ca585c', '#ff4f45'],
  fpAskRamp: ['#22487a', '#52719b', '#849bbc', '#b8c7dd', '#eef4ff'],
  fpDeltaPosRamp: ['#22487a', '#52719b', '#849bbc', '#b8c7dd', '#eef4ff'],
  fpDeltaNegRamp: ['#22487a', '#615373', '#96596a', '#ca585c', '#ff4f45'],
  fpText: '#0b2246',
  fpTextLight: '#f2f6ff',
  profileVa: '#2a5590',
  profileOut: '#1a3f72',
};

const BAUHAUS: typeof NEON = {
  fpBidRamp: ['#2a2826', '#59312b', '#89362e', '#bb352f', '#ef2b2d'],
  fpAskRamp: ['#2a2826', '#2d3b58', '#2f4c8d', '#2f5cc4', '#2e6bff'],
  fpDeltaPosRamp: ['#2a2826', '#2d3b58', '#2f4c8d', '#2f5cc4', '#2e6bff'],
  fpDeltaNegRamp: ['#2a2826', '#59312b', '#89362e', '#bb352f', '#ef2b2d'],
  fpText: '#151413',
  fpTextLight: '#f4f1ea',
  profileVa: '#3a3733',
  profileOut: '#24221f',
};

const TERMOWIZJA: typeof NEON = {
  fpBidRamp: ['#1b1f2c', '#30325b', '#47458e', '#6058c5', '#7a6bff'],
  fpAskRamp: ['#1b1f2c', '#2a485b', '#34758e', '#39a6c5', '#38d9ff'],
  fpDeltaPosRamp: ['#1b1f2c', '#2a485b', '#34758e', '#39a6c5', '#38d9ff'],
  fpDeltaNegRamp: ['#1b1f2c', '#30325b', '#47458e', '#6058c5', '#7a6bff'],
  fpText: '#04060c',
  fpTextLight: '#eef2f8',
  profileVa: '#2a3040',
  profileOut: '#151925',
};

const WYCINANKA: typeof NEON = {
  fpBidRamp: ['#262428', '#542c3b', '#832f4f', '#b52b64', '#e8197a'],
  fpAskRamp: ['#262428', '#395144', '#488362', '#54b880', '#5cf0a0'],
  fpDeltaPosRamp: ['#262428', '#395144', '#488362', '#54b880', '#5cf0a0'],
  fpDeltaNegRamp: ['#262428', '#542c3b', '#832f4f', '#b52b64', '#e8197a'],
  fpText: '#0c0b0d',
  fpTextLight: '#f4f2f6',
  profileVa: '#38343c',
  profileOut: '#1f1d22',
};

const NOKTURN: typeof NEON = {
  fpBidRamp: ['#1d2f63', '#554461', '#8b555b', '#c4614c', '#ff6a2b'],
  fpAskRamp: ['#1d2f63', '#4f596a', '#868269', '#c1aa5e', '#ffd43b'],
  fpDeltaPosRamp: ['#1d2f63', '#4f596a', '#868269', '#c1aa5e', '#ffd43b'],
  fpDeltaNegRamp: ['#1d2f63', '#554461', '#8b555b', '#c4614c', '#ff6a2b'],
  fpText: '#0b1a45',
  fpTextLight: '#f2f5ff',
  profileVa: '#283f7a',
  profileOut: '#172a5c',
};

const FIGS: Record<ChartPalette, typeof NEON> = {
  neon: NEON,
  desk: DESK,
  swiatlokopia: SWIATLOKOPIA,
  bauhaus: BAUHAUS,
  termowizja: TERMOWIZJA,
  wycinanka: WYCINANKA,
  nokturn: NOKTURN,
};

export const FIG = FIGS[PALETTE];

/** Jasność względna koloru #rrggbb (WCAG). */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** Liczby ciemne na jasnym kaflu, jasne na ciemnym (ten sam próg co na Wykresach). */
export const inkOn = (tile: string) => (luminance(tile) > 0.18 ? FIG.fpText : FIG.fpTextLight);
