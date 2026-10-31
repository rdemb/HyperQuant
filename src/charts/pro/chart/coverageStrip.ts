import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, Logical, SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { Span } from '../core/coverage';
import type { IndicatorId } from '../indicators/registry';
import type { ProStore } from '../store/proStore';
import type { ChartSettings } from './settings';
import { logicalOfTime } from './overlay';
import { tr } from '../../../i18n';

/**
 * Pasek pokrycia danych pod osią czasu: dla każdego źródła spoza świec, którego potrzebują włączone warstwy i wskaźniki
 * wykresu (taśma, konta biorców, znaczniki TWAP, arkusz, arkusz dokładny, OI), wiersz z odcinkami czasu, w których to
 * źródło jest. Wyjaśnia „pusty” wskaźnik: świece poza odcinkiem nie mają tych danych, a nie wartości zero.
 */

export type DataSource = 'tape' | 'accounts' | 'twap' | 'book' | 'exact' | 'oi';

export const SOURCE_ORDER: readonly DataSource[] = ['tape', 'accounts', 'twap', 'book', 'exact', 'oi'];

export const SOURCE_INFO: Readonly<Record<DataSource, { label: string; hint: string; color: string }>> = {
  tape: {
    label: tr('Taśma', 'Tape'),
    hint: tr(
      'Transakcje Hyperliquid: nagranie od otwarcia strony i zapis serwera z ostatniej doby',
      'Hyperliquid trades: recorded since the page opened plus the server recording of the last day'
    ),
    color: '#2fd8c8',
  },
  accounts: {
    label: tr('Konta biorców', 'Taker accounts'),
    hint: tr(
      'Taśma z kontami biorców (strumień na żywo i zapis serwera; zapis przeglądarki ich nie ma)',
      'Tape with taker accounts (live stream and server recording; the browser recording has none)'
    ),
    color: '#4a9eff',
  },
  twap: {
    label: tr('Znaczniki TWAP', 'TWAP marks'),
    hint: tr(
      'Taśma z oznaczonym hashem zerowym (strumień na żywo i nowsze pliki zapisu serwera)',
      'Tape with the zero hash marked (live stream and newer server recording files)'
    ),
    color: '#c084fc',
  },
  book: {
    label: tr('Arkusz', 'Book'),
    hint: tr('Migawki arkusza co ok. 5 s; przerwa dłuższa niż 12 s to luka', 'Book snapshots every ~5 s; a pause longer than 12 s is a gap'),
    color: '#d08a10',
  },
  exact: {
    label: tr('Arkusz dokładny', 'Exact book'),
    hint: tr(
      'Migawki arkusza bez agregacji ceny; przerwa dłuższa niż 12 s to luka',
      'Book snapshots without price aggregation; a pause longer than 12 s is a gap'
    ),
    color: '#f6c177',
  },
  oi: {
    label: 'OI',
    hint: tr(
      'Odczyty otwartych pozycji Hyperliquid; przerwa dłuższa niż 3 min to luka',
      'Hyperliquid open interest readings; a pause longer than 3 min is a gap'
    ),
    color: '#a0aec0',
  },
};

/** Przerwa między migawkami arkusza, po której jest luka (jak w OFI), i między odczytami OI (jak w panelu ΔOI). */
export const BOOK_GAP_MS = 12_000;
export const OI_GAP_MS = 3 * 60_000;

/** Źródła wskaźników spoza świec (rejestr): z czego liczą wartość świecy. */
const INDICATOR_NEEDS: Partial<Record<IndicatorId, readonly DataSource[]>> = {
  oiflow: ['tape', 'oi'],
  absorption: ['tape'],
  ordersize: ['tape'],
  ofi: ['book'],
  slippage: ['exact'],
  breadth: ['accounts'],
  repeat: ['accounts'],
  makers: ['accounts'],
  hawkes: ['accounts'],
  twap: ['twap'],
};

