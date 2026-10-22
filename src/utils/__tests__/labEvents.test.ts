import { describe, expect, it } from 'vitest';
import {
  chicagoToUtc,
  cmeGapEvents,
  fundingEvents,
  ibBreakEvents,
  intradayMomEvents,
  levelEvents,
  newYorkToUtc,
  nyTenAmEvents,
  prevDayEvents,
  vwapEvents,
  weekendEvents,
  type LabBar,
} from '../labEvents';
import { mulberry32 } from '../pathEngine';

const H = 3_600_000;
const D = 24 * H;
const T0 = Date.UTC(2026, 9, 20); // wtorek 20.10.2026 00:00 UTC

/** Świece 1h od `start`: [high, low, close]; open = poprzednie zamknięcie */
function bars(start: number, rows: [number, number, number][], firstOpen = rows[0][2]): LabBar[] {
  let prev = firstOpen;
  return rows.map(([h, l, c], i) => {
    const b = { t: start + i * H, o: prev, h, l, c, v: 1 };
    prev = c;
    return b;
  });
}

/** 24 spokojne godziny (zakres 100) przed scenariuszem — historia do warunku szerokości pasma */
function calm(start: number, close: number): LabBar[] {
  return Array.from({ length: 24 }, (_, i) => ({ t: start - (24 - i) * H, o: close, h: close + 50, l: close - 50, c: close, v: 1 }));
}

describe('czas giełd (zasady DST w USA)', () => {
  it('CME: piątek 16:00 i niedziela 17:00 czasu Chicago', () => {
    expect(chicagoToUtc(2026, 10, 23, 16)).toBe(Date.UTC(2026, 9, 23, 21));
    expect(chicagoToUtc(2026, 10, 25, 17)).toBe(Date.UTC(2026, 9, 25, 22));
    // 1.11.2026 — koniec DST o 2:00, wieczorem już czas zimowy
    expect(chicagoToUtc(2026, 11, 1, 17)).toBe(Date.UTC(2026, 10, 1, 23));
    // 8.03.2026 — początek DST o 2:00
    expect(chicagoToUtc(2026, 3, 8, 17)).toBe(Date.UTC(2026, 2, 8, 22));
    expect(chicagoToUtc(2026, 3, 6, 16)).toBe(Date.UTC(2026, 2, 6, 22));
  });
  it('Nowy Jork 10:00: 14:00 UTC latem, 15:00 UTC zimą', () => {
    expect(newYorkToUtc(2026, 10, 22, 10)).toBe(Date.UTC(2026, 9, 22, 14));
    expect(newYorkToUtc(2026, 11, 2, 10)).toBe(Date.UTC(2026, 10, 2, 15));
  });
});

