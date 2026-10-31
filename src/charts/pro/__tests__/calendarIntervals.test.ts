import { afterEach, describe, expect, it, vi } from 'vitest';
import { MONTH, aggregateCandles, barEnd, barStart, fmtBarTime, intervalById } from '../core/time';
import { HlStream } from '../hl/stream';
import { ProStore } from '../store/proStore';

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const utc = (y: number, m: number, d: number, h = 0) => Date.UTC(y, m - 1, d, h);

describe('granice świec 1W i 1M', () => {
  it('tydzień od poniedziałku 00:00 UTC', () => {
    // 29.10.2026 to czwartek, poniedziałek tego tygodnia to 26.10
    expect(barStart(utc(2026, 10, 29, 15), WEEK)).toBe(utc(2026, 10, 26));
    expect(barStart(utc(2026, 10, 26), WEEK)).toBe(utc(2026, 10, 26));
    expect(barStart(utc(2026, 10, 25, 23), WEEK)).toBe(utc(2026, 10, 19));
    expect(barEnd(utc(2026, 10, 26), WEEK)).toBe(utc(2026, 11, 2));
  });

  it('miesiąc kalendarza UTC, także luty i przełom roku', () => {
    expect(intervalById('1M').ms).toBe(MONTH);
    expect(barStart(utc(2026, 10, 31, 23), MONTH)).toBe(utc(2026, 10, 1));
    expect(barEnd(utc(2026, 10, 1), MONTH)).toBe(utc(2026, 11, 1));
    expect(barEnd(utc(2028, 2, 1), MONTH)).toBe(utc(2028, 3, 1));
    expect(barEnd(utc(2026, 12, 1), MONTH)).toBe(utc(2027, 1, 1));
  });

  it('krótsze interwały bez zmian', () => {
    expect(barStart(utc(2026, 10, 29, 15) + 123, DAY)).toBe(utc(2026, 10, 29));
    expect(barEnd(utc(2026, 10, 29), DAY)).toBe(utc(2026, 10, 30));
  });

  it('składanie świec: OHLC, suma wolumenu i transakcji', () => {
    const d = (t: number, o: number, h: number, l: number, c: number) => ({ t, o, h, l, c, v: 2, n: 3 });
    const out = aggregateCandles([d(utc(2026, 10, 24), 1, 5, 0.5, 2), d(utc(2026, 10, 25), 2, 3, 1, 2.5), d(utc(2026, 10, 26), 2.5, 9, 2, 8), d(utc(2026, 10, 27), 8, 8, 6, 7)], WEEK);
    expect(out).toEqual([
      { t: utc(2026, 10, 19), o: 1, h: 5, l: 0.5, c: 2.5, v: 4, n: 6 },
      { t: utc(2026, 10, 26), o: 2.5, h: 9, l: 2, c: 7, v: 4, n: 6 },
    ]);
  });

  it('etykieta świecy miesiąca: nazwa miesiąca i rok (UTC)', () => {
    expect(fmtBarTime(utc(2026, 10, 1), MONTH)).toBe('paź 2026');
    expect(fmtBarTime(utc(2027, 1, 1), MONTH)).toBe('sty 2027');
  });
});

class FakeWs {
  static last: FakeWs | null = null;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeWs.last = this;
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  msg(o: unknown) {
    this.onmessage?.({ data: JSON.stringify(o) });
  }
}

const daily = (t: number, o: number, c: number, v = 1) => ({ t, T: t + DAY - 1, s: 'BTC', i: '1d', o: String(o), c: String(c), h: String(Math.max(o, c) + 10), l: String(Math.min(o, c) - 10), v: String(v), n: 5 });

describe('seria 1W i 1M ze świec 1D', () => {
  let store: ProStore;
  const asked: string[] = [];

  afterEach(() => {
    store.stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    asked.length = 0;
  });

  function boot(now: number, days: unknown[]) {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body);
        if (body.type === 'candleSnapshot') asked.push(`${body.req.interval}@${new Date(body.req.startTime).toISOString().slice(0, 10)}`);
        return { ok: true, json: async () => (body.type === 'candleSnapshot' ? days : null) };
      })
    );
    store = new ProStore(new HlStream({ wsFactory: () => new FakeWs() as unknown as WebSocket, now: () => Date.now() }));
  }

  it('tydzień składa się ze świec 1D od poniedziałku, a świeca 1D ze strumienia przelicza bieżący tydzień', async () => {
    const now = utc(2026, 10, 28, 12);
    // Sobota 24.10 i niedziela 25.10 (poprzedni tydzień), poniedziałek 26.10 do środy 28.10 (bieżący)
    boot(now, [daily(utc(2026, 10, 24), 100, 110), daily(utc(2026, 10, 25), 110, 105), daily(utc(2026, 10, 26), 105, 120), daily(utc(2026, 10, 27), 120, 118), daily(utc(2026, 10, 28), 118, 125)]);
    const s = store.series('1w');
    store.start();
    FakeWs.last!.open();
    await vi.waitFor(() => expect(s.loadState).toBe('ready'));
    // Pytanie o świece 1D od poniedziałku tygodnia, w którym zaczyna się zakres
    expect(asked.every((a) => a.startsWith('1d@'))).toBe(true);
    expect(new Date(asked[0].slice(3)).getUTCDay()).toBe(1);
    // Subskrypcja strumienia świec 1D zamiast 1W
    const subs = FakeWs.last!.sent.map((x) => JSON.parse(x).subscription).filter((x) => x?.type === 'candle');
    expect(subs.map((x) => x.interval)).toEqual(['1d']);
    expect(s.candles.map((c) => c.t)).toEqual([utc(2026, 10, 19), utc(2026, 10, 26)]);
    expect(s.candles[1]).toMatchObject({ o: 105, c: 125, h: 135, l: 95, v: 3, n: 15 });
    // Środa rośnie do 140: tydzień ma nowe zamknięcie i maksimum, poprzedni bez zmian
    const prev = s.candles[0];
    FakeWs.last!.msg({ channel: 'candle', data: daily(utc(2026, 10, 28), 118, 140) });
    expect(s.candles[1]).toMatchObject({ o: 105, c: 140, h: 150 });
    expect(s.candles[0]).toBe(prev);
    // Bez footprintu w świecy tygodnia
    expect(s.bars().every((b) => b.fp === null)).toBe(true);
  });

  it('miesiąc kalendarza: świece 1D z przełomu miesiąca trafiają do dwóch świec', async () => {
    const now = utc(2026, 11, 2, 9);
    boot(now, [daily(utc(2026, 10, 30), 100, 101), daily(utc(2026, 10, 31), 101, 99), daily(utc(2026, 11, 1), 99, 98), daily(utc(2026, 11, 2), 98, 97)]);
    const s = store.series('1M');
    store.start();
    FakeWs.last!.open();
    await vi.waitFor(() => expect(s.loadState).toBe('ready'));
    expect(s.candles.map((c) => c.t)).toEqual([utc(2026, 10, 1), utc(2026, 11, 1)]);
    expect(s.candles[0]).toMatchObject({ o: 100, c: 99 });
    expect(s.candles[1]).toMatchObject({ o: 99, c: 97 });
  });
});
