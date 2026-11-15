import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { syncIndex, syncManifest, syncReadme } from '../../scripts/markets/sync.mjs';

// Projekt 60 (M8): nazwy rynków desku tylko w konfiguracji (src/config/deskMarkets.ts). Nowy rynek = jeden wpis tam,
// a nie szukanie „złoto” po interfejsie. Wyjątki są jawne i mają powód.
const ROOT = join(import.meta.dirname, '..', '..');
const NAMES = /złot[aoeyu]\b|\bgold\b|S&P|SP500|BRENT|xyz:[A-Z]/i;
const EXCEPTIONS: Record<string, string> = {
  'src/views/market/MacroProxies.tsx': 'S&P 500 jako czynnik makro w regresji ruchu BTC (inny kontekst niż rynek desku)',
  'src/views/sources/LineageTable.tsx': 'opis pochodzenia danych (przykłady rynków HIP-3 i klas rejestru)',
};

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === '__tests__' ? [] : walk(p);
    return p.endsWith('.tsx') ? [p] : [];
  });

describe('nazwy rynków desku tylko w konfiguracji', () => {
  it('pliki .tsx poza wyjątkami nie mają nazw rynków w literałach', () => {
    const hits = walk(join(ROOT, 'src'))
      .map((p) => relative(ROOT, p).replace(/\\/g, '/'))
      .filter((p) => !(p in EXCEPTIONS))
      .filter((p) => NAMES.test(readFileSync(join(ROOT, p), 'utf8')));
    expect(hits).toEqual([]);
  });

  it('index.html, manifest i README są zsynchronizowane z konfiguracją', () => {
    const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
    expect(syncIndex(read('index.html'))).toBe(read('index.html'));
    expect(syncManifest(read('public/manifest.webmanifest'))).toBe(read('public/manifest.webmanifest'));
    expect(syncReadme(read('README.md'))).toBe(read('README.md'));
  });
});
