/**
 * Publiczne szablony agentów (`integrations/agents`): dane dla strony zgodne z plikami profili, narzędzia istniejące
 * w serwerze i odpowiadające roli, profil gotowy do wklejenia (nazwa, tytuł, opis do 1200 znaków, instrukcje), wspólne
 * zasady danych, po angielsku i bez trafień strażnika treści strony.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOLS } from '../../mcp/src/tools/index';
import { TITLE_GUARDS, guardHits } from '../../src/utils/safeguards.mjs';
import { AGENT_TEMPLATES, type AgentTemplate } from '../agents/index';
import { POLISH_LETTERS, ROOT, readRepo, section, toolLikeNames } from './markdown';

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));
const EN_DISCLAIMER = 'Market description, not investment advice.';

/** Narzędzia każdej roli. */
const ROLE_TOOLS: Record<AgentTemplate['id'], string[]> = {
  desk: ['market_brief', 'session_context', 'day_map', 'session_review'],
  'big-hands': ['whales', 'liquidation_map', 'liquidation_tape', 'twaps'],
  'session-review': ['session_review', 'day_map', 'forecast_ledger'],
};

const files = AGENT_TEMPLATES.map((t) => ({ t, md: existsSync(path.join(ROOT, t.file)) ? readRepo(t.file) : '' }));
const sorted = (xs: Iterable<string>) => [...xs].sort();

describe('szablony agentów: AGENT_TEMPLATES i pliki profili', () => {
  it('trzy szablony o stałych id, każdy z własnym plikiem w integrations/agents', () => {
    expect(AGENT_TEMPLATES.map((t) => t.id)).toEqual(['desk', 'big-hands', 'session-review']);
    for (const t of AGENT_TEMPLATES) {
      expect(t.file).toMatch(/^integrations\/agents\/[a-z-]+\.md$/);
      expect(existsSync(path.join(ROOT, t.file)), t.file).toBe(true);
    }
    expect(new Set(AGENT_TEMPLATES.map((t) => t.file)).size).toBe(3);
  });

  it('narzędzia szablonu istnieją w serwerze i odpowiadają roli', () => {
    for (const t of AGENT_TEMPLATES) {
      expect(t.tools.filter((n) => !TOOL_NAMES.has(n)), t.id).toEqual([]);
      expect(sorted(t.tools), t.id).toEqual(sorted(ROLE_TOOLS[t.id]));
    }
  });

  it('plik wymienia dokładnie narzędzia szablonu, bez wymyślonych i bez cudzych', () => {
    for (const { t, md } of files) expect(sorted(new Set(toolLikeNames(md, TOOL_NAMES))), t.id).toEqual(sorted(t.tools));
  });

  it('plik wymaga serwera MCP hyperquant-mcp i skilla hyperquant', () => {
    for (const { t, md } of files) {
      const req = section(md, 'Requires') ?? '';
      expect(req, t.id).toContain('`hyperquant-mcp`');
      expect(req, t.id).toContain('`hyperquant`');
    }
  });

  it('profil gotowy do wklejenia: nazwa, tytuł, opis do 1200 znaków (sam w sobie kompletny), instrukcje', () => {
    for (const { t, md } of files) {
      expect(md, t.id).toContain(`**Name:** ${t.name.en}\n`);
      expect(md, t.id).toContain(`**Title:** ${t.role.en}\n`);
      const desc = section(md, 'Description') ?? '';
      expect(desc.length, t.id).toBeGreaterThan(300);
      expect(desc.length, t.id).toBeLessThanOrEqual(1200);
      for (const s of ['`hyperquant-mcp`', '`hyperquant`', 'LIVE', '`asOf`', '—', EN_DISCLAIMER]) expect(desc, `${t.id}: ${s}`).toContain(s);
      expect(desc, t.id).toMatch(/account data/);
      expect(section(md, 'Instructions')?.length ?? 0, t.id).toBeGreaterThan(300);
    }
  });

  it('nazwa, rola i 3–5 przykładowych poleceń w obu językach; angielskie polecenia są w pliku', () => {
    for (const { t, md } of files) {
      for (const s of [t.name.pl, t.name.en, t.role.pl, t.role.en]) expect(s.trim().length, t.id).toBeGreaterThan(0);
      expect(t.prompts.en.length, t.id).toBeGreaterThanOrEqual(3);
      expect(t.prompts.en.length, t.id).toBeLessThanOrEqual(5);
      expect(t.prompts.pl.length, t.id).toBe(t.prompts.en.length);
      const examples = section(md, 'Example prompts') ?? '';
      for (const p of t.prompts.en) expect(examples, `${t.id}: ${p}`).toContain(`"${p}"`);
    }
  });

  it('wspólne zasady: ta sama sekcja w trzech plikach, dane publiczne, bez konta, rad, handlu i adresów', () => {
    const rules = files.map(({ md }) => section(md, 'Rules') ?? '');
    expect(rules[0].length).toBeGreaterThan(200);
    expect(rules[1]).toBe(rules[0]);
    expect(rules[2]).toBe(rules[0]);
    for (const s of ['`badge`', '`asOf`', '—', 'LIVE', 'MODEL', EN_DISCLAIMER]) expect(rules[0], s).toContain(s);
    for (const re of [/public data only/i, /account data/i, /wallet address/i, /no buy or sell advice/i, /no trading/i, /not where price will go/i]) expect(rules[0]).toMatch(re);
  });

  it('RVOL zawsze z plakietką MODEL; szablon z twaps opisuje share60 jako null przy luce', () => {
    for (const { t, md } of files) {
      const lines = md.split('\n');
      for (const l of lines.filter((x) => x.includes('RVOL'))) expect(l, t.id).toContain('MODEL');
      if (t.tools.includes('twaps')) expect(lines.some((l) => l.includes('share60') && l.includes('null') && /gap/.test(l)), t.id).toBe(true);
    }
    expect(files.find((f) => f.t.id === 'desk')?.md).toContain('RVOL');
  });

  it('pliki po angielsku; pliki i teksty strony bez trafień strażnika treści (prywatność, rady)', () => {
    for (const { t, md } of files) {
      expect(md, t.id).not.toMatch(POLISH_LETTERS);
      expect(guardHits(md, TITLE_GUARDS).map((h) => `${t.id}: ${h.guard.en}: ${h.fragment}`)).toEqual([]);
      const texts = [t.name.pl, t.name.en, t.role.pl, t.role.en, ...t.prompts.pl, ...t.prompts.en];
      for (const s of texts) expect(guardHits(s, TITLE_GUARDS).map((h) => `${t.id}: ${h.guard.en}: ${h.fragment}`)).toEqual([]);
    }
  });
});
