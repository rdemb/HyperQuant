import { describe, expect, it } from 'vitest';
import { type Box, LABEL_MIN_BAR_PX, densityLimit, keepTicks, lastCandleBoxes, parseDensity, placeLabels } from '../chart/labelPlacement';

const box = (l: number, t: number, w = 40, h = 12): Box => ({ l, t, r: l + w, b: t + h });

describe('gęstość etykiet', () => {
  it('bez ustawienia: 5 na komputerze, 3 na telefonie; 0, 3, 5 i wszystkie z ustawienia', () => {
    expect(densityLimit(undefined, false)).toBe(5);
    expect(densityLimit(undefined, true)).toBe(3);
    expect(densityLimit(0, false)).toBe(0);
    expect(densityLimit(3, false)).toBe(3);
    expect(densityLimit(5, true)).toBe(5);
    expect(densityLimit('all', true)).toBe(Number.POSITIVE_INFINITY);
  });

  it('zapis: tylko 0, 3, 5 i „all”; inna wartość — brak (gęstość domyślna)', () => {
    expect(parseDensity(0)).toBe(0);
    expect(parseDensity(3)).toBe(3);
    expect(parseDensity(5)).toBe(5);
    expect(parseDensity('all')).toBe('all');
    for (const v of [1, 4, -1, '5', null, undefined, {}]) expect(parseDensity(v)).toBeUndefined();
  });
});

describe('rozmieszczenie etykiet na wykresie', () => {
  const opts = { limit: 5, barPx: 9, blocked: [] as Box[], circles: [] };

  it('podpis dostają największe obiekty, najwyżej `limit`; reszta — tylko wymuszona (najechana)', () => {
    const cands = Array.from({ length: 8 }, (_, i) => ({ key: `k${i}`, usd: (i + 1) * 1000, rank: 0, spots: [box(i * 100, 10)] }));
    const out = placeLabels(cands, { ...opts, limit: 3 });
    expect([...out.keys()].sort()).toEqual(['k5', 'k6', 'k7']);
    const forced = placeLabels([...cands.slice(0, 7), { ...cands[7], usd: 1, forced: true }], { ...opts, limit: 3 });
    expect(forced.has('k7')).toBe(true);
    expect(forced.size).toBe(4);
  });

  it('pierwszeństwo `rank` przed wartością (góra lodowa przed ścianą)', () => {
    const out = placeLabels(
      [
        { key: 'wall', usd: 9e6, rank: 0, spots: [box(0, 0)] },
        { key: 'ice', usd: 1e5, rank: 2, spots: [box(0, 0)] },
      ],
      { ...opts, limit: 1 }
    );
    expect([...out.keys()]).toEqual(['ice']);
  });

  it('etykiety nie nachodzą na siebie: druga bierze wolne miejsce albo nie ma podpisu', () => {
    const out = placeLabels(
      [
        { key: 'a', usd: 3, rank: 0, spots: [box(0, 0)] },
        { key: 'b', usd: 2, rank: 0, spots: [box(10, 4), box(100, 4)] },
        { key: 'c', usd: 1, rank: 0, spots: [box(20, 2)] },
      ],
      opts
    );
    expect(out.get('a')).toBe(0);
    expect(out.get('b')).toBe(1);
    expect(out.has('c')).toBe(false);
  });

  it('obiekt bez wolnego miejsca nie zabiera limitu: podpis dostaje następny co do wielkości', () => {
    const out = placeLabels(
      [
        { key: 'big', usd: 9, rank: 0, spots: [box(0, 0)] },
        { key: 'mid', usd: 5, rank: 0, spots: [box(200, 0)] },
      ],
      { ...opts, limit: 1, blocked: [box(0, 0, 60, 20)] }
    );
    expect([...out.keys()]).toEqual(['mid']);
  });

  it('nie na zajętym miejscu (etykiety poziomów, 10 ostatnich świec) i nie na bąblach, chyba że wolno', () => {
    const blocked = [box(0, 0, 50, 20)];
    const circles = [{ x: 200, y: 10, r: 8 }];
    const out = placeLabels(
      [
        { key: 'onTag', usd: 5, rank: 0, spots: [box(10, 5)] },
        { key: 'onBubble', usd: 4, rank: 0, spots: [box(190, 5)] },
        { key: 'lot', usd: 3, rank: 1, spots: [box(190, 5, 20, 4)], overBubbles: true },
      ],
      { ...opts, blocked, circles }
    );
    expect(out.has('onTag')).toBe(false);
    expect(out.has('onBubble')).toBe(false);
    expect(out.get('lot')).toBe(0);
  });

  it(`świece węższe niż ${LABEL_MIN_BAR_PX} px: bez etykiet (także wymuszonych); gęstość 0 — tylko wymuszone`, () => {
    const cands = [
      { key: 'a', usd: 1, rank: 0, spots: [box(0, 0)] },
      { key: 'b', usd: 1, rank: 0, spots: [box(100, 0)], forced: true },
    ];
    expect(placeLabels(cands, { ...opts, barPx: LABEL_MIN_BAR_PX - 0.5 }).size).toBe(0);
    expect([...placeLabels(cands, { ...opts, limit: 0 }).keys()]).toEqual(['b']);
  });
});

describe('10 ostatnich świec', () => {
  it('prostokąty od lewej krawędzi świecy na jej szerokość, od szczytu do dołka', () => {
    const bars = Array.from({ length: 12 }, (_, i) => ({ x: i * 10, hi: 100 + i, lo: 90 + i }));
    const boxes = lastCandleBoxes(bars, 10, (p) => 200 - p);
    expect(boxes).toHaveLength(10);
    expect(boxes[0]).toEqual({ l: 20, r: 30, t: 98, b: 108 });
    expect(boxes[9]).toEqual({ l: 110, r: 120, t: 89, b: 99 });
  });
});

describe('oś ceny: etykiety siatki ustępują ważniejszym', () => {
  it('etykieta siatki kolidująca z ceną, odliczaniem pod nią albo VWAP nie jest rysowana', () => {
    // Ostatnia cena na y = 100 (z odliczaniem pod nią do y = 100 + 16), VWAP na y = 200
    const reserved = [
      { y: 100, below: 1 },
      { y: 200, below: 0 },
    ];
    const ticks = [40, 92, 112, 120, 135, 190, 216, 260];
    expect(keepTicks(ticks, reserved, 16)).toEqual([true, false, false, false, true, false, true, true]);
  });

  it('bez etykiet priorytetowych — cała siatka; brak współrzędnej — etykieta zostaje', () => {
    expect(keepTicks([10, 50, null], [], 16)).toEqual([true, true, true]);
  });
});
