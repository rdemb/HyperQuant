// Strona /wyniki (PL) i /en/results/ (EN): rozliczenie prognoz dziennika z podsumowania, wyniku weryfikacji i laboratorium.
import { describe, expect, it } from 'vitest';
import { TITLE_GUARDS, guardHits } from '../../src/utils/safeguards.mjs';
import { isDeskLedgerSummary } from '../../src/utils/deskLedger.ts';
import { isLabReport } from '../../src/utils/folkloreLab.ts';
import { PATHS, sitePages, sitemapEntries } from './pages.mjs';
import { RESULTS_PATHS, resultsPage } from './results.mjs';
import { postPage } from './render.mjs';
import { validatePost } from './posts.mjs';

const POST = { title: 'Środa nad VWAP tygodnia', description: 'BTC-PERP stoi nad VWAP tygodnia. Poziomy i prawdopodobieństwa do 13:00.', date: '2026-11-12T07:00:00+01:00', type: 'article', section: 'Mapa dnia', price: 80777, levels: [{ label: 'PDH', price: 82088 }] };

const SITE = { url: 'https://example.org/HQ/', repo: 'https://github.com/x/y', cssVersion: 'c', jsVersion: 'j' };
const H = 3_600_000;
const D = 24 * H;
const ASOF = Date.UTC(2026, 10, 12, 3, 35);
const cov = (rate, nEff, kupiecP) => ({ rate, n: 1980, nEff, kupiecP });

/** Podsumowanie w formacie z 12.11.2026 (bez pól 2.2) */
function todaySummary() {
  const ret = (n, crpss, kupiecP) => ({ n, crps: 0.003, crpsBench: 0.0031, crpss, pitHist: Array(10).fill(n / 10), cov90: cov(0.9192, n / 4, kupiecP), cov60: cov(0.6977, n / 4, 0.0001), covAci: cov(0.9025, n / 4, 0.7059) });
  const head = (n, lg, proofAt) => ({ n, lg, lgMax: Math.max(lg, 0), proofAt, path: [0, lg], step: 1, brier: 0.15, brierBase: 0.2, corp: null });
  return {
    v: 1,
    coin: 'BTC',
    asOf: ASOF,
    model: 'ledger-har-fhs-v1',
    head: { hash: 'a'.repeat(64), lines: 23940 },
    pending: 12,
    voided: 3,
    latest: { ret: [], touch: null },
    scores: {
      ret: { 60: ret(1980, 0.016953, 0.0736), 240: ret(1968, 0.0036, 0.6913) },
      touch: { n: 480, pairs: 1290, brier: 0.0734, brierBase: 0.1226, bss: 0.4022, bssClim: 0.4022, brierDist: 0.0818, bssDist: 0.1028, pairsDist: 1290, reliability: [], calibration: [] },
    },
    ots: [],
    slotStamps: 96,
    participation: { issued: 2880, skipped: 4, gaps: [] },
    ab: {
      h: 60,
      model: 'ledger-har-fhs-bocpd-v1',
      blockDays: 14,
      registeredAt: Date.UTC(2026, 9, 22, 17, 51),
      current: { start: Date.UTC(2026, 10, 6), end: Date.UTC(2026, 10, 20), n: 587, crpsA: 0.00183, crpsB: 0.0018, diff: null },
      closing: null,
      last: { start: Date.UTC(2026, 9, 23), end: Date.UTC(2026, 10, 6), n: 1338, crpsA: 0.00195, crpsB: 0.00194, diff: { d: -0.00001, lo: -0.000026, hi: 0.000006 } },
      latest: null,
    },
    cat: {
      model: 'schrodi-v1',
      since: ASOF - 30 * D,
      issued: 1404,
      slots: 1404,
      latest: null,
      scores: {
        n: 1404,
        nEff: 351,
        dir: { brier: 0.25, brierBase: 0.2496, bss: -0.0018, auc: 0.53, hit: 0.525, long: { n: 409, hit: 0.533 }, short: { n: 216, hit: 0.509 }, unsure: 779 },
        big: {
          brier: 0.1535,
          brierBase: 0.2409,
          bss: 0.3627,
          auc: 0.871,
          hit: 0.755,
          reliability: [
            { lo: 0, hi: 0.5, n: 700, meanP: 0.2, freq: 0.15 },
            { lo: 0.5, hi: 1, n: 704, meanP: 0.7, freq: 0.8 },
          ],
        },
      },
      trust: { plan: { id: 'schrodi-trust-v1', hash: 'b'.repeat(64), at: Date.UTC(2026, 9, 28, 11, 48) }, big: head(349, 2.6512, Date.UTC(2026, 9, 30, 14)), dir: head(349, -0.29, null), touch: head(321, 0.734, Date.UTC(2026, 9, 31, 16)), ood: { n: 0, bssBig: null, bssDir: null } },
      hour: { plan: { id: 'schrodi-hour-v1', hash: 'c'.repeat(64), at: Date.UTC(2026, 9, 28, 14, 30) }, big: head(348, -0.2808, null) },
    },
    method: 'hq-ledger-v1',
  };
}

