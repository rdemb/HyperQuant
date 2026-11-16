import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IndicatorSettings } from '../chart/IndicatorSettings';
import { type LvnConfidenceOf, ZONE_ABOVE, ZONE_BELOW, closedBars, effortLegend, zoneInk } from '../chart/effortLayer';
import { PRO } from '../chart/theme';
import { type SwingProfile, swingProfile } from '../core/effortZones';
import { fmtHm } from '../core/time';
import { IndicatorEngine } from '../indicators/engine';
import { indicatorDef, indicatorsFromLink, parseIndicators, tfAllowed, usesInstanceColor } from '../indicators/registry';
import type { EffortBand, EffortSelection } from '../chart/effortSelect';
import { guardHits } from '../../../utils/safeguards.mjs';

/** Wskaźnik „Strefy absorpcji i pudełka Effort”: świece do modelu, legenda z wyniku, wpis w rejestrze i okno ustawień. */

const MS = 5 * 60_000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 4, 15, 0);
/** Profil swingu D do legendy (bez LVN; testy dopisują swoje). */
const PROF: SwingProfile = { val: 98, vah: 99.5, poc: 99, lvn: [], tapeShare: 1, src: { from: T0, to: T0, bins: 24, share: 0.7 } };

const ROWS = { tick: 0.5, lo: 198, buy: new Float64Array([1, 2, 3, 4, 2]), sell: new Float64Array([0, 1, 0, 0, 0]) };
const fpOf = (delta: number) => ({ delta, ...ROWS });
const bar = (i: number, fp: ReturnType<typeof fpOf> | null, complete: boolean) => ({
  t: T0 + i * MS,
  candle: { t: T0 + i * MS, o: 100, h: 101, l: 99, c: 100.5, v: 12, n: 3 },
  fp,
  complete,
});

describe('świece do modelu', () => {
  const bars = [bar(0, fpOf(4), true), bar(1, fpOf(-2), false), bar(2, null, false), bar(3, fpOf(7), true)];

  it('tylko zamknięte świece (koniec ≤ teraz); świeca w trakcie nie wchodzi', () => {
    expect(closedBars(bars, MS, T0 + 4 * MS)).toHaveLength(4);
    expect(closedBars(bars, MS, T0 + 4 * MS - 1)).toHaveLength(3);
    expect(closedBars(bars, MS, T0 + MS - 1)).toEqual([]);
  });

  it('delta i wiersze taśmy z footprintu tylko przy świecy w całości nagranej, inaczej null (brak taśmy)', () => {
    expect(closedBars(bars, MS, T0 + 4 * MS)).toEqual([
      { t: T0, o: 100, h: 101, l: 99, c: 100.5, v: 12, delta: 4, tape: ROWS },
      { t: T0 + MS, o: 100, h: 101, l: 99, c: 100.5, v: 12, delta: null, tape: null },
      { t: T0 + 2 * MS, o: 100, h: 101, l: 99, c: 100.5, v: 12, delta: null, tape: null },
      { t: T0 + 3 * MS, o: 100, h: 101, l: 99, c: 100.5, v: 12, delta: 7, tape: ROWS },
    ]);
  });

  it('profil swingu z wierszy footprintu (wolumen kupna i sprzedaży na cenie)', () => {
    const v = closedBars([bar(0, fpOf(4), true)], MS, T0 + MS);
    // Wiersze 99–101 co 0,5 (wolumen 1, 3, 3, 4, 2): w czterech przedziałach najwięcej w górnym (100,5 i 101)
    expect(swingProfile(v, 0, 0, 4, 0.5)).toMatchObject({ poc: 100.75, tapeShare: 1 });
  });
});

