// Strony serwisu poza aplikacją: wejścia do Wykresów i Lekcji (PL i EN), hasła atlasu wskaźników jako osobne strony
// i strona 404. Statyczny HTML dla wyszukiwarek i podglądu linków; aplikacja zostaje pod adresem desku (#charts, #lessons).
// Treść lekcji pochodzi z tych samych plików co zakładka Lekcje (src/lessons/content), więc strony nie rozjeżdżają się z nią.
import { en } from '../../src/lessons/content/en.ts';
import { pl } from '../../src/lessons/content/pl.ts';
import { EXERCISES } from '../../src/lessons/exercises.ts';
import { esc, layout } from './render.mjs';

const LESSONS = { pl, en };
export const LANGS = ['pl', 'en'];

/** Ścieżki stron od korzenia desku. */
export const PATHS = {
  charts: { pl: 'wykresy/', en: 'en/charts/' },
  lessons: { pl: 'lekcje/', en: 'en/lessons/' },
};
const atlasPath = (lang, id) => `${PATHS.lessons[lang]}atlas/${id}/`;
/** Względna ścieżka do korzenia desku ze strony pod `path`. */
const rootOf = (path) => '../'.repeat(path.split('/').filter(Boolean).length);

/** Zrzuty ekranu aplikacji (scripts/blog/shots → site/ na stronie, zapisane w 2×): wymiary w px CSS i wycinek do karty podglądu. */
export const SHOTS = {
  charts: { w: 1440, h: 700, crop: [440, 196, 400, 310] },
  lessons: { w: 1440, h: 810, crop: [24, 244, 560, 433] },
};
export const shotFile = (kind, lang) => `${kind}-${lang}.jpg`;

