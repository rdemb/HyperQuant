import { describe, expect, it } from 'vitest';
import { Coverage } from '../core/coverage';
import { AggressorOrder, OrderLog } from '../core/orders';
import { PlayerFlow, type PlayerSplit, bigPlayerUsd } from '../core/players';

const M1 = 60_000;
const H = 60 * M1;
// Godzina UTC z dala od zera (czas serwera w ms)
const H0 = 1000 * H;

const order = (time: number, taker: string, side: 1 | -1, notional: number, px = 100): AggressorOrder => ({
  time,
  side,
  sz: notional / px,
  notional,
  vwap: px,
  pxFirst: px,
  pxLast: px,
  fills: 1,
  levels: 1,
  taker,
  makers: 1,
  topMakerUsd: notional,
});

const flow = (orders: AggressorOrder[], spans: [number, number][] = [[H0, H0 + 3 * H]], threshold = 1000) => {
  const log = new OrderLog();
  log.add(orders);
  return { log, players: new PlayerFlow(log, new Coverage(spans), threshold) };
};

describe('Kto handluje', () => {
  it('konto z sumą wejść w 60 min do zamknięcia świecy od progu jest dużym graczem także przy zleceniach pociętych na małe', () => {
    // a: 4 × 300 = 1200 (≥ 1000, duży), b: 900 (reszta), c: sprzedaż 500 (reszta)
    const { players } = flow([
      order(H0 + 1000, 'a', 1, 300),
      order(H0 + 5 * M1, 'a', 1, 300),
      order(H0 + 20 * M1, 'b', 1, 900),
      order(H0 + 30 * M1, 'a', 1, 300),
      order(H0 + 40 * M1, 'c', -1, 500),
      order(H0 + 50 * M1, 'a', 1, 300),
    ]);
    const s = players.split(H0, H, H0 + 3 * H)!;
    expect(s.big).toBeCloseTo(12);
    expect(s.rest).toBeCloseTo(9 - 5);
    expect(s.bigShare).toBeCloseTo((1200 / 2600) * 100);
    // Świeca 1m: tylko zlecenia z tej minuty, klasyfikacja z 60 min do jej zamknięcia (a: 300 + 300 < 1000 — reszta)
    const m = players.split(H0 + 5 * M1, M1, H0 + 3 * H)!;
    expect([m.big, m.rest, m.bigUsd, m.usd, m.bigShare]).toEqual([0, 3, 0, 300, 0]);
    // Świeca 1m o 0:50: w oknie wszystkie cztery wejścia a (1200) — duży
    const late = players.split(H0 + 50 * M1, M1, H0 + 3 * H)!;
    expect([late.big, late.rest, late.bigUsd, late.usd]).toEqual([3, 0, 300, 300]);
  });

  it('okno 60 min do zamknięcia świecy sięga przez pełną godzinę wstecz; świeca 1 h i dłuższa — jej godziny UTC', () => {
    // a: 600 o 0:50 i 600 o 1:05 (razem 1200 w 60 min do 1:06)
    const { players } = flow([order(H0 + 50 * M1, 'a', 1, 600), order(H0 + H + 5 * M1, 'a', 1, 600)]);
    const now = H0 + 3 * H;
    expect(players.split(H0 + H + 5 * M1, M1, now)!.big).toBeCloseTo(6);
    expect(players.split(H0 + 50 * M1, M1, now)!.big).toBe(0);
    // Świeca 1 h 1:00–2:00: okno to ta godzina, a ma w niej 600 — reszta; świeca 2 h: każda godzina osobno
    expect(players.split(H0 + H, H, now)!.big).toBe(0);
    expect(players.split(H0, 2 * H, now)!.big).toBe(0);
  });

  it('godziny liczone osobno: to samo konto w kolejnej godzinie poniżej progu jest resztą', () => {
    const { players } = flow([order(H0 + M1, 'a', 1, 1200), order(H0 + H + M1, 'a', 1, 400)]);
    const s = players.split(H0, 2 * H, H0 + 3 * H)!;
    expect(s.big).toBeCloseTo(12);
    expect(s.rest).toBeCloseTo(4);
  });

  it('zlecenie bez konta zostaje w reszcie, nawet gdy takich zleceń jest dużo', () => {
    const { players } = flow([order(H0 + M1, '', 1, 800), order(H0 + 2 * M1, '', 1, 800)]);
    const s = players.split(H0, H, H0 + 3 * H)!;
    expect([s.big, s.bigShare]).toEqual([0, 0]);
    expect(s.rest).toBeCloseTo(16);
  });

  it('bez taśmy z kontami brak zamiast zera; świeca bez wejść ma udział nieznany', () => {
    const { players } = flow([order(H0 + M1, 'a', 1, 1200)], [[H0 + H, H0 + 2 * H]]);
    expect(players.split(H0, H, H0 + 3 * H)).toBeNull();
    expect(players.split(H0 + H, H, H0 + 3 * H)).toEqual({ big: 0, rest: 0, bigUsd: 0, usd: 0, bigShare: null, complete: true });
    // Świeca, w której nagrywanie się zaczęło: liczby z części świecy
    expect(players.split(H0 + H - 30 * M1, H, H0 + 3 * H)!.complete).toBe(false);
    // Przyszła świeca
    expect(players.split(H0 + 4 * H, H, H0 + 3 * H)).toBeNull();
  });

  it('bieżąca godzina: nowe zlecenie przelicza godzinę i konto, które przekroczyło próg, przechodzi do dużych w całej godzinie', () => {
    const { log, players } = flow([order(H0 + M1, 'a', 1, 600)]);
    const now = H0 + 10 * M1;
    expect(players.split(H0, H, now)!.big).toBe(0);
    log.add([order(H0 + 9 * M1, 'a', 1, 600)]);
    const s = players.split(H0, H, now)!;
    expect(s.big).toBeCloseTo(12);
    expect(s.rest).toBe(0);
  });

  it('czyszczenie zostawia godziny po granicy; progi rynków', () => {
    const { log, players } = flow([order(H0 + M1, 'a', 1, 1200), order(H0 + H + M1, 'a', 1, 1200)]);
    players.split(H0, 2 * H, H0 + 3 * H);
    players.prune(H0 + H);
    log.prune(H0 + H);
    expect(players.split(H0 + H, H, H0 + 3 * H)!.big).toBeCloseTo(12);
    expect(bigPlayerUsd('BTC')).toBe(1_000_000);
    expect(bigPlayerUsd('XYZ')).toBe(250_000);
  });
});

