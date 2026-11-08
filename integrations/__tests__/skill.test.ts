/**
 * Skill „hyperquant” (`integrations/skills/hyperquant/SKILL.md`): frontmatter w formacie skilli, każde narzędzie serwera
 * opisane i żadne wymyślone, argumenty narzędzi, pięć przepisów z narzędziami, zasady danych i jednostek, po angielsku
 * i bez trafień strażnika treści strony.
 */
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { DISCLAIMER } from '../../mcp/src/envelope';
import { TOOLS } from '../../mcp/src/tools/index';
import { TITLE_GUARDS, guardHits } from '../../src/utils/safeguards.mjs';
import { POLISH_LETTERS, readRepo, section, subsections, toolLikeNames } from './markdown';

const SKILL = readRepo('integrations/skills/hyperquant/SKILL.md');
const LINES = SKILL.split('\n');
const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));
/** Angielska połowa stałej stopki odpowiedzi narzędzi. */
const EN_DISCLAIMER = 'Market description, not investment advice.';
const LATEST_ONLY = 'Only the latest session of each type is available';
const recipe = (i: number) => subsections(SKILL, 'Recipes')[i]?.body ?? '';

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

  it('argumenty narzędzi: session_review (session) i market_brief (level), zgodnie ze schematami serwera', () => {
    const withInput = TOOLS.filter((t) => t.input).map((t) => [t.name, Object.keys(t.input?.shape ?? {})]);
    expect(withInput).toEqual([
      ['session_review', ['session']],
      ['market_brief', ['level']],
    ]);
    const intro = section(SKILL, 'Tools')?.split('\n|')[0] ?? '';
    for (const s of ['`session_review`', '`session`', '`market_brief`', '`level`']) expect(intro, s).toContain(s);
    expect(SKILL).not.toMatch(/Only `session_review` takes an argument/);
    const row = LINES.find((l) => l.startsWith('| `market_brief`')) ?? '';
    expect(row).toContain('`level`');
  });

  it('pięć przepisów ze specyfikacji, każdy z narzędziami', () => {
    const recipes = subsections(SKILL, 'Recipes');
    expect(recipes.map((r) => r.title)).toHaveLength(5);
    // Przygotowanie do sesji, chwila obecna, rozliczenie sesji, poziom, krótki opis rynku na X (Twitter)
    const shapes = [/London[^\n]*New York/, /now/i, /review/i, /level/i, /note for X \(Twitter\)/];
    recipes.forEach((r, i) => {
      expect(r.title).toMatch(shapes[i]);
      const used = toolLikeNames(r.body, TOOL_NAMES).filter((n) => TOOL_NAMES.has(n));
      expect(used.length, r.title).toBeGreaterThan(0);
    });
  });

  it('przepis „poziom”: market_brief z argumentem level i jego pola, typowa szerokość godziny, bez liczenia w głowie', () => {
    const r = recipe(3);
    for (const s of ['`market_brief`', '`level`', 'fromPrice.usd', 'fromPrice.pct', '`vwapDistance`', '`fuelToLevel`', 'typical width']) expect(r, s).toContain(s);
    expect(r).toMatch(/20%/);
    expect(r).toMatch(/do not compute/i);
    expect(SKILL).not.toMatch(/gives σ in USD/);
  });

  it('session_review: tylko ostatnia sesja każdego typu, w wierszu narzędzia i w przepisie rozliczenia', () => {
    const row = LINES.find((l) => l.startsWith('| `session_review`')) ?? '';
    expect(row).toContain(LATEST_ONLY);
    expect(recipe(2)).toContain(LATEST_ONLY);
    expect(recipe(2)).toContain('`session.opensAt`');
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

  it('jednostka ratio: ułamek albo krotność; krotności z ×, udziały jako procent, wyniki i p-wartości jako ułamki dziesiętne', () => {
    const units = LINES.find((l) => l.startsWith('- Units:')) ?? '';
    expect(units).toContain('a fraction or a multiple');
    expect(units).toMatch(/leverage[^\n]*RVOL|RVOL[^\n]*leverage/);
    expect(units).toContain('×');
    for (const s of ['`oiCoverage`', '`volumeShare`', '`share15`', '`share60`', '`rangeBudget`', 'percent']) expect(units, s).toContain(s);
    for (const s of ['CRPSS', 'Brier', 'BSS', 'Kupiec', 'plain decimals']) expect(units, s).toContain(s);
  });

  it('RVOL zawsze z plakietką MODEL; share60: wartości null z powodem (luka w nagraniu albo brak znacznika hasha zerowego)', () => {
    const rvol = LINES.filter((l) => l.includes('RVOL'));
    expect(rvol.length).toBeGreaterThan(0);
    for (const l of rvol) expect(l).toContain('MODEL');
    const share = LINES.find((l) => l.includes('`twaps.share60`')) ?? '';
    for (const s of ['`total`', '`buy`', '`sell`', 'null', 'gap', 'zero-hash']) expect(share, s).toContain(s);
  });

  it('czytelność i paliwo: value null z założenia; w szkielecie plakietka czytelności z odpowiedzi, nie stała MODEL', () => {
    expect(SKILL).toMatch(/clarity[^\n]*fuel[^\n]*null by design|fuel[^\n]*null by design/i);
    const clarity = LINES.find((l) => l.startsWith('Clarity yesterday')) ?? '';
    expect(clarity).toContain('{badge}');
    expect(clarity).not.toContain('MODEL');
  });

  it('te same funkcje co strona, ale wartości mogą się nieco różnić w tej samej chwili', () => {
    const line = LINES.find((l) => l.includes('same functions as')) ?? '';
    expect(line).toContain('can differ slightly from the site at the same moment');
  });

  it('nazewnictwo: X (Twitter), MODEL wielkimi literami, Day map, „touched”, New York (NY) przy pierwszym użyciu', () => {
    expect(SKILL).toContain('X (Twitter)');
    expect(SKILL).not.toMatch(/\(model\)/);
    expect(SKILL).toContain('Day map');
    expect(SKILL).not.toMatch(/\bday map\b/);
    expect(SKILL).not.toMatch(/\bhits?\b/i);
    expect(SKILL).toContain('New York (NY)');
    expect(SKILL.indexOf('New York (NY)')).toBeLessThan(SKILL.indexOf(' NY '));
  });

  it('po angielsku i bez trafień strażnika treści strony (prywatność, rady)', () => {
    expect(SKILL).not.toMatch(POLISH_LETTERS);
    expect(guardHits(SKILL, TITLE_GUARDS).map((h) => `${h.guard.en}: ${h.fragment}`)).toEqual([]);
  });
});
