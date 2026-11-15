import { describe, expect, it } from 'vitest';
import { PROMPTS } from '../../../../mcp/src/prompts';
import { PERSONY, STRAZNICY, personaOf, personaState } from '../persony';
import type { Rule, RuleKind } from '../straznicy';
import { PROMPT_NAMES } from '../Wyspa';

const KINDS: RuleKind[] = ['poziom', 'pdh', 'pdl', 'sesja', 'funding', 'ruch', 'likwidacje'];
const base = { paused: false, live: true, alarmIds: new Set<string>(), cex: true };
const rule = (kind: RuleKind, on = true, id = kind): Rule => ({ id, kind, on, value: 1, session: 'london' });

describe('załoga wyspy', () => {
  it('każdy rodzaj reguły ma dokładnie jedną postać; gotowe warunki należą do swojej postaci; Sufler bez reguł', () => {
    for (const k of KINDS) expect(STRAZNICY.filter((p) => p.kinds.includes(k)), k).toHaveLength(1);
    for (const p of STRAZNICY) for (const pr of p.presets) expect(personaOf(pr.kind).id, p.id).toBe(p.id);
    expect(PERSONY.find((p) => p.id === 'sufler')?.kinds).toEqual([]);
    expect(new Set(PERSONY.map((p) => p.name)).size).toBe(PERSONY.length);
  });

  it('gotowe warunki tylko z kalibrowaną częstością albo jawnym opisem; bez słów porady i kierunku', () => {
    for (const p of PERSONY) {
      const text = `${p.role} ${p.freq ?? ''} ${p.note ?? ''}`;
      expect(text, p.id).not.toMatch(/sygna|signal|kup|sprzeda|buy|sell|wzrost|spadek/i);
      if (p.presets.length > 0) expect(p.freq ?? p.note, p.id).toBeTruthy();
    }
  });

  it('stan: śpi bez włączonych reguł, przy pauzie i bez danych LIVE; Iskra śpi bez strumieni giełd; alarm wygrywa', () => {
    const l = personaOf('pdh');
    expect(personaState(l, [], base)).toBe('spi');
    expect(personaState(l, [rule('pdh', false)], base)).toBe('spi');
    expect(personaState(l, [rule('pdh')], base)).toBe('czuwa');
    expect(personaState(l, [rule('pdh')], { ...base, paused: true })).toBe('spi');
    expect(personaState(l, [rule('pdh')], { ...base, live: false })).toBe('spi');
    expect(personaState(l, [rule('pdh')], { ...base, alarmIds: new Set(['pdh']) })).toBe('alarm');
    const i = personaOf('likwidacje');
    expect(personaState(i, [rule('likwidacje')], { ...base, cex: false })).toBe('spi');
    expect(personaState(i, [rule('likwidacje')], base)).toBe('czuwa');
  });

  it('Sufler: nazwy poleceń w kolejności przepisów są tymi z serwera MCP', () => {
    expect([...PROMPT_NAMES]).toEqual(PROMPTS.map((p) => p.name));
  });
});
