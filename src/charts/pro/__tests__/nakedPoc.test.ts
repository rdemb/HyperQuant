import { describe, expect, it } from 'vitest';
import { ARCHIVE_1M_FROM, NAKED_SHOWN, nakedPocs, pocBadge, pocSource } from '../core/nakedPoc';
import { VALUE_BIN_BP, type ValueBar, toFiveMinutes, valueReference } from '../core/valueReference';
import { ArchiveMinutes, archiveMinutePath, parseArchiveMinutes } from '../store/archiveMinutes';

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
/** 16.11.2026 15:00 UTC: 20 dób wstecz (27.10) jest w archiwum 1m, 60 dób wstecz (17.09) — przed nim. */
const TODAY = Date.UTC(2026, 10, 16);
const NOW = TODAY + 15 * H;

/** Świece interwału `ms` doby `d` w zakresie [lo, hi] z jednym skupiskiem wolumenu przy `poc` (w połowie doby). */
function day(d: number, ms: number, lo: number, hi: number, poc?: number): ValueBar[] {
  const n = DAY / ms;
  return Array.from({ length: n }, (_, k) => {
    const t = d + k * ms;
    if (poc !== undefined && k === Math.floor(n / 2)) return { t, l: poc - 4, h: poc + 4, v: 5000 * (ms / (5 * MIN)) };
    return { t, l: lo, h: hi, v: ms / (5 * MIN) };
  });
}

/** Świece 1h `n` dób przed dziś (płasko 100 000 ± 100) z podmienionymi dobami i dzisiejsze do NOW. */
function hours(n: number, special: Record<number, ValueBar[]> = {}): ValueBar[] {
  const out: ValueBar[] = [];
  for (let age = n; age >= 1; age--) out.push(...(special[age] ?? day(TODAY - age * DAY, H, 99_900, 100_100)));
  for (let t = TODAY; t < NOW; t += H) out.push({ t, l: 99_850, h: 100_150, v: 1 });
  return out;
}

const value = (bars: ValueBar[]) => ({ bars, ms: 5 * MIN });
/** Świece 1h z minut. */
const toHours = (ones: readonly ValueBar[]): ValueBar[] => {
  const out: ValueBar[] = [];
  for (const b of ones) {
    const t = Math.floor(b.t / H) * H;
    const last = out[out.length - 1];
    if (last && last.t === t) {
      last.l = Math.min(last.l, b.l);
      last.h = Math.max(last.h, b.h);
      last.v += b.v;
    } else out.push({ ...b, t });
  }
  return out;
};
/** Świece 5m ostatnich 14 dób (płasko) i dziś. */
const fives = (special: Record<number, ValueBar[]> = {}): ValueBar[] => {
  const out: ValueBar[] = [];
  for (let age = 14; age >= 1; age--) out.push(...(special[age] ?? day(TODAY - age * DAY, 5 * MIN, 99_900, 100_100)));
  for (let t = TODAY; t + 5 * MIN <= NOW; t += 5 * MIN) out.push({ t, l: 99_850, h: 100_150, v: 1 });
  return out;
};

