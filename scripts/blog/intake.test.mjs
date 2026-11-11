// Filtr treści gałęzi `blog` repo danych: wpisy z zewnątrz jako niezaufane dane (scripts/blog/intake.mjs).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIMITS, changedPosts, filterBranch, imageType, intake, publishedSource } from './intake.mjs';
import { buildBlog } from './build.mjs';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const HOUR = 3_600_000;
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const HTML = new TextEncoder().encode('<html><script>alert(1)</script>');

const md = (id, date = '2026-11-11T12:00:00+01:00') => ({ path: `${id}.md`, mode: '100644', size: 400, kind: 'file', text: `---\ntitle: "x"\ndate: "${date}"\n---\nTreść` });
const file = (p, head, size = 1000, mode = '100644', kind = 'file') => ({ path: p, mode, size, kind, head });
const run = (entries, { mainIds = [], registry = {}, lastBuild = null, reseed = false } = {}) => intake({ entries, registry, mainIds: new Set(mainIds), now: NOW, lastBuild, reseed });
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
/** Hash wpisu w rejestrze (format 2): sha256 z linii „<sha256 pliku>  <nazwa>” dla .md i mediów, media w kolejności nazw. */
const postHashOf = (id, md, media = {}) =>
  sha256([`${sha256(md)}  ${id}.md`, ...Object.keys(media).sort().map((name) => `${sha256(media[name])}  ${name}`)].join('\n'));
const entry = (seen, text = 'x', changed = null) => ({ hash: sha256(text), seen, changed });
const reasonOf = (r, key) => r.skipped.find((s) => s.id === key || s.path === key)?.reason;

describe('intake: dobre wpisy przechodzą', () => {
  it('wpis z wykresy.json i obrazami PNG, JPEG, WebP: lista plików do skopiowania', () => {
    const id = '2026-11-11-mapa-dnia';
    const r = run([md(id), file(`${id}/wykresy.json`), file(`${id}/a.png`, PNG), file(`${id}/b-1.jpg`, JPG), file(`${id}/c.webp`, WEBP)]);
    expect(r.skipped).toEqual([]);
    expect(r.posts).toEqual([{ id, files: [`${id}.md`, `${id}/a.png`, `${id}/b-1.jpg`, `${id}/c.webp`, `${id}/wykresy.json`] }]);
  });

  it('typ obrazu po pierwszych bajtach', () => {
    expect([imageType(PNG), imageType(JPG), imageType(WEBP), imageType(HTML), imageType(new Uint8Array())]).toEqual(['png', 'jpg', 'webp', null, null]);
  });
});

