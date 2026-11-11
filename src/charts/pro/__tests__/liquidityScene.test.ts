import { afterAll, describe, expect, it, vi } from 'vitest';
import { BookHistory, type BookFrame } from '../core/book';
import type { AggressorOrder } from '../core/orders';
import type { Wall } from '../core/clashes';

vi.stubGlobal('document', { documentElement: { dataset: {} }, createElement: () => ({ width: 0, height: 0, getContext: () => null }) });
afterAll(() => vi.unstubAllGlobals());
const { LiquidityLayer } = await import('../chart/liquidity');
type Layer = InstanceType<typeof LiquidityLayer>;

const MS = 60_000;
const T0 = Date.UTC(2026, 10, 7, 12);
const W = 1200;
const H = 600;
const N_BARS = 120;
const NOW = T0 + 119 * MS + 30_000;
const THRESHOLD = 100_000;
const ALL = { showHeatmap: true, showBubbles: true, showClashes: true, showLots: true };
const bars = Array.from({ length: N_BARS }, (_, i) => ({ t: T0 + i * MS, candle: { o: 80_000, h: 80_050, l: 79_950, c: 80_000, v: 1 } }));

/** Migawka 20 + 20 poziomów co 1 USD; na bidzie `big` jedno duże zlecenie (duże zlecenie arkusza). */
function frame(t: number, big = 79_990): BookFrame {
  const px: number[] = [];
  const sz: number[] = [];
  for (let i = 0; i < 20; i++) (px.push(80_000 - (i + 1)), sz.push(80_000 - (i + 1) === big ? 5 : 0.5 + (i % 3) * 0.1));
  for (let i = 0; i < 20; i++) (px.push(80_000 + (i + 1)), sz.push(0.4 + (i % 4) * 0.1));
  return { t, step: 1, px: Float64Array.from(px), sz: Float64Array.from(sz), n: new Float64Array(40).fill(1), nBids: 20 };
}

function order(time: number, side: 1 | -1, notional: number, taker: string, topMakerUsd = 0): AggressorOrder {
  const vwap = 80_000 + side * 5;
  return { time, side, sz: notional / vwap, notional, vwap, pxFirst: vwap, pxLast: vwap, fills: 1, levels: 1, taker, makers: 1, topMakerUsd };
}

/** Duże zlecenia (także bitwa) i seria małych zleceń pięciu biorców w 2 s. */
function makeOrders(): AggressorOrder[] {
  const out = [
    order(T0 + 10 * MS, 1, 450_000, '0xa'),
    order(T0 + 40 * MS, -1, 900_000, '0xb', 600_000),
    order(T0 + 80 * MS, 1, 150_000, '0xc'),
    order(T0 + 100 * MS, -1, 50_000, '0xabc'),
  ];
  for (let i = 0; i < 5; i++) out.push(order(T0 + 60 * MS + i * 300, 1, 22_000, `0xs${i}`));
  return out.sort((p, q) => p.time - q.time);
}

const WALLS: Wall[] = [
  { from: T0 + 50 * MS, to: T0 + 60 * MS, px: 79_985, side: 1, usd: 300_000, sz: 3.75, hits: 5, shown: 1, iceberg: true },
  { from: T0 + 20 * MS, to: T0 + 30 * MS, px: 80_015, side: -1, usd: 200_000, sz: 2.5, hits: 4, shown: 0, iceberg: false },
];

function setup() {
  const view = { x0: 0, sp: W / N_BARS, scale: 0.5, width: W };
  const near = new BookHistory(1);
  for (let t = NOW - 10 * 60_000; t <= NOW - 2_000; t += 5_000) near.add(frame(t));
  const orders = makeOrders();
  const store = { version: 0, history: 0 };
  const src = {
    near,
    far: null,
    orders: vi.fn((from: number, to: number) => orders.filter((o) => o.time >= from && o.time < to)),
    walls: vi.fn(() => WALLS),
    version: () => store.version,
    history: () => store.history,
  };
  const l = new LiquidityLayer({ ...ALL });
  const chart = {
    timeScale: () => ({ getVisibleLogicalRange: () => ({ from: 0, to: N_BARS }), logicalToCoordinate: (x: number) => view.x0 + x * view.sp }),
    paneSize: () => ({ width: view.width, height: H }),
  };
  const series = { priceToCoordinate: (p: number) => H / 2 - (p - 80_000) * view.scale };
  l.attached({ chart, series, requestUpdate: () => undefined } as never);
  // Próg ręczny = próg bieżący: ściany i serie mierzone tym samym progiem co bąble (bez szeregu godzinowego z taśmy)
  l.setData(bars as never, MS, src, NOW, THRESHOLD, THRESHOLD);
  return { l, src, near, view, orders, store };
}
type Setup = ReturnType<typeof setup>;

const arg = (v: unknown): string => (typeof v === 'number' ? v.toFixed(3) : typeof v === 'string' ? v : Array.isArray(v) ? JSON.stringify(v) : 'obj');

/** Zapis wszystkich wywołań i przypisań na płótnie (bez przeglądarki) — porównanie tego, co narysowane. */
function recorder() {
  const log: string[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === 'measureText') return (s: string) => ({ width: s.length * 6 });
      if (prop === 'createRadialGradient')
        return (...a: number[]) => {
          log.push(`grad(${a.map(arg).join(',')})`);
          return { addColorStop: (o: number, c: string) => log.push(`stop(${o},${c})`) };
        };
      return (...a: unknown[]) => log.push(`${prop}(${a.map(arg).join(',')})`);
    },
    set(target, prop: string, v) {
      log.push(`${prop}=${arg(v)}`);
      target[prop] = v;
      return true;
    },
  });
  return { ctx, log };
}

