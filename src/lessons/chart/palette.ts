/**
 * Kolory rycin, których nie ma w tokenach `of-*`: kafle footprintu, delta wiersza i profil wolumenu, w palecie „Głębia”. To kopia wartości z
 * src/charts/pro/chart/theme.ts, żeby lekcje nie ładowały biblioteki wykresów; test pilnuje zgodności z Wykresami.
 */

export const FIG = {
  // Bid: sprzedaż agresorów (żar), ask: kupno agresorów (lazur)
  fpBidRamp: ['#22262C', '#4A333B', '#733939', '#9E3B34', '#CA3829'],
  fpAskRamp: ['#22262C', '#253E5F', '#2A5387', '#2F69B1', '#3280DD'],
  fpDeltaPosRamp: ['#22262C', '#253E5F', '#2A5387', '#2F69B1', '#3280DD'],
  fpDeltaNegRamp: ['#22262C', '#4A333B', '#733939', '#9E3B34', '#CA3829'],
  fpText: '#0f1114',
  fpTextLight: '#eef2f7',
  profileVa: '#3a3f48',
  profileOut: '#24272d',
};

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
