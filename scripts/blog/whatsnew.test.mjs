// Strona „Co nowego” (PL co-nowego/, EN en/whats-new/): oś czasu z CHANGELOG.md i tagów wersji, generowana przy buildzie.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TITLE_GUARDS, guardHits } from '../../src/utils/safeguards.mjs';
import { sitePages, sitemapEntries } from './pages.mjs';
import { postPage } from './render.mjs';
import { validatePost } from './posts.mjs';
import { NEWS_FORBIDDEN, NEWS_PATHS, milestones, newsPeriods, parseChangelog, whatsNewPage } from './whatsnew.mjs';

const SITE = { url: 'https://example.org/HQ/', repo: 'https://github.com/x/y', cssVersion: 'c', jsVersion: 'j' };
const text = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
const body = (html) => text(html.slice(html.indexOf('<main'), html.indexOf('</main>')));

const MD = `# Changelog

## [Unreleased]

### Poziomy dnia: tylko bieżący dzień (2026-11-12)
<!-- co-nowego: grupa=wykres | pl=Czytelniejsze poziomy dnia | en=Clearer day levels -->

#### Zmienione
- **Poziomy dnia** tylko dla bieżącego dnia.
- **Opis warstw** poprawiony.

### Nowa prognoza godzinowa (2026-11-12)
<!-- co-nowego: grupa=prognozy | pl=Nowa prognoza dużego ruchu | en=New large-move forecast -->

### Pomiar interfejsu w CI (2026-11-12)
<!-- co-nowego: ukryj -->

### Taśma likwidacji: licznik (2026-11-11)
<!-- co-nowego: grupa=skaner | pl=Taśma likwidacji z poprawnym licznikiem | en=Liquidation tape with a correct count -->

### Sekcja bez komentarza (2026-11-11)
#### Dodane
- **Coś** nowego.

### Rynki z rejestru (2026-11-10)
<!-- co-nowego: grupa=rynki | pl=Wykres innych rynków | en=Charts for other markets -->
<!-- co-nowego: grupa=blog | pl=Blog z mapą rynków | en=Blog with a market map -->

### Dodane
<!-- co-nowego: grupa=wykres | pl=Widok Wykresy | en=Charts view | data=2026-10-24 -->
<!-- co-nowego: grupa=blog | pl=Blog z analizami | en=Blog with analyses | data=2026-10-25 -->
- **Widok Wykresy** z taśmą.

### Zła grupa (2026-11-09)
<!-- co-nowego: grupa=inne | pl=Coś | en=Something -->

### Zakazane słowo (2026-11-09)
<!-- co-nowego: grupa=wykres | pl=Nowy sygnał na wykresie | en=New signal on the chart -->

## [2.4.0] — 2026-10-22

### Dodane
<!-- co-nowego: grupa=prognozy | pl=Weryfikacja dziennika jednym kliknięciem | en=One-click ledger verification -->
- **Weryfikacja**.

### Zmienione
<!-- co-nowego: ukryj -->

## [2.0.0] — 2026-10-21

### Dodane
<!-- co-nowego: grupa=wykres | pl=Wykres order flow | en=Order flow chart -->
`;

