import { describe, expect, it } from 'vitest';
import { bookQuote, outcomeProbabilities, parseBtcOutcomes, parseHlTime } from '../hip4';
import { normCdf } from '../stats';

const NOW = Date.UTC(2026, 9, 22, 12, 0);

describe('HIP-4: rynki wynikowe BTC z outcomeMeta', () => {
  const meta = {
    outcomes: [
      { outcome: 15563, name: 'Recurring', description: 'class:priceBinary|underlying:BTC|expiry:20261023-0600|targetPrice:82807|period:1d', sideSpecs: [{ name: 'Yes' }, { name: 'No' }] },
      { outcome: 7175, name: 'template:priceTouch', description: 'perp:BTC|priceDescription:BTC-USDC perp mark|seconds:3|target:92500|time:20261101-0000', sideSpecs: [] },
      { outcome: 14361, name: 'template:binaryPrice', description: 'perp:BTC|priceDescription:the Pyth BTC/USD price|seconds:90|threshold:80195|time:20261026-0800', sideSpecs: [] },
      { outcome: 1, name: 'template:binaryPrice', description: 'perp:BTC|priceDescription:the Pyth BTC/USD price|seconds:90|threshold:80000|time:20261020-0800', sideSpecs: [] }, // wygasł
      { outcome: 14200, name: 'template:sportsContestParticipant2', description: 'participant:Lyon', sideSpecs: [] },
      { outcome: 99, name: 'template:binaryPrice', description: 'perp:ETH|threshold:3000|time:20261026-0800', sideSpecs: [] },
      { outcome: 15601, name: 'template:binaryPrice', description: 'perp:BTC|priceDescription:the Hyperliquid BTC perp trade|seconds:90|threshold:81000|time:20261027-0800', sideSpecs: [] },
    ],
  };

  it('czas HL „RRRRMMDD-GGMM” w UTC', () => {
    expect(parseHlTime('20261023-0600')).toBe(Date.UTC(2026, 9, 23, 6, 0));
    expect(parseHlTime('2026-10-23')).toBeNull();
  });

  it('tylko BTC, tylko niewygasłe; rodzaj, próg, termin, źródło ceny i nazwa arkusza strony „Yes”', () => {
    const qs = parseBtcOutcomes(meta, NOW);
    expect(qs.map((q) => q.id)).toEqual([15563, 14361, 15601, 7175]); // posortowane po terminie
    expect(qs[0]).toMatchObject({ kind: 'above', K: 82807, expiry: Date.UTC(2026, 9, 23, 6, 0), source: 'mark', coin: '#155630', recurring: true });
    expect(qs[1]).toMatchObject({ kind: 'above', K: 80195, source: 'pyth', coin: '#143610' });
    expect(qs[2]).toMatchObject({ kind: 'above', K: 81000, source: 'trade', seconds: 90 });
    expect(qs[3]).toMatchObject({ kind: 'touch', K: 92500, expiry: Date.UTC(2026, 10, 1), source: 'mark' });
    expect(parseBtcOutcomes(null, NOW)).toEqual([]);
  });

  it('notowanie z arkusza: bid/ask/mid, spread i płynność (spread ≤ 0,05 i ≥ 20 USD w 3 poziomach po obu stronach)', () => {
    const lv = (px: number, sz: number) => ({ px: String(px), sz: String(sz), n: 1 });
    const liquid = bookQuote({ levels: [[lv(0.14, 1000), lv(0.13, 2000)], [lv(0.16, 900)]] });
    expect(liquid).toMatchObject({ bid: 0.14, ask: 0.16, liquid: true });
    expect(liquid!.mid).toBeCloseTo(0.15, 12);
    const empty = bookQuote({ levels: [[lv(0.0035, 5)], [lv(0.9967, 5000)]] });
    expect(empty!.liquid).toBe(false);
    expect(bookQuote({ levels: [[], [lv(0.5, 10)]] })).toBeNull();
  });
});

