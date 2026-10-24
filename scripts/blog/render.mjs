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

// ───────────────────────── Udostępnianie ─────────────────────────

// Znaki serwisów: Simple Icons (CC0). Zwykłe linki do okien udostępniania, bez skryptów i ciasteczek serwisów.
const BRANDS = {
  x: 'M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z',
  facebook:
    'M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z',
  linkedin:
    'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
  telegram:
    'M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z',
  whatsapp:
    'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z',
};
// Ikony konturowe: Lucide (ISC), te same co w desku
const ICON_SHARE =
  '<svg class="line" viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51 15.42 17.49M15.41 6.51 8.59 10.49"/></svg>';
const ICON_LINK =
  '<svg class="line ico-link" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
const ICON_CHECK = '<svg class="line ico-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

// Kopiowanie linku i systemowe „Udostępnij” (telefon) wymagają JS: bez niego przyciski zostają ukryte, linki do serwisów działają zawsze
const SHARE_SCRIPT = `<script>
(() => {
  for (const box of document.querySelectorAll('.share')) {
    const { url, title } = box.dataset;
    const native = box.querySelector('[data-share="native"]');
    const copy = box.querySelector('[data-share="copy"]');
    const label = copy.querySelector('span');
    if (navigator.share) {
      native.hidden = false;
      native.addEventListener('click', () => navigator.share({ title, url }).catch(() => {}));
    }
    copy.hidden = false;
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        window.prompt('Link do wpisu', url);
        return;
      }
      copy.dataset.done = '';
      label.textContent = 'Skopiowano';
      setTimeout(() => {
        delete copy.dataset.done;
        label.textContent = 'Kopiuj link';
      }, 2000);
    });
  }
})();
</script>`;

/**
 * Udostępnianie wpisu: X, Facebook, LinkedIn, Telegram, WhatsApp, kopiowanie linku i systemowe „Udostępnij”.
 * `compact`: same ikony (rząd pod tytułem), opisy przycisków tylko dla czytników ekranu i w podpowiedzi.
 */
export function shareHtml(url, title, { compact = false } = {}) {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  const targets = [
    ['x', 'Udostępnij na X', `https://x.com/intent/tweet?text=${t}&url=${u}`],
    ['facebook', 'Udostępnij na Facebooku', `https://www.facebook.com/sharer/sharer.php?u=${u}`],
    ['linkedin', 'Udostępnij na LinkedInie', `https://www.linkedin.com/sharing/share-offsite/?url=${u}`],
    ['telegram', 'Wyślij przez Telegram', `https://t.me/share/url?url=${u}&text=${t}`],
    ['whatsapp', 'Wyślij przez WhatsApp', `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`],
  ];
  const links = targets
    .map(
      ([key, name, href]) =>
        `<a class="share-net" href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="${name}" title="${name}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${BRANDS[key]}"/></svg></a>`
    )
    .join('');
  const tip = (text) => (compact ? ` title="${text}"` : '');
  const label = compact ? ' class="sr-only"' : '';
  const row = `<div class="share-row">
<button type="button" class="share-btn" data-share="native"${tip('Udostępnij')} hidden>${ICON_SHARE}<span${label}>Udostępnij</span></button>
<button type="button" class="share-btn" data-share="copy"${tip('Kopiuj link')} hidden>${ICON_LINK}${ICON_CHECK}<span${label} aria-live="polite">Kopiuj link</span></button>
${links}
</div>`;
  const data = `data-url="${esc(url)}" data-title="${esc(title)}"`;
  if (compact)
    return `<div class="share share--compact" role="group" aria-label="Udostępnij wpis" ${data}>
${row}
</div>`;
  return `<section class="block share" aria-labelledby="share-title" ${data}>
<h2 id="share-title">Udostępnij</h2>
${row}
</section>`;
}

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
<div class="byline">
<p class="meta"><time datetime="${esc(post.date)}">${fmtDay(post.ms)}, ${fmtTime(post.ms)}</time> czasu polskiego</p>
${shareHtml(url, post.title, { compact: true })}
</div>
<p class="lead">${esc(post.description)}</p>
${facts}${levels}${scenarios}
<div class="prose">
${renderMarkdown(post.body)}
</div>
${shareHtml(url, post.title)}
<p class="history">${DISCLOSURE} Wpis jest w publicznej historii repozytorium od chwili publikacji: <a href="${site.repo}/commits/main/content/blog/${post.id}.md">historia zmian</a>.</p>
</article>
${SHARE_SCRIPT}
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
