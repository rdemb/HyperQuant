import { describe, expect, it } from 'vitest';
import { type IndicatorBar, dayLevels, initialBalances, liqLevels, vwapFrom } from '../../charts/pro/core/indicators';
import type { Candle } from '../../charts/pro/hl/parse';
import { selectDays } from '../../charts/pro/chart/levelsSelect';
import { selectIbs } from '../../charts/pro/chart/ibSelect';
import { type ValueRef, valueReference } from '../../charts/pro/core/valueReference';
import { coneForecastOf } from '../cone';
import type { DeskLedgerSummary } from '../deskLedger';
import type { EntryMap } from '../entryMap';
import { liqFuel } from '../fourNumbers';
import type { LiqMap } from '../liqMap';
import { type LevelInputs, type LevelRow, atr5mOf, distPctOf, entryMedian, liqBetween, nearestLevels } from '../nearestLevels';
import { isAbsent } from '../sessionText';

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
/** Wtorek 10.11.2026, 16:10 UTC: sesja NY od 14:30 UTC, IB zamknięty o 15:30. */
const NOW = Date.UTC(2026, 10, 10, 16, 10);
const TODAY = Date.UTC(2026, 10, 10);
const FROM = TODAY - DAY;

/** Świece 1m od wczoraj 00:00 UTC do ostatniej pełnej minuty: deterministyczna ścieżka wokół 100 000. */
function minutes(): Candle[] {
  const out: Candle[] = [];
  let prev = 100_000;
  for (let t = FROM, i = 0; t < NOW; t += MIN, i++) {
    const c = 100_000 + 900 * Math.sin(i / 97) + 260 * Math.sin(i / 13) + 40 * Math.cos(i / 3);
    out.push({ t, o: prev, h: Math.max(prev, c) + 15 + (i % 5), l: Math.min(prev, c) - 15 - (i % 3), c, v: 1 + (i % 7) * 0.5, n: 10 });
    prev = c;
  }
  return out;
}

/** Świece interwału `ms` złożone ze świec 1m (jak świece API wyższego interwału). */
function aggregate(c1m: readonly Candle[], ms: number): Candle[] {
  const out: Candle[] = [];
  for (const c of c1m) {
    const t = Math.floor(c.t / ms) * ms;
    const last = out[out.length - 1];
    if (last && last.t === t) {
      last.h = Math.max(last.h, c.h);
      last.l = Math.min(last.l, c.l);
      last.c = c.c;
      last.v += c.v;
      last.n += c.n;
    } else out.push({ ...c, t });
  }
  return out;
}

const C1M = minutes();
const C5M = aggregate(C1M, 5 * MIN);
/** VA wczorajszej doby z jednego źródła (świece 5m, bez taśmy) — ta sama funkcja co pasek Rama dnia i nagłówek Mapy dnia. */
const PREV = valueReference('day', FROM, { bars: C5M.map((c) => ({ t: c.t, l: c.l, h: c.h, v: c.v })), ms: 5 * MIN }, NOW)!;
const DAILY = aggregate(C1M, DAY);
const PRICE = C1M[C1M.length - 1].c;

const LIQ: LiqMap = {
  v: 1,
  coin: 'BTC',
  asOf: NOW - MIN,
  markPx: 100_000,
  stepUsd: 100,
  longs: [
    { px: 97_900, ntlUsd: 24e6, n: 40 },
    { px: 98_900, ntlUsd: 6e6, n: 12 },
    { px: 99_600, ntlUsd: 2e6, n: 5 },
  ],
  shorts: [
    { px: 100_400, ntlUsd: 3e6, n: 6 },
    { px: 101_100, ntlUsd: 9e6, n: 14 },
    { px: 102_400, ntlUsd: 31e6, n: 50 },
  ],
  coverage: { positions: 900, addresses: 700, scannedBtc: 9_600, longBtc: 4_900, shortBtc: 4_700, wrongSide: 0, oiBtc: 10_000, share: 0.48 },
  ageMin: { p50: 3, p90: 8, ntlP50: 4 },
  ctxAt: NOW - MIN,
  method: 'hl-liq-v1',
};

