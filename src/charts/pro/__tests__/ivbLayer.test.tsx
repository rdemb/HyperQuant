import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IndicatorSettings } from '../chart/IndicatorSettings';
import { ivbLegend } from '../chart/ivbLayer';
import { LAYER_SOURCE, layerBadge } from '../chart/layerSources';
import { indicatorCard } from '../indicators/cards';
import { IndicatorEngine } from '../indicators/engine';
import { indicatorDef, indicatorLabel, indicatorsFromLink, parseIndicators, tfAllowed, usesInstanceColor } from '../indicators/registry';
import { fmtDayTime, fmtHm } from '../core/time';
import { guardHits } from '../../../utils/safeguards.mjs';

/** Wskaźnik IVB: legenda ze stanu, wpis w rejestrze z wyborem okna 30 albo 60 min i okno ustawień. */

const OPEN = Date.parse('2026-11-16T14:30:00Z');
const MIN = 60_000;
const fmt = (p: number) => String(p);
const text = (s: Parameters<typeof ivbLegend>[0], now = OPEN + 3 * 3_600_000) =>
  ivbLegend(s, now, fmt)
    .map((p) => p.text)
    .join(' ');

describe('legenda IVB', () => {
  const ivb = { start: OPEN, end: OPEN + 30 * MIN, sessionEnd: Date.parse('2026-11-17T00:00:00Z'), hi: 95200, lo: 94800, complete: true, through: OPEN + 30 * MIN };

  it('okno w czasie lokalnym, szczyt i dołek; w budowie do końca okna', () => {
    expect(text({ kind: 'ok', ivb })).toBe(`NY ${fmtHm(OPEN)}–${fmtHm(OPEN + 30 * MIN)} szczyt 95200 · dołek 94800`);
    expect(text({ kind: 'ok', ivb: { ...ivb, complete: false, through: OPEN + 15 * MIN } })).toContain(`· w budowie do ${fmtHm(OPEN + 30 * MIN)}`);
    expect(guardHits(text({ kind: 'ok', ivb }))).toEqual([]);
  });

  it('brak wartości zawsze z powodem: poza sesją NY z najbliższym otwarciem, interwał, czekanie', () => {
    const now = OPEN - 5 * 3_600_000;
    expect(text({ kind: 'outside', next: OPEN }, now)).toBe(`—, poza sesją NY (otwarcie ${fmtDayTime(OPEN, now)})`);
    expect(text({ kind: 'interval' })).toBe('—, interwał do 30m');
    expect(text({ kind: 'waiting', open: OPEN })).toBe(`—, czekam na pierwszą zamkniętą świecę po otwarciu NY ${fmtHm(OPEN)}`);
    expect(text({ kind: 'gap', open: OPEN })).toBe(`—, brak świec okna od otwarcia NY ${fmtHm(OPEN)}`);
    expect(text(null)).toBe('czekam na świece…');
  });
});

describe('wpis IVB w rejestrze', () => {
  const def = indicatorDef('ivb');

  it('w grupie „Poziomy i rynki prognoz”, na wykresie ceny, okno 30 albo 60 min (domyślnie 30), bez plotów i interwału', () => {
    expect(def).toMatchObject({ tier: 'front', short: 'IVB', group: 'hyperquant', pane: 'price', plots: [], format: 'price', ivb: true });
    expect(def.params).toEqual([expect.objectContaining({ key: 'minutes', def: 30, options: [30, 60] })]);
    expect(tfAllowed(def)).toBe(false);
    expect(usesInstanceColor(def)).toBe(true);
    const [x] = indicatorsFromLink('ivb()');
    expect([x.params.minutes, indicatorLabel(x)]).toEqual([30, 'IVB 30']);
    expect(indicatorsFromLink('ivb(60)')[0].params.minutes).toBe(60);
  });

  it('zapis spoza listy (45) wraca do domyślnego 30, zapisane 60 zostaje', () => {
    const base = { iid: 'ivb1', id: 'ivb', color: '#e9548d', alpha: 1, width: 1, labels: true, visible: true };
    expect(parseIndicators([{ ...base, params: { minutes: 45 } }]).list[0].params.minutes).toBe(30);
    expect(parseIndicators([{ ...base, params: { minutes: 60 } }]).list[0].params.minutes).toBe(60);
  });

  it('opis: okno z kalendarza (14:30 albo 15:30 czasu polskiego), osobno od IB, bez sygnałów; źródło LIVE; karta bez prognozy', () => {
    for (const s of ['nie ma w TradingView', 'Deep-M', '30 albo 60 minut', 'domyślnie 30', '15:30', '14:30', 'nie stała godzina', 'osobne od warstwy Initial balance', 'dopiero po zamknięciu', 'do 30m', 'Sprawdzianu poziomów IVB wobec losowego poziomu jeszcze nie ma'])
      expect(def.convention, s).toContain(s);
    for (const t of [def.convention ?? '', def.hint]) expect(guardHits(t)).toEqual([]);
    expect(LAYER_SOURCE.ivb).toBe('LIVE');
    expect(layerBadge('ivb', { coin: 'BTC', now: OPEN }).hint).toContain('według kalendarza');
    expect(indicatorCard('ivb').status).toBe('opis');
  });

  it('silnik wskaźników: bez wartości świec, nigdy nie zgłasza zmiany', () => {
    const e = new IndicatorEngine();
    e.setInstances(indicatorsFromLink('ivb()'));
    const c = { t: 0, o: 1, h: 1, l: 1, c: 1, v: 1, n: 1 };
    e.sync([{ candle: c }, { candle: { ...c, t: 60_000 } }], 60_000);
    expect(e.runs[0].from).toBe(Number.POSITIVE_INFINITY);
    expect(e.runs[0].out).toEqual([]);
  });

  it('okno ustawień: wybór okna z listy (30, 60) zamiast pola liczbowego, bez interwału', () => {
    const x = indicatorsFromLink('ivb()')[0];
    const html = renderToStaticMarkup(<IndicatorSettings x={x} loaded={100} chart="5m" onChange={() => {}} onClose={() => {}} />);
    expect(html).toMatch(/<select aria-label="Okno od otwarcia NY \(min\)"[^>]*>.*<option value="30"[^>]*>30<\/option><option value="60">60<\/option><\/select>/);
    expect(html).not.toContain('type="number"');
    expect(html).not.toContain('Interwał wskaźnika');
  });
});
