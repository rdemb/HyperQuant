import { describe, expect, it } from 'vitest';
import type { OHLCVBar } from '../../../types/trading';
import { COOLDOWN_MS, type Rule, type Snapshot, crossed, evaluate, marketWindows, parseRules } from '../straznicy';

const L = { price: (v: number) => String(v), pct: (v: number) => `${v}%`, usd: (v: number) => `$${v}`, session: (s: string) => s };
const snap = (p: Partial<Snapshot>): Snapshot => ({ at: 1_000_000, price: 100, pdh: 110, pdl: 90, fundingApr: 5, move15Pct: 0.1, liq5Usd: 0, session: 'london', ...p });

describe('strażnicy: przecięcie poziomu', () => {
  it('w górę i w dół; dotknięcie od dołu się liczy, brak liczby — nie', () => {
    expect(crossed(99, 101, 100)).toBe(true);
    expect(crossed(101, 99, 100)).toBe(true);
    expect(crossed(99, 100, 100)).toBe(true);
    expect(crossed(101, 102, 100)).toBe(false);
    expect(crossed(null, 101, 100)).toBe(false);
  });
});

describe('strażnicy: ocena reguł', () => {
  const rules: Rule[] = [
    { id: 'p', kind: 'poziom', on: true, value: 105 },
    { id: 'h', kind: 'pdh', on: true },
    { id: 's', kind: 'sesja', on: true, session: 'ny' },
    { id: 'f', kind: 'funding', on: true, value: 20 },
    { id: 'r', kind: 'ruch', on: true, value: 1 },
    { id: 'l', kind: 'likwidacje', on: true, value: 5_000_000 },
    { id: 'x', kind: 'poziom', on: false, value: 105 },
  ];

  it('bez poprzedniej migawki nic (pierwszy odczyt po otwarciu strony nie jest zdarzeniem)', () => {
    expect(evaluate(rules, null, snap({ price: 120 }), L)).toEqual([]);
  });

  it('każdy warunek raz, gdy stan się zmienia; wyłączona reguła milczy', () => {
    const prev = snap({});
    const cur = snap({ at: prev.at + 60_000, price: 112, session: 'ny', fundingApr: -25, move15Pct: 1.4, liq5Usd: 6e6 });
    const ev = evaluate(rules, prev, cur, L);
    expect(ev.map((e) => e.ruleId)).toEqual(['p', 'h', 's', 'f', 'r', 'l']);
    expect(ev[0].text).toContain('105');
    expect(ev.find((e) => e.ruleId === 'f')!.text).toContain('-25%');
  });

  it('próg już przekroczony wcześniej — bez nowego zdarzenia; po przerwie reguły i ponownym przecięciu — znowu', () => {
    const a = snap({ fundingApr: 30 });
    const b = snap({ at: a.at + 1000, fundingApr: 31 });
    expect(evaluate([{ id: 'f', kind: 'funding', on: true, value: 20 }], a, b, L)).toEqual([]);
    const r: Rule = { id: 'p', kind: 'poziom', on: true, value: 105, lastAt: a.at };
    expect(evaluate([r], snap({ price: 104 }), snap({ at: a.at + COOLDOWN_MS - 1, price: 106 }), L)).toEqual([]);
    expect(evaluate([r], snap({ price: 104 }), snap({ at: a.at + COOLDOWN_MS, price: 106 }), L)).toHaveLength(1);
  });

  it('teksty bez kierunku i bez słów porady', () => {
    const ev = evaluate(rules, snap({}), snap({ at: 2_000_000, price: 112, session: 'ny', fundingApr: 25, move15Pct: 2, liq5Usd: 9e6 }), L);
    for (const e of ev) expect(e.text).not.toMatch(/kup|sprzeda|long|short|wzrost|spadek|sygna|signal|buy|sell/i);
  });
});

describe('strażnicy: okna ruchu i likwidacji ze świec', () => {
  const bar = (min: number, close: number, liq = 0): OHLCVBar =>
    ({ time: min * 60_000, open: close, high: close, low: close, close, vbuy: 0, vsell: 0, spotVbuy: 0, spotVsell: 0, perpVbuy: 0, perpVsell: 0, lbuy: liq, lsell: liq }) as OHLCVBar;

  it('ruch 15 min od świecy sprzed 15 min, likwidacje z ostatnich 5 min', () => {
    const bars = Array.from({ length: 30 }, (_, i) => bar(i, 100 + i, i >= 26 ? 1000 : 0));
    const w = marketWindows(bars, 130, 29 * 60_000, 60);
    expect(w.move15Pct).toBeCloseTo(((130 - 114) / 114) * 100, 6);
    expect(w.liq5Usd).toBe(8000);
  });

  it('bez świec — null', () => {
    expect(marketWindows([], 100, 0, 60)).toEqual({ move15Pct: null, liq5Usd: null });
  });
});

describe('strażnicy: zapis na urządzeniu', () => {
  it('złe dane pomijane, reguła bez wymaganej wartości odpada', () => {
    const raw = JSON.stringify([
      { id: 'a', kind: 'poziom', on: true, value: 64000 },
      { id: 'b', kind: 'poziom', on: true },
      { id: 'c', kind: 'sesja', on: false, session: 'london' },
      { id: 'd', kind: 'nieznany', on: true },
      'zly',
    ]);
    expect(parseRules(raw).map((r) => r.id)).toEqual(['a', 'c']);
    expect(parseRules('{')).toEqual([]);
    expect(parseRules(null)).toEqual([]);
  });
});
