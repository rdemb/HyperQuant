import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  SMC_RATES_SUMMARY,
  SMC_RATE_ELEMENTS,
  SMC_RATE_MEASURES,
  SMC_RATE_TFS,
  type SmcRates,
  loadSmcRates,
  parseSmcRates,
  smcRateText,
  smcRateTf,
  smcRatesHover,
  smcRatesLine,
} from '../chart/smcRates';
import raw from '../data/smcRates.json';

/** Częstości bazowe SMC+HL (S2): plik z badania Backtestera, linia legendy i opis pod krzyżem według smc-hl.md §3 i §8. */

const BANNED = /sygna[łl]|\bsignals?\b|wzrośnie|spadnie|kupuj|sprzedawaj|wejdź|smart money|instytucj|institution|\bbuy\b|\bsell\b/i;
const NB = ' ';
const MIN = 60_000;
const MS = { '5m': 5 * MIN, '15m': 15 * MIN, '1h': 60 * MIN, '4h': 240 * MIN, '1d': 1440 * MIN } as const;
const line = (ms: number, s: SmcRates | null) =>
  smcRatesLine(ms, s)
    .map((p) => p.text)
    .join(' ');

let rates: SmcRates;
beforeAll(async () => {
  rates = await loadSmcRates();
});

describe('plik częstości bazowych', () => {
  it('pasuje do schematu, ma wszystkie 5 interwałów i wszystkie miary', () => {
    const s = parseSmcRates(raw);
    expect(Object.keys(s.interwaly).sort()).toEqual([...SMC_RATE_TFS].sort());
    for (const tf of SMC_RATE_TFS)
      for (const el of SMC_RATE_ELEMENTS) for (const [m] of SMC_RATE_MEASURES[el]) expect(s.interwaly[tf][`${el}.${m}`], `${tf} ${el}.${m}`).toBeDefined();
    expect(() => parseSmcRates({ ...s, interwaly: { ...s.interwaly, '4h': undefined } })).toThrow(/4h/);
  });

  it('źródło: Binance 5m 2020–2026 z kolejnością z 1m, sprawdzian od 2024, data wygenerowania', () => {
    expect(rates.zrodlo).toMatchObject({
      dane: 'Binance BTCUSDT perp, świece 5m 2020–2026, kolejność w świecy z 1m',
      od: '2024-01-01',
      do: '2026-11-07',
      wygenerowano: '2026-11-16',
    });
  });

  it('wniosek zgodny z przedziałem 95% (0 w przedziale: bez różnicy)', () => {
    for (const tf of SMC_RATE_TFS)
      for (const [k, r] of Object.entries(rates.interwaly[tf])) {
        if (r.ci === undefined) continue;
        const [lo, hi] = r.ci;
        if (r.z === 1) expect(lo, `${tf} ${k}`).toBeGreaterThanOrEqual(0);
        else if (r.z === -1) expect(hi, `${tf} ${k}`).toBeLessThanOrEqual(0);
        else expect(lo <= 0 && hi >= 0, `${tf} ${k}`).toBe(true);
      }
  });

  it('kontrola dopasowana do zmienności przy BOS swing. i sweepie na 5m, 15m i 1h, na 4H i 1D jej nie ma', () => {
    for (const tf of ['5m', '15m', '1h'] as const)
      for (const k of ['BOS_swing.dalszy_ruch_ATR', 'BOS_swing.powrot_24', 'sweep.ponowne_wyjscie_24']) expect(rates.interwaly[tf][k].m, `${tf} ${k}`).toBe(1);
    for (const tf of ['4h', '1d'] as const) expect(rates.interwaly[tf]['sweep.ponowne_wyjscie_24'].m).toBeUndefined();
  });

  it('mały plik, ładowany leniwie (bez importu statycznego w kodzie wykresu)', () => {
    const path = fileURLToPath(new URL('../data/smcRates.json', import.meta.url));
    expect(statSync(path).size).toBeLessThan(8_000);
    const src = readFileSync(fileURLToPath(new URL('../chart/smcRates.ts', import.meta.url)), 'utf8');
    expect(src).toContain("import('../data/smcRates.json')");
    expect(src).not.toMatch(/from '\.\.\/data\/smcRates\.json'/);
  });
});

