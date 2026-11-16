import { describe, expect, it } from 'vitest';
import type { Candle } from '../hl/parse';
import { type IndicatorBar, initialBalances } from '../core/indicators';
import { IVB_OBJECTS_MAX, ivbAt, ivbObjects } from '../core/ivb';

/**
 * IVB (zakres otwarcia NY, 30 albo 60 min): okno od otwarcia giełdy w Nowym Jorku według kalendarza (09:30 czasu
 * nowojorskiego, czyli 14:30 albo 15:30 czasu polskiego), z zamkniętych świec, osobno od IB 60 min.
 */

const M5 = 300_000;
const MIN = 60_000;
const utc = (s: string) => Date.parse(s);
const bar = (t: number, h: number, l: number): IndicatorBar => ({ t, candle: { t, o: (h + l) / 2, h, l, c: (h + l) / 2, v: 1, n: 1 } as Candle });

/** Świece 5m od `from` przez `n` świec; świeca k ma zakres 100 ± (k + 1). */
const run = (from: number, n: number): IndicatorBar[] => Array.from({ length: n }, (_, k) => bar(from + k * M5, 100 + k + 1, 100 - k - 1));

/** Godzina w czasie polskim (Europe/Warsaw), niezależnie od strefy maszyny testów. */
const pl = (t: number) => new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' }).format(t);

describe('IVB: okno od otwarcia NY według kalendarza', () => {
  it('lato 15:30, tydzień rozjazdu zmiany czasu (Europa już zimowy, USA jeszcze letni) 14:30, zima 15:30 czasu polskiego', () => {
    for (const [day, open, want] of [
      ['2026-07-15', '2026-07-15T13:30:00Z', '15:30'],
      ['2026-10-28', '2026-10-28T13:30:00Z', '14:30'],
      ['2026-11-16', '2026-11-16T14:30:00Z', '15:30'],
      ['2026-03-10', '2026-03-10T13:30:00Z', '14:30'],
    ] as const) {
      const t0 = utc(open);
      const s = ivbAt(run(t0 - 6 * M5, 24), M5, 30, t0 + 2 * 3_600_000);
      expect(s.kind, day).toBe('ok');
      if (s.kind !== 'ok') continue;
      expect(s.ivb.start, day).toBe(t0);
      expect(pl(s.ivb.start), day).toBe(want);
    }
  });

  it('30 albo 60 min: zakres świec zaczętych w oknie; osobno od IB (pierwsza godzina sesji)', () => {
    const open = utc('2026-11-16T14:30:00Z');
    // 6 świec przed otwarciem (szersze, nie wchodzą) i 18 po nim
    const b = [...run(open - 6 * M5, 6).map((x) => bar(x.t, 130, 70)), ...run(open, 18)];
    const now = open + 3 * 3_600_000;
    const s30 = ivbAt(b, M5, 30, now);
    const s60 = ivbAt(b, M5, 60, now);
    expect(s30).toMatchObject({ kind: 'ok', ivb: { start: open, end: open + 30 * MIN, hi: 106, lo: 94, complete: true } });
    expect(s60).toMatchObject({ kind: 'ok', ivb: { start: open, end: open + 60 * MIN, hi: 112, lo: 88, complete: true } });
    // IB NY nadal 60 min, niezależnie od wyboru IVB
    const ib = initialBalances(b, M5).find((x) => x.session.id === 'ny')!;
    expect([ib.session.start, ib.end - ib.session.start]).toEqual([open, 60 * MIN]);
  });

  it('w budowie: tylko zamknięte świece okna; świeca w trakcie nie wchodzi; przed pierwszym zamknięciem — czekanie', () => {
    const open = utc('2026-11-16T14:30:00Z');
    const b = run(open, 4);
    // Chwila 14:47: zamknięte świece 14:30, 14:35, 14:40; świeca 14:45 w trakcie
    expect(ivbAt(b, M5, 30, open + 17 * MIN)).toMatchObject({ kind: 'ok', ivb: { hi: 103, lo: 97, complete: false } });
    expect(ivbAt(b.slice(0, 1), M5, 30, open + 2 * MIN)).toMatchObject({ kind: 'waiting', open });
  });

  it('poza sesją NY: „—” z najbliższym otwarciem; interwał powyżej 30m: „—” z powodem; bez świec: brak', () => {
    const london = utc('2026-11-16T09:00:00Z');
    expect(ivbAt(run(london, 12), M5, 30, london + 3_600_000)).toEqual({ kind: 'outside', next: utc('2026-11-16T14:30:00Z') });
    const open = utc('2026-11-16T14:30:00Z');
    expect(ivbAt(run(open, 3).map((x, k) => ({ ...x, t: open + k * 3_600_000 })), 3_600_000, 30, open + 4 * 3_600_000)).toEqual({ kind: 'interval' });
    expect(ivbAt([], M5, 30, open)).toEqual({ kind: 'noData' });
  });

  it('brak świecy w oknie (historia od później albo luka): bez zakresu z niepełnego okna', () => {
    const open = utc('2026-11-16T14:30:00Z');
    const b = run(open, 12);
    expect(ivbAt(b.slice(2), M5, 30, open + 3_600_000)).toEqual({ kind: 'gap', open });
    expect(ivbAt([...b.slice(0, 3), ...b.slice(4)], M5, 30, open + 3_600_000)).toEqual({ kind: 'gap', open });
    expect(ivbAt([...b.slice(0, 6), ...b.slice(8)], M5, 30, open + 3_600_000).kind).toBe('ok');
  });

  it('nieznana długość okna (np. 45 z ręcznie zmienionego zapisu) liczy się jak domyślne 30 min', () => {
    const open = utc('2026-11-16T14:30:00Z');
    const s = ivbAt(run(open, 18), M5, 45, open + 3_600_000);
    expect(s).toMatchObject({ kind: 'ok', ivb: { end: open + 30 * MIN } });
  });

  it('obiekty na ekranie: w budowie sam prostokąt, po oknie prostokąt i dwie linie; najwyżej 3', () => {
    const open = utc('2026-11-16T14:30:00Z');
    const b = run(open, 18);
    const building = ivbAt(b, M5, 30, open + 12 * MIN);
    const done = ivbAt(b, M5, 30, open + 3_600_000);
    expect([ivbObjects(building), ivbObjects(done), IVB_OBJECTS_MAX]).toEqual([1, 3, 3]);
    expect(ivbObjects({ kind: 'outside', next: open })).toBe(0);
  });
});
