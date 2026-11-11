import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Fill, Side } from '../hl/parse';
import { HlStream } from '../hl/stream';
import { MakerFlow } from '../core/makers';
import { indicatorDef, tfAllowed } from '../indicators/registry';
import { ProStore } from '../store/proStore';

const M = 60_000;
const H = 3_600_000;
let tid = 0;
const fill = (time: number, side: Side, sz: number, maker: string): Fill => ({ time, px: 100, sz, side, tid: tid++, hash: '', taker: 't', maker });

/** Godzina: animator „mm” co minutę po obu stronach, „dir” raz, „one” co minutę tylko po jednej stronie. */
function hour(): Fill[] {
  const out: Fill[] = [];
  for (let k = 0; k < 60; k++) {
    out.push(fill(k * M + 1000, k % 2 ? 1 : -1, 1, 'mm'));
    out.push(fill(k * M + 2000, 1, 0.5, 'one'));
  }
  out.push(fill(10 * M + 3000, 1, 4, 'dir'));
  out.push(fill(10 * M + 4000, -1, 9, ''));
  return out;
}

describe('koncentracja makerów', () => {
  it('bid = makerzy przyjmujący sprzedaż, ask = kupno; największe konta malejąco, wypełnienia bez konta pominięte', () => {
    const f = new MakerFlow();
    f.add(hour());
    const t = f.top(10 * M, 11 * M, 2);
    // Minuta 10: mm przyjął sprzedaż 1 (minuta parzysta), one i dir kupno 0,5 i 4; sprzedaż 9 bez konta makera pominięta
    expect(t.bid).toEqual({ n: 1, usd: 100, top: [{ key: 'mm', usd: 100 }] });
    expect(t.ask.n).toBe(2);
    expect(t.ask.usd).toBeCloseTo(450, 12);
    expect(t.ask.top.map((x) => x.key)).toEqual(['dir', 'one']);
  });
});

describe('delta według klasy makera', () => {
  it('animator: płynność w co najmniej połowie minut i po obu stronach; reszta — pozostali', () => {
    const f = new MakerFlow();
    f.add(hour());
    // Okno 60 min do zamknięcia świecy 0:10–0:11 ma taśmę z kontami w minutach 0–10 (11 minut)
    const s = f.split(10 * M, 11 * M, 11)!;
    // Minuta 10: mm przyjął kupno 1, one kupno 0,5, dir kupno 4 (wypełnienie bez makera pominięte)
    expect(s.mm).toBe(-1);
    expect(s.rest).toBeCloseTo(4.5, 12);
    expect(s.mmShare).toBeCloseTo(100 / 550, 12);
  });

  it('części sumują się do delty wypełnień z kontem makera', () => {
    const f = new MakerFlow();
    const list = hour();
    f.add(list);
    const s = f.split(0, H, 60)!;
    const delta = list.filter((x) => x.maker !== '').reduce((a, x) => a + x.side * x.sz, 0);
    expect(s.mm + s.rest).toBeCloseTo(delta, 12);
  });

  it('bieżąca godzina: udział minut z tych, które już minęły', () => {
    const f = new MakerFlow();
    // Konto aktywne w 5 z pierwszych 10 minut, po obu stronach
    f.add([0, 2, 4, 6, 8].map((k) => fill(k * M, k % 4 ? 1 : -1, 1, 'x')));
    expect(f.split(0, 10 * M, 10)!.mmShare).toBe(1);
    expect(f.split(0, 10 * M, 60)!.mmShare).toBe(0);
  });

  it('bez wypełnień z kontem makera — brak; stare minuty sprzątane', () => {
    const f = new MakerFlow();
    expect(f.split(0, M, 60)).toBeNull();
    f.add(hour());
    f.prune(2 * H);
    expect(f.split(0, H, 60)).toBeNull();
    const def = indicatorDef('makers');
    expect(def.group).toBe('hyperquant');
    expect(tfAllowed(def)).toBe(false);
  });

  it('klasa z 60 min do zamknięcia świecy: minuty po zamknięciu się nie liczą, minuty poprzedniej godziny tak', () => {
    const f = new MakerFlow();
    // x po obu stronach w minutach 40–59 godziny 0 i 0–9 godziny 1 (30 minut)
    f.add(Array.from({ length: 30 }, (_, k) => fill((40 + k) * M, k % 2 ? 1 : -1, 1, 'x')));
    // Świeca 1:05–1:06: w oknie 0:06–1:06 x w 26 z 60 minut — reszta; świeca 1:09–1:10: 30 z 60 — animator
    expect(f.split(H + 5 * M, H + 6 * M, 60)!.mmShare).toBe(0);
    expect(f.split(H + 9 * M, H + 10 * M, 60)!.mmShare).toBe(1);
    // Świeca 0:45–0:46: w oknie 23:46–0:46 x w 6 minutach (z 60) — reszta, choć później był aktywny dłużej
    expect(f.split(45 * M, 46 * M, 60)!.mmShare).toBe(0);
  });

  it('świece po kolei (okno przesuwane) i w odwrotnej kolejności (okno od nowa) dają te same liczby', () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const list: Fill[] = [];
    for (let i = 0; i < 4000; i++) list.push({ ...fill(Math.floor(rnd() * 3 * H), rnd() < 0.5 ? 1 : -1, Math.round(rnd() * 300) / 100, `m${Math.floor(rnd() ** 3 * 20)}`), px: 100 + Math.round(rnd() * 1000) / 100 });
    const run = (ks: number[]) => {
      const f = new MakerFlow();
      f.add(list);
      const out = new Map(ks.map((k) => [k, f.split(k * M, (k + 1) * M, Math.min(60, k + 1))]));
      return [...out.entries()].sort((a, b) => a[0] - b[0]);
    };
    const ks = Array.from({ length: 180 }, (_, k) => k);
    const asc = run(ks);
    expect(asc.some(([, s]) => s !== null && s.mmShare > 0 && s.mmShare < 1)).toBe(true);
    expect(run([...ks].reverse())).toEqual(asc);
  });
});

