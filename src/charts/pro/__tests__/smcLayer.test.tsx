import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IndicatorSettings } from '../chart/IndicatorSettings';
import { LAYER_SOURCE, layerBadge } from '../chart/layerSources';
import { SMC_FC1_LEN, SMC_INK, type SmcSourceBar, candleTape, smcLegend } from '../chart/smcLayer';
import { fmtSignedVol } from '../../orderflow/renderer';
import { selectSmc } from '../chart/smcSelect';
import { type SBar, smcStructure } from '../core/smcStructure';
import { fmtDayTime } from '../core/time';
import { indicatorCard } from '../indicators/cards';
import { IndicatorEngine } from '../indicators/engine';
import { MENU_GROUPS, effortResult, indicatorDef, indicatorLabel, indicatorsFromLink, parseIndicators, swatchColor, tfAllowed, usesInstanceColor } from '../indicators/registry';
import { PRO } from '../chart/theme';
import { guardHits } from '../../../utils/safeguards.mjs';

/** Wskaźnik SMC+HL: legenda (eksperymentalny, bez częstości, „znany od” pod krzyżem), wpis w rejestrze, karta i plakietka. */

const MS = 5 * 60_000;
const T0 = Date.UTC(2026, 10, 16, 0, 0);
type Row = [number, number, number, number];
const mk = (rows: readonly Row[]): SBar[] => rows.map(([o, h, l, c], i) => ({ t: T0 + i * MS, o, h, l, c }));
const fmt = (p: number) => String(p);
/** Zakazany język: zalecenia i kierunek oraz opowieść o tym, kto handluje (opis mówi, co zmierzono). */
const BANNED = /sygna[łl]|\bsignals?\b|wzrośnie|spadnie|kupuj|sprzedawaj|wejdź|smart money|instytucj|institution|\bbuy\b|\bsell\b/i;

// Luka w górę [100,5; 100,8] po 20 płaskich świecach, potem cena nad nią
const rows: Row[] = [
  ...Array.from({ length: 20 }, () => [100, 100.5, 99.5, 100] as Row),
  [100, 100.5, 99.5, 100.2],
  [100.2, 102, 100.1, 101.8],
  [101.8, 102.5, 100.8, 102.3],
  [102.3, 102.4, 100.65, 102],
  [102, 102.2, 101.9, 102.1],
];
const bars = mk(rows);
const asOf = bars[bars.length - 1].t + MS;
const sel = selectSmc(smcStructure(bars, MS), bars, asOf, { phone: false, history: false });
const text = (h: { t: number; p: number } | null = null, s = sel) =>
  smcLegend(s, MS, h, fmt)
    .map((p) => p.text)
    .join(' ');

describe('legenda SMC', () => {
  it('eksperymentalny, stan obu skal, liczby aktywnych elementów, brak zakresu i częstości bazowych z powodem', () => {
    const t = text();
    expect(t.startsWith('eksperymentalny · struktura: wewn. mieszana · swing. mieszana · FVG 1 · EQH 0 · EQL 0 · OB 0')).toBe(true);
    expect(t).toContain('· zakres swingowy: —, brak szczytu i dołka skali swingowej');
    expect(t).toContain('· częstości bazowe wobec losowych poziomów: —, jeszcze nie policzone');
    expect(t).not.toMatch(BANNED);
  });

  it('krzyż nad luką: wypełnienie, dotknięcie środka luki (CE) i chwila „znana od”', () => {
    const f = sel.fvgs[0].f;
    const t = text({ t: f.t + 2 * MS, p: 100.75 });
    expect(t).toContain(`· FVG (luka po ruchu w górę) 100.5–100.8: wypełnienie 50%, dotknięcie środka luki (CE), znana od ${fmtDayTime(f.known, asOf)}`);
    // Przed świecą, na której luka była znana, krzyż nic nie dopisuje
    expect(text({ t: f.t - MS, p: 100.75 })).not.toContain('FVG (');
  });

  it('każdy interwał (także 4H); powód braku tylko bez świec', () => {
    expect(smcLegend(sel, 4 * 3_600_000).map((p) => p.text)[0]).toBe('eksperymentalny');
    expect(smcLegend(null, MS).map((p) => p.text)).toEqual(['czekam na świece…']);
  });

  it('kolory według rodzaju elementu, nie strony transakcji; OB ma własny kolor rodzaju', () => {
    for (const c of Object.values(SMC_INK)) expect([PRO.buy, PRO.sell, PRO.buyInk, PRO.sellInk]).not.toContain(c);
    expect(new Set(Object.values(SMC_INK)).size).toBe(Object.keys(SMC_INK).length);
    expect(SMC_INK.ob).toBeDefined();
  });
});