describe('linia legendy (smc-hl.md §8)', () => {
  it('interwał wykresu: 5m, 15m, 1h, 4H, 1D; inne bez częstości z powodem', () => {
    expect(smcRateTf(MS['5m'])).toBe('5m');
    expect(smcRateTf(MS['1d'])).toBe('1d');
    for (const ms of [MIN, 30 * MIN, 120 * MIN, 7 * 1440 * MIN]) {
      expect(smcRateTf(ms)).toBeNull();
      expect(line(ms, rates)).toBe('· częstości bazowe: —: brak częstości dla tego interwału');
    }
    expect(line(MS['5m'], null)).toBe('· częstości bazowe: wczytuję…');
  });

  it('5m: BOS swing. +0,25 ATR, sweep −1,9 pp, FVG CE +1,7 pp, EQ rzadziej; zawsze z n', () => {
    expect(line(MS['5m'], rates)).toBe(
      `· częstości bazowe (BTC 5m, 2024–2026, wobec losowej kontroli, BOS i sweep przy tej samej zmienności): BOS swing.: dalszy ruch większy, +0,25 ATR [0,10; 0,42] (n = 2${NB}452) · sweep: rzadziej ponownie za poziomem, −1,9 pp [−2,4; −1,5] (n = 25${NB}331) · FVG: środek luki dotykany częściej, +1,7 pp [1,2; 2,2] (n = 59${NB}403) · EQ: zebrane albo przełamane rzadziej, −1,8 pp [−3,1; −0,4] (n = 6${NB}000)`
    );
  });

  it('15m i 1h: BOS swing. ok. +0,3 ATR na 15m, na 1h w granicach szumu; sweep ok. 2 pp rzadziej; FVG i EQ bez wyraźnej różnicy', () => {
    const m15 = line(MS['15m'], rates);
    expect(m15).toContain('BOS swing.: dalszy ruch większy, +0,31 ATR [0,08; 0,55] (n = 981)');
    expect(m15).toContain('sweep: rzadziej ponownie za poziomem, −2,2 pp [−3,0; −1,4]');
    expect(m15).toContain(`FVG: bez wyraźnej różnicy (n = 15${NB}751)`);
    expect(m15).toContain(`EQ: bez wyraźnej różnicy (n = 2${NB}079)`);
    const h1 = line(MS['1h'], rates);
    expect(h1).toContain('BOS swing.: bez wyraźnej różnicy (n = 281)');
    expect(h1).toContain('sweep: rzadziej ponownie za poziomem, −2,5 pp [−4,1; −1,0]');
    expect(h1).toContain(`FVG: bez wyraźnej różnicy (n = 3${NB}420)`);
  });

  it('4H: BOS swing. za mało przypadków, sweep wobec zwykłej kontroli z dopiskiem; 1D: za mało przypadków poza FVG', () => {
    const h4 = line(MS['4h'], rates);
    expect(h4).toContain('BOS swing.: —: za mało przypadków (n = 81)');
    expect(h4).toContain('sweep: rzadziej ponownie za poziomem, −4,5 pp [−7,6; −1,7] (n = 576, kontrola bez dopasowania do zmienności)');
    const d1 = line(MS['1d'], rates);
    expect(d1).toContain('(BTC 1D, 2024–2026');
    expect(d1).toContain('BOS swing.: —: za mało przypadków (n = 9)');
    expect(d1).toContain('sweep: —: za mało przypadków (n = 96)');
    expect(d1).toContain('EQ: —: za mało przypadków (n = 25)');
    expect(d1).toContain('FVG: bez wyraźnej różnicy (n = 160)');
  });
});