describe('nagie POC warstwami według wieku doby', () => {
  it('do 14 dób jedno źródło wartości; od 15 dób archiwum 1m (od 19.10.2026); starsze świece 1h — każdy z plakietką źródła i wiekiem', () => {
    // Doby z POC daleko od ceny (nietknięte): 3 doby (5m), 20 dób (archiwum 1m), 60 dób (przed archiwum — 1h)
    const d3 = day(TODAY - 3 * DAY, 5 * MIN, 101_900, 102_100, 102_000);
    const d20m = day(TODAY - 20 * DAY, MIN, 97_900, 98_100, 98_000);
    const asked: number[] = [];
    const r = nakedPocs({
      now: NOW,
      price: 100_000,
      value: value(fives({ 3: d3 })),
      hours: hours(200, {
        3: day(TODAY - 3 * DAY, H, 101_900, 102_100),
        20: day(TODAY - 20 * DAY, H, 97_900, 98_100),
        60: day(TODAY - 60 * DAY, H, 103_900, 104_100, 104_000),
      }),
      minuteDay: (d) => {
        asked.push(d);
        return d === TODAY - 20 * DAY ? d20m : null;
      },
    });
    if ('why' in r) throw new Error(r.why);
    expect(r.list.map((p) => [p.age, p.layer, pocBadge(p)])).toEqual([
      [3, 'value', 'MODEL'],
      [20, '1m', 'MODEL'],
      [60, '1h', 'MODEL'],
    ]);
    expect(r.list.map(pocSource)).toEqual(['przybliżenie, taśma 0%', 'przybliżenie ze świec 1m (archiwum)', 'przybliżenie z 1h']);
    // Skupisko jednej minuty rozmywa się w świecy 5m złożonej z minut: POC blisko 98 000, nie co do koszyka
    expect(Math.abs(r.list[1].px / 98_000 - 1)).toBeLessThan(1e-3);
    // Archiwum pobierane tylko dla dób, których zakres nie został potem objęty (tu tylko 20 dób wstecz) i nie sprzed 19.10
    expect(asked).toEqual([TODAY - 20 * DAY]);
    expect(asked.every((d) => d >= ARCHIVE_1M_FROM)).toBe(true);
  });

  it('archiwum 1m w drodze: doba czeka (bez POC z innego źródła), licznik dób w drodze', () => {
    const r = nakedPocs({
      now: NOW,
      price: 100_000,
      value: value(fives()),
      hours: hours(200, { 20: day(TODAY - 20 * DAY, H, 97_900, 98_100, 98_000), 60: day(TODAY - 60 * DAY, H, 103_900, 104_100, 104_000) }),
      minuteDay: () => undefined,
    });
    if ('why' in r) throw new Error(r.why);
    expect(r.pending).toBe(1);
    expect(r.list.map((p) => p.age)).toEqual([60]);
  });

  it('z taśmą (≥ 90% wolumenu) POC do 14 dób jest LIVE; rynek bez archiwum 1m — starsze doby ze świec 1h', () => {
    const d2 = day(TODAY - 2 * DAY, 5 * MIN, 101_900, 102_100, 102_000).map((b) => ({ ...b, tape: { tick: 1, lo: 102_000, buy: [b.v / 2], sell: [b.v / 2] } }));
    const r = nakedPocs({ now: NOW, price: 100_000, value: value(fives({ 2: d2 })), hours: hours(200, { 2: day(TODAY - 2 * DAY, H, 101_900, 102_100), 20: day(TODAY - 20 * DAY, H, 97_900, 98_100, 98_000) }) });
    if ('why' in r) throw new Error(r.why);
    expect(r.list.map((p) => [p.age, p.layer, pocBadge(p)])).toEqual([
      [2, 'value', 'LIVE'],
      [20, '1h', 'MODEL'],
    ]);
  });

  it(`najwyżej ${NAKED_SHOWN} najbliższych cenie; bez nagich — powód z liczbą dób`, () => {
    const special: Record<number, ValueBar[]> = {};
    for (let i = 0; i < 9; i++) special[20 + i] = day(TODAY - (20 + i) * DAY, H, 105_000 + 1000 * i - 100, 105_000 + 1000 * i + 100, 105_000 + 1000 * i);
    const r = nakedPocs({ now: NOW, price: 100_000, value: value(fives()), hours: hours(200, special) });
    if ('why' in r) throw new Error(r.why);
    expect(r.list).toHaveLength(NAKED_SHOWN);
    expect(r.list.map((p) => p.age)).toEqual([20, 21, 22, 23, 24, 25]);
    expect(nakedPocs({ now: NOW, price: 100_000, value: value(fives()), hours: hours(30) })).toMatchObject({ why: expect.stringMatching(/^Brak nagiego POC w \d+ dobach$/) });
  });

  it('ta sama doba z archiwum 1m (warstwa 1m) i ze świec 5m tej doby: POC w granicach ±1 koszyka (5 pb), tu identyczny', () => {
    // Doba 1m z falującą ceną i skupiskiem wolumenu w kilku godzinach, 20 dób wstecz (warstwa archiwum)
    const d = TODAY - 20 * DAY;
    const ones: ValueBar[] = [];
    for (let k = 0; k < 1440; k++) {
      const c = 103_000 + 250 * Math.sin(k / 90) + 40 * Math.sin(k / 7);
      ones.push({ t: d + k * MIN, l: c - 12 - (k % 5), h: c + 12 + (k % 3), v: 1 + (k % 11) + (k > 600 && k < 800 ? 6 : 0) });
    }
    // Świece 5m tej doby jak z Hyperliquid (złożone z tych samych minut)
    const five = toFiveMinutes(ones);
    const r = nakedPocs({
      now: NOW,
      price: 100_000,
      value: value(fives()),
      hours: hours(200, { 20: toHours(ones) }),
      minuteDay: (x) => (x === d ? ones : null),
    });
    if ('why' in r) throw new Error(r.why);
    const p = r.list.find((x) => x.day === d)!;
    expect(p.layer).toBe('1m');
    const b = valueReference('day', d, { bars: five, ms: 5 * MIN }, NOW)!;
    const bins = Math.abs(Math.log(p.px / b.poc)) / (VALUE_BIN_BP / 1e4);
    expect(bins).toBeLessThanOrEqual(1);
    expect(p.ref).toMatchObject({ poc: b.poc, vah: b.vah, val: b.val });
  });
});

