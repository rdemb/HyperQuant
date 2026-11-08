/**
 * Skill „hyperquant” (`integrations/skills/hyperquant/SKILL.md`): frontmatter w formacie skilli, każde narzędzie serwera
 * opisane i żadne wymyślone, pięć przepisów z narzędziami, zasady danych, po angielsku i bez trafień strażnika treści strony.
 */
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { DISCLAIMER } from '../../mcp/src/envelope';
import { TOOLS } from '../../mcp/src/tools/index';
import { TITLE_GUARDS, guardHits } from '../../src/utils/safeguards.mjs';
import { POLISH_LETTERS, readRepo, section, subsections, toolLikeNames } from './markdown';

const SKILL = readRepo('integrations/skills/hyperquant/SKILL.md');
const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));
/** Angielska połowa stałej stopki odpowiedzi narzędzi. */
const EN_DISCLAIMER = 'Market description, not investment advice.';

describe('skill hyperquant: SKILL.md', () => {
  it('frontmatter: name „hyperquant” i description do 300 znaków', () => {
    const m = /^---\n([\s\S]*?)\n---\n/.exec(SKILL);
    expect(m, 'frontmatter na początku pliku').not.toBeNull();
    const front = parse(m?.[1] ?? '') as { name?: unknown; description?: unknown };
    expect(front.name).toBe('hyperquant');
    expect(typeof front.description).toBe('string');
    const d = String(front.description);
    expect(d.length).toBeGreaterThan(40);
    expect(d.length).toBeLessThanOrEqual(300);
    expect(d).toContain('hyperquant-mcp');
  });

  it('każde narzędzie serwera jest opisane w backtickach', () => {
    expect(TOOLS).toHaveLength(10);
    for (const t of TOOLS) expect(SKILL, t.name).toContain(`\`${t.name}\``);
  });

  it('każda nazwa w kształcie narzędzia w backtickach istnieje w serwerze (żadnego wymyślonego narzędzia)', () => {
    const names = toolLikeNames(SKILL, TOOL_NAMES);
    expect(names.length).toBeGreaterThan(TOOLS.length);
    expect(names.filter((n) => !TOOL_NAMES.has(n))).toEqual([]);
  });

  it('pięć przepisów ze specyfikacji, każdy z narzędziami', () => {
    const recipes = subsections(SKILL, 'Recipes');
    expect(recipes.map((r) => r.title)).toHaveLength(5);
    // Przygotowanie do sesji, chwila obecna, rozliczenie sesji, poziom, krótki opis rynku na X
    const shapes = [/London[^\n]*New York/, /now/i, /review/i, /level/i, /note for X\b/];
    recipes.forEach((r, i) => {
      expect(r.title).toMatch(shapes[i]);
      const used = toolLikeNames(r.body, TOOL_NAMES).filter((n) => TOOL_NAMES.has(n));
      expect(used.length, r.title).toBeGreaterThan(0);
    });
  });

  it('zasady: liczby tylko z narzędzi, badge i asOf, „—” z powodem, bez rad, adresów i danych konta, stopka', () => {
    const rules = section(SKILL, 'Rules') ?? '';
    expect(rules).toMatch(/only from tool responses/i);
    for (const s of ['`badge`', '`asOf`', '—', 'LIVE', 'MODEL']) expect(rules, s).toContain(s);
    expect(rules).toMatch(/no advice/i);
    expect(rules).toMatch(/wallet address/i);
    expect(rules).toMatch(/account data/i);
    expect(DISCLAIMER).toContain(EN_DISCLAIMER);
    expect(rules).toContain(EN_DISCLAIMER);
    expect(section(SKILL, 'Response format'), 'sekcja formatu odpowiedzi').toBeTruthy();
  });

  it('RVOL zawsze z plakietką MODEL; share60 opisany jako null przy luce w nagraniu', () => {
    const lines = SKILL.split('\n');
    const rvol = lines.filter((l) => l.includes('RVOL'));
    expect(rvol.length).toBeGreaterThan(0);
    for (const l of rvol) expect(l).toContain('MODEL');
    expect(lines.some((l) => l.includes('share60') && l.includes('null') && /gap/.test(l))).toBe(true);
  });

  it('po angielsku i bez trafień strażnika treści strony (prywatność, rady)', () => {
    expect(SKILL).not.toMatch(POLISH_LETTERS);
    expect(guardHits(SKILL, TITLE_GUARDS).map((h) => `${h.guard.en}: ${h.fragment}`)).toEqual([]);
  });
});
