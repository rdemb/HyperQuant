// Szablony bloga: strona wpisu, lista wpisów, archiwum miesięcy, RSS i sitemap. Czyste funkcje (tekst → tekst).
import { Marked } from 'marked';
import { TIME_ZONE, localDate } from './posts.mjs';

export const INDEX_LIMIT = 40;
export const FEED_LIMIT = 50;
const LADDER_GAP = 28;
const LADDER_GAP_NOTES = 44;
const LADDER_PAD = 16;

// ───────────────────────── Formatowanie ─────────────────────────

/** Twarde spacje w grupach cyfr („80 777”), żeby liczba nie łamała się między wierszami. */
export const nbsp = (s) => s.replace(/(\d) (?=\d{3}(?!\d))/g, '$1\u00a0');
/** Tekst do HTML: encje i twarde spacje w liczbach. */
export const esc = (s) => nbsp(String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]));

const priceFmt = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' });
const dayFmt = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TIME_ZONE });
const timeFmt = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });
const monthFmt = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric', timeZone: TIME_ZONE });

export const fmtPrice = (v) => priceFmt.format(v);
export const fmtPct = (v) => `${pctFmt.format(v)}%`;
export const fmtDay = (ms) => dayFmt.format(ms);
export const fmtTime = (ms) => timeFmt.format(ms);
export const monthKey = (ms) => localDate(ms).slice(0, 7);
/** „październik 2026” z klucza RRRR-MM (połowa miesiąca, żeby strefa nie przesunęła miesiąca). */
export const fmtMonth = (key) => monthFmt.format(Date.parse(`${key}-15T12:00:00Z`));

// ───────────────────────── Markdown ─────────────────────────

// Surowy HTML w treści jest wyświetlany jako tekst — wpisy to Markdown, nie HTML
const marked = new Marked({ gfm: true, renderer: { html: ({ text }) => esc(text) } });

/** Treść wpisu → HTML; szerokie tabele przewijają się w ramce na telefonie. */
export function renderMarkdown(md) {
  return nbsp(marked.parse(md))
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>')
    .replace(/<img /g, '<img loading="lazy" decoding="async" ');
}

// ───────────────────────── Wykresy ─────────────────────────

/**
 * Pozycje etykiet drabinki: y prawdziwe (skala ceny między górnym marginesem a `bottom`), potem rozsunięcie
 * do minimalnego odstępu w dół i, gdy ostatnia wyjdzie poza dół, w górę. Wejście posortowane malejąco po cenie.
 */
export function ladderLayout(prices, height, gap = LADDER_GAP, bottom = LADDER_PAD) {
  const max = Math.max(...prices);
  const min = Math.min(...prices);
  const span = max - min || 1;
  const inner = height - LADDER_PAD - bottom;
  const y = prices.map((p) => LADDER_PAD + ((max - p) / span) * inner);
  const label = [...y];
  for (let i = 1; i < label.length; i++) label[i] = Math.max(label[i], label[i - 1] + gap);
  const last = label.length - 1;
  if (label[last] > height - bottom) {
    label[last] = height - bottom;
    for (let i = last - 1; i >= 0; i--) label[i] = Math.min(label[i], label[i + 1] - gap);
  }
  return { y, label };
}

/**
 * Mapa poziomów: skala ceny (SVG o stałej szerokości) i wiersze HTML (czytelne na telefonie).
 * Notka poziomu jest drugim wierszem pod nazwą, więc przy notkach odstęp między poziomami rośnie.
 */
export function ladderHtml(price, levels) {
  const rows = [...levels.map((l) => ({ ...l, current: false })), { label: 'Cena', price, note: null, current: true }].sort(
    (a, b) => b.price - a.price || (a.current ? 1 : -1)
  );
  const notes = rows.some((r) => r.note);
  const gap = notes ? LADDER_GAP_NOTES : LADDER_GAP;
  const bottom = LADDER_PAD + (notes ? 18 : 0);
  const height = Math.max(240, (rows.length - 1) * gap + LADDER_PAD + bottom);
  const { y, label } = ladderLayout(
    rows.map((r) => r.price),
    height,
    gap,
    bottom
  );
  const W = 56;
  const svg = [`<line x1="14" y1="${LADDER_PAD}" x2="14" y2="${height - bottom}" class="ld-axis"/>`];
  rows.forEach((r, i) => {
    const cls = r.current ? 'ld-now' : 'ld-level';
    svg.push(`<line x1="${r.current ? 4 : 8}" y1="${y[i].toFixed(1)}" x2="${r.current ? 24 : 20}" y2="${y[i].toFixed(1)}" class="${cls}"/>`);
    svg.push(`<polyline points="20,${y[i].toFixed(1)} 34,${y[i].toFixed(1)} ${W},${label[i].toFixed(1)}" class="ld-leader ${cls}"/>`);
  });
  const items = rows
    .map((r, i) => {
      const dist = r.current ? '' : fmtPct(((r.price - price) / price) * 100);
      const note = r.note ? `<span class="ld-note">${esc(r.note)}</span>` : '';
      return `<li class="${r.current ? 'is-now' : ''}" style="top:${label[i].toFixed(1)}px"><b class="ld-label">${esc(r.label)}</b><span class="ld-price">${fmtPrice(r.price)}</span><span class="ld-dist">${dist}</span>${note}</li>`;
    })
    .join('');
  const aria = rows.map((r) => `${r.label} ${fmtPrice(r.price)}`).join(', ');
  return `<figure class="ladder" style="height:${height}px" role="img" aria-label="Mapa poziomów: ${esc(aria)}"><svg width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" aria-hidden="true">${svg.join('')}</svg><ol aria-hidden="true">${items}</ol></figure>`;
}

