// Strona „Co nowego” (PL co-nowego/, EN en/whats-new/): historia HyperQuant od pierwszej wersji, prostym językiem, w
// statycznym HTML budowanym przy każdym wdrożeniu z CHANGELOG.md i tagów wersji. Tytuł, grupa i data pozycji pochodzą z
// komentarza HTML pod nagłówkiem sekcji CHANGELOG:
//   <!-- co-nowego: grupa=wykres | pl=Czytelniejsze poziomy dnia | en=Clearer day levels -->
//   <!-- co-nowego: ukryj -->   (zmiana czysto techniczna)
// Sekcja może mieć kilka komentarzy (kilka pozycji), a sekcja bez daty w nagłówku podaje ją w komentarzu (`data=RRRR-MM-DD`).
// Kamienie milowe to tagi `v*` (git) razem z nagłówkami wersji CHANGELOG, więc build bez historii git też ma oś czasu.
// Bez skryptów poza danymi strukturalnymi; okresy zwijane elementem <details>.
import { execFileSync } from 'node:child_process';
import { TITLE_GUARDS, guardHits } from '../../src/utils/safeguards.mjs';
import { esc, layout } from './render.mjs';

export const NEWS_PATHS = { pl: 'co-nowego/', en: 'en/whats-new/' };
/** Grupy w kolejności na stronie */
export const NEWS_GROUPS = {
  wykres: { pl: 'Wykres', en: 'Chart' },
  prognozy: { pl: 'Prognozy i /wyniki', en: 'Forecasts and /results' },
  rynki: { pl: 'Rynki', en: 'Markets' },
  skaner: { pl: 'Skaner i dane', en: 'Scanner and data' },
  blog: { pl: 'Blog i strona', en: 'Blog and site' },
};
/** Poza bezpiecznikami tytułu Klatki: bez słowa „sygnał”, nazw modeli AI i botów, adresów e-mail i ścieżek lokalnych */
export const NEWS_FORBIDDEN = /sygna|signal|claude|\bgpt|openbot|openai|anthropic|gemini|copilot|\bagent|\bbot|[a-z]:\\|\\users\\|\/home\/|@/iu;

const SECTION = /^### (.+?)\s*$/;
const DATED = /\((\d{4}-\d{2}-\d{2})\)\s*$/;
const VERSION = /^## \[(\d+\.\d+\.\d+)\](?:\s*[—–-]\s*(\d{4}-\d{2}-\d{2}))?/;
/** Komentarz w osobnej linii (wzmianka o formacie w treści wypunktowania nie jest pozycją) */
const NOTE = /^<!--\s*co-nowego:(.*?)-->\s*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * CHANGELOG → pozycje strony. `items` = [{ date, group, pl, en, line }] w kolejności pliku, `versions` = nagłówki wersji z datą,
 * `problems` = sekcje bez komentarza, z błędnym komentarzem albo z zakazanym słowem (test CHANGELOG pilnuje, żeby ich nie było),
 * `hidden` = liczba komentarzy `ukryj`.
 */
