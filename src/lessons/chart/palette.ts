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

const KOBALT: typeof NEON = {
  fpBidRamp: ['#262d3a', '#554a41', '#876843', '#bc873e', '#f4a62a'],
  fpAskRamp: ['#262d3a', '#2e4465', '#355c92', '#3a75c3', '#3d8ef5'],
  fpDeltaPosRamp: ['#262d3a', '#2e4465', '#355c92', '#3a75c3', '#3d8ef5'],
  fpDeltaNegRamp: ['#262d3a', '#554a41', '#876843', '#bc873e', '#f4a62a'],
  fpText: '#0c0f16',
  fpTextLight: '#eef2f7',
  profileVa: '#3a4457',
  profileOut: '#20262f',
};

const ZORZA: typeof NEON = {
  fpBidRamp: ['#24263f', '#51314f', '#7f395e', '#af3f6e', '#e0407e'],
  fpAskRamp: ['#24263f', '#36545c', '#458679', '#52bb97', '#5ef2b5'],
  fpDeltaPosRamp: ['#24263f', '#36545c', '#458679', '#52bb97', '#5ef2b5'],
  fpDeltaNegRamp: ['#24263f', '#51314f', '#7f395e', '#af3f6e', '#e0407e'],
  fpText: '#0a0b1d',
  fpTextLight: '#f0f1fa',
  profileVa: '#363a5c',
  profileOut: '#1f2238',
};

const LAKA: typeof NEON = {
  fpBidRamp: ['#2a2420', '#563027', '#833a2b', '#b3422e', '#e5482f'],
  fpAskRamp: ['#2a2420', '#54462e', '#816b3b', '#b29246', '#e6bb4f'],
  fpDeltaPosRamp: ['#2a2420', '#54462e', '#816b3b', '#b29246', '#e6bb4f'],
  fpDeltaNegRamp: ['#2a2420', '#563027', '#833a2b', '#b3422e', '#e5482f'],
  fpText: '#100d0c',
  fpTextLight: '#f4efe6',
  profileVa: '#3d3631',
  profileOut: '#231f1c',
};

const ATRAMENT: typeof NEON = {
  fpBidRamp: ['#25232b', '#47353f', '#6b4853', '#915c69', '#b9707f'],
  fpAskRamp: ['#25232b', '#434c4f', '#627977', '#83a9a1', '#a6dccd'],
  fpDeltaPosRamp: ['#25232b', '#434c4f', '#627977', '#83a9a1', '#a6dccd'],
  fpDeltaNegRamp: ['#25232b', '#47353f', '#6b4853', '#915c69', '#b9707f'],
  fpText: '#100f12',
  fpTextLight: '#e8e6ee',
  profileVa: '#37343f',
  profileOut: '#211f26',
};

const FIGS: Record<ChartPalette, typeof NEON> = { neon: NEON, desk: DESK, kobalt: KOBALT, zorza: ZORZA, laka: LAKA, atrament: ATRAMENT };

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