describe('archiwum świec 1m skanera', () => {
  const D = Date.UTC(2026, 9, 27);
  const csv = ['t,o,h,l,c,v,n', `${D},100,101,99,100,2.5,10`, `${D + MIN},100,102,98,101,1,4`, 'zepsuty,wiersz', `${D + DAY},1,1,1,1,1,1`].join('\n');

  it('ścieżka pliku doby i parsowanie CSV (wiersze z błędem i spoza doby pominięte)', () => {
    expect(archiveMinutePath(D)).toBe('BTC/1m/2026/10-27.csv');
    expect(parseArchiveMinutes(csv, D)).toEqual([
      { t: D, l: 99, h: 101, v: 2.5 },
      { t: D + MIN, l: 98, h: 102, v: 1 },
    ]);
  });

  it('pobranie raz na dobę; 404 — brak pliku (null); błąd sieci — null do ponownej próby', async () => {
    const calls: string[] = [];
    let now = 0;
    const a = new ArchiveMinutes(
      'https://dane/archive',
      async (url) => {
        calls.push(url);
        if (url.endsWith('10-27.csv')) return new Response(csv, { status: 200 });
        if (url.endsWith('10-28.csv')) return new Response('', { status: 404 });
        throw new Error('sieć');
      },
      () => now
    );
    expect(a.get(D)).toBeUndefined();
    expect(a.get(D + DAY)).toBeUndefined();
    expect(a.get(D + 2 * DAY)).toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(a.get(D)).toHaveLength(2);
    expect(a.get(D + DAY)).toBeNull();
    expect(a.get(D + 2 * DAY)).toBeNull();
    expect(calls).toEqual(['https://dane/archive/BTC/1m/2026/10-27.csv', 'https://dane/archive/BTC/1m/2026/10-28.csv', 'https://dane/archive/BTC/1m/2026/10-29.csv']);
    // Po minucie od błędu — ponowna próba
    now = 61_000;
    expect(a.get(D + 2 * DAY)).toBeUndefined();
    expect(new ArchiveMinutes('').get(D)).toBeNull();
  });
});
