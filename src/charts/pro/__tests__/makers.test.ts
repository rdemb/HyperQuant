import { describe, expect, it } from 'vitest';
import type { Fill, Side } from '../hl/parse';
import { MakerFlow } from '../core/makers';
import { indicatorDef, tfAllowed } from '../indicators/registry';

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

describe('delta według klasy makera', () => {
  it('animator: płynność w co najmniej połowie minut i po obu stronach; reszta — pozostali', () => {
    const f = new MakerFlow();
    f.add(hour());
    const s = f.split(10 * M, 11 * M, 60)!;
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
});
