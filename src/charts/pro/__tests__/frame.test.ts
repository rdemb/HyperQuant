import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FRAME_SIZE,
  type FrameInput,
  type FrameRatio,
  composeFrame,
  defaultFrameTitle,
  frameAlt,
  frameFileName,
  frameWarnings,
  mapQuality,
  tapeQuality,
  titleProblems,
  visibleSpan,
  wrapLines,
} from '../chart/frame';
import type { LayoutNumber } from '../chart/layoutNumbers';
import { brandedScreenshot, qualityText } from '../chart/screenshot';
import { STATIONS } from '../chart/stations';
import { asCanvas, ctxOf, fakeCanvas, fakeDocument } from './fakeCanvas';

// Czas lokalny (pasek jakości i nazwa pliku pokazują godzinę użytkownika, jak oś wykresu)
const T = new Date(2026, 10, 7, 16, 22).getTime();
const M5 = 5 * 60_000;
const Q = { tapePct: 0.124, mapPct: 0.47 };

beforeEach(() => vi.stubGlobal('document', fakeDocument()));
afterEach(() => vi.unstubAllGlobals());

const input = (ratio: FrameRatio, over: Partial<FrameInput> = {}): FrameInput => ({
  canvas: asCanvas(fakeCanvas(1600, 800)),
  ratio,
  title: 'Kokpit BTC\nVWAP: +1,2σ (LIVE)',
  time: T,
  source: 'BTC-PERP · Hyperliquid · 1m · Footprint',
  quality: Q,
  layersShown: 4,
  ...over,
});

describe('pasek jakości', () => {
  it('pokrycie taśmą i mapą w procentach i godzina lokalna', () => {
    expect(qualityText(Q, T)).toBe('taśma 12% · mapa 47% · 16:22');
  });

  it('brak danych to „—”, nigdy 0', () => {
    expect(qualityText({ tapePct: null, mapPct: 0.47 }, T)).toBe('taśma — · mapa 47% · 16:22');
    expect(qualityText({ tapePct: null, mapPct: null }, T)).toBe('taśma — · mapa — · 16:22');
    expect(qualityText({ tapePct: Number.NaN, mapPct: null }, T)).toBe('taśma — · mapa — · 16:22');
  });

  it('zaokrąglenie w dół: 100% tylko przy pełnym pokryciu, zmierzone 0% zostaje 0%', () => {
    expect(qualityText({ tapePct: 0.999, mapPct: 1 }, T)).toBe('taśma 99% · mapa 100% · 16:22');
    expect(qualityText({ tapePct: 0, mapPct: 0.004 }, T)).toBe('taśma 0% · mapa 0% · 16:22');
  });

  it('zrzut ekranu zawsze ma pasek jakości pod wykresem (pasek marki nad nim bez zmian)', () => {
    const chart = asCanvas(fakeCanvas(1000, 500));
    const out = brandedScreenshot(chart, 500, 'BTC-PERP · Hyperliquid · 1m', new Date(T), { tapePct: null, mapPct: 0.47 });
    // Gęstość 2×: pasek marki 40 px i pasek jakości 24 px
    expect([out.width, out.height]).toEqual([1000, 500 + 80 + 48]);
    const ctx = ctxOf(out);
    expect(ctx.images[0]).toMatchObject({ src: chart, args: [0, 80] });
    const strip = ctx.texts.find((t) => t.text === 'taśma — · mapa 47% · 16:22');
    expect(strip?.y).toBeGreaterThan(580);
    expect(ctx.texts.map((t) => t.text)).toContain('hyperquant.tech');
  });
});