describe('parseChangelog: sekcje, komentarze co-nowego, wersje', () => {
  const p = parseChangelog(MD);

  it('data z nagłówka sekcji, z data= w komentarzu albo z nagłówka wersji; kilka komentarzy to kilka pozycji', () => {
    expect(p.items.map((i) => [i.date, i.group, i.pl])).toEqual([
      ['2026-11-12', 'wykres', 'Czytelniejsze poziomy dnia'],
      ['2026-11-12', 'prognozy', 'Nowa prognoza dużego ruchu'],
      ['2026-11-11', 'skaner', 'Taśma likwidacji z poprawnym licznikiem'],
      ['2026-11-10', 'rynki', 'Wykres innych rynków'],
      ['2026-11-10', 'blog', 'Blog z mapą rynków'],
      ['2026-10-24', 'wykres', 'Widok Wykresy'],
      ['2026-10-25', 'blog', 'Blog z analizami'],
      ['2026-10-22', 'prognozy', 'Weryfikacja dziennika jednym kliknięciem'],
      ['2026-10-21', 'wykres', 'Wykres order flow'],
    ]);
    expect(p.items[0].en).toBe('Clearer day levels');
    expect(p.versions).toEqual([
      { version: '2.4.0', date: '2026-10-22' },
      { version: '2.0.0', date: '2026-10-21' },
    ]);
  });

  it('ukryj, brak komentarza, zła grupa i zakazane słowo: nie na stronie, a każde z nich (poza ukryj) to problem', () => {
    expect(p.items.some((i) => /Coś|sygnał/.test(i.pl))).toBe(false);
    expect(p.problems.join('\n')).toMatch(/Sekcja bez komentarza.*brak komentarza co-nowego/);
    expect(p.problems.join('\n')).toMatch(/Zła grupa.*grupa „inne”/);
    expect(p.problems.join('\n')).toMatch(/Zakazane słowo.*sygnał/);
    expect(p.problems.join('\n')).not.toMatch(/Pomiar interfejsu/);
    expect(p.problems).toHaveLength(3);
    expect(p.hidden).toBe(2);
  });

  it('wzmianka o formacie komentarza w treści wypunktowania nie jest pozycją', () => {
    const q = parseChangelog('## [Unreleased]\n\n### A (2026-11-12)\n<!-- co-nowego: ukryj -->\n- **Format** `<!-- co-nowego: grupa=… | pl=… -->`.\n');
    expect(q.problems).toEqual([]);
    expect(q.items).toEqual([]);
  });

  it('sekcja bez daty i komentarz bez data=: problem', () => {
    const q = parseChangelog('## [Unreleased]\n\n### Dodane\n<!-- co-nowego: grupa=wykres | pl=A | en=B -->\n');
    expect(q.items).toEqual([]);
    expect(q.problems.join('\n')).toMatch(/brak daty/);
  });
});

describe('newsPeriods: okresy według kamieni milowych, najnowsze na górze', () => {
  const { items } = parseChangelog(MD);

  it('z tagami: wersje z jednego dnia w jednym okresie, grupy w stałej kolejności, w grupie najnowsze pierwsze', () => {
    const ms = milestones(parseChangelog(MD).versions, [
      { version: '2.5.0', date: '2026-11-11' },
      { version: '2.5.1', date: '2026-11-11' },
    ]);
    const periods = newsPeriods(items, ms);
    expect(periods.map((x) => [x.versions.join(','), x.from, x.to, x.count])).toEqual([
      ['', '2026-11-12', '2026-11-12', 2],
      ['2.5.0,2.5.1', '2026-10-24', '2026-11-11', 5],
      ['2.4.0', '2026-10-22', '2026-10-22', 1],
      ['2.0.0', '2026-10-21', '2026-10-21', 1],
    ]);
    const p2 = periods[1];
    expect(p2.groups.map((g) => g.group)).toEqual(['wykres', 'rynki', 'skaner', 'blog']);
    expect(p2.groups.find((g) => g.group === 'blog').items.map((i) => i.date)).toEqual(['2026-11-10', '2026-10-25']);
  });

  it('bez tagów (płytki checkout): kamienie milowe z nagłówków wersji CHANGELOG', () => {
    const periods = newsPeriods(items, milestones(parseChangelog(MD).versions, []));
    expect(periods.map((x) => [x.versions.join(','), x.count])).toEqual([
      ['', 7],
      ['2.4.0', 1],
      ['2.0.0', 1],
    ]);
  });
});

