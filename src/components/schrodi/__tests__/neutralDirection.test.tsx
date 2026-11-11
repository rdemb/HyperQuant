import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DeskLedgerSummary } from '../../../utils/deskLedger';
import type { FeatureVec, Forecast, SchrodiModel } from '../../../utils/schrodi';

/**
 * Kot nie podaje stron rynku. Kierunek jest ukryty, dopóki e-proces w dzienniku nie da dowodu (`trust.dir.proofAt`):
 * bez dowodu żadnej etykiety, paska ani zdania o kierunku i żadnych kolorów kupna i sprzedaży (także w rysunku kota);
 * z dowodem neutralna etykieta „P(wzrost 1 h) 54%” bez kolorów stron. Sprawdzamy cały wyrenderowany tekst paneli kota
 * (dymek z rozwiniętymi sekcjami, pasek pod wykresem, karta dziennika) po polsku i po angielsku.
 */

const S = vi.hoisted(() => ({ lang: 'pl' as 'pl' | 'en', cat: null as unknown }));

vi.mock('../../../i18n', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../../i18n')>();
  return { ...m, tr: <T,>(pl: T, en: T): T => (S.lang === 'en' ? en : pl) };
});
vi.mock('../../../state/useDeskLedger', () => ({ useDeskLedger: () => ({ status: 'ready', summary: { cat: S.cat } }) }));
// Sekcje dymka („Jak trafiam”, „O mnie”) są zwinięte; w teście wszystkie rozwinięte, żeby sprawdzić ich tekst
vi.mock('react', async (importOriginal) => {
  const R = await importOriginal<typeof import('react')>();
  const useState = ((init: unknown) => R.useState(init === false ? true : init)) as typeof R.useState;
  const mod = { ...R, useState };
  return { ...mod, default: mod };
});

const T = Date.UTC(2026, 10, 11, 12, 0);
const PLAN = { id: 'p', hash: 'h', at: T - 86_400_000 };
const PROOF = T - 3_600_000;
const head = {
  n: 30,
  lg: 0.2,
  lgMax: 0.3,
  proofAt: null as number | null,
  path: [0, 0.2],
  step: 1,
  brier: 0.24,
  brierBase: 0.25,
  corp: null,
  spiegel: null,
  rel: [],
  drift: { lg: 0, alarm: false, episodes: 0, since: null },
};
/** Sekcja kota w dzienniku; `proofAt` — chwila dowodu kierunku w e-procesie (null = brak dowodu) */
const catWith = (proofAt: number | null) =>
  ({
    model: 'schrodi-v1',
    since: T - 7 * 86_400_000,
    issued: 600,
    slots: 610,
    latest: { t: T, px0: 100_000, pUp: 0.54, pBig: 0.4, thr: 30 },
    scores: {
      n: 600,
      nEff: 150,
      dir: { brier: 0.249, brierBase: 0.25, bss: 0.004, auc: 0.52, hit: 0.51, long: { n: 90, hit: 0.53 }, short: { n: 40, hit: 0.5 }, unsure: 20 },
      big: { brier: 0.2, brierBase: 0.25, bss: 0.2, auc: 0.8, hit: 0.74, reliability: [] },
    },
    trust: { plan: PLAN, big: head, dir: { ...head, proofAt, lg: proofAt === null ? 0.2 : 1.5, lgMax: proofAt === null ? 0.3 : 1.5 }, touch: head, ood: { n: 0, bssBig: null, bssDir: null } },
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
const forecast = (pUp: number, stance: Forecast['stance']): Forecast => ({
  version: 'schrodi-v1',
  t: T,
  price: 100_000,
  pUp,
  stance,
  pBig: 0.4,
  bigUsd: 400,
  med1h: Number.NaN,
  why: groups,
  whyBig: groups,
  levels: { pdh: 101_000, pdl: 99_000, poc: 100_200, vah: 100_600, val: 99_600, vwap: 100_100 },
  x: {} as FeatureVec,
});

/** Strony rynku w dowolnej wielkości liter (LONG, Long, short…) */
const SIDE = /\b(long|short)\b/i;
/** Bieżąca etykieta kierunku z liczbą („P(wzrost 1 h) 54%”); przedziały w wynikach („> 53%”) to pomiar, nie etykieta */
const LABEL = /P\((wzrost|up) 1 h\) \d+%/;
/** Kolory kupna i sprzedaży: klasy Tailwind i zmienne CSS w SVG */
const SIDE_COLOR = /\b(text|bg|stroke|fill)-(buy|sell)\b|--color-(buy|sell)/;
const CASES: [number, Forecast['stance']][] = [
  [0.54, 'long'],
  [0.46, 'short'],
  [0.5, 'unsure'],
];

async function panelHtml(f: Forecast): Promise<string> {
  const { SchrodiPanel } = await import('../SchrodiPanel');
  return renderToStaticMarkup(<SchrodiPanel f={f} model={model} at={T} now={T} stale={false} hist={[]} hour={null} onClose={() => {}} />);
}

async function launcherHtml(f: Forecast): Promise<string> {
  vi.doMock('../useSchrodi', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../useSchrodi')>()),
    useSchrodi: () => ({ status: 'ready', f, model, at: T, hist: [], hour: null }),
  }));
  vi.resetModules();
  const { SchrodiLauncher } = await import('../SchrodiLauncher');
  const html = renderToStaticMarkup(<SchrodiLauncher />);
  vi.doUnmock('../useSchrodi');
  vi.resetModules();
  return html;
}