/** Bąble, ściany, duże zlecenia i podpisy (bez mapy ciepła) oraz drabina DOM w marginesie osi ceny. */
function drawn(l: Layer): string[] {
  const { ctx, log } = recorder();
  const scope = { context: ctx, bitmapSize: { width: W, height: H }, horizontalPixelRatio: 1, verticalPixelRatio: 1 };
  const target = { useBitmapCoordinateSpace: (cb: (s: unknown) => void) => cb(scope) };
  for (const v of [...l.paneViews().slice(1), ...l.priceAxisPaneViews()]) v.renderer()!.draw(target as never);
  return log;
}

describe('warstwa płynności: scena składana tylko po zmianie danych, widoku albo przełączników', () => {
  it('kolejne updateAllViews bez zmian nie składają sceny od nowa i rysują to samo', () => {
    const { l, src, near } = setup();
    const latest = vi.spyOn(near, 'latest');
    l.updateAllViews();
    const first = drawn(l);
    l.updateAllViews();
    l.updateAllViews();
    expect(src.orders).toHaveBeenCalledTimes(1);
    expect(src.walls).toHaveBeenCalledTimes(1);
    expect(latest).toHaveBeenCalledTimes(1);
    expect(drawn(l)).toEqual(first);
    // Scena nie jest pusta: bąble, seria, góra lodowa, duże zlecenie arkusza i drabina
    expect(first.filter((s) => s.startsWith('arc(')).length).toBeGreaterThan(4);
    expect(first.some((s) => s.startsWith('setLineDash(["3') || s.startsWith('setLineDash([3'))).toBe(true);
    expect(first.some((s) => s.startsWith('fillText(ICE'))).toBe(true);
    expect(first.some((s) => /^fillText\(1× /.test(s))).toBe(true);
  });

  const changes: [string, (s: Setup) => void][] = [
    ['setData z tymi samymi danymi (nowa synchronizacja)', (s) => s.l.setData(bars as never, MS, s.src, NOW, THRESHOLD, THRESHOLD)],
    ['upływ czasu', (s) => s.l.setData(bars as never, MS, s.src, NOW + 4_000, THRESHOLD, THRESHOLD)],
    ['inny próg dużego zlecenia', (s) => s.l.setData(bars as never, MS, s.src, NOW, 40_000, 40_000)],
    ['przewinięcie wykresu', (s) => (s.view.x0 = -35)],
    ['zbliżenie (odstęp świec)', (s) => (s.view.sp = 13)],
    ['skala ceny', (s) => (s.view.scale = 0.8)],
    ['szerokość panelu', (s) => (s.view.width = 900)],
    ['przełącznik warstwy', (s) => s.l.setToggles({ ...ALL, showLots: false })],
    ['podświetlony adres', (s) => s.l.setHighlight('0xabc')],
    ['zaznaczony bąbel', (s) => s.l.setSelected({ kind: 'order', order: s.orders.find((o) => o.notional === 900_000)!, cls: 'clash' })],
    ['drabina DOM wyłączona', (s) => s.l.setDom(false)],
    ['nowa migawka arkusza (bez setData)', (s) => s.near.add(frame(NOW - 500, 79_995))],
    [
      'nowe zlecenie w magazynie (wersja magazynu, bez setData)',
      (s) => {
        s.orders.push(order(T0 + 115 * MS, -1, 700_000, '0xd'));
        s.store.version++;
      },
    ],
  ];

  it.each(changes)('%s → scena złożona raz od nowa, jak w świeżej warstwie', (name, change) => {
    const s = setup();
    s.l.updateAllViews();
    const before = drawn(s.l);
    change(s);
    s.l.updateAllViews();
    s.l.updateAllViews();
    expect(s.src.orders).toHaveBeenCalledTimes(2);
    const fresh = setup();
    change(fresh);
    fresh.l.updateAllViews();
    const after = drawn(s.l);
    expect(after).toEqual(drawn(fresh.l));
    // Ta sama synchronizacja bez nowych danych rysuje to samo, każda inna zmiana zmienia obraz
    if (name === changes[0][0]) expect(after).toEqual(before);
    else expect(after).not.toEqual(before);
  });
});

describe('progi godzin między scenami (próg z chwili zdarzenia)', () => {
  const HOUR = 3_600_000;
  /** Zapytania o próg zamkniętej godziny: zlecenia godziny (serie i ściany) albo doby (bąble) przed jej początkiem. */
  const thresholdCalls = (s: Setup) => s.src.orders.mock.calls.filter(([from, to]) => to % HOUR === 0 && (to - from === HOUR || to - from === 24 * HOUR)).length;

  it('druga scena nie liczy progu zamkniętej godziny od nowa; doczytanie historii czyści pamięć', () => {
    const s = setup();
    s.l.setData(bars as never, MS, s.src, NOW, THRESHOLD, 0);
    s.l.updateAllViews();
    const first = thresholdCalls(s);
    expect(first).toBeGreaterThan(0);
    s.view.x0 = -35;
    s.l.updateAllViews();
    s.l.setData(bars as never, MS, s.src, NOW + 4_000, THRESHOLD, 0);
    s.l.updateAllViews();
    expect(s.src.orders.mock.calls.length).toBeGreaterThan(first + 1);
    expect(thresholdCalls(s)).toBe(first);
    s.store.history++;
    s.store.version++;
    s.l.updateAllViews();
    expect(thresholdCalls(s)).toBe(2 * first);
  });

  it('liczba bąbli zleceń na ekranie dla pomiaru układu (bez serii)', () => {
    const s = setup();
    const counts: number[] = [];
    s.l.onBubbles = (n) => counts.push(n);
    s.l.updateAllViews();
    // Próg ręczny 100 tys.: zlecenia 450 tys., 900 tys. i 150 tys.
    expect(counts).toEqual([3]);
  });
});
