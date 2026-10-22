import { describe, expect, it } from 'vitest';
import { LAB_CATALOG, evaluateLab, histStats, isLabReport, runCatalog, summarize, type LabData, type LabReport } from '../folkloreLab';
import type { LabBar, LabEvent } from '../labEvents';
import { mulberry32 } from '../pathEngine';

const H = 3_600_000;
const D = 24 * H;
const T0 = Date.UTC(2026, 0, 5); // poniedziałek

/** Martyngał (log-cena z kompensacją dryfu), 60 kroków w godzinie; świece dzienne z godzinowych; losowe finansowanie */
function simData(seed: number, hours: number): LabData {
  const rnd = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const hourly: LabBar[] = [];
  let lp = Math.log(80000);
  for (let i = 0; i < hours; i++) {
    const o = Math.exp(lp);
    let h = o;
    let l = o;
    for (let k = 0; k < 60; k++) {
      lp += (0.005 / Math.sqrt(60)) * gauss() - (0.5 * 0.000025) / 60;
      h = Math.max(h, Math.exp(lp));
      l = Math.min(l, Math.exp(lp));
    }
    hourly.push({ t: T0 + i * H, o, h, l, c: Math.exp(lp), v: 1 + rnd() });
  }
  const daily: LabBar[] = [];
  for (let i = 0; i + 24 <= hourly.length; i += 24) {
    const s = hourly.slice(i, i + 24);
    daily.push({ t: s[0].t, o: s[0].o, h: Math.max(...s.map((b) => b.h)), l: Math.min(...s.map((b) => b.l)), c: s[23].c, v: 24 });
  }
  const funding = hourly.map((b) => ({ t: b.t + H, rate: 0.00001 * gauss() }));
  return { hourly, daily, funding };
}

describe('katalog v1', () => {
  it('10 reguł folkloru i 2 kontrole, unikalne identyfikatory', () => {
    const ids = LAB_CATALOG.hypotheses.map((h) => h.id);
    expect(new Set(ids).size).toBe(12);
    expect(LAB_CATALOG.hypotheses.filter((h) => h.family === 'folklore')).toHaveLength(10);
    expect(LAB_CATALOG.hypotheses.filter((h) => h.family === 'control').map((h) => h.id).sort()).toEqual(['ctrl-placebo', 'ctrl-weekend']);
  });
  it('każda reguła z katalogu ma generator', () => {
    const r = runCatalog(simData(1, 24 * 60));
    expect(Object.keys(r).sort()).toEqual(LAB_CATALOG.hypotheses.map((h) => h.id).sort());
  });
});

describe('statystyka historyczna', () => {
  const ev = (x: number, p0: number, i: number): LabEvent => ({ t0: T0 + i * H, t1: T0 + (i + 1) * H, x, p0 });
  it('efekt = średnia (x − p0), p dwustronne z wariancją pod H0, przedział 90% z wariancji próby', () => {
    const events = Array.from({ length: 100 }, (_, i) => ev(i < 70 ? 1 : 0, 0.5, i));
    const s = histStats(events);
    expect(s.n).toBe(100);
    expect(s.rate).toBeCloseTo(0.7, 12);
    expect(s.effect).toBeCloseTo(0.2, 12);
    // z = 20 / √25 = 4 → p ≈ 6,3e-5
    expect(s.p!).toBeLessThan(1e-4);
    expect(s.p!).toBeGreaterThan(1e-5);
    expect(s.lo!).toBeLessThan(0.2);
    expect(s.hi!).toBeGreaterThan(0.2);
  });
  it('brak zdarzeń → wartości null', () => {
    expect(histStats([])).toMatchObject({ n: 0, rate: null, effect: null, p: null });
  });
});