describe('Klatka: composeFrame', () => {
  it.each([
    ['16:9', 1200, 675],
    ['1:1', 1080, 1080],
  ] as const)('%s daje dokładnie %i × %i', (ratio, w, h) => {
    const out = composeFrame(input(ratio));
    expect([out.width, out.height]).toEqual([w, h]);
    expect(FRAME_SIZE[ratio]).toEqual({ w, h });
  });

  it.each(['16:9', '1:1'] as const)('%s: tytuł z liczbą, godzina i źródło, obraz w kadrze, pasek jakości i hyperquant.tech w rogu', (ratio) => {
    const o = input(ratio);
    const out = composeFrame(o);
    const ctx = ctxOf(out);
    const texts = ctx.texts.map((t) => t.text);
    expect(texts).toContain('Kokpit BTC');
    expect(texts).toContain('VWAP: +1,2σ (LIVE)');
    expect(texts.some((t) => t.includes('16:22') && t.includes('BTC-PERP · Hyperliquid · 1m · Footprint'))).toBe(true);
    const strip = ctx.texts.find((t) => t.text === 'taśma 12% · mapa 47% · 16:22');
    expect(strip?.y).toBeGreaterThan(out.height - 60);
    const brand = ctx.texts.find((t) => t.text === 'hyperquant.tech');
    expect(brand?.align).toBe('right');
    expect(brand?.x).toBeGreaterThan(out.width - 60);
    expect(brand?.y).toBeGreaterThan(out.height - 60);
    // Obraz w całości w kadrze, z zachowaniem proporcji 2:1 (nic nie przycięte)
    const img = ctx.images.find((i) => i.src === o.canvas);
    expect(img).toBeDefined();
    const [x, y, w, h] = img!.args;
    expect(w / h).toBeCloseTo(2, 5);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + w).toBeLessThanOrEqual(out.width);
    // Pod tytułem i nad paskiem jakości
    const meta = ctx.texts.find((t) => t.text.includes('BTC-PERP'));
    expect(y).toBeGreaterThan(meta!.y);
    expect(y + h).toBeLessThanOrEqual(strip!.y);
  });

  it('długi tytuł: najwyżej kilka linii, ostatnia z wielokropkiem, każda w szerokości kadru', () => {
    const title = Array.from({ length: 80 }, (_, i) => `słowo${i}`).join(' ');
    const out = composeFrame(input('16:9', { title }));
    const lines = ctxOf(out).texts.filter((t) => t.text.startsWith('słowo'));
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(4);
    expect(lines[lines.length - 1].text.endsWith('…')).toBe(true);
  });
});

describe('zawijanie tekstu', () => {
  const m = (s: string) => s.length * 10;

  it('słowa do szerokości, „\\n” zaczyna nową linię', () => {
    expect(wrapLines('aa bb cc dd', 50, m, 5)).toEqual(['aa bb', 'cc dd']);
    expect(wrapLines('aa\nbb cc', 100, m, 5)).toEqual(['aa', 'bb cc']);
  });

  it('za dużo linii — ostatnia z wielokropkiem w szerokości', () => {
    const out = wrapLines('aa bb cc dd ee ff', 50, m, 2);
    expect(out).toHaveLength(2);
    expect(out[1].endsWith('…')).toBe(true);
    expect(m(out[1])).toBeLessThanOrEqual(50);
  });

  it('słowo dłuższe niż linia jest cięte', () => {
    for (const l of wrapLines('abcdefghijkl', 50, m, 5)) expect(m(l)).toBeLessThanOrEqual(50);
  });
});

describe('Klatka: tekst alternatywny', () => {
  it('te same liczby co tytuł, pokrycie taśmą i mapą, godzina i źródło', () => {
    const alt = frameAlt({ title: 'Kokpit BTC\nVWAP: +1,2σ (LIVE); RVOL: 1,3× (MODEL)', time: T, source: 'BTC-PERP · Hyperliquid · 1m', quality: Q });
    for (const s of ['+1,2σ', 'LIVE', '1,3×', 'MODEL', '12%', '47%', '16:22', 'BTC-PERP · Hyperliquid · 1m', 'hyperquant.tech']) expect(alt).toContain(s);
  });

  it('brak pokrycia — „—” z powodem, nie 0%; opis Czwórki dołączony', () => {
    const alt = frameAlt({
      title: 'Czwórka BTC',
      time: T,
      source: 'Hyperliquid',
      quality: { tapePct: null, mapPct: null, tapeWhy: 'Czwórka liczy ze świec', mapWhy: 'tylko BTC' },
      body: 'Czwórka BTC, 07.11 16:22: Paliwo ±1%: pod 3,5M · nad 3,4M (LIVE).',
    });
    for (const s of ['—', 'Czwórka liczy ze świec', 'tylko BTC', 'pod 3,5M · nad 3,4M (LIVE)']) expect(alt).toContain(s);
    expect(alt).not.toMatch(/(?<![\d,])0%/);
  });
});

