import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { guardViolations, splitFrontmatter, validatePost } from './posts.mjs';
import { REPLAY_LINK_VERSION, parseReplayLink } from '../../src/charts/pro/replay/link';
import { absolutize, esc, feedXml, flowsHtml, ladderLayout, layout, liquidationsHtml, postBody, postPage, renderMarkdown, replayLink, setupsHtml, sitemapXml } from './render.mjs';
import { buildBlog, checkPosts } from './build.mjs';
import { ogSvg, wrapTitle } from './og.mjs';
import { PATHS, clip, sitePages, sitemapEntries } from './pages.mjs';
import { INDEXNOW_KEY, indexNowBody } from './indexnow.mjs';

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
    expect(html.match(/<script/g).length).toBe(3);
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
    // dwa rzędy: ikony pod tytułem i pełny blok pod treścią
    expect(html.match(/class="share-net"[^>]*target="_blank" rel="noopener noreferrer"/g).length).toBe(10);
    expect(html.match(/data-share="native"[^>]* hidden>/g).length).toBe(2);
    expect(html.match(/data-share="copy"[^>]* hidden>/g).length).toBe(2);
    expect(html).toContain('<span class="sr-only" aria-live="polite">Kopiuj link</span>');
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

describe('blog: analiza rozszerzona (dane, diagramy, scenariusze warunkowe)', () => {
  const PRO = {
    ...BASE,
    price: 80610,
    summary: ['Pod ceną osiem razy więcej longów do likwidacji niż shortów nad nią.', 'Przepływ jest po stronie sprzedających.'],
    metrics: [
      { label: 'Premia perp', value: '−1,5 bp', note: 'perp pod indeksem', bias: 'down' },
      { label: 'Likwidacje 24 h', value: '13,3 mln USD' },
    ],
    liquidations: {
      step: 250,
      coverage: 43,
      shorts: [
        [81250, 0.1],
        [82750, 13.4],
      ],
      longs: [
        [80000, 42.9],
        [79750, 57.4],
      ],
    },
    flows: { title: 'Przepływ agresorów netto, 24 h', unit: 'mln USD', rows: [{ label: 'Wieloryby', value: -37.5 }, { label: 'Reszta rynku', value: 12.5, note: '18 720 kont' }] },
    setups: [
      {
        name: 'Wypłukanie longów i powrót nad dołek',
        bias: 'up',
        zone: [79750, 80250],
        window: 'do 18:00',
        triggers: ['Likwidacje longów rosną skokowo.', 'Świeca 15 min zamyka się nad 80 500.'],
        invalidation: 'Dwa zamknięcia 15 min pod 79 750.',
        reactions: [{ label: 'VWAP soboty', price: 80836 }],
        evidence: 'Po zebraniu PDL cena wracała do środka zakresu w 44% z 85 przypadków.',
      },
    ],
  };
  const PRO_BODY = `## Płynność\n\n[[likwidacje]]\n\n${BODY_ARTICLE}\n\n## Scenariusze\n\n[[setupy]]\n`;

  it('pełny wpis przechodzi; pola są znormalizowane', () => {
    const { post, errors } = validatePost(ID, PRO, PRO_BODY);
    expect(errors).toEqual([]);
    expect(post.summary).toHaveLength(2);
    expect(post.metrics[1]).toEqual({ label: 'Likwidacje 24 h', value: '13,3 mln USD', note: null, bias: null });
    expect(post.liquidations).toMatchObject({ step: 250, coverage: 43, note: null });
    expect(post.setups[0]).toMatchObject({ bias: 'up', zone: [79750, 80250], window: 'do 18:00' });
    // znaczniki bloków nie liczą się do słów treści
    expect(validatePost(ID, PRO, '[[likwidacje]]\n\nZa krótko.').errors.join('\n')).toMatch(/artykuł ma 2 słów/);
  });

  it('mapa likwidacji: longi pod ceną, shorty sięgają ceny, przedziały co step', () => {
    const bad = { ...PRO.liquidations, longs: [[80750, 1]], shorts: [[80250, 1], [81300, 2]] };
    const msg = validatePost(ID, { ...PRO, liquidations: bad }, BODY_ARTICLE).errors.join('\n');
    expect(msg).toMatch(/longs\[0\]: przedział 80750 nie leży pod ceną/);
    expect(msg).toMatch(/shorts\[0\]: przedział 80250 nie sięga ceny/);
    expect(msg).toMatch(/cena 81300 nie jest wielokrotnością step/);
    const wide = { step: 50, longs: [[70000, 1]], shorts: [[81000, 1]] };
    expect(validatePost(ID, { ...PRO, liquidations: wide }, BODY_ARTICLE).errors.join('\n')).toMatch(/ponad 60 przedziałów/);
  });

  it('scenariusze warunkowe: strefa rosnąco, kierunek, warunki i unieważnienie są wymagane', () => {
    const s = { name: 'X', bias: 'long', zone: [80250, 79750], triggers: [] };
    const msg = validatePost(ID, { ...PRO, setups: [s] }, BODY_ARTICLE).errors.join('\n');
    expect(msg).toMatch(/setups\[0\]\.bias/);
    expect(msg).toMatch(/setups\[0\]\.zone/);
    expect(msg).toMatch(/setups\[0\]\.triggers: lista 1–5/);
    expect(msg).toMatch(/setups\[0\]\.invalidation/);
    expect(validatePost(ID, { ...PRO, summary: ['jeden'] }, BODY_ARTICLE).errors.join('\n')).toMatch(/summary: lista 2–5/);
    expect(validatePost(ID, { ...PRO, metrics: [{ label: 'Funding', value: 0.125 }] }, BODY_ARTICLE).errors.join('\n')).toMatch(/metrics\[0\]\.value/);
  });

  it('bezpieczniki obejmują teksty scenariuszy warunkowych i panelu danych', () => {
    const setups = [{ ...PRO.setups[0], invalidation: 'SL 79 700, dalej bez zmian.', triggers: ['Kupujcie po wybiciu.'] }];
    const msg = validatePost(ID, { ...PRO, setups, metrics: [{ label: 'Portfel', value: '0x1234567890abcdef1234567890abcdef12345678' }] }, BODY_ARTICLE).errors.join('\n');
    expect(msg).toMatch(/TP\/SL/);
    expect(msg).toMatch(/wezwanie do transakcji/);
    expect(msg).toMatch(/portfela/);
  });

  it('znaczniki bloków: znane, raz, z danymi, w osobnej linii', () => {
    const msg = (body, data = PRO) => validatePost(ID, data, `${BODY_ARTICLE}\n\n${body}`).errors.join('\n');
    expect(msg('[[mapa]]')).toMatch(/nieznany blok \[\[mapa\]\]/);
    expect(msg('[[wykres]]')).toMatch(/blok \[\[wykres\]\] bez danych \(session w content\/blog\/.+\/wykresy\.json\)/);
    expect(msg('[[setupy]]\n\n[[setupy]]')).toMatch(/więcej niż raz/);
    expect(msg('[[przeplywy]]', { ...PRO, flows: undefined })).toMatch(/\[\[przeplywy\]\] bez danych/);
    expect(msg('Patrz [[likwidacje]] wyżej.')).toMatch(/w osobnej linii/);
  });

  it('strona: bloki ze znacznikiem w treści, pozostałe przed treścią w stałej kolejności', () => {
    const { post } = validatePost(ID, PRO, PRO_BODY);
    const html = postPage(SITE, post, {});
    const { top, prose } = postBody(post);
    expect(html).toContain('<section class="summary"');
    expect([...top.matchAll(/block--(\w+)/g)].map((m) => m[1])).toEqual(['dane', 'poziomy', 'przeplywy', 'scenariusze']);
    expect(prose).toMatch(/<h2>Płynność<\/h2>\n<figure class="block block--inline block--likwidacje"><figcaption>Mapa likwidacji<\/figcaption>/);
    expect(prose).toContain('block--setupy');
    expect(html).not.toMatch(/\[\[/);
    expect(html).toContain('<span class="bias bias--down" aria-hidden="true">▼</span><span class="sr-only">spadkowy: </span>');
  });

  it('mapa likwidacji: przedziały od góry bez luk, linia ceny między shortami a longami, sumy w legendzie', () => {
    const html = liquidationsHtml(80610, PRO.liquidations);
    const rows = [...html.matchAll(/<li( class="liq-now")?><span class="liq-px">([\d ]+)<\/span>/g)].map((m) => (m[1] ? 'cena' : m[2].replace(' ', ' ')));
    expect(rows).toEqual(['82 750', '82 500', '82 250', '82 000', '81 750', '81 500', '81 250', '81 000', '80 750', '80 500', 'cena', '80 250', '80 000', '79 750']);
    // najdłuższy słupek = 88% ścieżki, kwota tylko przy większych przedziałach
    expect(html).toContain('<span class="liq-bars" style="width:88.0%"><span class="liq-bar liq-bar--long" style="width:100.0%"></span></span><span class="liq-v">57,4</span>');
    expect(html).not.toContain('<span class="liq-v">0,1</span>');
    expect(html).toContain('▲ likwidacje shortów (kupno) <b>13,5 mln USD</b>');
    expect(html).toContain('▼ likwidacje longów (sprzedaż) <b>100,3 mln USD</b>');
    expect(html).toContain('Mapa obejmuje 43% otwartych pozycji');
    expect(html).toContain('<tr><td>79 750–79 999</td><td align="right"></td><td align="right">57,4</td></tr>');
  });

  it('przepływy: słupki od zera w obie strony, wartość ze znakiem i typograficznym minusem', () => {
    const html = flowsHtml(PRO.flows);
    expect(html).toContain('<span class="fl-bar fl-bar--sell" style="width:50.0%"></span></span><span class="fl-v">−37,5</span>');
    expect(html).toContain('<span class="fl-bar fl-bar--buy" style="width:16.7%"></span></span><span class="fl-v">+12,5</span>');
    expect(html).toContain('Kwoty w mln USD.');
  });

  it('scenariusz warunkowy: strefa z odległością od ceny, warunki po kolei, poziomy reakcji z odległością w %', () => {
    const html = setupsHtml(80610, PRO.setups);
    expect(html).toContain('To opis warunków, nie zlecenie ani rekomendacja.');
    expect(html).toContain('<span class="su-bias">▲ Scenariusz wzrostowy</span> <span class="su-window">do 18:00</span>');
    expect(html).toContain('<b>79 750–80 250</b> <span class="su-dist">360–860 USD pod ceną</span>');
    expect(html.match(/<ol class="su-checks">(.*?)<\/ol>/)[1].match(/<li>/g)).toHaveLength(2);
    expect(html).toContain('<b>80 836</b> <span>VWAP soboty</span> <span class="su-dist">+0,3%</span>');
    expect(setupsHtml(80610, [{ ...PRO.setups[0], zone: [80500, 80700] }])).toContain('cena w strefie');
  });

  it('RSS: bez diagramów i znaczników, z punktami w skrócie i scenariuszami warunkowymi', () => {
    const { post } = validatePost(ID, PRO, PRO_BODY);
    const xml = feedXml(SITE, [post]);
    expect(xml).not.toMatch(/\[\[|liq-rows/);
    expect(xml).toContain('<li>Przepływ jest po stronie sprzedających.</li>');
    expect(xml).toContain('Wypłukanie longów i powrót nad dołek');
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
    // strony serwisu, zrzuty i karty podglądu obok bloga
    for (const f of ['wykresy/index.html', 'en/charts/og.png', 'lekcje/atlas/cvd/index.html', '404.html', 'og.png', 'site/charts-pl.jpg']) expect(existsSync(path.join(out, f)), f).toBe(true);
    expect(readFileSync(path.join(out, 'sitemap.xml'), 'utf8')).toContain('<loc>https://example.org/HQ/wykresy/</loc><xhtml:link rel="alternate" hreflang="pl"');
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

describe('blog: powtórka chwili wpisu na Wykresach', () => {
  const at = (section, date = BASE.date) => validatePost(ID, { ...BASE, section, date }, BODY_ARTICLE).post;

  it('link w formacie powtórki Wykresów: zatrzymanie w chwili wpisu, okno 2 h przed i 10 h po', () => {
    expect(REPLAY_LINK_VERSION).toBe(1);
    const post = at('Mapa dnia');
    const r = replayLink(post);
    const l = parseReplayLink(r.hash);
    expect(l).toMatchObject({ source: 'history', coin: 'BTC', interval: '5m', view: 'footprint', station: null, zone: null });
    expect([l.from, l.t, l.to]).toEqual([post.ms - 2 * 3_600_000, post.ms, post.ms + 10 * 3_600_000]);
    expect(l.layers).toEqual(['showVwap', 'showProfile', 'showLevels', 'showBubbles']);
  });

  it('wpis podsumowujący patrzy wstecz: 10 h przed i 2 h po', () => {
    for (const section of ['Podsumowanie dnia', 'Rozliczenie tygodnia', 'Rozliczenie Londynu']) {
      const post = at(section);
      const l = parseReplayLink(replayLink(post).hash);
      expect([l.from, l.t, l.to], section).toEqual([post.ms - 10 * 3_600_000, post.ms, post.ms + 2 * 3_600_000]);
    }
  });

  it('strona wpisu: blok z linkiem od korzenia desku, termin 7 dni i zastępstwo po nim', () => {
    const post = at('Mapa dnia');
    const html = postPage(SITE, post, {});
    expect(html).toContain(`<section class="block replay" data-until="${post.ms + 7 * 24 * 3_600_000}"`);
    expect(html).toContain('href="../../#charts?replay=history&amp;m=BTC&amp;i=5m&amp;v=footprint&amp;from=2026-10-24T05:30:00Z&amp;to=2026-10-24T17:30:00Z&amp;t=2026-10-24T07:30:00Z');
    expect(html).toMatch(/<div class="replay-off" hidden>[\s\S]*href="\.\.\/\.\.\/#charts">Otwórz Wykresy/);
    // blok stoi przed udostępnianiem pod treścią
    expect(html.indexOf('class="block replay"')).toBeLessThan(html.indexOf('<section class="block share"'));
  });
});

describe('strony serwisu: Wykresy, Lekcje, atlas, 404', () => {
  const pages = sitePages(SITE);
  const byPath = new Map(pages.filter((p) => p.html).map((p) => [p.path, p]));

  it('strony PL i EN pod stałymi adresami, każde hasło atlasu w obu językach', () => {
    for (const lang of ['pl', 'en']) for (const k of ['charts', 'lessons']) expect(byPath.has(PATHS[k][lang]), PATHS[k][lang]).toBe(true);
    const atlas = [...byPath.keys()].filter((p) => p.includes('/atlas/'));
    expect(atlas.length).toBe(42);
    expect(byPath.has('lekcje/atlas/footprint/') && byPath.has('en/lessons/atlas/footprint/')).toBe(true);
    expect(byPath.has('404.html')).toBe(true);
    // karta desku (strona aplikacji) bez HTML
    expect(pages.find((p) => p.path === '')).toMatchObject({ card: { section: 'Desk' } });
  });

  it('metadane: kanoniczny adres, obrazek OG strony, wersje językowe z x-default po angielsku, język dokumentu', () => {
    const pl = byPath.get('wykresy/').html;
    expect(pl).toContain('<html lang="pl">');
    expect(pl).toContain('<link rel="canonical" href="https://example.org/HQ/wykresy/">');
    expect(pl).toContain('<meta property="og:image" content="https://example.org/HQ/wykresy/og.png">');
    expect(pl).toContain('<link rel="alternate" hreflang="en" href="https://example.org/HQ/en/charts/">');
    expect(pl).toContain('<link rel="alternate" hreflang="x-default" href="https://example.org/HQ/en/charts/">');
    expect(pl).toContain('<meta property="og:locale:alternate" content="en_GB">');
    expect(pl).toContain('<a class="nav-charts" href="../" aria-current="page">'.replace('../', '../wykresy/'));
    const en = byPath.get('en/lessons/atlas/cvd/').html;
    expect(en).toContain('<html lang="en">');
    expect(en).toContain('<a class="nav-lang" href="https://example.org/HQ/lekcje/atlas/cvd/" hreflang="pl" lang="pl">PL</a>');
    expect(en).toContain('<a class="nav-blog" href="../../../../blog/">Blog (PL)</a>');
    for (const p of byPath.values()) {
      const ld = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(p.html)[1];
      expect(() => JSON.parse(ld), p.path).not.toThrow();
      const desc = /<meta name="description" content="([^"]*)">/.exec(p.html)[1];
      expect(desc.length, p.path).toBeLessThanOrEqual(200);
    }
  });

  it('linki względne prowadzą do istniejących stron, plików albo widoków aplikacji', () => {
    const files = new Set(['', 'blog/', 'blog/feed.xml', 'blog/blog.css', 'favicon.svg', 'icons/apple-touch-icon.png', ...byPath.keys(), ...pages.filter((p) => p.card).map((p) => `${p.path}og.png`)]);
    for (const k of ['charts', 'lessons']) for (const l of ['pl', 'en']) files.add(`site/${k}-${l}.jpg`);
    for (const [path_, p] of byPath) {
      if (path_ === '404.html') continue;
      const base = new URL(path_, SITE.url);
      for (const [, href] of p.html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        const u = new URL(href.replaceAll('&amp;', '&'), base);
        if (!u.href.startsWith(SITE.url)) continue;
        const rel = u.pathname.slice(new URL(SITE.url).pathname.length);
        expect(files.has(rel), `${path_} → ${href}`).toBe(true);
        if (rel === '' && u.hash) expect(u.hash, `${path_} → ${href}`).toMatch(/^#(charts|lessons)(\?|$)/);
      }
    }
  });

  it('ćwiczenia i hasła prowadzą do Lekcji pod adresami, które rozumie zakładka', () => {
    const html = byPath.get('lekcje/').html;
    expect(html).toContain('href="../#lessons?ex=ny-breakout"');
    expect(html).toContain('href="atlas/cvd/"');
    expect(byPath.get('lekcje/atlas/cvd/').html).toContain('href="../../../#lessons?tab=atlas&amp;id=cvd"');
  });

  it('404: same bezwzględne adresy (GitHub Pages podaje ją pod dowolną ścieżką) i noindex', () => {
    const html = byPath.get('404.html').html;
    expect(html).toContain('<meta name="robots" content="noindex">');
    for (const [, href] of html.matchAll(/(?:href|src)="([^"]+)"/g)) expect(href, href).toMatch(/^(https:|#)/);
  });

  it('mapa strony: strony z wersjami językowymi, bez 404', () => {
    const map = sitemapXml(SITE, [], sitemapEntries(SITE, pages));
    expect(map).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(map).toContain('<url><loc>https://example.org/HQ/en/lessons/atlas/vwap/</loc><xhtml:link rel="alternate" hreflang="pl" href="https://example.org/HQ/lekcje/atlas/vwap/"/><xhtml:link rel="alternate" hreflang="en" href="https://example.org/HQ/en/lessons/atlas/vwap/"/></url>');
    expect(map).not.toContain('404');
  });

  it('opis do 160 znaków ucięty na słowie; karta z zrzutem i własną stopką', () => {
    expect(clip('krótki')).toBe('krótki');
    const long = clip('słowo '.repeat(60));
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith('słowo…')).toBe(true);
    const svg = ogSvg({ section: 'Wykresy', title: 'Tytuł', subtitle: 'Podtytuł', shot: { href: 'data:image/jpeg;base64,AA', w: 1440, h: 700, crop: [0, 0, 720, 557] }, foot: ['adres', 'bez sygnałów'] });
    expect(svg).toContain('<clipPath id="shot">');
    expect(svg).toContain('href="data:image/jpeg;base64,AA"');
    expect(svg).toContain('>bez sygnałów</text>');
    expect(ogSvg({ section: 'Blog', title: 'T' })).toContain('>prawdopodobieństwa, nie sygnały</text>');
  });

  it('układ bloga bez zmian: polski, Blog podświetlony, RSS w menu', () => {
    const html = layout(SITE, { title: 't', description: 'd', url: SITE.url, root: '../', image: 'i', imageAlt: 'a', jsonLd: {}, main: '' });
    expect(html).toContain('<html lang="pl">');
    expect(html).toContain('<a class="nav-blog" href="../blog/" aria-current="page">Blog</a><a class="nav-rss" href="../blog/feed.xml">RSS</a>');
    expect(html).not.toContain('hreflang');
  });
});

describe('IndexNow: nowe wpisy z pusha', () => {
  const commits = [
    { added: ['content/blog/2026-10-25-mapa-dnia.md', 'content/blog/2026-10-25-mapa-dnia/wykresy.json'], modified: ['README.md'] },
    { added: ['content/blog/2026-10-25-szkic.md'], modified: ['content/blog/2026-10-24-aktualizacja-14.md'] },
  ];

  it('zgłasza wpisy dodane i zmienione, które są w zbudowanej stronie, razem ze stroną bloga', () => {
    const body = indexNowBody(commits, SITE, (id) => id !== '2026-10-25-szkic');
    expect(body).toEqual({
      host: 'example.org',
      key: INDEXNOW_KEY,
      keyLocation: `https://example.org/HQ/${INDEXNOW_KEY}.txt`,
      urlList: ['https://example.org/HQ/blog/', 'https://example.org/HQ/blog/2026-10-24-aktualizacja-14/', 'https://example.org/HQ/blog/2026-10-25-mapa-dnia/'],
    });
  });

  it('nic do zgłoszenia: push bez wpisów, same szkice albo brak listy commitów', () => {
    expect(indexNowBody([{ added: ['src/main.tsx'], modified: [] }], SITE, () => true)).toBeNull();
    expect(indexNowBody(commits, SITE, () => false)).toBeNull();
    expect(indexNowBody(undefined, SITE, () => true)).toBeNull();
  });

  it('plik klucza leży w public/ pod nazwą klucza i zawiera sam klucz', () => {
    expect(readFileSync(path.join('public', `${INDEXNOW_KEY}.txt`), 'utf8')).toBe(INDEXNOW_KEY);
  });
});