/** Opis do 160 znaków, ucięty na granicy słowa. */
export function clip(text, max = 160) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,:;.]$/, '')}…`;
}

const T = {
  pl: {
    footSite: 'Narzędzie edukacyjne i analityczne, nie porada inwestycyjna ani sygnał do transakcji. Handel kontraktami z dźwignią wiąże się z wysokim ryzykiem utraty środków.',
    cardFoot: 'otwarte dane · bez sygnałów',
    lessons: 'Lekcje',
    charts: 'Wykresy',
    atlas: 'Atlas wskaźników',
    openCharts: 'Otwórz Wykresy',
    openInLessons: 'Zobacz w Lekcjach',
    figureNote: 'Rycina z prawdziwego wycinka rynku, ćwiczenia i przycisk stacji Wykresów są w zakładce Lekcje.',
    prev: 'Poprzednie hasło',
    next: 'Następne hasło',
    desk: {
      section: 'Desk',
      title: 'Darmowy desk do day tradingu BTC na Hyperliquid',
      subtitle: 'Wykresy orderflow na żywo, lekcje na prawdziwych dniach i analizy BTC',
    },
    chartsPage: {
      title: 'Wykresy orderflow BTC na żywo: footprint, delta, CVD · HyperQuant',
      h1: 'Wykresy orderflow BTC na żywo',
      description:
        'Darmowe wykresy BTC, ETH, SOL i HYPE z Hyperliquid: footprint z prawdziwej taśmy, delta, CVD, mapa ciepła arkusza i powtórka nagranej doby. Bez rejestracji.',
      lead: 'Darmowe wykresy kontraktów BTC, ETH, SOL i HYPE z Hyperliquid na silniku TradingView Lightweight Charts™. Footprint, delta, CVD i mapa ciepła arkusza działają od pierwszej sekundy, bo serwer HyperQuant nagrywa taśmę i arkusz z ostatniej doby. Bez rejestracji i bez sygnałów kupna albo sprzedaży.',
      replay: 'Powtórka ostatniej doby',
      shotAlt: 'Wykresy HyperQuant: footprint BTC 1 min z mapą ciepła arkusza, bąblami dużych zleceń, panelem Kto handluje i taśmą zleceń',
      caption: 'Stacja Skalper w powtórce sesji z soboty 24 października 2026: footprint 1 min, mapa ciepła arkusza, bąble dużych zleceń, Kto handluje i taśma zleceń.',
      card: { title: 'Wykresy orderflow BTC na żywo', subtitle: 'Footprint, delta, CVD, mapa ciepła arkusza i powtórka nagranej doby' },
      featuresTitle: 'Co jest na Wykresach',
      features: [
        [
          'Footprint z prawdziwej taśmy',
          'Każda transakcja Hyperliquid ma stronę agresora, więc footprint liczymy z taśmy, nie z przybliżeń. Z daleka świeca, bliżej profil w świecy, z bliska komórki z liczbami na każdym poziomie ceny. Style Bid × Ask, Delta i Wolumen, POC, obszar wartości 70%, nierównowagi diagonalne i strefy.',
        ],
        [
          'Delta, CVD i Stan rynku',
          'Świece delty z ekstremami i CVD zerowane na sesję Azji, Londynu i Nowego Jorku, dobę albo tydzień. Stan rynku opisuje bieżącą sytuację jednym zdaniem ze stałych reguł, a „skąd?” pokazuje liczby za każdą jego częścią. To opis, nie sygnał.',
        ],
        [
          'Arkusz, duże zlecenia i wieloryby',
          'Mapa ciepła arkusza, bąble dużych zleceń agresora, serie, ściany makerów, góry lodowe i duże zlecenia oczekujące w arkuszu. Wieloryby pod pseudonimem ważnym jedną dobę, nigdy z adresem.',
        ],
        [
          'Od pierwszej sekundy i w powtórce',
          'Ostatnia doba taśmy i arkusza z nagrania serwera, więc nie trzeba czekać, aż wykres się zapełni. Powtórka odtwarza nagraną dobę na tym samym wykresie w tempie 1×, 5×, 15× albo 60×, a link otwiera wybraną chwilę.',
        ],
        [
          'Stacje robocze',
          'Start, Skalper, Płynność, Aukcja, Giełdy i Dwa interwały: układ, interwały, warstwy i panele pod jedno pytanie tradera, jednym kliknięciem. Twoje zmiany zostają jako Twoja wersja stacji.',
        ],
        [
          'Wskaźniki i rysowanie',
          'VWAP dnia z pasmami ±1σ i ±2σ, profil wolumenu z POC, VAH i VAL, PDH i PDL, otwarcia sesji, initial balance, TPO i klastry likwidacji. Narzędzia rysowania jak w TradingView: linie, Fibonacci, pomiar z wolumenem i deltą, pozycja long i short z R:R, VWAP zakotwiczony.',
        ],
        [
          'Na telefonie',
          'Karty Wykres, Taśma, DOM i Liczby, jedna naraz, z wykresem na większości ekranu. Desk instaluje się jak aplikacja (PWA).',
        ],
      ],
      principlesTitle: 'Dane i zasady',
      principles:
        'Dane pochodzą z publicznego API Hyperliquid i z nagrania serwera HyperQuant w publicznym repozytorium. Binance i Bybit tylko po włączeniu, a połączenie nawiązuje Twoja przeglądarka. Rysunki, alerty i ustawienia zostają w Twojej przeglądarce. Kod jest otwarty (licencja MIT).',
      more: [
        ['Naucz się czytać te wskaźniki: Lekcje', 'lessons'],
        ['Analizy BTC pisane przed faktem: Blog', 'blog'],
      ],
    },
    lessonsPage: {
      title: 'Lekcje orderflow na prawdziwych danych BTC · HyperQuant',
      h1: 'Lekcje orderflow na prawdziwych dniach BTC',
      description:
        'Darmowe ćwiczenia na prawdziwych dniach BTC i atlas 21 wskaźników orderflow: footprint, CVD, VWAP, profil wolumenu, TPO, likwidacje. Bez sygnałów i obietnic.',
      start: 'Zacznij ćwiczenia',
      shotAlt: 'Lekcje HyperQuant: ćwiczenie na prawdziwym dniu BTC z wykresem zatrzymanym w ważnym momencie i pytaniem',
      caption: 'Ćwiczenie „Kaskada likwidacji i kto kupuje odbicie” na danych z soboty 24 października 2026.',
      card: { title: 'Lekcje orderflow na prawdziwych dniach BTC', subtitle: 'Ćwiczenia, atlas 21 wskaźników, łączenie ich i laboratorium ryzyka' },
      exercisesTitle: 'Ćwiczenia „Co byś zrobił?”',
      atlasTitle: 'Atlas wskaźników orderflow',
      combineTitle: 'Jak łączyć wskaźniki',
      mythsTitle: 'Popularne reguły i dane',
      riskTitle: 'Laboratorium ryzyka',
      openTab: 'Otwórz w Lekcjach',
    },
    atlasTitle: (name) => `${name} · Atlas wskaźników orderflow · HyperQuant`,
    notFound: {
      title: 'Nie ma takiej strony · HyperQuant',
      h1: 'Nie ma takiej strony',
      text: 'Adres mógł się zmienić albo zawiera literówkę. Tu jest wszystko, co mamy:',
    },
  },
  en: {
    footSite: 'An educational and analytical tool, not investment advice or a trading signal. Trading leveraged contracts carries a high risk of losing money.',
    cardFoot: 'open data · no signals',
    lessons: 'Lessons',
    charts: 'Charts',
    atlas: 'Indicator atlas',
    openCharts: 'Open Charts',
    openInLessons: 'See it in Lessons',
    figureNote: 'The figure from a real market slice, the exercises and the Charts workstation button are in the Lessons tab.',
    prev: 'Previous entry',
    next: 'Next entry',
    desk: {
      section: 'Desk',
      title: 'Free BTC day-trading desk for Hyperliquid',
      subtitle: 'Live order-flow charts, lessons on real days and BTC analyses',
    },
    chartsPage: {
      title: 'Live BTC order-flow charts: footprint, delta, CVD · HyperQuant',
      h1: 'Live BTC order-flow charts',
      description:
        'Free BTC, ETH, SOL and HYPE charts with Hyperliquid data: footprint from the real tape, delta, CVD, order-book heatmap and a replay of the recorded day. No sign-up.',
      lead: 'Free charts of BTC, ETH, SOL and HYPE perpetuals on Hyperliquid, on the TradingView Lightweight Charts™ engine. Footprint, delta, CVD and the order-book heatmap work from the first second, because the HyperQuant server records the last 24 hours of tape and book. No sign-up and no buy or sell signals.',
      replay: 'Replay the last 24 hours',
      shotAlt: 'HyperQuant Charts: 1-minute BTC footprint with the order-book heatmap, large-order bubbles, the Who is trading panel and the order tape',
      caption: 'The Scalper workstation replaying the session of Saturday 24 October 2026: 1-minute footprint, order-book heatmap, large-order bubbles, Who is trading and the order tape.',
      card: { title: 'Live BTC order-flow charts', subtitle: 'Footprint, delta, CVD, order-book heatmap and a 24-hour replay' },
      featuresTitle: 'What is in Charts',
      features: [
        [
          'Footprint from the real tape',
          'Every Hyperliquid trade carries the aggressor side, so the footprint is computed from the tape, not approximated. Zoomed out a candle, closer a volume profile inside the candle, closer still cells with numbers on every price row. Bid × Ask, Delta and Volume styles, POC, 70% value area, diagonal imbalances and stacked zones.',
        ],
        [
          'Delta, CVD and Market state',
          'Delta candles with their extremes and CVD reset per Asia, London and New York session, UTC day or week. Market state describes the current situation in one sentence built from fixed rules, and “why?” shows the numbers behind each part. A description, not a signal.',
        ],
        [
          'Order book, large orders and whales',
          'Order-book heatmap, aggressor order bubbles, bursts, maker walls, icebergs and large resting orders in the book. Whales under a pseudonym valid for one day, never with an address.',
        ],
        [
          'From the first second, and in replay',
          'The last 24 hours of tape and book come from the server recording, so there is no waiting for the chart to fill. Replay plays the recorded day on the same chart at 1×, 5×, 15× or 60×, and a link opens a chosen moment.',
        ],
        [
          'Workstations',
          'Start, Scalper, Liquidity, Auction, Exchanges and Two timeframes: layout, timeframes, layers and panels for one trader question in a single click. Your changes are kept as your own version of the workstation.',
        ],
        [
          'Indicators and drawing',
          'Daily VWAP with ±1σ and ±2σ bands, volume profile with POC, VAH and VAL, PDH and PDL, session opens, initial balance, TPO and liquidation clusters. Drawing tools like TradingView: lines, Fibonacci, measure with volume and delta, long and short position with R:R, anchored VWAP.',
        ],
        [
          'On your phone',
          'Chart, Tape, DOM and Numbers cards, one at a time, with the chart taking most of the screen. The desk installs like an app (PWA).',
        ],
      ],
      principlesTitle: 'Data and principles',
      principles:
        "Data comes from Hyperliquid's public API and from the HyperQuant server recording in a public repository. Binance and Bybit only when you switch them on, and your own browser makes the connection. Drawings, alerts and settings stay in your browser. The code is open source (MIT licence).",
      more: [
        ['Learn to read these indicators: Lessons', 'lessons'],
        ['BTC analyses written before the fact: Blog (in Polish)', 'blog'],
      ],
    },
    lessonsPage: {
      title: 'Order-flow lessons on real BTC data · HyperQuant',
      h1: 'Order-flow lessons on real BTC days',
      description:
        'Free exercises on real BTC days and an atlas of 21 order-flow indicators: footprint, CVD, VWAP, volume profile, TPO, liquidations. No signals, no promises.',
      start: 'Start the exercises',
      shotAlt: 'HyperQuant Lessons: an exercise on a real BTC day with the chart stopped at a key moment and a question',
      caption: 'The exercise “Liquidation cascade and who buys the bounce” on data from Saturday 24 October 2026.',
      card: { title: 'Order-flow lessons on real BTC days', subtitle: 'Exercises, an atlas of 21 indicators, how to combine them and a risk lab' },
      exercisesTitle: '“What would you do?” exercises',
      atlasTitle: 'Order-flow indicator atlas',
      combineTitle: 'How to combine indicators',
      mythsTitle: 'Popular rules and the data',
      riskTitle: 'Risk lab',
      openTab: 'Open in Lessons',
    },
    atlasTitle: (name) => `${name} · Order-flow indicator atlas · HyperQuant`,
  },
};

const breadcrumbs = (items) => ({
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })),
});
const publisher = (site) => ({ '@type': 'Organization', name: 'HyperQuant', url: site.url, logo: { '@type': 'ImageObject', url: `${site.url}icons/icon-512.png` } });

/** Wersje językowe strony (adresy bezwzględne). */
const alternatesOf = (site, pathFor) => LANGS.map((l) => ({ lang: l, url: `${site.url}${pathFor(l)}` }));

function shotFigure(root, kind, lang, alt, caption) {
  const s = SHOTS[kind];
  return `<figure class="shot"><img src="${root}site/${shotFile(kind, lang)}" width="${s.w}" height="${s.h}" alt="${esc(alt)}" decoding="async"><figcaption>${esc(caption)}</figcaption></figure>`;
}

/** Strona wejściowa Wykresów. */
function chartsPage(site, lang) {
  const t = T[lang];
  const c = t.chartsPage;
  const path = PATHS.charts[lang];
  const root = rootOf(path);
  const url = `${site.url}${path}`;
  const alternates = alternatesOf(site, (l) => PATHS.charts[l]);
  const more = c.more.map(([label, key]) => `<li><a href="${root}${key === 'blog' ? 'blog/' : PATHS[key][lang]}">${esc(label)}</a></li>`).join('');
  const main = `<article class="page page--charts">
