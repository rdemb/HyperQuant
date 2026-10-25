// Testy parserów i przebiegu „dry-run” potoku danych publicznych (fixture'y w kształcie dokumentacji źródeł).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FILES,
  NEWS_FEEDS,
  PAGES_BASE,
  USER_AGENT,
  categorize,
  cleanLink,
  decodeEntities,
  makeGetter,
  mergeNews,
  parseBeaReleaseDates,
  parseCot,
  parseDifficulty,
  parseFng,
  parseGdeltTone,
  parseHashrate,
  parseMempoolFees,
  parseRrp,
  parseRss,
  parseTga,
  parseTreasuryYieldXml,
  runPipeline,
  treasuryMonths,
} from './fetch-public-data.mjs';

const fx = (name) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const fxJson = (name) => JSON.parse(fx(name));

describe('RSS/Atom', () => {
  it('decodeEntities obsługuje encje nazwane i numeryczne', () => {
    expect(decodeEntities('A &amp; B &#8217;x&#x2019; &lt;i&gt; &quot;q&quot; &nbsp;')).toBe('A & B ’x’ <i> "q"  ');
  });

  it('cleanLink usuwa parametry utm_*, zostawia pozostałe', () => {
    expect(cleanLink('https://a.com/x?utm_source=rss&id=7&utm_medium=r#top')).toBe('https://a.com/x?id=7#top');
    expect(cleanLink('https://a.com/x?utm_source=rss')).toBe('https://a.com/x');
    expect(cleanLink('javascript:alert(1)')).toBeNull();
  });

  it('parseRss: CDATA, encje, utm, zapis tylko tytułu/linku/źródła/czasu/kategorii', () => {
    const items = parseRss(fx('coindesk.xml'), { source: 'CoinDesk', category: 'crypto' });
    expect(items).toHaveLength(2); // bez daty i z linkiem javascript: — odrzucone
    expect(items[0]).toEqual({
      title: 'Bitcoin Holds $108K as Traders Eye FOMC & CPI',
      link: 'https://www.coindesk.com/markets/2026/10/20/bitcoin-holds-108k',
      source: 'CoinDesk',
      time: Date.UTC(2026, 9, 20, 14, 5),
      category: 'crypto',
    });
    expect(items[1].title).toBe('SEC Delays Decision on Spot SOL ETF ’Again’');
    expect(items[1].category).toBe('regulation');
    for (const it of items) expect(Object.keys(it).sort()).toEqual(['category', 'link', 'source', 'time', 'title']);
  });

  it('parseRss: Atom <entry> z <link rel="alternate" href> i tytułem HTML', () => {
    const [item] = parseRss(fx('atom.xml'), { source: 'Example', category: 'crypto' });
    expect(item.title).toBe('Ethereum upgrade goes live');
    expect(item.link).toBe('https://example.org/news/eth-upgrade?ref=home');
    expect(item.time).toBe(Date.UTC(2026, 9, 20, 9, 30));
  });

  it('parseRss: kanał Fed — kategoria Enforcement → regulacje, reszta → makro', () => {
    const items = parseRss(fx('fed.xml'), { source: 'Federal Reserve', category: 'macro' });
    expect(items.map((i) => i.category)).toEqual(['regulation', 'macro']);
    expect(items[0].link).toBe('https://www.federalreserve.gov/newsevents/pressreleases/enforcement20261016a.htm');
  });

  it('categorize: regulacyjne słowa kluczowe w kanałach krypto', () => {
    expect(categorize('CFTC charges exchange', 'crypto')).toBe('regulation');
    expect(categorize('Bitcoin rallies', 'crypto')).toBe('crypto');
    expect(categorize('Employment Situation Summary', 'macro')).toBe('macro');
  });

  it('mergeNews: deduplikacja po linku i tytule, sortowanie malejąco, limit, kwoty kategorii', () => {
    const base = Date.UTC(2026, 9, 20, 12);
    const crypto = Array.from({ length: 80 }, (_, i) => ({
      title: `Crypto ${i}`,
      link: `https://c.com/${i}`,
      source: 'C',
      time: base + i * 60000,
      category: 'crypto',
    }));
    const macro = [
      { title: 'Fed statement', link: 'https://f.gov/1', source: 'Fed', time: base - 86400000, category: 'macro' },
      { title: 'Fed statement', link: 'https://f.gov/1b', source: 'Fed', time: base - 86400000 - 1, category: 'macro' },
    ];
    const dupLink = { ...crypto[5], title: 'Inny tytuł', time: crypto[5].time - 1 };
    const future = { title: 'Z przyszłości', link: 'https://c.com/f', source: 'C', time: base + 86400000 * 3, category: 'crypto' };
    const out = mergeNews([...crypto, ...macro, dupLink, future], 60, base + 2 * 3600000);
    expect(out).toHaveLength(60);
    expect(out.filter((i) => i.category === 'macro')).toHaveLength(1);
    expect(out.some((i) => i.title === 'Inny tytuł' || i.title === 'Z przyszłości')).toBe(false);
    for (let i = 1; i < out.length; i++) expect(out[i].time).toBeLessThanOrEqual(out[i - 1].time);
  });
});

