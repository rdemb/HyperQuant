import { describe, expect, it } from 'vitest';
import type { AggressorOrder } from '../core/orders';
import { BUBBLES_BARS, BUBBLES_EVIDENCE, BUBBLES_K, BUBBLES_K_PHONE, BUBBLES_MAX, type BubbleView, selectBubbles } from '../chart/bubbleSelect';

const S = 1000;
const M = 60_000;
const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 4, 12);

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

const view = (v: Partial<BubbleView> = {}): BubbleView => ({ from: Number.NEGATIVE_INFINITY, intervalMs: M, phone: false, manual: 0, ...v });
const usd = (list: readonly AggressorOrder[]) => list.map((o) => o.notional);

/** Taśma bez zegara: pseudolosowe zlecenia co 2–20 s, wartości o grubym ogonie (od 1 tys. do kilku mln USD). */
function tape(from: number, to: number, seed = 7): AggressorOrder[] {
  let x = seed;
  const rnd = () => ((x = (x * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
  const out: AggressorOrder[] = [];
  for (let t = from; t < to; t += 2 * S + Math.floor(rnd() * 18) * S) out.push(order({ time: t, notional: Math.round(1000 / (0.0005 + rnd() ** 2)), side: rnd() < 0.5 ? 1 : -1 }));
  return out;
}

describe(`reguła przyczynowa bąbli: wśród ${BUBBLES_K} największych zleceń z poprzednich ${BUBBLES_BARS} świec`, () => {
  it('zlecenie z dwoma większymi w poprzednich 20 świecach nie ma bąbla; pierwsze i drugie co do wielkości ma', () => {
    const list = [
      order({ time: T0, notional: 500_000 }),
      order({ time: T0 + M, notional: 400_000 }),
      order({ time: T0 + 2 * M, notional: 300_000 }),
      order({ time: T0 + 3 * M, notional: 450_000 }),
      order({ time: T0 + 5 * M, notional: 50_000 }),
    ];
    expect(usd(selectBubbles(list, view()))).toEqual([500_000, 400_000, 450_000]);
  });

  it('okno to 20 świec interwału wykresu: zlecenie sprzed 20 świec już się nie liczy; pierwsze po pustych 20 świecach ma bąbel', () => {
    const list = [
      order({ time: T0, notional: 900_000 }),
      order({ time: T0 + S, notional: 800_000 }),
      order({ time: T0 + 19 * M, notional: 100_000 }),
      // 20 świec po zleceniu 100 tys. USD: w oknie nic (granica okna wyłączna)
      order({ time: T0 + 39 * M, notional: 5_000 }),
    ];
    expect(usd(selectBubbles(list, view()))).toEqual([900_000, 800_000, 5_000]);
    // 5m: 20 świec to 100 min — oba późniejsze zlecenia mają jeszcze dwa większe przed sobą
    expect(usd(selectBubbles(list, view({ intervalMs: 5 * M })))).toEqual([900_000, 800_000]);
  });

  it('raz narysowany zostaje: późniejsze większe zlecenia nie zmieniają wyboru z przeszłości', () => {
    const early = [order({ time: T0, notional: 200_000 }), order({ time: T0 + M, notional: 100_000 })];
    const later = Array.from({ length: 10 }, (_, i) => order({ time: T0 + (2 + i) * M, notional: 3_000_000 + i }));
    expect(usd(selectBubbles(early, view()))).toEqual([200_000, 100_000]);
    expect(usd(selectBubbles([...early, ...later], view()).slice(0, 2))).toEqual([200_000, 100_000]);
  });

  it(`telefon: tylko największe (K = ${BUBBLES_K_PHONE})`, () => {
    const list = [order({ time: T0, notional: 500_000 }), order({ time: T0 + M, notional: 400_000 }), order({ time: T0 + 2 * M, notional: 600_000 })];
    expect(usd(selectBubbles(list, view({ phone: true })))).toEqual([500_000, 600_000]);
    expect(usd(selectBubbles(list, view()))).toEqual([500_000, 400_000, 600_000]);
  });

  it('równe wartości: wcześniejsze wyżej; zlecenia z tej samej chwili niezależnie od kolejności w tablicy', () => {
    const a = order({ time: T0, notional: 300_000, taker: '0xa' });
    const b = order({ time: T0 + M, notional: 300_000, taker: '0xb' });
    const c = order({ time: T0 + 2 * M, notional: 300_000, taker: '0xc' });
    expect(selectBubbles([a, b, c], view()).map((o) => o.taker)).toEqual(['0xa', '0xb']);
    const p = order({ time: T0, notional: 900_000, taker: '0xp' });
    const q = order({ time: T0, notional: 100_000, taker: '0xq' });
    const r = order({ time: T0, notional: 500_000, taker: '0xr' });
    const pick = (list: AggressorOrder[]) => selectBubbles(list, view({ phone: true })).map((o) => o.taker);
    expect(pick([p, q, r])).toEqual(['0xp']);
    expect(pick([q, r, p])).toEqual(['0xp']);
  });

  it('zestaw minionej godziny identyczny po przewinięciu, zbliżeniu i upływie czasu (zlecenia od początku widoku − 20 świec)', () => {
    const live = tape(T0, T0 + 6 * H);
    const past = (s: readonly AggressorOrder[]) => s.filter((o) => o.time >= T0 + 3 * H && o.time < T0 + 4 * H);
    // Tak jak warstwa: zlecenia od `from − 20 świec`, wynik od `from`
    const pick = (src: readonly AggressorOrder[], from: number, to: number, ms = M) =>
      past(selectBubbles(src.filter((o) => o.time >= from - BUBBLES_BARS * ms && o.time < to), view({ from, intervalMs: ms })));
    const base = pick(live, T0 + 2 * H + 20 * M, T0 + 4 * H + 40 * M);
    expect(base.length).toBeGreaterThan(5);
    expect(base.length).toBeLessThan(BUBBLES_MAX);
    // Przewinięcie i zbliżenie (węższe i szersze okno), upływ czasu (taśma dłuższa i krótsza), cała taśma
    expect(pick(live, T0 + 3 * H, T0 + 4 * H)).toEqual(base);
    expect(pick(live, T0 + 2 * H + 59 * M, T0 + 4 * H + 5 * M)).toEqual(base);
    expect(pick(live.filter((o) => o.time < T0 + 4 * H + 5 * M), T0 + 2 * H + 25 * M, T0 + 6 * H)).toEqual(base);
    expect(past(selectBubbles(live, view()))).toEqual(base);
    // Na 5m inny zestaw, ale tak samo niezależny od okna
    expect(pick(live, T0 + 3 * H, T0 + 4 * H, 5 * M)).toEqual(pick(live, T0 + 2 * H, T0 + 6 * H, 5 * M));
  });

  it('nagrana taśma: na 140 świecach 1m mieści się w limicie, na telefonie (33 świece) najwyżej kilka', () => {
    const live = tape(T0, T0 + 6 * H, 11);
    const at = (bars: number, phone: boolean) => {
      const from = T0 + 4 * H - bars * M;
      return selectBubbles(live.filter((o) => o.time >= from - BUBBLES_BARS * M && o.time < T0 + 4 * H), view({ from, phone })).length;
    };
    expect(at(140, false)).toBeGreaterThanOrEqual(5);
    expect(at(140, false)).toBeLessThanOrEqual(BUBBLES_MAX);
    expect(at(33, true)).toBeLessThanOrEqual(15);
  });
});

describe('próg ręczny i bezpiecznik', () => {
  it('próg ręczny z ustawień bez zmian: każde zlecenie od progu, bez reguły przyczynowej', () => {
    const list = [order({ time: T0, notional: 500_000 }), order({ time: T0 + M, notional: 600_000 }), order({ time: T0 + 2 * M, notional: 250_000 }), order({ time: T0 + 3 * M, notional: 90_000 })];
    expect(usd(selectBubbles(list, view({ manual: 200_000 })))).toEqual([500_000, 600_000, 250_000]);
    expect(usd(selectBubbles(list, view({ manual: 200_000, from: T0 + M })))).toEqual([600_000, 250_000]);
  });

  it(`bezpiecznik: najwyżej ${BUBBLES_MAX} na ekran — największe, w kolejności czasu`, () => {
    // Każde kolejne zlecenie większe od poprzednich: reguła przepuszcza wszystkie, decyduje limit
    const list = Array.from({ length: 60 }, (_, i) => order({ time: T0 + i * M, notional: 400_000 + i * 1000 }));
    const s = selectBubbles(list, view());
    expect(usd(s)).toEqual(Array.from({ length: BUBBLES_MAX }, (_, i) => 400_000 + (i + 20) * 1000));
  });

  it('opis: wynik sprawdzianu, PL i EN', () => {
    expect(BUBBLES_EVIDENCE.pl).toBe('Po dużym zleceniu cena nie idzie w jego stronę: −0,2 pb po 5 min (n 33 831).');
    expect(BUBBLES_EVIDENCE.en).toContain('−0.2 bp after 5 min (n 33,831)');
  });
});
