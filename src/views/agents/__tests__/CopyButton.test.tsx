/**
 * Kopiowanie do schowka: region `role="status"` ogłasza i sukces („Skopiowano do schowka”), i porażkę (komunikat
 * awaryjny); kolor ostrzeżenia tylko przy porażce. Do schowka trafia dokładnie podany tekst. Wariant główny ma styl
 * przycisku głównego i opcjonalny opis (`aria-describedby`).
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type MiniElement, miniDom } from '../../../ui/__tests__/miniDom';
import { BTN_PRIMARY, BTN_SECONDARY, CopyButton } from '../CopyButton';

let dom: ReturnType<typeof miniDom>;

beforeEach(() => {
  dom = miniDom();
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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
const status = (): MiniElement => {
  const s = dom.container.findAll((e) => e.getAttribute('role') === 'status');
  expect(s).toHaveLength(1);
  return s[0];
};
const button = (): MiniElement => dom.container.findAll((e) => e.tagName === 'button')[0];

/** Kliknięcie i oczekiwanie na obietnicę schowka. */
async function click(): Promise<void> {
  await act(async () => {
    dom.click(button());
    await Promise.resolve();
  });
}

describe('przycisk kopiowania', () => {
  it('sukces: schowek dostaje dokładnie tekst; region status ogłasza „Skopiowano do schowka”, bez koloru ostrzeżenia', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const root = mount(<CopyButton text={'node /a b'} label="Kopiuj polecenie" fallback="Zaznacz i skopiuj ręcznie." />);
    expect(status().textContent).toBe('');
    await click();
    expect(writeText).toHaveBeenCalledWith('node /a b');
    expect(status().textContent).toBe('Skopiowano do schowka');
    expect(status().getAttribute('aria-live')).toBe('polite');
    expect(status().getAttribute('class')).not.toContain('text-warn');
    act(() => root.unmount());
  });

  it('porażka schowka: region status ogłasza komunikat awaryjny w kolorze ostrzeżenia', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('NotAllowedError'))) } });
    const root = mount(<CopyButton text="x" label="Kopiuj" fallback="Zaznacz i skopiuj ręcznie." />);
    await click();
    expect(status().textContent).toBe('Zaznacz i skopiuj ręcznie.');
    expect(status().getAttribute('class')).toContain('text-warn');
    act(() => root.unmount());
  });

  it('wariant główny: styl przycisku głównego (BTN_PRIMARY), opis przez aria-describedby; domyślnie drugorzędny bez opisu', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const root = mount(<CopyButton primary describedBy="opis" text="wiadomość" label="Kopiuj wiadomość" fallback="Zaznacz i skopiuj ręcznie." />);
    expect(button().getAttribute('class')).toBe(BTN_PRIMARY);
    expect(button().getAttribute('aria-describedby')).toBe('opis');
    await click();
    expect(writeText).toHaveBeenCalledWith('wiadomość');
    expect(button().textContent).toBe('Skopiowano');
    act(() => root.unmount());
    const plain = mount(<CopyButton text="x" label="Kopiuj" fallback="Zaznacz i skopiuj ręcznie." />);
    expect(button().getAttribute('class')).toBe(BTN_SECONDARY);
    expect(button().hasAttribute('aria-describedby')).toBe(false);
    act(() => plain.unmount());
  });

  it('bez API schowka (stara przeglądarka, brak HTTPS): od razu komunikat awaryjny', async () => {
    vi.stubGlobal('navigator', {});
    const root = mount(<CopyButton text="x" label="Kopiuj" fallback="Zaznacz i skopiuj ręcznie." />);
    await click();
    expect(status().textContent).toBe('Zaznacz i skopiuj ręcznie.');
    expect(status().getAttribute('class')).toContain('text-warn');
    act(() => root.unmount());
  });
});
