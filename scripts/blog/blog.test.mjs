import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { guardViolations, splitFrontmatter, validatePost } from './posts.mjs';
import { absolutize, esc, feedXml, ladderLayout, postPage, renderMarkdown, sitemapXml } from './render.mjs';
import { buildBlog, checkPosts } from './build.mjs';
import { wrapTitle } from './og.mjs';

const SITE = { url: 'https://example.org/HQ/', repo: 'https://github.com/x/HQ', cssVersion: 'abc' };
const BODY_ARTICLE = `## Kontekst\n\n${'Cena stoi nad dołkiem piątku i pod VWAP tygodnia, a płynność w weekend jest cienka. '.repeat(12)}`;
const BASE = {
  title: 'Sobota tuż nad dołkiem tygodnia',
  description: 'BTC-PERP stoi na 80 777, niecałe 300 dolarów nad piątkowym dołkiem. Poziomy i prawdopodobieństwa do 13:00.',
  date: '2026-10-24T09:30:00+02:00',
  type: 'article',
  section: 'Mapa dnia',
  price: 80777,
  levels: [
    { label: 'PDH', price: 82088 },
    { label: 'PDL', price: 80500, note: 'dołek tygodnia' },
  ],
  scenarios: [
    { label: 'Poniżej 80 400', probability: 20 },
    { label: 'Między 80 400 a 81 160', probability: 60 },
    { label: 'Powyżej 81 160', probability: 20 },
  ],
};
const ID = '2026-10-24-mapa-dnia';

