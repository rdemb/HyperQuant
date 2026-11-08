/** Fałszywy magazyn rynku wykresu (`InputStore`) dla testów wejść Czwórki: strony (`readFourInputs`) i serwera MCP. */
import type { InputSeries, InputStore } from '../../../../charts/pro/chart/layoutInputs';
import type { Candle } from '../../../../charts/pro/hl/parse';
import { NOW } from '../../../../utils/__tests__/fixtures/fourNumbers';

export type SeriesSpec = { state?: InputSeries['loadState']; list?: Candle[] };

const STEP: Record<string, number> = { '1m': 60_000, '5m': 300_000, '1h': 3_600_000 };

/**
 * Magazyn rynku `coin` z seriami `series` (seria bez opisu — wczytuje się); `older` zapisuje, od kiedy wejścia prosiły
 * o świece. `trim` — magazyn, który doczytał historię dokładnie do żądanego początku (od pełnej świecy), jak seria po
 * doczytaniu starszych stron; bez niego `indicatorCandles` oddaje całą listę serii.
 */
export function fakeStore(coin: string, series: Record<string, SeriesSpec>, o: { now?: number; lastPrice?: number; trim?: boolean } = {}) {
  const older: Record<string, number[]> = {};
  const made = new Map<string, InputSeries>();
  const st: InputStore & { older: Record<string, number[]> } = {
    older,
    coin,
    serverNow: () => o.now ?? NOW,
    lastPrice: () => o.lastPrice ?? 100_950,
    series(id: string): InputSeries {
      let s = made.get(id);
      if (!s) {
        const spec = series[id] ?? { state: 'loading' };
        s = { loadState: spec.state ?? 'ready', load: async () => {}, candlesNow: () => spec.list ?? [], historyExhausted: false, olderFailed: false };
        made.set(id, s);
      }
      return s;
    },
    indicatorCandles(id: string, from: number) {
      (older[id] ??= []).push(from);
      const list = st.series(id).candlesNow();
      if (!o.trim) return list;
      const step = STEP[id] ?? 60_000;
      const first = Math.floor(from / step) * step;
      return list.filter((c) => c.t >= first);
    },
    exactBook: () => null,
    zeroKnown: { covers: () => false },
    orders: { range: () => [] },
  };
  return st;
}
