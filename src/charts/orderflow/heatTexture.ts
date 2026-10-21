import { buildHeatLut, heatT } from './heatColor';
import type { OrderFlowStore } from './orderFlowStore';
import { HistQuantile } from './quantile';
import { Frame, timeToX } from './scales';

/**
 * Tekstura heatmapy w przestrzeni danych: x = slot pierścienia magazynu (1 kolumna = 1 s),
 * y = siatka cen (krok kubełka arkusza). Nowe kolumny dopisywane przez ImageData (bez
 * przerysowywania historii); widok to jedno lub dwa drawImage z przeskalowaniem.
 * Normalizacja (p99 w widocznym oknie) zmienia się rzadko — przemalowujemy wtedy tylko
 * widoczne kolumny (wersja normy per slot).
 */
export class HeatTexture {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private readonly px: Uint32Array;
  private readonly lut = buildHeatLut();
  private readonly colVer: Uint32Array;
  private readonly rowLo: Int16Array;
  private readonly rowHi: Int16Array;
  private readonly hist = new HistQuantile(0, 10, 1000);

  gridTop = Number.NaN;
  gridStep = Number.NaN;
  normLog = Number.NaN;
  contrast = 1;
  private normVer = 1;
  private normAt = -Infinity;
  private paintedUntil = -1;
  private dirtyX0 = Infinity;
  private dirtyX1 = -Infinity;
  private dirtyR0 = Infinity;
  private dirtyR1 = -Infinity;

  constructor(
    readonly cap: number,
    readonly rows = 512
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = cap;
    this.canvas.height = rows;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Brak kontekstu 2D dla tekstury heatmapy');
    this.ctx = ctx;
    this.img = ctx.createImageData(cap, rows);
    this.px = new Uint32Array(this.img.data.buffer);
    this.colVer = new Uint32Array(cap);
    this.rowLo = new Int16Array(cap).fill(-1);
    this.rowHi = new Int16Array(cap).fill(-1);
  }

  /** Kontrast z suwaka (1 = auto p99). */
  setContrast(k: number): void {
    if (k === this.contrast) return;
    this.contrast = k;
    this.normVer++;
  }

  /** Dopisuje nowe kolumny z magazynu; przy zmianie siatki — pełne przemalowanie. */
  sync(store: OrderFlowStore): void {
    const last = store.lastBookSec;
    if (last < 0) return;
    const lastSlot = store.slotOf(last);
    const mid = store.colMid[lastSlot];
    const step = store.colStep[lastSlot];
    const span = this.rows * this.gridStep;
    const needGrid =
      !(this.gridStep > 0) ||
      step < this.gridStep * 0.99 ||
      mid > this.gridTop - span * 0.1 ||
      mid < this.gridTop - span * 0.9;
    if (needGrid) {
      // Siatka: najmniejszy krok, środek na bieżącej cenie (ruch > ±40% zakresu → kotwiczenie od nowa)
      this.gridStep = step > 0 ? step : 10;
      this.gridTop = Math.round(mid / this.gridStep) * this.gridStep + (this.rows / 2) * this.gridStep;
      this.repaintAll(store);
      return;
    }
    const oldest = store.oldestBookSec();
    if (this.paintedUntil < 0 || last - this.paintedUntil >= this.cap) {
      this.repaintAll(store);
      return;
    }
    // Ostatnia kolumna mogła zostać nadpisana nowszym snapshotem z tej samej sekundy
    for (let s = Math.max(oldest, this.paintedUntil); s <= last; s++) this.paintSec(store, s);
    this.paintedUntil = last;
  }

  private repaintAll(store: OrderFlowStore): void {
    this.px.fill(0);
    this.rowLo.fill(-1);
    this.rowHi.fill(-1);
    const last = store.lastBookSec;
    for (let s = store.oldestBookSec(); s <= last; s++) this.paintSec(store, s);
    this.paintedUntil = last;
    this.dirtyX0 = 0;
    this.dirtyX1 = this.cap - 1;
    this.dirtyR0 = 0;
    this.dirtyR1 = this.rows - 1;
  }

  /** Maluje kolumnę sekundy (pustą, gdy brak danych) bieżącą normą. */
  private paintSec(store: OrderFlowStore, sec: number): void {
    const slot = store.slotOf(sec);
    const W = this.cap;
    const px = this.px;
    // Czyścimy tylko wcześniej pomalowane wiersze tego slotu
    const lo0 = this.rowLo[slot];
    if (lo0 >= 0) {
      for (let r = lo0, hi0 = this.rowHi[slot]; r <= hi0; r++) px[r * W + slot] = 0;
      if (lo0 < this.dirtyR0) this.dirtyR0 = lo0;
      if (this.rowHi[slot] > this.dirtyR1) this.dirtyR1 = this.rowHi[slot];
    }
    let lo = 32767;
    let hi = -1;
    if (store.hasColumn(sec) && this.normLog > 0) {
      const n = store.colCount[slot];
      const base = slot * store.maxLevels;
      const k = Math.max(1, Math.round(store.colStep[slot] / this.gridStep));
      const back = (k - 1) >> 1;
      for (let i = 0; i < n; i++) {
        const t = heatT(store.lvSz[base + i], this.normLog, this.contrast);
        if (t <= 0) continue;
        const color = this.lut[(t * 255) | 0];
        const rc = Math.round((this.gridTop - store.lvPx[base + i]) / this.gridStep);
        let r0 = rc - back;
        let r1 = r0 + k - 1;
        if (r1 < 0 || r0 >= this.rows) continue;
        if (r0 < 0) r0 = 0;
        if (r1 >= this.rows) r1 = this.rows - 1;
        for (let r = r0; r <= r1; r++) px[r * W + slot] = color;
        if (r0 < lo) lo = r0;
        if (r1 > hi) hi = r1;
      }
    }
    this.rowLo[slot] = hi >= 0 ? lo : -1;
    this.rowHi[slot] = hi;
    this.colVer[slot] = this.normVer;
    if (slot < this.dirtyX0) this.dirtyX0 = slot;
    if (slot > this.dirtyX1) this.dirtyX1 = slot;
    if (hi >= 0) {
      if (lo < this.dirtyR0) this.dirtyR0 = lo;
      if (hi > this.dirtyR1) this.dirtyR1 = hi;
    }
  }

