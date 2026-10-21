import { describe, expect, it } from 'vitest';
import {
  LEDGER_KEY,
  LedgerBar,
  LedgerEntry,
  appendEntry,
  bucketIndex,
  bucketStats,
  clearLedger,
  exportLedgerJson,
  ledgerMetrics,
  loadLedger,
  makeEntry,
  resolvePending,
  saveLedger,
} from '../forecastLedger';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 21, 12, 0, 0);

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: 'e1',
    createdAt: T0,
    direction: 'LONG',
    entry: 100000,
    stop: 99000,
    target: 102000,
    horizonMin: 120,
    pTarget: 0.3,
    pStop: 0.5,
    pNeither: 0.2,
    modelVersion: 'test',
    status: 'pending',
    ...over,
  };
}

// Świece 5m od `start`, każda z zadanym high/low (domyślnie spokojnie wokół 100 000)
function bars(start: number, n: number, over: Record<number, Partial<LedgerBar>> = {}): LedgerBar[] {
  return Array.from({ length: n }, (_, i) => ({ time: start + i * 5 * MIN, high: 100200, low: 99800, ...over[i] }));
}

class MemStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

describe('resolvePending — rozstrzyganie na świecach po czasie utworzenia', () => {
  const BAR = 5 * MIN;

  it('cel dotknięty pierwszy → target', () => {
    const b = bars(T0, 30, { 4: { high: 102050 }, 9: { low: 98900 } });
    const [r] = resolvePending([entry()], b, T0 + 60 * MIN, BAR);
    expect(r.status).toBe('target');
    expect(r.resolvedAt).toBe(T0 + 4 * BAR);
  });

  it('stop dotknięty pierwszy → stop (SHORT: stop nad wejściem)', () => {
    const e = entry({ direction: 'SHORT', stop: 101000, target: 98000 });
    const b = bars(T0, 30, { 3: { high: 101100 }, 6: { low: 97900 } });
    expect(resolvePending([e], b, T0 + 60 * MIN, BAR)[0].status).toBe('stop');
  });

  it('ta sama świeca dotyka obu poziomów → ostrożnie „stop”', () => {
    const b = bars(T0, 30, { 2: { high: 102100, low: 98900 } });
    expect(resolvePending([entry()], b, T0 + 60 * MIN, BAR)[0].status).toBe('stop');
  });

  it('świeca w toku przy utworzeniu jest pomijana (jej high/low mogą być sprzed planu)', () => {
    const created = T0 + 2 * MIN;
    const b = bars(T0, 30, { 0: { high: 102500 } });
    const [r] = resolvePending([entry({ createdAt: created })], b, created + 30 * MIN, BAR);
    expect(r.status).toBe('pending');
  });

  it('upływ horyzontu bez dotknięcia → none; przed upływem → pending', () => {
    const b = bars(T0, 30);
    expect(resolvePending([entry()], b, T0 + 100 * MIN, BAR)[0].status).toBe('pending');
    const [r] = resolvePending([entry()], b, T0 + 121 * MIN, BAR);
    expect(r.status).toBe('none');
    expect(r.resolvedAt).toBe(T0 + 120 * MIN);
  });

  it('dotknięcie po horyzoncie się nie liczy', () => {
    const b = bars(T0, 40, { 25: { high: 102500 } }); // 125 min > 120 min
    expect(resolvePending([entry()], b, T0 + 200 * MIN, BAR)[0].status).toBe('none');
  });

  it('brak świec z okresu planu → pending, po 7 dniach od horyzontu → nodata', () => {
    const late = bars(T0 + 600 * MIN, 30);
    expect(resolvePending([entry()], late, T0 + 700 * MIN, BAR)[0].status).toBe('pending');
    expect(resolvePending([entry()], late, T0 + 120 * MIN + 8 * 24 * 60 * MIN, BAR)[0].status).toBe('nodata');
  });

  it('dane nie sięgają końca horyzontu → pending (nie zgadujemy „none”)', () => {
    const b = bars(T0, 10); // do 50 min
    expect(resolvePending([entry()], b, T0 + 200 * MIN, BAR)[0].status).toBe('pending');
  });

  it('świece dłuższe niż 1/4 horyzontu → czekamy (za gruba rozdzielczość)', () => {
    const b = Array.from({ length: 10 }, (_, i) => ({ time: T0 + i * 60 * MIN, high: 102500, low: 99800 }));
    expect(resolvePending([entry()], b, T0 + 300 * MIN, 60 * MIN)[0].status).toBe('pending');
  });

  it('wpisy rozstrzygnięte zostają bez zmian (ta sama referencja)', () => {
    const done = entry({ status: 'target', resolvedAt: T0 });
    const out = resolvePending([done], bars(T0, 30), T0 + 300 * MIN, BAR);
    expect(out[0]).toBe(done);
  });
});

