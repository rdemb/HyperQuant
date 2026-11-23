import { describe, expect, it } from 'vitest';
import { layout } from './render.mjs';

const SITE = { url: 'https://hyperquant.tech/', repo: 'https://github.com/rdemb/HyperQuant', cssVersion: '1', jsVersion: '1' };
const page = (lang, current, path) =>
  layout(SITE, { title: 't', description: 'd', url: `${SITE.url}${path}`, root: '../', image: `${SITE.url}og.png`, imageAlt: 'a', jsonLd: {}, main: '<p>x</p>', lang, current });

const bar = (html) => html.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)?.[0] ?? '';

describe('dolny pasek stron statycznych (telefon i tablet)', () => {
  it('każda strona ma pasek jak aplikacja: Dziś, Sesja, Order Flow, Rynki i „Więcej” z dziesięcioma linkami', () => {
    for (const [lang, current, path] of [
      ['pl', 'blog', 'blog/'],
      ['pl', 'news', 'co-nowego/'],
      ['pl', 'results', 'wyniki/'],
      ['pl', 'lessons', 'lekcje/'],
      ['pl', 'charts', 'wykresy/'],
      ['en', 'news', 'en/whats-new/'],
    ]) {
      const b = bar(page(lang, current, path));
      expect(b, `${lang} ${path}`).not.toBe('');
      expect(b.match(/class="bottom-nav__item/g), path).toHaveLength(5);
      expect(b.match(/class="bottom-nav__link/g), path).toHaveLength(10);
      expect(b, path).toContain('<details class="bottom-nav__more">');
      expect(b, path).not.toContain('nowy/');
    }
    expect(bar(page('pl', 'blog', 'blog/'))).toMatch(/Dziś[\s\S]*Sesja[\s\S]*Order Flow[\s\S]*Rynki[\s\S]*Więcej/);
  });

  it('bieżąca strona zaznaczona: w „Więcej” link z aria-current, a sam przycisk „Więcej” podświetlony', () => {
    const b = bar(page('pl', 'news', 'co-nowego/'));
    expect(b).toMatch(/<summary class="bottom-nav__item is-here">/);
    expect(b).toMatch(/class="bottom-nav__link is-here" href="\.\.\/co-nowego\/" aria-current="page"/);
    const w = bar(page('pl', 'charts', 'wykresy/'));
    // Strona Wykresów to dział „W sesji”, ale inny dokument niż aplikacja: podświetlenie bez aria-current
    expect(w).toMatch(/class="bottom-nav__item is-here" href="\.\.\/\?lang=pl#charts">/);
    expect(w).not.toMatch(/aria-current/);
  });
});

describe('szyna boczna stron statycznych (komputer)', () => {
  const rail = (html) => html.match(/<aside class="rail"[\s\S]*?<\/aside>/)?.[0] ?? '';
  it('te same pozycje co szyna aplikacji: 10 w grupach i 4 w serwisie; bieżąca strona podświetlona; marka i język w szynie', () => {
    const r = rail(page('pl', 'news', 'co-nowego/'));
    expect(r.match(/class="rail__item/g)).toHaveLength(14);
    expect(r).toMatch(/class="rail__item is-here" href="\.\.\/co-nowego\/" aria-current="page"/);
    expect(r).toContain('class="rail__brand"');
    expect(r).toMatch(/Dzień[\s\S]*Rynek[\s\S]*Wiedza[\s\S]*Serwis/);
    expect(r).toContain('href="../?lang=pl#dzis"');
    expect(r).toContain('href="../stanowisko/?lang=pl"');
    expect(rail(page('en', 'news', 'en/whats-new/'))).toContain('stanowisko/?lang=en"');
    // Stanowisko w „Więcej” na telefonie też z językiem strony (świeży profil bez zapisanego języka)
    expect(bar(page('pl', 'news', 'co-nowego/'))).toContain('href="../stanowisko/?lang=pl"');
    expect(rail(page('en', 'news', 'en/whats-new/'))).toMatch(/Day[\s\S]*Market[\s\S]*Knowledge[\s\S]*Site/);
  });
});