/** Źródła potrzebne włączonym warstwom, panelom i widocznym wskaźnikom wykresu, w stałej kolejności. */
export function needsOf(s: ChartSettings): DataSource[] {
  const need = new Set<DataSource>();
  if (s.view === 'footprint' || s.showDelta || s.showCvd || s.showTape || s.showZones || s.showAuctions || s.showBubbles) need.add('tape');
  if (s.showStats && s.statGroups.includes('tape')) need.add('tape');
  if (s.showClashes || s.showLots || (s.showStats && s.statGroups.includes('who'))) need.add('accounts');
  if (s.showStats && s.statGroups.includes('hl')) need.add('tape').add('oi');
  if (s.showHeatmap) need.add('book');
  for (const ind of s.indicators) if (ind.visible) for (const src of INDICATOR_NEEDS[ind.id] ?? []) need.add(src);
  return SOURCE_ORDER.filter((x) => need.has(x));
}

/**
 * Odcinki z chwil próbek (rosnąco): przerwa dłuższa niż `maxGap` kończy odcinek. Odcinek trwa od pierwszej do ostatniej
 * próbki, a ostatni — do `now`, gdy ostatnia próbka jest od niego bliżej niż `maxGap` (dane płyną).
 */
export function spansFromSamples(times: ArrayLike<number>, maxGap: number, now: number): Span[] {
  const out: Span[] = [];
  const n = times.length;
  if (n === 0) return out;
  let a = times[0];
  for (let i = 1; i < n; i++) {
    if (times[i] - times[i - 1] > maxGap) {
      if (times[i - 1] > a) out.push([a, times[i - 1]]);
      a = times[i];
    }
  }
  const last = times[n - 1];
  const end = now - last <= maxGap && now > last ? now : last;
  if (end > a) out.push([a, end]);
  return out;
}

/** Wiersz paska; `all` — jeden wiersz telefonu: czas, w którym są naraz wszystkie potrzebne źródła. */
export interface CoverageRow {
  src: DataSource | 'all';
  spans: readonly Span[];
}

/** Część wspólna odcinków (każda lista rosnąco i rozłączna). */
export function intersectSpans(lists: readonly (readonly Span[])[]): Span[] {
  if (lists.length === 0) return [];
  let acc: Span[] = lists[0].map(([a, b]) => [a, b]);
  for (let k = 1; k < lists.length; k++) {
    const other = lists[k];
    const out: Span[] = [];
    let i = 0;
    let j = 0;
    while (i < acc.length && j < other.length) {
      const a = Math.max(acc[i][0], other[j][0]);
      const b = Math.min(acc[i][1], other[j][1]);
      if (b > a) out.push([a, b]);
      if (acc[i][1] < other[j][1]) i++;
      else j++;
    }
    acc = out;
  }
  return acc;
}

/** Telefon: przy kilku źródłach jeden wiersz z ich częścią wspólną (szczegóły w legendzie paska stanu). */
export const mergedRows = (rows: readonly CoverageRow[]): CoverageRow[] =>
  rows.length > 1 ? [{ src: 'all', spans: intersectSpans(rows.map((r) => r.spans)) }] : [...rows];

/** Dane do wierszy paska: tylko to, co sklep wykresu już trzyma. */
export interface CoverageSource {
  coverage: { snapshot(now: number): Span[] };
  addressed: { snapshot(now: number): Span[] };
  zeroKnown: { snapshot(now: number): Span[] };
  bookTimes(): readonly number[];
  exactTimes(): readonly number[];
  oiTimes(): readonly number[];
}

/** Źródło wierszy ze sklepu wykresu. */
export const storeSource = (st: ProStore): CoverageSource => ({
  coverage: st.coverage,
  addressed: st.addressed,
  zeroKnown: st.zeroKnown,
  bookTimes: () =>
    st
      .book('near')
      ?.list()
      .map((f) => f.t) ?? [],
  exactTimes: () =>
    st
      .exactBook()
      ?.list()
      .map((f) => f.t) ?? [],
  oiTimes: () => st.oi.times(),
});