describe('opis pod krzyżem (smc-hl.md §3)', () => {
  it('BOS na skali swingowej, 1h: wynik, kontrola dopasowana, różnica z przedziałem, n bez niejednoznacznych', () => {
    expect(smcRatesHover(MS['1h'], 'BOS_swing', rates).map((p) => p.text)).toEqual([
      '· BOS, skala swingowa (BTC 1h, 2024–2026, n = 281 bez 10% niejednoznacznych na 1m): dalszy ruch do pierwszego powrotu 2,73 ATR · losowy poziom przy tej samej zmienności i pędzie 2,41 ATR · różnica +0,32 ATR [−0,09; 0,75] · bez wyraźnej różnicy',
      '· BOS, skala swingowa (BTC 1h, 2024–2026, n = 314): powrót za poziom w 24 świecach 82,8% · losowy poziom przy tej samej zmienności i pędzie 84,7% · różnica −1,9 pp [−5,9; 2,2] · bez wyraźnej różnicy',
    ]);
  });

  it('sweep 5m rzadziej niż po losowym knocie; FVG 5m częściej; CHoCH wewn. 5m bez różnicy; 1D za mało', () => {
    expect(smcRateText(rates, '5m', 'sweep', 'ponowne_wyjscie_24')).toBe(
      `sweep (BTC 5m, 2024–2026, n = 25${NB}331): ponownie za poziomem w 24 świecach 87,4% · losowy knot przy tej samej zmienności i pędzie 89,3% · różnica −1,9 pp [−2,4; −1,5] · rzadziej niż po losowym knocie`
    );
    expect(smcRateText(rates, '5m', 'FVG', 'ce_24')).toBe(
      `FVG (BTC 5m, 2024–2026, n = 59${NB}403): środek luki (CE) dotknięty w 24 świecach 80,4% · losowa luka 78,7% · różnica +1,7 pp [1,2; 2,2] · częściej niż przy losowej luce`
    );
    expect(smcRateText(rates, '5m', 'CHoCH_internal', 'dalszy_ruch_ATR')).toMatch(/· bez wyraźnej różnicy$/);
    expect(smcRateText(rates, '1d', 'BOS_swing', 'powrot_24')).toBe('BOS, skala swingowa (BTC 1D, 2024–2026): powrót za poziom w 24 świecach: —: za mało przypadków (n = 11)');
    expect(smcRatesHover(MIN, 'FVG', rates)).toEqual([]);
    expect(smcRatesHover(MS['5m'], 'FVG', null)).toEqual([]);
  });

  it('żaden tekst nie jest zaleceniem ani prognozą', () => {
    for (const tf of SMC_RATE_TFS) {
      expect(line(MS[tf], rates)).not.toMatch(BANNED);
      for (const el of SMC_RATE_ELEMENTS) for (const p of smcRatesHover(MS[tf], el, rates)) expect(p.text).not.toMatch(BANNED);
    }
    expect(SMC_RATES_SUMMARY).not.toMatch(BANNED);
  });
});

describe('podsumowanie (karta, opis, rodowód) zgodne z plikiem', () => {
  const r = (tf: keyof typeof MS, k: string) => {
    const x = rates.interwaly[tf][k];
    if (x.d === undefined) throw new Error(`${tf} ${k}`);
    return x;
  };

  it('BOS swing.: ok. 0,3 ATR na 5m i 15m, 1h w granicach szumu; powrót bez wyraźnej różnicy na 5m i 1h', () => {
    expect(SMC_RATES_SUMMARY).toContain('dalszy ruch jest większy o ok. 0,3 ATR (5m i 15m; 1h w granicach szumu)');
    for (const tf of ['5m', '15m'] as const) {
      expect(Math.round(r(tf, 'BOS_swing.dalszy_ruch_ATR').d! * 10) / 10).toBe(0.3);
      expect(r(tf, 'BOS_swing.dalszy_ruch_ATR').z).toBe(1);
    }
    expect(r('1h', 'BOS_swing.dalszy_ruch_ATR').z).toBe(0);
    expect(r('5m', 'BOS_swing.powrot_24').z).toBe(0);
    expect(r('1h', 'BOS_swing.powrot_24').z).toBe(0);
  });

  it('sweep ok. 2 pp rzadziej na 5m–1h; FVG CE +1,7 pp tylko na 5m; 1D za mało przypadków', () => {
    expect(SMC_RATES_SUMMARY).toContain('rzadziej (o ok. 2 pp) ponownie wychodzi za poziom niż po losowym knocie');
    for (const tf of ['5m', '15m', '1h'] as const) {
      const x = r(tf, 'sweep.ponowne_wyjscie_24');
      expect(x.z).toBe(-1);
      expect(Math.abs(x.d! + 2)).toBeLessThanOrEqual(0.5);
    }
    expect(SMC_RATES_SUMMARY).toContain('(5m: +1,7 pp)');
    expect(r('5m', 'FVG.ce_24').d).toBe(1.7);
    for (const tf of ['15m', '1h', '4h', '1d'] as const) expect(r(tf, 'FVG.ce_24').z).toBe(0);
    expect(SMC_RATES_SUMMARY).toContain('Na 1D za mało przypadków');
    expect(rates.interwaly['1d']['sweep.ponowne_wyjscie_24'].n).toBeLessThan(100);
  });
});