describe('Kto handluje: zamknięta świeca się nie zmienia', () => {
  it('wartość świecy policzona w chwili t równa się wartości godzinę później, po nowych zleceniach po jej zamknięciu', () => {
    // a: 600 w minucie 5 (reszta), b: sprzedaż 1200 w minucie 5 (duży), c: 400 w minucie 12
    const { log, players } = flow([order(H0 + 5 * M1 + 1000, 'a', 1, 600), order(H0 + 5 * M1 + 2000, 'b', -1, 1200), order(H0 + 12 * M1, 'c', 1, 400)]);
    const t = H0 + 15 * M1;
    // Świece zamknięte w chwili t: 1m 0:05, 5m 0:05, 15m 0:00
    const candles: [number, number][] = [
      [H0 + 5 * M1, M1],
      [H0 + 5 * M1, 5 * M1],
      [H0, 15 * M1],
    ];
    const at = (now: number) => candles.map(([c, ms]) => players.split(c, ms, now));
    const before = at(t);
    expect(before[0]!.big).toBeCloseTo(-12);
    expect(before[0]!.rest).toBeCloseTo(6);
    // Po zamknięciu: a i c dobijają do progu w tej samej godzinie UTC, b handluje dalej, nowe konto w kolejnej godzinie
    log.add([order(H0 + 20 * M1, 'a', 1, 600), order(H0 + 30 * M1, 'c', 1, 700), order(H0 + 40 * M1, 'b', 1, 50), order(H0 + H + 5 * M1, 'd', 1, 5000)]);
    expect(at(t + H)).toEqual(before);
  });

  it('świece po kolei (okno przesuwane) i w odwrotnej kolejności (okno od nowa) dają te same liczby', () => {
    // Pseudolosowe zlecenia przez 3 h, 200 kont (kilka bardzo aktywnych), wartości z groszami
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const list: AggressorOrder[] = [];
    for (let i = 0; i < 3000; i++) list.push(order(H0 + Math.floor(rnd() * 3 * H), `k${Math.floor(rnd() ** 3 * 200)}`, rnd() < 0.5 ? 1 : -1, Math.round(rnd() * 10_000) / 100));
    list.sort((a, b) => a.time - b.time);
    const now = H0 + 3 * H - 30_000;
    const run = (ks: number[]) => {
      const { players } = flow(list);
      const out = new Map<number, PlayerSplit | null>();
      for (const k of ks) out.set(k, players.split(H0 + k * M1, M1, now));
      return [...out.entries()].sort((a, b) => a[0] - b[0]);
    };
    const ks = Array.from({ length: 180 }, (_, k) => k);
    const asc = run(ks);
    expect(asc.some(([, s]) => s !== null && s.big !== 0 && s.rest !== 0)).toBe(true);
    expect(run([...ks].reverse())).toEqual(asc);
  });

  it('świeca 1 h: wartość po zamknięciu godziny równa się wartości godzinę później', () => {
    const { log, players } = flow([order(H0 + 10 * M1, 'a', 1, 600), order(H0 + 50 * M1, 'a', 1, 600)]);
    const before = players.split(H0, H, H0 + H + M1);
    expect(before!.big).toBeCloseTo(12);
    log.add([order(H0 + H + 2 * M1, 'a', -1, 900), order(H0 + H + 30 * M1, 'b', 1, 2000)]);
    expect(players.split(H0, H, H0 + 2 * H + M1)).toEqual(before);
  });
});