describe('blog: walidacja wpisu', () => {
  it('poprawny artykuł przechodzi i jest znormalizowany', () => {
    const { post, errors } = validatePost(ID, BASE, BODY_ARTICLE);
    expect(errors).toEqual([]);
    expect(post).toMatchObject({ id: ID, type: 'article', price: 80777, draft: false });
    expect(post.ms).toBe(Date.parse('2026-10-24T07:30:00Z'));
    expect(post.levels[0].note).toBeNull();
  });

  it('brakujące pola, zły typ i suma scenariuszy > 100% to błędy', () => {
    const { post, errors } = validatePost(ID, { ...BASE, title: '', type: 'post', scenarios: [{ label: 'A', probability: 70 }, { label: 'B', probability: 40 }] }, BODY_ARTICLE);
    expect(post).toBeNull();
    expect(errors.join('\n')).toMatch(/title/);
    expect(errors.join('\n')).toMatch(/type/);
    expect(errors.join('\n')).toMatch(/suma prawdopodobieństw 110%/);
  });

  it('dzień z prefiksu nazwy musi być dniem publikacji w czasie polskim', () => {
    // 23:30 UTC 24.10 to już 25.10 w Polsce
    const { errors } = validatePost(ID, { ...BASE, date: '2026-10-24T23:30:00Z' }, BODY_ARTICLE);
    expect(errors.join('\n')).toMatch(/2026-10-25/);
    expect(validatePost('24-10-2026-mapa', BASE, BODY_ARTICLE).errors.join('\n')).toMatch(/nazwa pliku/);
  });

  it('poziomy wymagają ceny; przecinek w { } bez cudzysłowu daje czytelny błąd', () => {
    expect(validatePost(ID, { ...BASE, price: undefined }, BODY_ARTICLE).errors.join('\n')).toMatch(/levels: wymagają pola price/);
    const { data } = splitFrontmatter('---\nlevels:\n  - { label: PDL, price: 80500, note: dołek, 34% }\n---\n');
    expect(validatePost(ID, { ...BASE, levels: data.levels }, BODY_ARTICLE).errors.join('\n')).toMatch(/nieznane pole „34%”/);
  });

  it('długość treści zależy od typu: artykuł ≥ 150 słów, notka 15–250', () => {
    expect(validatePost(ID, BASE, 'Za krótko.').errors.join('\n')).toMatch(/minimum 150/);
    const note = { ...BASE, type: 'note', section: 'Aktualizacja 4h' };
    expect(validatePost(ID, note, BODY_ARTICLE.slice(0, 400)).errors).toEqual([]);
    expect(validatePost(ID, note, BODY_ARTICLE.repeat(3)).errors.join('\n')).toMatch(/notka ma/);
  });

  it('nagłówek # w treści jest odrzucany (tytułem strony jest title)', () => {
    expect(validatePost(ID, BASE, `# Tytuł\n\n${BODY_ARTICLE}`).errors.join('\n')).toMatch(/bez nagłówka #/);
  });
});

describe('blog: bezpieczniki treści', () => {
  it.each([
    ['adres portfela', 'Wieloryb 0x1234567890abcdef1234567890abcdef12345678 dokupił.', /portfela/],
    ['adres IP', 'Serwer 10.0.0.12 odpowiada.', /IP/],
    ['e-mail', 'Pisz na desk@example.com.', /e-mail/],
    ['token', 'Klucz ghp_abcdefghijklmnopqrstuvwxyz0123456789 działa.', /token/],
    ['wezwanie', 'Kupujcie, póki tanio.', /wezwanie/],
    ['wezwanie z kontekstem', 'Teraz wejdź w longa.', /wezwanie/],
    ['gotowe wejście', 'Long od 80 500 z celem wyżej.', /gotowe wejście/],
    ['TP/SL', 'TP 82000 i SL: 80100.', /TP\/SL/],
    ['myślnik', 'Cena spadła — znowu.', /myślnik/],
    ['myślnik półpauza ze spacjami', 'Cena spadła – znowu.', /myślnik/],
    ['strzałka', 'PDL → 80 100.', /strzałka/],
  ])('%s', (_, text, why) => {
    expect(guardViolations(text).join('\n')).toMatch(why);
  });

  it('zwykły język analizy przechodzi', () => {
    const ok = [
      'Pod ceną 23,7 mln USD likwidacji longów na 80 250, a shorty do likwidacji są wyżej.',
      'Presja kupujących osłabła, sprzedający wrzucili 120 BTC w minutę.',
      'Zakres 80 100–80 200 i data 24.10.2026, godzina 13:00.',
      'Otwórz desk, żeby zobaczyć mapę na żywo. Short squeeze nie nastąpił.',
      'Kontrakt long-only? Nie. Stop runy pod PDL to częsty obraz.',
    ];
    for (const t of ok) expect(guardViolations(t), t).toEqual([]);
  });
});

describe('blog: szablony', () => {
  const { post } = validatePost(ID, BASE, BODY_ARTICLE);

  it('tekst jest escapowany, liczby dostają twarde spacje', () => {
    expect(esc('<b>"x"</b>')).toBe('&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
    expect(esc('cena 80 777 i 1 500 000')).toBe('cena 80 777 i 1 500 000');
  });

  it('Markdown: surowy HTML jako tekst, tabele w ramce przewijania', () => {
    const html = renderMarkdown('Tekst <script>alert(1)</script>\n\n| A | B |\n|---|--:|\n| 1 | 2 |');
    expect(html).not.toMatch(/<script>/);
    expect(html).toMatch(/&lt;script&gt;/);
    expect(html).toMatch(/<div class="table-wrap"><table>/);
  });

  it('drabinka: etykiety w kolejności ceny, z minimalnym odstępem i w granicach', () => {
    const prices = [82365, 82088, 81638, 81407, 81294, 81214, 80777, 80500];
    const { y, label } = ladderLayout(prices, 300);
    for (let i = 1; i < prices.length; i++) {
      expect(y[i]).toBeGreaterThan(y[i - 1]);
      expect(label[i] - label[i - 1]).toBeGreaterThanOrEqual(28 - 1e-9);
    }
    expect(label[0]).toBeGreaterThanOrEqual(0);
    expect(label.at(-1)).toBeLessThanOrEqual(300 - 16);
  });

  it('strona wpisu: kanoniczny adres, bezwzględny obrazek OG, poprawny JSON-LD', () => {
    const html = postPage(SITE, { ...post, title: 'Tytuł </script><script>x' }, {});
    expect(html).toContain('<link rel="canonical" href="https://example.org/HQ/blog/2026-10-24-mapa-dnia/">');
    expect(html).toContain('<meta property="og:image" content="https://example.org/HQ/blog/2026-10-24-mapa-dnia/og.png">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    const ld = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1];
    expect(JSON.parse(ld)).toMatchObject({ '@type': 'BlogPosting', datePublished: BASE.date });
    expect(html.match(/<script/g).length).toBe(2);
    expect(html).toContain('href="https://github.com/x/HQ/commits/main/content/blog/2026-10-24-mapa-dnia.md"');
    expect(html).toContain('Analiza przygotowana automatycznie');
  });

  it('udostępnianie: linki do serwisów z adresem wpisu, kopiowanie i „Udostępnij” ukryte bez JS', () => {
    const html = postPage(SITE, post, {});
    const u = encodeURIComponent('https://example.org/HQ/blog/2026-10-24-mapa-dnia/');
    const t = encodeURIComponent(BASE.title);
    expect(html).toContain(`href="https://x.com/intent/tweet?text=${t}&amp;url=${u}"`);
    expect(html).toContain(`href="https://www.facebook.com/sharer/sharer.php?u=${u}"`);
    expect(html).toContain(`href="https://www.linkedin.com/sharing/share-offsite/?url=${u}"`);
    expect(html).toContain(`href="https://t.me/share/url?url=${u}&amp;text=${t}"`);
    expect(html).toContain(`href="https://wa.me/?text=${t}%20${u}"`);
    expect(html.match(/class="share-net"[^>]*target="_blank" rel="noopener noreferrer"/g).length).toBe(5);
    expect(html).toMatch(/data-share="native" hidden/);
    expect(html).toMatch(/data-share="copy" hidden/);
  });

  it('RSS: pełna treść z bezwzględnymi adresami, data RFC 822; sitemap z wpisami', () => {
    expect(absolutize('<img src="w.png"><a href="../x/">x</a><a href="https://a.b/">y</a>', 'https://example.org/HQ/blog/p/')).toBe(
      '<img src="https://example.org/HQ/blog/p/w.png"><a href="https://example.org/HQ/blog/x/">x</a><a href="https://a.b/">y</a>'
    );
    const xml = feedXml(SITE, [post]);
    expect(xml).toContain('<pubDate>Sat, 24 Oct 2026 07:30:00 GMT</pubDate>');
    expect(xml).toContain('<guid isPermaLink="true">https://example.org/HQ/blog/2026-10-24-mapa-dnia/</guid>');
    expect(xml).toMatch(/<content:encoded><!\[CDATA\[/);
    const map = sitemapXml(SITE, [post]);
    expect(map).toContain('<loc>https://example.org/HQ/blog/2026-10-24-mapa-dnia/</loc><lastmod>2026-10-24</lastmod>');
    expect(map).toContain('<loc>https://example.org/HQ/blog/archiwum/2026-10/</loc>');
  });

  it('tytuł karty OG mieści się w 3 wierszach (zmniejszenie fontu, w ostateczności wielokropek)', () => {
    const short = wrapTitle('Krótki tytuł', 640);
    expect(short).toEqual({ size: 60, lines: ['Krótki tytuł'] });
    const long = wrapTitle('Bardzo długi tytuł '.repeat(10).trim(), 640);
    expect(long.lines.length).toBe(3);
    expect(long.lines[2].endsWith('…')).toBe(true);
  });
});

/** Plik wpisu z frontmatterem YAML. */
function writePost(dir, id, data, body) {
  const yaml = Object.entries(data)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n');
  writeFileSync(path.join(dir, `${id}.md`), `---\n${yaml}\n---\n${body}`);
}

describe('blog: budowanie', () => {
  it('buduje strony, kanał, sitemap i obrazki; szkice pomija; media wpisu obok strony', async () => {
    const content = mkdtempSync(path.join(tmpdir(), 'hq-blog-'));
    const out = mkdtempSync(path.join(tmpdir(), 'hq-dist-'));
    writePost(content, ID, BASE, `${BODY_ARTICLE}\n\n![Wykres](wykres.png)`);
    mkdirSync(path.join(content, ID));
    writeFileSync(path.join(content, ID, 'wykres.png'), 'png');
    writePost(content, '2026-10-24-aktualizacja-14', { ...BASE, type: 'note', section: 'Aktualizacja 4h', date: '2026-10-24T14:00:00+02:00', levels: [], scenarios: [] }, 'Cena bez zmian od rana, zakres z mapy dnia się utrzymuje, a na mapie płynności nie pojawiło się nic nowego od 9:30.');
    writePost(content, '2026-10-25-szkic', { ...BASE, date: '2026-10-25T10:00:00+01:00', draft: true }, BODY_ARTICLE);

    const n = await buildBlog({ contentDir: content, outDir: out, site: SITE });
    expect(n).toBe(2);
    const blog = path.join(out, 'blog');
    expect(existsSync(path.join(blog, '2026-10-25-szkic'))).toBe(false);
    expect(readFileSync(path.join(blog, ID, 'wykres.png'), 'utf8')).toBe('png');
    const png = readFileSync(path.join(blog, ID, 'og.png'));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    const index = readFileSync(path.join(blog, 'index.html'), 'utf8');
    expect(index).toContain(`href="${ID}/"`);
    expect(index).toContain('href="2026-10-24-aktualizacja-14/"');
    // notka jest nowsza, więc wskazuje artykuł jako starszy wpis
    expect(readFileSync(path.join(blog, '2026-10-24-aktualizacja-14', 'index.html'), 'utf8')).toContain(`class="pager-older" href="../${ID}/"`);
    expect(existsSync(path.join(blog, 'archiwum', '2026-10', 'index.html'))).toBe(true);
    expect(readFileSync(path.join(blog, 'feed.xml'), 'utf8').match(/<item>/g).length).toBe(2);
    expect(readFileSync(path.join(out, 'sitemap.xml'), 'utf8')).toContain('/blog/2026-10-24-aktualizacja-14/');
    expect(existsSync(path.join(blog, 'og.png'))).toBe(true);
  });

  it('błędny wpis zatrzymuje build z nazwą pliku; --check zwraca ten sam problem', async () => {
    const content = mkdtempSync(path.join(tmpdir(), 'hq-blog-'));
    writePost(content, ID, { ...BASE, title: 'Kupujcie teraz' }, BODY_ARTICLE);
    await expect(buildBlog({ contentDir: content, outDir: mkdtempSync(path.join(tmpdir(), 'hq-dist-')), site: SITE })).rejects.toThrow(/2026-10-24-mapa-dnia\.md[\s\S]*wezwanie/);
    expect(checkPosts([path.join(content, `${ID}.md`)])[0].errors.join('\n')).toMatch(/wezwanie/);
  });

  it('brakujący obraz z treści to błąd wpisu', () => {
    const content = mkdtempSync(path.join(tmpdir(), 'hq-blog-'));
    writePost(content, ID, BASE, `${BODY_ARTICLE}\n\n![Wykres](brak.png)`);
    expect(checkPosts([], content)[0].errors.join('\n')).toMatch(/brak\.png/);
  });
});
