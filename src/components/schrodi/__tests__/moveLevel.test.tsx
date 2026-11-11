import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DeskLedgerSummary, ReliabilityBin } from '../../../utils/deskLedger';
import type { FeatureVec, Forecast, SchrodiModel, Snap } from '../../../utils/schrodi';

/**
 * Do awansu kalibracji `cat-cal-v1` kot nie pokazuje szansy dużego ruchu w procentach (procenty są zaniżone): zamiast
 * „ruch 37%” poziom wobec typowej godziny z tercyli szansy w rozstrzygniętych prognozach z rejestru, obok AUC i zdanie
 * o kalibracji. Brak danych to „—” z powodem. Po awansie (jedna flaga) procent wraca.
 */

const S = vi.hoisted(() => ({ lang: 'pl' as 'pl' | 'en', cat: null as unknown }));

vi.mock('../../../i18n', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../../i18n')>();
  return { ...m, tr: <T,>(pl: T, en: T): T => (S.lang === 'en' ? en : pl) };
});
vi.mock('../../../state/useDeskLedger', () => ({ useDeskLedger: () => ({ status: 'ready', summary: { cat: S.cat } }) }));
// Sekcje dymka są zwinięte; w teście rozwinięte, żeby sprawdzić cały tekst
vi.mock('react', async (importOriginal) => {
  const R = await importOriginal<typeof import('react')>();
  const useState = ((init: unknown) => R.useState(init === false ? true : init)) as typeof R.useState;
  const mod = { ...R, useState };
  return { ...mod, default: mod };
});

const MIN = 60_000;
const T = Date.UTC(2026, 10, 11, 12, 0);
// Stały zegar: prognoza z fikstury jest „świeża” niezależnie od dnia uruchomienia testu (bez tego test psuł się po T)
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T + 60_000);
});
afterAll(() => {
  vi.useRealTimers();
});
const PLAN = { id: 'p', hash: 'h', at: T - 86_400_000 };
const head = { n: 30, lg: 0.2, lgMax: 0.3, proofAt: null, path: [0, 0.2], step: 1, brier: 0.24, brierBase: 0.25, corp: null, spiegel: null, rel: [], drift: { lg: 0, alarm: false, episodes: 0, since: null } };

/** Histogram szansy: 10 koszyków po `n` prognoz (rozkład jednostajny → tercyle 1/3 i 2/3) */
const flat = (n: number): ReliabilityBin[] => Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, n, meanP: i / 10 + 0.05, freq: 0.5 }));
/** Rozkład z rejestru (30 dni do 11.11.2026, sekcja kota w summary.json) */
const LIVE_N = [175, 128, 119, 131, 133, 110, 101, 142, 127, 162];
const live = (): ReliabilityBin[] => LIVE_N.map((n, i) => ({ lo: i / 10, hi: (i + 1) / 10, n, meanP: i / 10 + 0.05, freq: 0.5 }));

const catWith = (reliability: ReliabilityBin[], pBig = 0.37) =>
  ({
    model: 'schrodi-v1',
    since: T - 7 * 86_400_000,
    issued: 600,
    slots: 610,
    latest: { t: T, px0: 100_000, pUp: 0.54, pBig, thr: 30 },
    scores: {
      n: 600,
      nEff: 150,
      dir: { brier: 0.249, brierBase: 0.25, bss: 0.004, auc: 0.52, hit: 0.51, long: { n: 90, hit: 0.53 }, short: { n: 40, hit: 0.5 }, unsure: 20 },
      big: { brier: 0.15, brierBase: 0.24, bss: 0.38, auc: 0.878, hit: 0.76, reliability },
    },
    trust: { plan: PLAN, big: head, dir: head, touch: head, ood: { n: 0, bssBig: null, bssDir: null } },
    hour: { plan: PLAN, big: head, dir: { n: 30, brier: 0.25, hit: 0.5 } },
  }) satisfies NonNullable<DeskLedgerSummary['cat']>;