describe('poziomy okrągłe (opór / wsparcie / placebo)', () => {
  it('przebicie 80 000 od dołu: start na zamknięciu, p0 z opcjonalnego zatrzymania, sukces = dolna bariera', () => {
    const b = [...calm(T0, 79500), ...bars(T0, [
      [79600, 79400, 79500],
      [80100, 79400, 79900],
      [80000, 79500, 79700],
      [79800, 79100, 79300],
    ])];
    const r = levelEvents(b, { step: 1000, offset: 0, dir: 'res', dPct: 0.01, maxBars: 72 });
    expect(r.events).toHaveLength(1);
    const e = r.events[0];
    expect(e).toMatchObject({ t0: T0 + 2 * H, t1: T0 + 4 * H, x: 1 });
    expect(e.p0).toBeCloseTo(900 / 1600, 12);
  });
  it('wsparcie: przebicie od góry, sukces = górna bariera; porażka przy dolnej', () => {
    const b = [...calm(T0, 80200), ...bars(T0, [
      [80300, 80100, 80200],
      [80300, 79900, 80100],
      [80200, 79100, 79150],
    ])];
    const r = levelEvents(b, { step: 1000, offset: 0, dir: 'sup', dPct: 0.01, maxBars: 72 });
    expect(r.events).toEqual([{ t0: T0 + 2 * H, t1: T0 + 3 * H, x: 0, p0: (80100 - 79200) / 1600 }]);
  });
  it('bar dotykający obu barier → niejednoznaczne; luka w danych → odrzucone; koniec danych → bez zdarzenia', () => {
    const amb = [...calm(T0, 79500), ...bars(T0, [
      [79600, 79400, 79500],
      [80100, 79400, 79900],
      [80900, 79100, 79500],
    ])];
    expect(levelEvents(amb, { step: 1000, offset: 0, dir: 'res', dPct: 0.01, maxBars: 72 })).toMatchObject({ events: [], dropped: { ambiguous: 1 } });
    // Luka w danych: zatrzymanie na ostatnim zamknięciu przed luką — wynik ułamkowy (wartość martyngału), nie odrzucenie
    const gap = [...calm(T0, 79500), ...bars(T0, [
      [79600, 79400, 79500],
      [80100, 79400, 79900],
    ])].concat([{ t: T0 + 5 * H, o: 79900, h: 79950, l: 79100, c: 79200, v: 1 }]);
    const g = levelEvents(gap, { step: 1000, offset: 0, dir: 'res', dPct: 0.01, maxBars: 72 });
    expect(g.dropped.gap).toBe(1);
    expect(g.events).toHaveLength(1);
    expect(g.events[0]).toMatchObject({ t0: T0 + 2 * H, t1: T0 + 2 * H });
    expect(g.events[0].x).toBeCloseTo(g.events[0].p0, 12);
    const open = [...calm(T0, 79500), ...bars(T0, [
      [79600, 79400, 79500],
      [80100, 79400, 79900],
      [80000, 79500, 79700],
    ])];
    expect(levelEvents(open, { step: 1000, offset: 0, dir: 'res', dPct: 0.01, maxBars: 72 })).toMatchObject({ events: [], dropped: { ambiguous: 0, gap: 0, timeout: 0 } });
  });
  it('limit czasu → wynik ułamkowy z zamknięcia (nie odrzucenie); wąskie pasmo względem zakresu godzin → start pominięty', () => {
    const b = [...calm(T0, 79500), ...bars(T0, [
      [79600, 79400, 79500],
      [80100, 79400, 79900],
      [80000, 79500, 79700],
      [79900, 79400, 79600],
    ])];
    const r = levelEvents(b, { step: 1000, offset: 0, dir: 'res', dPct: 0.01, maxBars: 2 });
    expect(r.dropped.timeout).toBe(1);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].x).toBeCloseTo((80800 - 79600) / 1600, 12);
    expect(r.events[0].t1).toBe(T0 + 4 * H);
    // Te same bary po burzliwej dobie (zakres godzin 900): pasmo 1600 < 3 × 900
    const wild = [...calm(T0, 79500).map((x) => ({ ...x, h: x.c + 450, l: x.c - 450 })), ...b.slice(24)];
    const w = levelEvents(wild, { step: 1000, offset: 0, dir: 'res', dPct: 0.01, maxBars: 72 });
    expect(w.events).toEqual([]);
    expect(w.dropped.narrow).toBe(2); // oba bary dotykające 80 000
  });
  it('placebo: poziomy 1000·k + 437 w obu kierunkach', () => {
    const b = [...calm(T0, 80350), ...bars(T0, [
      [80400, 80300, 80350],
      [80500, 80300, 80450],
      [80460, 79600, 79700],
    ])];
    const r = levelEvents(b, { step: 1000, offset: 437, dir: 'both', dPct: 0.01, maxBars: 72 });
    expect(r.events).toHaveLength(1);
    expect(r.events[0].x).toBe(1);
  });
});

