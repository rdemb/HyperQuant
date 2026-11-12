import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Angielski pierwszym językiem powłoki (E1): to, co widzi wyszukiwarka i podgląd linku zanim aplikacja wykryje język
 * czytelnika (index.html, manifest), jest po angielsku. Blog zostaje po polsku i jest tak oznaczony.
 */
const ROOT = join(import.meta.dirname, '..', '..', '..');
const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const meta = (attr: string, key: string) => new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`).exec(html)?.[1];

describe('index.html po angielsku', () => {
  it('lang="en", bez polskich znaków w treści', () => {
    expect(html).toMatch(/<html lang="en"/);
    expect(html.match(POLISH)).toBeNull();
  });

  it('tytuł, opis, słowa kluczowe, Open Graph, Twitter i opis JSON-LD po angielsku', () => {
    for (const v of [
      /<title>([^<]+)<\/title>/.exec(html)?.[1],
      meta('name', 'description'),
      meta('name', 'keywords'),
      meta('property', 'og:title'),
      meta('property', 'og:description'),
      meta('property', 'og:image:alt'),
      meta('name', 'twitter:title'),
      meta('name', 'twitter:description'),
    ])
      expect(v).toMatch(/[a-z]{3}/);
    expect(/<title>([^<]+)<\/title>/.exec(html)?.[1]).toBe('HyperQuant: BTC order-flow charts and desk for Hyperliquid');
    expect(meta('property', 'og:locale')).toBe('en_GB');
    expect(meta('property', 'og:locale:alternate')).toBe('pl_PL');
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]);
    expect(ld.inLanguage).toEqual(['en', 'pl']);
    expect(ld.description).toMatch(/^Free, open BTC day-trading desk/);
    expect(ld.operatingSystem).toBe('Any (modern browser)');
  });

  it('kanał RSS zostaje (polski) z tytułem „in Polish”; noscript po angielsku z polskimi odnośnikami jako drugimi', () => {
    expect(html).toContain('<link rel="alternate" type="application/rss+xml" title="HyperQuant · BTC analysis (in Polish)" href="./blog/feed.xml" />');
    const ns = /<noscript>([\s\S]*?)<\/noscript>/.exec(html)![1];
    expect(ns).toContain('Enable JavaScript to run the app.');
    expect(ns.indexOf('./en/charts/')).toBeLessThan(ns.indexOf('./wykresy/'));
    expect(ns).toContain('lang="pl"');
  });
});

describe('manifest po angielsku', () => {
  const raw = readFileSync(join(ROOT, 'public', 'manifest.webmanifest'), 'utf8');
  const m = JSON.parse(raw);
  it('lang "en", opis i skróty po angielsku, te same adresy', () => {
    expect(m.lang).toBe('en');
    expect(raw.match(POLISH)).toBeNull();
    expect(m.shortcuts.map((s: { name: string; url: string }) => [s.name, s.url])).toEqual([
      ['Pre-session', './#before'],
      ['In session', './#charts'],
      ['Post-session', './#after'],
    ]);
    expect(m.start_url).toBe('./#charts');
  });
});
