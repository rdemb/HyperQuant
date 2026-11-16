import { describe, expect, it } from 'vitest';
import { INTERVALS, MEASURES, buildRates, round, verdict } from './rates.mjs';

/** Skrypt częstości bazowych SMC: tylko sprawdzian 2024+, zaokrąglenie, wniosek z przedziału, kontrola dopasowana. */

const m = (n, w, k, d, lo, hi, wniosek = 'brak różnicy') => ({ n, wartosc: w, wartosc_95: [0, 0], kontrola: k, kontrola_95: [0, 0], roznica: d, roznica_95: [lo, hi], wniosek });

function file(tf, over = {}) {
  const s = {};
  for (const [el, key] of MEASURES) {
    s[el] ??= {};
    s[el][key] = m(500, 80.04, 79.96, 0.08, -1.2, 1.3);
  }
  s.BOS_swing.niejednoznaczne_proc = 32.3;
  Object.assign(s, over);
  return { interwal: tf, do: '2026-11-07', przedzial: '95% bootstrap klastrowy (doba UTC), 2000 losowań', definicje: 'smcStructure.ts', okresy: { calosc: {}, sprawdzian_2024: s } };
}

const files = () => Object.fromEntries(INTERVALS.map((tf) => [tf, file(tf)]));
const matched = {
  metoda: 'warstwy',
  interwaly: {
    '5m': {
      sprawdzian_2024: {
        BOS_swing_dalszy_ruch_ATR: { n: 2452, element: 3.11, kontrola_zwykla: 2.51, kontrola_dopasowana: 2.86, roznica_dopasowana: 0.25, roznica_dopasowana_95: [0.1, 0.42] },
      },
    },
  },
};

describe('scripts/smc/rates.mjs', () => {
  it('zaokrąglenie połówek od zera, bez −0', () => {
    expect(round(0.25, 1)).toBe(0.3);
    expect(round(-0.25, 1)).toBe(-0.3);
    expect(round(-0.04, 1)).toBe(0);
    expect(Object.is(round(-0.04, 1), -0)).toBe(false);
    expect(round(3.114, 2)).toBe(3.11);
  });

  it('wniosek z przedziału 95%: 0 w przedziale (także na brzegu) to brak różnicy', () => {
    expect(verdict(0.1, 0.4)).toBe(1);
    expect(verdict(-0.4, -0.1)).toBe(-1);
    expect(verdict(-5.44, -0)).toBe(0);
    expect(verdict(0, 0.99)).toBe(0);
  });

  it('miara: odsetki do 0,1, ATR do 0,01, niejednoznaczne przy ruchu; kontrola dopasowana zastępuje zwykłą', () => {
    const warns = [];
    const out = buildRates(files(), matched, '2026-11-16', (w) => warns.push(w));
    expect(out.zrodlo).toMatchObject({ od: '2024-01-01', do: '2026-11-07', przedzial: '95% bootstrap klastrowy, 2000 losowań', wygenerowano: '2026-11-16' });
    expect(Object.keys(out.interwaly)).toEqual([...INTERVALS]);
    expect(out.interwaly['1h']['FVG.ce_24']).toEqual({ n: 500, v: 80, c: 80, d: 0.1, ci: [-1.2, 1.3], z: 0 });
    expect(out.interwaly['5m']['BOS_swing.dalszy_ruch_ATR']).toEqual({ n: 2452, v: 3.11, c: 2.86, d: 0.25, ci: [0.1, 0.42], z: 1, amb: 32, m: 1 });
    expect(out.interwaly['15m']['BOS_swing.dalszy_ruch_ATR']).toEqual({ n: 500, v: 80.04, c: 79.96, d: 0.08, ci: [-1.2, 1.3], z: 0, amb: 32 });
    expect(warns).toEqual([]);
  });

  it('miara z samym n zostaje z samym n; wniosek Backtestera sprzeczny z przedziałem: ostrzeżenie, zostaje przedział', () => {
    const fs = files();
    fs['1d'] = file('1d', { EQH_EQL: { sweep_lub_przelamanie_72: { n: 9 } } });
    fs['1h'] = file('1h', { sweep: { ponowne_wyjscie_24: m(800, 85.3, 88.1, -2.7, -5.44, -0, 'element niżej niż kontrola') } });
    const warns = [];
    const out = buildRates(fs, matched, '2026-11-16', (w) => warns.push(w));
    expect(out.interwaly['1d']['EQH_EQL.sweep_lub_przelamanie_72']).toEqual({ n: 9 });
    expect(out.interwaly['1h']['sweep.ponowne_wyjscie_24'].z).toBe(0);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatch(/^1h sweep\.ponowne_wyjscie_24/);
  });

  it('brak interwału albo miary to błąd z miejscem', () => {
    const fs = files();
    delete fs['4h'];
    expect(() => buildRates(fs, matched, '2026-11-16')).toThrow('brak pliku 4h.json');
    const fs2 = files();
    delete fs2['5m'].okresy.sprawdzian_2024.FVG.ce_24;
    expect(() => buildRates(fs2, matched, '2026-11-16')).toThrow('5m.json: brak miary FVG.ce_24');
  });
});
