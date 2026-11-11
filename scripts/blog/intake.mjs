#!/usr/bin/env node
// Filtr treści gałęzi `blog` repo danych: wpisy z zewnątrz to niezaufane dane. Do content/blog/ trafiają tylko zwykłe pliki
// z nazwami i typami z listy, obrazy rozpoznane po pierwszych bajtach, w limitach rozmiaru i liczby, z datą w granicach;
// zły wpis jest pomijany z powodem (reszta strony buduje się dalej). Walidator treści (posts.mjs) działa potem w generatorze.
// Bez zależności npm: działa przed `npm ci` (jak scripts/fetch-public-data.mjs). Opis: docs/BLOG.md.
// Użycie w GitHub Actions:
//   node scripts/blog/intake.mjs published                     → `published=<sha>` i `known=true|false` (blog/source.json strony)
//   node scripts/blog/intake.mjs filter --src <klon> --dest content/blog --prev <sha> --out <raport.json>
//                                                               (bez --src: gałęzi nie ma, raport z poprzednim sha)
//   node scripts/blog/intake.mjs changed --src <klon> --prev <sha>   → zmienione pliki jako content/blog/… (IndexNow)
import { execFileSync } from 'node:child_process';
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Wpis: plik w katalogu głównym gałęzi `RRRR-MM-DD-opis.md`; folder mediów o tej samej nazwie. */
const POST_FILE = /^(\d{4}-\d{2}-\d{2})-[a-z0-9-]{1,60}\.md$/;
/** Obraz wpisu; to samo jest jedynym dozwolonym `src` obrazu w treści (posts.mjs, render.mjs). */
export const IMAGE_FILE = /^[a-z0-9-]+\.(?:png|jpg|webp)$/;
/** Pliki w folderze wpisu (ta sama lista kopiuje media wpisów z main w build.mjs). */
export const MEDIA_FILE = /^(?:wykresy\.json|[a-z0-9-]+\.(?:png|jpg|webp))$/;
export const LIMITS = { md: 64 * 1024, json: 1024 * 1024, image: 2 * 1024 * 1024, post: 8 * 1024 * 1024, perDay: 40 };
/** Data wpisu najwyżej 10 min po chwili buildu i najwyżej 24 h przed pierwszym commitem pliku. */
const FUTURE_MS = 10 * 60_000;
const BEFORE_COMMIT_MS = 24 * 3_600_000;
const MODES = { '100644': null, '100755': 'plik wykonywalny', '120000': 'dowiązanie symboliczne', '160000': 'podmoduł' };
const SHA_RE = /^[0-9a-f]{40}$/;

/** Dzień w czasie polskim (RRRR-MM-DD), jak localDate w posts.mjs (tu bez zależności). */
const warsawDay = (ms) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);

