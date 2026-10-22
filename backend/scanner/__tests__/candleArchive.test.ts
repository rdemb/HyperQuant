import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CandleArchive, candleFile, fundingFile, parseArchCandles, parseFunding, type ArchInterval } from '../candleArchive.ts';
import type { InfoClient } from '../liqDetect.ts';

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;
const NOW = Date.UTC(2026, 9, 22, 14, 7, 30);
const IV: Record<ArchInterval, number> = { '1m': MIN, '1h': H, '1d': D };

/** Udawane API: świece od max(startTime, now − 5000·interwał) do bieżącej (niezamkniętej) włącznie; finansowanie co godzinę. */
function fakeRest(clock: () => number, fundingFrom: number) {
  const calls: { type: string; startTime: number }[] = [];
  const rest: InfoClient = {
    async info(body: unknown) {
      const b = body as { type: string; req?: { interval: ArchInterval; startTime: number; endTime?: number }; startTime?: number };
      const now = clock();
      if (b.type === 'candleSnapshot') {
        const iv = IV[b.req!.interval];
        calls.push({ type: `candle-${b.req!.interval}`, startTime: b.req!.startTime });
        const first = Math.max(Math.ceil(b.req!.startTime / iv) * iv, Math.floor(now / iv) * iv - 4999 * iv);
        const out = [];
        for (let t = first; t <= now; t += iv) {
          const c = 80000 + ((t / iv) % 97);
          out.push({ t, T: t + iv - 1, s: 'BTC', i: b.req!.interval, o: String(c - 1), c: String(c), h: String(c + 5), l: String(c - 6), v: '1.5', n: 12 });
        }
        return out;
      }
      if (b.type === 'fundingHistory') {
        calls.push({ type: 'funding', startTime: b.startTime! });
        const out = [];
        for (let t = Math.max(Math.ceil(b.startTime! / H) * H, Math.ceil(fundingFrom / H) * H); t <= now && out.length < 500; t += H) out.push({ coin: 'BTC', fundingRate: '0.0000125', premium: '-0.0002', time: t + 7 });
        return out;
      }
      return null;
    },
  };
  return { rest, calls };
}

describe('pliki archiwum', () => {
  it('ścieżki: 1m dziennie, 1h miesięcznie, 1d rocznie, finansowanie miesięcznie', () => {
    expect(candleFile('BTC', '1m', Date.UTC(2026, 9, 22, 13))).toBe('BTC/1m/2026/10-22.csv');
    expect(candleFile('BTC', '1h', Date.UTC(2026, 9, 22, 13))).toBe('BTC/1h/2026-10.csv');
    expect(candleFile('BTC', '1d', Date.UTC(2026, 9, 22))).toBe('BTC/1d/2026.csv');
    expect(fundingFile('BTC', Date.UTC(2026, 0, 3))).toBe('BTC/funding/2026-01.csv');
  });
  it('parsowanie: tylko zamknięte świece, rosnąco, bez duplikatów i nieliczb', () => {
    const raw = [
      { t: NOW - 2 * MIN - 30_000, o: '1', h: '2', l: '0.5', c: '1.5', v: '3', n: 4 },
      { t: NOW - 3 * MIN - 30_000, o: '1', h: '2', l: '0.5', c: '1.4', v: '3', n: 4 },
      { t: NOW - 3 * MIN - 30_000, o: '1', h: '2', l: '0.5', c: '1.4', v: '3', n: 4 },
      { t: NOW - 30_000, o: '1', h: '2', l: '0.5', c: '1.6', v: '3', n: 4 },
      { t: NOW - 5 * MIN, o: 'x', h: '2', l: '0.5', c: '1.6', v: '3', n: 4 },
    ];
    const bars = parseArchCandles(raw, MIN, NOW);
    expect(bars.map((b) => b.t)).toEqual([NOW - 3 * MIN - 30_000, NOW - 2 * MIN - 30_000]);
    expect(bars[0]).toMatchObject({ o: 1, h: 2, l: 0.5, c: 1.4, v: 3, n: 4 });
    expect(parseFunding([{ time: 5, fundingRate: '0.1', premium: '-0.2' }, { time: 'x' }])).toEqual([{ t: 5, rate: 0.1, premium: -0.2 }]);
  });
});