describe('intake: każdy odrzucony przypadek z nazwanym powodem', () => {
  it('dowiązanie symboliczne do /etc/passwd (zamiast pliku wpisu) i do ../../src (zamiast folderu)', () => {
    const a = '2026-11-11-passwd';
    const b = '2026-11-11-src';
    const r = run([{ ...md(a), mode: '120000', kind: 'symlink' }, md(b), file(b, undefined, 9, '120000', 'symlink')]);
    expect(r.posts).toEqual([]);
    expect(reasonOf(r, a)).toMatch(/dowiązanie symboliczne/);
    expect(reasonOf(r, b)).toMatch(/dowiązanie symboliczne/);
  });

  it('dowiązanie wykryte przez lstat, podmoduł i plik wykonywalny', () => {
    const r = run([
      { ...md('2026-11-11-a'), kind: 'symlink' },
      md('2026-11-11-b'),
      file('2026-11-11-b/x.png', PNG, 0, '160000', 'dir'),
      md('2026-11-11-c'),
      file('2026-11-11-c/x.png', PNG, 100, '100755'),
    ]);
    expect(r.posts).toEqual([]);
    expect(reasonOf(r, '2026-11-11-a')).toMatch(/nie jest zwykłym plikiem/);
    expect(reasonOf(r, '2026-11-11-b')).toMatch(/podmoduł/);
    expect(reasonOf(r, '2026-11-11-c')).toMatch(/plik wykonywalny/);
  });

  it.each(['x.svg', 'x.html', 'x.js', 'X.png', 'a b.png', 'sub/x.png'])('plik %s w folderze wpisu', (name) => {
    const id = '2026-11-11-mapa';
    const r = run([md(id), file(`${id}/${name}`, PNG)]);
    expect(r.posts).toEqual([]);
    expect(reasonOf(r, id)).toMatch(/spoza listy/);
    expect(reasonOf(r, id)).toContain(name);
  });

  it('PNG z treścią HTML; JPEG udający PNG', () => {
    const r = run([md('2026-11-11-a'), file('2026-11-11-a/x.png', HTML), md('2026-11-11-b'), file('2026-11-11-b/x.png', JPG)]);
    expect(r.posts).toEqual([]);
    expect(reasonOf(r, '2026-11-11-a')).toMatch(/x\.png: treść nie jest obrazem png/);
    expect(reasonOf(r, '2026-11-11-b')).toMatch(/x\.png: treść nie jest obrazem png/);
  });

  it.each(['2026-11-11-a..b.md', '2026-11-11-Mapa.md', '2026-11-11-mapa dnia.md', '../2026-11-11-mapa.md', 'mapa.md', `2026-11-11-${'a'.repeat(61)}.md`])('nazwa %s', (name) => {
    const r = run([{ ...md('x'), path: name }]);
    expect(r.posts).toEqual([]);
    expect(reasonOf(r, name)).toMatch(/nazwa/);
  });

  it('pliki poza układem wpisów (bez wpisu .md, inne katalogi)', () => {
    const r = run([file('2026-11-11-sierota/x.png', PNG), file('README.txt'), file('.github/workflows/x.yml')]);
    expect(r.posts).toEqual([]);
    expect(r.skipped.map((s) => s.path)).toEqual(['.github/workflows/x.yml', '2026-11-11-sierota/x.png', 'README.txt']);
    for (const s of r.skipped) expect(s.reason).toMatch(/poza układem wpisów/);
  });

  it('limity rozmiaru: .md 65 KB, wykresy.json ponad 1 MB, obraz ponad 2 MB, wpis ponad 8 MB', () => {
    const big = (id, ...files) => [md(id), ...files];
    const r = run([
      ...big('2026-11-11-a').map((e) => (e.path.endsWith('.md') ? { ...e, size: 65 * 1024 } : e)),
      ...big('2026-11-11-b', file('2026-11-11-b/wykresy.json', undefined, LIMITS.json + 1)),
      ...big('2026-11-11-c', file('2026-11-11-c/x.png', PNG, LIMITS.image + 1)),
      ...big('2026-11-11-d', ...[1, 2, 3, 4, 5].map((i) => file(`2026-11-11-d/x${i}.png`, PNG, LIMITS.image - 1))),
    ]);
    expect(LIMITS).toMatchObject({ md: 64 * 1024, json: 1024 * 1024, image: 2 * 1024 * 1024, post: 8 * 1024 * 1024, perDay: 40 });
    expect(r.posts).toEqual([]);
    expect(reasonOf(r, '2026-11-11-a')).toMatch(/\.md ponad 64 KB/);
    expect(reasonOf(r, '2026-11-11-b')).toMatch(/wykresy\.json ponad 1 MB/);
    expect(reasonOf(r, '2026-11-11-c')).toMatch(/x\.png: obraz ponad 2 MB/);
    expect(reasonOf(r, '2026-11-11-d')).toMatch(/wpis ponad 8 MB/);
  });

  it('41. wpis doby kalendarzowej (kolejność pola date) jest pomijany; inny dzień liczony osobno', () => {
    const ids = Array.from({ length: 41 }, (_, i) => `2026-11-11-n${String(i).padStart(2, '0')}`);
    // n40 ma najwcześniejszą datę, więc jest w limicie; ostatni wg daty to n39
    const date = (i) => (i === 40 ? '2026-11-11T10:59:00Z' : `2026-11-11T11:${String(i).padStart(2, '0')}:00Z`);
    const r = run([...ids.map((id, i) => md(id, date(i))), md('2026-11-10-wczoraj', '2026-11-10T20:00:00+01:00')]);
    expect(r.posts).toHaveLength(41);
    expect(r.skipped).toEqual([{ id: '2026-11-11-n39', reason: 'limit 40 nowych wpisów na dobę kalendarzową (2026-11-11)' }]);
  });

  it('wpisy z rejestru liczą się do limitu doby, ale nigdy nie wypadają; pomijany jest nowy', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `2026-11-11-r${String(i).padStart(2, '0')}`);
    const registry = Object.fromEntries(ids.map((id) => [id, entry('2026-11-11T06:00:00.000Z')]));
    const r = run([md('2026-11-11-nowy', '2026-11-11T09:00:00Z'), ...ids.map((id) => md(id, '2026-11-11T11:30:00Z'))], { registry });
    expect(r.posts.map((p) => p.id)).toEqual(ids);
    expect(r.skipped).toEqual([{ id: '2026-11-11-nowy', reason: 'limit 40 nowych wpisów na dobę kalendarzową (2026-11-11)' }]);
  });

  it('identyfikator istniejący w main (pierwszeństwo main)', () => {
    const id = '2026-10-26-mapa-dnia';
    const r = run([md(id, '2026-10-26T08:00:00+01:00'), file(`${id}/x.png`, PNG)], { mainIds: [id], registry: { [id]: entry('2026-10-26T07:05:00.000Z') } });
    expect(r.posts).toEqual([]);
    expect(reasonOf(r, id)).toMatch(/istnieje w main/);
  });

  it('data jutrzejsza w nazwie i w date; date ponad 10 min w przyszłości; brak date', () => {
    const r = run([
      md('2026-11-12-jutro', '2026-11-12T08:00:00+01:00'),
      md('2026-11-11-za-chwile', '2026-11-11T13:11:00+01:00'),
      md('2026-11-11-w-porzadku', '2026-11-11T13:09:00+01:00'),
      { ...md('2026-11-11-bez-daty'), text: '---\ntitle: x\n---\n' },
    ]);
    expect(r.posts.map((p) => p.id)).toEqual(['2026-11-11-w-porzadku']);
    expect(reasonOf(r, '2026-11-12-jutro')).toMatch(/data w przyszłości/);
    expect(reasonOf(r, '2026-11-11-za-chwile')).toMatch(/data w przyszłości/);
    expect(reasonOf(r, '2026-11-11-bez-daty')).toMatch(/brak pola date/);
  });

  it('nowy wpis (spoza rejestru) z date ponad 24 h przed buildem jest odrzucony; ten sam wpis z rejestru zostaje', () => {
    const id = '2026-11-09-mapa';
    const old = [md(id, '2026-11-10T11:59:00Z'), md('2026-11-10-tuz', '2026-11-10T12:01:00Z')];
    const r = run(old);
    expect(r.posts.map((p) => p.id)).toEqual(['2026-11-10-tuz']);
    expect(reasonOf(r, id)).toBe('data wcześniejsza niż chwila buildu − 24 h, a wpisu nie ma w rejestrze opublikowanych (nowy wpis „z przeszłości”)');
    expect(run(old, { registry: { [id]: entry('2026-11-09T09:05:00.000Z') } }).posts.map((p) => p.id)).toEqual(['2026-11-09-mapa', '2026-11-10-tuz']);
  });
});

