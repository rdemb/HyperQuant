/**
 * Karty instalacji: OpenBot kopiuje dokładnie pokazane polecenie i argumenty (każde własnym przyciskiem, bez ukrytego
 * JSON-a); przyciski Cursora i VS Code przed publikacją w npm są osiągalne klawiaturą (`aria-disabled`, bez `disabled`)
 * i opisane powodem, po publikacji to linki instalacji.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type MiniElement, miniDom } from '../../../ui/__tests__/miniDom';
import { EditorsCard, OpenBotCard } from '../AgentsView';
import { type McpStatus, cursorLink, serverConfig, vscodeLink } from '../installLinks';

let dom: ReturnType<typeof miniDom>;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  dom = miniDom();
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  writeText = vi.fn(async () => undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
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
const find = (pred: (e: MiniElement) => boolean, from: MiniElement = dom.container) => from.findAll(pred);
async function click(el: MiniElement): Promise<void> {
  await act(async () => {
    dom.click(el);
    await Promise.resolve();
  });
}

describe('OpenBot: polecenie i argumenty, każde z własnym przyciskiem', () => {
  for (const status of ['repo', 'npm'] as McpStatus[]) {
    it(`${status}: przycisk przy polu kopiuje dokładnie pokazaną wartość`, async () => {
      const root = mount(<OpenBotCard status={status} />);
      const want = { command: serverConfig(status).command, args: serverConfig(status).args.join(' ') };
      for (const field of ['command', 'args'] as const) {
        const [row] = find((e) => e.getAttribute('data-field') === field);
        expect(row, field).toBeDefined();
        const [value] = find((e) => e.hasAttribute('data-value'), row);
        expect(value.textContent, field).toBe(want[field]);
        const buttons = find((e) => e.tagName === 'button', row);
        expect(buttons, field).toHaveLength(1);
        writeText.mockClear();
        await click(buttons[0]);
        expect(writeText, field).toHaveBeenCalledWith(value.textContent);
      }
      act(() => root.unmount());
    });
  }

  it('żaden przycisk nie kopiuje ukrytego JSON-a; krok 3 mówi o przyciskach przy polach', async () => {
    const root = mount(<OpenBotCard status="repo" />);
    const buttons = find((e) => e.tagName === 'button');
    expect(buttons).toHaveLength(2);
    for (const b of buttons) await click(b);
    expect(writeText.mock.calls.map((c) => String(c[0])).filter((t) => t.trim().startsWith('{'))).toEqual([]);
    const steps = find((e) => e.tagName === 'li');
    expect(steps).toHaveLength(3);
    expect(steps[2].textContent).toMatch(/Skopiuj polecenie i argumenty/);
    act(() => root.unmount());
  });
});

describe('Cursor i VS Code', () => {
  it('przed publikacją w npm: przyciski osiągalne klawiaturą (aria-disabled, bez disabled), opisane powodem, kliknięcie nic nie robi', async () => {
    const root = mount(<EditorsCard status="repo" />);
    const buttons = find((e) => e.tagName === 'button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Zainstaluj w Cursorze', 'Zainstaluj w VS Code']);
    for (const b of buttons) {
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.hasAttribute('disabled')).toBe(false);
      const id = b.getAttribute('aria-describedby') ?? '';
      const [caption] = find((e) => e.getAttribute('id') === id);
      expect(caption?.textContent).toContain('po publikacji paczki npm');
      await click(b);
    }
    expect(find((e) => e.tagName === 'a' && /^(?:cursor|vscode|https:\/\/vscode)/.test(e.getAttribute('href') ?? ''))).toEqual([]);
    act(() => root.unmount());
  });

  it('po publikacji w npm: linki instalacji z installLinks', () => {
    const root = mount(<EditorsCard status="npm" />);
    const hrefs = find((e) => e.tagName === 'a').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([cursorLink('npm'), vscodeLink('npm')]);
    expect(find((e) => e.getAttribute('aria-disabled') === 'true')).toEqual([]);
    act(() => root.unmount());
  });
});