const ENTRY: EntryMap = {
  v: 1,
  coin: 'BTC',
  asOf: NOW - MIN,
  markPx: 100_000,
  stepUsd: 250,
  rangePct: 0.15,
  longs: [
    { px: 99_500, ntlUsd: 1e7, n: 20 },
    { px: 100_500, ntlUsd: 3e7, n: 30 },
    { px: 101_000, ntlUsd: 1e7, n: 10 },
  ],
  shorts: [
    { px: 98_000, ntlUsd: 4e7, n: 25 },
    { px: 102_000, ntlUsd: 1e7, n: 9 },
  ],
  long: { ntlUsd: 5e7, underwaterUsd: 4e7, underwaterShare: 0.8, outsideUsd: 0, liqDistPct: null },
  short: { ntlUsd: 5e7, underwaterUsd: 4e7, underwaterShare: 0.8, outsideUsd: 0, liqDistPct: null },
  coverage: { positions: 900, addresses: 700, scannedBtc: 9_600, oiBtc: 10_000, share: 0.48 },
  ageMin: { p50: 3, ntlP50: 4 },
  method: 'hl-entry-v1',
};

const TAUS = [0.025, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.975];
const Z = [-1.96, -1.645, -1.2816, -0.8416, -0.5244, -0.2533, 0, 0.2533, 0.5244, 0.8416, 1.2816, 1.645, 1.96];
const qOf = (h: number) => Z.map((z) => 0.006 * Math.sqrt(h / 60) * z);
const ret = (t: number, h: number) => ({ t, h, px0: 99_800, taus: TAUS, q: qOf(h), bq: [], aci: { alpha: 0.1, alphaNow: 0.1, lo: null, hi: null } });
/** Podsumowanie dziennika z samą częścią czytaną przez stożek (rynek i najnowsze prognozy). */
const ledgerAt = (t: number, coin = 'BTC') => ({ coin, latest: { ret: [ret(t, 240), ret(t, 60)], touch: null } }) as unknown as DeskLedgerSummary;
const LEDGER = ledgerAt(NOW - 25 * MIN);

const inputs = (o: Partial<LevelInputs> = {}): LevelInputs => ({
  coin: 'BTC',
  now: NOW,
  price: PRICE,
  scanner: true,
  forecasts: true,
  noScannerWhy: 'bez skanera: test',
  daily: DAILY,
  c1m: C1M.filter((c) => c.t >= TODAY),
  prevValue: PREV,
  c5m: C5M,
  liq: { status: 'ready', map: LIQ },
  entry: { status: 'ready', map: ENTRY },
  ledger: { status: 'ready', summary: LEDGER },
  ...o,
});

const rowsOf = (n: ReturnType<typeof nearestLevels>): LevelRow[] => [...n.above, ...n.below];
const rowOf = (n: ReturnType<typeof nearestLevels>, id: string): LevelRow => {
  const r = rowsOf(n).find((x) => x.id === id);
  if (!r) throw new Error(`brak poziomu ${id} na liście`);
  return r;
};