describe('OB pod krzyżem: strefa, „znany od”, stan, tryb mitygacji i taśma świecy', () => {
  /** Noga od `from` do `to` krokami 0,5 (jak w testach modelu). */
  const leg = (from: number, to: number): Row[] => {
    const out: Row[] = [];
    const n = Math.round(Math.abs(to - from) / 0.5);
    let o = from;
    for (let k = 1; k <= n; k++) {
      const c = from + ((to - from) * k) / n;
      out.push([o, Math.max(o, c) + 0.1, Math.min(o, c) - 0.1, c]);
      o = c;
    }
    return out;
  };
  // Szczyt 105,1, cofnięcie do 102, impuls do 108; świeca OB 35 (strefa 101,9–102,6), przełamanie w świecy 42
  const A: Row[] = [...Array.from({ length: 20 }, () => [100, 100.5, 99.5, 100] as Row), ...leg(100, 105), ...leg(105, 102), ...leg(102, 108)];
  const OB_IDX = 35;
  const obBars = mk(A);
  const obAsOf = obBars[obBars.length - 1].t + MS;
  const r = smcStructure(obBars, MS);
  const ob = r.obs.find((o) => o.idx === OB_IDX && o.scale === 'swing');
  const obText = (h: { t: number; p: number }, mitigation: 'close' | 'wick' = 'close', tape?: Parameters<typeof smcLegend>[4]) =>
    smcLegend(selectSmc(r, obBars, obAsOf, { phone: false, history: false, mitigation }), MS, h, fmt, tape)
      .map((p) => p.text)
      .join(' ');

  it('strefa, impuls, znany od, stan i tryb mitygacji; bez taśmy „—: brak taśmy”; licznik OB w legendzie', () => {
    expect(ob).toBeDefined();
    if (!ob) return;
    const t = obText({ t: ob.breakT + MS, p: 102.2 });
    expect(t).toContain('· EQH 0 · EQL 0 · OB 1');
    expect(t).toContain(
      `· OB (ostatnia świeca spadkowa przed BOS w górę, skala swing.): strefa 101.9–102.6, impuls ${ob.impulse.toFixed(1).replace('.', ',')} ATR, znany od ${fmtDayTime(ob.known, obAsOf)}, stan: aktywny, mitygacja: zamknięciem`
    );
    expect(t).toContain('· świeca OB: taśma —: brak taśmy');
    expect(obText({ t: ob.breakT + MS, p: 102.2 }, 'wick')).toContain('mitygacja: knotem');
    // Krzyż na samej świecy OB (znacznik) też opisuje OB; między nią a przełamaniem — nie (OB jeszcze nie był znany)
    expect(obText({ t: ob.t, p: 102.2 })).toContain('· OB (');
    expect(obText({ t: ob.t + 2 * MS, p: 102.2 })).not.toContain('· OB (');
    expect(obText({ t: ob.breakT + MS, p: 103.5 })).not.toContain('· OB (');
    expect(t).not.toMatch(BANNED);
  });

  it('z taśmą: delta świecy OB (LIVE) i F-C1 (MODEL) albo powód braku', () => {
    if (!ob) throw new Error('brak OB');
    const src: SmcSourceBar[] = obBars.map((b, i) => ({ t: b.t, candle: { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: 10, n: 1 }, fp: { delta: i === OB_IDX ? -1.5 : 0.5 }, complete: true }));
    const t = obText({ t: ob.breakT + MS, p: 102.2 }, 'close', (i) => candleTape(src, i));
    expect(t).toContain(`· świeca OB: delta ${fmtSignedVol(-1.5)} LIVE, wynik wobec wysiłku (F-C1) —: mniej niż ${SMC_FC1_LEN} świec z taśmą`);
    expect(t).not.toContain('brak taśmy');
  });

  it('zmitygowany (historia): chwila mitygacji i świeca mitygacji z percentylem wolumenu', () => {
    const rows2: Row[] = [...A, ...leg(108, 103), [103, 103.1, 101.3, 101.5], ...Array.from({ length: 5 }, () => [101.5, 101.55, 101.45, 101.5] as Row)];
    const b2 = mk(rows2);
    const mIdx = A.length + 10;
    const src: SmcSourceBar[] = b2.map((b, i) => ({ t: b.t, candle: { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: i === mIdx ? 50 : 10, n: 1 } }));
    const r2 = smcStructure(b2, MS);
    const at = b2[b2.length - 1].t + MS;
    const s2 = selectSmc(r2, b2, at, { phone: false, history: true });
    const v = s2.obs.find((x) => x.o.idx === OB_IDX);
    expect(v).toMatchObject({ state: 'mitigated', endIdx: mIdx });
    const t = smcLegend(s2, MS, { t: b2[45].t, p: 102.2 }, fmt, (i) => candleTape(src, i))
      .map((p) => p.text)
      .join(' ');
    expect(t).toContain(`stan: zmitygowany ${fmtDayTime(b2[mIdx].t + MS, at)}, mitygacja: zamknięciem`);
    expect(t).toContain('· świeca mitygacji: wolumen p100 wobec 100 poprzednich świec MODEL, taśma —: brak taśmy');
  });
});