describe('ocena laboratorium', () => {
  it('pod H0 (martyngał) żadna reguła folkloru nie jest potwierdzona do przodu, kontrola negatywna bez efektu', () => {
    const data = simData(7, 24 * 400);
    const reg = T0 + 200 * D;
    const rep = evaluateLab(data, { coin: 'BTC', asOf: T0 + 400 * D, registeredAt: reg, catalogHash: 'a'.repeat(64) });
    expect(rep.hypotheses).toHaveLength(12);
    for (const h of rep.hypotheses.filter((x) => x.family === 'folklore')) expect(h.fwd.verdict).not.toBe('confirmed');
    const placebo = rep.hypotheses.find((h) => h.id === 'ctrl-placebo')!;
    expect(placebo.hist.n).toBeGreaterThan(100);
    expect(Math.abs(placebo.hist.effect!)).toBeLessThan(0.05);
    expect(isLabReport(rep)).toBe(true);
  });
  it('do przodu tylko zdarzenia rozpoczęte po rejestracji + 24 h karencji; bez rejestracji — brak oceny do przodu', () => {
    const data = simData(3, 24 * 120);
    const reg = T0 + 60 * D;
    const rep = evaluateLab(data, { coin: 'BTC', asOf: T0 + 120 * D, registeredAt: reg, catalogHash: 'b'.repeat(64) });
    expect(rep.forwardFrom).toBe(reg + D);
    for (const h of rep.hypotheses) for (const e of h.fwd.events) expect(e[0]).toBeGreaterThan(reg + D);
    expect(rep.hypotheses.reduce((n, h) => n + h.fwd.n, 0)).toBeGreaterThan(0);
    const none = evaluateLab(data, { coin: 'BTC', asOf: T0 + 120 * D, registeredAt: null, catalogHash: 'b'.repeat(64) });
    for (const h of none.hypotheses) expect(h.fwd).toMatchObject({ n: 0, verdict: 'collecting', events: [] });
  });
  it('silny efekt w jednej regule → potwierdzenie przez e-BH tylko dla niej; < 30 zdarzeń historycznie → „za mało”', () => {
    const rnd = mulberry32(99);
    const gen = Object.fromEntries(
      LAB_CATALOG.hypotheses.map((h) => {
        const n = h.id === 'ctrl-weekend' ? 20 : 400;
        const eff = h.id === 'cme-gap' ? 0.3 : 0;
        const events = Array.from({ length: n }, (_, i) => ({ t0: T0 + i * D, t1: T0 + i * D + H, x: rnd() < 0.5 + eff ? 1 : 0, p0: 0.5 }));
        return [h.id, { events, dropped: { ambiguous: 0, narrow: 0, timeout: 0, gap: 0 } }];
      })
    );
    const rep = summarize(gen, { coin: 'BTC', asOf: T0 + 500 * D, registeredAt: T0 + 99 * D - 1, catalogHash: 'c'.repeat(64) }, { hourly: [], daily: [], funding: [] });
    const by = (id: string) => rep.hypotheses.find((h) => h.id === id)!;
    expect(by('cme-gap').fwd.verdict).toBe('confirmed');
    expect(by('cme-gap').fwd.e).toBeGreaterThan(100);
    expect(by('cme-gap').hist.verdict).toBe('support');
    for (const h of rep.hypotheses.filter((x) => x.family === 'folklore' && x.id !== 'cme-gap')) expect(h.fwd.verdict).not.toBe('confirmed');
    expect(by('ctrl-weekend').hist.verdict).toBe('few');
    expect(by('cme-gap').fwd.n).toBe(300);
    expect(by('cme-gap').fwd.path.length).toBeLessThanOrEqual(200);
  });
});

describe('walidacja raportu', () => {
  it('odrzuca uszkodzone pliki', () => {
    const rep = evaluateLab(simData(5, 24 * 40), { coin: 'BTC', asOf: T0 + 40 * D, registeredAt: T0 + 10 * D, catalogHash: 'd'.repeat(64) });
    expect(isLabReport(rep)).toBe(true);
    expect(isLabReport({ ...rep, v: 2 })).toBe(false);
    expect(isLabReport({ ...rep, hypotheses: [{ ...rep.hypotheses[0], hist: null }] })).toBe(false);
    expect(isLabReport({ ...rep, catalogHash: 'xyz' })).toBe(false);
    expect(isLabReport(null)).toBe(false);
    const bad: LabReport = JSON.parse(JSON.stringify(rep));
    bad.hypotheses[0].fwd.events = [[1, 2, 3] as unknown as [number, number, number, number]];
    expect(isLabReport(bad)).toBe(false);
  });
});