/** To samo z polami z 2.2 (miary rejestru) */
function newSummary() {
  const s = todaySummary();
  Object.assign(s.scores.ret[60], {
    kupiec60: { n: 495, x: 358, cover: 0.7232, lr: 32.839, p: 0 },
    pit: { n: 495, bins: [43, 36, 50, 63, 73, 49, 64, 59, 28, 30], chi2: 42.4747, p: 0 },
    crpssCi: { value: 0.017, lo: 0.0018, hi: 0.0349, days: 22 },
    aciInf: { n: 1980, inf: 0, share: 0 },
  });
  Object.assign(s.scores.ret[240], {
    kupiec60: { n: 123, x: 96, cover: 0.7805, lr: 18.0909, p: 0 },
    pit: { n: 123, bins: [8, 9, 12, 15, 18, 22, 18, 11, 4, 6], chi2: 24.8862, p: 0.0031 },
    crpssCi: { value: 0.0036, lo: -0.0181, hi: 0.0249, days: 21 },
    aciInf: { n: 1968, inf: 163, share: 0.0828 },
  });
  s.scores.touch.bssCi = { value: 0.4022, lo: 0.3321, hi: 0.4706, days: 22 };
  s.scores.touch.bssDistCi = { value: 0.1028, lo: 0.0358, hi: 0.1737, days: 22 };
  s.cat.scores.big.bssSeasonal = { value: 0.0515, lo: -0.0883, hi: 0.1965, days: 14, n: 1259 };
  return s;
}

const VERIFY = { v: 1, ok: true, at: ASOF - 6 * H, run: 'https://github.com/rdemb/HyperQuant/actions/runs/1', commit: 'e'.repeat(40), lines: ['✓ kolejność i spójność rekordów'] };

const stats = (n, verdict, q = 0.66) => ({ n, rate: 0.5, p0: 0.5, effect: 0, lo: -0.05, hi: 0.05, p: 0.5, q, verdict, dropped: { ambiguous: 0, narrow: 0, timeout: 0, gap: 0 }, from: 0, to: 1 });
const fwd = (n, verdict) => ({ n, rate: 0.5, p0: 0.5, effect: 0, lo: -0.1, hi: 0.1, e: 0.5, eAgainst: 0.6, cs: null, verdict, path: [], events: [] });
const LAB = {
  v: 1,
  coin: 'BTC',
  asOf: ASOF - H,
  version: 'lab-v1',
  catalogHash: 'd'.repeat(64),
  registeredAt: Date.UTC(2026, 9, 22, 15, 50),
  registrationHash: 'f'.repeat(64),
  forwardFrom: Date.UTC(2026, 9, 23),
  data: { hourlyFrom: 0, hourlyTo: 1, hours: 1, dailyFrom: 0, days: 1, fundingFrom: 0 },
  hypotheses: [
    { id: 'round-res', family: 'folklore', hist: stats(344, 'none'), fwd: fwd(29, 'collecting') },
    { id: 'ny-10am', family: 'folklore', hist: stats(163, 'none'), fwd: fwd(13, 'collecting') },
    { id: 'cme-gap', family: 'folklore', hist: stats(23, 'few', null), fwd: fwd(3, 'collecting') },
    { id: 'ctrl-placebo', family: 'control', hist: stats(451, 'none', null), fwd: fwd(39, 'collecting') },
  ],
};

const text = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
const sectionIds = (html) => [...html.matchAll(/<section class="block" id="([a-z-]+)"/g)].map((m) => m[1]);
const jsonLd = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
const results = (summary, opts = {}) => ({ summary, verify: VERIFY, lab: LAB, now: ASOF + 10 * 60_000, ...opts });

