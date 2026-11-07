import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayoutHeader } from '../chart/LayoutHeader';
import type { ProStore } from '../store/proStore';
import { type MiniElement, miniDom } from '../../../ui/__tests__/miniDom';

/** Magazyn atrapy: serie świec w drodze; `broken.on` — zły ładunek, przy którym liczenie liczb rzuca. */
const broken = { on: false };
const store = {
  coin: 'BTC',
  serverNow: () => {
    if (broken.on) throw new Error('zły ładunek');
    return Date.UTC(2026, 10, 3, 16, 20);
  },
  lastPrice: () => 100_000,
  series: () => ({ loadState: 'loading', load: async () => {}, candlesNow: () => [] }),
  indicatorCandles: () => [],
  exactBook: () => null,
  zeroKnown: { covers: () => false },
  orders: { range: () => [], count: () => 0 },
  addressed: { covers: () => false },
} as unknown as ProStore;

let dom: ReturnType<typeof miniDom>;
let errors: unknown[][];

beforeEach(() => {
  vi.useFakeTimers();
  dom = miniDom();
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errors.push(a));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const mount = () => {
  const root = createRoot(dom.container as unknown as HTMLElement);
  act(() =>
    root.render(
      <LayoutHeader
        id="cockpit"
        question="Kto teraz naciska?"
        store={store}
        model={null}
        volStatus="loading"
        liq={{ status: 'loading', map: null } as never}
        whales={null}
        whalesConfigured={false}
        blogMaps={{ status: 'loading', maps: [] }}
        blogMap={null}
        narrow={false}
      />
    )
  );
  return root;
};
const hints = () => dom.container.findAll((e: MiniElement) => e.tagName === 'button').map((b) => b.getAttribute('title') ?? '');
const ours = () => errors.filter((a) => String(a[0]).includes('[HyperQuant] Nagłówek układu'));

describe('nagłówek układu: błąd liczenia liczb nie zabiera aplikacji', () => {
  it('od pierwszego przeliczenia: trzy „—” z powodem i jeden wpis w konsoli mimo kolejnych prób', () => {
    broken.on = true;
    const root = mount();
    expect(hints()).toHaveLength(3);
    for (const h of hints()) expect(h).toContain('Nie udało się policzyć liczby z bieżących danych');
    act(() => vi.advanceTimersByTime(20_000));
    expect(ours()).toHaveLength(1);
    act(() => root.unmount());
  });

  it('po dobrych liczbach: zostają ostatnie dobre, wpis w konsoli raz; po naprawie liczy dalej', () => {
    broken.on = false;
    const root = mount();
    const good = hints();
    expect(good.join(' ')).not.toContain('Nie udało się policzyć');
    broken.on = true;
    act(() => vi.advanceTimersByTime(20_000));
    expect(hints()).toEqual(good);
    expect(ours()).toHaveLength(1);
    broken.on = false;
    act(() => vi.advanceTimersByTime(6_000));
    expect(hints()).toEqual(good);
    act(() => root.unmount());
  });
});
