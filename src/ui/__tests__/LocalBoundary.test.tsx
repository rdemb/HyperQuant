import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalBoundary } from '../LocalBoundary';
import { type MiniElement, miniDom } from './miniDom';

/** Dziecko, które rzuca, dopóki `bad.on` (jeden zły ładunek z zewnątrz). */
const bad = { on: true };
const Payload: React.FC = () => {
  if (bad.on) throw new Error('zły plik skanera');
  return <p>liczby</p>;
};

let dom: ReturnType<typeof miniDom>;
let errors: unknown[][];

beforeEach(() => {
  dom = miniDom();
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errors.push(a));
  bad.on = true;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const mount = (ui: React.ReactNode) => {
  const root = createRoot(dom.container as unknown as HTMLElement);
  act(() => root.render(ui));
  return root;
};
const buttons = () => dom.container.findAll((e: MiniElement) => e.tagName === 'button');

describe('lokalna osłona błędu', () => {
  it('rzucające dziecko: „—” z powodem w miejscu tej części, reszta strony zostaje', () => {
    const root = mount(
      <div>
        <LocalBoundary what="Czwórka">
          <Payload />
        </LocalBoundary>
        <p>wykres obok</p>
      </div>
    );
    const text = dom.container.textContent;
    expect(text).toContain('wykres obok');
    expect(text).toContain('Czwórka');
    expect(text).toContain('—');
    expect(text).toMatch(/reszta strony działa/);
    expect(dom.container.findAll((e) => e.getAttribute('role') === 'alert')).toHaveLength(1);
    // Nasz wpis w konsoli raz, z nazwą części
    expect(errors.filter((a) => String(a[0]).includes('[HyperQuant] Czwórka'))).toHaveLength(1);
    act(() => root.unmount());
  });

  it('ponowna próba: po naprawie danych dziecko wraca; dalej zły ładunek — znów „—”, bez drugiego wpisu', () => {
    const root = mount(
      <LocalBoundary what="Rozliczenie sesji">
        <Payload />
      </LocalBoundary>
    );
    const retry = () => {
      const b = buttons().find((x) => x.textContent.includes('Spróbuj ponownie'));
      expect(b).toBeDefined();
      act(() => dom.click(b!));
    };
    retry();
    expect(dom.container.textContent).toContain('Rozliczenie sesji');
    expect(errors.filter((a) => String(a[0]).includes('[HyperQuant] Rozliczenie sesji'))).toHaveLength(1);
    bad.on = false;
    retry();
    expect(dom.container.textContent).toBe('liczby');
    act(() => root.unmount());
  });

  it('wariant w wierszu (nagłówek układu): jedna linia z powodem i przyciskiem', () => {
    const root = mount(
      <LocalBoundary what="Nagłówek układu" inline>
        <Payload />
      </LocalBoundary>
    );
    expect(dom.container.textContent).toMatch(/Nagłówek układu: — /);
    expect(buttons()).toHaveLength(1);
    act(() => root.unmount());
  });
});
