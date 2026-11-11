/**
 * BSS dotknięć poziomów wobec samej częstości bazowej wygląda na dużą umiejętność, bo częstość nie zna odległości poziomu
 * od ceny. Każdy tekst, który mówi o BSS dziennika prognoz (opis narzędzia MCP, skill, szablony agentów, README, opisy na
 * stronie), mówi w tym samym zdaniu także o bazie odległości.
 */
import { describe, expect, it } from 'vitest';
import { readRepo } from './markdown';

const FILES = [
  'integrations/skills/hyperquant/SKILL.md',
  'integrations/agents/session-review.md',
  'mcp/README.md',
  'mcp/mcpb/manifest.json',
  'mcp/src/tools/scanner.ts',
  'src/views/agents/catalog.ts',
  'src/views/sources/LineageTable.tsx',
  'README.md',
];
/** Baza odległości nazwana wprost: pole, słowo albo nazwa wzoru */
const DIST = /bssDist|distance|odległoś|reflection|odbicia/i;

describe('BSS dotknięć zawsze w parze z bazą odległości', () => {
  for (const f of FILES) {
    it(f, () => {
      const lines = readRepo(f)
        .split('\n')
        .filter((l) => /\bBSS\b/.test(l));
      expect(lines.length, `${f}: brak wzmianki o BSS`).toBeGreaterThan(0);
      for (const l of lines) expect(l, f).toMatch(DIST);
    });
  }
});
