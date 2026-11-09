import { describe, expect, it } from 'vitest';
import { tradeSessionOn } from '../../../utils/sessionDay';
import { DEFAULT_EFFORT_PARAMS, type EffortParams, type VBar, absorbsAt, aggressionAt, deltaOf, effortZones, valueArea } from '../core/effortZones';

/**
 * Strefy absorpcji i dyskonta swingu oraz pudełka Effort na syntetycznych świecach 5m w sesji NY: strefa powstaje
 * dopiero po potwierdzeniu pivota, uzbraja się po odejściu ceny, przebicie z agresją zmienia jej rolę, pudełko wymaga
 * agresji, wybicia i strony VWAP, a wynik dla świecy nie zmienia się po dojściu nowych świec.
 */

const MS = 5 * 60_000;
const NY = tradeSessionOn(Date.UTC(2026, 10, 4), 'ny');
/** Małe okna, żeby scenariusz mieścił się w kilkunastu świecach; bez stref dyskonta (osobny test). */
const P: EffortParams = { ...DEFAULT_EFFORT_PARAMS, pivotLen: 2, smaLen: 5, atrLen: 5, effortBreakout: 1, swingMinAtr: 1000 };

type Row = [o: number, h: number, l: number, c: number, v?: number, d?: number | null];
const mk = (rows: Row[], start = NY.start): VBar[] => rows.map(([o, h, l, c, v = 10, d = 0], i) => ({ t: start + i * MS, o, h, l, c, v, delta: d }));

const FLAT: Row = [100, 100.5, 99.5, 100];
/** Spadek do dołka z absorpcją (bar 8), odbicie, powrót do strefy (13), odbicie z pudełkami (14–17), zjazd (18). */
const SCENARIO: Row[] = [
  FLAT,
  FLAT,
  FLAT,
  FLAT,
  FLAT,
  FLAT,
  [100, 100.2, 98.5, 98.7, 10, -3],
  [98.7, 98.9, 97.5, 97.8, 10, -3],
  [97.8, 98.2, 96, 97.9, 40, -25],
  [97.9, 99, 97.7, 98.9, 12, 4],
  [98.9, 100.5, 98.7, 100.4, 12, 4],
  [100.4, 101, 100, 100.8, 10, 2],
  [100.8, 100.9, 98.6, 98.8, 10, -3],
  [98.8, 98.9, 97.2, 97.5, 10, -4],
  [97.5, 99.2, 97.3, 99.1, 25, 15],
  [99.1, 100.2, 99, 100.1, 20, 12],
  [100.1, 101.5, 100, 101.4, 22, 14],
  [101.4, 102.6, 101.3, 102.5, 25, 16],
  [102.5, 102.6, 99.8, 100, 15, -8],
];

describe('delta i profil', () => {
  it('delta z taśmy bez zmian; bez taśmy przybliżenie: wolumen × (2·położenie zamknięcia − 1)', () => {
    expect(deltaOf({ t: 0, o: 1, h: 2, l: 0, c: 1, v: 10, delta: -4 })).toBe(-4);
    expect(deltaOf({ t: 0, o: 1, h: 2, l: 0, c: 1.5, v: 10, delta: null })).toBeCloseTo(5);
    expect(deltaOf({ t: 0, o: 1, h: 1, l: 1, c: 1, v: 10, delta: null })).toBe(0);
  });

  it('value area: 70% wolumenu wokół POC', () => {
    const bars = mk([
      [100, 101, 100, 101, 10],
      [101, 102, 101, 102, 80],
      [102, 103, 102, 103, 10],
    ]);
    expect(valueArea(bars, 0, 2, 3, 0.7)).toEqual({ val: 101, vah: 102 });
  });

  it('udział świec z deltą przybliżoną ze świecy i serie dla każdej świecy', () => {
    const rows = SCENARIO.map((r, i) => (i % 4 === 0 ? ([r[0], r[1], r[2], r[3], r[4], null] as Row) : r));
    const r = effortZones(mk(rows), MS, P);
    expect(r.proxyShare).toBeCloseTo(5 / 19, 12);
    for (const s of [r.vwap, r.series.delta, r.series.smaV, r.series.smaD, r.series.atr]) expect(s).toHaveLength(19);
    // Średnie i ATR bez wartości przed pełnym oknem (5 świec)
    expect(Number.isNaN(r.series.atr[3])).toBe(true);
    expect(r.series.atr[4]).toBeCloseTo(1, 12);
    expect(r.series.smaV[4]).toBeCloseTo(10, 12);
  });
});

