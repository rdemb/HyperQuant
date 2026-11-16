import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { IndicatorSettings } from '../chart/IndicatorSettings';
import { LAYER_SOURCE, layerBadge } from '../chart/layerSources';
import { SMC_INK, smcLegend } from '../chart/smcLayer';
import { SMC_RATES_SUMMARY, loadSmcRates } from '../chart/smcRates';
import { selectSmc } from '../chart/smcSelect';
import { type SBar, smcStructure } from '../core/smcStructure';
import { fmtDayTime } from '../core/time';
import { indicatorCard } from '../indicators/cards';
import { IndicatorEngine } from '../indicators/engine';
import { MENU_GROUPS, indicatorDef, indicatorLabel, indicatorsFromLink, parseIndicators, swatchColor, tfAllowed, usesInstanceColor } from '../indicators/registry';
import { PRO } from '../chart/theme';
import { guardHits } from '../../../utils/safeguards.mjs';

/** Wskaźnik SMC+HL: legenda (eksperymentalny, częstości bazowe interwału, „znany od” i częstości typu pod krzyżem), wpis w rejestrze, karta i plakietka. */

beforeAll(async () => {
  await loadSmcRates();
});

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
  smcLegend(s, MS, 'BTC', h, fmt)
    .map((p) => p.text)
    .join(' ');

