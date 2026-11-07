import { describe, expect, it } from 'vitest';
import { Coverage } from '../core/coverage';
import { INDICATORS } from '../indicators/registry';
import { DEFAULT_SETTINGS } from '../chart/settings';
import { LAYERS_OFF, inds } from '../chart/templates';
import { LAYER_SOURCE, layerBadge, legendChips, scannerAge, tapeCoveragePct } from '../chart/layerSources';

const NOW = Date.UTC(2026, 10, 3, 16, 20);
const M5 = 5 * 60_000;
const H4 = 4 * 3_600_000;

describe('źródła warstw (LIVE, MODEL, SIM)', () => {
  it('wpis dla każdej warstwy z LAYERS_OFF i każdego wskaźnika front i second (zupełność)', () => {
    for (const k of Object.keys(LAYERS_OFF)) expect(LAYER_SOURCE[k], k).toMatch(/^(LIVE|MODEL|SIM)$/);
    const ids = INDICATORS.filter((d) => d.tier === 'front' || d.tier === 'second').map((d) => d.id);
    expect(ids.length).toBeGreaterThanOrEqual(15);
    for (const id of ids) expect(LAYER_SOURCE[id], id).toMatch(/^(LIVE|MODEL|SIM)$/);
    // Panele pod wykresem z ustawień też mają źródło
    for (const k of ['showVolume', 'showDelta', 'showCvd', 'showVenueCvd', 'showVenueOi', 'showStats']) expect(LAYER_SOURCE[k], k).toBe('LIVE');
  });

  it('modele i symulacja oznaczone jako MODEL i SIM, dane z taśmy i arkusza jako LIVE', () => {
    for (const id of ['rvol', 'regime', 'hawkes', 'cone', 'outcomes', 'absorption', 'showTpoOi']) expect(LAYER_SOURCE[id], id).toBe('MODEL');
    expect(LAYER_SOURCE.pbrange).toBe('SIM');
    for (const id of ['showHeatmap', 'showBubbles', 'showVwap', 'showLiq', 'showWhales', 'twap', 'slippage', 'oiflow']) expect(LAYER_SOURCE[id], id).toBe('LIVE');
  });
});

describe('wiek migawki skanera', () => {
  it('scannerAge(now − 125 s) = „2 min”; do 2 min świeża (null), brak migawki — null', () => {
    expect(scannerAge(NOW - 125_000, NOW)).toBe('2 min');
    expect(scannerAge(NOW - 120_000, NOW)).toBeNull();
    expect(scannerAge(NOW - 30_000, NOW)).toBeNull();
    expect(scannerAge(NOW + 5_000, NOW)).toBeNull();
    expect(scannerAge(null, NOW)).toBeNull();
    expect(scannerAge(NOW - 59 * 60_000 - 59_000, NOW)).toBe('59 min');
    expect(scannerAge(NOW - 75 * 60_000, NOW)).toBe('1 h');
    expect(scannerAge(NOW - 50 * 3_600_000, NOW)).toBe('2 d');
  });
});

describe('pokrycie taśmą jako liczba', () => {
  it('tapeCoveragePct: część przedziału pokryta odcinkami taśmy (dwa odcinki)', () => {
    const cov = new Coverage([
      [1_000, 3_000],
      [5_000, 6_000],
    ]);
    expect(tapeCoveragePct(cov, 0, 10_000)).toBeCloseTo(0.3, 12);
    // [2000, 3000) i [5000, 6000) z [2000, 6000)
    expect(tapeCoveragePct(cov, 2_000, 6_000)).toBeCloseTo(0.5, 12);
    expect(tapeCoveragePct(cov, 7_000, 9_000)).toBe(0);
    // Otwarty odcinek (nagrywanie trwa) liczy się do końca przedziału
    const live = new Coverage();
    live.open(4_000);
    expect(tapeCoveragePct(live, 0, 10_000)).toBeCloseTo(0.6, 12);
    expect(Number.isNaN(tapeCoveragePct(cov, 5, 5))).toBe(true);
  });
});

describe('plakietka warstwy w legendzie', () => {
  it('zwykła warstwa: LIVE, MODEL albo SIM z rejestru', () => {
    expect(layerBadge('showHeatmap', { coin: 'ETH', now: NOW })).toMatchObject({ tone: 'live', text: 'LIVE' });
    expect(layerBadge('regime', { coin: 'BTC', now: NOW })).toMatchObject({ tone: 'model', text: 'MODEL' });
    expect(layerBadge('pbrange', { coin: 'BTC', now: NOW })).toMatchObject({ tone: 'sim', text: 'SIM' });
  });

  it('warstwa skanera: LIVE do 2 min, potem wiek migawki zamiast LIVE, bez migawki „—”', () => {
    expect(layerBadge('showLiq', { coin: 'BTC', now: NOW, asOf: NOW - 60_000 })).toMatchObject({ tone: 'live', text: 'LIVE' });
    expect(layerBadge('showLiq', { coin: 'BTC', now: NOW, asOf: NOW - 4 * 60_000 - 10_000 })).toMatchObject({ tone: 'stale', text: '4 min' });
    expect(layerBadge('showWhales', { coin: 'BTC', now: NOW, asOf: null })).toMatchObject({ tone: 'stale', text: '—' });
  });

  it('poza BTC warstwy tylko z BTC: „—, tylko BTC”; wieloryby skaner publikuje dla każdego rynku', () => {
    expect(layerBadge('showLiq', { coin: 'ETH', now: NOW, asOf: NOW })).toMatchObject({ tone: 'neutral', text: '—, tylko BTC' });
    expect(layerBadge('cone', { coin: 'SOL', now: NOW })).toMatchObject({ text: '—, tylko BTC' });
    expect(layerBadge('outcomes', { coin: 'HYPE', now: NOW })).toMatchObject({ text: '—, tylko BTC' });
    expect(layerBadge('showWhales', { coin: 'ETH', now: NOW, asOf: NOW - 60_000 })).toMatchObject({ tone: 'live', text: 'LIVE' });
  });

  it('legendChips: włączone warstwy rysowane na tym interwale i widoczne wskaźniki front i second, po kolei', () => {
    const s = {
      ...DEFAULT_SETTINGS,
      ...LAYERS_OFF,
      showHeatmap: true,
      showLiq: true,
      showWhales: true,
      showTpo: true,
      indicators: [...inds(['rvol'], ['ema'], ['hawkes'], ['rvol']), ...inds(['regime'], ['regime'])].map((x, i) => (i === 2 || i === 5 ? { ...x, visible: false } : x)),
    };
    const chips = legendChips(s, { coin: 'ETH', now: NOW, intervalMs: M5, asOf: { showWhales: NOW - 5 * 60_000 } });
    expect(chips.map((c) => [c.label, c.text])).toEqual([
      ['TPO', 'LIVE'],
      ['Klastry likw.', '—, tylko BTC'],
      ['Wieloryby', '5 min'],
      ['Mapa ciepła', 'LIVE'],
      ['RVOL', 'MODEL'],
      ['Reżim', 'MODEL'],
    ]);
    // TPO tylko do 30m: na 4h nie jest rysowane, więc nie ma plakietki
    expect(legendChips(s, { coin: 'BTC', now: NOW, intervalMs: H4, asOf: {} }).map((c) => c.key)).not.toContain('showTpo');
  });
});