/** Scenariusze z prawdopodobieństwami (pasek = %, liczba obok; reszta do 100% nazwana wprost). */
export function scenariosHtml(scenarios) {
  const sum = scenarios.reduce((a, s) => a + s.probability, 0);
  const items = scenarios
    .map(
      (s) =>
        `<li><div class="sc-head"><span class="sc-label">${esc(s.label)}</span><span class="sc-p">${s.probability}%</span></div><div class="sc-bar" aria-hidden="true"><span style="width:${s.probability}%"></span></div>${s.note ? `<p class="sc-note">${esc(s.note)}</p>` : ''}</li>`
    )
    .join('');
  const rest = sum < 100 ? `<p class="sc-rest">Pozostałe ${100 - sum}%: inne przebiegi.</p>` : '';
  return `<ol class="scenarios">${items}</ol>${rest}`;
}

// ───────────────────────── Strony ─────────────────────────

const FONTS =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Outfit:wght@500;600;700&family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap';

/** Szkielet strony: metadane (SEO, Open Graph, X), nagłówek z nawigacją, stopka. `root` = względna ścieżka do korzenia desku. */
export function layout(site, { title, description, url, root, image, imageAlt, type = 'website', published, section, jsonLd, main }) {
  const article =
    type === 'article'
      ? `\n<meta property="article:published_time" content="${esc(published)}">\n<meta property="article:section" content="${esc(section)}">`
      : '';
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<link rel="alternate" type="application/rss+xml" title="HyperQuant · Analizy BTC" href="${site.url}blog/feed.xml">
<link rel="icon" type="image/svg+xml" href="${root}favicon.svg">
<link rel="apple-touch-icon" href="${root}icons/apple-touch-icon.png">
<meta name="theme-color" content="#070A11">
<meta property="og:type" content="${type}">
<meta property="og:locale" content="pl_PL">
<meta property="og:site_name" content="HyperQuant">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(imageAlt)}">${article}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<meta name="twitter:image:alt" content="${esc(imageAlt)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="${root}blog/blog.css?v=${site.cssVersion}">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
</head>
<body>
<header class="site-header"><div class="wrap">
<a class="brand" href="${root}">HyperQuant<span>BTC · Hyperliquid</span></a>
<nav aria-label="Główna"><a href="${root}">Desk</a><a href="${root}blog/" aria-current="page">Blog</a><a href="${root}blog/feed.xml">RSS</a></nav>
</div></header>
<main class="wrap">
${main}
</main>
<footer class="site-footer"><div class="wrap">
<p>Prawdopodobieństwa i scenariusze, nie porada inwestycyjna ani sygnał do transakcji. Handel kontraktami z dźwignią wiąże się z wysokim ryzykiem utraty środków.</p>
<p><a href="${root}">Desk HyperQuant</a> · <a href="${site.repo}">Kod na GitHubie</a> · <a href="${root}blog/feed.xml">RSS</a></p>
</div></footer>
</body>
</html>
`;
}

/** Jawność pochodzenia tekstu i możliwego konfliktu interesów (pod każdym wpisem). */
export const DISCLOSURE = 'Analiza przygotowana automatycznie na danych desku HyperQuant. Autor może mieć pozycje w BTC.';

const PUBLISHER = (site) => ({ '@type': 'Organization', name: 'HyperQuant', url: site.url, logo: { '@type': 'ImageObject', url: `${site.url}icons/icon-512.png` } });

/** Strona wpisu (artykuł albo notka). `newer` / `older` = sąsiednie wpisy do nawigacji. */
export function postPage(site, post, { newer, older }) {
  const url = `${site.url}blog/${post.id}/`;
  const image = `${url}og.png`;
  const root = '../../';
  const facts =
    post.price !== null
      ? `<div class="facts"><span class="k">BTC-PERP</span><span class="v">${fmtPrice(post.price)} USD</span><span class="s">w chwili publikacji</span></div>`
      : '';
  const levels = post.levels.length ? `<section class="block"><h2>Mapa poziomów</h2>${ladderHtml(post.price, post.levels)}</section>` : '';
  const scenarios = post.scenarios.length ? `<section class="block"><h2>Scenariusze</h2>${scenariosHtml(post.scenarios)}</section>` : '';
  const pager = [
    older ? `<a class="pager-older" href="../${older.id}/"><span>Starszy wpis</span>${esc(older.title)}</a>` : '<span></span>',
    newer ? `<a class="pager-newer" href="../${newer.id}/"><span>Nowszy wpis</span>${esc(newer.title)}</a>` : '<span></span>',
  ].join('');
  const main = `<article class="post post--${post.type}">
<p class="eyebrow"><a href="../">Blog</a><span>${esc(post.section)}</span></p>
<h1>${esc(post.title)}</h1>
<p class="meta"><time datetime="${esc(post.date)}">${fmtDay(post.ms)}, ${fmtTime(post.ms)}</time> czasu polskiego</p>
<p class="lead">${esc(post.description)}</p>
${facts}${levels}${scenarios}
<div class="prose">
${renderMarkdown(post.body)}
</div>
<p class="history">${DISCLOSURE} Wpis jest w publicznej historii repozytorium od chwili publikacji: <a href="${site.repo}/commits/main/content/blog/${post.id}.md">historia zmian</a>.</p>
</article>
<nav class="pager" aria-label="Sąsiednie wpisy">${pager}</nav>`;
  return layout(site, {
    title: `${post.title} · HyperQuant`,
    description: post.description,
    url,
    root,
    image,
    imageAlt: `${post.section}: ${post.title}`,
    type: 'article',
    published: post.date,
    section: post.section,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.description,
      datePublished: post.date,
      dateModified: post.date,
      inLanguage: 'pl',
      articleSection: post.section,
      url,
      mainEntityOfPage: url,
      image,
      author: { '@type': 'Organization', name: 'HyperQuant', url: site.url },
      publisher: PUBLISHER(site),
    },
    main,
  });
}

/** Element listy: artykuł z zajawką, notka zwięźle. `prefix` = ścieżka do katalogu blog/. */
function entryHtml(post, prefix) {
  const lead = post.type === 'article' ? `<span class="entry-lead">${esc(post.description)}</span>` : '';
  return `<li class="entry entry--${post.type}"><a href="${prefix}${post.id}/"><span class="entry-meta"><time datetime="${esc(post.date)}">${fmtTime(post.ms)}</time>${esc(post.section)}</span><span class="entry-title">${esc(post.title)}</span>${lead}</a></li>`;
}

/** Wpisy pogrupowane po dniach (czas polski), od najnowszego. */
function feedHtml(posts, prefix) {
  const days = new Map();
  for (const p of posts) {
    const k = localDate(p.ms);
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(p);
  }
  return [...days.values()]
    .map((list) => `<section class="day"><h2>${fmtDay(list[0].ms)}</h2><ol>${list.map((p) => entryHtml(p, prefix)).join('')}</ol></section>`)
    .join('\n');
}

const INTRO =
  'Analizy BTC-PERP na Hyperliquid pisane przed faktem: mapa dnia przed Londynem, mapa przed otwarciem Nowego Jorku i podsumowanie dnia, a między nimi krótkie notki. Liczby pochodzą z danych desku, każdy scenariusz ma prawdopodobieństwo i jest później rozliczany.';

function archiveNav(months, prefix) {
  if (!months.length) return '';
  return `<nav class="archive" aria-label="Archiwum"><h2>Archiwum</h2><ul>${months.map((m) => `<li><a href="${prefix}archiwum/${m}/">${fmtMonth(m)}</a></li>`).join('')}</ul></nav>`;
}

/** Lista wpisów: najnowszy artykuł jako bohater, potem wpisy wg dni (do INDEX_LIMIT) i archiwum miesięcy. */
export function indexPage(site, posts) {
  const url = `${site.url}blog/`;
  const hero = posts.find((p) => p.type === 'article');
  const rest = posts.filter((p) => p !== hero).slice(0, INDEX_LIMIT);
  const months = [...new Set(posts.map((p) => monthKey(p.ms)))];
  const heroHtml = hero
    ? `<a class="hero" href="${hero.id}/"><span class="entry-meta"><time datetime="${esc(hero.date)}">${fmtDay(hero.ms)}, ${fmtTime(hero.ms)}</time>${esc(hero.section)}</span><span class="hero-title">${esc(hero.title)}</span><span class="hero-lead">${esc(hero.description)}</span>${hero.price !== null ? `<span class="hero-price">BTC-PERP <b>${fmtPrice(hero.price)} USD</b></span>` : ''}</a>`
    : '';
  const empty = posts.length ? '' : '<p class="empty">Pierwsza analiza pojawi się tutaj wkrótce. Nowe wpisy możesz śledzić przez RSS.</p>';
  const main = `<header class="intro"><p class="eyebrow"><span>Blog</span></p><h1>Analizy BTC</h1><p>${INTRO}</p></header>
${heroHtml}${empty}
<div class="feed">${feedHtml(rest, '')}</div>
${archiveNav(months, '')}`;
  return layout(site, {
    title: 'Analizy BTC · Blog HyperQuant',
    description: INTRO,
    url,
    root: '../',
    image: `${site.url}blog/og.png`,
    imageAlt: 'HyperQuant: analizy BTC na Hyperliquid',
    jsonLd: { '@context': 'https://schema.org', '@type': 'Blog', name: 'HyperQuant · Analizy BTC', url, inLanguage: 'pl', description: INTRO, publisher: PUBLISHER(site) },
    main,
  });
}

/** Archiwum jednego miesiąca (wszystkie wpisy, bez limitu). */
export function monthPage(site, key, posts, months) {
  const url = `${site.url}blog/archiwum/${key}/`;
  const title = `Archiwum: ${fmtMonth(key)}`;
  const main = `<header class="intro"><p class="eyebrow"><a href="../../">Blog</a><span>Archiwum</span></p><h1>${esc(title)}</h1></header>
<div class="feed">${feedHtml(posts, '../../')}</div>
${archiveNav(months, '../../')}`;
  return layout(site, {
    title: `${title} · Blog HyperQuant`,
    description: `Wszystkie analizy BTC z bloga HyperQuant: ${fmtMonth(key)}.`,
    url,
    root: '../../../',
    image: `${site.url}blog/og.png`,
    imageAlt: 'HyperQuant: analizy BTC na Hyperliquid',
    jsonLd: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, url, inLanguage: 'pl', publisher: PUBLISHER(site) },
    main,
  });
}

// ───────────────────────── RSS i sitemap ─────────────────────────

const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const cdata = (s) => `<![CDATA[${String(s).replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;

/** Względne src/href w treści → bezwzględne (czytniki RSS nie znają adresu strony wpisu). */
export function absolutize(html, base) {
  return html.replace(/\b(src|href)="([^"#][^"]*)"/g, (m, attr, v) => (/^[a-z][a-z0-9+.-]*:/i.test(v) ? m : `${attr}="${new URL(v, base).href}"`));
}

/** Kanał RSS 2.0 z pełną treścią (content:encoded). Data kanału = najnowszy wpis, więc build jest powtarzalny. */
export function feedXml(site, posts) {
  const items = posts.slice(0, FEED_LIMIT).map((p) => {
    const url = `${site.url}blog/${p.id}/`;
    const content = `<p><strong>${esc(p.description)}</strong></p>${absolutize(renderMarkdown(p.body), url)}`;
    return `<item><title>${xmlEsc(p.title)}</title><link>${url}</link><guid isPermaLink="true">${url}</guid><pubDate>${new Date(p.ms).toUTCString()}</pubDate><category>${xmlEsc(p.section)}</category><description>${xmlEsc(p.description)}</description><content:encoded>${cdata(content)}</content:encoded></item>`;
  });
  const last = posts[0] ? `<lastBuildDate>${new Date(posts[0].ms).toUTCString()}</lastBuildDate>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
<title>HyperQuant · Analizy BTC</title>
<link>${site.url}blog/</link>
<description>${xmlEsc(INTRO)}</description>
<language>pl</language>${last}
<atom:link href="${site.url}blog/feed.xml" rel="self" type="application/rss+xml"/>
${items.join('\n')}
</channel>
</rss>
`;
}

/** Mapa strony dla wyszukiwarek: desk, blog, wpisy i archiwa miesięcy. */
export function sitemapXml(site, posts) {
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const urls = [{ loc: site.url }];
  if (posts.length) {
    urls.push({ loc: `${site.url}blog/`, lastmod: day(posts[0].ms) });
    for (const p of posts) urls.push({ loc: `${site.url}blog/${p.id}/`, lastmod: day(p.ms) });
    const months = new Map();
    for (const p of posts) if (!months.has(monthKey(p.ms))) months.set(monthKey(p.ms), p.ms);
    for (const [k, ms] of months) urls.push({ loc: `${site.url}blog/archiwum/${k}/`, lastmod: day(ms) });
  } else urls.push({ loc: `${site.url}blog/` });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${xmlEsc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
}