describe('intake: okno daty nowego wpisu i odtworzenie rejestru', () => {
  const DAY = 24 * HOUR;
  it('przerwa wdrożeń 3 doby: dolna granica od at poprzedniego buildu − 24 h; wpis z drugiej doby przerwy przyjęty, sprzed at − 24 h odrzucony', () => {
    const entries = [md('2026-11-09-przerwa', '2026-11-09T12:00:00Z'), md('2026-11-07-za-stary', '2026-11-07T11:00:00Z')];
    const r = run(entries, { lastBuild: NOW - 3 * DAY });
    expect(r.posts.map((p) => p.id)).toEqual(['2026-11-09-przerwa']);
    expect(reasonOf(r, '2026-11-07-za-stary')).toMatch(/wcześniejsza niż chwila buildu − 24 h/);
    // bez at poprzedniego buildu (albo at późniejsze niż teraz) granica liczy się od teraz
    expect(run(entries).posts).toEqual([]);
    expect(run(entries, { lastBuild: NOW + DAY }).posts).toEqual([]);
  });

  it('odtworzenie rejestru: wpisy z dowolnej przeszłości przyjęte jednorazowo; przyszłość i limit doby nadal obowiązują', () => {
    const r = run([md('2026-11-01-stary', '2026-11-01T08:00:00+01:00'), md('2026-11-12-jutro', '2026-11-12T08:00:00+01:00')], { reseed: true });
    expect(r.posts.map((p) => p.id)).toEqual(['2026-11-01-stary']);
    expect(reasonOf(r, '2026-11-12-jutro')).toMatch(/data w przyszłości/);
    const flood = Array.from({ length: 41 }, (_, i) => md(`2026-11-01-n${String(i).padStart(2, '0')}`, `2026-11-01T08:${String(i).padStart(2, '0')}:00Z`));
    expect(run(flood, { reseed: true }).skipped).toEqual([{ id: '2026-11-01-n40', reason: 'limit 40 nowych wpisów na dobę kalendarzową (2026-11-01)' }]);
  });
});