<p class="eyebrow"><span>${esc(t.charts)}</span></p>
<h1>${esc(c.h1)}</h1>
<p class="lead">${esc(c.lead)}</p>
<p class="cta"><a class="btn btn--primary" href="${root}#charts">${esc(t.openCharts)}</a><a class="btn" href="${root}#charts?replay=history&amp;m=BTC&amp;station=scalp">${esc(c.replay)}</a></p>
${shotFigure(root, 'charts', lang, c.shotAlt, c.caption)}
<section class="block"><h2>${esc(c.featuresTitle)}</h2><ul class="features">${c.features.map(([h, p]) => `<li><h3>${esc(h)}</h3><p>${esc(p)}</p></li>`).join('')}</ul></section>
<section class="block"><h2>${esc(c.principlesTitle)}</h2><p>${esc(c.principles)}</p></section>
<p class="cta"><a class="btn btn--primary" href="${root}#charts">${esc(t.openCharts)}</a></p>
<ul class="more">${more}</ul>
</article>`;
  return {
    path,
    lang,
    alternates,
    card: { section: t.charts, ...c.card, shot: { kind: 'charts', lang }, foot: [url.replace(/^https?:\/\//, ''), t.cardFoot] },
    html: layout(site, {
      title: c.title,
      description: c.description,
      url,
      root,
      image: `${url}og.png`,
      imageAlt: `HyperQuant: ${c.card.title}`,
      jsonLd: {
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebPage', name: c.title, url, inLanguage: lang, description: c.description, isPartOf: { '@type': 'WebSite', name: 'HyperQuant', url: site.url } },
          {
            '@type': 'WebApplication',
            name: `HyperQuant ${t.charts}`,
            url: `${site.url}#charts`,
            applicationCategory: 'FinanceApplication',
            operatingSystem: 'Web',
            isAccessibleForFree: true,
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
          },
          breadcrumbs([
            ['HyperQuant', site.url],
            [t.charts, url],
          ]),
        ],
      },
      main,
      lang,
      current: 'charts',
      alternates,
      disclaimer: t.footSite,
    }),
  };
}