describe('taśma świecy (candleTape)', () => {
  /** Świece z deltą i ruchem y = 3·x + szum (λ mierzalne), co 7. świeca z luką w taśmie. */
  const src: SmcSourceBar[] = [];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  let c = 50_000;
  for (let i = 0; i < 140; i++) {
    const delta = rnd() * 40;
    const o = c;
    c = o * (1 + (3 * ((delta * o) / 1e6) + rnd() * 0.2) / 1e4);
    src.push({ t: T0 + i * MS, candle: { t: T0 + i * MS, o, h: Math.max(o, c) + 0.01, l: Math.min(o, c) - 0.01, c, v: 5 + (i % 10), n: 1 }, fp: { delta }, complete: i % 7 !== 3 });
  }

  it('F-C1 jak wskaźnik W/W: prosta z 60 wcześniejszych świec z pełną taśmą (luki pomijane)', () => {
    const i = 130;
    const pt = (b: SmcSourceBar) => [((b.fp?.delta ?? 0) * b.candle.c) / 1e6, ((b.candle.c - b.candle.o) / b.candle.o) * 1e4];
    const prev = src.slice(0, i).filter((b) => b.complete).slice(-SMC_FC1_LEN).reverse();
    const xs = Float64Array.from(prev.map((b) => pt(b)[0]));
    const ys = Float64Array.from(prev.map((b) => pt(b)[1]));
    const [x, y] = pt(src[i]);
    const want = effortResult(x, y, xs, ys, SMC_FC1_LEN);
    expect(want).not.toBeNull();
    const got = candleTape(src, i);
    expect(got.delta).toBe(src[i].fp?.delta);
    expect(got.fc1).toBeCloseTo(want?.z as number, 12);
    expect(got.fc1Why).toBeNull();
  });

  it('świeca z luką w taśmie albo bez taśmy: brak delty (bez przybliżenia); percentyl wolumenu od 20 świec', () => {
    expect(candleTape(src, 3)).toMatchObject({ delta: null, fc1: null, volPct: null });
    expect(candleTape(src, 59).delta).toBeNull();
    const noTape = src.map((b) => ({ t: b.t, candle: b.candle }));
    expect(candleTape(noTape, 130)).toMatchObject({ delta: null, fc1: null, fc1Why: null });
    const prev = src.slice(30, 130);
    expect(candleTape(src, 130).volPct).toBe(prev.filter((b) => b.candle.v < src[130].candle.v).length / prev.length);
    expect(candleTape(src, 25).fc1Why).toBe('few');
  });
});