describe('intake: źródło opublikowane na stronie (blog/source.json)', () => {
  const SHA = 'a'.repeat(40);
  const MAIN = 'b'.repeat(40);
  const UNKNOWN = { known: false, sha: '', main: '', at: '', hashFormat: 0, reseededAt: null, registry: {} };
  const AT = '2026-11-11T11:00:00.000Z';
  it('200: sha gałęzi, sha main i rejestr opublikowanych wpisów', () => {
    const registry = { '2026-11-11-a': entry('2026-11-11T07:00:00.000Z'), '2026-11-10-b': entry('2026-11-10T07:00:00.000Z', 'y', '2026-11-11T08:00:00.000Z') };
    expect(publishedSource(200, JSON.stringify({ sha: SHA, main: MAIN, at: AT, hashFormat: 2, reseededAt: AT, posts: registry, skipped: [] }))).toEqual({ known: true, sha: SHA, main: MAIN, at: AT, hashFormat: 2, reseededAt: AT, registry });
    expect(publishedSource(200, JSON.stringify({ sha: null, main: MAIN, at: AT, hashFormat: 2, posts: {} }))).toEqual({ known: true, sha: '', main: MAIN, at: AT, hashFormat: 2, reseededAt: null, registry: {} });
  });
  it('plik bez rejestru (starszy format): rejestr pusty, wpisy z main i tak wchodzą do niego przy buildzie; bez hashFormat = format 1 (sam .md)', () => {
    expect(publishedSource(200, JSON.stringify({ sha: null, at: AT, posts: 0, skipped: [] }))).toEqual({ known: true, sha: '', main: '', at: AT, hashFormat: 1, reseededAt: null, registry: {} });
    expect(publishedSource(200, JSON.stringify({ sha: null, at: 'wczoraj', posts: {} }))).toMatchObject({ known: true, at: '' });
  });
  it('nie da się odczytać: 404, błąd sieci, 5xx, zepsuty plik albo rejestr: stan nieznany', () => {
    expect(publishedSource(404, 'Not found')).toEqual(UNKNOWN);
    expect(publishedSource(0, '')).toEqual(UNKNOWN);
    expect(publishedSource(503, '')).toEqual(UNKNOWN);
    expect(publishedSource(200, '<html>')).toEqual(UNKNOWN);
    expect(publishedSource(200, JSON.stringify({ sha: 'zły; rm -rf' }))).toEqual(UNKNOWN);
    expect(publishedSource(200, JSON.stringify({ sha: SHA, main: 'x' }))).toEqual(UNKNOWN);
    expect(publishedSource(200, JSON.stringify({ sha: SHA, posts: { '2026-11-11-a': { hash: 'x', seen: 'wczoraj', changed: null } } }))).toEqual(UNKNOWN);
    expect(publishedSource(200, JSON.stringify({ sha: SHA, posts: { '../x': entry('2026-11-11T07:00:00.000Z') } }))).toEqual(UNKNOWN);
  });
});

// ───────────── Prawdziwe repozytorium git (powłoka: git ls-tree, git log, kopiowanie) ─────────────

const hasGit = (() => {
  try {
    execFileSync('git', ['--version']);
    return true;
  } catch {
    return false;
  }
})();

const BODY = `## Kontekst\n\n${'Cena stoi nad dołkiem piątku i pod VWAP tygodnia, a płynność w weekend jest cienka. '.repeat(12)}`;
const postText = (id, date, extra = {}) => {
  const data = { title: `Mapa ${id.slice(11)}`, description: 'BTC-PERP stoi na 80 777, niecałe 300 dolarów nad piątkowym dołkiem. Poziomy i prawdopodobieństwa do 13:00.', date, type: 'article', section: 'Mapa dnia', ...extra };
  return `---\n${Object.entries(data).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n${BODY}`;
};

function gitRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'hq-blog-branch-'));
  const cfg = path.join(dir, '..', `${path.basename(dir)}.gitconfig`);
  writeFileSync(cfg, '[user]\n\tname = Test\n\temail = test@example.com\n[core]\n\tautocrlf = false\n[init]\n\tdefaultBranch = blog\n');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (args, extraEnv = {}, input) => execFileSync('git', args, { cwd: dir, env: { ...env, ...extraEnv }, input, encoding: 'utf8' }).trim();
  git(['init', '-q']);
  const put = (p, content) => {
    mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    writeFileSync(path.join(dir, p), content);
    git(['add', '--', p]);
  };
  const commit = (msg, iso) => {
    git(['commit', '-q', '-m', msg], { GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso });
    return git(['rev-parse', 'HEAD']);
  };
  // Dowiązanie zapisane w indeksie wprost (tryb 120000), także na systemie bez dowiązań
  const symlink = (p, target) => git(['update-index', '--add', '--cacheinfo', `120000,${git(['hash-object', '-w', '--stdin'], {}, target)},${p}`]);
  return { dir, git, put, commit, symlink };
}