describe('legenda', () => {
  const asOf = T0 + 24 * MS;
  const band = (side: 1 | -1, lo = 99): EffortBand => ({
    side,
    lo,
    hi: lo + 1,
    start: T0 + 5 * MS,
    end: null,
    mark: 'A',
    kinds: ['absorption'],
    extremes: [],
    known: [{ kind: 'absorption', at: T0 + 6 * MS, lag: 5 * MS }],
  });
  const sel: EffortSelection = {
    bands: [band(1), band(1, 97), band(-1, 103)],
    broken: null,
    boxes: [{ side: 1, from: asOf - 6 * MS, last: asOf - 4 * MS, lo: 99, hi: 100, cells: [asOf - 6 * MS, asOf - 4 * MS] }],
    far: { demand: 2, supply: 1 },
    tapeRecent: 32,
    untaped: { zones: 0, box: null },
    history: false,
  };
  const fmt = (p: number) => String(p).replace('.', ',');
  const text = (x: EffortSelection | null, ms = MS, hover: { t: number; p: number } | null = null, conf: LvnConfidenceOf = (p) => p.lvn.map(() => 0.84)) =>
    effortLegend(x, ms, asOf, hover, fmt, conf)
      .map((p) => p.text)
      .join(' ');

  it('pasma po stronach z liczbą dalszych, ostatnia seria pudełek i świece z taśmą', () => {
    expect(text(sel)).toBe('strefy: 2 pod ceną · 1 nad ceną (dalej 3) · pudełko: kupno, 4 świece temu · taśma 32 z 32');
  });

  it('bez pudełka „—”; bez taśmy „pudełka: —, brak taśmy”; tryb Historia', () => {
    expect(text({ ...sel, boxes: [], far: { demand: 0, supply: 0 } })).toBe('strefy: 2 pod ceną · 1 nad ceną · pudełko: — · taśma 32 z 32');
    expect(text({ ...sel, boxes: [], tapeRecent: 0 })).toBe('strefy: 2 pod ceną · 1 nad ceną (dalej 3) · pudełka: —, brak taśmy');
    expect(text({ ...sel, history: true })).toBe('historia: 3 strefy · 1 seria pudełek · taśma 32 z 32');
  });

  it('bez taśmy: strefa A i pudełko „—, brak taśmy” zamiast przybliżenia', () => {
    expect(text({ ...sel, untaped: { zones: 2, box: null } })).toBe('strefy: 2 pod ceną · 1 nad ceną (dalej 3) · A: —, brak taśmy przy 2 krańcach · pudełko: kupno, 4 świece temu · taśma 32 z 32');
    expect(text({ ...sel, untaped: { zones: 1, box: asOf - MS } })).toBe('strefy: 2 pod ceną · 1 nad ceną (dalej 3) · A: —, brak taśmy przy 1 krańcu · pudełko: —, brak taśmy, 1 świeca temu · taśma 32 z 32');
    // Luka starsza niż ostatnia seria: legenda mówi o serii
    expect(text({ ...sel, untaped: { zones: 0, box: asOf - 5 * MS } })).toContain('pudełko: kupno, 4 świece temu');
    expect(text({ ...sel, boxes: [], untaped: { zones: 0, box: asOf } })).toContain('pudełko: —, brak taśmy, ostatnia świeca');
  });

  it('czas dostępności pod krzyżem nad pasmem: „strefa A znana od …, 25 min po krańcu”, z profilem swingu przy D', () => {
    const hover = { t: T0 + 10 * MS, p: 99.5 };
    expect(text(sel, MS, hover)).toContain(`· strefa A znana od ${fmtHm(T0 + 6 * MS)}, 25 min po krańcu`);
    // Poza pasmem (cena albo czas przed powstaniem) bez dopisku
    expect(text(sel, MS, { t: T0 + 10 * MS, p: 101.5 })).not.toContain('znana od');
    expect(text(sel, MS, { t: T0 + 4 * MS, p: 99.5 })).not.toContain('znana od');
    const d: EffortBand = {
      ...band(1),
      mark: 'D·F',
      kinds: ['discount', 'flip'],
      known: [
        { kind: 'discount', at: T0 + 6 * MS, lag: 135 * 60_000, profile: { ...PROF, lvn: [{ px: 98.5, bin: 1, persistence: 0.5 }], tapeShare: 0.4 } },
        { kind: 'flip', at: T0 + 7 * MS, lag: 0 },
      ],
    };
    const s = text({ ...sel, bands: [d] }, MS, hover);
    expect(s).toContain(`· strefa D znana od ${fmtHm(T0 + 6 * MS)}, 2 h 15 min po krańcu · profil swingu: POC 99, VA 98–99,5, LVN 98,5 · pewność 84% · przybliżenie: taśma 40%`);
    expect(s).toContain(`· strefa F znana od ${fmtHm(T0 + 7 * MS)}, na zamknięciu przebicia`);
    const tape = { ...d, known: [{ ...d.known[0], profile: { ...PROF, tapeShare: 1 } }] };
    expect(text({ ...sel, bands: [tape] }, MS, hover)).toContain('profil swingu: POC 99, VA 98–99,5 · z taśmy');
    const candles = { ...d, known: [{ ...d.known[0], profile: { ...PROF, tapeShare: 0 } }] };
    expect(text({ ...sel, bands: [candles] }, MS, hover)).toContain('profil swingu: POC 99, VA 98–99,5 · przybliżenie: ze świec');
    expect(guardHits(s)).toEqual([]);
  });

  it('LVN profilu swingu z pewnością: poniżej 70% nie pokazane, tylko liczba odrzuconych; bez pewności „—” z powodem', () => {
    const hover = { t: T0 + 10 * MS, p: 99.5 };
    const lvn = [
      { px: 98.5, bin: 1, persistence: 0.6 },
      { px: 99.2, bin: 2, persistence: 0.2 },
    ];
    const d: EffortBand = { ...band(1), mark: 'D', kinds: ['discount'], known: [{ kind: 'discount', at: T0 + 6 * MS, lag: 0, profile: { ...PROF, lvn, tapeShare: 1 } }] };
    const at = (conf: LvnConfidenceOf) => text({ ...sel, bands: [d] }, MS, hover, conf);
    expect(at(() => [0.91, 0.52])).toContain('profil swingu: POC 99, VA 98–99,5, LVN 98,5 · pewność 91%; 1 poniżej 70% · z taśmy');
    expect(at(() => [0.91, 0.52])).not.toContain('99,2');
    expect(at(() => [0.91, 0.7])).toContain('LVN 98,5 · pewność 91%; 99,2 · pewność 70% · z taśmy');
    expect(at(() => [0.4, 0.52])).toContain('profil swingu: POC 99, VA 98–99,5, LVN: —, pewność < 70% (2) · z taśmy');
    expect(at(() => null)).toContain('LVN: —, pewność nieznana');
  });

  it('powyżej 1 h bez rysowania, z powodem; bez zamkniętych świec — czekanie', () => {
    expect(text(sel, 4 * HOUR)).toBe('—, interwał do 1 h');
    expect(text(null)).toBe('czekam na świece…');
  });

  it('bez słów rady i kierunku (zabezpieczenia bloga)', () => {
    expect(guardHits(text(sel))).toEqual([]);
  });
});

