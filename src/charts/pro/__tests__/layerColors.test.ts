import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRO, colorDistance } from '../chart/theme';
import { SOURCE_ORDER, SOURCE_INFO, ALL_COLOR } from '../chart/coverageStrip';

const ROOT = join(__dirname, '..');

/** Pliki warstw płótna (wykres, rysunki, wskaźniki) bez testów. */
const canvasFiles = (): string[] =>
  ['chart', 'draw', 'indicators'].flatMap((dir) =>
    readdirSync(join(ROOT, dir))
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => join(dir, f))
  );

/**
 * Wolno trzymać własne kolory: theme.ts (paleta Głębia), dawne presety (zamrożone zapisy użytkowników), paleta rysunków
 * (wybór użytkownika) i kolory instancji wskaźników w rejestrze (INDICATOR_COLORS i dawne kolory zapisów).
 */
const ALLOWED = new Set([join('chart', 'theme.ts'), join('chart', 'legacyPresets.ts'), join('draw', 'model.ts'), join('indicators', 'registry.ts')]);

describe('kolory warstw wykresu (paleta Głębia)', () => {
  it('warstwy płótna biorą kolory z theme.ts — bez pozostałości palet Neon i Desk', () => {
    const found: string[] = [];
    for (const f of canvasFiles()) {
      if (ALLOWED.has(f)) continue;
      // Bez komentarzy (w nich wolno napisać, jaki kolor był wcześniej); w napisach także kolor wewnątrz dłuższego tekstu
      const src = readFileSync(join(ROOT, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\s\/\/ .*$/gm, '');
      for (const m of src.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g))
        for (const c of m[2].match(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d[^)]*\)/g) ?? []) found.push(`${f}: ${c}`);
    }
    expect(found).toEqual([]);
  });

  it('kolory kategorii (turkus, złoto, fiolet, szary) i POC zdefiniowane w theme.ts tylko raz', () => {
    const theme = readFileSync(join(ROOT, 'chart', 'theme.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const c of ['#059583', '#B18E15', '#A878DB', '#7A889C', '#F1C45E']) expect(theme.match(new RegExp(c, 'gi'))?.length, c).toBe(1);
  });

  it('IB ma własny kolor, z dala od kolorów stron, VWAP, POC, poziomów i mapy z bloga', () => {
    for (const c of [PRO.buy, PRO.sell, PRO.buyInk, PRO.sellInk, PRO.vwap, PRO.svwap, PRO.profilePoc, PRO.level, PRO.blogMap, PRO.priceLine, PRO.zone, PRO.warn])
      expect(colorDistance(PRO.ib, c), `IB i ${c}`).toBeGreaterThanOrEqual(14);
  });

  it('pasek pokrycia (kreski 1–2 px): źródła w kolorach palety, różne od siebie i od kolorów słupków stron', () => {
    const colors = SOURCE_ORDER.map((s) => SOURCE_INFO[s].color);
    for (let i = 0; i < colors.length; i++) {
      for (const side of [PRO.buy, PRO.sell]) expect(colorDistance(colors[i], side), `${SOURCE_ORDER[i]} i ${side}`).toBeGreaterThanOrEqual(12);
      for (let j = i + 1; j < colors.length; j++) expect(colorDistance(colors[i], colors[j]), `${SOURCE_ORDER[i]} i ${SOURCE_ORDER[j]}`).toBeGreaterThanOrEqual(10);
    }
    expect(ALL_COLOR).toBe(PRO.ink1);
  });
});
