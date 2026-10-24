// Wpisy bloga: odczyt plików Markdown z frontmatterem YAML, walidacja schematu i bezpieczniki treści.
// Ten sam kod sprawdza wpis przed publikacją (`node scripts/blog/build.mjs --check`) i przy budowaniu strony.
// Format opisany w docs/BLOG.md.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

export const TIME_ZONE = 'Europe/Warsaw';
export const TYPES = ['article', 'note'];
/** Nazwa pliku (bez .md) = adres wpisu: data publikacji (czas polski) + krótki opis. */
const ID_RE = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/;
const KNOWN_KEYS = new Set(['title', 'description', 'date', 'type', 'section', 'price', 'levels', 'scenarios', 'draft']);
const LEVEL_KEYS = new Set(['label', 'price', 'note']);
const SCENARIO_KEYS = new Set(['label', 'probability', 'note']);
/** Pola spoza schematu (np. przecinek w nawiasach klamrowych YAML bez cudzysłowu tworzy nowy klucz). */
const extraKeys = (o, known) => (o && typeof o === 'object' ? Object.keys(o).filter((k) => !known.has(k)) : []);

/**
 * Bezpieczniki treści. Każdy wzorzec ma powód, który trafia do komunikatu błędu.
 * Granice słów przez \p{L}, bo \b w JS nie zna polskich liter.
 */
const word = (alts) => new RegExp(`(?<![\\p{L}\\d])(?:${alts})(?![\\p{L}\\d])`, 'iu');
export const GUARDS = [
  // Prywatność: nic, co identyfikuje portfel, transakcję, serwer albo dostęp
  { re: /0x[0-9a-f]{40,}/i, why: 'adres portfela lub hash transakcji' },
  { re: /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/, why: 'adres IP' },
  { re: /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, why: 'adres e-mail' },
  { re: /\d{8,10}:[A-Za-z0-9_-]{35}|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}/, why: 'token lub klucz dostępu' },
  // Analiza, nie sygnały: bez trybu rozkazującego kup/sprzedaj i bez gotowych wejść
  { re: word('kup|kupuj|kupcie|kupujcie|sprzedaj|sprzedawaj|sprzedajcie|shortuj|shortujcie|longuj|longujcie'), why: 'wezwanie do transakcji' },
  {
    re: word('(?:wejdź|wejdźcie|wchodź|wchodźcie|otwórz|otwórzcie|otwieraj|zajmij|zajmijcie|zamknij|zamykaj)\\s+(?:w\\s+)?(?:long\\p{L}*|short\\p{L}*|pozycj\\p{L}*)'),
    why: 'wezwanie do transakcji',
  },
  { re: /(?<![\p{L}])(?:long|short)\s+(?:od|z|przy|po)\s+\d/iu, why: 'gotowe wejście (long/short od ceny)' },
  { re: /(?<![\p{L}])(?:TP|SL|take[ -]profit|stop[ -]loss)\s*[:=]?\s*\d/iu, why: 'poziom TP/SL' },
  // Styl: bez myślników i strzałek
  { re: /—|\s–\s/, why: 'myślnik' },
  { re: /[→←⇒⇐➜➔↑↓]/, why: 'strzałka' },
];

/** Wszystkie naruszenia bezpieczników w tekście (powód + fragment z kontekstem). */
export function guardViolations(text) {
  const out = [];
  for (const g of GUARDS) {
    const m = g.re.exec(text);
    if (m) {
      const from = Math.max(0, m.index - 25);
      out.push(`${g.why}: „…${text.slice(from, m.index + m[0].length + 25).replace(/\s+/g, ' ').trim()}…”`);
    }
  }
  return out;
}

/** Rozdzielenie frontmattera YAML (między liniami ---) i treści. */
export function splitFrontmatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(src);
  if (!m) return null;
  return { data: parseYaml(m[1]) ?? {}, body: m[2] };
}

/** Data w czasie polskim (RRRR-MM-DD) — porównywana z prefiksem nazwy pliku. */
export function localDate(ms) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
}