describe('wpis w rejestrze', () => {
  const def = indicatorDef('effort');

  it('w grupie „Poziomy i rynki prognoz”, na wykresie ceny, bez parametrów, plotów i interwału; kolory stron stałe', () => {
    expect(def).toMatchObject({ tier: 'front', short: 'Effort', group: 'hyperquant', pane: 'price', params: [], plots: [], format: 'price', effortZones: true });
    expect(def.name).toBe('Strefy absorpcji i pudełka Effort');
    expect(def.warmup({})).toBe(0);
    expect(tfAllowed(def)).toBe(false);
    expect(usesInstanceColor(def)).toBe(false);
    expect(indicatorsFromLink('effort()@1h')[0].tf).toBeUndefined();
  });

  it('opis z regułami i progami modelu, bez sygnałów', () => {
    for (const s of [
      'nie ma w TradingView',
      'Valentiniego',
      '5 świec po obu stronach',
      '1,5 × średnia z 20 świec',
      'od 0,15 do 1 ATR',
      'co najmniej 2 ATR',
      'value area 70%',
      'o 1 ATR',
      '12 h',
      'po złej stronie VWAP',
      'ponad połowę',
      '1,2 × średnia |delty|',
      '3 poprzednie świece',
      'jego świeca i 19 świec przed nią mają deltę z taśmy',
      'z ostatnich 32 świec ma taśmę',
      'delta tylko z taśmy, bez przybliżenia ze świecy',
      'bez niej strefy A nie ma, a legenda pokazuje przy A brak wartości z powodem „brak taśmy”',
      'bez taśmy pudełka nie ma',
      'wolumen transakcji na każdej cenie z taśmy',
      'wtedy profil to przybliżenie',
      'strefa A znana od 10:25, 25 min po krańcu',
      'najbliższe ostatniemu zamknięciu',
      'od świecy, na której zamknięciu strefa powstała',
      'w 52% przypadków, tak jak losowy poziom',
      'nie przewidują odbicia',
    ])
      expect(def.convention, s).toContain(s);
    expect(indicatorDef('effort').convention).not.toContain('przybliżona ze świecy (wolumen');
    expect(indicatorDef('effort').convention).not.toContain('położenie zamknięcia w zakresie');
    for (const lang of [def.convention, def.hint]) expect(guardHits(lang ?? '')).toEqual([]);
    expect(def.memoryNote).toMatch(/świeca w trakcie nie wchodzi.*do 1 h.*także w powtórce/);
  });

  it('silnik wskaźników: bez wartości świec, nigdy nie zgłasza zmiany', () => {
    const e = new IndicatorEngine();
    e.setInstances(indicatorsFromLink('effort()'));
    const c = { t: 0, o: 1, h: 1, l: 1, c: 1, v: 1, n: 1 };
    e.sync([{ candle: c }, { candle: { ...c, t: 60_000 } }], 60_000);
    expect(e.runs[0].from).toBe(Number.POSITIVE_INFINITY);
    expect(e.runs[0].out).toEqual([]);
  });

  it('okno ustawień: zakładka parametrów bez pól liczbowych i bez interwału, z przełącznikiem „Historia” (domyślnie wyłączony)', () => {
    const x = indicatorsFromLink('effort()')[0];
    const html = renderToStaticMarkup(<IndicatorSettings x={x} loaded={100} chart="5m" onChange={() => {}} onClose={() => {}} />);
    // Przełącznik „Historia” wyłączony (bez atrybutu checked) tuż przed swoim podpisem
    expect(html).toMatch(/<input type="checkbox"(?![^>]*checked)[^>]*\/>Historia/);
    expect(html).not.toContain('Interwał wskaźnika');
    expect(html).not.toContain('type="number"');
  });
});