const card = {
  kierunek: {
    '2023_2025': { auc: 0.54, trafnosc: 0.53, long: [0.29, 0.55], short: [0.28, 0.54] },
    '2026': { auc: 0.535, trafnosc: 0.52, long: [0.27, 0.54], short: [0.2, 0.55] },
  },
  ruch: {
    '2023_2025': { auc: 0.84, trafnosc: 0.75, gorne20: 0.92, dolne20: 0.11 },
    '2026': { auc: 0.83, trafnosc: 0.75, gorne20: 0.9, dolne20: 0.1 },
  },
};
const model = { version: 'schrodi-v1', trainedTo: '2026-10', features: [], card } as unknown as SchrodiModel;
const groups = { move: 0.4, vol: -0.2, auction: 0.1, clock: -0.3 };
const forecast = (pBig: number): Forecast => ({
  version: 'schrodi-v1',
  t: T,
  price: 100_000,
  pUp: 0.54,
  stance: 'long',
  pBig,
  bigUsd: 400,
  med1h: Number.NaN,
  why: groups,
  whyBig: groups,
  levels: null,
  x: {} as FeatureVec,
});
/** Historia z wyraźną zmianą zdania o dużym ruchu (12% → 37% w 10 min) */
const hist = (pBig: number): Snap[] => {
  const s = T + 5 * MIN;
  return [
    { s: s - 10 * MIN, pBig: 0.12, pUp: 0.54, why: groups, whyBig: { ...groups, move: -1.6 } },
    { s, pBig, pUp: 0.54, why: groups, whyBig: groups },
  ];
};

async function panelHtml(pBig: number): Promise<string> {
  const { SchrodiPanel } = await import('../SchrodiPanel');
  return renderToStaticMarkup(<SchrodiPanel f={forecast(pBig)} model={model} at={T} now={T} stale={false} hist={hist(pBig)} hour={null} onClose={() => {}} />);
}

async function launcherHtml(pBig: number): Promise<string> {
  const f = forecast(pBig);
  vi.doMock('../useSchrodi', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../useSchrodi')>()),
    useSchrodi: () => ({ status: 'ready', f, model, at: T, hist: hist(pBig), hour: null }),
  }));
  vi.resetModules();
  const { SchrodiLauncher } = await import('../SchrodiLauncher');
  const html = renderToStaticMarkup(<SchrodiLauncher />);
  vi.doUnmock('../useSchrodi');
  vi.resetModules();
  return html;
}

/** Przycisk paska (po dymku, który rozwinięty useState też otwiera) */
const barOf = (html: string) => html.slice(html.indexOf('aria-label="Schrödi: '));
const ariaLabels = (html: string) => [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]);
const titles = (html: string) => [...html.matchAll(/title="([^"]*)"/g)].map((m) => m[1]);

describe('Tercyle szansy dużego ruchu z histogramu rejestru', () => {
  it('rozkład jednostajny: tercyle 1/3 i 2/3, poziomy po obu stronach', async () => {
    const { moveTerciles, moveLevel } = await import('../moveLevel');
    const t = moveTerciles(flat(30))!;
    expect(t.n).toBe(300);
    expect(t.q1).toBeCloseTo(1 / 3, 6);
    expect(t.q2).toBeCloseTo(2 / 3, 6);
    expect(moveLevel(0.2, t)).toBe('calm');
    expect(moveLevel(0.37, t)).toBe('typical');
    expect(moveLevel(0.7, t)).toBe('elevated');
  });

  it('rozkład z rejestru: tercyle z interpolacji w koszykach (0,3158 i 0,6884)', async () => {
    const { moveTerciles, moveLevel } = await import('../moveLevel');
    const t = moveTerciles(live())!;
    expect(t.n).toBe(1328);
    expect(t.q1).toBeCloseTo(0.31578, 4);
    expect(t.q2).toBeCloseTo(0.68845, 4);
    expect(moveLevel(0.3, t)).toBe('calm');
    expect(moveLevel(0.5, t)).toBe('typical');
    expect(moveLevel(0.69, t)).toBe('elevated');
  });

  it('bez podsumowania rejestru powód mówi o braku podsumowania, nie o liczbie rozstrzygnięć', async () => {
    S.lang = 'pl';
    const { moveView } = await import('../moveLevel');
    const v = moveView(0.37, null);
    expect(v.kind).toBe('none');
    expect(v.kind === 'none' && v.reason).toBe('brak podsumowania rejestru');
    const w = moveView(0.37, catWith(flat(9)));
    expect(w.kind === 'none' && w.reason).toContain('90 z 96');
  });

  it('mniej niż 96 rozstrzygnięć albo brak histogramu → null', async () => {
    const { moveTerciles } = await import('../moveLevel');
    expect(moveTerciles(flat(9))).toBeNull();
    expect(moveTerciles([])).toBeNull();
    expect(moveTerciles(undefined)).toBeNull();
  });
});