/** Typ obrazu po pierwszych bajtach (PNG, JPEG, WebP); inne treści, w tym SVG i HTML, to null. */
export function imageType(b) {
  if (!b || b.length < 3) return null;
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  const ascii = (from, to) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Pole `date` z frontmattera (bez parsera YAML: tylko klucz najwyższego poziomu, z cudzysłowem albo bez). */
function frontmatterDate(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text ?? '');
  const m = fm && /^date:[ \t]*["']?([^"'\s#]+)["']?[ \t]*(?:#.*)?$/m.exec(fm[1]);
  return m ? Date.parse(m[1]) : null;
}

/** Powód odrzucenia pliku: tryb z git (`ls-tree`) i rodzaj z `lstat`; null = zwykły plik. */
function fileProblem(e) {
  const mode = e.mode in MODES ? MODES[e.mode] : `nieznany tryb ${e.mode}`;
  if (mode) return mode;
  return e.kind === 'file' ? null : 'nie jest zwykłym plikiem';
}

/** Problemy jednego wpisu (pierwszy wystarcza, kolejność: pochodzenie, pliki, rozmiar, data). */
function postProblem({ id, day, md, media, own }, { mainIds, history, now }) {
  if (mainIds.has(id)) return 'identyfikator istnieje w main (pierwszeństwo main)';
  for (const e of own) {
    const p = fileProblem(e);
    if (p) return `${e.path}: ${p}`;
  }
  if (!md) return 'brak pliku wpisu .md';
  const p = fileProblem(md);
  if (p) return p;
  if (md.size > LIMITS.md) return `.md ponad ${LIMITS.md / 1024} KB`;
  let total = md.size;
  for (const e of media) {
    const name = e.path.slice(id.length + 1);
    const bad = fileProblem(e);
    if (bad) return `${name}: ${bad}`;
    if (!MEDIA_FILE.test(name)) return `${name}: plik spoza listy (wykresy.json, *.png, *.jpg, *.webp z nazwą [a-z0-9-])`;
    if (name === 'wykresy.json') {
      if (e.size > LIMITS.json) return `wykresy.json ponad ${LIMITS.json / 1024 / 1024} MB`;
    } else {
      const ext = name.slice(name.lastIndexOf('.') + 1);
      if (imageType(e.head) !== ext) return `${name}: treść nie jest obrazem ${ext}`;
      if (e.size > LIMITS.image) return `${name}: obraz ponad ${LIMITS.image / 1024 / 1024} MB`;
    }
    total += e.size;
  }
  if (total > LIMITS.post) return `wpis ponad ${LIMITS.post / 1024 / 1024} MB`;
  const date = frontmatterDate(md.text);
  if (date === null) return 'brak pola date we frontmatterze';
  if (!Number.isFinite(date)) return 'date: niepoprawna data';
  if (day > warsawDay(now + FUTURE_MS) || date > now + FUTURE_MS) return 'data w przyszłości (więcej niż 10 min po chwili buildu); wpis poczeka do następnego buildu';
  const first = history[md.path]?.firstMs;
  if (first != null && (day < warsawDay(first - BEFORE_COMMIT_MS) || date < first - BEFORE_COMMIT_MS)) return 'data wcześniejsza niż pierwszy commit pliku − 24 h';
  return null;
}

/**
 * Filtr treści (czysta funkcja). `entries`: pliki gałęzi { path, mode (git ls-tree), size, kind ('file' | 'symlink' | 'dir' |
 * 'missing' z lstat), head (pierwsze bajty obrazu), text (treść .md) }; `history`: ścieżka .md → { firstMs, lastMs, commits };
 * `mainIds`: identyfikatory wpisów z main; `now`: chwila buildu. Zwraca wpisy do skopiowania (pliki, historia) i pominięte
 * z powodem: { id, reason } dla wpisu, { path, reason } dla pliku poza wpisami.
 */
export function intake({ entries, history = {}, mainIds = new Set(), now }) {
  const posts = new Map();
  const skipped = [];
  for (const e of entries) {
    const m = POST_FILE.exec(e.path);
    if (m) posts.set(e.path.slice(0, -3), { id: e.path.slice(0, -3), day: m[1], md: e, media: [], own: [] });
  }
  for (const e of entries) {
    if (POST_FILE.test(e.path)) continue;
    const slash = e.path.indexOf('/');
    const post = posts.get(slash < 0 ? e.path : e.path.slice(0, slash));
    if (post && slash < 0) post.own.push(e);
    else if (post) post.media.push(e);
    else if (e.path.endsWith('.md')) skipped.push({ path: e.path, reason: 'nazwa pliku wpisu spoza wzorca RRRR-MM-DD-opis.md (małe litery, cyfry, myślniki, do 60 znaków)' });
    else skipped.push({ path: e.path, reason: 'plik poza układem wpisów (<id>.md i folder <id>/)' });
  }
  const ok = [];
  for (const post of posts.values()) {
    const reason = postProblem(post, { mainIds, history, now });
    if (reason) skipped.push({ id: post.id, reason });
    else ok.push({ ...post, ...(history[post.md.path] ?? { firstMs: null, lastMs: null, commits: 0 }) });
  }
  // Limit na dobę kalendarzową: pierwsze wg chwili pierwszego commita (późniejsze wpisy nie wypierają wcześniejszych)
  ok.sort((a, b) => (a.firstMs ?? 0) - (b.firstMs ?? 0) || (a.id < b.id ? -1 : 1));
  const perDay = new Map();
  const accepted = [];
  for (const p of ok) {
    const n = (perDay.get(p.day) ?? 0) + 1;
    perDay.set(p.day, n);
    if (n > LIMITS.perDay) skipped.push({ id: p.id, reason: `limit ${LIMITS.perDay} nowych wpisów na dobę kalendarzową (${p.day})` });
    else accepted.push({ id: p.id, files: [p.md.path, ...p.media.map((e) => e.path).sort()], firstMs: p.firstMs, lastMs: p.lastMs, commits: p.commits });
  }
  const key = (s) => s.id ?? s.path;
  return { posts: accepted.sort((a, b) => (a.id < b.id ? -1 : 1)), skipped: skipped.sort((a, b) => (key(a) < key(b) ? -1 : 1)) };
}

/** Stan blog/source.json opublikowanej strony: `known` = odpowiedź rozstrzyga (200 z poprawnym plikiem albo 404). */
export function publishedSource(status, text) {
  if (status === 404) return { known: true, sha: '' };
  if (status !== 200) return { known: false, sha: '' };
  try {
    const sha = JSON.parse(text)?.sha ?? '';
    return sha === '' || SHA_RE.test(sha) ? { known: true, sha } : { known: false, sha: '' };
  } catch {
    return { known: false, sha: '' };
  }
}

// ───────────────────────── Powłoka: git i pliki ─────────────────────────

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/** Czy `prev` jest commitem w historii HEAD klonu (inaczej historia gałęzi została przepisana). */
function inHistory(dir, prev) {
  try {
    git(dir, ['merge-base', '--is-ancestor', prev, 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

function headBytes(file, n = 16) {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(n);
    return buf.subarray(0, readSync(fd, buf, 0, n, 0));
  } finally {
    closeSync(fd);
  }
}

/** Pliki gałęzi (tryb i rozmiar z git, rodzaj z lstat) i historia plików .md z jednego `git log`. */
function readBranch(src) {
  const entries = git(src, ['ls-tree', '-r', '-z', '--long', 'HEAD'])
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [meta, p] = [line.slice(0, line.indexOf('\t')), line.slice(line.indexOf('\t') + 1)];
      const [mode, , , size] = meta.split(/\s+/);
      let kind = 'missing';
      try {
        const st = lstatSync(path.join(src, p));
        kind = st.isSymbolicLink() ? 'symlink' : st.isFile() ? 'file' : st.isDirectory() ? 'dir' : 'other';
      } catch {
        // brak pliku w kopii roboczej
      }
      const e = { path: p, mode, size: Number(size) || 0, kind };
      if (kind === 'file' && mode === '100644' && /\.(png|jpg|webp)$/.test(p)) e.head = headBytes(path.join(src, p));
      if (kind === 'file' && mode === '100644' && POST_FILE.test(p) && e.size <= LIMITS.md) e.text = readFileSync(path.join(src, p), 'utf8');
      return e;
    });
  const history = {};
  let at = 0;
  for (const line of git(src, ['log', '--format=%x00%ct', '--name-only', '--no-renames', 'HEAD']).split('\n')) {
    if (line.startsWith('\0')) at = Number(line.slice(1)) * 1000;
    else if (POST_FILE.test(line)) {
      const h = (history[line] ??= { firstMs: at, lastMs: at, commits: 0 });
      h.firstMs = Math.min(h.firstMs, at);
      h.lastMs = Math.max(h.lastMs, at);
      h.commits += 1;
    }
  }
  return { sha: git(src, ['rev-parse', 'HEAD']).trim(), entries, history };
}

/**
 * Filtr gałęzi `blog` (klon `src`) do `dest` (content/blog z main). Kopiuje tylko pliki wpisów, które przeszły filtr.
 * Zwraca raport dla generatora: { sha, repo, branch, rewritten, posts, skipped }. Bez `src` (gałęzi nie ma albo GitHub
 * nie odpowiada) raport ma poprzedni sha i nic nie jest kopiowane.
 */
export function filterBranch({ src, dest, now, prev = '', repo, branch }) {
  if (!src) return { sha: prev || null, repo, branch, rewritten: false, posts: [], skipped: [] };
  const { sha, entries, history } = readBranch(src);
  const mainIds = new Set(readdirSync(dest).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)));
  const r = intake({ entries, history, mainIds, now });
  for (const post of r.posts)
    for (const f of post.files) {
      // Jeszcze raz lstat tuż przed kopiowaniem: tylko zwykły plik, nigdy cel dowiązania
      if (!lstatSync(path.join(src, f)).isFile()) throw new Error(`${f}: nie jest zwykłym plikiem`);
      mkdirSync(path.dirname(path.join(dest, f)), { recursive: true });
      writeFileSync(path.join(dest, f), readFileSync(path.join(src, f)));
    }
  return { sha, repo, branch, rewritten: Boolean(prev) && !inHistory(src, prev), posts: r.posts, skipped: r.skipped };
}