describe('wpis SMC w rejestrze', () => {
  const def = indicatorDef('smc');

  it('nowa grupa menu „Struktura i płynność”, na wykresie ceny, okna pivota 3, 5, 10, 20, 50 (domyślnie 3 i 10), bez interwału i koloru instancji', () => {
    expect(MENU_GROUPS.find((g) => g.id === 'struktura')?.ids).toEqual(['smc']);
    expect(def).toMatchObject({ tier: 'front', short: 'SMC+HL', group: 'hyperquant', pane: 'price', plots: [], format: 'price', smc: true });
    expect(def.name).toBe('Struktura i płynność (SMC+HL)');
    expect(def.params.map((p) => [p.key, p.def, p.options])).toEqual([
      ['internal', 3, [3, 5, 10, 20, 50]],
      ['swing', 10, [3, 5, 10, 20, 50]],
      ['mitigation', 0, [0, 1]],
    ]);
    expect(tfAllowed(def)).toBe(false);
    expect(usesInstanceColor(def)).toBe(false);
    const [x] = indicatorsFromLink('smc()');
    expect(indicatorLabel(x)).toBe('SMC+HL 3 10 zamknięciem');
    expect(indicatorsFromLink('smc(5,50)')[0].params).toEqual({ internal: 5, swing: 50, mitigation: 0 });
    expect(indicatorLabel(indicatorsFromLink('smc(5,50,1)')[0])).toBe('SMC+HL 5 50 knotem');
    expect(indicatorsFromLink('smc(3,10,2)')[0].params.mitigation).toBe(0);
    expect(indicatorsFromLink('smc(4,10)')[0].params.internal).toBe(3);
    expect(swatchColor(x)).not.toContain(PRO.buy);
  });

  it('tryb „historia 24 h” zapisuje się w instancji', () => {
    const base = { iid: 'smc1', id: 'smc', params: {}, color: '#e9548d', alpha: 1, width: 1, labels: true, visible: true };
    expect(parseIndicators([{ ...base, history: true }]).list[0].history).toBe(true);
    expect(parseIndicators([base]).list[0].history).toBeUndefined();
  });

  it('opis: nasze definicje, known, CE, limity, eksperymentalny bez częstości; bez zakazanych słów i myślników', () => {
    for (const s of ['napisane od zera', 'znany od zamknięcia świecy j + L', '3, 5, 10, 20, 50', 'dotknięcie środka luki (CE)', 'najwyżej 25 obiektów', 'co najmniej 1,5 ATR', 'zamknięciem za dalszą krawędzią strefy', 'knotem', 'OB żyje 200 świec', 'deltę agresorów (LIVE)', 'F-C1 (MODEL', 'połowy zakresu', 'Częstości bazowe', 'eksperymentalny'])
      expect(def.convention, s).toContain(s);
    for (const t of [def.convention ?? '', def.hint, def.memoryNote ?? '']) {
      expect(guardHits(t)).toEqual([]);
      expect(t).not.toMatch(BANNED);
    }
  });

  it('plakietka MODEL z metodą, karta „opis” ze zdaniem o braku częstości bazowych', () => {
    expect(LAYER_SOURCE.smc).toBe('MODEL');
    expect(layerBadge('smc', { coin: 'BTC', now: T0 })).toMatchObject({ tone: 'model', text: 'MODEL', hint: expect.stringMatching(/^MODEL · reguły struktury na zamkniętych świecach: .*częstości bazowe jeszcze nie policzone$/) });
    const card = indicatorCard('smc');
    expect(card.status).toBe('opis');
    expect(card.noise).toContain('nie są jeszcze policzone');
    expect(card.claim).toContain('Eksperymentalny');
  });

  it('silnik wskaźników: bez wartości świec, nigdy nie zgłasza zmiany', () => {
    const e = new IndicatorEngine();
    e.setInstances(indicatorsFromLink('smc()'));
    const c = { t: 0, o: 1, h: 1, l: 1, c: 1, v: 1, n: 1 };
    e.sync([{ candle: c }, { candle: { ...c, t: 60_000 } }], 60_000);
    expect(e.runs[0].from).toBe(Number.POSITIVE_INFINITY);
    expect(e.runs[0].out).toEqual([]);
  });

  it('okno ustawień: wybór okien pivota z listy, przełącznik historii 24 h, bez interwału i wartości na osi', () => {
    const x = indicatorsFromLink('smc()')[0];
    const html = renderToStaticMarkup(<IndicatorSettings x={x} loaded={100} chart="5m" onChange={() => {}} onClose={() => {}} />);
    expect(html).toMatch(/<select aria-label="Okno pivota, skala wewnętrzna \(świece\)"[^>]*>.*<option value="50">50<\/option><\/select>/);
    expect(html).toContain('Historia 24 h: także wypełnione luki, zakończone EQ i zmitygowane OB, przygaszone');
    expect(html).toMatch(/<select aria-label="Mitygacja OB"[^>]*><option value="0" selected="">zamknięciem<\/option><option value="1">knotem<\/option><\/select>/);
    expect(html).not.toContain('Interwał wskaźnika');
    expect(html).toContain('data-walidacja="opis"');
  });
});
