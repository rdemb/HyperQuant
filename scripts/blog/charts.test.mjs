import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { anchoredVwap, buildCharts, decodeTape, mergeSpans, openSource, readCharts, volumeProfile } from './chartdata.mjs';
import { diagonalImbalances, footprintHtml, footprintSvg, mergeCandles, sessionHtml, sessionSvg, sessionTitle, spreadLabels } from './charts.mjs';
import { loadPostFile, validateCharts } from './posts.mjs';
import { postBody } from './render.mjs';

const MIN = 60_000;
const HOUR = 60 * MIN;
const AT = Date.parse('2026-10-25T06:00:00Z');
const DAY0 = Date.parse('2026-10-24T00:00:00Z');
const ARCHIVE_END = Date.parse('2026-10-25T05:00:00Z');
const TAPE_FROM = Date.parse('2026-10-25T03:00:00Z');
const px = (t) => Math.round(80000 + 600 * Math.sin((t - DAY0) / (300 * MIN)));
const pad = (x) => String(x).padStart(2, '0');

/** Repozytorium danych w katalogu: archiwum 1m (z opóźnieniem), taśma z trzech ostatnich godzin, taśma likwidacji. */
function fakeSource() {
  const dir = mkdtempSync(path.join(tmpdir(), 'hq-data-'));
  const csv = new Map();
  for (let t = DAY0; t < ARCHIVE_END; t += MIN) {
    const d = new Date(t);
    const key = `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const o = px(t);
    const c = px(t + MIN);
    if (!csv.has(key)) csv.set(key, ['t,o,h,l,c,v,n']);
    csv.get(key).push([t, o, Math.max(o, c) + 5, Math.min(o, c) - 5, c, 10, 50].join(','));
  }
  mkdirSync(path.join(dir, 'archive/BTC/1m/2026'), { recursive: true });
  for (const [k, rows] of csv) writeFileSync(path.join(dir, `archive/BTC/1m/2026/${k}.csv`), rows.join('\n'));

  const hours = [0, 1, 2].map((i) => TAPE_FROM + i * HOUR);
  mkdirSync(path.join(dir, 'history/BTC/2026-10-25'), { recursive: true });
  writeFileSync(path.join(dir, 'history/index.json'), JSON.stringify({ v: 1, asOf: AT, keepDays: 7, partMs: 300000, markets: { BTC: { hours, parts: [] } } }));
  for (const h of hours) {
    const ts = [];
    for (let t = h; t < h + HOUR; t += 10_000) ts.push(t);
    const file = {
      v: 1,
      coin: 'BTC',
      from: h,
      to: h + HOUR,
      spans:
        h === hours[1]
          ? [
              [h, h + 20 * MIN],
              [h + 20 * MIN + 5000, h + HOUR],
            ]
          : [[h, h + HOUR]],
      t: ts.map((t, i) => (i ? t - ts[i - 1] : t)),
      px: ts.map(px),
      sz: ts.map((t, i) => (i % 7 === 0 ? 0 : 1 + (i % 3))),
      side: ts.map((t, i) => (i % 3 === 0 ? 'A' : 'B')).join(''),
      tid: ts.map((t, i) => (i ? 1 : 1000)),
      o: ts.map(() => -1),
      k: ts.map(() => -1),
      m: ts.map(() => -1),
      ctx: {
        t: [...Array(60)].map((_, i) => h + i * MIN),
        oi: [...Array(60)].map((_, i) => 40000 + (h - TAPE_FROM) / MIN + i),
        funding: Array(60).fill(0),
        mark: Array(60).fill(80000),
      },
    };
    writeFileSync(path.join(dir, `history/BTC/2026-10-25/${pad(new Date(h).getUTCHours())}.trades.json.gz`), gzipSync(JSON.stringify(file)));
  }
  mkdirSync(path.join(dir, 'main/liq-tape'), { recursive: true });
  writeFileSync(
    path.join(dir, 'main/liq-tape/BTC.json'),
    JSON.stringify({
      v: 1,
      buckets: [
        { t: Date.parse('2026-10-24T14:05:00Z'), longUsd: 12e6, shortUsd: 0 },
        { t: Date.parse('2026-10-24T14:10:00Z'), longUsd: 3e6, shortUsd: 1e6 },
      ],
    })
  );
  return dir;
}

describe('wykresy: dane (chartdata.mjs)', () => {
  it('taśma: czas różnicowo, strona agresora, transakcje z zerową wielkością pominięte', () => {
    const tape = decodeTape({ v: 1, t: [1000, 5, 5], px: [10, 11, 0], sz: [1, 2, 3], side: 'BAB', spans: [[1000, 2000]], ctx: { t: [1000], oi: [7] } });
    expect(tape.trades).toEqual([
      { t: 1000, px: 10, sz: 1, buy: true },
      { t: 1005, px: 11, sz: 2, buy: false },
    ]);
    expect(tape.ctx).toEqual([{ t: 1000, oi: 7 }]);
    expect(decodeTape({ v: 2 })).toBeNull();
  });

  it('VWAP od kotwicy z odchyleniem ważonym wolumenem; przerwy nagrania do 30 s scalone', () => {
    const flat = [0, 1, 2].map((i) => ({ t: DAY0 + i * MIN, o: 100, h: 100, l: 100, c: 100, v: 2 }));
    expect(anchoredVwap(flat, DAY0, 3 * MIN)).toEqual([[DAY0, 100, 0]]);
    const two = [
      { t: DAY0, o: 90, h: 90, l: 90, c: 90, v: 1 },
      { t: DAY0 + MIN, o: 110, h: 110, l: 110, c: 110, v: 1 },
    ];
    expect(anchoredVwap(two, DAY0, 2 * MIN)).toEqual([[DAY0, 100, 10]]);
    expect(
      mergeSpans([
        [0, 10_000],
        [30_000, 50_000],
        [100_000, 120_000],
      ])
    ).toEqual([
      [0, 50_000],
      [100_000, 120_000],
    ]);
  });

  it('profil: POC w najcięższym przedziale, obszar wartości rośnie od POC do 70% wolumenu', () => {
    const c = (l, h, v) => ({ t: 0, o: l, h, l, c: h, v });
    const p = volumeProfile([c(100, 124, 10), c(125, 149, 50), c(150, 174, 20), c(175, 199, 20)], 25);
    expect(p.poc).toBe(125);
    expect([p.val, p.vah]).toEqual([125, 175]);
    expect(p.vol).toEqual([10, 50, 20, 20]);
  });

  it('buduje okno 24 h: świece, delta tylko z taśmy, VWAP od północy UTC, poziomy wczoraj, OI, likwidacje, footprint', async () => {
    const d = await buildCharts({ at: AT + 7 * MIN, get: openSource(fakeSource()) });
    expect(validateCharts(d)).toEqual([]);
    const s = d.session;
    expect([s.from, s.to, s.candles.length]).toEqual([AT - 24 * HOUR, AT, 96]);
    // Archiwum kończy się o 05:00, ostatnia godzina pochodzi z taśmy; delta tylko tam, gdzie taśma jest pełna
    expect(s.candles.at(-1)[0]).toBe(AT - 15 * MIN);
    expect(s.candles.filter((c) => c[6] !== null).map((c) => c[0])[0]).toBe(TAPE_FROM);
    expect(s.candles.find((c) => c[0] === TAPE_FROM - 15 * MIN)[6]).toBeNull();
    expect(s.tape).toEqual([[TAPE_FROM, AT]]);
    expect(s.vwap[0][0]).toBe(Date.parse('2026-10-25T00:00:00Z'));
    expect(s.levels.map((l) => l.label)).toEqual(['PDH', 'PDL']);
    expect(s.oi.length).toBe(12);
    expect(s.liq).toEqual([[Date.parse('2026-10-24T14:00:00Z'), 15, 1]]);
    expect(d.footprint.bars.map((b) => b.t)).toEqual([...Array(8)].map((_, i) => AT - 2 * HOUR + i * 15 * MIN));
    expect(d.footprint.bars[0].oi).toBe(15);
    const read = readCharts(d);
    expect(read.wartosc.poc).toBe(s.profile.poc);
    expect(read.footprint.swiece).toHaveLength(8);
  });

  it('footprint z wybranej chwili (--fp)', async () => {
    const d = await buildCharts({ at: AT, fpFrom: TAPE_FROM + 5 * MIN, get: openSource(fakeSource()) });
    expect(d.footprint.bars[0].t).toBe(TAPE_FROM);
  });

  it('notka (--notka): 6 godzin w świecach 5 min, bez footprintu, odczyt w tych samych godzinach', async () => {
    const d = await buildCharts({ at: AT + 2 * MIN, note: true, get: openSource(fakeSource()) });
    expect(validateCharts(d)).toEqual([]);
    const s = d.session;
    expect([s.tf, s.from, s.to, s.candles.length]).toEqual([5, AT - 6 * HOUR, AT, 72]);
    expect(d.footprint).toBeNull();
    expect(s.candles.filter((c) => c[6] !== null).map((c) => c[0])[0]).toBe(TAPE_FROM);
    expect(s.oi.length).toBe(36);
    const read = readCharts(d);
    expect(read.zakres6h.max).toBeGreaterThan(read.zakres6h.min);
    expect(read.delta.h1).toBe(Math.round(10 * s.candles.slice(-12).reduce((a, c) => a + c[6] - c[7], 0)) / 10);
    expect(read.footprint).toBeUndefined();
    expect(read.wartosc).toBeUndefined();
  });

  it('okno bez świec (chwila z przyszłości) to czytelny błąd', async () => {
    await expect(buildCharts({ at: AT + 24 * HOUR, note: true, get: openSource(fakeSource()) })).rejects.toThrow(/Za mało świec w oknie .* \(0\)/);
  });
});

const SESSION = {
  tf: 15,
  from: AT - 24 * HOUR,
  to: AT,
  dayStart: AT - 6 * HOUR,
  tape: [[AT - 3 * HOUR, AT]],
  candles: [...Array(96)].map((_, i) => {
    const t = AT - 24 * HOUR + i * 15 * MIN;
    const o = px(t);
    const c = px(t + 15 * MIN);
    const taped = t >= AT - 3 * HOUR;
    return [t, o, Math.max(o, c) + 20, Math.min(o, c) - 20, c, 100, taped ? 60 : null, taped ? 40 : null];
  }),
  vwap: [...Array(24)].map((_, i) => [AT - 6 * HOUR + i * 15 * MIN, 80000, 150]),
  profile: { step: 25, from: 79300, vol: [...Array(56)].map((_, i) => 10 + (i % 9)), poc: 80000, val: 79800, vah: 80250 },
  levels: [
    { label: 'PDH', price: 82500 },
    { label: 'PDL', price: 79500 },
  ],
  oi: [...Array(12)].map((_, i) => [AT - 3 * HOUR + i * 15 * MIN, 40000 + i * 10]),
  liq: [[AT - 10 * HOUR, 12, 0]],
};
const FP = {
  tf: 15,
  step: 25,
  bars: [0, 1].map((i) => ({
    t: AT - 30 * MIN + i * 15 * MIN,
    ohlc: [80000, 80100, 79950, 80050],
    oi: i ? -12.5 : null,
    cells: [
      [80100, 1, 30],
      [80075, 2, 2],
      [80050, 9, 3],
      [80025, 4, 4],
      [80000, 1, 1],
      [79975, 0, 2],
      [79950, 5, 0.5],
    ],
  })),
};

describe('wykresy: rysunek (charts.mjs)', () => {
  it('etykiety osi rozsunięte o odstęp i w granicach panelu', () => {
    const out = spreadLabels([{ y: 50 }, { y: 52 }, { y: 54 }, { y: 199 }], 12, 10, 200);
    const ys = out.map((o) => o.ly);
    ys.slice(1).forEach((y, i) => expect(y - ys[i]).toBeGreaterThanOrEqual(12));
    expect(Math.max(...ys)).toBeLessThanOrEqual(200);
  });

  it('świece 30 min w układzie wąskim; brak delty w części świecy to brak delty całej', () => {
    const c = [
      [0, 10, 12, 9, 11, 5, 3, 2],
      [15 * MIN, 11, 14, 10, 13, 5, null, null],
      [30 * MIN, 13, 13, 12, 12, 1, 1, 0],
    ];
    expect(mergeCandles(c, 2)).toEqual([
      [0, 10, 14, 9, 13, 10, null, null],
      [30 * MIN, 13, 13, 12, 12, 1, 1, 0],
    ]);
  });

  it('nierównowagi po przekątnej 3:1, szum poniżej 10% największej komórki pominięty', () => {
    const imb = diagonalImbalances(FP.bars[0].cells, 25);
    expect([...imb.buy]).toEqual([80100, 80025]);
    expect([...imb.sell]).toEqual([80050]);
  });

  it('mapa sesji i footprint: dwa układy, bez NaN, strefy, kreskowanie poza taśmą, poziomy poza zakresem', () => {
    const zones = [{ bias: 'up', zone: [80300, 80400] }];
    const wide = sessionSvg(SESSION, { zones, label: 'Mapa' });
    const narrow = sessionSvg(SESSION, { zones, narrow: true, uid: 'n' });
    expect(wide).toContain('viewBox="0 0 728');
    expect(narrow).toContain('viewBox="0 0 380');
    for (const svg of [wide, narrow, footprintSvg(FP), footprintSvg(FP, { narrow: true })]) expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    expect(wide).toContain('▲ 80 300–80 400');
    expect(wide).toContain('brak taśmy');
    expect(wide).toContain('PDH 82 500 ↑');
    expect(wide).toContain('12 mln USD');
    expect(footprintSvg(FP)).toContain('>−13<');
    expect(sessionHtml(SESSION, [{ bias: 'down', zone: [79600, 79700] }])).toMatch(/class="chart chart--w"[\s\S]*class="chart chart--n"/);
  });

  it('CVD liczone ze świec bazowych: ten sam wynik w obu układach, gdy część świecy 30 min jest bez delty', () => {
    // Ostatnia świeca bez taśmy (nagranie skończyło się przed jej końcem): 11 świec po +20
    const s = { ...SESSION, candles: SESSION.candles.map((c, i) => (i === 95 ? [...c.slice(0, 6), null, null] : c)) };
    const cvdLabel = (svg) => svg.match(/fill="#3fc6dd" text-anchor="start" dominant-baseline="middle" font-family="[^"]*">([^<]+)</)[1];
    expect(cvdLabel(sessionSvg(s))).toBe('+220');
    expect(cvdLabel(sessionSvg(s, { narrow: true, uid: 'n' }))).toBe('+220');
  });

  it('footprint: brakująca świeca w środku zakresu podana w przypisie', () => {
    expect(footprintHtml(FP)).not.toContain('Brak świec');
    const gap = { ...FP, bars: [FP.bars[0], { ...FP.bars[1], t: FP.bars[1].t + 15 * MIN }] };
    expect(footprintHtml(gap)).toMatch(/Brak świecy \d\d:\d\d \(przerwa w nagraniu taśmy\)\.<\/p>/);
  });

  it('notka: bez profilu i OI, poziomy wpisu podpisane przy osi, najbliższy poza zakresem ze strzałką', () => {
    const note = { ...SESSION, tf: 5, from: AT - 6 * HOUR, candles: SESSION.candles.slice(-72).map((c, i) => [AT - 6 * HOUR + i * 5 * MIN, ...c.slice(1)]) };
    const levels = [
      { label: 'Szczyt odbicia z wczoraj', price: 80100 },
      { label: 'PDH', price: 82500 },
      { label: 'Dołek', price: 70000 },
    ];
    const wide = sessionSvg(note, { levels });
    const narrow = sessionSvg(note, { levels, narrow: true, uid: 'n' });
    for (const svg of [wide, narrow]) expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    expect(wide).not.toContain('#9085e9');
    expect(wide).toContain('<title>Szczyt odbicia z wczoraj 80\u00a0100</title>');
    expect(wide).toContain('↑ PDH');
    expect(wide).toContain('↓ Dołek');
    expect(narrow).toMatch(/Szczyt odb[^<]*…/);
    expect(sessionTitle(note)).toBe('Ostatnie 6 godzin');
    expect(sessionHtml(note, [], levels)).toContain('poziomy z wpisu');
    expect(sessionHtml(note, [], levels)).toContain('świece 5 min (na telefonie 10 min)');
    // Legenda i przypis o kołach likwidacji tylko wtedy, gdy jakieś koło jest na rysunku
    expect(sessionHtml(note, [], levels)).toContain('likwidacje longów i shortów');
    const quiet = sessionHtml({ ...note, liq: [[AT - HOUR, 0.2, 0.1]] }, [], levels);
    expect(quiet).not.toContain('likwidacje longów i shortów');
    expect(quiet).toContain('nie było likwidacji od 0,5 mln USD');
  });
});

describe('wykresy: wpis', () => {
  const BODY = `## Analiza wykresu\n\n[[wykres]]\n\n${'Cena wróciła do obszaru wartości, a odbicie niosło zamykanie shortów przy spadającym open interest. '.repeat(12)}\n\n[[footprint]]\n`;
  const FM = `---\ntitle: "Mapa dnia"\ndescription: "BTC-PERP wrócił do obszaru wartości po wybiciu dołka; wykres sesji i footprint kluczowego miejsca."\ndate: 2026-10-25T08:05:00+01:00\ntype: article\nsection: Mapa dnia\nprice: 80050\n---\n`;
  const write = (charts) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hq-blog-'));
    const id = '2026-10-25-mapa-dnia';
    writeFileSync(path.join(dir, `${id}.md`), FM + BODY);
    if (charts) {
      mkdirSync(path.join(dir, id));
      writeFileSync(path.join(dir, id, 'wykresy.json'), typeof charts === 'string' ? charts : JSON.stringify(charts));
    }
    return path.join(dir, `${id}.md`);
  };

  it('wykresy.json z katalogu wpisu trafia w miejsca znaczników', () => {
    const { post, errors } = loadPostFile(write({ v: 1, session: SESSION, footprint: FP }));
    expect(errors).toEqual([]);
    const { top, prose } = postBody(post);
    expect(top).toBe('');
    expect(prose).toMatch(/<figure class="block block--inline block--wykres"><figcaption>Mapa sesji: ostatnie 24 godziny<\/figcaption>/);
    expect(prose).toMatch(/<figure class="block block--inline block--footprint"><figcaption>Footprint /);
  });

  it('znacznik bez danych, zły JSON i zły kształt danych to błędy wpisu', () => {
    expect(loadPostFile(write(null)).errors.join('\n')).toMatch(/\[\[wykres\]\] bez danych \(session w content\/blog\/2026-10-25-mapa-dnia\/wykresy\.json\)/);
    expect(loadPostFile(write('{')).errors.join('\n')).toMatch(/wykresy\.json: błąd JSON/);
    expect(loadPostFile(write({ v: 1, session: { ...SESSION, candles: [[1, 2]] }, footprint: FP })).errors.join('\n')).toMatch(/session\.candles/);
    expect(validateCharts({ v: 1, footprint: { ...FP, bars: [] } })).toEqual([expect.stringMatching(/^footprint:/)]);
    expect(validateCharts({ v: 2 })).toEqual(['wersja danych: oczekiwane v: 1']);
  });
});