describe('nearestLevels: odległość z panelu = odległość linii na wykresie', () => {
  // Wszystkie poziomy na liście (limit większy niż liczba poziomów), żeby porównać każdy z linią wykresu
  const n = nearestLevels(inputs(), 99);
  const bars5m: IndicatorBar[] = C5M.map((c) => ({ t: c.t, candle: c }));
  const lastT = bars5m[bars5m.length - 1].t;
  const same = (id: string, chartPx: number) => expect(rowOf(n, id).distPct).toBe(distPctOf(chartPx, PRICE));

  it('PDH i PDL: poziomy bieżącej doby, które rysuje wykres (`dayLevels` + `selectDays`)', () => {
    const d = selectDays(dayLevels(DAILY), lastT, 5 * MIN).find((x) => x.current)!.day;
    same('pdh', d.pdh);
    same('pdl', d.pdl);
  });

  it('VWAP doby i pasma ±1σ, ±2σ: ostatni punkt linii VWAP wykresu 5m liczonej ze świec 1m (`vwapFrom`)', () => {
    const v = vwapFrom(bars5m, C1M, 5 * MIN, 'day').at(-1)!;
    same('vwap', v.vwap);
    same('vwapUp1', v.vwap + v.sd);
    same('vwapDn1', v.vwap - v.sd);
    same('vwapUp2', v.vwap + 2 * v.sd);
    same('vwapDn2', v.vwap - 2 * v.sd);
  });

  it('IB bieżącej sesji: szczyt i dołek z warstwy IB wykresu 5m (`initialBalances` + `selectIbs`)', () => {
    const ib = selectIbs(initialBalances(bars5m, 5 * MIN), bars5m, 5 * MIN, NOW).find((d) => d.current)!.ib;
    expect(ib.session.id).toBe('ny');
    same('ibh', ib.hi);
    same('ibl', ib.lo);
    expect(rowOf(n, 'ibh').label).toBe('IBH · Nowy Jork');
  });

  it('POC, VAH i VAL wczoraj: jedno źródło wartości (`valueReference`), jak pasek Rama dnia i nagłówek Mapy dnia', () => {
    expect(PREV).toMatchObject({ kind: 'day', from: FROM, source: 'candles' });
    same('vah', PREV.vah);
    same('val', PREV.val);
    same('poc', PREV.poc);
  });

  it('plakietka wartości: ze świec MODEL „przybliżenie ze świec” z udziałem taśmy, z taśmy LIVE', () => {
    const v = rowOf(n, 'vah');
    expect(v.badge).toBe('MODEL');
    expect(v.hint).toMatch(/^MODEL · przybliżenie ze świec \(przybliżenie, taśma 0%\): VAH /);
    const tape: ValueRef = { ...PREV, source: 'tape', tapeShare: 0.95 };
    const live = rowOf(nearestLevels(inputs({ prevValue: tape }), 99), 'poc');
    expect(live.badge).toBe('LIVE');
    expect(live.hint).toContain('Profil wolumenu z taśmy Hyperliquid (95% wolumenu okresu nagrane');
    // Brak wartości: „—” z powodem, bez liczby zastępczej
    const miss = nearestLevels(inputs({ prevValue: { why: 'Świece 5m nie obejmują 90% wczorajszej doby UTC' } }), 99).missing.filter((m) => ['poc', 'vah', 'val'].includes(m.id));
    expect(miss.map((m) => m.why)).toEqual(Array(3).fill('Świece 5m nie obejmują 90% wczorajszej doby UTC'));
  });

  it('klastry likwidacji: największy z rysowanych po każdej stronie (`liqLevels`)', () => {
    const lv = liqLevels(LIQ);
    same('liqLong', lv.find((l) => l.side === 'long')!.px);
    same('liqShort', lv.find((l) => l.side === 'short')!.px);
  });

  it('stożek: granice 90% na 1 h z prognozy rysowanej na wykresie (`coneForecastOf`, jak legenda stożka)', () => {
    const f = coneForecastOf(LEDGER, 'BTC', NOW)!;
    const hz = f.horizons[0];
    expect(hz.h).toBe(60);
    same('coneHi', f.px0 * Math.exp(hz.q[hz.taus.indexOf(0.95)]));
    same('coneLo', f.px0 * Math.exp(hz.q[hz.taus.indexOf(0.05)]));
  });
});