describe('Parsery makro', () => {
  it('treasuryMonths: bieżący i poprzedni miesiąc (YYYYMM), przejście roku', () => {
    expect(treasuryMonths(new Date(Date.UTC(2026, 9, 21)))).toEqual(['202610', '202609']);
    expect(treasuryMonths(new Date(Date.UTC(2027, 0, 5)))).toEqual(['202701', '202612']);
  });

  it('parseTreasuryYieldXml: NEW_DATE, BC_2YEAR, BC_10YEAR (m:null → null)', () => {
    expect(parseTreasuryYieldXml(fx('treasury.xml'))).toEqual([
      { date: '2026-10-01', y2: 4.78, y10: 5.24 },
      { date: '2026-10-02', y2: 4.81, y10: null },
    ]);
  });

  it('parseTga: tylko wiersz „TGA Closing Balance”, open_today_bal w $ mln → $ mld, rosnąco', () => {
    expect(parseTga(fxJson('tga.json'))).toEqual([
      { date: '2026-10-19', value: 965.045 },
      { date: '2026-10-20', value: 973.653 },
    ]);
  });

  it('parseRrp: suma totalAmtAccepted per dzień, $ → $ mld, rosnąco', () => {
    expect(parseRrp(fxJson('rrp.json'))).toEqual([
      { date: '2026-10-20', value: 0.23 },
      { date: '2026-10-21', value: 0.237 },
    ]);
  });

  it('parseCot: pozycje netto TFF (lev. funds, asset managers, dealerzy), OI, rosnąco', () => {
    expect(parseCot(fxJson('cot.json'))).toEqual([
      { date: '2026-10-06', levNet: 5731 - 12583, assetMgrNet: 5174 - 1642, dealerNet: 6974 - 4635, oi: 21432 },
      { date: '2026-10-13', levNet: 5520 - 11364, assetMgrNet: 5079 - 1437, dealerNet: 6646 - 4805, oi: 20752 },
    ]);
  });

  it('parseFng / parseGdeltTone (średnie godzinowe)', () => {
    expect(parseFng(fxJson('fng.json'))).toEqual([
      { time: 1792454400000, value: 45, classification: 'Neutral' },
      { time: 1792540800000, value: 38, classification: 'Fear' },
    ]);
    expect(parseGdeltTone(fxJson('gdelt.json'))).toEqual([
      { time: Date.UTC(2026, 9, 20, 0), tone: -1.5 },
      { time: Date.UTC(2026, 9, 20, 1), tone: 0.5 },
    ]);
  });

  it('mempool.space: opłaty, korekta trudności, hashrate', () => {
    expect(parseMempoolFees(fxJson('mempool-fees.json'))).toEqual({ fastestFee: 4, halfHourFee: 3, hourFee: 2, economyFee: 1, minimumFee: 1 });
    expect(parseDifficulty(fxJson('mempool-difficulty.json'))).toEqual({
      progressPercent: 44.39,
      difficultyChange: 1.93,
      remainingBlocks: 1121,
      estimatedRetargetDate: 1793361035000,
    });
    expect(parseHashrate(fxJson('mempool-hashrate.json'))).toEqual([
      { time: 1792368000000, hashrate: 1.05e21 },
      { time: 1792454400000, hashrate: 1.08e21 },
    ]);
  });

  it('parseBeaReleaseDates: PKB i PCE tego samego dnia łączone, tylko przyszłe', () => {
    const out = parseBeaReleaseDates(fxJson('bea.json'), Date.UTC(2026, 9, 21));
    expect(out.map((e) => [e.id, e.timeUtcMs, e.kind])).toEqual([
      ['GDP_PCE-2026-10-29', Date.UTC(2026, 9, 29, 12, 30), 'GDP_PCE'],
      ['GDP_PCE-2027-07-29', Date.UTC(2027, 6, 29, 12, 30), 'GDP_PCE'],
      ['GDP_PCE-2027-08-25', Date.UTC(2027, 7, 25, 12, 30), 'GDP_PCE'],
      ['GDP_PCE-2027-09-01', Date.UTC(2027, 8, 1, 12, 30), 'GDP_PCE'],
    ]);
    expect(out[0].name).toMatch(/PKB.*PCE/);
    expect(out[2].name).toMatch(/PKB/);
    expect(out[2].name).not.toMatch(/PCE/);
    expect(out[3].name).toMatch(/PCE/);
    expect(out[0].sourceUrl).toBe('https://www.bea.gov/news/schedule');
  });
});

