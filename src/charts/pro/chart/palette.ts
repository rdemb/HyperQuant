/**
 * Paleta kolorów wykresów: „Neon” (domyślna — neonowa zieleń i fiolet na grafitowym tle), „Desk” (morska zieleń i miedź
 * na granatowym tle Desku) albo jedna z własnych: „Drzeworyt”, „Porcelana”, „Głębina”, „Zmierzch”, „Malachit”
 * (opisy w ./theme). Jedna dla wszystkich wykresów, zapamiętana w tej przeglądarce; atrybut `data-chart-palette`
 * na <html> przełącza tokeny `of-*` w src/index.css. Bez zależności od biblioteki wykresów — moduł ładuje się przy
 * starcie strony (lekcje też używają tokenów `of-*`).
 */
export const CHART_PALETTES = ['neon', 'desk', 'drzeworyt', 'porcelana', 'glebina', 'zmierzch', 'malachit'] as const;
export type ChartPalette = (typeof CHART_PALETTES)[number];

const PALETTE_KEY = 'hq.charts.palette.v1';

function savedPalette(): ChartPalette {
  try {
    const p = localStorage.getItem(PALETTE_KEY);
    return CHART_PALETTES.find((x) => x === p) ?? 'neon';
  } catch {
    // Zablokowany localStorage: paleta domyślna
    return 'neon';
  }
}

export const PALETTE: ChartPalette = savedPalette();

if (typeof document !== 'undefined') document.documentElement.dataset.chartPalette = PALETTE;

/** Zmiana palety przeładowuje stronę: kolory płótna są liczone raz, przy ładowaniu modułów wykresu. */
export function setPalette(p: ChartPalette): void {
  if (p === PALETTE) return;
  try {
    localStorage.setItem(PALETTE_KEY, p);
  } catch {
    return;
  }
  window.location.reload();
}