describe('nearestLevels: lista nad i pod ceną', () => {
  it('nad ceną rosnąco, pod ceną malejąco (od najbliższego), najwyżej 6 po stronie, reszta policzona', () => {
    const all = nearestLevels(inputs(), 99);
    const n = nearestLevels(inputs());
    expect(all.missing).toEqual([]);
    expect(n.above.length).toBeLessThanOrEqual(6);
    expect(n.below.length).toBeLessThanOrEqual(6);
    expect(n.above.every((r) => r.px >= PRICE && r.distPct >= 0)).toBe(true);
    expect(n.below.every((r) => r.px < PRICE && r.distPct < 0)).toBe(true);
    expect(n.above.map((r) => r.px)).toEqual([...n.above.map((r) => r.px)].sort((a, b) => a - b));
    expect(n.below.map((r) => r.px)).toEqual([...n.below.map((r) => r.px)].sort((a, b) => b - a));
    expect(n.above).toEqual(all.above.slice(0, 6));
    expect(n.below).toEqual(all.below.slice(0, 6));
    expect(n.hidden).toBe(all.above.length + all.below.length - n.above.length - n.below.length);
    expect(rowsOf(all)).toHaveLength(20);
  });

  it('odległość w ATR 5m: |poziom − cena| / ATR(14) zamkniętych świec 5m', () => {
    const n = nearestLevels(inputs());
    const atr = atr5mOf(C5M, NOW);
    if (isAbsent(atr)) throw new Error(atr.why);
    expect(n.atr).toEqual(atr);
    for (const r of rowsOf(n)) expect(r.distAtr).toBeCloseTo(Math.abs(r.px - PRICE) / atr.value, 12);
  });

  it('plakietki: LIVE dla poziomów z ceny, świec i VWAP; MODEL dla klastrów, Uwięzionych, stożka i value area ze świec', () => {
    const n = nearestLevels(inputs(), 99);
    const model = rowsOf(n)
      .filter((r) => r.badge === 'MODEL')
      .map((r) => r.id)
      .sort();
    // Value area wczoraj bez taśmy (przybliżenie ze świec 5m) — MODEL według reguły plakietki wartości
    expect(model).toEqual(['coneHi', 'coneLo', 'liqLong', 'liqShort', 'poc', 'trappedLong', 'trappedShort', 'vah', 'val']);
    for (const r of rowsOf(n)) if (r.badge === 'MODEL') expect(r.hint).toMatch(/^MODEL · /);
  });

  it('mediana wejść Uwięzionych: ważona wartością, środek kubełka', () => {
    expect(entryMedian(ENTRY.longs, ENTRY.stepUsd)).toBe(100_500 + 125);
    expect(entryMedian(ENTRY.shorts, ENTRY.stepUsd)).toBe(98_000 + 125);
    expect(entryMedian([], 250)).toBeNull();
    const n = nearestLevels(inputs(), 99);
    expect(rowOf(n, 'trappedLong').px).toBe(100_625);
    expect(rowOf(n, 'trappedLong').hint).toContain('48% open interest');
  });

  it('opis bez kierunku i bez porad', () => {
    const n = nearestLevels(inputs(), 99);
    const text = rowsOf(n)
      .map((r) => `${r.label} ${r.hint}`)
      .join(' ');
    expect(text).not.toMatch(/kupuj|sprzedawaj|wsparci|opór|utrzyma|odbij|\bbuy\b|\bsell\b|support|resistance|bounce/i);
  });
});

