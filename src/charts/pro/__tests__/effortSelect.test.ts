import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type EffortBox, type EffortResult, type EffortZone, type Side, type VBar, effortZones } from '../core/effortZones';
import { BROKEN_BARS, effortRects, selectEffort } from '../chart/effortSelect';

const MS = 5 * 60_000;
const T0 = Date.UTC(2026, 9, 24, 12, 0);
const ATR = 10;

/** Świece płaskie wokół 1000 z deltą z taśmy (albo bez, `tape` false). */
function bars(n: number, close = 1000, tape = true): VBar[] {
  return Array.from({ length: n }, (_, i) => ({ t: T0 + i * MS, o: close, h: close + 2, l: close - 2, c: close, v: 10, delta: tape ? 1 : null }));
}

let nextId = 1;
function zone(side: Side, lo: number, hi: number, o: Partial<EffortZone> = {}): EffortZone {
  return { id: nextId++, side, kind: 'absorption', from: T0, createdAt: T0 + MS, lo, hi, to: null, end: null, armedAt: T0 + 2 * MS, ...o };
}

function result(zones: EffortZone[], boxes: EffortBox[], n: number): EffortResult {
  return { zones, boxes, vwap: new Float64Array(n), proxyShare: 0, series: { delta: new Float64Array(n), smaV: new Float64Array(n), smaD: new Float64Array(n), atr: new Float64Array(n).fill(ATR) } };
}

const at = (i: number) => T0 + i * MS;

