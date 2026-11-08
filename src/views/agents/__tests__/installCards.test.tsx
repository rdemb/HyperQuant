/**
 * Karty instalacji: OpenBot jedną wiadomością (przycisk główny kopiuje dokładnie tekst z „Pokaż wiadomość”), a ręcznie
 * kopiuje dokładnie pokazane polecenie i argumenty (każde własnym przyciskiem, bez ukrytego JSON-a); przyciski Cursora i VS Code przed publikacją w npm są osiągalne klawiaturą (`aria-disabled`, bez `disabled`)
 * i opisane powodem, po publikacji to linki instalacji.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type MiniElement, miniDom } from '../../../ui/__tests__/miniDom';
import { DASH } from '../../../ui';
import { ClaudeCard, EditorsCard, OpenBotCard, OtherClientsCard, ServerCard, StatusBox } from '../AgentsView';
import { BTN_PRIMARY } from '../CopyButton';
import { openbotSetupMessage } from '../openbotSetup';
import {
  BUNDLE_PATH,
  MCPB_SHA256_URL,
  type McpStatus,
  NPM_SPEC,
  NPX_COMMAND,
  REPO_DIR,
  REPO_STEPS,
  claudeDesktopJson,
  cursorLink,
  parseSha256,
  serverConfig,
  vscodeLink,
} from '../installLinks';

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

describe('stan dziś: paczka w npm (karty bez podanego stanu)', () => {
  const details = () => find((e) => e.tagName === 'details');
  const summary = (d: MiniElement) => find((e) => e.tagName === 'summary', d)[0]?.textContent;

  it('ramka stanu: Dziś paczka w npm, Wkrótce wpis w Marketplace OpenBota, W planach tryb HTTP', () => {
    const root = mount(<StatusBox />);
    expect(find((e) => e.tagName === 'dt').map((e) => e.textContent)).toEqual(['Dziś', 'Wkrótce', 'W planach']);
    const dd = find((e) => e.tagName === 'dd').map((e) => e.textContent);
    expect(dd[0]).toContain('npm');
    expect(dd[0]).toContain(NPM_SPEC);
    expect(dd[0]).not.toMatch(/repozytori/);
    expect(dd[1]).toMatch(/Marketplace OpenBota/);
    expect(dd[1]).not.toMatch(/npm/);
    expect(dd[2]).toMatch(/HTTP/);
    act(() => root.unmount());
  });

  it('Cursor i VS Code: aktywne linki, bez aria-disabled i bez podpisu „po publikacji”; podpis podaje polecenie npx', () => {
    const root = mount(<EditorsCard />);
    expect(find((e) => e.tagName === 'a').map((a) => a.getAttribute('href'))).toEqual([cursorLink('npm'), vscodeLink('npm')]);
    expect(find((e) => e.tagName === 'button')).toEqual([]);
    expect(find((e) => e.hasAttribute('aria-disabled'))).toEqual([]);
    expect(dom.container.textContent).not.toContain('po publikacji');
    expect(dom.container.textContent).toContain(NPX_COMMAND);
    act(() => root.unmount());
  });

  it('serwer: główna droga npx z wersją przypiętą i przyciskiem kopiowania; budowa z kodu źródłowego zwinięta', async () => {
    const root = mount(<ServerCard />);
    expect(find((e) => e.tagName === 'pre')[0]?.textContent).toBe(NPX_COMMAND);
    const [copy] = find((e) => e.tagName === 'button' && e.textContent.includes('Kopiuj polecenie'));
    await click(copy);
    expect(writeText).toHaveBeenCalledWith(NPX_COMMAND);
    const [d] = details();
    expect(d.hasAttribute('open')).toBe(false);
    expect(summary(d)).toBe('Z kodu źródłowego');
    for (const s of REPO_STEPS) expect(d.textContent, s).toContain(s);
    expect(d.textContent).toContain(BUNDLE_PATH);
    act(() => root.unmount());
  });

  it('OpenBot: główna droga jedną wiadomością; przycisk główny kopiuje openbotSetupMessage(), „Pokaż wiadomość” ma pełny tekst', async () => {
    const root = mount(<OpenBotCard />);
    expect(find((e) => e.tagName === 'header')[0]?.textContent).toContain('Jedną wiadomością');
    const intro = find((e) => e.tagName === 'p').map((p) => p.textContent);
    expect(intro[0]).toMatch(/Skopiuj wiadomość i wklej ją dowolnemu agentowi w OpenBocie/);
    expect(intro[1]).toMatch(/serwer.*skill/);
    expect(intro[1]).toMatch(/pominie/);
    expect(intro[1]).toMatch(/zgod/);
    // Pierwszy przycisk karty: główny, poza zwiniętymi sekcjami
    const [first] = find((e) => e.tagName === 'button');
    expect(first.textContent).toBe('Kopiuj wiadomość');
    expect(first.getAttribute('class')).toBe(BTN_PRIMARY);
    await click(first);
    expect(writeText).toHaveBeenCalledWith(openbotSetupMessage());
    const [message] = details();
    expect(details()).toHaveLength(2);
    expect(summary(message)).toBe('Pokaż wiadomość');
    expect(message.hasAttribute('open')).toBe(false);
    expect(find((e) => e.tagName === 'pre', message)[0]?.textContent).toBe(openbotSetupMessage());
    expect(find((e) => e.tagName === 'button', message)).toEqual([]);
    act(() => root.unmount());
  });

  it('OpenBot: kroki ręczne (Marketplace, pola polecenia i argumentów, z kodu źródłowego) w zwiniętym „Ręcznie”; Marketplace w przygotowaniu', () => {
    const root = mount(<OpenBotCard />);
    const [, manual] = details();
    expect(summary(manual)).toBe('Ręcznie');
    expect(manual.hasAttribute('open')).toBe(false);
    expect(find((e) => e.tagName === 'li', manual).map((l) => l.textContent)[0]).toMatch(/Marketplace → Aplikacje/);
    for (const f of ['command', 'args']) expect(find((e) => e.getAttribute('data-field') === f, manual), f).toHaveLength(1);
    expect(find((e) => e.hasAttribute('data-from-source'), manual)).toHaveLength(1);
    // Kroki ręczne tylko w „Ręcznie”
    expect(find((e) => e.tagName === 'li').length).toBe(find((e) => e.tagName === 'li', manual).length);
    const text = dom.container.textContent;
    expect(text).not.toMatch(/pojawi się|gdy OpenBot go udostępni/);
    expect(text).toMatch(/Wpis HyperQuant w Marketplace OpenBota jest w przygotowaniu/);
    act(() => root.unmount());
  });

  it('OpenBot przed publikacją w npm (repo): bez wiadomości (instaluje paczkę z npm), kroki ręczne od razu widoczne', () => {
    const root = mount(<OpenBotCard status="repo" />);
    expect(details()).toEqual([]);
    expect(dom.container.textContent).not.toContain('Kopiuj wiadomość');
    expect(dom.container.textContent).not.toContain('Jedną wiadomością');
    expect(find((e) => e.tagName === 'li')).toHaveLength(3);
    act(() => root.unmount());
  });

  it('OpenBot: npx i argumenty z wersją; z kodu źródłowego jedną mniejszą linią: polecenie node i ścieżka bundla', () => {
    const root = mount(<OpenBotCard />);
    const value = (f: string) => find((e) => e.hasAttribute('data-value'), find((e) => e.getAttribute('data-field') === f)[0])[0].textContent;
    expect(value('command')).toBe('npx');
    expect(value('args')).toBe(`-y ${NPM_SPEC}`);
    const [src] = find((e) => e.hasAttribute('data-from-source'));
    expect(src.textContent).toContain('node');
    expect(src.textContent).toContain(`${REPO_DIR}/${BUNDLE_PATH}`);
    expect(src.getAttribute('class')).toContain('text-xs');
    act(() => root.unmount());
  });

  it('inne klienty: JSON z npx; JSON z kodu źródłowego i zdanie o ścieżkach Windows w zwiniętym „Z kodu źródłowego”', async () => {
    const root = mount(<OtherClientsCard />);
    const pres = find((e) => e.tagName === 'pre');
    expect(pres[0].textContent).toBe(claudeDesktopJson('npm'));
    const [d] = details();
    expect(d.hasAttribute('open')).toBe(false);
    expect(summary(d)).toBe('Z kodu źródłowego');
    expect(d.textContent).toContain(claudeDesktopJson('repo'));
    expect(d.textContent).toContain('C:/');
    // Główny przycisk kopiuje JSON z npx
    const [copy] = find((e) => e.tagName === 'button' && e.textContent.includes('Kopiuj JSON'));
    await click(copy);
    expect(writeText).toHaveBeenCalledWith(claudeDesktopJson('npm'));
    act(() => root.unmount());
  });
});