describe('nearestLevels: paliwo likwidacji między ceną a poziomem', () => {
  it('te same granice co paliwo ±1% Czwórki (`liqFuel`)', () => {
    const f = liqFuel(LIQ, PRICE);
    expect(liqBetween(LIQ, PRICE, PRICE * 1.01)).toBe(f.above);
    expect(liqBetween(LIQ, PRICE, PRICE * 0.99)).toBe(f.below);
  });

  it('wiersz: USD kubełków między ceną a poziomem (poziom włącznie)', () => {
    const n = nearestLevels(inputs(), 99);
    for (const r of rowsOf(n)) expect(r.fuel).toBe(liqBetween(LIQ, PRICE, r.px));
    expect(n.liq).toEqual({ asOf: LIQ.asOf, share: 0.48, delayed: false });
  });

  it('mapa starsza niż próg: „—” z wiekiem w paliwie i w klastrach', () => {
    const old = { ...LIQ, asOf: NOW - 25 * MIN, ctxAt: NOW - 25 * MIN };
    const n = nearestLevels(inputs({ liq: { status: 'stale', map: old } }), 99);
    for (const r of rowsOf(n)) {
      expect(isAbsent(r.fuel)).toBe(true);
      expect(isAbsent(r.fuel) && r.fuel.why).toContain('sprzed 25 min');
    }
    const clusters = n.missing.filter((m) => m.id === 'liqLong' || m.id === 'liqShort');
    expect(clusters).toHaveLength(2);
    expect(clusters.every((m) => m.why.includes('sprzed 25 min'))).toBe(true);
    expect(isAbsent(n.liq)).toBe(true);
  });

  it('mapa wejść starsza niż próg: Uwięzieni „—” z wiekiem', () => {
    const n = nearestLevels(inputs({ entry: { status: 'expired', map: { ...ENTRY, asOf: NOW - 2 * H } } }), 99);
    const t = n.missing.filter((m) => m.id.startsWith('trapped'));
    expect(t).toHaveLength(2);
    expect(t[0].why).toContain('sprzed 2 h');
  });

  it('poziom poza zasięgiem mapy (±15% od ceny mark): „—” z powodem, nie zero', () => {
    const far = { ...LIQ, markPx: 80_000 };
    const n = nearestLevels(inputs({ liq: { status: 'ready', map: far } }), 99);
    const r = rowOf(n, 'pdh');
    expect(isAbsent(r.fuel) && r.fuel.why).toMatch(/poza zasięgiem mapy/);
  });
});

describe('nearestLevels: rynek bez skanera i braki danych', () => {
  it('rynek HIP-3 (bez skanera i prognoz): poziomy ze świec są, klastry, Uwięzieni, stożek i paliwo — „—” z powodem', () => {
    const n = nearestLevels(inputs({ coin: 'dex:TEST', scanner: false, forecasts: false, liq: { status: 'ready', map: LIQ } }), 99);
    expect(n.missing.map((m) => m.id).sort()).toEqual(['coneHi', 'coneLo', 'liqLong', 'liqShort', 'trappedLong', 'trappedShort']);
    expect(n.missing.every((m) => m.why === 'bez skanera: test')).toBe(true);
    expect(rowsOf(n).every((r) => isAbsent(r.fuel) && r.fuel.why === 'bez skanera: test')).toBe(true);
    expect(rowsOf(n)).toHaveLength(14);
  });

  it('bez ceny: brak listy, powód; świece w drodze: „Czekam na dane…”', () => {
    const n = nearestLevels(inputs({ price: undefined, daily: undefined, c1m: undefined }));
    expect(n.price).toEqual({ why: 'Czekam na dane…' });
    expect(n.above).toEqual([]);
    expect(n.below).toEqual([]);
    expect(n.missing.find((m) => m.id === 'pdh')?.why).toBe('Czekam na dane…');
    expect(n.missing.find((m) => m.id === 'vwap')?.why).toBe('Czekam na dane…');
  });

  it('prognoza starsza niż 3 h albo innego rynku: stożek „—”', () => {
    expect(coneForecastOf(ledgerAt(NOW - 4 * H), 'BTC', NOW)).toBeNull();
    expect(coneForecastOf(LEDGER, 'ETH', NOW)).toBeNull();
    const n = nearestLevels(inputs({ ledger: { status: 'ready', summary: ledgerAt(NOW - 4 * H) } }), 99);
    expect(n.missing.find((m) => m.id === 'coneHi')?.why).toBe('Brak prognozy z ostatnich 3 h');
  });

  it('ATR: za mało zamkniętych świec 5m — powód; świeca w trakcie się nie liczy', () => {
    const flat = (t: number): Candle => ({ t, o: 100, h: 105, l: 95, c: 100, v: 1, n: 1 });
    const list = Array.from({ length: 15 }, (_, i) => flat(TODAY + i * 5 * MIN));
    expect(atr5mOf(list, TODAY + 15 * 5 * MIN)).toEqual({ value: 10, n: 14 });
    expect(isAbsent(atr5mOf(list, TODAY + 15 * 5 * MIN - 1))).toBe(true);
  });
});