describe.skipIf(!hasGit)('intake: gałąź blog w prawdziwym repozytorium', () => {
  const REPO = { repo: 'https://github.com/x/data', branch: 'blog' };
  const SITE = { url: 'https://example.org/HQ/', repo: 'https://github.com/x/HQ' };
  const MAIN = 'e'.repeat(40);
  const published = (registry = {}, sha = '', extra = {}) => ({ known: true, sha, main: MAIN, at: '', hashFormat: 2, reseededAt: null, registry, ...extra });
  const reg = (id, md, seen, media = {}, changed = null) => ({ hash: postHashOf(id, md, media), seen, changed });
  const iso = (ms) => new Date(ms).toISOString();
  const tempDest = () => {
    const dest = path.join(mkdtempSync(path.join(tmpdir(), 'hq-site-')), 'content', 'blog');
    mkdirSync(dest, { recursive: true });
    return dest;
  };
  const build = async (dest, report, now = NOW) => {
    const out = mkdtempSync(path.join(tmpdir(), 'hq-dist-'));
    const n = await buildBlog({ contentDir: dest, outDir: out, site: SITE, pages: false, now, intake: report, main: MAIN });
    const blog = path.join(out, 'blog');
    return { n, blog, source: JSON.parse(readFileSync(path.join(blog, 'source.json'), 'utf8')), page: (id) => readFileSync(path.join(blog, id, 'index.html'), 'utf8') };
  };

  it('3 dobre i 2 złe wpisy: 3 strony, source.json z sha, main, rejestrem i 2 pominiętymi; inna treść wpisu z rejestru: changed = build i dopisek', async () => {
    const repo = gitRepo();
    const good = ['2026-11-11-mapa-dnia', '2026-11-11-otwarcie-londynu', '2026-11-11-podsumowanie'];
    const text = [postText(good[0], '2026-11-11T08:00:00+01:00'), postText(good[1], '2026-11-11T09:00:00+01:00') + '\n\n![Wykres](wykres.png)', postText(good[2], '2026-11-11T10:00:00+01:00')];
    good.forEach((id, i) => repo.put(`${id}.md`, text[i]));
    repo.put(`${good[1]}/wykres.png`, Buffer.from(PNG));
    // zły wpis 1: plik SVG w folderze (filtr); zły wpis 2: wezwanie do transakcji (walidator wpisów)
    repo.put('2026-11-11-svg.md', postText('2026-11-11-svg', '2026-11-11T10:30:00+01:00'));
    repo.put('2026-11-11-svg/x.svg', '<svg onload="alert(1)"/>');
    repo.put('2026-11-11-wezwanie.md', postText('2026-11-11-wezwanie', '2026-11-11T11:00:00+01:00', { title: 'Kupujcie teraz' }));
    const first = repo.commit('wpisy', '2026-11-11T10:05:00Z');
    const edited = text[0].replace('Kontekst', 'Kontekst po poprawce');
    repo.put(`${good[0]}.md`, edited);
    // data commita poprawki ustawiona przez wysyłającego (tu w przeszłości) nie ma znaczenia: liczy się chwila buildu
    const sha = repo.commit('poprawka', '2026-11-11T07:30:00Z');

    const dest = tempDest();
    const registry = { [good[0]]: reg(good[0], text[0], '2026-11-11T07:05:00.000Z'), [good[2]]: reg(good[2], text[2], '2026-11-11T09:05:00.000Z') };
    const report = filterBranch({ src: repo.dir, dest, now: NOW, published: published(registry, first), ...REPO });
    expect(report).toMatchObject({ sha, ...REPO, rewritten: false, registry });
    expect(report.posts.map((p) => p.id)).toEqual([...good, '2026-11-11-wezwanie'].sort());
    expect(readdirSync(dest).sort()).toEqual([`${good[0]}.md`, good[1], `${good[1]}.md`, `${good[2]}.md`, '2026-11-11-wezwanie.md']);
    expect(readdirSync(path.join(dest, good[1]))).toEqual(['wykres.png']);
    expect(report.skipped.map((s) => s.id)).toEqual(['2026-11-11-svg']);

    const { n, blog, source, page } = await build(dest, report);
    expect(n).toBe(3);
    for (const id of good) expect(existsSync(path.join(blog, id, 'index.html')), id).toBe(true);
    expect(existsSync(path.join(blog, '2026-11-11-wezwanie'))).toBe(false);
    expect(source).toMatchObject({ sha, main: MAIN, at: iso(NOW), hashFormat: 2, reseededAt: null, rewritten: false });
    expect(source.posts).toEqual({
      [good[0]]: reg(good[0], edited, '2026-11-11T07:05:00.000Z', {}, iso(NOW)),
      [good[1]]: reg(good[1], text[1], iso(NOW), { 'wykres.png': Buffer.from(PNG) }),
      [good[2]]: registry[good[2]],
    });
    expect(source.skipped.map((s) => [s.id, s.reason])).toEqual([
      ['2026-11-11-svg', expect.stringMatching(/x\.svg/)],
      ['2026-11-11-wezwanie', expect.stringMatching(/wezwanie/)],
    ]);
    // historia wpisu z gałęzi blog; poprawka po publikacji widoczna pod tytułem z chwilą buildu, który ją zobaczył
    expect(page(good[0])).toContain(`href="https://github.com/x/data/commits/blog/${good[0]}.md"`);
    expect(page(good[0])).toMatch(/<p class="edited">Zmieniony po publikacji: <time datetime="2026-11-11T12:00:00Z">środa, 11 listopada 2026, 13:00<\/time><\/p>/);
    expect(page(good[2])).not.toMatch(/class="edited"/);
    expect(page(good[2])).toContain(`href="https://github.com/x/data/commits/blog/${good[2]}.md"`);
  }, 30_000);

  it('wpis z date i datą commita sprzed tygodnia (spoza rejestru) jest odrzucony', () => {
    const repo = gitRepo();
    repo.put('2026-11-04-mapa-dnia.md', postText('2026-11-04-mapa-dnia', '2026-11-04T08:00:00+01:00'));
    repo.put('2026-11-11-mapa-dnia.md', postText('2026-11-11-mapa-dnia', '2026-11-11T08:00:00+01:00'));
    repo.commit('wpisy', '2026-11-04T07:10:00Z');
    const dest = tempDest();
    const report = filterBranch({ src: repo.dir, dest, now: NOW, published: published(), ...REPO });
    expect(report.posts.map((p) => p.id)).toEqual(['2026-11-11-mapa-dnia']);
    expect(report.skipped).toEqual([{ id: '2026-11-04-mapa-dnia', reason: expect.stringMatching(/wcześniejsza niż chwila buildu − 24 h/) }]);
    expect(readdirSync(dest)).toEqual(['2026-11-11-mapa-dnia.md']);
  });

  it('pierwszy przebieg po włączeniu (pusty rejestr, wpisy z main istnieją): main bez zmian i w rejestrze; stary wpis z gałęzi odrzucony; potem zmiana wpisu z main daje dopisek', async () => {
    const repo = gitRepo();
    repo.put('2026-11-11-nowy.md', postText('2026-11-11-nowy', '2026-11-11T10:00:00+01:00'));
    repo.put('2026-11-08-stary.md', postText('2026-11-08-stary', '2026-11-08T10:00:00+01:00'));
    repo.commit('wpisy', '2026-11-11T09:30:00Z');
    const dest = tempDest();
    const mainId = '2026-10-24-mapa-dnia';
    const mainText = postText(mainId, '2026-10-24T09:30:00+02:00');
    writeFileSync(path.join(dest, `${mainId}.md`), mainText);

    const report = filterBranch({ src: repo.dir, dest, now: NOW, published: published({}), ...REPO });
    expect(report.skipped).toEqual([{ id: '2026-11-08-stary', reason: expect.stringMatching(/wcześniejsza niż chwila buildu − 24 h/) }]);
    const first = await build(dest, report);
    expect(first.n).toBe(2);
    expect(first.source.posts).toEqual({ [mainId]: reg(mainId, mainText, iso(NOW)), '2026-11-11-nowy': expect.objectContaining({ seen: iso(NOW), changed: null }) });
    expect(first.page(mainId)).not.toMatch(/class="edited"/);
    expect(first.page(mainId)).toContain(`href="https://github.com/x/HQ/commits/main/content/blog/${mainId}.md"`);

    // następny build: rejestr z opublikowanego source.json; wpis z main poprawiony (PR) → widoczny dopisek
    const later = NOW + 3_600_000;
    // świeży checkout main (content/blog bez wpisów z gałęzi) z poprawionym wpisem
    const dest2 = tempDest();
    writeFileSync(path.join(dest2, `${mainId}.md`), mainText.replace('Kontekst', 'Kontekst po poprawce'));
    const report2 = filterBranch({ src: repo.dir, dest: dest2, now: later, published: publishedSource(200, JSON.stringify(first.source)), ...REPO });
    expect(report2.posts.map((p) => p.id)).toEqual(['2026-11-11-nowy']);
    const second = await build(dest2, report2, later);
    expect(second.source.posts[mainId]).toEqual(reg(mainId, mainText.replace('Kontekst', 'Kontekst po poprawce'), iso(NOW), {}, iso(later)));
    expect(second.source.posts['2026-11-11-nowy']).toEqual(first.source.posts['2026-11-11-nowy']);
    expect(second.page(mainId)).toMatch(/<p class="edited">Zmieniony po publikacji: <time datetime="2026-11-11T13:00:00Z">/);
  }, 30_000);

  it('odtworzenie rejestru (source.json nieczytelny): stary wpis z gałęzi na stronie, znacznik reseededAt; następny zwykły build go nie odrzuca', async () => {
    const repo = gitRepo();
    const old = '2026-11-01-mapa-dnia';
    const oldText = postText(old, '2026-11-01T08:00:00+01:00');
    repo.put(`${old}.md`, oldText);
    repo.put('2026-11-11-mapa-dnia.md', postText('2026-11-11-mapa-dnia', '2026-11-11T08:00:00+01:00'));
    repo.commit('wpisy', '2026-11-11T09:00:00Z');
    const unknown = publishedSource(0, '');

    const dest = tempDest();
    const report = filterBranch({ src: repo.dir, dest, now: NOW, published: unknown, reseed: true, ...REPO });
    expect(report).toMatchObject({ reseed: true, skipped: [] });
    expect(report.posts.map((p) => p.id)).toEqual([old, '2026-11-11-mapa-dnia']);
    const first = await build(dest, report);
    expect(first.n).toBe(2);
    expect(first.source).toMatchObject({ reseededAt: iso(NOW), hashFormat: 2 });
    expect(first.source.posts[old]).toEqual(reg(old, oldText, iso(NOW)));
    expect(first.page(old)).not.toMatch(/class="edited"/);

    // zwykły build (bez odtworzenia) z rejestrem z opublikowanego source.json
    const later = NOW + 2 * HOUR;
    const dest2 = tempDest();
    const report2 = filterBranch({ src: repo.dir, dest: dest2, now: later, published: publishedSource(200, JSON.stringify(first.source)), ...REPO });
    expect(report2).toMatchObject({ reseed: false, skipped: [] });
    const second = await build(dest2, report2, later);
    expect(second.n).toBe(2);
    expect(second.source.posts[old]).toEqual(first.source.posts[old]);
    expect(second.source.reseededAt).toBe(iso(NOW));
    // bez odtworzenia ten sam stary wpis spoza rejestru byłby odrzucony
    expect(filterBranch({ src: repo.dir, dest: tempDest(), now: later, published: published(), ...REPO }).skipped.map((s) => s.id)).toEqual([old]);
  }, 30_000);

  it('hash obejmuje media: podmiana obrazu albo wykresy.json bez zmiany tekstu daje changed i dopisek', async () => {
    const repo = gitRepo();
    const id = '2026-11-11-mapa-dnia';
    const text = `${postText(id, '2026-11-11T08:00:00+01:00')}\n\n![Wykres](wykres.png)`;
    repo.put(`${id}.md`, text);
    repo.put(`${id}/wykres.png`, Buffer.from(PNG));
    repo.put(`${id}/wykresy.json`, '{"v":1}');
    repo.commit('wpis', '2026-11-11T07:10:00Z');
    const step = async (now, prev) => {
      const dest = tempDest();
      return build(dest, filterBranch({ src: repo.dir, dest, now, published: prev ? publishedSource(200, JSON.stringify(prev)) : published(), ...REPO }), now);
    };
    const b1 = await step(NOW);
    expect(b1.source.posts[id]).toEqual(reg(id, text, iso(NOW), { 'wykres.png': Buffer.from(PNG), 'wykresy.json': '{"v":1}' }));
    const same = await step(NOW + HOUR, b1.source);
    expect(same.source.posts[id].changed).toBeNull();

    const png2 = Buffer.from([...PNG, 1, 2, 3]);
    repo.put(`${id}/wykres.png`, png2);
    repo.commit('inny obraz', '2026-11-11T07:20:00Z');
    const b2 = await step(NOW + 2 * HOUR, same.source);
    expect(b2.source.posts[id]).toEqual(reg(id, text, iso(NOW), { 'wykres.png': png2, 'wykresy.json': '{"v":1}' }, iso(NOW + 2 * HOUR)));
    expect(b2.page(id)).toMatch(/<p class="edited">Zmieniony po publikacji: <time datetime="2026-11-11T14:00:00Z">/);

    repo.put(`${id}/wykresy.json`, '{"v":1,"session":null}');
    repo.commit('inne wykresy', '2026-11-11T07:30:00Z');
    const b3 = await step(NOW + 3 * HOUR, b2.source);
    expect(b3.source.posts[id].changed).toBe(iso(NOW + 3 * HOUR));
    expect(b3.page(id)).toMatch(/<p class="edited">Zmieniony po publikacji: <time datetime="2026-11-11T15:00:00Z">/);
  }, 30_000);

  it('rejestr w starym formacie hasha (sam .md, bez hashFormat): przejście na format 2 bez fałszywego „Zmieniony po publikacji”', async () => {
    const repo = gitRepo();
    const id = '2026-11-11-mapa-dnia';
    const text = `${postText(id, '2026-11-11T08:00:00+01:00')}\n\n![Wykres](wykres.png)`;
    repo.put(`${id}.md`, text);
    repo.put(`${id}/wykres.png`, Buffer.from(PNG));
    repo.commit('wpis', '2026-11-11T07:10:00Z');
    const dest = tempDest();
    const mainId = '2026-10-24-mapa-dnia';
    const mainText = postText(mainId, '2026-10-24T09:30:00+02:00');
    writeFileSync(path.join(dest, `${mainId}.md`), mainText);
    const v1 = { sha: null, main: MAIN, at: iso(NOW - HOUR), posts: { [id]: { hash: sha256(text), seen: iso(NOW - HOUR), changed: null }, [mainId]: { hash: sha256(mainText), seen: iso(NOW - HOUR), changed: null } }, rewritten: false, skipped: [] };
    const { source, page } = await build(dest, filterBranch({ src: repo.dir, dest, now: NOW, published: publishedSource(200, JSON.stringify(v1)), ...REPO }));
    expect(source.hashFormat).toBe(2);
    expect(source.posts).toEqual({ [id]: reg(id, text, iso(NOW - HOUR), { 'wykres.png': Buffer.from(PNG) }), [mainId]: reg(mainId, mainText, iso(NOW - HOUR)) });
    expect(page(id)).not.toMatch(/class="edited"/);
    expect(page(mainId)).not.toMatch(/class="edited"/);
  }, 30_000);

  it('przerwa wdrożeń: okno nowego wpisu liczone od at opublikowanego source.json', () => {
    const repo = gitRepo();
    repo.put('2026-11-09-przerwa.md', postText('2026-11-09-przerwa', '2026-11-09T12:00:00+01:00'));
    repo.commit('wpis', '2026-11-09T11:10:00Z');
    expect(filterBranch({ src: repo.dir, dest: tempDest(), now: NOW, published: published({}, '', { at: iso(NOW - 72 * HOUR) }), ...REPO }).posts.map((p) => p.id)).toEqual(['2026-11-09-przerwa']);
    expect(filterBranch({ src: repo.dir, dest: tempDest(), now: NOW, published: published(), ...REPO }).posts).toEqual([]);
  });

  it('dowiązania (do /etc/passwd i ../../src) i plik wykonywalny z trybu w git; nic z nich nie trafia do content/blog', () => {
    const repo = gitRepo();
    repo.symlink('2026-11-11-passwd.md', '/etc/passwd');
    repo.put('2026-11-11-src.md', postText('2026-11-11-src', '2026-11-11T08:00:00+01:00'));
    repo.symlink('2026-11-11-src', '../../src');
    repo.put('2026-11-11-exe.md', postText('2026-11-11-exe', '2026-11-11T08:00:00+01:00'));
    repo.put('2026-11-11-exe/x.png', Buffer.from(PNG));
    repo.git(['update-index', '--chmod=+x', '2026-11-11-exe/x.png']);
    repo.commit('wpisy', '2026-11-11T10:05:00Z');
    const dest = tempDest();
    const report = filterBranch({ src: repo.dir, dest, now: NOW, published: published(), ...REPO });
    expect(report.posts).toEqual([]);
    expect(report.skipped).toEqual([
      { id: '2026-11-11-exe', reason: expect.stringMatching(/x\.png: plik wykonywalny/) },
      { id: '2026-11-11-passwd', reason: expect.stringMatching(/dowiązanie symboliczne/) },
      { id: '2026-11-11-src', reason: expect.stringMatching(/dowiązanie symboliczne/) },
    ]);
    expect(readdirSync(dest)).toEqual([]);
  });

  it('IndexNow: nowe i zmienione wpisy od opublikowanego sha; bez sha cała gałąź; nieznany sha (historia przepisana) nic', () => {
    const repo = gitRepo();
    repo.put('2026-11-10-a.md', 'a');
    repo.put('2026-11-10-a/wykresy.json', '{}');
    const a = repo.commit('a', '2026-11-10T10:00:00Z');
    repo.put('2026-11-11-b.md', 'b');
    repo.put('2026-11-10-a/wykresy.json', '{"v":1}');
    repo.commit('b', '2026-11-11T10:00:00Z');
    expect(changedPosts(repo.dir, a)).toEqual({ rewritten: false, files: ['content/blog/2026-11-10-a/wykresy.json', 'content/blog/2026-11-11-b.md'] });
    expect(changedPosts(repo.dir, '')).toEqual({ rewritten: false, files: ['content/blog/2026-11-10-a.md', 'content/blog/2026-11-10-a/wykresy.json', 'content/blog/2026-11-11-b.md'] });
    expect(changedPosts(repo.dir, 'b'.repeat(40))).toEqual({ rewritten: true, files: [] });
  });

  it('gałęzi nie ma: raport z poprzednim sha i rejestrem, nic nie kopiuje', () => {
    const dest = tempDest();
    const SHA = 'c'.repeat(40);
    const registry = { '2026-11-11-a': entry('2026-11-11T07:00:00.000Z') };
    expect(filterBranch({ src: null, dest, now: NOW, published: published(registry, SHA), ...REPO })).toEqual({ sha: SHA, ...REPO, rewritten: false, reseed: false, hashFormat: 2, reseededAt: null, registry, posts: [], skipped: [] });
    expect(readdirSync(dest)).toEqual([]);
  });
});
