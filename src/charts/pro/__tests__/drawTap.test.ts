import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DrawingTools } from '../draw/tools';

/**
 * Dotknięcie wykresu, które tylko odznacza rysunek albo kończy pracę narzędzia, należy do rysowania: nie może przełączać
 * trybu skupienia na telefonie (sterownik pyta `pressBusy` przy kliknięciu wykresu, gdy zaznaczenia już nie ma).
 */
type Fn = (e: unknown) => void;

function setup() {
  const handlers = new Map<string, Fn>();
  const host = {
    addEventListener: (type: string, fn: Fn) => handlers.set(type, fn),
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    contains: () => true,
  };
  const chart = { paneSize: () => ({ width: 400, height: 300 }) };
  const layer = { setState: () => {}, hit: () => null, toPt: () => null, onInterval: null };
  const tools = new DrawingTools(host as never, chart as never, layer as never, 'BTC');
  const press = () =>
    handlers.get('pointerdown')!({ button: 0, clientX: 100, clientY: 100, ctrlKey: false, metaKey: false, shiftKey: false, stopPropagation: () => {}, preventDefault: () => {} });
  return { tools, press };
}

const DRAWING = { id: 'd1', kind: 'hline', pts: [{ t: 1_700_000_000_000, p: 80_000 }], style: {} };

describe('dotknięcie wykresu w trakcie rysowania nie przełącza trybu skupienia', () => {
  beforeEach(() => {
    const store = new Map<string, string>([['hq.charts.draw.v1', JSON.stringify({ BTC: [DRAWING] })]]);
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: () => {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('wciśnięcie odznaczające rysunek: po nim brak zaznaczenia, ale wciśnięcie było zajęte', () => {
    const { tools, press } = setup();
    tools.pick('d1', false);
    expect(tools.busy).toBe(true);
    press();
    expect(tools.busy).toBe(false);
    expect(tools.pressBusy).toBe(true);
  });

  it('wciśnięcie przy wybranym narzędziu jest zajęte; puste wciśnięcie bez zaznaczenia — wolne', () => {
    const { tools, press } = setup();
    press();
    expect(tools.pressBusy).toBe(false);
    tools.setTool('hline');
    press();
    expect(tools.pressBusy).toBe(true);
  });
});