describe('strona co-nowego/ i en/whats-new/', () => {
  const news = { changelog: MD, tags: [{ version: '2.5.0', date: '2026-11-11' }] };

  it('adresy, hreflang PL/EN i x-default na EN', () => {
    expect(NEWS_PATHS).toEqual({ pl: 'co-nowego/', en: 'en/whats-new/' });
    const pl = whatsNewPage(SITE, 'pl', news);
    expect(pl.path).toBe('co-nowego/');
    expect(pl.html).toContain('<link rel="canonical" href="https://example.org/HQ/co-nowego/">');
    expect(pl.html).toContain('<link rel="alternate" hreflang="pl" href="https://example.org/HQ/co-nowego/">');
    expect(pl.html).toContain('<link rel="alternate" hreflang="en" href="https://example.org/HQ/en/whats-new/">');
    expect(pl.html).toContain('<link rel="alternate" hreflang="x-default" href="https://example.org/HQ/en/whats-new/">');
    expect(whatsNewPage(SITE, 'en', news).path).toBe('en/whats-new/');
  });

  it('PL: oś od najnowszego, najnowszy okres rozwinięty, reszta zwinięta; grupy po polsku; linki do repo i CHANGELOG', () => {
    const { html } = whatsNewPage(SITE, 'pl', news);
    const details = [...html.matchAll(/<details[^>]*>/g)].map((m) => m[0]);
    expect(details).toHaveLength(4);
    expect(details[0]).toContain(' open');
    expect(details.slice(1).every((d) => !d.includes(' open'))).toBe(true);
    const t = body(html);
    expect(t.indexOf('Czytelniejsze poziomy dnia')).toBeLessThan(t.indexOf('Wersja 2.5.0'));
    expect(t.indexOf('Wersja 2.5.0')).toBeLessThan(t.indexOf('Wersja 2.4.0'));
    expect(t).toContain('Prognozy i /wyniki');
    expect(t).toContain('Skaner i dane');
    expect(t).toContain('2 zmiany');
    expect(t).toContain('5 zmian');
    expect(t).not.toMatch(/Pomiar interfejsu|Coś nowego|sygna/);
    expect(html).toContain('<a href="https://github.com/x/y">');
    expect(html).toContain('<a href="https://github.com/x/y/blob/main/CHANGELOG.md">');
  });

  it('EN: tytuły z komentarzy po angielsku, bez polskich nazw grup', () => {
    const t = body(whatsNewPage(SITE, 'en', news).html);
    expect(t).toContain('Clearer day levels');
    expect(t).toContain('Forecasts and /results');
    expect(t).toContain('Version 2.5.0');
    expect(t).not.toContain('Czytelniejsze');
  });

  it('bez CHANGELOG przy budowaniu: strona powstaje z „—” i powodem', () => {
    const t = body(whatsNewPage(SITE, 'pl', {}).html);
    expect(t).toMatch(/— \(dziennik zmian niedostępny przy budowaniu strony\)/);
  });

  it('bez znacznika script poza danymi strukturalnymi; bez atrybutów zdarzeń', () => {
    for (const lang of ['pl', 'en']) {
      const { html } = whatsNewPage(SITE, lang, news);
      expect([...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0])).toEqual(['<script type="application/ld+json">']);
      expect(html).toContain("script-src 'self'");
      expect(html).not.toMatch(/\son[a-z]+=/i);
    }
  });

  it('stopka jak na stronach serwisu: zdanie o „wezwaniu do transakcji” / „a call to trade”', () => {
    const pages = sitePages(SITE, { news }).filter((p) => p.path === 'co-nowego/' || p.path === 'en/whats-new/');
    expect(pages.map((p) => p.lang)).toEqual(['pl', 'en']);
    expect(text(pages[0].html)).toContain('Narzędzie edukacyjne i analityczne, nie porada inwestycyjna ani wezwanie do transakcji.');
    expect(text(pages[1].html)).toContain('An educational and analytical tool, not investment advice nor a call to trade.');
  });

  it('w mapie strony obie wersje; link w stopce każdej strony serwisu i pod wpisem bloga', () => {
    const pages = sitePages(SITE, { news });
    const locs = sitemapEntries(SITE, pages).map((e) => e.loc);
    expect(locs).toContain('https://example.org/HQ/co-nowego/');
    expect(locs).toContain('https://example.org/HQ/en/whats-new/');
    expect(sitePages(SITE).some((p) => p.path === 'co-nowego/' && p.html)).toBe(true);
    for (const p of pages.filter((x) => x.html)) {
      const rel = p.path === '404.html' ? SITE.url : '../'.repeat(p.path.split('/').filter(Boolean).length);
      const href = `${rel}${p.lang === 'en' ? 'en/whats-new/' : 'co-nowego/'}`;
      expect(p.html, p.path).toMatch(new RegExp(`<footer[\\s\\S]*href="${href.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"`));
    }
    const { post } = validatePost(
      '2026-11-12-mapa-dnia',
      { title: 'Środa nad VWAP tygodnia', description: 'BTC-PERP stoi nad VWAP tygodnia. Poziomy i prawdopodobieństwa do 13:00.', date: '2026-11-12T07:00:00+01:00', type: 'article', section: 'Mapa dnia', price: 80777, levels: [{ label: 'PDH', price: 82088 }] },
      `## Kontekst\n\n${'Cena stoi nad dołkiem piątku i pod VWAP tygodnia. '.repeat(20)}`
    );
    expect(postPage(SITE, post, {})).toMatch(/<footer[\s\S]*href="\.\.\/\.\.\/co-nowego\/"/);
  });
});

