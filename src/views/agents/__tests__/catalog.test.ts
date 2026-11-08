/**
 * Treść zakładki Agenci AI zgodna ze źródłami: narzędzia jak w serwerze MCP (bez importu SDK do strony), przepisy jak
 * w SKILL.md, profile agentów do skopiowania jak pliki w repo. Teksty strony bez rad i bez danych prywatnych.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOLS } from '../../../../mcp/src/tools/index';
import { AGENT_TEMPLATES } from '../../../../integrations/agents/index';
import { subsections } from '../../../../integrations/__tests__/markdown';
import { TITLE_GUARDS, guardHits } from '../../../utils/safeguards.mjs';
import { SKILL_FILE, SKILL_RECIPES, TOOL_META, githubUrl } from '../catalog';
import { profileText } from '../profiles';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const README = read('mcp/README.md');
const SKILL = read(SKILL_FILE);
const TOOL_SOURCES = readdirSync(path.join(ROOT, 'mcp/src/tools'))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => read(`mcp/src/tools/${f}`))
  .join('\n');

const sorted = (xs: Iterable<string>) => [...xs].sort();
const guard = (s: string) => guardHits(s, TITLE_GUARDS).map((h) => `${h.guard.en}: ${h.fragment}`);

describe('narzędzia na stronie: metadane bez SDK', () => {
  it('te same 10 nazw co TOOLS serwera, bez powtórzeń', () => {
    expect(TOOL_META).toHaveLength(10);
    expect(new Set(TOOL_META.map((t) => t.name)).size).toBe(10);
    expect(sorted(TOOL_META.map((t) => t.name))).toEqual(sorted(TOOLS.map((t) => t.name)));
  });

  it('tytuły jak w serwerze: polski z TOOLS (testy działają po polsku), angielski z tej samej pary tr() w kodzie narzędzia', () => {
    for (const m of TOOL_META) {
      expect(m.title.pl, m.name).toBe(TOOLS.find((t) => t.name === m.name)?.title);
      expect(TOOL_SOURCES, m.name).toContain(`tr('${m.title.pl}', '${m.title.en}')`);
    }
  });

  it('każde narzędzie: opis i przykładowe pytanie po polsku i po angielsku; angielskie pytanie jak w README paczki', () => {
    for (const m of TOOL_META) {
      for (const s of [m.about.pl, m.about.en, m.ask.pl, m.ask.en]) expect(s.trim().length, m.name).toBeGreaterThan(10);
      const row = README.split('\n').find((l) => l.startsWith(`| \`${m.name}\``)) ?? '';
      expect(row, m.name).toContain(`"${m.ask.en}"`);
    }
  });

  it('kod zakładki nie importuje SDK MCP, zod ani kodu serwera (bundle strony bez nich)', () => {
    const dir = path.join(ROOT, 'src/views/agents');
    const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f));
    expect(files).toContain('AgentsView.tsx');
    for (const f of files) {
      const text = read(`src/views/agents/${f}`);
      expect(text, f).not.toMatch(/from ['"](?:@modelcontextprotocol|zod)/);
      // Z paczki tylko jej package.json (wersja do polecenia instalacji), nigdy kod serwera
      expect(text, f).not.toMatch(/from ['"][./]*mcp\/(?!package\.json['"])/);
    }
  });
});

describe('skill na stronie', () => {
  it('pięć przepisów w kolejności SKILL.md, z angielskim tytułem i przykładowym pytaniem z pliku', () => {
    const recipes = subsections(SKILL, 'Recipes');
    expect(recipes).toHaveLength(5);
    expect(SKILL_RECIPES.map((r) => r.title.en)).toEqual(recipes.map((r) => r.title.replace(/^\d+\.\s+/, '')));
    SKILL_RECIPES.forEach((r, i) => {
      expect(recipes[i].body, r.title.en).toContain(`"${r.ask.en}"`);
      expect(r.title.pl.trim().length).toBeGreaterThan(5);
      expect(r.ask.pl.trim().length).toBeGreaterThan(5);
    });
  });

  it('narzędzia przepisu istnieją w serwerze i przepis je wywołuje („Call `…`”)', () => {
    const recipes = subsections(SKILL, 'Recipes');
    SKILL_RECIPES.forEach((r, i) => {
      expect(r.tools.length, r.title.en).toBeGreaterThan(0);
      for (const t of r.tools) {
        expect(TOOL_META.some((m) => m.name === t), t).toBe(true);
        expect(recipes[i].body, `${r.title.en}: ${t}`).toMatch(new RegExp(`call \`${t}\``, 'i'));
      }
    });
  });

  it('link do SKILL.md i plików profili na GitHubie (gałąź main)', () => {
    expect(existsSync(path.join(ROOT, SKILL_FILE))).toBe(true);
    expect(githubUrl(SKILL_FILE)).toBe('https://github.com/rdemb/HyperQuant/blob/main/integrations/skills/hyperquant/SKILL.md');
  });
});

describe('profile agentów do skopiowania', () => {
  it('„Kopiuj profil” daje pełną treść angielskiego pliku profilu z repo (dołączoną do bundla przy budowie)', () => {
    for (const t of AGENT_TEMPLATES) {
      const text = profileText(t.file);
      expect(text, t.id).toBe(read(t.file));
      expect(text, t.id).toContain(`**Name:** ${t.name.en}`);
    }
    expect(profileText('integrations/agents/brak.md')).toBeNull();
  });
});

describe('teksty strony', () => {
  it('bez rad kupna i sprzedaży i bez danych prywatnych (strażnik treści strony)', () => {
    const texts = [
      ...TOOL_META.flatMap((m) => [m.title.pl, m.title.en, m.about.pl, m.about.en, m.ask.pl, m.ask.en]),
      ...SKILL_RECIPES.flatMap((r) => [r.title.pl, r.title.en, r.ask.pl, r.ask.en]),
    ];
    expect(texts.flatMap(guard)).toEqual([]);
  });
});
