/**
 * Karty szablonów i skill na stronie: „Dodaj do OpenBota” (przycisk główny) kopiuje wiadomość instalacyjną szablonu
 * i jest opisany podpisem; „Kopiuj profil” zostaje drugorzędny; „Pobierz .md” i „Pobierz SKILL.md” to linki pobrania
 * plików, które strona publikuje (bez martwych linków).
 */
import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TEMPLATES } from '../../../../integrations/agents/index';
import { OPENBOT_PATHS, openbotFiles } from '../../../../integrations/agents/openbot';
import { type MiniElement, miniDom } from '../../../ui/__tests__/miniDom';
import { Skill, TemplateCard, Templates } from '../AgentsView';
import { BTN_PRIMARY, BTN_SECONDARY } from '../CopyButton';
import { SKILL_FILE, githubUrl } from '../catalog';
import { openbotHref, openbotSetupMessage } from '../openbotSetup';
import { profileText } from '../profiles';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const PUBLISHED = new Set(openbotFiles((p) => readFileSync(path.join(ROOT, p))).map((f) => `./agents/openbot/${f.path}`));

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
const links = () => find((e) => e.tagName === 'a');

describe('karta szablonu', () => {
  for (const t of AGENT_TEMPLATES) {
    it(`${t.id}: „Dodaj do OpenBota” (główny, z podpisem) kopiuje wiadomość szablonu; „Kopiuj profil” drugorzędny kopiuje profil`, async () => {
      const root = mount(<TemplateCard t={t} />);
      const buttons = find((e) => e.tagName === 'button');
      expect(buttons.map((b) => b.textContent)).toEqual(['Dodaj do OpenBota', 'Kopiuj profil']);
      const [add, profile] = buttons;
      expect(add.getAttribute('class')).toBe(BTN_PRIMARY);
      expect(profile.getAttribute('class')).toBe(BTN_SECONDARY);
      // Podpis przycisku: co kopiuje i gdzie wkleić
      const id = add.getAttribute('aria-describedby') ?? '';
      expect(id).not.toBe('');
      const captions = find((e) => e.getAttribute('id') === id);
      expect(captions).toHaveLength(1);
      expect(captions[0].textContent).toMatch(/kopiuje wiadomość/);
      expect(captions[0].textContent).toMatch(/agentowi w OpenBocie/);
      await click(add);
      expect(writeText).toHaveBeenLastCalledWith(openbotSetupMessage(t));
      await click(profile);
      expect(writeText).toHaveBeenLastCalledWith(profileText(t.file));
      act(() => root.unmount());
    });

    it(`${t.id}: „Pobierz .md” (download, ./agents/openbot/${t.id}.md) obok „Plik na GitHubie”`, () => {
      const root = mount(<TemplateCard t={t} />);
      const all = links();
      expect(all.map((a) => a.textContent.replace(/\(otwiera się w nowej karcie\)$/, ''))).toEqual(['Pobierz .md', 'Plik na GitHubie']);
      const [download, github] = all;
      expect(download.getAttribute('href')).toBe(`./agents/openbot/${t.id}.md`);
      expect(download.getAttribute('href')).toBe(openbotHref(OPENBOT_PATHS.profile(t.id)));
      expect(PUBLISHED.has(download.getAttribute('href') ?? '')).toBe(true);
      expect(download.hasAttribute('download')).toBe(true);
      expect(download.hasAttribute('target')).toBe(false);
      expect(github.getAttribute('href')).toBe(githubUrl(t.file));
      act(() => root.unmount());
    });
  }

  it('podpisy przycisków mają różne id (trzy karty na jednej stronie)', () => {
    const root = mount(<Templates />);
    const ids = find((e) => e.tagName === 'button' && e.hasAttribute('aria-describedby')).map((b) => b.getAttribute('aria-describedby'));
    expect(ids).toHaveLength(AGENT_TEMPLATES.length);
    expect(new Set(ids).size).toBe(AGENT_TEMPLATES.length);
    act(() => root.unmount());
  });

  it('nagłówek szablonów: w OpenBocie agent instaluje się jedną wiadomością, w innych klientach wkleja się profil', () => {
    const root = mount(<Templates />);
    const [head] = find((e) => e.tagName === 'p');
    expect(head.textContent).toMatch(/W OpenBocie agent instaluje się jedną wiadomością/);
    expect(head.textContent).toMatch(/w innych klientach wklej profil/);
    act(() => root.unmount());
  });
});

describe('skill', () => {
  it('„Pobierz SKILL.md” (download, ./agents/openbot/hyperquant/SKILL.md) obok linku do GitHuba', () => {
    const root = mount(<Skill />);
    const all = links();
    expect(all.map((a) => a.textContent.replace(/\(otwiera się w nowej karcie\)$/, ''))).toEqual(['Pobierz SKILL.md', 'SKILL.md na GitHubie']);
    const [download, github] = all;
    expect(download.getAttribute('href')).toBe('./agents/openbot/hyperquant/SKILL.md');
    expect(PUBLISHED.has(download.getAttribute('href') ?? '')).toBe(true);
    expect(download.hasAttribute('download')).toBe(true);
    expect(github.getAttribute('href')).toBe(githubUrl(SKILL_FILE));
    act(() => root.unmount());
  });
});
