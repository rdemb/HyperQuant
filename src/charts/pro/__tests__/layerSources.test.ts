import { describe, expect, it } from 'vitest';
import { Coverage } from '../core/coverage';
import { INDICATORS } from '../indicators/registry';
import { DEFAULT_SETTINGS } from '../chart/settings';
import { LAYERS_OFF, inds } from '../chart/templates';
import { LAYER_SOURCE, WAIT_TEXT, chipsFor, layerBadge, legendChips, liqScan, scannerAge, tapeCoveragePct, whalesScan } from '../chart/layerSources';
import { readInputs } from '../chart/layoutInputs';
import { layoutNumbers } from '../chart/layoutNumbers';

const NOW = Date.UTC(2026, 10, 3, 16, 20);
const M5 = 5 * 60_000;
const H4 = 4 * 3_600_000;

describe('źródła warstw (LIVE, MODEL, SIM)', () => {
  it('wpis dla każdego przełącznika show* z ustawień wykresu i każdego wskaźnika front i second (zupełność)', () => {
    // Klucze z ustawień, nie z listy w teście: nowa warstwa albo panel bez źródła nie przejdzie
    const show = Object.keys(DEFAULT_SETTINGS).filter((k) => /^show[A-Z]/.test(k));
    expect(show).toEqual(expect.arrayContaining(Object.keys(LAYERS_OFF)));
    expect(show).toEqual(expect.arrayContaining(['showVolume', 'showCvd', 'showStats']));
    for (const k of show) expect(LAYER_SOURCE[k], k).toMatch(/^(LIVE|MODEL|SIM)$/);
    const ids = INDICATORS.filter((d) => d.tier === 'front' || d.tier === 'second').map((d) => d.id);
    expect(ids.length).toBeGreaterThanOrEqual(15);
    for (const id of ids) expect(LAYER_SOURCE[id], id).toMatch(/^(LIVE|MODEL|SIM)$/);
  });

  it('modele i symulacja oznaczone jako MODEL i SIM, dane z taśmy i arkusza jako LIVE', () => {
    for (const id of ['rvol', 'regime', 'hawkes', 'cone', 'outcomes', 'absorption', 'showTpoOi']) expect(LAYER_SOURCE[id], id).toBe('MODEL');
    expect(LAYER_SOURCE.pbrange).toBe('SIM');
    for (const id of ['showHeatmap', 'showBubbles', 'showVwap', 'showLiq', 'showWhales', 'twap', 'slippage', 'oiflow']) expect(LAYER_SOURCE[id], id).toBe('LIVE');
  });

  it('podpowiedź plakietki MODEL i SIM nazywa metodę każdego klucza', () => {
    const model = Object.entries(LAYER_SOURCE).filter(([, v]) => v !== 'LIVE');
    expect(model.length).toBe(8);
    for (const [key, src] of model) expect(layerBadge(key, { coin: 'BTC', now: NOW }).hint, key).toMatch(new RegExp(`^${src} · [^:]+: `));
    expect(layerBadge('rvol', { coin: 'BTC', now: NOW }).hint).toMatch(/^MODEL · mediana 20 dni: /);
    expect(layerBadge('cone', { coin: 'BTC', now: NOW }).hint).toMatch(/^MODEL · HAR: /);
    expect(layerBadge('regime', { coin: 'BTC', now: NOW }).hint).toMatch(/^MODEL · BOCPD: /);
    expect(layerBadge('hawkes', { coin: 'BTC', now: NOW }).hint).toMatch(/^MODEL · Hawkes: /);
    expect(layerBadge('pbrange', { coin: 'BTC', now: NOW }).hint).toMatch(/^SIM · metoda Nilla: /);
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

  it('warstwa skanera: LIVE do 2 min, potem wiek migawki zamiast LIVE, bez migawki „—” z powodem', () => {
    expect(layerBadge('showLiq', { coin: 'BTC', now: NOW, scan: { asOf: NOW - 60_000 } })).toMatchObject({ tone: 'live', text: 'LIVE' });
    expect(layerBadge('showLiq', { coin: 'BTC', now: NOW, scan: { asOf: NOW - 4 * 60_000 - 10_000 } })).toMatchObject({ tone: 'stale', text: '4 min' });
    expect(layerBadge('showWhales', { coin: 'BTC', now: NOW, scan: { why: 'powód' } })).toMatchObject({ tone: 'stale', text: '—', hint: 'powód' });
  });

  it('poza BTC warstwy tylko z BTC: „—, tylko BTC”; wieloryby skaner publikuje dla każdego rynku', () => {
    expect(layerBadge('showLiq', { coin: 'ETH', now: NOW, scan: { asOf: NOW } })).toMatchObject({ tone: 'neutral', text: '—, tylko BTC' });
    expect(layerBadge('cone', { coin: 'SOL', now: NOW })).toMatchObject({ text: '—, tylko BTC' });
    expect(layerBadge('outcomes', { coin: 'HYPE', now: NOW })).toMatchObject({ text: '—, tylko BTC' });
    expect(layerBadge('showWhales', { coin: 'ETH', now: NOW, scan: { asOf: NOW - 60_000 } })).toMatchObject({ tone: 'live', text: 'LIVE' });
  });

  it('mapa likwidacji wczytywana albo bez adresu danych: plakietka z tym samym powodem co nagłówek układu', () => {
    const header = (liq: { status: string; map: null }) =>
      layoutNumbers('fuel', readInputs('fuel', fakeStore(), { model: null, liq, whales: null, whalesConfigured: true }))[1].hint;
    for (const status of ['loading', 'unconfigured', 'error', 'stale']) {
      const liq = { status, map: null };
      const chip = layerBadge('showLiq', { coin: 'BTC', now: NOW, scan: liqScan(liq) });
      expect(chip.text, status).toBe('—');
      expect(chip.hint, status).toBe(header(liq));
    }
    expect(liqScan({ status: 'loading', map: null })).toEqual({ why: WAIT_TEXT });
    expect(liqScan({ status: 'unconfigured', map: null })).toEqual({ why: 'Mapa likwidacji niedostępna w tej wersji strony' });
    expect(liqScan({ status: 'delayed', map: { asOf: NOW - 1 } })).toEqual({ asOf: NOW - 1 });
    // Wieloryby: bez adresu danych, nieaktualny plik, brak rynku
    expect(whalesScan(null, 'BTC', false)).toEqual({ why: 'Warstwa wielorybów niedostępna w tej wersji strony' });
    expect(whalesScan(null, 'BTC', true)).toMatchObject({ why: expect.stringContaining('nie publikuje') });
    expect(whalesScan({ asOf: NOW, markets: { BTC: {} } }, 'ETH', true)).toMatchObject({ why: expect.stringContaining('ETH') });
    expect(whalesScan({ asOf: NOW, markets: { BTC: {} } }, 'BTC', true)).toEqual({ asOf: NOW });
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
    const chips = legendChips(s, { coin: 'ETH', now: NOW, intervalMs: M5, scan: { showWhales: { asOf: NOW - 5 * 60_000 } } });
    expect(chips.map((c) => [c.label, c.text])).toEqual([
      ['TPO', 'LIVE'],
      ['Klastry likw.', '—, tylko BTC'],
      ['Wieloryby', '5 min'],
      ['Mapa ciepła', 'LIVE'],
      ['RVOL', 'MODEL'],
      ['Reżim', 'MODEL'],
    ]);
    // TPO tylko do 30m: na 4h nie jest rysowane, więc nie ma plakietki
    expect(legendChips(s, { coin: 'BTC', now: NOW, intervalMs: H4, scan: {} }).map((c) => c.key)).not.toContain('showTpo');
  });

  it('chipsFor: zwinięta legenda pokazuje tylko nie-LIVE (stożek i TPO OI jako MODEL), zestaw samych LIVE — nic', () => {
    const s = { ...DEFAULT_SETTINGS, ...LAYERS_OFF, showTpo: true, showTpoOi: true, showVwap: true, showHeatmap: true, indicators: inds(['cone'], ['twap']) };
    const chips = legendChips(s, { coin: 'BTC', now: NOW, intervalMs: M5, scan: {} });
    expect(chips.map((c) => c.key)).toEqual(['showVwap', 'showTpo', 'showTpoOi', 'showHeatmap', 'cone', 'twap']);
    expect(chipsFor(chips, 'folded').map((c) => [c.key, c.text])).toEqual([
      ['showTpoOi', 'MODEL'],
      ['cone', 'MODEL'],
    ]);
    // Telefon: nie-LIVE najpierw, potem LIVE (nic nie ginie); pełna legenda w kolejności warstw
    expect(chipsFor(chips, 'compact').map((c) => c.key)).toEqual(['showTpoOi', 'cone', 'showVwap', 'showTpo', 'showHeatmap', 'twap']);
    expect(chipsFor(chips, 'full')).toEqual(chips);
    const live = legendChips({ ...s, showTpoOi: false, indicators: inds(['twap']) }, { coin: 'BTC', now: NOW, intervalMs: M5, scan: {} });
    expect(live.length).toBeGreaterThan(0);
    expect(chipsFor(live, 'folded')).toEqual([]);
    // Wiek migawki skanera i „—, tylko BTC” też zostają w zwiniętej legendzie
    const scan = legendChips({ ...s, showTpoOi: false, showLiq: true, showWhales: true, indicators: [] }, { coin: 'ETH', now: NOW, intervalMs: M5, scan: { showWhales: { asOf: NOW - 3 * 60_000 } } });
    expect(chipsFor(scan, 'folded').map((c) => c.text)).toEqual(['—, tylko BTC', '3 min']);
  });
});

/** Magazyn bez danych (wejścia nagłówka do porównania powodów). */
function fakeStore() {
  const series = { loadState: 'loading' as const, load: async () => {}, candlesNow: () => [] };
  return {
    coin: 'BTC',
    serverNow: () => NOW,
    lastPrice: () => 100_000,
    series: () => series,
    exactBook: () => null,
    zeroKnown: { covers: () => false },
    orders: { range: () => [] },
  };
}