describe('VWAP sesji', () => {
  it('od otwarcia NY liczony od nowa; w godzinach azjatyckich od początku doby UTC', () => {
    const rows: Row[] = [
      [90, 91, 89, 90, 50],
      [90, 91, 89, 90, 50],
      [100, 101, 99, 100.5, 10],
      [100.5, 102, 100, 101.5, 30],
    ];
    const ny = effortZones(mk(rows, NY.start - 2 * MS), MS, P).vwap;
    expect(ny[1]).toBeCloseTo(90, 12);
    expect(ny[2]).toBeCloseTo((101 + 99 + 100.5) / 3, 12);
    expect(ny[3]).toBeCloseTo((10 * (101 + 99 + 100.5) + 30 * (102 + 100 + 101.5)) / 3 / 40, 12);
    // Azja: przed otwarciem Londynu VWAP od 00:00 UTC, bez resetu w ciągu tych świec
    const asia = effortZones(mk(rows, Date.UTC(2026, 10, 4, 1, 0)), MS, P).vwap;
    expect(asia[2]).toBeCloseTo((50 * 90 * 2 + 10 * ((101 + 99 + 100.5) / 3)) / 110, 12);
  });
});

describe('strefa absorpcji', () => {
  it('powstaje na zamknięciu świecy potwierdzającej pivot (nie wcześniej), od dołka do korpusu, najwyżej 1 ATR, uzbrojona po odejściu ceny', () => {
    const bars = mk(SCENARIO);
    expect(effortZones(bars.slice(0, 10), MS, P).zones).toEqual([]);
    const r = effortZones(bars.slice(0, 11), MS, P);
    expect(r.zones).toHaveLength(1);
    const z = r.zones[0];
    // Cena odeszła o 1 ATR już przed potwierdzeniem pivota: uzbrojona w chwili powstania
    expect(z).toMatchObject({ side: 1, kind: 'absorption', from: bars[8].t, createdAt: bars[10].t, lo: 96, to: null, end: null, armedAt: bars[10].t });
    // Korpus do 97,9, ale wysokość ograniczona do 1 ATR (ATR Wildera z 5 świec na dołku = 1,3936)
    expect(z.hi).toBeCloseTo(96 + 1.3936, 4);
  });

  it('armedAt: świeca, na której zamknięciu cena odeszła od strefy o 1 ATR, gdy to nastąpiło po powstaniu', () => {
    // Po dołku (bar 8) dwie spokojne świece: pivot potwierdzony na 10 bez odejścia ceny, odejście dopiero na 11
    const rows: Row[] = [...SCENARIO.slice(0, 9), [97.9, 98.3, 97.7, 98.2, 10, 1], [98.2, 98.4, 98, 98.3, 10, 0], [98.3, 100, 98.2, 99.9, 12, 4], [99.9, 100.2, 99.5, 100, 10, 0]];
    const bars = mk(rows);
    const r = effortZones(bars, MS, P);
    expect(r.zones).toHaveLength(1);
    expect(r.zones[0]).toMatchObject({ side: 1, kind: 'absorption', createdAt: bars[10].t, armedAt: bars[11].t, to: null });
    // Przed świecą odejścia strefa jest, ale nieuzbrojona
    const before = effortZones(bars.slice(0, 11), MS, P).zones;
    expect(before).toHaveLength(1);
    expect(before[0].armedAt).toBeNull();
  });

  it('nowa strefa nakładająca się w ponad połowie na aktywną strefę tej samej strony nie powstaje (zostaje pierwsza)', () => {
    // Drugi dołek z absorpcją w tym samym miejscu (bar 13): wciąż jedna strefa popytu
    const rows: Row[] = [
      ...SCENARIO.slice(0, 12),
      [100.8, 100.9, 98.6, 98.8, 10, -3],
      [98.8, 98.9, 96.1, 98.4, 40, -25],
      [98.4, 98.5, 97.9, 98.2, 10, 0],
      [98.2, 98.4, 98, 98.3, 10, 0],
    ];
    expect(effortZones(mk(rows), MS, P).zones.filter((z) => z.side === 1)).toHaveLength(1);
  });

  it('dołek bez dużego wolumenu ani delty nie daje strefy', () => {
    const quiet = SCENARIO.map((r) => [r[0], r[1], r[2], r[3], 10, 0] as Row);
    expect(effortZones(mk(quiet), MS, P).zones).toEqual([]);
  });

  it('przebicie z agresją pod VWAP kończy strefę i tworzy strefę podaży w tym samym miejscu', () => {
    const rows: Row[] = [...SCENARIO.slice(0, 12), [100.8, 100.9, 95, 95.2, 60, -45]];
    const bars = mk(rows);
    const r = effortZones(bars, MS, P);
    const demand = r.zones.find((z) => z.side === 1)!;
    expect(demand).toMatchObject({ end: 'broken', to: bars[12].t });
    const flip = r.zones.find((z) => z.kind === 'flip')!;
    expect(flip).toMatchObject({ side: -1, from: bars[12].t, createdAt: bars[12].t, lo: demand.lo, hi: demand.hi, to: null, end: null, armedAt: null });
  });

  it('strefa wygasa 12 h po powstaniu', () => {
    const tail: Row[] = Array.from({ length: 12 * 12 + 1 }, () => [100.5, 101, 100, 100.5] as Row);
    const bars = mk([...SCENARIO.slice(0, 12), ...tail]);
    const z = effortZones(bars, MS, P).zones[0];
    expect(z).toMatchObject({ end: 'expired', to: bars[10 + 145].t });
    expect(z.to! - z.createdAt).toBeGreaterThan(DEFAULT_EFFORT_PARAMS.zoneMaxAgeMs);
  });
});

