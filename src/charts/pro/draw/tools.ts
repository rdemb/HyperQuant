import type { IChartApi } from 'lightweight-charts';
import type { DrawingLayer, LayerState } from './layer';
import {
  DrawStyle,
  Drawing,
  MAX_BRUSH_POINTS,
  MAX_DRAWINGS,
  Order,
  Pt,
  TOOLS,
  ToolKind,
  defaultStyle,
  dragHandle,
  moveDrawing,
  newPosition,
  parseDrawings,
  reorder,
  snapToOhlc,
  toolDef,
} from './model';

/**
 * Obsługa rysowania myszą, dotykiem i klawiaturą: stawianie punktów (klik-klik albo przeciągnięcie),
 * zaznaczanie i podświetlenie pod kursorem, przesuwanie rysunku i jego uchwytów (Ctrl + przeciągnięcie klonuje,
 * Shift trzyma linię poziomo), blokada, kolejność warstw, menu rysunku, magnes do OHLC, szybki pomiar z Shift,
 * cofanie i ponawianie, kopiowanie oraz zapis rysunków rynku w przeglądarce. Zdarzenia przejmowane w fazie przechwytywania,
 * więc w trakcie rysowania wykres się nie przesuwa.
 */

export interface DrawState {
  tool: ToolKind | null;
  selected: Drawing | null;
  magnet: boolean;
  hidden: boolean;
  locked: boolean;
  /** Narzędzie zostaje wybrane po postawieniu rysunku. */
  keep: boolean;
  count: number;
  canUndo: boolean;
  canRedo: boolean;
  /** Rośnie przy każdym nowym tekście do wpisania (pasek stylu ustawia wtedy kursor w polu). */
  editTick: number;
  /** Menu rysunku pod prawym przyciskiem: miejsce kliknięcia w pikselach panelu. */
  menu: DrawMenuAt | null;
}

export interface DrawMenuAt {
  x: number;
  y: number;
}

interface Pending {
  d: Drawing;
  /** Punkty już postawione (ostatni punkt `d.pts` idzie za kursorem). */
  placed: number;
  need: number;
  temp: boolean;
  downX: number;
  downY: number;
}

interface Drag {
  id: string;
  handle: number;
  start: Pt;
  orig: Pt[];
  before: Drawing[];
  moved: boolean;
  /** Ctrl + przeciągnięcie: przesuwana jest kopia, oryginał zostaje (bez ruchu kopia znika). */
  cloneOf: string | null;
}

const KEY = 'hq.charts.draw.v1';
const UNDO_MAX = 100;
/** Magnes przyciąga cenę do OHLC świecy z tej odległości (px). */
const MAGNET_PX = 24;
/** Przesunięcie wskaźnika, od którego wciśnięcie jest przeciągnięciem, a nie kliknięciem (px). */
const DRAG_PX = 4;
/** Pozycja z jednego kliknięcia: ryzyko i szerokość w pikselach ekranu (mieści się także na telefonie). */
const POSITION_RISK_PX = 40;
const POSITION_W_PX = 140;

const HOTKEYS = new Map(TOOLS.filter((t) => t.hotkey).map((t) => [`Key${t.hotkey}`, t.kind]));
/** Linie z dwóch punktów, które Shift trzyma poziomo (cena jak na drugim końcu). */
const FLAT = new Set<ToolKind>(['trend', 'ray', 'extended', 'arrow']);

/** Shift: linia z dwóch punktów zostaje pozioma (punkt `i` dostaje cenę drugiego końca). */
const flatten = (kind: ToolKind, pts: readonly Pt[], i: number, q: Pt, shift: boolean): Pt =>
  shift && FLAT.has(kind) && pts.length === 2 && i < 2 ? { t: q.t, p: pts[1 - i].p } : q;

const clone = (ds: readonly Drawing[]): Drawing[] =>
  ds.map((d) => ({
    ...d,
    pts: d.pts.map((q) => ({ ...q })),
    style: { ...d.style },
  }));

let seq = 0;
const newId = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