describe('zebranie PDH / PDL, wybicie IB, VWAP', () => {
  const prevDay = bars(T0, Array.from({ length: 24 }, (_, i): [number, number, number] => [i === 5 ? 81000 : 80100, i === 9 ? 79000 : 79900, 80000]));
  it('pierwsze dotknięcie PDH: bariery PD-mid i PDH + (PDH − mid), sukces = powrót do środka', () => {
    const day = bars(T0 + D, [
      [80500, 80000, 80300],
      [81100, 80200, 80900],
      [80950, 79900, 80000],
    ], 80000);
    const r = prevDayEvents([...prevDay, ...day], 'pdh', 36);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ t0: T0 + D + 2 * H, x: 1 });
    expect(r.events[0].p0).toBeCloseTo((82000 - 80900) / 2000, 12);
  });
  it('wybicie IB w górę: sukces przy IBH + zakres IB, porażka przy IBL', () => {
    const day = [...calm(T0, 80000), ...bars(T0, [
      [80200, 79800, 80000],
      [80300, 79950, 80250],
      [80700, 80100, 80650],
    ])];
    const r = ibBreakEvents(day, 24);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ t0: T0 + 2 * H, t1: T0 + 3 * H, x: 1 });
    expect(r.events[0].p0).toBeCloseTo((80250 - 79800) / 800, 12);
  });
  it('VWAP: zamknięcie powyżej VWAP + 2σ od 4. godziny, sukces przy dotknięciu VWAP (porażka VWAP + 4σ)', () => {
    // Trzy godziny z ceną typową 79 800 / 80 200 / 80 000 (σ ≈ 175 po czwartej), czwarta zamyka między 2σ a 3σ
    const rows: LabBar[] = [
      { t: T0, o: 79800, h: 79900, l: 79700, c: 79800, v: 10 },
      { t: T0 + H, o: 79800, h: 80300, l: 80100, c: 80200, v: 10 },
      { t: T0 + 2 * H, o: 80200, h: 80100, l: 79900, c: 80000, v: 10 },
      { t: T0 + 3 * H, o: 80000, h: 80450, l: 80300, c: 80420, v: 1 },
      { t: T0 + 4 * H, o: 80420, h: 80430, l: 79990, c: 80050, v: 1 },
    ];
    const r = vwapEvents([...calm(T0, 79800), ...rows], 24);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ t0: T0 + 4 * H, t1: T0 + 5 * H, x: 1 });
    expect(r.events[0].p0).toBeGreaterThan(0);
    expect(r.events[0].p0).toBeLessThan(1);
  });
});

describe('luka CME i finansowanie', () => {
  it('luka ≥ 0,3%: bariery poziom luki i lustro, p0 = 0,5', () => {
    const start = Date.UTC(2026, 9, 23, 0); // piątek
    const rows: LabBar[] = [];
    for (let i = 0; i < 24 * 4; i++) {
      const t = start + i * H;
      let c = 80000;
      if (t >= Date.UTC(2026, 9, 25, 21)) c = 81000; // niedziela od 21:00 UTC
      const h = t === Date.UTC(2026, 9, 25, 22) ? 81050 : c + 50;
      const l = t === Date.UTC(2026, 9, 25, 23) ? 79900 : c - 50;
      rows.push({ t, o: c, h, l, c, v: 1 });
    }
    const r = cmeGapEvents(rows, 0.003);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ t0: Date.UTC(2026, 9, 25, 22), t1: Date.UTC(2026, 9, 26, 0), x: 1, p0: 0.5 });
  });
  it('finansowanie w górnych 5% z 30 dni → bariery ±1%, sukces = spadek', () => {
    const start = T0 - 31 * D;
    const rows: LabBar[] = [];
    for (let i = 0; i < 31 * 24 + 3; i++) rows.push({ t: start + i * H, o: 80000, h: 80100, l: 79900, c: 80000, v: 1 });
    rows[rows.length - 1] = { ...rows[rows.length - 1], l: 79000 };
    const funding = rows.slice(0, 31 * 24 + 1).map((b, i) => ({ t: b.t + H, rate: i === 31 * 24 ? 0.001 : 0.00001 * ((i % 7) - 3) }));
    const r = fundingEvents(rows, funding, { pct: 0.05, windowDays: 30, dPct: 0.01, maxBars: 48 });
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ x: 1, p0: 0.5 });
  });
});