describe('HIP-4: prawdopodobieństwa modelu (Monte Carlo)', () => {
  // Stała σ na krok, innowacje normalne — porównanie ze wzorami dla ruchu Browna w log-cenie
  const steps = 288; // 1 doba po 5 min
  const s = 0.02 / Math.sqrt(steps); // σ doby 2%
  const sigmaFor = () => Array<number>(steps).fill(s);

  it('P(S_T > K) zgodne z log-normalnym wzorem (martyngał ceny) w granicach błędu MC', () => {
    const S0 = 100_000;
    const K = 101_000;
    const [p] = outcomeProbabilities([{ kind: 'above', K, horizonMin: 24 * 60 }], S0, { stepSigmas: sigmaFor, residuals: null, seed: 1, paths: 20000 });
    const sig = 0.02;
    const want = normCdf((Math.log(S0 / K) - 0.5 * sig * sig) / sig);
    expect(Math.abs(p! - want)).toBeLessThan(0.01);
  });

  it('P(dotknięcia K przed T) ≈ 2·(1 − Φ(b/σ)) z korektą mostu Browna między krokami', () => {
    const S0 = 100_000;
    const K = 102_000;
    const [p] = outcomeProbabilities([{ kind: 'touch', K, horizonMin: 24 * 60 }], S0, { stepSigmas: sigmaFor, residuals: null, seed: 2, paths: 20000 });
    const b = Math.log(K / S0);
    const want = 2 * (1 - normCdf(b / 0.02)); // dryf −½σ² pomijalny na tej skali
    expect(Math.abs(p! - want)).toBeLessThan(0.02);
    // poziom poniżej ceny — symetrycznie
    const [q] = outcomeProbabilities([{ kind: 'touch', K: S0 * Math.exp(-b), horizonMin: 24 * 60 }], S0, { stepSigmas: sigmaFor, residuals: null, seed: 3, paths: 20000 });
    expect(Math.abs(q! - want)).toBeLessThan(0.02);
  });

  it('dłuższy krok z sumą k innowacji FHS: ogony jak przy krokach 5 min (bez zawyżania przez jedną grubą innowację)', () => {
    // Reszty o grubych ogonach: 98% w ±0.8, 2% w ±6.2 (wariancja ≈ 1)
    const res = Float64Array.from({ length: 1000 }, (_, i) => (i % 50 === 0 ? (i % 100 === 0 ? 6.2 : -6.2) : ((i % 7) - 3) * 0.27));
    const S0 = 100_000;
    const sFine = 0.001;
    const sHour = sFine * Math.sqrt(12);
    const K = S0 * Math.exp(4 * sHour); // 4σ godziny — wrażliwe na ogony jednego kroku
    const q = [{ kind: 'above' as const, K, horizonMin: 60 }];
    const fine = outcomeProbabilities(q, S0, { stepSigmas: () => Array(12).fill(sFine), residuals: res, seed: 4, paths: 40000 })[0]!;
    const summed = outcomeProbabilities(q, S0, { stepSigmas: () => [sHour], residuals: res, seed: 5, paths: 40000, innovSum: () => 12 })[0]!;
    const single = outcomeProbabilities(q, S0, { stepSigmas: () => [sHour], residuals: res, seed: 6, paths: 40000 })[0]!;
    expect(Math.abs(summed - fine)).toBeLessThan(0.004);
    expect(single - fine).toBeGreaterThan(0.005); // jedna gruba innowacja na krok zawyża ogon
  });

  it('horyzont ≤ 0 (termin minął) → null; cena dokładnie na poziomie → dotknięcie 1', () => {
    const r = outcomeProbabilities(
      [
        { kind: 'above', K: 99_000, horizonMin: 0 },
        { kind: 'touch', K: 98_000, horizonMin: 60 },
      ],
      98_000,
      { stepSigmas: () => [0.001], residuals: null, seed: 1 }
    );
    expect(r).toEqual([null, 1]);
  });
});
