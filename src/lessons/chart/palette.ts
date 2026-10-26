import { PALETTE } from '../../charts/pro/chart/palette';

/**
 * Kolory rycin, których nie ma w tokenach `of-*`: kafle footprintu, delta wiersza i profil wolumenu, w palecie wybranej
 * w Wykresach. To kopia wartości z src/charts/pro/chart/theme.ts, żeby lekcje nie ładowały biblioteki wykresów;
 * test pilnuje zgodności z Wykresami w obu paletach.
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

export const FIG = PALETTE === 'desk' ? DESK : NEON;

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