describe.each(['pl', 'en'] as const)('Kot przed awansem kalibracji: poziom zamiast procentu (%s)', (lang) => {
  const level = lang === 'en' ? 'typical' : 'zwykły';
  const note = lang === 'en' ? 'percentages under calibration, results in the ledger' : 'procenty w trakcie kalibracji, wynik w rejestrze';

  it('dymek: bez procentu szansy ruchu (nagłówek, zdanie kota, zmiana zdania, wykres, „Dlaczego?”), z poziomem, AUC i zdaniem o kalibracji', async () => {
    S.lang = lang;
    S.cat = catWith(flat(30));
    const html = await panelHtml(0.37);
    expect(html).not.toContain('37%');
    expect(html).not.toContain('12%');
    expect(html).not.toMatch(/W 10 takich godzinach|In 10 such hours/);
    expect(html).not.toMatch(/\d pp</);
    for (const a of [...ariaLabels(html), ...titles(html)]) expect(a).not.toContain('%');
    expect(html).toContain(level);
    expect(html).toContain(lang === 'en' ? 'AUC 0.88' : 'AUC 0,88');
    expect(html.toLowerCase()).toContain(note);
    // Zmiana zdania zostaje, ale bez liczb
    expect(html).toContain(lang === 'en' ? 'Change of mind' : 'Zmiana zdania');
  });

  it('pasek: „ruch zwykły” bez znaku %, także w aria-label i podpowiedziach', async () => {
    S.lang = lang;
    S.cat = catWith(flat(30));
    const html = await launcherHtml(0.37);
    const bar = barOf(html);
    expect(bar).toContain(lang === 'en' ? `move ${level}` : `ruch ${level}`);
    expect(bar.replace(/<[^>]*>/g, '')).not.toContain('%');
    for (const a of [...ariaLabels(bar), ...titles(bar)]) expect(a).not.toContain('%');
  });

  it('brak danych (< 96 rozstrzygnięć): „—” z powodem, bez procentu', async () => {
    S.lang = lang;
    S.cat = catWith(flat(9));
    const reason = lang === 'en' ? 'too few resolved forecasts' : 'za mało rozstrzygnięć';
    const bar = barOf(await launcherHtml(0.37));
    expect(bar).toContain(lang === 'en' ? 'move —' : 'ruch —');
    expect(bar).toContain(reason);
    expect(bar.replace(/<[^>]*>/g, '')).not.toContain('%');
    const html = await panelHtml(0.37);
    expect(html).not.toContain('37%');
    expect(html).toContain(reason);
  });

  it('karta dziennika: bieżący poziom zamiast procentu; miary zostają', async () => {
    S.lang = lang;
    const { CatLedgerCard } = await import('../../../views/after/CatLedgerCard');
    const html = renderToStaticMarkup(<CatLedgerCard cat={catWith(flat(30))} />);
    expect(html).not.toContain('37%');
    expect(html).toContain(level);
    expect(html).toContain('AUC');
  });
});

describe('Po awansie (jedna flaga) procent wraca', () => {
  it('pasek pokazuje „ruch 37%”', async () => {
    S.lang = 'pl';
    S.cat = catWith(flat(30));
    vi.doMock('../moveLevel', async (importOriginal) => ({ ...(await importOriginal<typeof import('../moveLevel')>()), MOVE_PCT_PROMOTED: true }));
    const bar = barOf(await launcherHtml(0.37));
    vi.doUnmock('../moveLevel');
    vi.resetModules();
    expect(bar).toContain('ruch 37%');
  });
});

