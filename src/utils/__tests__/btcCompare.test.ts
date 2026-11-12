import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Test statyczny etapu M1 (rynki z rejestru): kod nie porównuje nazwy rynku z BTC. Warstwy zależne od skanera, prognoz,
 * map z bloga i rynków HIP-4 pytają moduł zdolności (`utils/marketCaps`). Wyjątki to widoki i dane, które według projektu
 * zostają przy BTC — każdy z powodem; wyjątek bez porównania też jest błędem (lista nie może się zestarzeć).
 */

const SRC = path.resolve(import.meta.dirname, '../..');
const BTC_COMPARE = /[!=]==\s*['"`]BTC['"`]|['"`]BTC['"`]\s*[!=]==/;

const ALLOWED: Record<string, string> = {
  'utils/marketCaps.ts': 'moduł zdolności rynku',
  'components/schrodi/useSchrodi.ts': 'kot zostaje przy BTC',
  'state/useDeskFeed.ts': 'strumień desku BTC (Przed sesją, Po sesji, MCP)',
  'utils/marketDataFeed.ts': 'dane desku BTC (Przed sesją, Po sesji, MCP)',
  'charts/orderflow/orderFlowStore.ts': 'mapa ciepła desku BTC (arkusz BTC)',
  'utils/hip4.ts': 'pole danych rynków HIP-4 (instrument bazowy), nie rynek wykresu',
  'views/market/MarketMap.tsx': 'wyróżnienie kafla BTC na mapie rynku, nie rynek wykresu',
};

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') out.push(...files(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => path.relative(SRC, p).split(path.sep).join('/');

describe('porównania z BTC tylko w module zdolności i w widokach BTC', () => {
  const all = files(SRC);

  it('żaden inny plik nie porównuje nazwy z BTC', () => {
    const hits: string[] = [];
    for (const f of all) {
      const r = rel(f);
      if (r in ALLOWED) continue;
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (BTC_COMPARE.test(line)) hits.push(`${r}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it('każdy wyjątek nadal porównuje z BTC (inaczej usuń go z listy)', () => {
    for (const r of Object.keys(ALLOWED)) expect(BTC_COMPARE.test(readFileSync(path.join(SRC, r), 'utf8')), r).toBe(true);
  });
});
