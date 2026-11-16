import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IndicatorSettings } from '../chart/IndicatorSettings';
import { LAYER_SOURCE, layerBadge } from '../chart/layerSources';
import { SMC_INK, smcLegend } from '../chart/smcLayer';
import { selectSmc } from '../chart/smcSelect';
import { type SBar, smcStructure } from '../core/smcStructure';
import { fmtDayTime } from '../core/time';
import { indicatorCard } from '../indicators/cards';
import { IndicatorEngine } from '../indicators/engine';
import { MENU_GROUPS, indicatorDef, indicatorLabel, indicatorsFromLink, parseIndicators, swatchColor, tfAllowed, usesInstanceColor } from '../indicators/registry';
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
    expect(t.startsWith('eksperymentalny · struktura: wewn. mieszana · swing. mieszana · FVG 1 · EQH 0 · EQL 0')).toBe(true);
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

  it('opis: nasze definicje, known, CE, limity, eksperymentalny bez częstości; bez zakazanych słów i myślników', () => {
    for (const s of ['napisane od zera', 'znany od zamknięcia świecy j + L', '3, 5, 10, 20, 50', 'dotknięcie środka luki (CE)', 'najwyżej 21 obiektów', 'połowy zakresu', 'Częstości bazowe', 'eksperymentalny'])
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
    expect(html).toContain('Historia 24 h: także wypełnione luki i zakończone EQ, przygaszone');
    expect(html).not.toContain('Interwał wskaźnika');
    expect(html).toContain('data-walidacja="opis"');
  });
});