describe('strona co-nowego/: link w stopce aplikacji', () => {
  it('stopka desku prowadzi do historii zmian w języku interfejsu, obok wyników prognoz', () => {
    const shell = readFileSync(new URL('../../src/shell/AppShell.tsx', import.meta.url), 'utf8');
    expect(shell).toMatch(/tr\('\.\/wyniki\/', '\.\/en\/results\/'\)[\s\S]{0,300}tr\('\.\/co-nowego\/', '\.\/en\/whats-new\/'\)/);
  });
});

describe('prawdziwy CHANGELOG.md', () => {
  const md = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
  const p = parseChangelog(md);

  it('każda sekcja ma komentarz co-nowego (tytuł PL i EN, grupa albo ukryj) i datę; bez problemów', () => {
    expect(p.problems).toEqual([]);
    expect(p.items.length).toBeGreaterThan(0);
  });

  it('pierwszy okres obejmuje 10–12.11.2026; tytuły bez słów rady i kierunku, bez nazw modeli i botów, bez ścieżek', () => {
    expect(p.items.some((i) => i.date === '2026-11-12')).toBe(true);
    for (const i of p.items)
      for (const s of [i.pl, i.en]) {
        expect(guardHits(s, TITLE_GUARDS).map((h) => h.fragment), s).toEqual([]);
        expect(s, s).not.toMatch(NEWS_FORBIDDEN);
      }
    for (const lang of ['pl', 'en']) {
      const t = body(whatsNewPage(SITE, lang, { changelog: md, tags: [] }).html);
      expect(guardHits(t, TITLE_GUARDS).map((h) => h.fragment)).toEqual([]);
      expect(t).not.toMatch(NEWS_FORBIDDEN);
    }
  });
});

describe('„Co nowego”: daty przybliżone z historii repozytorium', () => {
  it('pozycja z data= w komentarzu daje zdanie o przybliżonych datach (PL i EN); bez takich pozycji zdania nie ma', async () => {
    const { whatsNewPage } = await import('./whatsnew.mjs');
    const SITE = { url: 'https://example.org/', title: 'HQ', repo: 'https://github.com/x/y' };
    const md = `# Changelog\n\n## [Unreleased]\n\n### Coś nowego (2026-11-12)\n<!-- co-nowego: grupa=wykres | pl=Nowy wykres | en=New chart -->\n\n### Dodane\n<!-- co-nowego: grupa=blog | pl=Stary wpis | en=Old entry | data=2026-11-03 -->\n`;
    const pl = whatsNewPage(SITE, 'pl', { changelog: md, tags: [] }).html;
    const en = whatsNewPage(SITE, 'en', { changelog: md, tags: [] }).html;
    expect(pl).toContain('Daty pozycji do 3 listopada 2026 są przybliżone');
    expect(en).toContain('Dates of entries up to 3 November 2026 are approximate');
    const noApprox = whatsNewPage(SITE, 'pl', { changelog: md.split('### Dodane')[0], tags: [] }).html;
    expect(noApprox).not.toContain('przybliżone');
  });
});
