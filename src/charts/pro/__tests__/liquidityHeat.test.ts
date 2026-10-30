import { afterAll, describe, expect, it, vi } from 'vitest';
import { BookHistory, type BookFrame } from '../core/book';

// Płótno bez przeglądarki: ImageData jako tablica pikseli, putImageData z prostokątem kopiuje do „ekranu” tekstury
class FakeCtx {
  screen = new Uint32Array(0);
  w = 0;
  puts = 0;
  /** Szerokość ostatnio kopiowanego prostokąta (px). */
  lastW = 0;
  createImageData(w: number, h: number) {
    if (this.w !== w || this.screen.length !== w * h) {
      this.w = w;
      this.screen = new Uint32Array(w * h);
    }
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) } as unknown as ImageData;
  }
  putImageData(img: ImageData, _dx: number, _dy: number, x = 0, y = 0, w = img.width, h = img.height) {
    this.puts++;
    this.lastW = w;
    const src = new Uint32Array(img.data.buffer);
    for (let r = y; r < y + h; r++) this.screen.set(src.subarray(r * img.width + x, r * img.width + x + w), r * img.width + x);
  }
}
vi.stubGlobal('document', { documentElement: { dataset: {} }, createElement: () => ({ width: 0, height: 0, ctx: new FakeCtx(), getContext() { return this.ctx; } }) });
afterAll(() => vi.unstubAllGlobals());
const { LiquidityLayer } = await import('../chart/liquidity');

/** Liczba różnych pikseli (porównanie 720 tys. elementów przez toEqual trwa sekundy). */
function diff(a: Uint32Array, b: Uint32Array): number {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

const MS = 60_000;
const T0 = Date.UTC(2026, 9, 30, 12);
const W = 1200;
const H = 600;
const N_BARS = 120;
const SP = W / N_BARS;
const bars = Array.from({ length: N_BARS }, (_, i) => ({ t: T0 + i * MS, candle: { o: 80_000, h: 80_050, l: 79_950, c: 80_000, v: 1 } }));

/** Migawka arkusza 20 + 20 poziomów wokół ceny, wielkości zależne od czasu i poziomu (powtarzalne). */
function frame(t: number, step: number): BookFrame {
  const px: number[] = [];
  const sz: number[] = [];
  for (let i = 0; i < 20; i++) (px.push(80_000 - step * (i + 1)), sz.push(1 + ((t / 5400 + i * 7) % 13)));
  for (let i = 0; i < 20; i++) (px.push(80_000 + step * (i + 1)), sz.push(1 + ((t / 5400 + i * 5) % 11)));
  return { t, step, px: Float64Array.from(px), sz: Float64Array.from(sz), n: new Float64Array(40).fill(Number.NaN), nBids: 20 };
}

function layer(near: BookHistory, far: BookHistory, now: number) {
  const l = new LiquidityLayer({ showHeatmap: true, showBubbles: false, showClashes: false, showLots: false } as never);
  const chart = {
    timeScale: () => ({ getVisibleLogicalRange: () => ({ from: 0, to: N_BARS }), logicalToCoordinate: (x: number) => x * SP }),
  };
  const series = { priceToCoordinate: (p: number) => H / 2 - (p - 80_000) * 0.5 };
  l.attached({ chart, series, requestUpdate: () => undefined } as never);
  l.setDom(false);
  l.setData(bars as never, MS, { near, far, orders: () => [], walls: () => [] }, now, 1e9);
  return l;
}

function draw(l: InstanceType<typeof LiquidityLayer>): FakeCtx {
  l.updateAllViews();
  const target = { useMediaCoordinateSpace: (cb: (s: unknown) => void) => cb({ context: { drawImage: () => undefined }, mediaSize: { width: W, height: H } }) };
  l.paneViews()[0].renderer()!.draw(target as never);
  return (l as unknown as { tex: { ctx: FakeCtx } }).tex.ctx;
}

function histories(until: number) {
  const near = new BookHistory(1);
  const far = new BookHistory(10);
  for (let t = T0; t <= until; t += 5_400) (near.add(frame(t, 1)), far.add(frame(t + 2_700, 10)));
  // Ostatnia daleka migawka w przyszłości względem zegara strony (rozjazd zegarów)
  far.add(frame(until + 4_000, 10));
  return { near, far };
}

describe('mapa ciepła: upływ czasu domalowuje tylko nowe kolumny', () => {
  it('bez nowej migawki obraz jest piksel w piksel jak pełne malowanie, a kopiowany pasek ma kilka kolumn', () => {
    const last = T0 + 100 * MS;
    const { near, far } = histories(last);
    const live = layer(near, far, last + 1_000);
    const ctx = draw(live);
    // Co 10 s (1,7 px przy 10 px na świecę 1m), także przez wejście dalekiej migawki z przyszłości i limit 60 s migawki
    for (let s = 1; s <= 8; s++) {
      live.setData(bars as never, MS, { near, far, orders: () => [], walls: () => [] }, last + s * 10_000, 1e9);
      draw(live);
      expect(diff(ctx.screen, draw(layer(near, far, last + s * 10_000)).screen)).toBe(0);
      if (s === 2) expect(ctx.lastW).toBeLessThanOrEqual(3);
    }
    expect(ctx.screen.some((v) => v !== 0)).toBe(true);
  });

  it('nowa migawka, nowa historia (powtórka) albo zmiana widoku → pełne malowanie', () => {
    const last = T0 + 100 * MS;
    const { near, far } = histories(last);
    const l = layer(near, far, last + 1_000);
    draw(l);
    near.add(frame(last + 5_400, 1));
    l.setData(bars as never, MS, { near, far, orders: () => [], walls: () => [] }, last + 6_000, 1e9);
    const ctx = draw(l);
    expect(diff(ctx.screen, draw(layer(near, far, last + 6_000)).screen)).toBe(0);
    const fresh = histories(last);
    l.setData(bars as never, MS, { near: fresh.near, far: fresh.far, orders: () => [], walls: () => [] }, last + 7_000, 1e9);
    expect(diff(draw(l).screen, draw(layer(fresh.near, fresh.far, last + 7_000)).screen)).toBe(0);
  });

  it('domalowanie upływu czasu jest wielokrotnie tańsze od pełnego malowania (2 h migawek, 1200×600 px)', () => {
    const last = T0 + 119 * MS;
    const { near, far } = histories(last);
    const runs = 30;
    let fullMs = 0;
    for (let i = 0; i < runs; i++) {
      const l = layer(near, far, last + 1_000);
      const a = performance.now();
      draw(l);
      fullMs += performance.now() - a;
    }
    const l = layer(near, far, last + 1_000);
    draw(l);
    let tailMs = 0;
    for (let i = 0; i < runs; i++) {
      l.setData(bars as never, MS, { near, far, orders: () => [], walls: () => [] }, last + 1_000 + (i + 1) * 100, 1e9);
      const a = performance.now();
      draw(l);
      tailMs += performance.now() - a;
    }
    expect(tailMs * 3).toBeLessThan(fullMs);
  });
});