/** Strona wejściowa Lekcji: ćwiczenia, atlas wskaźników (linki do haseł), łączenie, mity i ryzyko. */
function lessonsPage(site, lang) {
  const t = T[lang];
  const c = t.lessonsPage;
  const L = LESSONS[lang];
  const path = PATHS.lessons[lang];
  const root = rootOf(path);
  const url = `${site.url}${path}`;
  const alternates = alternatesOf(site, (l) => PATHS.lessons[l]);
  const exercises = EXERCISES.map((e) => {
    const x = L.exercises[e.id];
    return `<li><a href="${root}#lessons?ex=${e.id}"><span class="card-meta">${esc(x.when)} · ${esc(L.ui.level(e.level))}</span><span class="card-title">${esc(x.title)}</span><span class="card-text">${esc(x.tagline)}</span></a></li>`;
  }).join('');
  const groups = Object.entries(L.atlas.groups)
    .map(([g, name]) => {
      const items = L.atlas.entries
        .filter((e) => e.group === g)
        .map((e) => `<li><a href="atlas/${e.id}/"><span class="card-title">${esc(e.name)}</span><span class="card-text">${esc(e.what)}</span></a></li>`)
        .join('');
      return `<h3>${esc(name)}</h3><ul class="cards cards--atlas">${items}</ul>`;
    })
    .join('');
  const tab = (id) => `<p class="tab-link"><a href="${root}#lessons?tab=${id}">${esc(c.openTab)}</a></p>`;
  const main = `<article class="page page--lessons">
<p class="eyebrow"><span>${esc(t.lessons)}</span></p>
<h1>${esc(c.h1)}</h1>
<p class="lead">${esc(L.ui.lead)}</p>
<p class="cta"><a class="btn btn--primary" href="${root}#lessons">${esc(c.start)}</a><a class="btn" href="#atlas">${esc(t.atlas)}</a></p>
${shotFigure(root, 'lessons', lang, c.shotAlt, c.caption)}
<section class="block"><h2>${esc(c.exercisesTitle)}</h2><p>${esc(L.ui.exercisesIntro)}</p><ol class="cards">${exercises}</ol></section>
<section class="block" id="atlas"><h2>${esc(c.atlasTitle)}</h2><p>${esc(L.atlas.intro)}</p>${groups}</section>
<section class="block"><h2>${esc(c.combineTitle)}</h2><p>${esc(L.combine.intro)}</p><ol class="questions">${L.combine.questions.map((q) => `<li><b>${esc(q.q)}</b> ${esc(q.tools)}</li>`).join('')}</ol>${tab('combine')}</section>
<section class="block"><h2>${esc(c.mythsTitle)}</h2><p>${esc(L.myths.intro)}</p>${tab('myths')}</section>
<section class="block"><h2>${esc(c.riskTitle)}</h2><p>${esc(L.risk.intro)}</p>${tab('risk')}</section>
<p class="cta"><a class="btn btn--primary" href="${root}#lessons">${esc(c.start)}</a><a class="btn" href="${root}${PATHS.charts[lang]}">${esc(t.charts)}</a></p>
</article>`;
  return {
    path,
    lang,
    alternates,
    card: { section: t.lessons, ...c.card, shot: { kind: 'lessons', lang }, foot: [url.replace(/^https?:\/\//, ''), t.cardFoot] },
    html: layout(site, {
      title: c.title,
      description: c.description,
      url,
      root,
      image: `${url}og.png`,
      imageAlt: `HyperQuant: ${c.card.title}`,
      jsonLd: {
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebPage', name: c.title, url, inLanguage: lang, description: c.description, isPartOf: { '@type': 'WebSite', name: 'HyperQuant', url: site.url } },
          breadcrumbs([
            ['HyperQuant', site.url],
            [t.lessons, url],
          ]),
        ],
      },
      main,
      lang,
      current: 'lessons',
      alternates,
      disclaimer: t.footSite,
    }),
  };
}

/** Hasło atlasu: co to jest, jak liczymy, jak czytać, pułapki, z czym łączyć, gdzie na Wykresach. */
function atlasPage(site, lang, entry, prev, next) {
  const t = T[lang];
  const L = LESSONS[lang];
  const lb = L.atlas.labels;
  const path = atlasPath(lang, entry.id);
  const root = rootOf(path);
  const url = `${site.url}${path}`;
  const lessonsUrl = `${site.url}${PATHS.lessons[lang]}`;
  const alternates = alternatesOf(site, (l) => atlasPath(l, entry.id));
  const list = (items) => `<ul>${items.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`;
  const pager = [
    prev ? `<a class="pager-older" href="../${prev.id}/"><span>${esc(t.prev)}</span>${esc(prev.name)}</a>` : '<span></span>',
    next ? `<a class="pager-newer" href="../${next.id}/"><span>${esc(t.next)}</span>${esc(next.name)}</a>` : '<span></span>',
  ].join('');
  const main = `<article class="page page--atlas">
<p class="eyebrow"><a href="../../">${esc(t.lessons)}</a><a href="../../#atlas">${esc(t.atlas)}</a><span>${esc(L.atlas.groups[entry.group])}</span></p>
<h1>${esc(entry.name)}</h1>
<p class="lead">${esc(entry.what)}</p>
<div class="prose">
<h2>${esc(lb.how)}</h2><p>${esc(entry.how)}</p>
<h2>${esc(lb.read)}</h2>${list(entry.read)}
<h2>${esc(lb.traps)}</h2>${list(entry.traps)}
<h2>${esc(lb.combine)}</h2>${list(entry.combine)}
<h2>${esc(lb.where)}</h2><p>${esc(entry.where)}</p>
</div>
${entry.figure ? `<p class="fig-note">${esc(t.figureNote)}</p>` : ''}
<p class="cta"><a class="btn btn--primary" href="${root}#lessons?tab=atlas&amp;id=${entry.id}">${esc(t.openInLessons)}</a><a class="btn" href="${root}#charts">${esc(t.openCharts)}</a></p>
</article>
<nav class="pager" aria-label="${esc(t.atlas)}">${pager}</nav>`;
  const description = clip(`${entry.what} ${entry.how}`);
  return {
    path,
    lang,
    alternates,
    card: { section: t.atlas, title: entry.name, subtitle: entry.what, body: entry.how, foot: [`${site.url.replace(/^https?:\/\//, '')}${PATHS.lessons[lang]}`, t.cardFoot] },
    html: layout(site, {
      title: t.atlasTitle(entry.name),
      description,
      url,
      root,
      image: `${url}og.png`,
      imageAlt: `${t.atlas}: ${entry.name}`,
      type: 'article',
      jsonLd: {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'Article',
            headline: entry.name,
            description,
            inLanguage: lang,
            url,
            mainEntityOfPage: url,
            image: `${url}og.png`,
            author: { '@type': 'Organization', name: 'HyperQuant', url: site.url },
            publisher: publisher(site),
            isPartOf: { '@type': 'WebPage', name: t.atlas, url: `${lessonsUrl}#atlas` },
          },
          breadcrumbs([
            ['HyperQuant', site.url],
            [t.lessons, lessonsUrl],
            [entry.name, url],
          ]),
        ],
      },
      main,
      lang,
      current: 'lessons',
      alternates,
      disclaimer: t.footSite,
    }),
  };
}

