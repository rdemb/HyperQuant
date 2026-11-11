// Filtr treści gałęzi `blog` repo danych: wpisy z zewnątrz jako niezaufane dane (scripts/blog/intake.mjs).
import { execFileSync } from 'node:child_process';
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
const run = (entries, { mainIds = [], history = {} } = {}) => {
  const h = { ...history };
  for (const e of entries) if (e.path.endsWith('.md') && !h[e.path]) h[e.path] = { firstMs: NOW - HOUR, lastMs: NOW - HOUR, commits: 1 };
  return intake({ entries, history: h, mainIds: new Set(mainIds), now: NOW });
};
const reasonOf = (r, key) => r.skipped.find((s) => s.id === key || s.path === key)?.reason;

describe('intake: dobre wpisy przechodzą', () => {
  it('wpis z wykresy.json i obrazami PNG, JPEG, WebP: lista plików do skopiowania i historia', () => {
    const id = '2026-11-11-mapa-dnia';
    const r = run([md(id), file(`${id}/wykresy.json`), file(`${id}/a.png`, PNG), file(`${id}/b-1.jpg`, JPG), file(`${id}/c.webp`, WEBP)], {
      history: { [`${id}.md`]: { firstMs: NOW - 2 * HOUR, lastMs: NOW - HOUR, commits: 2 } },
    });
    expect(r.skipped).toEqual([]);
    expect(r.posts).toEqual([{ id, files: [`${id}.md`, `${id}/a.png`, `${id}/b-1.jpg`, `${id}/c.webp`, `${id}/wykresy.json`], firstMs: NOW - 2 * HOUR, lastMs: NOW - HOUR, commits: 2 }]);
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

  it('41. wpis doby kalendarzowej (kolejność pierwszego commita) jest pomijany; inny dzień liczony osobno', () => {
    const ids = Array.from({ length: 41 }, (_, i) => `2026-11-11-n${String(i).padStart(2, '0')}`);
    const history = Object.fromEntries(ids.map((id, i) => [`${id}.md`, { firstMs: NOW - HOUR + (i === 0 ? 1 : i === 40 ? 0 : i) * 1000, lastMs: NOW - HOUR, commits: 1 }]));
    const r = run([...ids.map((id) => md(id)), md('2026-11-10-wczoraj', '2026-11-10T20:00:00+01:00')], { history });
    expect(r.posts).toHaveLength(41);
    // n40 ma najwcześniejszy commit, więc jest w limicie; ostatni commit doby to n39
    expect(r.skipped).toEqual([{ id: '2026-11-11-n39', reason: 'limit 40 nowych wpisów na dobę kalendarzową (2026-11-11)' }]);
  });

  it('identyfikator istniejący w main (pierwszeństwo main)', () => {
    const id = '2026-10-26-mapa-dnia';
    const r = run([md(id, '2026-10-26T08:00:00+01:00'), file(`${id}/x.png`, PNG)], { mainIds: [id], history: { [`${id}.md`]: { firstMs: Date.parse('2026-10-26T07:00:00Z'), lastMs: 0, commits: 1 } } });
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

  it('data ponad 24 h przed pierwszym commitem pliku (wpis „z przeszłości”)', () => {
    const id = '2026-11-09-mapa';
    const r = run([md(id, '2026-11-09T10:00:00+01:00')], { history: { [`${id}.md`]: { firstMs: Date.parse('2026-11-10T09:01:00Z'), lastMs: 0, commits: 1 } } });
    expect(r.posts).toEqual([]);
    expect(reasonOf(r, id)).toMatch(/wcześniejsza niż pierwszy commit/);
  });
});

describe('intake: źródło opublikowane na stronie (blog/source.json)', () => {
  const SHA = 'a'.repeat(40);
  it('200 z sha, 200 bez sha (gałęzi jeszcze nie było), 404 przed pierwszym wdrożeniem', () => {
    expect(publishedSource(200, JSON.stringify({ sha: SHA, at: 'x', posts: 1, skipped: [] }))).toEqual({ known: true, sha: SHA });
    expect(publishedSource(200, JSON.stringify({ sha: null }))).toEqual({ known: true, sha: '' });
    expect(publishedSource(404, 'Not found')).toEqual({ known: true, sha: '' });
  });
  it('błąd sieci, 5xx albo zepsuty plik: stan nieznany', () => {
    expect(publishedSource(0, '')).toEqual({ known: false, sha: '' });
    expect(publishedSource(503, '')).toEqual({ known: false, sha: '' });
    expect(publishedSource(200, '<html>')).toEqual({ known: false, sha: '' });
    expect(publishedSource(200, JSON.stringify({ sha: 'zły; rm -rf' }))).toEqual({ known: false, sha: '' });
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
  it('3 dobre i 2 złe wpisy: 3 strony, source.json ze sha i 2 pominiętymi z powodami; wpis zmieniony po publikacji', async () => {
    const repo = gitRepo();
    const good = ['2026-11-11-mapa-dnia', '2026-11-11-otwarcie-londynu', '2026-11-11-podsumowanie'];
    repo.put(`${good[0]}.md`, postText(good[0], '2026-11-11T08:00:00+01:00'));
    repo.put(`${good[1]}.md`, postText(good[1], '2026-11-11T09:00:00+01:00') + '\n\n![Wykres](wykres.png)');
    repo.put(`${good[1]}/wykres.png`, Buffer.from(PNG));
    repo.put(`${good[2]}.md`, postText(good[2], '2026-11-11T10:00:00+01:00'));
    // zły wpis 1: plik SVG w folderze (filtr); zły wpis 2: wezwanie do transakcji (walidator wpisów)
    repo.put('2026-11-11-svg.md', postText('2026-11-11-svg', '2026-11-11T10:30:00+01:00'));
    repo.put('2026-11-11-svg/x.svg', '<svg onload="alert(1)"/>');
    repo.put('2026-11-11-wezwanie.md', postText('2026-11-11-wezwanie', '2026-11-11T11:00:00+01:00', { title: 'Kupujcie teraz' }));
    const first = repo.commit('wpisy', '2026-11-11T10:05:00Z');
    repo.put(`${good[0]}.md`, postText(good[0], '2026-11-11T08:00:00+01:00').replace('Kontekst', 'Kontekst po poprawce'));
    const sha = repo.commit('poprawka', '2026-11-11T11:30:00Z');

    const site = mkdtempSync(path.join(tmpdir(), 'hq-site-'));
    const dest = path.join(site, 'content', 'blog');
    mkdirSync(dest, { recursive: true });
    const report = filterBranch({ src: repo.dir, dest, now: NOW, prev: first, repo: 'https://github.com/x/data', branch: 'blog' });
    expect(report).toMatchObject({ sha, repo: 'https://github.com/x/data', branch: 'blog', rewritten: false });
    expect(report.posts.map((p) => p.id)).toEqual([...good, '2026-11-11-wezwanie'].sort());
    expect(report.posts.find((p) => p.id === good[0])).toMatchObject({ commits: 2, lastMs: Date.parse('2026-11-11T11:30:00Z'), firstMs: Date.parse('2026-11-11T10:05:00Z') });
    expect(readdirSync(dest).sort()).toEqual([`${good[0]}.md`, good[1], `${good[1]}.md`, `${good[2]}.md`, '2026-11-11-wezwanie.md']);
    expect(readdirSync(path.join(dest, good[1]))).toEqual(['wykres.png']);
    expect(report.skipped.map((s) => s.id)).toEqual(['2026-11-11-svg']);

    const out = mkdtempSync(path.join(tmpdir(), 'hq-dist-'));
    const n = await buildBlog({ contentDir: dest, outDir: out, site: { url: 'https://example.org/HQ/', repo: 'https://github.com/x/HQ' }, pages: false, now: NOW, intake: report });
    expect(n).toBe(3);
    const blog = path.join(out, 'blog');
    for (const id of good) expect(existsSync(path.join(blog, id, 'index.html')), id).toBe(true);
    expect(existsSync(path.join(blog, '2026-11-11-wezwanie'))).toBe(false);
    const source = JSON.parse(readFileSync(path.join(blog, 'source.json'), 'utf8'));
    expect(source).toMatchObject({ sha, at: new Date(NOW).toISOString(), posts: 3, rewritten: false });
    expect(source.skipped.map((s) => [s.id, s.reason])).toEqual([
      ['2026-11-11-svg', expect.stringMatching(/x\.svg/)],
      ['2026-11-11-wezwanie', expect.stringMatching(/wezwanie/)],
    ]);
    // historia wpisu z gałęzi blog; poprawka po publikacji widoczna pod tytułem
    const edited = readFileSync(path.join(blog, good[0], 'index.html'), 'utf8');
    expect(edited).toContain(`href="https://github.com/x/data/commits/blog/${good[0]}.md"`);
    expect(edited).toMatch(/<p class="edited">Zmieniony po publikacji: <time datetime="2026-11-11T11:30:00Z">środa, 11 listopada 2026, 12:30<\/time><\/p>/);
    const once = readFileSync(path.join(blog, good[2], 'index.html'), 'utf8');
    expect(once).not.toMatch(/class="edited"/);
    expect(once).toContain(`href="https://github.com/x/data/commits/blog/${good[2]}.md"`);
  }, 30_000);

  it('dowiązania (do /etc/passwd i ../../src) i plik wykonywalny z trybu w git; nic z nich nie trafia do content/blog', () => {
    const repo = gitRepo();
    repo.symlink('2026-11-11-passwd.md', '/etc/passwd');
    repo.put('2026-11-11-src.md', postText('2026-11-11-src', '2026-11-11T08:00:00+01:00'));
    repo.symlink('2026-11-11-src', '../../src');
    repo.put('2026-11-11-exe.md', postText('2026-11-11-exe', '2026-11-11T08:00:00+01:00'));
    repo.put('2026-11-11-exe/x.png', Buffer.from(PNG));
    repo.git(['update-index', '--chmod=+x', '2026-11-11-exe/x.png']);
    repo.commit('wpisy', '2026-11-11T10:05:00Z');
    const dest = mkdtempSync(path.join(tmpdir(), 'hq-dest-'));
    const report = filterBranch({ src: repo.dir, dest, now: NOW, prev: '', repo: 'https://github.com/x/data', branch: 'blog' });
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

  it('gałęzi nie ma: raport z poprzednim sha, nic nie kopiuje', () => {
    const dest = mkdtempSync(path.join(tmpdir(), 'hq-dest-'));
    const SHA = 'c'.repeat(40);
    expect(filterBranch({ src: null, dest, now: NOW, prev: SHA, repo: 'https://github.com/x/data', branch: 'blog' })).toEqual({ sha: SHA, repo: 'https://github.com/x/data', branch: 'blog', rewritten: false, posts: [], skipped: [] });
    expect(readdirSync(dest)).toEqual([]);
  });
});