describe('strefa dyskonta swingu', () => {
  it('swing wzrostowy ≥ 2 ATR: po potwierdzeniu szczytu strefa popytu od dołka swingu do VAL jego profilu', () => {
    const rows: Row[] = [
      FLAT,
      FLAT,
      FLAT,
      FLAT,
      FLAT,
      FLAT,
      [100, 100.2, 99, 99.2],
      [99.2, 99.3, 98, 98.2],
      [98.2, 99.5, 98.1, 99.4],
      [99.4, 100.6, 99.3, 100.5],
      [100.5, 101.6, 100.4, 101.5],
      [101.5, 102.6, 101.4, 102.5],
      [102.5, 103.6, 102.4, 103.5],
      [103.5, 103.55, 102.2, 102.3],
      [102.3, 102.4, 101.2, 101.3],
    ];
    const bars = mk(rows);
    const p = { ...P, swingMinAtr: DEFAULT_EFFORT_PARAMS.swingMinAtr };
    expect(effortZones(bars.slice(0, 14), MS, p).zones).toEqual([]);
    const r = effortZones(bars, MS, p);
    expect(r.zones).toHaveLength(1);
    const z = r.zones[0];
    expect(z).toMatchObject({ side: 1, kind: 'discount', from: bars[7].t, createdAt: bars[14].t, lo: 98, to: null, armedAt: bars[14].t });
    // VAL profilu świec od dołka (7) do szczytu (12), wysokość od 0,15 do 1 ATR z dołka swingu
    const va = valueArea(bars, 7, 12, DEFAULT_EFFORT_PARAMS.profileBins, 0.7)!;
    const a = r.series.atr[7];
    expect(z.hi).toBeCloseTo(98 + Math.min(a, Math.max(0.15 * a, va.val - 98)), 12);
    // Swing 5,6 przy ATR ok. 1,19 to mniej niż 5 ATR: przy takim progu strefy nie ma
    expect(effortZones(bars, MS, { ...p, swingMinAtr: 5 }).zones).toEqual([]);
  });
});