  /**
   * Auto-kontrast: p99 z log1p(rozmiar) w widocznych sekundach (co ≥ 400 ms).
   * Zmiana > 7% → nowa wersja normy; widoczne kolumny przemalowane w `refreshVisible`.
   */
  updateNorm(store: OrderFlowStore, s0: number, s1: number, nowPerf: number): boolean {
    if (nowPerf - this.normAt < 400 && this.normLog > 0) return false;
    this.normAt = nowPerf;
    const from = Math.max(s0, store.oldestBookSec());
    const to = Math.min(s1, store.lastBookSec);
    if (to < from) return false;
    const h = this.hist;
    h.reset();
    // Duże okna próbkujemy co n-tą sekundę (stały koszt)
    const stride = Math.max(1, Math.floor((to - from + 1) / 1800));
    for (let s = from; s <= to; s += stride) {
      if (!store.hasColumn(s)) continue;
      const slot = store.slotOf(s);
      const base = slot * store.maxLevels;
      for (let i = 0, n = store.colCount[slot]; i < n; i++) h.add(Math.log1p(store.lvSz[base + i]));
    }
    const q = h.quantile(0.99);
    if (!(q > 0)) return false;
    if (this.normLog > 0 && Math.abs(q - this.normLog) / this.normLog <= 0.07) return false;
    this.normLog = q;
    this.normVer++;
    return true;
  }

  /**
   * Przemalowuje widoczne kolumny pomalowane starszą wersją normy — od najnowszych, najwyżej
   * `budget` na klatkę (bez skoków czasu klatki). Zwraca true, gdy zostały zaległe kolumny.
   */
  refreshVisible(store: OrderFlowStore, s0: number, s1: number, budget = 2000): boolean {
    const from = Math.max(s0, store.oldestBookSec());
    const to = Math.min(s1, store.lastBookSec);
    let n = 0;
    for (let s = to; s >= from; s--) {
      if (this.colVer[store.slotOf(s)] === this.normVer) continue;
      if (n++ >= budget) return true;
      this.paintSec(store, s);
    }
    return false;
  }

  /** Wysyła zmieniony prostokąt ImageData do płótna tekstury. */
  flush(): void {
    if (this.dirtyX1 < this.dirtyX0) return;
    const r0 = Number.isFinite(this.dirtyR0) ? this.dirtyR0 : 0;
    const r1 = this.dirtyR1 >= r0 ? this.dirtyR1 : r0;
    this.ctx.putImageData(this.img, 0, 0, this.dirtyX0, r0, this.dirtyX1 - this.dirtyX0 + 1, r1 - r0 + 1);
    this.dirtyX0 = Infinity;
    this.dirtyX1 = -Infinity;
    this.dirtyR0 = Infinity;
    this.dirtyR1 = -Infinity;
  }

  /** Rysuje widoczny wycinek (z zawinięciem pierścienia) w prostokąt ramki. */
  draw(ctx: CanvasRenderingContext2D, f: Frame, store: OrderFlowStore): void {
    if (!(this.gridStep > 0) || store.lastBookSec < 0) return;
    const sA = Math.max(Math.floor(f.t0 / 1000), store.oldestBookSec());
    const sB = Math.min(Math.ceil(f.t1 / 1000), store.lastBookSec + 1);
    if (sB <= sA) return;
    // Wiersze tekstury: środek wiersza r = gridTop − r·krok
    const ty = (p: number) => (this.gridTop - p) / this.gridStep + 0.5;
    const tTop = ty(f.pMax);
    const tBot = ty(f.pMin);
    const pxPerRow = (f.y1 - f.y0) / (tBot - tTop);
    const syA = Math.max(0, tTop);
    const syB = Math.min(this.rows, tBot);
    if (syB <= syA) return;
    const yA = f.y0 + (syA - tTop) * pxPerRow;
    const yB = f.y0 + (syB - tTop) * pxPerRow;
    const secPx = (timeToX(f, 1000) - timeToX(f, 0));
    // Oddalenie (> 1.5 kolumny na piksel) → wygładzanie; przybliżenie → ostre komórki
    ctx.imageSmoothingEnabled = secPx < 0.67;
    if (ctx.imageSmoothingEnabled) ctx.imageSmoothingQuality = 'high';
    const slotA = store.slotOf(sA);
    const count = sB - sA;
    const part1 = Math.min(count, this.cap - slotA);
    const xA = timeToX(f, sA * 1000);
    ctx.drawImage(this.canvas, slotA, syA, part1, syB - syA, xA, yA, part1 * secPx, yB - yA);
    if (count > part1) {
      ctx.drawImage(this.canvas, 0, syA, count - part1, syB - syA, xA + part1 * secPx, yA, (count - part1) * secPx, yB - yA);
    }
    ctx.imageSmoothingEnabled = true;
  }
}