describe('Klatka: ostrzeżenia, nazwa pliku, tytuł', () => {
  it('powyżej 4 warstw ceny ostrzeżenie (z liczbą warstw), do 4 bez niego', () => {
    expect(frameWarnings(5)).toHaveLength(1);
    expect(frameWarnings(5)[0]).toMatch(/5/);
    expect(frameWarnings(4)).toEqual([]);
    expect(frameWarnings(0)).toEqual([]);
  });

  it('plik hyperquant-<układ>-<RRRRMMDD-GGmm>.png w czasie lokalnym', () => {
    expect(frameFileName('cockpit', T)).toBe('hyperquant-cockpit-20261107-1622.png');
    expect(frameFileName('day-map', new Date(2026, 0, 5, 7, 3).getTime())).toBe('hyperquant-day-map-20260105-0703.png');
  });

  const NUMS: LayoutNumber[] = [
    { label: 'VWAP', value: '+1,2σ', badge: 'LIVE', hint: '' },
    { label: 'Budżet · Londyn', value: '45%', badge: 'MODEL', hint: '' },
    { label: 'Klaster likw.', value: '—', badge: 'LIVE', hint: '', note: 'tylko BTC' },
  ];

  it('domyślny tytuł: pytanie układu i trzy liczby nagłówka z plakietkami', () => {
    expect(defaultFrameTitle('Kto teraz naciska?', NUMS)).toBe('Kto teraz naciska?\nVWAP: +1,2σ (LIVE); Budżet · Londyn: 45% (MODEL); Klaster likw.: — (tylko BTC)');
    expect(defaultFrameTitle('P?', [{ label: 'Wieloryby', value: '+4,2M', badge: 'LIVE', hint: '', note: '4 min' }])).toBe('P?\nWieloryby: +4,2M (LIVE, 4 min)');
    expect(defaultFrameTitle('P?', [{ label: 'RVOL', value: '—', badge: 'MODEL', hint: '' }])).toBe('P?\nRVOL: — (brak danych)');
    // Panel bez nagłówka (drugi wykres układu, powtórka): samo pytanie
    expect(defaultFrameTitle('P?', null)).toBe('P?');
  });

  it('rada w tytule blokuje pobranie i mówi dlaczego; pusty tytuł też', () => {
    expect(titleProblems('Kup teraz: VWAP +1,2σ').join('\n')).toMatch(/wezwanie do transakcji.*Kup/);
    expect(titleProblems('Long od 80 500').join('\n')).toMatch(/gotowe wejście/);
    expect(titleProblems('Buy the dip').join('\n')).toMatch(/wezwanie do transakcji/);
    expect(titleProblems('   ')).toHaveLength(1);
    expect(titleProblems('VWAP: — (tylko BTC)')).toEqual([]);
  });

  it('domyślne tytuły każdego układu przechodzą bezpieczniki', () => {
    for (const s of STATIONS) expect(titleProblems(defaultFrameTitle(s.question, NUMS)), s.id).toEqual([]);
  });
});

describe('Klatka: jakość danych wykresu', () => {
  const map = (share: number, oiBtc = 30_000) => ({ asOf: T, coverage: { share, oiBtc } });

  it('mapa: pokrycie open interest z aktualnej mapy BTC', () => {
    expect(mapQuality({ status: 'ready', map: map(0.47) }, 'BTC', false)).toEqual({ mapPct: 0.47 });
    expect(mapQuality({ status: 'delayed', map: map(0.47) }, 'BTC', false)).toEqual({ mapPct: 0.47 });
  });

  it('mapa — z powodem: inny rynek, powtórka, nieaktualna mapa, brak OI, wczytywanie', () => {
    expect(mapQuality({ status: 'ready', map: map(0.47) }, 'ETH', false)).toEqual({ mapPct: null, mapWhy: expect.stringMatching(/tylko BTC/) });
    for (const q of [
      mapQuality({ status: 'ready', map: map(0.47) }, 'BTC', true),
      mapQuality({ status: 'stale', map: map(0.47) }, 'BTC', false),
      mapQuality({ status: 'ready', map: map(0, 0) }, 'BTC', false),
      mapQuality({ status: 'loading', map: null }, 'BTC', false),
    ]) {
      expect(q.mapPct).toBeNull();
      expect(q.mapWhy?.length).toBeGreaterThan(3);
    }
  });

  it('taśma: ułamek pokrycia albo „—” z powodem', () => {
    expect(tapeQuality(0.5)).toEqual({ tapePct: 0.5 });
    expect(tapeQuality(Number.NaN)).toEqual({ tapePct: null, tapeWhy: expect.any(String) });
  });

  it('widoczny zakres: od pierwszej do końca ostatniej widocznej świecy, najwyżej do teraz', () => {
    const T0 = Date.UTC(2026, 10, 7, 12);
    const at = (i: number) => T0 + i * M5;
    expect(visibleSpan({ from: 2.2, to: 5.6 }, 10, at, M5, T0 + 100 * M5)).toEqual({ from: at(2), to: at(7) });
    // Ostatnia świeca w toku: koniec na „teraz”, nie na końcu świecy
    expect(visibleSpan({ from: 5, to: 14 }, 10, at, M5, at(9) + 60_000)).toEqual({ from: at(5), to: at(9) + 60_000 });
    expect(visibleSpan(null, 10, at, M5, T0)).toBeNull();
    expect(visibleSpan({ from: 0, to: 3 }, 0, at, M5, T0)).toBeNull();
  });
});
