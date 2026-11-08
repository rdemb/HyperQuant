/**
 * Karty instalacji: OpenBot kopiuje dokładnie pokazane polecenie i argumenty (każde własnym przyciskiem, bez ukrytego
 * JSON-a); przyciski Cursora i VS Code przed publikacją w npm są osiągalne klawiaturą (`aria-disabled`, bez `disabled`)
 * i opisane powodem, po publikacji to linki instalacji.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type MiniElement, miniDom } from '../../../ui/__tests__/miniDom';
import { DASH } from '../../../ui';
import { ClaudeCard, EditorsCard, OpenBotCard, ServerCard } from '../AgentsView';
import { MCPB_SHA256_URL, type McpStatus, NPX_COMMAND, cursorLink, parseSha256, serverConfig, vscodeLink } from '../installLinks';

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

describe('Claude Desktop: SHA-256 pliku .mcpb przy przycisku pobrania', () => {
  // Syntetyczna suma składana w teście (64 znaki hex nie występują w źródle jako literał)
  const HASH = 'ab'.repeat(32);
  /** Montaż i dokończenie pobrania sumy (fetch → tekst → stan). */
  async function mountLoaded(ui: React.ReactNode) {
    const root = createRoot(dom.container as unknown as HTMLElement);
    await act(async () => {
      root.render(ui);
    });
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    return root;
  }
  const shown = () => find((e) => e.hasAttribute('data-sha256'))[0]?.textContent;

  it('plik .sha256 obok paczki (format sha256sum): suma pokazana przy przycisku, pobrana z adresu pliku w czasie działania', async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(`${HASH}  hyperquant.mcpb\n`));
    vi.stubGlobal('fetch', fetchMock);
    const root = await mountLoaded(<ClaudeCard />);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(MCPB_SHA256_URL);
    expect(shown()).toBe(HASH);
    expect(dom.container.textContent).toContain('SHA-256');
    act(() => root.unmount());
  });

  it('brak pliku (404), błąd sieci albo treść spoza formatu: „—”', async () => {
    for (const reply of [async () => new Response('not found', { status: 404 }), async () => Promise.reject(new Error('offline')), async () => new Response('<html>nie suma</html>')]) {
      vi.stubGlobal('fetch', vi.fn(reply));
      const root = await mountLoaded(<ClaudeCard />);
      expect(shown()).toBe(DASH);
      act(() => root.unmount());
    }
  });

  it('parseSha256: pierwsze pole pliku sha256sum, 64 znaki hex (małe litery); inaczej null', () => {
    expect(parseSha256(`${HASH}  hyperquant.mcpb\n`)).toBe(HASH);
    expect(parseSha256(`${HASH.toUpperCase()}\n`)).toBe(HASH);
    for (const bad of ['', 'abc', `${HASH}0  x`, `x${HASH}`, '<html>']) expect(parseSha256(bad), bad).toBeNull();
  });
});

describe('serwer z npm (po publikacji): polecenie z wersją przypiętą', () => {
  it('npm: karta podaje npx -y hyperquant-mcp@<wersja>; repo: kroki budowy z repozytorium', () => {
    const npm = mount(<ServerCard status="npm" />);
    expect(dom.container.textContent).toContain(NPX_COMMAND);
    act(() => npm.unmount());
    const repo = mount(<ServerCard status="repo" />);
    expect(dom.container.textContent).toContain('npm run mcp:build');
    expect(dom.container.textContent).not.toContain('npx');
    act(() => repo.unmount());
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
