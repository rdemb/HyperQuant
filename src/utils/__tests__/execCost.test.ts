import { describe, expect, it } from 'vitest';
import { costByHour, nowCost, slippageBp } from '../execCost';

describe('poślizg z krzywej głębokości strony arkusza', () => {
  it('do głębokości ±10 bp: liniowo, średnio 5 bp × Q/D10', () => {
    expect(slippageBp(500_000, { d10: 1_000_000, d20: 3_000_000 })).toBeCloseTo(2.5, 10);
    expect(slippageBp(1_000_000, { d10: 1_000_000, d20: 3_000_000 })).toBeCloseTo(5, 10);
  });
  it('między 10 a 20 bp: drugi odcinek liniowy (ciągłość na 10 bp)', () => {
    // Q = 2 mln: ∫ = 5·1e6 + [10·1e6 + 5·1e6²/2e6] = 5e6 + 12.5e6 → średnio 8.75 bp
    expect(slippageBp(2_000_000, { d10: 1_000_000, d20: 3_000_000 })).toBeCloseTo(8.75, 10);
  });
  it('powyżej 20 bp: prawo pierwiastka skalibrowane na 20 bp (koszt rośnie wolniej niż liniowo)', () => {
    const d = { d10: 1_000_000, d20: 3_000_000 };
    const at20 = slippageBp(3_000_000, d)!;
    const big = slippageBp(12_000_000, d)!;
    expect(big).toBeGreaterThan(at20);
    // Granica ciągła: tuż ponad D20 ≈ wartość w D20
    expect(slippageBp(3_000_001, d)).toBeCloseTo(at20, 4);
    // Krańcowy poślizg przy 4× D20 = 20·√4 = 40 bp; średni poniżej krańcowego
    expect(big).toBeLessThan(40);
  });
  it('brak głębokości ±20 bp → prawo pierwiastka od 10 bp; brak danych → null', () => {
    const s = slippageBp(4_000_000, { d10: 1_000_000, d20: null })!;
    // ∫₀^D10 = 5·D10; ∫_{D10}^{Q} 10√(q/D10) dq = (20/3)(Q^1.5 − D10^1.5)/√D10
    const want = (5 * 1e6 + (20 / 3) * (4e6 ** 1.5 - 1e6 ** 1.5) / Math.sqrt(1e6)) / 4e6;
    expect(s).toBeCloseTo(want, 10);
    expect(slippageBp(1, { d10: 0, d20: null })).toBeNull();
    expect(slippageBp(0, { d10: 1e6, d20: 2e6 })).toBe(0);
  });
});

describe('koszt wg godziny', () => {
  const byHour = Array.from({ length: 24 }, (_, h) => ({
    h,
    b10: h === 3 ? 200_000 : 1_000_000,
    a10: h === 3 ? 200_000 : 1_000_000,
    b20: h === 3 ? 500_000 : 3_000_000,
    a20: h === 3 ? 500_000 : 3_000_000,
    d10: null as number | null,
    d20: null as number | null,
    n: 600,
    days: 20,
  }));
  it('kupno — aski, sprzedaż — bidy; opłata takera doliczona; najtańsze i najdroższe godziny', () => {
    const r = costByHour(byHour, 500_000, 'buy', 0.00045);
    expect(r.hours).toHaveLength(24);
    expect(r.hours[0].slipBp).toBeCloseTo(2.5, 10);
    expect(r.hours[0].totalBp).toBeCloseTo(2.5 + 4.5, 10);
    expect(r.worst[0]).toBe(3);
    expect(r.best).not.toContain(3);
  });
  it('godziny bez danych stron → koszt z sumy obu stron (połowa na stronę); bez danych → null', () => {
    const legacy = byHour.map((b) => ({ h: b.h, d10: 2_000_000, d20: 6_000_000, n: 600, days: 20 }));
    const r = costByHour(legacy, 500_000, 'sell', 0);
    expect(r.hours[5].slipBp).toBeCloseTo(2.5, 10);
    const empty = costByHour(byHour.map((b) => ({ h: b.h, d10: null, d20: null, n: 0, days: 0 })), 1e5, 'buy', 0);
    expect(empty.hours.every((x) => x.slipBp === null)).toBe(true);
    expect(empty.best).toEqual([]);
  });
});

describe('warunki cienkie i koszt teraz', () => {
  const hour = { h: 5, b10: 1_000_000, a10: 1_000_000, b20: 3_000_000, a20: 3_000_000, d10: 2_000_000, d20: 6_000_000, thin10: 1_000_000, n: 600, days: 20 };
  it('warunki cienkie: głębokość stron przeskalowana przez 25. percentyl / medianę (tu ½) → wyższy koszt', () => {
    const typ = costByHour([hour], 500_000, 'buy', 0).hours[0].slipBp!;
    const thin = costByHour([hour], 500_000, 'buy', 0, { thin: true }).hours[0].slipBp!;
    expect(typ).toBeCloseTo(2.5, 10);
    expect(thin).toBeCloseTo(5, 10);
  });
  it('koszt teraz: bieżąca głębokość sumy ±10/±20 bp, podział na strony jak w medianie tej godziny', () => {
    const c = nowCost({ t: Date.UTC(2026, 9, 22, 5, 3), d10: 1_000_000, d20: 3_000_000 }, hour, 250_000, 'sell', 0.00045)!;
    // strona bidów: 500 tys. w ±10 bp → 250 tys. = połowa → 2,5 bp; + 4,5 bp opłaty
    expect(c.slipBp).toBeCloseTo(2.5, 10);
    expect(c.totalBp).toBeCloseTo(7, 10);
    expect(nowCost(null, hour, 1, 'buy', 0)).toBeNull();
  });
});