export function parseChangelog(md) {
  const items = [];
  const versions = [];
  const problems = [];
  let hidden = 0;
  let version = null;
  let section = null;
  const close = () => {
    if (section && !section.notes) problems.push(`${section.title} (linia ${section.line}): brak komentarza co-nowego`);
  };
  String(md)
    .split(/\r?\n/)
    .forEach((l, i) => {
      const v = l.match(VERSION);
      if (l.startsWith('## ')) {
        close();
        section = null;
        version = v ? { version: v[1], date: v[2] ?? null } : null;
        if (v && v[2]) versions.push({ version: v[1], date: v[2] });
        return;
      }
      const s = l.match(SECTION);
      if (s) {
        close();
        section = { title: s[1], line: i + 1, date: s[1].match(DATED)?.[1] ?? version?.date ?? null, notes: 0 };
        return;
      }
      const n = l.match(NOTE);
      if (!n) return;
      const where = section ? `${section.title} (linia ${i + 1})` : `linia ${i + 1}`;
      if (!section) return problems.push(`${where}: komentarz co-nowego poza sekcją ###`);
      section.notes += 1;
      const raw = n[1].trim();
      if (raw === 'ukryj') return void (hidden += 1);
      const f = Object.fromEntries(
        raw.split('|').map((part) => {
          const k = part.indexOf('=');
          return k < 0 ? [part.trim(), ''] : [part.slice(0, k).trim(), part.slice(k + 1).trim()];
        })
      );
      if (f.grupa === 'ukryj') return void (hidden += 1);
      const date = f.data ?? section.date;
      const errs = [];
      if (!(f.grupa in NEWS_GROUPS)) errs.push(`grupa „${f.grupa ?? ''}” (dozwolone: ${Object.keys(NEWS_GROUPS).join(', ')}, ukryj)`);
      if (!f.pl || !f.en) errs.push('brak tytułu pl= albo en=');
      if (!date || !DAY.test(date)) errs.push('brak daty (nagłówek sekcji „(RRRR-MM-DD)” albo data= w komentarzu)');
      for (const t of [f.pl, f.en].filter(Boolean)) {
        if (NEWS_FORBIDDEN.test(t) || guardHits(t, TITLE_GUARDS).length) errs.push(`zakazane słowo w tytule „${t}”`);
      }
      if (errs.length) return problems.push(`${where}: ${errs.join('; ')}`);
      items.push({ date, group: f.grupa, pl: f.pl, en: f.en, line: i + 1 });
    });
  close();
  return { items, versions, problems, hidden };
}

/** Tagi `vX.Y.Z` z datą z lokalnego repo git; bez gita albo bez tagów (płytki checkout) pusta lista. */
export function gitTags(cwd) {
  try {
    const out = execFileSync('git', ['-C', cwd, 'for-each-ref', '--format=%(refname:short) %(creatordate:short)', 'refs/tags/v*'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out
      .split('\n')
      .map((l) => l.trim().match(/^v(\d+\.\d+\.\d+) (\d{4}-\d{2}-\d{2})$/))
      .filter(Boolean)
      .map((m) => ({ version: m[1], date: m[2] }));
  } catch {
    return [];
  }
}

const semver = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/** Kamienie milowe: wersje z CHANGELOG i z tagów (tag wygrywa datą), zebrane po dniach: [{ date, versions }] rosnąco. */
export function milestones(versions = [], tags = []) {
  const byVersion = new Map();
  for (const v of [...versions, ...tags]) if (DAY.test(v.date)) byVersion.set(v.version, v.date);
  const byDay = new Map();
  for (const [version, date] of byVersion) byDay.set(date, [...(byDay.get(date) ?? []), version]);
  return [...byDay]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vs]) => ({ date, versions: vs.sort(semver) }));
}

/**
 * Okresy osi czasu, najnowszy pierwszy: okres kamienia milowego obejmuje pozycje po poprzednim kamieniu do jego dnia
 * włącznie; pozycje po ostatnim kamieniu tworzą okres bez wersji (`versions` puste, `after` = ostatnia wersja).
 * W okresie grupy w kolejności NEWS_GROUPS, w grupie najnowsze pierwsze (ten sam dzień: kolejność CHANGELOG).
 */
