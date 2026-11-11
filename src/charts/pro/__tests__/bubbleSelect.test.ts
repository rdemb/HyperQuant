import { describe, expect, it, vi } from 'vitest';
import type { AggressorOrder } from '../core/orders';
import { BUBBLES_EVIDENCE, BUBBLES_MAX, BUBBLES_PER_BAR, bubbleThresholdAt, selectBubbles } from '../chart/bubbleSelect';

const M = 60_000;
const H = 3_600_000;
const DAY = 24 * H;
const T0 = Date.UTC(2026, 10, 4, 0);

const order = (o: Partial<AggressorOrder>): AggressorOrder => ({
  time: 0,
  side: 1,
  sz: 1,
  notional: 10_000,
  vwap: 100_000,
  pxFirst: 100_000,
  pxLast: 100_000,
  fills: 1,
  levels: 1,
  taker: '0x1',
  makers: 1,
  topMakerUsd: 0,
  ...o,
});

/** Doba po jednym zleceniu na minutę, wartości 1 000 … 1 440 000 USD (każda inna, rosnąco z czasem). */
const day = Array.from({ length: 1440 }, (_, i) => order({ time: T0 + i * M, notional: 1000 * (i + 1) }));
const source = (list: readonly AggressorOrder[]) => vi.fn((from: number, to: number) => list.filter((o) => o.time >= from && o.time < to));
const fallback = () => 77_000;

describe('próg bąbli zależny od interwału, z chwili zdarzenia', () => {
  it(`wartość, powyżej której w poprzedniej dobie było średnio ${BUBBLES_PER_BAR} zlecenia na świecę interwału`, () => {
    const t = T0 + DAY + 10 * M;
    // 1m: 0,15 × 1440 = 216 zleceń w dobie → 216. największe; 5m: 0,15 × 288 = 43,2 → 43.
    expect(bubbleThresholdAt(source(day), M, 0, fallback)(t)).toBe(1000 * (1440 - 215));
    expect(bubbleThresholdAt(source(day), 5 * M, 0, fallback)(t)).toBe(1000 * (1440 - 42));
  });

  it('krótsza historia: liczba zleceń z doby proporcjonalnie do pokrytego czasu; za mała próbka — próg zastępczy', () => {
    const last6h = day.slice(-360);
    // 6 h: 0,15 × 360 = 54 → 54. największe z 6 h
    expect(bubbleThresholdAt(source(last6h), M, 0, fallback)(T0 + DAY + 5)).toBe(1000 * (1440 - 53));
    expect(bubbleThresholdAt(source(day.slice(-100)), M, 0, fallback)(T0 + DAY + 5)).toBe(77_000);
  });

  it('próg ręczny z ustawień bez zmian — ten sam dla każdej chwili i interwału', () => {
    const at = bubbleThresholdAt(source(day), M, 250_000, fallback);
    expect([at(T0), at(T0 + 5 * DAY)]).toEqual([250_000, 250_000]);
  });

  it('próg godziny z przeszłości nie zmienia się po dojściu nowych zleceń i jest liczony raz (pamięć godzin)', () => {
    const later = [...day, ...Array.from({ length: 600 }, (_, i) => order({ time: T0 + DAY + i * M, notional: 5_000_000 }))];
    const t = T0 + DAY + 30 * M;
    expect(bubbleThresholdAt(source(later), M, 0, fallback)(t)).toBe(bubbleThresholdAt(source(day), M, 0, fallback)(t));
    const src = source(later);
    const memo = new Map<number, number>();
    bubbleThresholdAt(src, M, 0, fallback, memo)(t);
    bubbleThresholdAt(src, M, 0, fallback, memo)(t + 5 * M);
    expect(src).toHaveBeenCalledTimes(1);
  });
});

describe('wybór bąbli (selectBubbles)', () => {
  const thr = (t: number) => (t < T0 + H ? 100_000 : 400_000);

  it('każde zlecenie od progu z chwili zdarzenia, bez wyboru największych w oknie', () => {
    const list = [
      order({ time: T0 + 10 * M, notional: 150_000 }),
      order({ time: T0 + 20 * M, notional: 90_000 }),
      order({ time: T0 + H + 10 * M, notional: 300_000 }),
      order({ time: T0 + H + 20 * M, notional: 450_000 }),
    ];
    expect(selectBubbles(list, thr).map((o) => o.notional)).toEqual([150_000, 450_000]);
  });

  it(`bezpiecznik: najwyżej ${BUBBLES_MAX} na ekran — największe względem progu ze swojej chwili, w kolejności czasu`, () => {
    const list = Array.from({ length: 60 }, (_, i) => order({ time: T0 + H + i * M, notional: 400_000 + i * 1000 }));
    // Zlecenie z poprzedniej godziny: 2,5 × próg (próg 100 tys.) — wyżej niż każde z kolejnej godziny (≤ 1,15 × 400 tys.)
    list.unshift(order({ time: T0 + 30 * M, notional: 250_000 }));
    const s = selectBubbles(list, thr);
    expect(s).toHaveLength(BUBBLES_MAX);
    expect(s[0].notional).toBe(250_000);
    expect(s.slice(1).map((o) => o.notional)).toEqual(Array.from({ length: 39 }, (_, i) => 400_000 + (i + 21) * 1000));
  });

  it('bąble minionej godziny te same po przewinięciu, zbliżeniu i upływie czasu (zbiór niezależny od okna)', () => {
    // Doba taśmy i 3 godziny dalej; okna różnej szerokości i położenia, próg z taśmy dochodzącej później
    const live = [...day, ...Array.from({ length: 180 }, (_, i) => order({ time: T0 + DAY + i * M, notional: [3_000_000, 1_000_000, 50_000][i % 10 === 0 ? 0 : i % 10 === 5 ? 1 : 2] }))];
    const past = (s: readonly AggressorOrder[]) => s.filter((o) => o.time >= T0 + DAY + H && o.time < T0 + DAY + 2 * H);
    const pick = (src: readonly AggressorOrder[], from: number, to: number) =>
      past(selectBubbles(src.filter((o) => o.time >= from && o.time < to), bubbleThresholdAt(source(src), M, 0, fallback)));
    const base = pick(live, T0 + DAY + 40 * M, T0 + DAY + 180 * M);
    expect(base.length).toBeGreaterThan(0);
    expect(base.length).toBeLessThan(BUBBLES_MAX);
    expect(pick(live, T0 + DAY + 50 * M, T0 + DAY + 125 * M)).toEqual(base);
    expect(pick(live, T0 + DAY, T0 + DAY + 180 * M)).toEqual(base);
    expect(pick(live.slice(0, 1440 + 130), T0 + DAY + 30 * M, T0 + DAY + 130 * M)).toEqual(base);
  });

  it('opis: wynik sprawdzianu, PL i EN', () => {
    expect(BUBBLES_EVIDENCE.pl).toBe('Po dużym zleceniu cena nie idzie w jego stronę: −0,2 pb po 5 min (n 33 831).');
    expect(BUBBLES_EVIDENCE.en).toContain('−0.2 bp after 5 min (n 33,831)');
  });
});