/** Pliki dodane albo zmienione od opublikowanego `prev` (bez niego cała gałąź), jako ścieżki content/blog/… dla IndexNow. */
export function changedPosts(src, prev) {
  if (prev && !inHistory(src, prev)) return { rewritten: true, files: [] };
  const out = prev ? git(src, ['diff', '--name-only', '--no-renames', '--diff-filter=AM', prev, 'HEAD']) : git(src, ['ls-tree', '-r', '--name-only', 'HEAD']);
  const files = out
    .split('\n')
    .filter(Boolean)
    .sort()
    .map((f) => `content/blog/${f}`);
  return { rewritten: false, files };
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BLOG_REPO = 'https://github.com/rdemb/hyperquant-data';

async function main([cmd, ...argv]) {
  const arg = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i < 0 ? '' : (argv[i + 1] ?? '');
  };
  if (cmd === 'published') {
    const homepage = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).homepage.replace(/\/?$/, '/');
    let status = 0;
    let text = '';
    try {
      // Parametr omija pamięć podręczną CDN (inaczej przez kilka minut po wdrożeniu widać stary sha)
      const res = await fetch(`${homepage}blog/source.json?t=${Date.now()}`, { signal: AbortSignal.timeout(20_000), cache: 'no-store' });
      status = res.status;
      text = await res.text();
    } catch (e) {
      console.error(`blog/source.json: ${e.message}`);
    }
    const r = publishedSource(status, text);
    console.log(`published=${r.sha}\nknown=${r.known}`);
  } else if (cmd === 'filter') {
    const report = filterBranch({ src: arg('src') || null, dest: arg('dest'), now: Date.now(), prev: arg('prev'), repo: BLOG_REPO, branch: 'blog' });
    writeFileSync(arg('out'), JSON.stringify(report));
    console.error(`Gałąź blog: ${report.sha ?? 'brak'}, wpisów po filtrze ${report.posts.length}, pominiętych ${report.skipped.length}${report.rewritten ? ', historia przepisana' : ''}`);
    for (const s of report.skipped) console.error(`  pominięty ${s.id ?? s.path}: ${s.reason}`);
  } else if (cmd === 'changed') {
    const r = changedPosts(arg('src'), arg('prev'));
    if (r.rewritten) console.error('Historia gałęzi blog przepisana: bez zgłoszenia IndexNow');
    if (r.files.length) console.log(r.files.join('\n'));
  } else throw new Error('użycie: intake.mjs published | filter --src … --dest … --prev … --out … | changed --src … --prev …');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
