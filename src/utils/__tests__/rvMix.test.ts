import { describe, expect, it } from 'vitest';
import { GH9_NODES, GH9_WEIGHTS, RVMIX, rv60From5m, rvLevel, scaleMixQuantiles, sigmaFromQuantiles } from '../rvMix';
import { normInv } from '../forecastScore';
import { mulberry32 } from '../pathEngine';
import ref from './fixtures/rvMixReference.json';

// Wartości wzorcowe policzone niezależnie (osobna implementacja z dokładną funkcją błędu), z tymi samymi węzłami
// i wagami kwadratury; tolerancja kwantyli C 1e-5
const TAUS = ref.taus;

describe('wariant C: poziom ze świeżej zmienności i mieszanina skali', () => {
  it('stałe kwadratury Gaussa–Hermite’a i stałe wariantu jak w planie', () => {
    expect([...GH9_NODES]).toEqual(ref.wezly);
    expect([...GH9_WEIGHTS]).toEqual(ref.wagi);
    expect(GH9_WEIGHTS.reduce((s, w) => s + w, 0)).toBeCloseTo(1, 12);
    expect(RVMIX).toEqual({ kappa: 0.5, c: -0.05, tau: 0.5 });
  });

  for (const p of ref.przypadki)
    it(`(b) wzorzec „${p.nazwa}”: σA, x, q1 i kwantyle C z dokładnością 1e-5`, () => {
      const lvl = rvLevel(p.qA, TAUS, p.rv60, p.kappa, p.c)!;
      expect(lvl.sigmaA).toBeCloseTo(p.sigmaA, 10);
      expect(lvl.x).toBeCloseTo(p.x, 8);
      lvl.q1.forEach((v, i) => expect(Math.abs(v - p.q1[i]), `q1[${i}]`).toBeLessThan(1e-8));
      const qC = scaleMixQuantiles(lvl.q1, TAUS, p.tau);
      qC.forEach((v, i) => expect(Math.abs(v - p.qC[i]), `qC[${i}]`).toBeLessThan(1e-5));
      // (c) kwantyle C rosnące
      for (let i = 1; i < qC.length; i++) expect(qC[i]).toBeGreaterThan(qC[i - 1]);
    });

  it('(a) τ = 0 zwraca q1 bez zmian; (e) κ = 0, c = 0, τ = 0 daje dokładnie kwantyle A', () => {
    const p = ref.przypadki[2];
    const q1 = rvLevel(p.qA, TAUS, p.rv60, 0.5, -0.05)!.q1;
    expect(scaleMixQuantiles(q1, TAUS, 0)).toEqual(q1);
    const a = rvLevel(p.qA, TAUS, p.rv60, 0, 0)!;
    expect(scaleMixQuantiles(a.q1, TAUS, 0)).toEqual(p.qA);
  });

  it('(d) symetria: odbite kwantyle A dają odbite kwantyle C', () => {
    const p = ref.przypadki[2];
    const q1 = rvLevel(p.qA, TAUS, p.rv60, p.kappa, p.c)!.q1;
    const mirror = (q: number[]) => [...q].reverse().map((v) => -v);
    const c = scaleMixQuantiles(q1, TAUS, p.tau);
    const cm = scaleMixQuantiles(mirror(q1), TAUS, p.tau);
    mirror(c).forEach((v, i) => expect(Math.abs(v - cm[i])).toBeLessThan(1e-9));
  });

  it('przypadki brzegowe: rv60 = 0 daje x = −1,5; kwantyle nierosnące albo σA ≤ 0 → brak C', () => {
    const p = ref.przypadki[0];
    expect(rvLevel(p.qA, TAUS, 0, 0.5, -0.05)!.x).toBe(-1.5);
    expect(rvLevel(p.qA, TAUS, 1, 0.5, -0.05)!.x).toBe(1.5);
    const flat = [...p.qA];
    flat[5] = flat[4];
    expect(rvLevel(flat, TAUS, p.rv60, 0.5, -0.05)).toBeNull();
    expect(rvLevel([...p.qA].reverse(), TAUS, p.rv60, 0.5, -0.05)).toBeNull();
    expect(rvLevel(p.qA, TAUS, Number.NaN, 0.5, -0.05)).toBeNull();
    expect(sigmaFromQuantiles(p.qA, TAUS)).toBeCloseTo(p.sigmaA, 10);
  });

  it('kalibracja na danych syntetycznych: zwroty z mieszaniny skali o znanym τ; C z tym τ pokrywa 60% w 0,58–0,62, A ponad 0,66', () => {
    // y = σ·exp(η/2)·Z, η = τ·n − τ²/2 (E exp(η) = 1), A = rozkład normalny z tym σ; poziom bez zmian (q1 = qA)
    const tau = 0.8;
    const sigma = 0.004;
    const qA = TAUS.map((t) => sigma * normInv(t));
    const qC = scaleMixQuantiles(qA, TAUS, tau);
    const u = mulberry32(20261111);
    const gauss = () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
    const lo = TAUS.indexOf(0.2);
    const hi = TAUS.indexOf(0.8);
    let a = 0;
    let c = 0;
    const N = 20_000;
    for (let i = 0; i < N; i++) {
      const y = sigma * Math.exp((tau * gauss() - (tau * tau) / 2) / 2) * gauss();
      if (y >= qA[lo] && y <= qA[hi]) a++;
      if (y >= qC[lo] && y <= qC[hi]) c++;
    }
    expect(c / N).toBeGreaterThanOrEqual(0.58);
    expect(c / N).toBeLessThanOrEqual(0.62);
    expect(a / N).toBeGreaterThan(0.66);
  });
});

describe('zmienność zrealizowana 60 min przed slotem (przed faktem)', () => {
  const S = Date.UTC(2026, 10, 12, 10);
  const M5 = 5 * 60_000;
  const bars = (closes: number[], from: number) => closes.map((close, i) => ({ time: from + i * M5, close }));
  const closes = Array.from({ length: 13 }, (_, i) => 100_000 * Math.exp(0.001 * Math.sin(i)));

  it('12 log-zwrotów zamknięcie do zamknięcia ze świec S − 65 min … S − 5 min', () => {
    const b = bars(closes, S - 13 * M5);
    let want = 0;
    for (let i = 1; i < 13; i++) want += Math.log(closes[i] / closes[i - 1]) ** 2;
    expect(rv60From5m(b, S)).toBeCloseTo(want, 15);
  });

  it('świeca w toku od S (i późniejsze) nie wpływa na wynik; brak którejkolwiek z 13 świec → null', () => {
    const b = bars(closes, S - 13 * M5);
    const base = rv60From5m(b, S);
    expect(rv60From5m([...b, { time: S, close: 50_000 }, { time: S + M5, close: 1 }], S)).toBe(base);
    expect(rv60From5m(b.filter((x) => x.time !== S - 6 * M5), S)).toBeNull();
    expect(rv60From5m(b.slice(1), S)).toBeNull();
    // Slot o świecę wcześniej: ostatnia świeca (S − 5 min) jest dla niego w toku, więc brak 13. świecy wstecz
    expect(rv60From5m(b, S - M5)).toBeNull();
  });
});