export function coverageRows(src: CoverageSource, needs: readonly DataSource[], now: number): CoverageRow[] {
  return needs.map((s) => {
    switch (s) {
      case 'tape':
        return { src: s, spans: src.coverage.snapshot(now) };
      case 'accounts':
        return { src: s, spans: src.addressed.snapshot(now) };
      case 'twap':
        return { src: s, spans: src.zeroKnown.snapshot(now) };
      case 'book':
        return { src: s, spans: spansFromSamples(src.bookTimes(), BOOK_GAP_MS, now) };
      case 'exact':
        return { src: s, spans: spansFromSamples(src.exactTimes(), BOOK_GAP_MS, now) };
      case 'oi':
        return { src: s, spans: spansFromSamples(src.oiTimes(), OI_GAP_MS, now) };
    }
  });
}

/** Tło wiersza (czas bez danych) i wysokość wiersza: przy więcej niż trzech źródłach cieńsze, żeby nie wejść na etykiety osi. */
const TRACK = 'rgba(255,255,255,0.07)';
export const ALL_COLOR = '#e2e8f0';
export const rowColor = (src: CoverageRow['src']): string => (src === 'all' ? ALL_COLOR : SOURCE_INFO[src].color);
const rowPx = (rows: number) => (rows > 3 ? 1 : 2);
const GAP_PX = 1;
const BOTTOM_PX = 1;

/** Prymityw serii rysujący wiersze pokrycia w dolnej części osi czasu. */
export class CoverageStrip implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private rows: readonly CoverageRow[] = [];
  private bars: readonly { t: number }[] = [];
  private ms = 60_000;
  private segs: { row: number; x0: number; x1: number }[] = [];
  private width = 0;
  /** Prawa krawędź bieżącej świecy: dalej jest przyszłość, nie brak danych. */
  private trackEnd = 0;
  private readonly views: readonly IPrimitivePaneView[];

  constructor() {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          const n = this.rows.length;
          if (n === 0) return;
          const h = rowPx(n);
          const yOf = (r: number) => mediaSize.height - BOTTOM_PX - (n - r) * (h + GAP_PX) + GAP_PX;
          const w = Math.min(this.trackEnd, mediaSize.width);
          ctx.fillStyle = TRACK;
          for (let r = 0; r < n; r++) ctx.fillRect(0, yOf(r), w, h);
          for (const s of this.segs) {
            ctx.fillStyle = rowColor(this.rows[s.row].src);
            ctx.fillRect(s.x0, yOf(s.row), Math.max(1, s.x1 - s.x0), h);
          }
        }),
    };
    this.views = [{ zOrder: () => 'top', renderer: () => renderer }];
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart;
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.requestUpdate = null;
  }

  setData(rows: readonly CoverageRow[], bars: readonly { t: number }[], ms: number): void {
    this.rows = rows;
    this.bars = bars;
    this.ms = ms;
    this.requestUpdate?.();
  }

  updateAllViews(): void {
    this.segs = [];
    const chart = this.chart;
    const bars = this.bars;
    if (!chart || this.rows.length === 0 || bars.length === 0) return;
    const ts = chart.timeScale();
    const xa = ts.logicalToCoordinate(0 as Logical);
    const xb = ts.logicalToCoordinate(1 as Logical);
    if (xa === null || xb === null) return;
    const sp = xb - xa;
    this.width = ts.width();
    // Lewa krawędź świecy zawierającej chwilę t (jak granice okresów na wykresie ceny)
    const x = (t: number) => xa + (logicalOfTime(bars, t, this.ms) - 0.5) * sp;
    const first = bars[0].t;
    this.trackEnd = Math.max(0, Math.min(this.width, x(bars[bars.length - 1].t + this.ms)));
    this.rows.forEach((row, r) => {
      for (const [a, b] of row.spans) {
        if (b <= first) continue;
        const x0 = Math.max(0, x(Math.max(a, first)));
        const x1 = Math.min(this.width, x(b));
        if (x1 > x0) this.segs.push({ row: r, x0, x1 });
      }
    });
  }

  timeAxisPaneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }
}