describe('wybór stref i pudełek do rysowania (effortSelect)', () => {
  it('(a) z 6 aktywnych stref jednej strony 2 najbliższe ceny (telefon: 1); reszta w liczniku „dalej”', () => {
    const b = bars(40);
    const zs = [zone(1, 900, 905), zone(1, 950, 955), zone(1, 980, 985), zone(1, 960, 964), zone(1, 920, 925), zone(1, 940, 944)];
    const s = selectEffort(result(zs, [], 40), b, MS, at(39), { phone: false, history: false });
    expect(s.bands.map((x) => x.lo)).toEqual([980, 960]);
    expect(s.far).toEqual({ demand: 4, supply: 0 });
    expect(selectEffort(result(zs, [], 40), b, MS, at(39), { phone: true, history: false }).bands.map((x) => x.lo)).toEqual([980]);
  });

  it('(b) przerwa 0,2 ATR łączy w jedno pasmo ze znacznikiem łączonym, 0,3 ATR — nie; pasmo ponad 1,5 ATR nie powstaje', () => {
    const b = bars(40);
    const one = selectEffort(result([zone(1, 980, 985), zone(1, 987, 990, { kind: 'discount' })], [], 40), b, MS, at(39), { phone: false, history: false });
    expect(one.bands).toHaveLength(1);
    expect([one.bands[0].lo, one.bands[0].hi, one.bands[0].mark]).toEqual([980, 990, 'A·D']);
    expect(selectEffort(result([zone(1, 980, 985), zone(1, 988, 990)], [], 40), b, MS, at(39), { phone: false, history: false }).bands).toHaveLength(2);
    const tall = selectEffort(result([zone(1, 970, 980), zone(1, 981, 990)], [], 40), b, MS, at(39), { phone: false, history: false });
    expect(tall.bands).toHaveLength(2);
  });

  it('(c) strefa nieuzbrojona, zakończona, jeszcze nieznana i uzbrojona później nie wchodzą', () => {
    const b = bars(40);
    const zs = [
      zone(1, 980, 985, { armedAt: null }),
      zone(1, 970, 975, { to: at(30), end: 'expired' }),
      zone(-1, 1010, 1015, { createdAt: at(39) + MS }),
      zone(-1, 1020, 1025, { armedAt: at(39) + MS }),
    ];
    expect(selectEffort(result(zs, [], 40), b, MS, at(39), { phone: false, history: false }).bands).toEqual([]);
  });

  it('(d) przebita: sam obrys przez 6 świec od przebicia (najnowsza), w siódmej znika; na telefonie nie ma', () => {
    const b = bars(60);
    const z = zone(1, 980, 985, { to: at(30), end: 'broken' });
    const sel = (i: number, phone = false) => selectEffort(result([z], [], 60), b, MS, at(i), { phone, history: false }).broken;
    for (let i = 30; i < 30 + BROKEN_BARS; i++) expect(sel(i)?.lo, `świeca ${i}`).toBe(980);
    expect(sel(30 + BROKEN_BARS)).toBeNull();
    expect(sel(31, true)).toBeNull();
    // W tym samym miejscu rysowana strefa po zmianie roli — bez obrysu przebitej
    const flip = zone(-1, 980, 985, { kind: 'flip', createdAt: at(30), armedAt: at(30) });
    expect(selectEffort(result([z, flip], [], 60), b, MS, at(32), { phone: false, history: false }).broken).toBeNull();
  });

  it('(e) trzy nałożone pudełka to jedno pudełko z wypełnieniem na świecach serii; starsze niż 12 świec i bez taśmy nie wchodzą', () => {
    const b = bars(60);
    const bx = (i: number, side: Side = 1, lo = 990, hi = 995): EffortBox => ({ side, t: at(i), lo, hi, stacked: false });
    const s = selectEffort(result([], [bx(40), bx(41, 1, 988, 994), bx(43, 1, 991, 999)], 60), b, MS, at(50), { phone: false, history: false });
    expect(s.boxes).toHaveLength(1);
    expect(s.boxes[0]).toMatchObject({ side: 1, from: at(40), last: at(43), lo: 988, hi: 999, cells: [at(40), at(41), at(43)] });
    expect(selectEffort(result([], [bx(40)], 60), b, MS, at(53), { phone: false, history: false }).boxes).toEqual([]);
    const noTape = bars(60, 1000, false);
    expect(selectEffort(result([], [bx(40)], 60), noTape, MS, at(45), { phone: false, history: false }).boxes).toEqual([]);
  });

  it('pudełka: jedna seria na stronę (ostatnia), na telefonie nowsza z dwóch; legenda liczy świece z taśmą', () => {
    const b = bars(60);
    const bx = (i: number, side: Side): EffortBox => ({ side, t: at(i), lo: 990, hi: 995, stacked: false });
    const list = [bx(30, 1), bx(44, 1), bx(46, -1)];
    expect(selectEffort(result([], list, 60), b, MS, at(50), { phone: false, history: false }).boxes.map((x) => [x.side, x.from])).toEqual([
      [1, at(44)],
      [-1, at(46)],
    ]);
    expect(selectEffort(result([], list, 60), b, MS, at(50), { phone: true, history: false }).boxes.map((x) => x.side)).toEqual([-1]);
    expect(selectEffort(result([], [], 60), b, MS, at(50), { phone: false, history: false }).tapeLast12).toBe(12);
    expect(selectEffort(result([], [], 60), bars(60, 1000, false), MS, at(50), { phone: false, history: false }).tapeLast12).toBe(0);
  });

  it('początek pasma na świecy powstania (najstarszej strefy pasma), kraniec swingu jako znacznik', () => {
    const b = bars(40);
    const s = selectEffort(result([zone(1, 980, 985, { from: at(3), createdAt: at(8) }), zone(1, 986, 989, { from: at(10), createdAt: at(15) })], [], 40), b, MS, at(39), { phone: false, history: false });
    expect(s.bands[0].start).toBe(at(8));
    expect(s.bands[0].extremes).toEqual([
      { t: at(3), p: 980 },
      { t: at(10), p: 986 },
    ]);
  });

  it('cena wewnątrz pasma: odległość 0; równa odległość — wygrywa młodsze', () => {
    const b = bars(40);
    // Przerwy większe niż 0,25 ATR — bez łączenia
    const zs = [zone(1, 980, 984), zone(1, 990, 993), zone(1, 997, 1001), zone(1, 1006, 1008)];
    expect(selectEffort(result(zs, [], 40), b, MS, at(39), { phone: false, history: false }).bands.map((x) => x.lo)).toEqual([997, 1006]);
    const tie = [zone(1, 990, 994, { createdAt: at(5) }), zone(1, 1006, 1008, { createdAt: at(9) })];
    expect(selectEffort(result(tie, [], 40), b, MS, at(39), { phone: true, history: false }).bands.map((x) => x.lo)).toEqual([1006]);
  });

  it('tryb „Historia”: obrys każdej strefy znanej do chwili i każdej serii pudełek, bez wypełnień i bez łączenia', () => {
    const b = bars(60);
    const zs = [zone(1, 980, 985), zone(1, 986, 989), zone(-1, 1010, 1015, { to: at(20), end: 'broken' }), zone(1, 900, 905, { armedAt: null })];
    const bx = (i: number): EffortBox => ({ side: 1, t: at(i), lo: 990, hi: 995, stacked: false });
    const s = selectEffort(result(zs, [bx(10), bx(11), bx(30)], 60), b, MS, at(50), { phone: false, history: true });
    expect(s.history).toBe(true);
    expect(s.bands).toHaveLength(4);
    expect(s.boxes).toHaveLength(2);
    expect(effortRects(s)).toBe(6);
  });
});