describe('zapis wskaźnika: tryb Historia', () => {
  it('stary zapis bez pola ładuje się bez zmian (bez trybu Historia); włączony tryb zostaje', () => {
    const old = { iid: 'effort', id: 'effort', params: {}, color: '#E9548D', alpha: 1, width: 1, labels: true, visible: true };
    const [a] = parseIndicators([old]).list;
    expect('history' in a).toBe(false);
    expect(JSON.parse(JSON.stringify(a))).toEqual(old);
    expect(parseIndicators([{ ...old, history: true }]).list[0].history).toBe(true);
    expect('history' in parseIndicators([{ ...old, history: 'tak' }]).list[0]).toBe(false);
  });
});

describe('strefy Effort w kolorach poziomów (plan 59, C2)', () => {
  it('strefy z rodziny poziomów, nie w kolorach kupna i sprzedaży; dwa odcienie dla stron', () => {
    expect(ZONE_BELOW).toBe(PRO.level);
    for (const c of [ZONE_BELOW, ZONE_ABOVE]) expect([PRO.buy, PRO.sell].map((x) => x.toLowerCase())).not.toContain(c.toLowerCase());
    expect(zoneInk(1)(1)).not.toBe(zoneInk(1)(-1));
  });

  it('teksty stref bez „popyt” i „podaż”; opis z wynikiem sprawdzianu', () => {
    const d = indicatorDef('effort')!;
    for (const t of [d.hint, d.convention ?? '']) expect(t).not.toMatch(/popyt|podaż|demand|supply/i);
    expect(d.convention).toContain('52%');
  });
});

describe('karta wskaźnika w oknie ustawień (plan 59, F2)', () => {
  it('okno z legendy pokazuje, co wskaźnik twierdzi, i status sprawdzenia', async () => {
    const { indicatorCard, STATUS_LABEL } = await import('../indicators/cards');
    const x = indicatorsFromLink('effort()')[0];
    const html = renderToStaticMarkup(<IndicatorSettings x={x} loaded={100} chart="5m" onChange={() => {}} onClose={() => {}} />);
    const card = indicatorCard('effort');
    expect(html).toContain('data-karta-wskaznika');
    expect(html).toContain(card.claim);
    expect(html).toContain(STATUS_LABEL[card.status]);
  });
});
