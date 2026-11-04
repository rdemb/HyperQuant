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

const DRZEWORYT: typeof NEON = {
  fpBidRamp: ['#e3dccd', '#e0b6a3', '#da907a', '#d16951', '#c43b22'],
  fpAskRamp: ['#e3dccd', '#b0b8c0', '#7f95b1', '#5072a1', '#1f4f8f'],
  fpDeltaPosRamp: ['#e3dccd', '#b0b8c0', '#7f95b1', '#5072a1', '#1f4f8f'],
  fpDeltaNegRamp: ['#e3dccd', '#e0b6a3', '#da907a', '#d16951', '#c43b22'],
  fpText: '#1c1a17',
  fpTextLight: '#fbf7ef',
  profileVa: '#d6cdbb',
  profileOut: '#e6dfd0',
};

const PORCELANA: typeof NEON = {
  fpBidRamp: ['#e2e7ee', '#d1c7ba', '#c0a887', '#ae8952', '#9c6a00'],
  fpAskRamp: ['#e2e7ee', '#afc2e7', '#7d9edd', '#4d78d2', '#1d4fc4'],
  fpDeltaPosRamp: ['#e2e7ee', '#afc2e7', '#7d9edd', '#4d78d2', '#1d4fc4'],
  fpDeltaNegRamp: ['#e2e7ee', '#d1c7ba', '#c0a887', '#ae8952', '#9c6a00'],
  fpText: '#151a24',
  fpTextLight: '#fafbfd',
  profileVa: '#d5dce6',
  profileOut: '#e6eaf0',
};

const GLEBINA: typeof NEON = {
  fpBidRamp: ['#13262f', '#4c3a3c', '#854c48', '#c15c52', '#ff6b5a'],
  fpAskRamp: ['#13262f', '#235651', '#318b76', '#3fc39c', '#4dffc3'],
  fpDeltaPosRamp: ['#13262f', '#235651', '#318b76', '#3fc39c', '#4dffc3'],
  fpDeltaNegRamp: ['#13262f', '#4c3a3c', '#854c48', '#c15c52', '#ff6b5a'],
  fpText: '#01070d',
  fpTextLight: '#eefbff',
  profileVa: '#1d3a46',
  profileOut: '#0f242d',
};

const ZMIERZCH: typeof NEON = {
  fpBidRamp: ['#2e1a31', '#592e3a', '#89423f', '#bb5640', '#f06a3c'],
  fpAskRamp: ['#2e1a31', '#404755', '#4a777c', '#4baaa4', '#3fe0cf'],
  fpDeltaPosRamp: ['#2e1a31', '#404755', '#4a777c', '#4baaa4', '#3fe0cf'],
  fpDeltaNegRamp: ['#2e1a31', '#592e3a', '#89423f', '#bb5640', '#f06a3c'],
  fpText: '#140a17',
  fpTextLight: '#fbf2f8',
  profileVa: '#3e2742',
  profileOut: '#26162a',
};

const MALACHIT: typeof NEON = {
  fpBidRamp: ['#173a2c', '#544d34', '#8c5e39', '#c46d3c', '#ff7a3d'],
  fpAskRamp: ['#173a2c', '#4e6452', '#85917b', '#c1c1a8', '#fff3d6'],
  fpDeltaPosRamp: ['#173a2c', '#4e6452', '#85917b', '#c1c1a8', '#fff3d6'],
  fpDeltaNegRamp: ['#173a2c', '#544d34', '#8c5e39', '#c46d3c', '#ff7a3d'],
  fpText: '#03170f',
  fpTextLight: '#f4fbf7',
  profileVa: '#21503d',
  profileOut: '#123526',
};

const FIGS: Record<ChartPalette, typeof NEON> = {
  neon: NEON,
  desk: DESK,
  drzeworyt: DRZEWORYT,
  porcelana: PORCELANA,
  glebina: GLEBINA,
  zmierzch: ZMIERZCH,
  malachit: MALACHIT,
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