describe('CandleArchive', () => {
  it('zasiew, potem tylko nowe zamknięte świece; nagłówek raz; po restarcie ostatni czas z plików', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-arch-'));
    let now = NOW;
    const { rest, calls } = fakeRest(() => now, NOW - 3 * D);
    const a = new CandleArchive({ dir, coin: 'BTC', rest });
    const added = await a.tick(now);
    expect(added).toBeGreaterThan(5000);
    expect(a.last('1h')).toBe(Math.floor(NOW / H) * H - H);
    expect(a.last('1m')).toBe(Math.floor(NOW / MIN) * MIN - 2 * MIN); // ostatnia zamknięta ≥ 60 s temu
    expect(a.last('1d')).toBe(Math.floor(NOW / D) * D - D);
    const f = readFileSync(join(dir, 'BTC/1h/2026-10.csv'), 'utf8').split('\n');
    expect(f[0]).toBe('t,o,h,l,c,v,n');
    expect(f.filter((l) => l === 't,o,h,l,c,v,n')).toHaveLength(1);
    expect(a.lastFunding()).toBe(Math.floor(NOW / H) * H + 7);

    now = NOW + 70 * MIN;
    calls.length = 0;
    const b = new CandleArchive({ dir, coin: 'BTC', rest });
    expect(b.last('1h')).toBe(Math.floor(NOW / H) * H - H);
    const more = await b.tick(now);
    expect(more).toBe(70 + 1 + 1); // 70 minut, 1 godzina, 1 stawka finansowania
    expect(calls.find((c) => c.type === 'candle-1h')!.startTime).toBe(Math.floor(NOW / H) * H);
    const hours = b.read('1h');
    for (let i = 1; i < hours.length; i++) expect(hours[i].t - hours[i - 1].t).toBe(H);
    expect(b.read('1h', Math.floor(NOW / H) * H - 2 * H).length).toBe(3);
    expect(b.readFunding().at(-1)).toMatchObject({ rate: 0.0000125 });
  });
  it('finansowanie stronicowane: najwyżej `fundingPages` stron na przebieg, potem kontynuacja', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-arch-'));
    const { rest } = fakeRest(() => NOW, NOW - 1500 * H);
    const a = new CandleArchive({ dir, coin: 'BTC', rest, fundingPages: 2, fundingStart: NOW - 1500 * H });
    await a.tick(NOW);
    expect(a.readFunding()).toHaveLength(1000);
    await a.tick(NOW);
    expect(a.readFunding().length).toBeGreaterThan(1400);
    const ts = a.readFunding().map((r) => r.t);
    expect(new Set(ts).size).toBe(ts.length);
  });
  it('błąd API (null) nie psuje archiwum', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-arch-'));
    const a = new CandleArchive({ dir, coin: 'BTC', rest: { info: async () => null } });
    expect(await a.tick(NOW)).toBe(0);
    expect(a.last('1h')).toBeNull();
    expect(a.read('1h')).toEqual([]);
  });
});

describe('CandleArchive — odporność na ucięty zapis i złe wiersze', () => {
  it('ucięty ogon (w środku wiersza albo znacznika czasu) jest obcinany; po kolejnym przebiegu wiersze rosnące i unikalne', async () => {
    const { appendFileSync, readFileSync: rf } = await import('node:fs');
    for (const torn of ['17911', '1792677600000,80000,80005,79994,80000,1.5']) {
      const dir = mkdtempSync(join(tmpdir(), 'hq-arch-'));
      let now = NOW;
      const { rest } = fakeRest(() => now, NOW - 3 * D);
      await new CandleArchive({ dir, coin: 'BTC', rest }).tick(now);
      appendFileSync(join(dir, 'BTC/1h/2026-10.csv'), torn); // awaria w trakcie zapisu: brak końca linii
      now = NOW + 2 * H;
      const b = new CandleArchive({ dir, coin: 'BTC', rest });
      await b.tick(now);
      const hours = b.read('1h');
      for (let i = 1; i < hours.length; i++) expect(hours[i].t).toBeGreaterThan(hours[i - 1].t);
      expect(hours.every((x) => x.h < 1e6)).toBe(true);
      expect(rf(join(dir, 'BTC/1h/2026-10.csv'), 'utf8').endsWith('\n')).toBe(true);
    }
  });
  it('odczyt ścisły: zła liczba pól, high < low, czas nierosnący → wiersz pominięty', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const dir = mkdtempSync(join(tmpdir(), 'hq-arch-'));
    mkdirSync(join(dir, 'BTC/1h'), { recursive: true });
    writeFileSync(
      join(dir, 'BTC/1h/2026-10.csv'),
      ['t,o,h,l,c,v,n', '3600000,10,12,9,11,1,1', '7200000,10,9,12,11,1,1', '7200000,10,12,9,11,1,1', '3600000,10,12,9,11,1,1', '10800000,10,12,9,11,1', '14400000,10,12,9,11,1,1,5', '18000000,10,12,9,11,1,1', ''].join('\n')
    );
    const a = new CandleArchive({ dir, coin: 'BTC', rest: { info: async () => null } });
    expect(a.read('1h').map((x) => x.t)).toEqual([3600000, 7200000, 18000000]);
    expect(a.last('1h')).toBe(18000000);
  });
  it('świeca zapisywana dopiero 60 s po zamknięciu (API może ją jeszcze uzupełnić)', () => {
    const t = Math.floor(NOW / H) * H - H; // zamknięta o pełnej godzinie
    const raw = [{ t, o: '1', h: '2', l: '0.5', c: '1.5', v: '3', n: 4 }];
    expect(parseArchCandles(raw, H, t + H + 30_000)).toEqual([]);
    expect(parseArchCandles(raw, H, t + H + 61_000)).toHaveLength(1);
  });
});