describe('Zdanie kota nazywa okno prognozy (najbliższe 60 min), żeby nie mylić go z bieżącą godziną zegarową', () => {
  it('trzy poziomy w PL i EN zawierają „60 min”', async () => {
    const { catLine } = await import('../SchrodiPanel');
    for (const lang of ['pl', 'en'] as const) {
      S.lang = lang;
      for (const level of ['calm', 'typical', 'elevated'] as const) {
        const line = catLine(forecast(0.37), 'calm', T, false, level);
        expect(line, `${lang} ${level}`).toContain('60 min');
        expect(line, `${lang} ${level}`).not.toMatch(/\d+\s?%/);
      }
    }
    S.lang = 'pl';
  });
});

/** Histogram z publicznego podsumowania rejestru (summary.json, 11.11.2026 12:20 UTC): n i częstość dużego ruchu w koszyku */
const REAL: [number, number][] = [
  [175, 0.0343],
  [128, 0.1094],
  [119, 0.4202],
  [135, 0.5852],
  [141, 0.5957],
  [113, 0.6814],
  [101, 0.7525],
  [142, 0.8732],
  [127, 0.8976],
  [162, 1],
];
const real = (): ReliabilityBin[] => REAL.map(([n, freq], i) => ({ lo: i / 10, hi: (i + 1) / 10, n, meanP: i / 10 + 0.05, freq }));

describe('Częstość dużego ruchu przy bieżącym poziomie (z rozliczeń rejestru)', () => {
  it('histogram z rejestru: spokojny 2, zwykły 6, podwyższony 9 na 10; n ok. 448 w każdym tercylu', async () => {
    const { moveTerciles, levelFreq } = await import('../moveLevel');
    const t = moveTerciles(real())!;
    const calm = levelFreq(real(), t, 'calm')!;
    const typical = levelFreq(real(), t, 'typical')!;
    const elevated = levelFreq(real(), t, 'elevated')!;
    // Koszyki częściowo w tercylu: n rozdzielone liniowo, częstość ważona tą samą wagą
    expect(calm.freq).toBeCloseTo(0.18994, 4);
    expect(typical.freq).toBeCloseTo(0.64431, 4);
    expect(elevated.freq).toBeCloseTo(0.92151, 4);
    expect([calm.tenths, typical.tenths, elevated.tenths]).toEqual([2, 6, 9]);
    expect([calm.n, typical.n, elevated.n]).toEqual([448, 448, 448]);
  });

  it('za mało rozstrzygnięć → brak częstości', async () => {
    const { moveView } = await import('../moveLevel');
    const v = moveView(0.37, catWith(flat(9)));
    expect(v.kind).toBe('none');
  });

  it.each(['pl', 'en'] as const)('dymek (%s): zdanie z częstością pod poziomem; pasek bez liczby', async (lang) => {
    S.lang = lang;
    S.cat = catWith(real());
    const html = await panelHtml(0.95);
    expect(html).toContain(
      lang === 'en'
        ? 'In the record, at this level a big move happened in 9 of 10 hours (n 448).'
        : 'W rejestrze przy tym poziomie duży ruch był w 9 na 10 godzin (n 448).'
    );
    const bar = barOf(await launcherHtml(0.95)).replace(/<[^>]*>/g, '');
    expect(bar).not.toMatch(/\d+ (na|of) 10/);
    expect(bar).not.toContain('448');
  });

  it('brak podsumowania albo za mało danych: zdania nie ma', async () => {
    S.lang = 'pl';
    S.cat = catWith(flat(9));
    expect(await panelHtml(0.37)).not.toContain('W rejestrze przy tym poziomie');
    S.cat = null;
    expect(await panelHtml(0.37)).not.toContain('W rejestrze przy tym poziomie');
  });
});