export function newsPeriods(items, ms) {
  const periods = ms.map((m, i) => ({ versions: m.versions, to: m.date, after: null, lo: ms[i - 1]?.date ?? '', items: [] }));
  const last = ms.at(-1);
  const open = { versions: [], to: null, after: last?.versions.at(-1) ?? null, lo: last?.date ?? '', items: [] };
  for (const it of items) (periods.find((p) => it.date > p.lo && it.date <= p.to) ?? (it.date > open.lo ? open : periods[0]))?.items.push(it);
  return [...periods, open]
    .filter((p) => p.items.length)
    .reverse()
    .map((p) => {
      const sorted = [...p.items].sort((a, b) => b.date.localeCompare(a.date));
      const dates = sorted.map((x) => x.date);
      return {
        versions: p.versions,
        after: p.after,
        from: dates.at(-1),
        to: p.to ?? dates[0],
        count: sorted.length,
        groups: Object.keys(NEWS_GROUPS)
          .map((group) => ({ group, items: sorted.filter((x) => x.group === group) }))
          .filter((g) => g.items.length),
      };
    });
}

const MONTHS = {
  pl: ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const ymd = (d) => d.split('-').map(Number);
const day = (lang, d) => {
  const [y, m, dd] = ymd(d);
  return lang === 'pl' ? `${dd} ${MONTHS.pl[m - 1]} ${y}` : `${dd} ${MONTHS.en[m - 1]} ${y}`;
};
const span = (lang, a, b) => {
  if (a === b) return day(lang, a);
  const [ya, ma, da] = ymd(a);
  const [yb, mb] = ymd(b);
  const left = ya !== yb ? day(lang, a) : ma !== mb ? (lang === 'pl' ? `${da} ${MONTHS.pl[ma - 1]}` : `${da} ${MONTHS.en[ma - 1]}`) : String(da);
  return `${left}–${day(lang, b)}`;
};
const short = (d) => {
  const [, m, dd] = ymd(d);
  return `${dd}.${String(m).padStart(2, '0')}`;
};
const list = (lang, vs) => (vs.length === 1 ? vs[0] : vs.length === 2 ? `${vs[0]} ${lang === 'pl' ? 'i' : 'and'} ${vs[1]}` : `${vs[0]}–${vs.at(-1)}`);

const T = {
  pl: {
    title: 'Co nowego w HyperQuant: historia zmian · HyperQuant',
    h1: 'Co nowego',
    eyebrow: 'Historia zmian',
    description: 'Co zmieniło się w HyperQuant od pierwszej wersji: wykres, prognozy, rynki, skaner i blog. Najnowsze na górze, prostym językiem.',
    lead: 'Co zmieniło się w HyperQuant od pierwszej wersji, prostym językiem. Najnowsze na górze. Strona powstaje sama z dziennika zmian repozytorium przy każdym wdrożeniu.',
    version: (vs) => `${vs.length > 1 ? 'Wersje' : 'Wersja'} ${list('pl', vs)}`,
    unreleased: (v) => (v ? `Po wersji ${v}, jeszcze bez numeru` : 'Bez numeru wersji'),
    count: (n) => `${n} ${n === 1 ? 'zmiana' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'zmiany' : 'zmian'}`,
    missing: 'dziennik zmian niedostępny przy budowaniu strony',
    empty: 'brak pozycji w dzienniku zmian',
    more: 'Szczegóły techniczne każdej zmiany',
    repo: 'kod HyperQuant na GitHubie',
    changelog: 'pełny CHANGELOG',
    card: { title: 'Co nowego w HyperQuant', subtitle: 'Historia zmian od pierwszej wersji, najnowsze na górze' },
    cardFoot: 'otwarty kod · historia zmian',
  },
  en: {
    title: "What's new in HyperQuant: release history · HyperQuant",
    h1: "What's new",
    eyebrow: 'Release history',
    description: 'What has changed in HyperQuant since the first version: chart, forecasts, markets, scanner and blog. Newest first, in plain words.',
    lead: 'What has changed in HyperQuant since the first version, in plain words. Newest first. The page is generated from the repository changelog on every deploy.',
    version: (vs) => `${vs.length > 1 ? 'Versions' : 'Version'} ${list('en', vs)}`,
    unreleased: (v) => (v ? `Since version ${v}, not yet numbered` : 'Not yet numbered'),
    count: (n) => `${n.toLocaleString('en-GB')} ${n === 1 ? 'change' : 'changes'}`,
    missing: 'changelog unavailable when the page was built',
    empty: 'no entries in the changelog',
    more: 'Technical details of every change',
    repo: 'HyperQuant code on GitHub',
    changelog: 'the full CHANGELOG',
    card: { title: "What's new in HyperQuant", subtitle: 'Release history since the first version, newest first' },
    cardFoot: 'open source · release history',
  },
};

/**
 * Strona „Co nowego” w języku `lang`. `news` = { changelog: treść CHANGELOG.md, tags: [{ version, date }] } (brak treści =
 * „—” z powodem). `disclaimer` = zdanie stopki serwisu.
 */
export function whatsNewPage(site, lang, news = {}, disclaimer) {
  const t = T[lang];
  const path = NEWS_PATHS[lang];
  const root = '../'.repeat(path.split('/').filter(Boolean).length);
  const url = `${site.url}${path}`;
  const alternates = Object.entries(NEWS_PATHS).map(([l, p]) => ({ lang: l, url: `${site.url}${p}` }));
  const na = (why) => `<span class="na">— (${esc(why)})</span>`;
  const parsed = typeof news.changelog === 'string' ? parseChangelog(news.changelog) : null;
  const periods = parsed ? newsPeriods(parsed.items, milestones(parsed.versions, news.tags ?? [])) : [];

  const period = (p, i) => {
    const label = p.versions.length ? t.version(p.versions) : t.unreleased(p.after);
    const many = p.from !== p.to;
    const groups = p.groups
      .map(
        (g) => `<h3>${esc(NEWS_GROUPS[g.group][lang])} <span class="news-n">(${g.items.length})</span></h3>
<ul class="news-list">${g.items.map((x) => `<li>${many ? `<time datetime="${x.date}">${short(x.date)}</time> ` : ''}${esc(x[lang])}</li>`).join('')}</ul>`
      )
      .join('\n');
    return `<details class="news-period"${i === 0 ? ' open' : ''}>
<summary><b>${esc(label)}</b> · <time datetime="${p.to}">${esc(span(lang, p.from, p.to))}</time> · ${esc(t.count(p.count))}</summary>
${groups}
</details>`;
  };
  const timeline = !parsed ? `<p>${na(t.missing)}</p>` : periods.length ? periods.map(period).join('\n') : `<p>${na(t.empty)}</p>`;
  const main = `<article class="page page--news">
<p class="eyebrow"><span>${esc(t.eyebrow)}</span></p>
<h1>${esc(t.h1)}</h1>
<section class="block" id="intro">
<p class="lead">${esc(t.lead)}</p>
</section>
<section class="block" id="timeline">
${timeline}
</section>
<section class="block" id="source">
<p>${esc(t.more)}: <a href="${site.repo}/blob/main/CHANGELOG.md">${esc(t.changelog)}</a> · <a href="${site.repo}">${esc(t.repo)}</a></p>
</section>
</article>`;
  const newest = periods[0]?.to;
  return {
    path,
    lang,
    alternates,
    card: { section: t.eyebrow, ...t.card, foot: [url.replace(/^https?:\/\//, ''), t.cardFoot] },
    html: layout(site, {
      title: t.title,
      description: t.description,
      url,
      root,
      image: `${url}og.png`,
      imageAlt: `HyperQuant: ${t.card.title}`,
      jsonLd: {
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebPage', name: t.title, url, inLanguage: lang, description: t.description, ...(newest ? { dateModified: newest } : {}), isPartOf: { '@type': 'WebSite', name: 'HyperQuant', url: site.url } },
          {
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'HyperQuant', item: site.url },
              { '@type': 'ListItem', position: 2, name: t.h1, item: url },
            ],
          },
        ],
      },
      main,
      lang,
      current: null,
      alternates,
      ...(disclaimer ? { disclaimer } : {}),
    }),
  };
}
