import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HrelSummary } from '../../../utils/hourRel';
import { HrelLedgerCard } from '../HrelLedgerCard';

const DAY = 86_400_000;
const AT = Date.UTC(2026, 10, 13, 10);
const group = (n: number, meanP: number | null, freq: number | null) => ({ n, meanP, freq });
const lead = (j: number, n: number) => ({
  j,
  ...group(n, 0.484, 0.488),
  brier: 0.2051,
  bss: { value: 0.1796, lo: 0.1102, hi: 0.2433, days: 12 },
  auc: 0.7391,
  quintiles: Array.from({ length: 5 }, (_, k) => group(Math.floor(n / 5), 0.3 + k * 0.1, 0.28 + k * 0.1)),
});
const summary = (over: Partial<HrelSummary> = {}): HrelSummary => ({
  plan: { at: AT, hash: 'abc' },
  days: 30,
  leads: [0, 1, 2, 3].map((j) => lead(j, 290)),
  blocks: [],
  pooled: null,
  latest: { t: AT + 12 * DAY, x: [0.1, 0.2, 0.3], thr: [40, 41, 42, 43], p: [0.6123, 0.5987, 0.5876, 0.5765] },
  ...over,
});

describe('Po sesji: karta hrel-v1 w dzienniku (przed awansem tylko pomiar)', () => {
  it('cztery wyprzedzenia: Brier, BSS wobec 50% z przedziałem, AUC, średnie p i częstość', () => {
    const html = renderToStaticMarkup(<HrelLedgerCard h={summary()} />);
    expect(html).toContain('hrel-v1');
    expect(html).toContain('hrel-logit-v1');
    expect(html).toContain('MODEL');
    for (const w of ['0 h', '1 h', '2 h', '3 h']) expect(html).toContain(w);
    expect(html).toContain('18% [11%; 24%]');
    expect(html).toContain('0,74');
    expect(html).toContain('48% / 49%');
    expect(html).toContain('zakres godziny powyżej mediany tej godziny z 20 dni tego samego typu');
  });

  it('bez szans bieżącej prognozy: ostatnia prognoza tylko jako czas', () => {
    const html = renderToStaticMarkup(<HrelLedgerCard h={summary()} />);
    expect(html).not.toContain('61%');
    expect(html).not.toContain('0,61');
    expect(html).toContain('ostatni zapis');
  });

  it('bloki: t i kalibracja zakończonego bloku; za mało godzin — „—” z powodem; mała próba — „—”', () => {
    const block = { start: AT, end: AT + 14 * DAY, ...group(310, 0.47, 0.5), mean: -0.04, se: 0.01, t: -4.012, maxQDev: 0.061 };
    const html = renderToStaticMarkup(<HrelLedgerCard h={summary({ blocks: [block, { ...block, start: AT + 14 * DAY, end: AT + 28 * DAY, n: 120, t: null }] })} />);
    expect(html).toContain('−4,01');
    expect(html).toContain('6 pp');
    expect(html).toContain('od 300 godzin (jest 120)');
    const few = renderToStaticMarkup(<HrelLedgerCard h={summary({ leads: [0, 1, 2, 3].map((j) => lead(j, 5)) })} />);
    expect(few).toContain('od 20 rozstrzygnięć (jest 5)');
    expect(few).not.toContain('0,74');
  });
});

describe('hrel-v1 przed awansem: liczby tylko w karcie dziennika (i w MCP)', () => {
  it('żaden inny widok ani komponent strony nie czyta pola hrel ani modułu hourRel', () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const allowed = new Set(['utils/hourRel.ts', 'utils/deskLedger.ts', 'views/after/HrelLedgerCard.tsx', 'views/after/DeskLedgerPanel.tsx']);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) {
          if (f !== '__tests__') walk(p);
        } else if (/\.(ts|tsx)$/.test(f)) {
          const rel = relative(root, p).replace(/\\/g, '/');
          if (!allowed.has(rel) && /\bhrel|\bHrel|hourRel/.test(readFileSync(p, 'utf8'))) hits.push(rel);
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