/** Liczba słów treści (bez znaczników Markdown). */
export function wordCount(md) {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split(/\s+/)
    .filter((w) => /[\p{L}\d]/u.test(w)).length;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/**
 * Walidacja jednego wpisu. Zwraca { post, errors }; post === null, gdy wpis jest niepoprawny.
 * `id` = nazwa pliku bez .md, `body` = treść Markdown, `data` = frontmatter.
 */
export function validatePost(id, data, body) {
  const errors = [];
  const err = (msg) => errors.push(msg);
  const idMatch = ID_RE.exec(id);
  if (!idMatch) err('nazwa pliku: RRRR-MM-DD-opis (małe litery, cyfry, myślniki), np. 2026-10-26-mapa-dnia');
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { post: null, errors: ['frontmatter musi być mapą klucz: wartość'] };

  for (const k of Object.keys(data)) if (!KNOWN_KEYS.has(k)) err(`nieznane pole „${k}”`);
  if (!isText(data.title, 90)) err('title: wymagany, do 90 znaków');
  if (typeof data.description !== 'string' || data.description.length < 50 || data.description.length > 220)
    err('description: wymagany, 50–220 znaków (zajawka, opis w Google i w podglądzie linku)');
  if (!TYPES.includes(data.type)) err(`type: ${TYPES.join(' albo ')}`);
  if (!isText(data.section, 40)) err('section: wymagana rubryka do 40 znaków, np. „Mapa dnia”');
  if (data.draft !== undefined && typeof data.draft !== 'boolean') err('draft: true albo false');

  let ms = NaN;
  if (typeof data.date !== 'string' || !DATE_RE.test(data.date)) err('date: ISO 8601 ze strefą, np. 2026-10-26T08:00:00+01:00');
  else {
    ms = Date.parse(data.date);
    if (!Number.isFinite(ms)) err('date: niepoprawna data');
    else if (idMatch && localDate(ms) !== idMatch[1]) err(`date: dzień w czasie polskim (${localDate(ms)}) różni się od prefiksu nazwy pliku (${idMatch[1]})`);
  }

  if (data.price !== undefined && !(isNum(data.price) && data.price > 0)) err('price: liczba dodatnia');

  const levels = data.levels ?? [];
  if (!Array.isArray(levels) || levels.length > 12) err('levels: lista do 12 poziomów');
  else
    levels.forEach((l, i) => {
      for (const k of extraKeys(l, LEVEL_KEYS)) err(`levels[${i}]: nieznane pole „${k}” (tekst z przecinkiem ujmij w cudzysłów)`);
      if (!l || !isText(l.label, 20)) err(`levels[${i}].label: wymagana nazwa do 20 znaków`);
      if (!l || !(isNum(l.price) && l.price > 0)) err(`levels[${i}].price: liczba dodatnia`);
      if (l?.note !== undefined && !isText(l.note, 40)) err(`levels[${i}].note: tekst do 40 znaków`);
    });
  if (Array.isArray(levels) && levels.length > 0 && data.price === undefined) err('levels: wymagają pola price (cena w chwili publikacji)');

  const scenarios = data.scenarios ?? [];
  if (!Array.isArray(scenarios) || scenarios.length > 4) err('scenarios: lista do 4 scenariuszy');
  else {
    scenarios.forEach((s, i) => {
      for (const k of extraKeys(s, SCENARIO_KEYS)) err(`scenarios[${i}]: nieznane pole „${k}” (tekst z przecinkiem ujmij w cudzysłów)`);
      if (!s || !isText(s.label, 60)) err(`scenarios[${i}].label: wymagana nazwa do 60 znaków`);
      if (!s || !(Number.isInteger(s.probability) && s.probability >= 1 && s.probability <= 99)) err(`scenarios[${i}].probability: liczba całkowita 1–99 (%)`);
      if (s?.note !== undefined && !isText(s.note, 240)) err(`scenarios[${i}].note: tekst do 240 znaków`);
    });
    const sum = scenarios.reduce((a, s) => a + (Number.isInteger(s?.probability) ? s.probability : 0), 0);
    if (sum > 100) err(`scenarios: suma prawdopodobieństw ${sum}% > 100%`);
  }

  if (/^#\s/m.test(body)) err('treść: bez nagłówka # (tytuł strony to title); sekcje od ##');
  const words = wordCount(body);
  if (data.type === 'article' && words < 150) err(`treść: artykuł ma ${words} słów, minimum 150`);
  if (data.type === 'note' && (words < 15 || words > 250)) err(`treść: notka ma ${words} słów, dozwolone 15–250`);

  // Bezpieczniki na całym tekście, który trafia na stronę
  const texts = [data.title, data.description, data.section, body, ...levels.flatMap((l) => [l?.label, l?.note]), ...scenarios.flatMap((s) => [s?.label, s?.note])];
  for (const v of guardViolations(texts.filter((t) => typeof t === 'string').join('\n'))) err(v);

  if (errors.length) return { post: null, errors };
  return {
    post: {
      id,
      title: data.title.trim(),
      description: data.description.trim(),
      date: data.date,
      ms,
      type: data.type,
      section: data.section.trim(),
      price: data.price ?? null,
      levels: levels.map((l) => ({ label: l.label.trim(), price: l.price, note: l.note?.trim() ?? null })),
      scenarios: scenarios.map((s) => ({ label: s.label.trim(), probability: s.probability, note: s.note?.trim() ?? null })),
      draft: data.draft === true,
      body,
    },
    errors: [],
  };
}

/** Odczyt i walidacja pliku wpisu; media wpisu (katalog o tej samej nazwie) dołączane do wyniku. */
export function loadPostFile(file) {
  const id = path.basename(file, '.md');
  let split;
  try {
    split = splitFrontmatter(readFileSync(file, 'utf8'));
  } catch (e) {
    return { id, post: null, errors: [`frontmatter: błąd YAML (${e.message.split('\n')[0]})`] };
  }
  if (!split) return { id, post: null, errors: ['brak frontmattera (blok YAML między liniami ---)'] };
  const { post, errors } = validatePost(id, split.data, split.body);
  if (post) {
    const dir = path.join(path.dirname(file), id);
    post.mediaDir = existsSync(dir) && statSync(dir).isDirectory() ? dir : null;
    // Obrazy w treści: tylko pliki z katalogu mediów wpisu albo adresy https
    for (const m of post.body.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)) {
      const src = m[1];
      if (/^https:\/\//.test(src)) continue;
      if (src.includes('..') || src.startsWith('/') || !post.mediaDir || !existsSync(path.join(post.mediaDir, src)))
        errors.push(`obraz „${src}”: brak pliku w content/blog/${id}/`);
    }
  }
  return { id, post: errors.length ? null : post, errors };
}

/** Wszystkie wpisy z katalogu (pliki *.md poza README), od najnowszego; błędy zebrane per plik. */
export function loadPosts(dir) {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md') : [];
  const posts = [];
  const problems = [];
  for (const f of files.sort()) {
    const r = loadPostFile(path.join(dir, f));
    if (r.post) posts.push(r.post);
    else problems.push({ file: f, errors: r.errors });
  }
  posts.sort((a, b) => b.ms - a.ms || (a.id < b.id ? 1 : -1));
  return { posts, problems };
}