// Atrapa fetch: trasy URL → fixture; nieznane hosty i wskazane wzorce zwracają błąd
function fakeFetch({ fail = [], prev = {} } = {}) {
  const calls = [];
  const routes = [
    [/coindesk\.com/, () => fx('coindesk.xml')],
    [/federalreserve\.gov\/feeds/, () => fx('fed.xml')],
    [/home\.treasury\.gov/, () => fx('treasury.xml')],
    [/fiscaldata/, () => fx('tga.json')],
    [/newyorkfed/, () => fx('rrp.json')],
    [/cftc\.gov/, () => fx('cot.json')],
    [/alternative\.me/, () => fx('fng.json')],
    [/gdeltproject/, () => fx('gdelt.json')],
    [/fees\/recommended/, () => fx('mempool-fees.json')],
    [/difficulty-adjustment/, () => fx('mempool-difficulty.json')],
    [/hashrate\/3m/, () => fx('mempool-hashrate.json')],
    [/apps\.bea\.gov/, () => fx('bea.json')],
  ];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith(PAGES_BASE)) {
      const name = url.slice(PAGES_BASE.length);
      if (prev[name]) return new Response(JSON.stringify(prev[name]), { status: 200 });
      return new Response('nope', { status: 404 });
    }
    if (fail.some((re) => re.test(url))) throw new TypeError('fetch failed');
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) return new Response('not found', { status: 404 });
    return new Response(hit[1](), { status: 200 });
  };
  return { impl, calls };
}

describe('makeGetter', () => {
  it('limit czasu podany przy zapytaniu zastępuje domyślny (Treasury odpowiada po ok. 17 s)', async () => {
    const after30ms = (_url, init) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve(new Response('ok')), 30);
        init.signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(init.signal.reason);
        });
      });
    const get = makeGetter(after30ms, 10);
    await expect(get('https://example.test/a')).rejects.toThrow();
    await expect(get('https://example.test/a', 'text', 500)).resolves.toBe('ok');
  });
});

describe('runPipeline — dry-run ze wstrzykniętym fetch', () => {
  const now = new Date(Date.UTC(2026, 9, 21, 12, 0));

  it('zapisuje wszystkie pliki z kopertą {generatedAt, source, attribution, data, parts}; błąd jednego źródła nie przerywa reszty', async () => {
    const { impl, calls } = fakeFetch({ fail: [/newyorkfed/] });
    const written = {};
    const summary = await runPipeline({ fetchImpl: impl, now, write: async (f, obj) => (written[f] = obj), log: () => {} });

    expect(Object.keys(written).sort()).toEqual(FILES.map((f) => f.file).sort());
    for (const env of Object.values(written)) {
      expect(env.generatedAt).toBe(now.toISOString());
      expect(typeof env.source).toBe('string');
      expect(typeof env.attribution).toBe('string');
      expect(env.data && typeof env.data).toBe('object');
    }
    // RRP padł, brak poprzedniej wersji → null z uczciwym błędem; reszta makro działa
    expect(written['macro.json'].data.rrp).toBeNull();
    expect(written['macro.json'].parts.rrp.ok).toBe(false);
    expect(written['macro.json'].data.ust.length).toBeGreaterThan(0);
    expect(written['macro.json'].parts.ust).toEqual({ ok: true, asOf: now.toISOString() });
    // Nagłówki: tylko dostępne fixture'y (CoinDesk + Fed); pozostałe kanały 404 nie przerywają
    expect(written['news.json'].data.items.length).toBe(4);
    expect(written['sentiment.json'].attribution).toMatch(/alternative\.me/);
    expect(written['sentiment.json'].attribution).toMatch(/GDELT Project/);
    expect(written['calendar.json'].data.bea.length).toBeGreaterThan(0);
    expect(summary.failedParts).toContain('macro.json:rrp');
    // Nagłówek User-Agent i limit czasu na każdym żądaniu
    for (const c of calls) {
      expect(c.init.headers['User-Agent']).toBe(USER_AGENT);
      expect(c.init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(calls.some((c) => c.url.includes('field_tdr_date_value_month=202610'))).toBe(true);
    expect(calls.some((c) => c.url.includes('field_tdr_date_value_month=202609'))).toBe(true);
    expect(NEWS_FEEDS.every((f) => calls.some((c) => c.url === f.url))).toBe(true);
  });

  it('fallback: przy błędzie bierze część z poprzedniej wersji opublikowanej na Pages (z jej datą)', async () => {
    const prevAsOf = '2026-10-21T10:30:00.000Z';
    const prev = {
      'macro.json': {
        generatedAt: prevAsOf,
        data: { rrp: [{ date: '2026-10-20', value: 0.2 }] },
        parts: { rrp: { ok: true, asOf: prevAsOf } },
      },
    };
    const { impl } = fakeFetch({ fail: [/newyorkfed/], prev });
    const written = {};
    await runPipeline({ fetchImpl: impl, now, write: async (f, obj) => (written[f] = obj), log: () => {} });
    expect(written['macro.json'].data.rrp).toEqual([{ date: '2026-10-20', value: 0.2 }]);
    expect(written['macro.json'].parts.rrp.ok).toBe(false);
    expect(written['macro.json'].parts.rrp.asOf).toBe(prevAsOf);
  });

  it('plik bez żadnych danych (wszystkie źródła i fallback zawiodły) nie jest zapisywany', async () => {
    const { impl } = fakeFetch({ fail: [/mempool\.space/] });
    const written = {};
    const summary = await runPipeline({ fetchImpl: impl, now, write: async (f, obj) => (written[f] = obj), log: () => {} });
    expect(written['onchain.json']).toBeUndefined();
    expect(summary.skippedFiles).toContain('onchain.json');
  });
});
