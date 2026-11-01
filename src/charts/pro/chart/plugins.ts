import type { ISeriesPrimitive, Time } from 'lightweight-charts';
import type { ProBar, ProStore } from '../store/proStore';

/**
 * Wtyczki wykresu: własna warstwa na wykresie ceny z katalogu `src/plugins/<nazwa>/index.ts` (eksport domyślny
 * `ChartPlugin`). Katalog jest w .gitignore, więc wtyczka zostaje na komputerze, na którym ją dodano. Bez wtyczek lista
 * jest pusta i wykres działa jak dotąd.
 */

export interface ChartPluginLayer extends ISeriesPrimitive<Time> {
  /** Po każdej zmianie świec wykresu (jak warstwa stref); pozostałe dane wtyczka czyta z magazynu rynku. */
  setData(bars: readonly ProBar[], ms: number, now: number, store: ProStore): void;
  /** Szerokość drabiny DOM przy prawej krawędzi (px). */
  setRightInset?(px: number): void;
}

export interface ChartPlugin {
  id: string;
  create(): ChartPluginLayer;
}

const found = import.meta.glob<{ default: ChartPlugin }>('../../../plugins/*/index.ts', { eager: true });

export const CHART_PLUGINS: readonly ChartPlugin[] = Object.values(found).map((m) => m.default);