describe('Kto handluje: okno pełne tylko w jednym zakresie numeracji kont', () => {
  // Doba UTC: północ D1 = H0 rounded; klucze z historii serwera jak w toFills: `~d<doba>:<n>` (pliki idScope 'day'),
  // `~<godzina>:<n>` (starsze pliki godzinowe); konto na żywo — adres
  const DAY = 24 * H;
  const D1 = Math.ceil(H0 / DAY) * DAY;
  const D0 = D1 - DAY;
  const spans: [number, number][] = [[D1 - 3 * H, D1 + 3 * H]];

  it('okno przez przełom doby UTC (pliki dobowe) nie jest pełne; okno w jednej dobie jest', () => {
    const { players } = flow([order(D1 - 20 * M1, `~d${D0}:1`, 1, 600), order(D1 + 5 * M1, `~d${D1}:1`, 1, 600)], spans);
    const now = D1 + 2 * H;
    // świeca 1m 0:10: okno 23:11–0:11 ma numery z dwóch dób — to samo konto mogło dostać dwa numery
    expect(players.split(D1 + 10 * M1, M1, now)!.complete).toBe(false);
    // świeca 1m 0:59: okno 0:00–1:00 w jednej dobie
    expect(players.split(D1 + 59 * M1, M1, now)!.complete).toBe(true);
    // świeca 1h 0:00: okno = jej godzina
    expect(players.split(D1, H, now)!.complete).toBe(true);
  });

  it('okno przez granicę godziny w starych plikach godzinowych nie jest pełne', () => {
    const h1 = D1 + H;
    const { players } = flow([order(h1 - 30 * M1, `~${D1}:1`, 1, 600), order(h1 + 5 * M1, `~${h1}:1`, 1, 600)], spans);
    const now = D1 + 3 * H;
    expect(players.split(h1 + 10 * M1, M1, now)!.complete).toBe(false);
    expect(players.split(h1, H, now)!.complete).toBe(true);
  });

  it('okno z kontami z historii i na żywo (chwila otwarcia strony) nie jest pełne', () => {
    const { players } = flow([order(D1 + 20 * M1, `~d${D1}:1`, 1, 600), order(D1 + 40 * M1, '0xabc', 1, 600)], spans);
    expect(players.split(D1 + 45 * M1, M1, D1 + 2 * H)!.complete).toBe(false);
  });

  it('okno 60 min musi być w całości objęte taśmą z kontami, nie tylko świeca', () => {
    const { players } = flow([order(D1 + 5 * M1, 'a', 1, 600)], [[D1, D1 + 3 * H]]);
    // świeca 1m 0:05 w nagraniu, ale jej okno zaczyna się 23:06 — przed nagraniem
    expect(players.split(D1 + 5 * M1, M1, D1 + 2 * H)!.complete).toBe(false);
    expect(players.split(D1 + 60 * M1, M1, D1 + 2 * H)!.complete).toBe(true);
  });
});
