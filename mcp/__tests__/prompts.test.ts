import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PROMPTS } from '../src/prompts';
import { TOOLS } from '../src/tools/index';
import { connect, testSources } from './helpers';

const NOW = Date.UTC(2026, 10, 15, 6, 0);
const SKILL = readFileSync(path.resolve(import.meta.dirname, '..', '..', 'integrations', 'skills', 'hyperquant', 'SKILL.md'), 'utf8');
let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

describe('gotowe polecenia (prompts)', () => {
  it('jedno polecenie na przepis skilla, w tej samej kolejności, każde wywołuje tylko istniejące narzędzia', () => {
    const recipes = [...SKILL.matchAll(/^### (\d)\. /gm)].map((m) => Number(m[1]));
    expect(recipes).toEqual([1, 2, 3, 4, 5]);
    expect(PROMPTS).toHaveLength(recipes.length);
    const names = new Set(TOOLS.map((t) => t.name));
    for (const p of PROMPTS) {
      expect(p.tools.length, p.name).toBeGreaterThan(0);
      for (const t of p.tools) expect(names.has(t), `${p.name} → ${t}`).toBe(true);
      // Każde narzędzie z listy jest nazwane w treści polecenia
      for (const t of p.tools) expect(p.text({ session: 'london', level: '100000' }), `${p.name} → ${t}`).toContain(t);
    }
  });

  it('prompts/list i prompts/get przez protokół: przepis z zasadami, argumenty sesji i poziomu', async () => {
    const c = await connect(testSources({}, NOW).src);
    close = c.close;
    const { prompts } = await c.client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(PROMPTS.map((p) => p.name));
    expect(prompts.find((p) => p.name === 'check_level')?.arguments?.map((a) => [a.name, a.required])).toEqual([['level', true]]);
    expect(prompts.find((p) => p.name === 'prepare_session')?.arguments?.map((a) => [a.name, a.required ?? false])).toEqual([['session', false]]);

    const r = await c.client.getPrompt({ name: 'check_level', arguments: { level: '100000' } });
    const text = r.messages.map((m) => (m.content.type === 'text' ? m.content.text : '')).join('\n');
    expect(text).toContain('market_brief');
    expect(text).toContain('100000');
    // Zasady w każdym poleceniu: liczby tylko z narzędzi, plakietki, brak kierunku, stopka
    expect(text).toMatch(/LIVE/);
    expect(text).toMatch(/nie porada inwestycyjna|not investment advice/);
    expect(text).not.toMatch(/sygna|signal/i);

    await expect(c.client.getPrompt({ name: 'check_level', arguments: { level: 'dużo' } })).rejects.toThrow();
    await expect(c.client.getPrompt({ name: 'review_session', arguments: { session: 'tokyo' } })).rejects.toThrow();
  });
});