describe('metryki trafności', () => {
  const resolved: LedgerEntry[] = [
    entry({ id: 'a', pTarget: 0.25, pStop: 0.75, pNeither: 0, status: 'target' }),
    entry({ id: 'b', pTarget: 0.25, pStop: 0.75, pNeither: 0, status: 'stop' }),
    entry({ id: 'c', pTarget: 0.6, pStop: 0.3, pNeither: 0.1, status: 'none' }),
    entry({ id: 'd', status: 'pending' }),
    entry({ id: 'e', status: 'nodata' }),
  ];

  it('Brier wieloklasowy, Brier binarny P_T, log score i liczności', () => {
    const m = ledgerMetrics(resolved);
    expect(m.resolved).toBe(3);
    expect(m.pending).toBe(1);
    const brierA = 0.75 ** 2 + 0.75 ** 2;
    const brierB = 0.25 ** 2 + 0.25 ** 2;
    const brierC = 0.6 ** 2 + 0.3 ** 2 + 0.9 ** 2;
    expect(m.brier!).toBeCloseTo((brierA + brierB + brierC) / 3, 12);
    expect(m.brierTarget!).toBeCloseTo((0.75 ** 2 + 0.25 ** 2 + 0.6 ** 2) / 3, 12);
    expect(m.logScore!).toBeCloseTo(-(Math.log(0.25) + Math.log(0.75) + Math.log(0.1)) / 3, 12);
    expect(m.targetRate!).toBeCloseTo(1 / 3, 12);
  });

  it('pusty dziennik → metryki null (nie zero)', () => {
    const m = ledgerMetrics([entry()]);
    expect(m.brier).toBeNull();
    expect(m.logScore).toBeNull();
    expect(m.reliability.every((b) => b.n === 0)).toBe(true);
  });

  it('wykres niezawodności: 10 koszyków, średnia prognoza vs częstość', () => {
    const m = ledgerMetrics(resolved);
    expect(m.reliability).toHaveLength(10);
    const b2 = m.reliability[2];
    expect(b2.n).toBe(2);
    expect(b2.meanForecast).toBeCloseTo(0.25, 12);
    expect(b2.observed).toBeCloseTo(0.5, 12);
    expect(m.reliability[6].n).toBe(1);
    expect(m.reliability[6].observed).toBe(0);
  });

  it('indeks koszyka i statystyki koszyka dla Kelly', () => {
    expect(bucketIndex(0)).toBe(0);
    expect(bucketIndex(0.1)).toBe(1);
    expect(bucketIndex(1)).toBe(9);
    expect(bucketStats(resolved, 0.27)).toEqual({ n: 2, hits: 1 });
  });
});

describe('zapis lokalny, limit, eksport, czyszczenie', () => {
  it('zapis/odczyt pod kluczem hq.ledger.v1 i odrzucanie uszkodzonych wpisów', () => {
    const s = new MemStorage();
    expect(saveLedger([entry()], s)).toBe(true);
    expect(s.map.has(LEDGER_KEY)).toBe(true);
    expect(loadLedger(s)).toEqual([entry()]);
    s.setItem(LEDGER_KEY, JSON.stringify([entry(), { id: 'x', entry: 'abc' }, null]));
    expect(loadLedger(s)).toHaveLength(1);
    s.setItem(LEDGER_KEY, '{nie json');
    expect(loadLedger(s)).toEqual([]);
  });

  it('brak storage (tryb prywatny) nie rzuca', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadLedger(broken)).toEqual([]);
    expect(saveLedger([entry()], broken)).toBe(false);
    expect(() => clearLedger(broken)).not.toThrow();
  });

  it('limit wpisów: najstarsze odpadają', () => {
    let list: LedgerEntry[] = [];
    for (let i = 0; i < 7; i++) list = appendEntry(list, entry({ id: `n${i}` }), 5);
    expect(list.map((e) => e.id)).toEqual(['n2', 'n3', 'n4', 'n5', 'n6']);
  });

  it('makeEntry ustawia status pending, czas i wersję modelu', () => {
    const e = makeEntry(
      { direction: 'LONG', entry: 1, stop: 0.9, target: 1.2, horizonMin: 60, pTarget: 0.3, pStop: 0.6, pNeither: 0.1, source: 'test' },
      T0
    );
    expect(e.status).toBe('pending');
    expect(e.createdAt).toBe(T0);
    expect(e.modelVersion).toMatch(/plan-/);
    expect(e.id.length).toBeGreaterThan(4);
  });

  it('eksport JSON zawiera wpisy i metadane', () => {
    const parsed = JSON.parse(exportLedgerJson([entry()], T0));
    expect(parsed.key).toBe(LEDGER_KEY);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.exportedAt).toBe(new Date(T0).toISOString());
  });
});

describe('resolvePending — wymaga wypełnienia wejścia', () => {
  const base = {
    id: 'x', createdAt: 0, direction: 'LONG' as const, entry: 95000, stop: 94000, target: 97000,
    horizonMin: 60, pTarget: 0.4, pStop: 0.5, pNeither: 0.1, modelVersion: 't', status: 'pending' as const,
  };
  const bar = (i: number, low: number, high: number) => ({ time: i * 60_000, low, high });

  it('limit poniżej rynku bez wypełnienia → nofill (nie „target”)', () => {
    const bars = Array.from({ length: 61 }, (_, i) => bar(i, 99_900, 100_100));
    const [r] = resolvePending([base], bars, 61 * 60_000, 60_000);
    expect(r.status).toBe('nofill');
  });

  it('po wypełnieniu cel liczony od następnej świecy', () => {
    const bars = [bar(0, 94_900, 95_100), bar(1, 95_500, 97_200), ...Array.from({ length: 60 }, (_, i) => bar(i + 2, 96_000, 96_500))];
    const [r] = resolvePending([base], bars, 62 * 60_000, 60_000);
    expect(r.status).toBe('target');
  });

  it('stop w świecy wypełnienia → stop (ostrożnie)', () => {
    const bars = [bar(0, 93_900, 95_100), ...Array.from({ length: 61 }, (_, i) => bar(i + 1, 95_000, 95_200))];
    const [r] = resolvePending([base], bars, 62 * 60_000, 60_000);
    expect(r.status).toBe('stop');
  });
});