describe('reguły kalendarzowe', () => {
  it('10:00 w Nowym Jorku: zwrot godziny w dolnej połowie dnia UTC → sukces', () => {
    const day = Date.UTC(2026, 9, 22); // czwartek, EDT → 14:00 UTC
    const rows: LabBar[] = [{ t: day - H, o: 80000, h: 80000, l: 80000, c: 80000, v: 1 }];
    let c = 80000;
    for (let k = 0; k < 24; k++) {
      const r = k === 14 ? -0.01 : 0.001 * ((k % 5) - 2) + 0.0001;
      const nc = c * Math.exp(r);
      rows.push({ t: day + k * H, o: c, h: Math.max(c, nc), l: Math.min(c, nc), c: nc, v: 1 });
      c = nc;
    }
    const r = nyTenAmEvents(rows);
    expect(r.events).toEqual([{ t0: day, t1: day + D, x: 1, p0: 0.5 }]);
  });
  it('momentum śróddzienne: znak ostatniej godziny = znak pierwszej → sukces', () => {
    const day = Date.UTC(2026, 9, 22);
    const rows: LabBar[] = [{ t: day - H, o: 80000, h: 80000, l: 80000, c: 80000, v: 1 }];
    let c = 80000;
    for (let k = 0; k < 24; k++) {
      const nc = k === 0 || k === 23 ? c * 1.002 : c * (k % 2 ? 0.999 : 1.001);
      rows.push({ t: day + k * H, o: c, h: Math.max(c, nc), l: Math.min(c, nc), c: nc, v: 1 });
      c = nc;
    }
    expect(intradayMomEvents(rows).events).toEqual([{ t0: day, t1: day + D, x: 1, p0: 0.5 }]);
  });
  it('weekend: log-zakres sob+nd < śr+czw → sukces (świece dzienne, tydzień od poniedziałku)', () => {
    const mon = Date.UTC(2026, 9, 19);
    const ranges = [0.03, 0.03, 0.04, 0.04, 0.03, 0.01, 0.015];
    const daily: LabBar[] = ranges.map((r, i) => ({ t: mon + i * D, o: 80000, h: 80000 * Math.exp(r), l: 80000, c: 80000, v: 1 }));
    expect(weekendEvents(daily).events).toEqual([{ t0: mon, t1: mon + 7 * D, x: 1, p0: 0.5 }]);
  });
});

describe('hipoteza zerowa: na martyngale reguły barierowe nie mają efektu', () => {
  it('średnie (x − p0) w granicach 3 błędów standardowych dla każdej reguły z ≥ 100 zdarzeniami', () => {
    const rnd = mulberry32(20261022);
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const sub = 30;
    const sigma = 240 / Math.sqrt(sub);
    const rows: LabBar[] = [];
    let p = 80000;
    for (let i = 0; i < 12000; i++) {
      const o = p;
      let h = p;
      let l = p;
      for (let k = 0; k < sub; k++) {
        p += sigma * gauss();
        h = Math.max(h, p);
        l = Math.min(l, p);
      }
      rows.push({ t: T0 + i * H, o, h, l, c: p, v: 1 + rnd() });
    }
    const sets = {
      res: levelEvents(rows, { step: 1000, offset: 0, dir: 'res', dPct: 0.01, maxBars: 72 }).events,
      sup: levelEvents(rows, { step: 1000, offset: 0, dir: 'sup', dPct: 0.01, maxBars: 72 }).events,
      pdh: prevDayEvents(rows, 'pdh', 36).events,
      pdl: prevDayEvents(rows, 'pdl', 36).events,
      ib: ibBreakEvents(rows, 24).events,
      vwap: vwapEvents(rows, 24).events,
    };
    for (const [name, ev] of Object.entries(sets)) {
      if (ev.length < 100) continue;
      const eff = ev.reduce((s, e) => s + e.x - e.p0, 0);
      const se = Math.sqrt(ev.reduce((s, e) => s + e.p0 * (1 - e.p0), 0));
      expect(Math.abs(eff / se), `${name}: n=${ev.length}`).toBeLessThan(3);
    }
    expect(sets.res.length).toBeGreaterThan(100);
    // Zdarzenia jednej reguły nie nakładają się
    for (const ev of Object.values(sets)) for (let i = 1; i < ev.length; i++) expect(ev[i].t0).toBeGreaterThanOrEqual(ev[i - 1].t1);
  });
});

describe('reguła szerokości pasma także dla reguł wyśrodkowanych', () => {
  it('luka CME węższa niż 2 × mediana zakresu godzin → start pominięty (niejednoznaczność byłaby częsta)', () => {
    const start = Date.UTC(2026, 9, 23, 0);
    const rows: LabBar[] = [];
    for (let i = 0; i < 24 * 4; i++) {
      const t = start + i * H;
      const c = t >= Date.UTC(2026, 9, 25, 21) ? 80400 : 80000; // luka 0,5% = 400
      rows.push({ t, o: c, h: c + 300, l: c - 300, c, v: 1 }); // zakres godziny 600 → pasmo 800 < 1200
    }
    const r = cmeGapEvents(rows, 0.003);
    expect(r.events).toEqual([]);
    expect(r.dropped.narrow).toBe(1);
  });
});