/** Przycisk paska pod wykresem (po dymku, który rozwinięty useState też otwiera) */
const barOf = (html: string) => html.slice(html.indexOf('aria-label="Schrödi: '));

describe.each(['pl', 'en'] as const)('Kot: kierunek ukryty do dowodu w e-procesie (%s)', (lang) => {
  it('bez dowodu dymek nie pokazuje kierunku ani kolorów stron, a duży ruch i poziomy zostają', async () => {
    S.lang = lang;
    S.cat = catWith(null);
    for (const [pUp, stance] of CASES) {
      const html = await panelHtml(forecast(pUp, stance));
      expect(html, stance).not.toMatch(SIDE);
      expect(html, stance).not.toMatch(LABEL);
      expect(html, stance).not.toMatch(SIDE_COLOR);
      // Bez bloku kierunku (🎯) i bez zdania kota o kierunku
      expect(html, stance).not.toContain('🎯');
      expect(html, stance).not.toMatch(lang === 'en' ? /Direction: P/ : /Kierunek: P/);
      // Sekcje rozwinięte: „O mnie” i wynik na żywo z dziennika są w tekście
      expect(html).toContain(lang === 'en' ? 'Schrödinger&#x27;s cat' : 'kotem Schrödingera');
      expect(html).toContain(lang === 'en' ? 'non-overlapping hours' : 'rozłącznych godzin');
      // Duży ruch i poziomy dalej są
      expect(html).toContain(lang === 'en' ? 'Big move within the hour' : 'Duży ruch w ciągu godziny');
      expect(html).toContain(lang === 'en' ? 'Daily VWAP' : 'VWAP dnia');
      // Pomiar kierunku zostaje z dopiskiem, że kierunek jest ukryty do dowodu
      expect(html).toContain(lang === 'en' ? 'hidden until' : 'ukryty do');
    }
  });

  it('z dowodem dymek pokazuje neutralną etykietę „P(wzrost 1 h)” bez kolorów stron', async () => {
    S.lang = lang;
    S.cat = catWith(PROOF);
    for (const [pUp, stance] of CASES) {
      const html = await panelHtml(forecast(pUp, stance));
      expect(html, stance).not.toMatch(SIDE);
      expect(html).toContain(lang === 'en' ? `P(up 1 h) ${Math.round(pUp * 100)}%` : `P(wzrost 1 h) ${Math.round(pUp * 100)}%`);
      const label = html.match(/<span class="([^"]*)">P\((?:wzrost|up) 1 h\) \d/);
      expect(label?.[1]).not.toMatch(/buy|sell/);
    }
  });

  it('pasek pod wykresem: bez dowodu bez kierunku i kolorów stron (także w rysunku), z dowodem etykieta', async () => {
    S.lang = lang;
    for (const [pUp, stance] of CASES) {
      S.cat = catWith(null);
      const html = await launcherHtml(forecast(pUp, stance));
      expect(html, stance).not.toMatch(SIDE);
      expect(html, stance).not.toMatch(LABEL);
      expect(html, stance).not.toMatch(SIDE_COLOR);
      expect(barOf(html)).toMatch(lang === 'en' ? /move \d+%/ : /ruch \d+%/);

      S.cat = catWith(PROOF);
      const bar = barOf(await launcherHtml(forecast(pUp, stance)));
      expect(bar).toMatch(LABEL);
      expect(bar).not.toMatch(/text-(buy|sell)-ink/);
    }
  });

  it('karta dziennika: bez dowodu bez bieżącej etykiety, wyniki kierunku jako pomiar z dopiskiem', async () => {
    S.lang = lang;
    const { CatLedgerCard } = await import('../../../views/after/CatLedgerCard');
    const html = renderToStaticMarkup(<CatLedgerCard cat={catWith(null)} />);
    expect(html).not.toMatch(SIDE);
    expect(html).not.toMatch(LABEL);
    // Przedziały w wynikach (znaki < i > zakodowane w HTML)
    expect(html).toMatch(/P\((wzrost|up) 1 h\) (&gt;|&lt;) \d+%/);
    expect(html).toContain(lang === 'en' ? 'hidden until' : 'ukryty do');
    expect(renderToStaticMarkup(<CatLedgerCard cat={catWith(PROOF)} />)).toMatch(LABEL);
  });
});