/** Świece 5m nagranych dób przy lekcjach (20–24.10.2026) z deltą kupno − sprzedaż, gdy plik ją ma. */
function recorded(): VBar[] {
  const byT = new Map<number, VBar>();
  for (const f of readdirSync('public/lessons').filter((x) => x.endsWith('.json')).sort()) {
    const j = JSON.parse(readFileSync(`public/lessons/${f}`, 'utf8')) as { coin: string; candles: (number | null)[][] };
    if (j.coin !== 'BTC') continue;
    for (const [t, o, h, l, c, v, buy, sell] of j.candles) {
      byT.set(t as number, { t: t as number, o: o as number, h: h as number, l: l as number, c: c as number, v: v as number, delta: buy !== null && sell !== null ? (buy as number) - (sell as number) : null });
    }
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

describe('effortSelect na nagranych dobach', () => {
  const all = recorded();
  const full = effortZones(all, MS);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  it('(f) limit: komputer najwyżej 7 prostokątów, telefon najwyżej 3 w 1000 losowych chwilach', () => {
    let maxD = 0;
    let maxP = 0;
    for (let k = 0; k < 1000; k++) {
      const i = 30 + Math.floor(rnd() * (all.length - 30));
      maxD = Math.max(maxD, effortRects(selectEffort(full, all, MS, all[i].t, { phone: false, history: false })));
      maxP = Math.max(maxP, effortRects(selectEffort(full, all, MS, all[i].t, { phone: true, history: false })));
    }
    expect(maxD).toBeLessThanOrEqual(7);
    expect(maxP).toBeLessThanOrEqual(3);
    expect(maxD).toBeGreaterThan(0);
  });

  it('stałość: chwila X z krótszą historią i ze świecami dopisanymi po X daje ten sam wybór', () => {
    for (let k = 0; k < 12; k++) {
      const x = 700 + Math.floor(rnd() * (all.length - 750));
      const X = all[x].t;
      const ref = selectEffort(effortZones(all.slice(0, x + 1), MS), all.slice(0, x + 1), MS, X, { phone: false, history: false });
      const short = all.slice(x - 600, x + 1);
      expect(selectEffort(effortZones(short, MS), short, MS, X, { phone: false, history: false }), `X=${x}, krótsza historia`).toEqual(ref);
      expect(selectEffort(full, all, MS, X, { phone: false, history: false }), `X=${x}, dopisane świece`).toEqual(ref);
    }
  });

  it('stałość: taśma doczytana później daje ten sam wybór co taśma od początku', () => {
    const X = all[all.length - 40].t;
    const noTape = all.map((b) => ({ ...b, delta: null }));
    // Pierwsze przeliczenie bez taśmy, drugie po jej doczytaniu — wynik tylko z ostatnich danych
    selectEffort(effortZones(noTape, MS), noTape, MS, X, { phone: false, history: false });
    expect(selectEffort(effortZones(all, MS), all, MS, X, { phone: false, history: false })).toEqual(selectEffort(full, all, MS, X, { phone: false, history: false }));
  });

  it('stałość: świeca w trakcie (po X) nie zmienia wyboru dla X', () => {
    const x = all.length - 20;
    const X = all[x].t;
    const closed = all.slice(0, x + 1);
    const forming = [...closed, { ...all[x + 1], c: all[x + 1].c * 1.01, h: all[x + 1].h * 1.01 }];
    expect(selectEffort(effortZones(forming, MS), forming, MS, X, { phone: false, history: false })).toEqual(
      selectEffort(effortZones(closed, MS), closed, MS, X, { phone: false, history: false })
    );
  });
});