describe('makerzy: zamknięta świeca się nie zmienia', () => {
  afterEach(() => vi.useRealTimers());

  const H0 = Date.UTC(2026, 10, 7, 11);
  const store = () => new ProStore(new HlStream({ wsFactory: () => ({}) as WebSocket }));
  /** Historia serwera [from, to) z wypełnieniami i taśmą z kontami przez cały odcinek. */
  const load = (s: ProStore, from: number, to: number, fills: Fill[]) =>
    s.restoreHistory({ trades: { from, to, spans: [[from, to]], zeroSpans: [], fills, oi: [] }, frames: [] });

  it('wartość świecy policzona w chwili t równa się wartości godzinę później, po nowych wypełnieniach po jej zamknięciu', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const s = store();
    // x po obu stronach w każdej z minut 0–9, y raz w minucie 5
    const early = [...Array.from({ length: 10 }, (_, k) => fill(H0 + k * M + 1000, k % 2 ? 1 : -1, 1, 'x')), fill(H0 + 5 * M + 2000, 1, 2, 'y')];
    load(s, H0, H0 + 10 * M, early);
    const t = H0 + 10 * M;
    vi.setSystemTime(t);
    const candles: [number, number][] = [
      [H0 + 5 * M, H0 + 6 * M],
      [H0 + 5 * M, H0 + 10 * M],
    ];
    const at = () => candles.map(([a, b]) => s.makerSplit(a, b));
    const before = at();
    expect(before[0]!.mmShare).toBeCloseTo(100 / 300, 12);
    // Po zamknięciu: x milknie, y daje płynność po obu stronach do końca godziny, taśma z kontami rośnie
    load(s, H0 + 10 * M, H0 + 70 * M, Array.from({ length: 60 }, (_, k) => fill(H0 + (10 + k) * M + 1000, k % 2 ? 1 : -1, 1, 'y')));
    vi.setSystemTime(t + H);
    expect(at()).toEqual(before);
  });
});