describe('pudełka Effort', () => {
  it('agresja z taśmy, świeca kierunkowa, wybicie poprzedniej świecy i strona VWAP; nałożone, gdy poprzednie tej strony do 3 świec wcześniej', () => {
    const bars = mk(SCENARIO);
    const r = effortZones(bars, MS, P);
    const at = (t: number) => bars.findIndex((b) => b.t === t);
    expect(r.boxes.map((b) => [at(b.t), b.side, b.stacked])).toEqual([
      [6, -1, false],
      [7, -1, true],
      [14, 1, false],
      [15, 1, true],
      [16, 1, true],
      [17, 1, true],
    ]);
    // Pudełko kupna: od dołka świecy do połowy korpusu; sprzedaży: od połowy korpusu do szczytu
    expect(r.boxes[2].lo).toBe(97.3);
    expect(r.boxes[2].hi).toBeCloseTo(98.3, 12);
    expect(r.boxes[0].lo).toBeCloseTo(99.35, 12);
    expect(r.boxes[0].hi).toBe(100.2);
  });

  it('bez taśmy: zamknięcie w górnych 30% zakresu i wolumen ponad 1,2 × średnia', () => {
    const base: Row[] = Array.from({ length: 12 }, () => FLAT);
    const box = (v: number, d: number | null) => effortZones(mk([...base, [100, 101.5, 99.9, 101.4, v, d]]), MS, P).boxes;
    const tape = box(30, 20);
    expect(tape).toHaveLength(1);
    expect(tape[0]).toMatchObject({ side: 1, t: NY.start + 12 * MS, lo: 99.9, stacked: false });
    expect(tape[0].hi).toBeCloseTo(100.7, 12);
    expect(box(30, null)).toHaveLength(1);
    // Wolumen 12 przy średniej 10,4: poniżej 1,2 × średnia
    expect(box(12, null)).toEqual([]);
  });

  it('ta sama świeca pod VWAP sesji nie daje pudełka kupna', () => {
    const rows: Row[] = [[110, 110.5, 109.5, 110, 1000], ...Array.from({ length: 11 }, () => FLAT), [100, 101.5, 99.9, 101.4, 30, 20]];
    const r = effortZones(mk(rows), MS, P);
    expect(r.vwap[12]).toBeGreaterThan(101.4);
    expect(r.boxes).toEqual([]);
  });
});

describe('funkcje na seriach', () => {
  const bars = mk(SCENARIO);
  const r = effortZones(bars, MS, P);

  it('aggressionAt: agresja strony na świecy (delta z taśmy ponad 1,2 × średnia |delty|)', () => {
    expect(aggressionAt(bars, r.series, 14, 1, P)).toBe(true);
    expect(aggressionAt(bars, r.series, 14, -1, P)).toBe(false);
    // Delta 4 przy średniej |delty| 7: za mało
    expect(aggressionAt(bars, r.series, 9, 1, P)).toBe(false);
  });

  it('absorbsAt: absorpcja podaży (side 1) na dołku z dużym wolumenem i zamknięciem w górnej połowie', () => {
    expect(absorbsAt(bars, r.series, 8, 10, 1, P)).toBe(true);
    expect(absorbsAt(bars, r.series, 8, 10, -1, P)).toBe(false);
    expect(absorbsAt(bars, r.series, 7, 10, 1, P)).toBe(false);
  });
});

describe('bez wglądu w przyszłość', () => {
  it('strefy, ich uzbrojenie i koniec, pudełka i VWAP dla świec 0..k są takie same w obliczeniu na samych świecach 0..k', () => {
    const rows: Row[] = [...SCENARIO, [100, 100.1, 97.3, 97.6, 10, -4], [97.6, 100.4, 97.5, 100.3, 25, 15], [100.3, 100.4, 94, 94.2, 60, -45], [94.2, 94.5, 93.8, 94.4]];
    const bars = mk(rows);
    const full = effortZones(bars, MS, P);
    expect(full.zones.length).toBeGreaterThan(1);
    for (let k = 1; k <= bars.length; k++) {
      const part = effortZones(bars.slice(0, k), MS, P);
      const last = bars[k - 1].t;
      const seen = (t: number | null) => (t !== null && t <= last ? t : null);
      const key = (z: { side: number; kind: string; from: number; createdAt: number; lo: number; hi: number }) => `${z.side}|${z.kind}|${z.from}|${z.createdAt}|${z.lo}|${z.hi}`;
      const want = full.zones.filter((z) => z.createdAt <= last);
      expect(part.zones.map(key)).toEqual(want.map(key));
      expect(part.zones.map((z) => [z.armedAt, z.to, z.end])).toEqual(want.map((z) => [seen(z.armedAt), seen(z.to), seen(z.to) === null ? null : z.end]));
      expect(part.boxes).toEqual(full.boxes.filter((b) => b.t <= last));
      expect([...part.vwap]).toEqual([...full.vwap.slice(0, k)]);
    }
  });
});