describe('legenda SMC', () => {
  it('eksperymentalny, stan obu skal, liczby aktywnych elementów, brak zakresu z powodem i częstości bazowe interwału', () => {
    const t = text();
    expect(t.startsWith('eksperymentalny · struktura: wewn. mieszana · swing. mieszana · FVG 1 · EQH 0 · EQL 0')).toBe(true);
    expect(t).toContain('· zakres swingowy: —, brak szczytu i dołka skali swingowej');
    expect(t).toContain('· częstości bazowe (BTC 5m, 2024–2026, wobec losowej kontroli, BOS i sweep przy tej samej zmienności): BOS swing.: dalszy ruch większy, +0,25 ATR [0,10; 0,42]');
    expect(t).not.toContain('jeszcze nie policzone');
    expect(t).not.toMatch(BANNED);
  });

  it('krzyż nad luką: wypełnienie, dotknięcie środka luki (CE), chwila „znana od” i częstości bazowe FVG', () => {
    const f = sel.fvgs[0].f;
    const parts = smcLegend(sel, MS, 'BTC', { t: f.t + 2 * MS, p: 100.75 }, fmt).map((p) => p.text);
    const at = parts.findIndex((p) => p.startsWith('· FVG ('));
    expect(parts[at]).toBe(`· FVG (luka po ruchu w górę) 100.5–100.8: wypełnienie 50%, dotknięcie środka luki (CE), znana od ${fmtDayTime(f.known, asOf)}`);
    expect(parts[at + 1]).toBe('· FVG (BTC 5m, 2024–2026, n = 59 403): środek luki (CE) dotknięty w 24 świecach 80,4% · losowa luka 78,7% · różnica +1,7 pp [1,2; 2,2] · częściej niż przy losowej luce');
    expect(parts[at + 2]).toMatch(/^· FVG \(BTC 5m, 2024–2026, n = 59 403\): cała luka wypełniona w 24 świecach /);
    expect(parts).toHaveLength(at + 3);
    // Przed świecą, na której luka była znana, krzyż nic nie dopisuje
    expect(text({ t: f.t - MS, p: 100.75 })).not.toContain('FVG (');
  });

  it('każdy interwał (także 4H); częstości tylko dla 5m, 15m, 1h, 4H i 1D; powód braku świec', () => {
    const h4 = smcLegend(sel, 4 * 3_600_000, 'BTC').map((p) => p.text);
    expect(h4[0]).toBe('eksperymentalny');
    expect(h4.join(' ')).toContain('BOS swing.: —: za mało przypadków (n = 81)');
    expect(smcLegend(sel, 30 * 60_000, 'BTC').map((p) => p.text)).toContain('· częstości bazowe: —: brak częstości dla tego interwału');
    expect(smcLegend(null, MS, 'BTC').map((p) => p.text)).toEqual(['czekam na świece…']);
  });

  it('inny rynek niż BTC: częstości z powodem braku w legendzie, krzyż nad elementem bez częstości', () => {
    const f = sel.fvgs[0].f;
    for (const coin of ['ETH', 'SOL', 'HYPE']) {
      const parts = smcLegend(sel, MS, coin, { t: f.t + 2 * MS, p: 100.75 }, fmt).map((p) => p.text);
      expect(parts).toContain('· częstości bazowe: —: policzone tylko dla BTC');
      expect(parts.filter((p) => p.includes('2024–2026'))).toEqual([]);
      const at = parts.findIndex((p) => p.startsWith('· FVG ('));
      expect(parts[at]).toContain('wypełnienie 50%');
      expect(parts).toHaveLength(at + 1);
    }
  });

  it('kolory według rodzaju elementu, nie strony transakcji', () => {
    for (const c of Object.values(SMC_INK)) expect([PRO.buy, PRO.sell, PRO.buyInk, PRO.sellInk]).not.toContain(c);
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
    ]);
    expect(tfAllowed(def)).toBe(false);
    expect(usesInstanceColor(def)).toBe(false);
    const [x] = indicatorsFromLink('smc()');
    expect(indicatorLabel(x)).toBe('SMC+HL 3 10');
    expect(indicatorsFromLink('smc(5,50)')[0].params).toEqual({ internal: 5, swing: 50 });
    expect(indicatorsFromLink('smc(4,10)')[0].params.internal).toBe(3);
    expect(swatchColor(x)).not.toContain(PRO.buy);
  });

  it('tryb „historia 24 h” zapisuje się w instancji', () => {
    const base = { iid: 'smc1', id: 'smc', params: {}, color: '#e9548d', alpha: 1, width: 1, labels: true, visible: true };
    expect(parseIndicators([{ ...base, history: true }]).list[0].history).toBe(true);
    expect(parseIndicators([base]).list[0].history).toBeUndefined();
  });

  it('opis: nasze definicje, known, CE, limity, eksperymentalny z podsumowaniem częstości; bez zakazanych słów i myślników', () => {
    for (const s of ['napisane od zera', 'znany od zamknięcia świecy j + L', '3, 5, 10, 20, 50', 'dotknięcie środka luki (CE)', 'najwyżej 21 obiektów', 'połowy zakresu', SMC_RATES_SUMMARY, 'eksperymentalny'])
      expect(def.convention, s).toContain(s);
    for (const t of [def.convention ?? '', def.hint, def.memoryNote ?? '']) {
      expect(guardHits(t)).toEqual([]);
      expect(t).not.toMatch(BANNED);
    }
  });

  it('plakietka MODEL z metodą, karta „opis” z uczciwym podsumowaniem częstości bazowych', () => {
    expect(LAYER_SOURCE.smc).toBe('MODEL');
    expect(layerBadge('smc', { coin: 'BTC', now: T0 })).toMatchObject({
      tone: 'model',
      text: 'MODEL',
      hint: expect.stringMatching(/^MODEL · reguły struktury na zamkniętych świecach: .*eksperymentalny, częstości bazowe z historii BTC \(Binance 5m, sprawdzian 2024–2026\) prawie bez różnicy wobec losowych poziomów$/),
    });
    const card = indicatorCard('smc');
    expect(card.status).toBe('opis');
    expect(card.noise).toBe(SMC_RATES_SUMMARY);
    expect(card.noise).toContain('elementy prawie nie różnią się od losowych poziomów');
    expect(card.noise).not.toContain('nie są jeszcze policzone');
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
    expect(html).toContain('Historia 24 h: także wypełnione luki i zakończone EQ, przygaszone');
    expect(html).not.toContain('Interwał wskaźnika');
    expect(html).toContain('data-walidacja="opis"');
  });
});