describe('strona /wyniki: rozliczenie prognoz dziennika', () => {
  it('fikstury przechodzą strażniki formatu strony', () => {
    expect(isDeskLedgerSummary(todaySummary())).toBe(true);
    expect(isDeskLedgerSummary(newSummary())).toBe(true);
    expect(isLabReport(LAB)).toBe(true);
  });

  it('(1) z fikstury podsumowania: PL pod wyniki/, EN pod en/results/, wszystkie 7 sekcji w kolejności, liczby z n', () => {
    expect(RESULTS_PATHS).toEqual({ pl: 'wyniki/', en: 'en/results/' });
    const pl = resultsPage(SITE, 'pl', results(newSummary()));
    const en = resultsPage(SITE, 'en', results(newSummary()));
    expect(pl.path).toBe('wyniki/');
    expect(en.path).toBe('en/results/');
    for (const p of [pl, en]) expect(sectionIds(p.html)).toEqual(['intro', 'returns', 'touch', 'cat', 'plans', 'verify', 'refuted']);
    expect(pl.html).toContain('<html lang="pl">');
    expect(en.html).toContain('<html lang="en">');
    const t = text(pl.html);
    // 1. stan na chwilę podsumowania i link do Po sesji z liczbami na żywo
    expect(t).toContain('Stan na 12.11.2026, 03:35 UTC');
    expect(pl.html).toContain('href="../#after"');
    // 2. zwroty: n, CRPSS z przedziałem i liczbą dób, pokrycia, Kupiec, ACI
    expect(t).toContain('1980');
    expect(t).toContain('0,0170 [0,0018; 0,0349], 22 doby');
    expect(t).toContain('69,8%');
    expect(t).toContain('91,9%');
    expect(t).toContain('p = 0,074 (n = 495 rozłącznych)');
    expect(t).toContain('p < 0,001 (n = 495 rozłącznych, pokrycie 72,3%)');
    expect(t).toContain('8,3% (163 z 1968)');
    expect(t).toMatch(/90% z konstrukcji/);
    // 3. dotknięcia: Brier i oba BSS z przedziałem
    expect(t).toContain('0,0734 (n = 1290 par)');
    expect(t).toContain('0,402 [0,332; 0,471], 22 doby');
    expect(t).toContain('0,103 [0,036; 0,174], 22 doby');
    // 4. kot: AUC, BSS wobec stałej i sezonowej, średnie p i częstość, zdanie o kalibracji
    expect(t).toContain('0,871');
    expect(t).toContain('0,363');
    expect(t).toContain('0,052 [−0,088; 0,197], 14 dób; n = 1259');
    expect(t).toContain('45,1%'); // średnie p = (700·0,2 + 704·0,7) / 1404
    expect(t).toContain('47,6%'); // częstość = (700·0,15 + 704·0,8) / 1404
    expect(t).toMatch(/kalibracj\p{L}* [^.]*w toku/iu);
    // 5. plany: nazwa, start, kryterium, stan
    for (const id of ['ab-v1', 'schrodi-trust-v1', 'schrodi-hour-v1']) expect(t).toContain(id);
    // Plan bez rekordu w dzienniku nie występuje (pojawia się w dniu rejestracji)
    for (const id of ['ab-v2', 'cat-cal-v1', 'hrel-v1']) expect(t).not.toContain(id);
    expect(t).not.toMatch(/zapowiedzian/);
    expect(t).toContain('22.10.2026');
    expect(t).toMatch(/różnica nieudowodniona/);
    expect(t).toMatch(/E = 448/);
    // 6. weryfikacja: znaczek, czas, link do przebiegu, komenda
    expect(pl.html).toContain('class="status status--ok"');
    expect(t).toContain('11.11.2026, 21:35 UTC');
    expect(pl.html).toContain('href="https://github.com/rdemb/HyperQuant/actions/runs/1"');
    expect(t).toContain('node scripts/verify-ledger.mjs --dir ../ledger');
    // 7. reguły, które się nie potwierdziły (bez kontroli i bez reguł z za małą próbą); brak potwierdzenia to nie obalenie
    expect(t).toContain('Co się nie potwierdziło');
    expect(t).not.toMatch(/obaliliśmy/);
    expect(t).toMatch(/które nie przeszły testu zapisanego w dzienniku albo jeszcze go nie przeszły/);
    expect(t).toContain('Okrągły poziom jako opór');
    expect(t).toMatch(/n = 344/);
    expect(t).not.toContain('placebo');
    expect(t).not.toMatch(/Luka CME/);
    // EN po angielsku, kropka dziesiętna
    const te = text(en.html);
    expect(te).toContain('As of 12 Nov 2026, 03:35 UTC');
    expect(te).toContain('0.0170 [0.0018; 0.0349], 22 days');
    expect(te).toContain('Round level as resistance');
    expect(te).toContain('What did not hold up');
    expect(te).not.toMatch(/refuted/i);
    expect(te).not.toMatch(/[ąęłńśźż]/);
  });

  it('(5) plany tylko z rekordem w dzienniku: plan bez rekordu nie ma wiersza, z rekordem ma', () => {
    const none = todaySummary();
    delete none.cat.hour;
    const t0 = text(resultsPage(SITE, 'pl', results(none)).html);
    expect(t0).not.toContain('schrodi-hour-v1');
    expect(t0).toContain('schrodi-trust-v1');
    expect(text(resultsPage(SITE, 'pl', results(todaySummary())).html)).toContain('schrodi-hour-v1');
    const t2 = text(resultsPage(SITE, 'pl', { summary: null, verify: null, lab: null, now: ASOF }).html);
    expect(t2).not.toContain('schrodi-trust-v1');
  });

  it('(7) reguła wykluczona w teście do przodu: „efekt wykluczony w teście do przodu”', () => {
    const lab = { ...LAB, hypotheses: [{ id: 'round-res', family: 'folklore', hist: stats(344, 'none'), fwd: fwd(60, 'excluded') }] };
    expect(text(resultsPage(SITE, 'pl', results(newSummary(), { lab })).html)).toContain('efekt wykluczony w teście do przodu (n = 60)');
    expect(text(resultsPage(SITE, 'en', results(newSummary(), { lab })).html)).toContain('effect ruled out in the forward test (n = 60)');
  });

  it('(1) adresy z hreflang (PL, EN, x-default) i dane strukturalne Dataset z linkiem do gałęzi ledger', () => {
    const pl = resultsPage(SITE, 'pl', results(newSummary()));
    expect(pl.html).toContain('<link rel="canonical" href="https://example.org/HQ/wyniki/">');
    expect(pl.html).toContain('<link rel="alternate" hreflang="pl" href="https://example.org/HQ/wyniki/">');
    expect(pl.html).toContain('<link rel="alternate" hreflang="en" href="https://example.org/HQ/en/results/">');
    expect(pl.html).toContain('<link rel="alternate" hreflang="x-default" href="https://example.org/HQ/en/results/">');
    const ld = jsonLd(pl.html)['@graph'];
    const ds = ld.find((x) => x['@type'] === 'Dataset');
    expect(ds).toBeTruthy();
    expect(ds.description.length).toBeGreaterThanOrEqual(50);
    expect(JSON.stringify(ds)).toContain('https://github.com/rdemb/hyperquant-data/tree/ledger');
    expect(ds.dateModified).toBe(new Date(ASOF).toISOString());
  });

  it('(2) dzisiejsze podsumowanie bez pól 2.2: „—” z powodem zamiast przedziałów, testu Kupca 60% i BSS sezonowego', () => {
    const pl = resultsPage(SITE, 'pl', results(todaySummary()));
    const t = text(pl.html);
    expect(t).toContain('0,017'); // CRPSS bez przedziału zostaje
    expect(t).toMatch(/— \(przedział: brak w tym podsumowaniu\)/);
    expect(t).toMatch(/— \(test 60%: brak w tym podsumowaniu\)/);
    expect(t).toMatch(/— \(udział: brak w tym podsumowaniu\)/);
    expect(t).not.toMatch(/undefined|NaN|null/);
    const en = text(resultsPage(SITE, 'en', results(todaySummary())).html);
    expect(en).toMatch(/— \(interval: not in this summary\)/);
  });

  it('(2) brak plików przy budowaniu: strona powstaje, każda dana „—” z powodem', () => {
    const pl = resultsPage(SITE, 'pl', { summary: null, verify: null, lab: null, now: ASOF });
    expect(sectionIds(pl.html)).toEqual(['intro', 'returns', 'touch', 'cat', 'plans', 'verify', 'refuted']);
    const t = text(pl.html);
    expect(t).toMatch(/— \(podsumowanie dziennika niedostępne przy budowaniu strony\)/);
    expect(t).toMatch(/— \(wynik weryfikacji niedostępny przy budowaniu strony\)/);
    expect(t).toMatch(/— \(raport laboratorium niedostępny przy budowaniu strony\)/);
    expect(t).not.toMatch(/undefined|NaN|null/);
    // Plik w nieznanym formacie: jak brak
    const bad = text(resultsPage(SITE, 'pl', results({ v: 2 }, { verify: { ok: 'tak' }, lab: { v: 1 } })).html);
    expect(bad).toMatch(/podsumowanie dziennika w nieznanym formacie/);
    expect(bad).toMatch(/wynik weryfikacji w nieznanym formacie/);
    // Wynik weryfikacji starszy niż 36 h: znaczek „nieaktualna”
    const old = resultsPage(SITE, 'pl', results(newSummary(), { verify: { ...VERIFY, at: ASOF - 40 * H } }));
    expect(old.html).toContain('class="status status--stale"');
    const failed = resultsPage(SITE, 'pl', results(newSummary(), { verify: { ...VERIFY, ok: false } }));
    expect(failed.html).toContain('class="status status--bad"');
  });

  it('(3) w mapie strony obie wersje i link w stopce każdej strony serwisu i pod każdym wpisem bloga', () => {
    const pages = sitePages(SITE, { results: results(newSummary()) });
    const paths = sitemapEntries(SITE, pages).map((e) => e.loc);
    expect(paths).toContain('https://example.org/HQ/wyniki/');
    expect(paths).toContain('https://example.org/HQ/en/results/');
    // Bez danych strona też powstaje (build lokalny bez sieci)
    expect(sitePages(SITE).some((p) => p.path === 'wyniki/' && p.html)).toBe(true);
    for (const p of pages.filter((x) => x.html)) {
      const rel = p.path === '404.html' ? SITE.url : '../'.repeat(p.path.split('/').filter(Boolean).length);
      const href = `${rel}${p.lang === 'en' ? 'en/results/' : 'wyniki/'}`;
      expect(p.html, p.path).toMatch(new RegExp(`<footer[\\s\\S]*href="${href.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"`));
    }
    const { post } = validatePost('2026-11-12-mapa-dnia', POST, `## Kontekst

${'Cena stoi nad dołkiem piątku i pod VWAP tygodnia. '.repeat(20)}`);
    const html = postPage(SITE, post, {});
    expect(html).toMatch(/<p class="results-link">[^<]*<a href="\.\.\/\.\.\/wyniki\/">/);
  });

  it('(4) bez znacznika script poza danymi strukturalnymi; CSP jak blog', () => {
    for (const lang of ['pl', 'en']) {
      const html = resultsPage(SITE, lang, results(newSummary())).html;
      const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
      expect(scripts).toEqual(['<script type="application/ld+json">']);
      expect(html).toContain("script-src 'self'");
      expect(html).not.toMatch(/\son[a-z]+=/i);
    }
  });

  it('(5) bez słów rady i kierunku (bezpieczniki tytułu Klatki), bez nazw procesu i prywatnych ścieżek', () => {
    for (const s of [newSummary(), todaySummary(), null])
      for (const lang of ['pl', 'en']) {
        const t = text(resultsPage(SITE, lang, results(s)).html);
        expect(guardHits(t, TITLE_GUARDS).map((h) => h.fragment)).toEqual([]);
        // Bez ścieżek lokalnych w treści strony
        expect(t).not.toMatch(/[A-Z]:\\|\\Users\\|\/home\//i);
      }
  });
});

describe('strona /wyniki: link w stopce aplikacji', () => {
  it('stopka desku prowadzi do wyników w języku interfejsu', async () => {
    const { readFileSync } = await import('node:fs');
    const shell = readFileSync(new URL('../../src/shell/AppShell.tsx', import.meta.url), 'utf8');
    expect(shell).toMatch(/tr\('\.\/wyniki\/', '\.\/en\/results\/'\)/);
    expect(PATHS.results).toEqual(RESULTS_PATHS);
  });
});
