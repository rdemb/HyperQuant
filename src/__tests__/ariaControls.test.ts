import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__') out.push(...sources(p));
    } else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Elementy, których cel `aria-controls` jest zawsze w dokumencie (tylko ukryty), więc atrybut może być stały. */
const ALWAYS_RENDERED = ['SessionReview.tsx:hintId', 'IndicatorsDialog.tsx:hintId'];

describe('aria-controls tylko na istniejący element', () => {
  it('menu i rozwijane bloki: aria-controls tylko, gdy są otwarte (zamknięte nie są w dokumencie)', () => {
    const bad: string[] = [];
    for (const f of sources('src')) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/aria-controls=\{([^}]*)\}/g)) {
        const expr = m[1].trim();
        if (expr.includes('?')) continue;
        if (ALWAYS_RENDERED.includes(`${path.basename(f)}:${expr}`)) continue;
        bad.push(`${f}: aria-controls={${expr}}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