/** Strona 404: GitHub Pages podaje ją pod brakującym adresem, więc wszystkie linki są bezwzględne. */
function notFoundPage(site) {
  const t = T.pl;
  const u = site.url;
  const link = (href, label, lang) => `<li><a href="${u}${href}"${lang ? ` lang="${lang}" hreflang="${lang}"` : ''}>${esc(label)}</a></li>`;
  const main = `<article class="page page--404">
<h1>${esc(t.notFound.h1)}</h1>
<p class="lead">${esc(t.notFound.text)}</p>
<ul class="more">${link('', 'Desk')}${link(PATHS.charts.pl, T.pl.charts)}${link(PATHS.lessons.pl, T.pl.lessons)}${link('blog/', 'Blog')}</ul>
<p lang="en">This page does not exist. In English: <a href="${u}${PATHS.charts.en}">Charts</a> · <a href="${u}${PATHS.lessons.en}">Lessons</a></p>
</article>`;
  return {
    path: '404.html',
    lang: 'pl',
    html: layout(site, {
      title: t.notFound.title,
      description: t.notFound.text,
      url: `${u}404.html`,
      root: u,
      image: `${u}og.png`,
      imageAlt: `HyperQuant: ${t.desk.title}`,
      jsonLd: { '@context': 'https://schema.org', '@type': 'WebPage', name: t.notFound.title, inLanguage: 'pl' },
      main,
      current: null,
      robots: 'noindex',
      disclaimer: t.footSite,
    }),
  };
}

/**
 * Wszystkie strony serwisu: { path, lang, html, alternates?, card? }. `card` (dane karty podglądu linku) trafia do `<path>og.png`.
 * Karta desku (strona aplikacji, index.html) ma ścieżkę '' i nie ma HTML.
 */
export function sitePages(site) {
  const out = [];
  for (const lang of LANGS) {
    out.push(chartsPage(site, lang), lessonsPage(site, lang));
    const entries = LESSONS[lang].atlas.entries;
    entries.forEach((e, i) => out.push(atlasPage(site, lang, e, entries[i - 1], entries[i + 1])));
  }
  out.push(notFoundPage(site));
  out.push({ path: '', lang: 'pl', card: { ...T.pl.desk, shot: { kind: 'charts', lang: 'pl' }, foot: [site.url.replace(/^https?:\/\//, ''), T.pl.cardFoot] } });
  return out;
}

/** Wpisy mapy strony: strony z wersjami językowymi (bez 404 i karty desku). */
export function sitemapEntries(site, pages) {
  return pages.filter((p) => p.alternates).map((p) => ({ loc: `${site.url}${p.path}`, alternates: p.alternates }));
}