function loadAll(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Panele układu: skróty klawiszowe trafiają tylko do ostatnio używanego, a zmiana rysunków jednego panelu
 * od razu odświeża pozostałe panele tego samego rynku (wspólny zapis).
 */
const peers = new Set<DrawingTools>();
let focused: DrawingTools | null = null;

export const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');

export class DrawingTools {
  private drawings: Drawing[];
  private pending: Pending | null = null;
  /** Szybki pomiar (Shift): nie trafia do zapisu, znika przy następnym kliknięciu. */
  private temp: Drawing | null = null;
  private drag: Drag | null = null;
  private selectedId: string | null = null;
  private tool: ToolKind | null = null;
  private magnet = false;
  private hidden = false;
  private locked = false;
  private keep = false;
  private editTick = 0;
  private hoverId: string | null = null;
  private menu: DrawMenuAt | null = null;
  /** Zmiana scalana z poprzednią w jeden wpis cofania (`id:pole` — wpisywanie tekstu, suwak krycia). */
  private mergeKey: string | null = null;
  private undoStack: Drawing[][] = [];
  private redoStack: Drawing[][] = [];
  private clipboard: Drawing | null = null;
  /** Wciśnięcie należy do rysowania — kolejne zdarzenia myszy i dotyku nie trafiają do wykresu. */
  private swallow = false;
  private lastStyle = new Map<ToolKind, DrawStyle>();
  private snapshot: DrawState;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly host: HTMLElement,
    private readonly chart: IChartApi,
    private readonly layer: DrawingLayer,
    private readonly market: string
  ) {
    this.drawings = parseDrawings(loadAll()[market]);
    this.snapshot = this.makeState();
    host.addEventListener('pointerdown', this.onDown, true);
    host.addEventListener('mousedown', this.onCompat, true);
    host.addEventListener('touchstart', this.onCompat, true);
    host.addEventListener('dblclick', this.onDblClick, true);
    host.addEventListener('pointermove', this.onHover);
    host.addEventListener('pointerleave', this.onLeave);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('keydown', this.onKey);
    peers.add(this);
    focused ??= this;
    this.push();
  }

  /** Panel, w którym ostatnio kliknięto — do niego trafiają skróty klawiszowe. */
  get isFocused(): boolean {
    return focused === this;
  }

  destroy(): void {
    this.host.removeEventListener('pointerdown', this.onDown, true);
    this.host.removeEventListener('mousedown', this.onCompat, true);
    this.host.removeEventListener('touchstart', this.onCompat, true);
    this.host.removeEventListener('dblclick', this.onDblClick, true);
    this.host.removeEventListener('pointermove', this.onHover);
    this.host.removeEventListener('pointerleave', this.onLeave);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('keydown', this.onKey);
    this.listeners.clear();
    peers.delete(this);
    if (focused === this) focused = null;
  }

  /** Rysunki zapisane przez inny panel tego rynku (historia cofania tego panelu zaczyna się od nowa). */
  private reload(): void {
    this.drawings = parseDrawings(loadAll()[this.market]);
    if (this.selectedId && !this.drawings.some((d) => d.id === this.selectedId)) this.selectedId = null;
    this.undoStack = [];
    this.redoStack = [];
    this.push();
  }

  // ───────────────────────── stan dla paska narzędzi ─────────────────────────

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): DrawState => this.snapshot;

  private makeState(): DrawState {
    return {
      tool: this.tool,
      selected: this.drawings.find((d) => d.id === this.selectedId) ?? null,
      magnet: this.magnet,
      hidden: this.hidden,
      locked: this.locked,
      keep: this.keep,
      count: this.drawings.length,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      editTick: this.editTick,
      menu: this.selectedId ? this.menu : null,
    };
  }

  private layerState(): LayerState {
    return {
      drawings: this.temp ? [...this.drawings, this.temp] : this.drawings,
      pending: this.pending?.d ?? null,
      selectedId: this.selectedId,
      hoverId: this.hoverId,
      hidden: this.hidden,
    };
  }

  /** Nowy stan do warstwy i paska. */
  private push(): void {
    this.layer.setState(this.layerState());
    this.snapshot = this.makeState();
    for (const fn of this.listeners) fn();
  }

  private save(): void {
    try {
      const all = loadAll();
      all[this.market] = this.drawings;
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
      // Prywatne okno albo pełna pamięć — rysunki zostają do zamknięcia strony
      return;
    }
    for (const p of peers) if (p !== this && p.market === this.market) p.reload();
  }

  /** Zmiana listy rysunków z wpisem do historii cofania. */
  private commit(next: Drawing[], before: Drawing[] = this.drawings): void {
    this.mergeKey = null;
    this.undoStack.push(clone(before));
    if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
    this.redoStack = [];
    this.drawings = next.slice(-MAX_DRAWINGS);
    if (this.selectedId && !this.drawings.some((d) => d.id === this.selectedId)) this.selectedId = null;
    this.save();
    this.push();
  }

  // ───────────────────────── polecenia ─────────────────────────

  /** Panel, w którym pracuje użytkownik, dostaje skróty; zaznaczenie w poprzednim panelu znika razem z jego paskiem stylu. */
  private focus(): void {
    if (focused === this) return;
    const prev = focused;
    focused = this;
    if (prev?.selectedId) prev.deselect();
  }

  setTool(kind: ToolKind | null): void {
    this.focus();
    this.cancelPending();
    this.tool = this.tool === kind ? null : kind;
    if (this.tool) this.selectedId = null;
    this.push();
  }

  toggleMagnet(): void {
    this.magnet = !this.magnet;
    this.push();
  }

  toggleHidden(): void {
    this.hidden = !this.hidden;
    if (this.hidden) this.selectedId = null;
    this.push();
  }

  toggleLocked(): void {
    this.locked = !this.locked;
    this.push();
  }

  toggleKeep(): void {
    this.keep = !this.keep;
    this.push();
  }

  clearAll(): void {
    if (this.drawings.length === 0) return;
    this.selectedId = null;
    this.commit([]);
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.mergeKey = null;
    this.redoStack.push(clone(this.drawings));
    this.drawings = prev;
    if (this.selectedId && !prev.some((d) => d.id === this.selectedId)) this.selectedId = null;
    this.save();
    this.push();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.mergeKey = null;
    this.undoStack.push(clone(this.drawings));
    this.drawings = next;
    this.save();
    this.push();
  }

  private get selected(): Drawing | undefined {
    return this.drawings.find((x) => x.id === this.selectedId);
  }

  deleteSelected(): void {
    if (!this.selectedId) return;
    const id = this.selectedId;
    this.selectedId = null;
    this.commit(this.drawings.filter((d) => d.id !== id));
  }

  /** Kopia zaznaczonego rysunku przesunięta o kilka świec w prawo. */
  cloneSelected(): void {
    const d = this.selected;
    if (d) this.paste(d);
  }

  /** Zaznaczony rysunek do schowka (Ctrl+V wkleja kopię). */
  copySelected(): void {
    const d = this.selected;
    if (d) this.clipboard = clone([d])[0];
  }

  toggleLockSelected(): void {
    const d = this.selected;
    if (d) this.patchSelected({ locked: !d.locked || undefined });
  }

  reorderSelected(to: Order): void {
    if (this.selectedId) this.commit(reorder(this.drawings, this.selectedId, to));
  }

  /** Styl zaznaczonego rysunku; `merge` (suwak) scala kolejne zmiany tego samego pola w jeden krok cofania. */
  styleSelected(patch: Partial<DrawStyle>, merge = false): void {
    const d = this.selected;
    if (!d) return;
    const style = { ...d.style, ...patch };
    this.lastStyle.set(d.kind, style);
    this.patchSelected({ style }, merge ? `${d.id}:${Object.keys(patch).join()}` : null);
  }

  setText(text: string): void {
    const d = this.selected;
    // Wpisywanie znak po znaku to jeden krok cofania (świeży tekst nowego rysunku cofa się razem z nim)
    if (d && d.text !== text) this.patchSelected({ text: text.slice(0, 280) }, `${d.id}:text`);
  }

  private patchSelected(patch: Partial<Drawing>, merge: string | null = null): void {
    const id = this.selectedId;
    const next = this.drawings.map((x) => (x.id === id ? { ...x, ...patch } : x));
    if (merge !== null && merge === this.mergeKey) {
      this.drawings = next;
      this.save();
      this.push();
      return;
    }
    this.commit(next);
    this.mergeKey = merge;
  }

  /** Menu rysunku pod prawym przyciskiem: true, gdy pod kursorem jest rysunek (zostaje zaznaczony). */
  openMenu(clientX: number, clientY: number): boolean {
    const { x, y, inPane } = this.local({ clientX, clientY });
    if (!inPane || this.hidden || this.tool || this.pending) return false;
    const h = this.layer.hit(x, y);
    if (!h || h.id === 'temp') return false;
    this.focus();
    this.select(h.id);
    this.menu = { x, y };
    this.push();
    return true;
  }

  closeMenu(): void {
    if (!this.menu) return;
    this.menu = null;
    this.push();
  }

  private select(id: string): void {
    if (this.selectedId !== id) this.mergeKey = null;
    this.selectedId = id;
  }

  /** Linia pozioma w punkcie panelu ceny (menu kontekstowe wykresu). */
  addHorizontal(x: number, y: number): void {
    const q = this.layer.toPt(x, y);
    if (q) this.begin('hline', q, false, x, y);
  }

  deselect(): void {
    this.selectedId = null;
    this.mergeKey = null;
    this.menu = null;
    this.push();
  }

  private paste(src: Drawing): void {
    const dt = 3 * this.layer.intervalMs;
    const d: Drawing = {
      ...src,
      id: newId(),
      pts: moveDrawing(src.pts, dt, 0),
      style: { ...src.style },
    };
    this.selectedId = d.id;
    this.commit([...this.drawings, d]);
  }

  // ───────────────────────── wskaźnik ─────────────────────────

  private local(e: { clientX: number; clientY: number }): {
    x: number;
    y: number;
    inPane: boolean;
  } {
    const r = this.host.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const pane = this.chart.paneSize(0);
    return {
      x,
      y,
      inPane: x >= 0 && y >= 0 && x < pane.width && y < pane.height,
    };
  }

  /** Punkt wykresu pod wskaźnikiem z magnesem (Ctrl/Cmd odwraca magnes na czas rysowania). */
  private pointAt(x: number, y: number, invert: boolean): Pt | null {
    const q = this.layer.toPt(x, y);
    if (!q || this.magnet === invert) return q;
    const bar = this.layer.barAt(q.t);
    if (!bar) return q;
    return {
      t: q.t,
      p: snapToOhlc(bar.candle, q.p, this.layer.pxPerUsd(q.p), MAGNET_PX),
    };
  }

  private consume(e: Event): void {
    this.swallow = true;
    e.stopPropagation();
    e.preventDefault();
  }

  private readonly onCompat = (e: Event): void => {
    if (this.swallow) e.stopPropagation();
  };

  private readonly onDown = (e: PointerEvent): void => {
    this.focus();
    if (e.button !== 0) return;
    const { x, y, inPane } = this.local(e);
    if (!inPane) return;
    const invert = e.ctrlKey || e.metaKey;
    this.menu = null;
    if (this.temp && !this.pending) {
      this.temp = null;
      this.push();
    }
    // Kolejny punkt rysunku w trakcie stawiania
    if (this.pending) {
      const q = this.pointAt(x, y, invert);
      const p = this.pending;
      p.downX = x;
      p.downY = y;
      if (q) this.placePoint(flatten(p.d.kind, p.d.pts, p.d.pts.length - 1, q, e.shiftKey));
      this.consume(e);
      return;
    }
    if (this.tool || e.shiftKey) {
      const q = this.pointAt(x, y, invert);
      if (q) this.begin(this.tool ?? 'measure', q, !this.tool, x, y);
      this.consume(e);
      return;
    }
    if (this.hidden) return;
    const h = this.layer.hit(x, y);
    if (!h || h.id === 'temp') {
      if (this.selectedId) this.deselect();
      return;
    }
    const d = this.drawings.find((x2) => x2.id === h.id);
    const start = this.layer.toPt(x, y);
    if (d && start && !this.locked && !d.locked) {
      const before = clone(this.drawings);
      // Ctrl + przeciągnięcie całego rysunku przesuwa jego kopię
      const copy = invert && h.handle < 0 ? { ...clone([d])[0], id: newId() } : null;
      if (copy) this.drawings = [...this.drawings, copy];
      this.drag = {
        id: copy?.id ?? d.id,
        handle: h.handle,
        start,
        orig: d.pts.map((q) => ({ ...q })),
        before,
        moved: false,
        cloneOf: copy ? d.id : null,
      };
    }
    this.select(this.drag?.id ?? h.id);
    this.push();
    this.consume(e);
  };

  private begin(kind: ToolKind, q: Pt, temp: boolean, x: number, y: number): void {
    const style = { ...(this.lastStyle.get(kind) ?? defaultStyle(kind)) };
    const d: Drawing = { id: temp ? 'temp' : newId(), kind, pts: [q], style };
    if (kind === 'long' || kind === 'short') {
      const ppu = this.layer.pxPerUsd(q.p);
      const bars = Math.max(4, Math.round(POSITION_W_PX / this.chart.timeScale().options().barSpacing));
      d.pts = newPosition(kind, q, ppu > 0 ? POSITION_RISK_PX / ppu : q.p * 0.005, this.layer.intervalMs, bars);
    }
    if (kind === 'text') d.text = 'Tekst';
    if (kind === 'note') d.text = 'Notatka';
    const need = kind === 'brush' ? Number.POSITIVE_INFINITY : kind === 'long' || kind === 'short' ? 1 : toolDef(kind).points;
    if (need <= 1) {
      this.finish(d, temp);
      return;
    }
    if (kind !== 'brush') d.pts.push({ ...q });
    this.pending = { d, placed: 1, need, temp, downX: x, downY: y };
    this.push();
  }

  private placePoint(q: Pt): void {
    const p = this.pending;
    if (!p) return;
    p.d.pts[p.d.pts.length - 1] = q;
    p.placed++;
    if (p.placed >= p.need) {
      this.pending = null;
      this.finish(p.d, p.temp);
      return;
    }
    p.d.pts.push({ ...q });
    this.push();
  }

  private finish(d: Drawing, temp: boolean): void {
    this.pending = null;
    if (temp) {
      this.temp = d;
      this.push();
      return;
    }
    if (!this.keep) this.tool = null;
    this.selectedId = d.id;
    if (d.kind === 'text' || d.kind === 'note') this.editTick++;
    this.commit([...this.drawings, d]);
    this.mergeKey = `${d.id}:text`;
  }

  private cancelPending(): void {
    const p = this.pending;
    this.pending = null;
    // Pędzel kończy się puszczeniem przycisku — przerwany zostaje, jeśli ma już kreskę
    if (p && p.d.kind === 'brush' && p.d.pts.length >= 2) this.finish(p.d, false);
    else if (p) this.push();
  }

  private setHover(id: string | null): void {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.layer.setState(this.layerState());
  }

  private readonly onLeave = (): void => this.setHover(null);

  private readonly onHover = (e: PointerEvent): void => {
    const p = this.pending;
    if (!p) {
      // Podświetlenie rysunku pod kursorem (bez przycisku — w czasie przesuwania wykresu nie)
      if (!this.drag && !this.tool && !this.hidden && e.buttons === 0) {
        const { x, y } = this.local(e);
        const h = this.layer.hit(x, y);
        this.setHover(h && h.id !== 'temp' ? h.id : null);
      }
      return;
    }
    if (this.drag) return;
    const { x, y } = this.local(e);
    const q = this.pointAt(x, y, e.ctrlKey || e.metaKey);
    if (!q) return;
    if (p.d.kind === 'brush') {
      if (e.buttons & 1 && Math.hypot(x - p.downX, y - p.downY) >= 2 && p.d.pts.length < MAX_BRUSH_POINTS) {
        p.d.pts.push(this.layer.toPt(x, y) ?? q);
        p.downX = x;
        p.downY = y;
        this.push();
      }
      return;
    }
    p.d.pts[p.d.pts.length - 1] = flatten(p.d.kind, p.d.pts, p.d.pts.length - 1, q, e.shiftKey);
    this.push();
  };

  private readonly onMove = (e: PointerEvent): void => {
    const g = this.drag;
    if (!g) return;
    const { x, y } = this.local(e);
    const d = this.drawings.find((x2) => x2.id === g.id);
    if (!d) return;
    let pts: Pt[] | null = null;
    if (g.handle >= 0) {
      const q = this.pointAt(x, y, e.ctrlKey || e.metaKey);
      if (q) pts = dragHandle(d.kind, g.orig, g.handle, flatten(d.kind, g.orig, g.handle, q, e.shiftKey));
    } else {
      const q = this.layer.toPt(x, y);
      if (q) pts = moveDrawing(g.orig, q.t - g.start.t, q.p - g.start.p);
    }
    if (!pts) return;
    g.moved = true;
    this.drawings = this.drawings.map((x2) => (x2.id === g.id ? { ...x2, pts } : x2));
    this.push();
  };

  private readonly onUp = (e: PointerEvent): void => {
    const g = this.drag;
    this.drag = null;
    if (g?.moved) this.commit(this.drawings, g.before);
    else if (g?.cloneOf) {
      // Ctrl + klik bez ruchu: bez kopii, zaznaczony oryginał
      this.drawings = g.before;
      this.selectedId = g.cloneOf;
      this.push();
    }
    const p = this.pending;
    if (p && this.swallow) {
      const { x, y } = this.local(e);
      if (p.d.kind === 'brush') {
        if (p.d.pts.length >= 2) this.finish(p.d, false);
        else {
          this.pending = null;
          this.push();
        }
      } else if (Math.hypot(x - p.downX, y - p.downY) > DRAG_PX && p.placed < p.need) {
        // Przeciągnięcie od pierwszego punktu: puszczenie stawia następny punkt
        const q = this.pointAt(x, y, e.ctrlKey || e.metaKey);
        if (q) {
          p.downX = x;
          p.downY = y;
          this.placePoint(flatten(p.d.kind, p.d.pts, p.d.pts.length - 1, q, e.shiftKey));
        }
      } else {
        p.downX = x;
        p.downY = y;
      }
    }
    this.swallow = false;
  };

  private readonly onDblClick = (e: MouseEvent): void => {
    const { x, y, inPane } = this.local(e);
    if (!inPane || this.tool || this.pending) return;
    const h = this.layer.hit(x, y);
    const d = h ? this.drawings.find((x2) => x2.id === h.id) : null;
    if (!d) return;
    e.stopPropagation();
    this.select(d.id);
    if (d.kind === 'text' || d.kind === 'note' || d.kind === 'hline' || d.kind === 'hray') this.editTick++;
    this.push();
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (isTyping(e.target) || (focused !== null && focused !== this)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.altKey && !mod && HOTKEYS.has(e.code)) {
      e.preventDefault();
      this.setTool(HOTKEYS.get(e.code) ?? null);
      return;
    }
    if (e.key === 'Escape') {
      if (this.menu) this.closeMenu();
      else if (this.pending) this.cancelPending();
      else if (this.temp) {
        this.temp = null;
        this.push();
      } else if (this.tool) this.setTool(null);
      else if (this.selectedId) this.deselect();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedId) {
      e.preventDefault();
      this.deleteSelected();
      return;
    }
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    } else if ((k === 'z' && e.shiftKey) || k === 'y') {
      e.preventDefault();
      this.redo();
    } else if (k === 'c') this.copySelected();
    else if (k === 'v' && this.clipboard) {
      e.preventDefault();
      this.paste(this.clipboard);
      this.clipboard = clone([this.drawings[this.drawings.length - 1]])[0];
    }
  };
}
