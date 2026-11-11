// Wydawca wpisów (scripts/blog/publisher.mjs): kolejka na serwerze → filtr i walidator → commit i push na gałąź blog repo danych.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { QUEUE, cleanReason, readPackage, runPublisher, sshCommand } from './publisher.mjs';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const BODY = `## Kontekst\n\n${'Cena stoi nad dołkiem piątku i pod VWAP tygodnia, a płynność w weekend jest cienka. '.repeat(12)}`;
const postText = (id, date, extra = {}) => {
  const data = { title: `Mapa ${id.slice(11)}`, description: 'BTC-PERP stoi na 80 777, niecałe 300 dolarów nad piątkowym dołkiem. Poziomy i prawdopodobieństwa do 13:00.', date, type: 'article', section: 'Mapa dnia', ...extra };
  return `---\n${Object.entries(data).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n${BODY}`;
};
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

const canSymlink = (() => {
  const d = mkdtempSync(path.join(tmpdir(), 'hq-sym-'));
  try {
    symlinkSync('x', path.join(d, 'l'));
    return true;
  } catch {
    return false;
  }
})();

const gitEnv = (dir) => ({ ...process.env, GIT_CONFIG_GLOBAL: path.join(dir, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' });

/** Serwer w miniaturze: repo danych (bare), katalog kolejki i wyników, katalog stanu wydawcy. */
function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'hq-publisher-'));
  writeFileSync(path.join(root, 'gitconfig'), '[user]\n\tname = Inny\n\temail = inny@example.com\n[core]\n\tautocrlf = false\n[init]\n\tdefaultBranch = main\n');
  const remote = path.join(root, 'data.git');
  execFileSync('git', ['init', '-q', '--bare', remote], { env: gitEnv(root) });
  const base = path.join(root, 'blog');
  for (const d of Object.values(QUEUE)) mkdirSync(path.join(base, d), { recursive: true });
  const state = path.join(root, 'state');
  mkdirSync(state);
  const remoteGit = (...args) => execFileSync('git', ['--git-dir', remote, ...args], { env: gitEnv(root), encoding: 'utf8' }).trim();
  /** Paczka autora: katalog tymczasowy, pliki, potem rename na <id> (jak w kontrakcie). */
  const pkg = (id, files, { finish = true } = {}) => {
    const tmp = path.join(base, QUEUE.queue, `${id}.tmp-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tmp, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(tmp, name)), { recursive: true });
      writeFileSync(path.join(tmp, name), content);
    }
    if (finish) renameSync(tmp, path.join(base, QUEUE.queue, id));
    return tmp;
  };
  const result = (kind, id) => {
    const f = path.join(base, kind, `${id}.json`);
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
  };
  const run = (opts = {}) => runPublisher({ base, state, remote, now: NOW, env: gitEnv(root), ...opts });
  const head = () => {
    try {
      return remoteGit('rev-parse', 'refs/heads/blog');
    } catch {
      return null;
    }
  };
  const status = () => JSON.parse(readFileSync(path.join(base, QUEUE.status, 'status.json'), 'utf8'));
  /** Commit innego wysyłającego na gałęzi blog (wyścig): osobny klon, commit, push. */
  const foreignPush = (name) => {
    const dir = mkdtempSync(path.join(root, 'obcy-'));
    const g = (...a) => execFileSync('git', ['-C', dir, ...a], { env: gitEnv(root), encoding: 'utf8' });
    g('init', '-q');
    g('fetch', '-q', remote, 'blog');
    g('checkout', '-q', '-B', 'blog', 'FETCH_HEAD');
    writeFileSync(path.join(dir, name), 'x');
    g('add', name);
    g('commit', '-q', '-m', `obcy ${name}`);
    g('push', '-q', remote, 'HEAD:refs/heads/blog');
  };
  return { root, base, state, remote, remoteGit, pkg, result, run, head, status, foreignPush };
}

const ID = '2026-11-11-mapa-dnia';
const GOOD = postText(ID, '2026-11-11T08:00:00+01:00');

// git na Windows jest wolny: kilka klonów i pushy w jednym teście
describe('wydawca: kontrakt kolejki', { timeout: 30_000 }, () => {
  it('pusta kolejka: bez dostępu do repo danych, status ok', () => {
    const s = setup();
    expect(s.run({ remote: path.join(s.root, 'nie-istnieje.git') })).toMatchObject({ published: 0, rejected: 0, pushError: null });
    expect(s.status()).toMatchObject({ v: 1, ok: true, alarm: null, at: new Date(NOW).toISOString() });
  });

  it('niepełna paczka (katalog <id>.tmp-…) jest pomijana i zostaje w kolejce', () => {
    const s = setup();
    const tmp = s.pkg(ID, { [`${ID}.md`]: GOOD }, { finish: false });
    expect(s.run()).toMatchObject({ published: 0, rejected: 0 });
    expect(existsSync(tmp)).toBe(true);
    expect(s.head()).toBeNull();
    expect(readdirSync(path.join(s.base, QUEUE.done))).toEqual([]);
  });

  it('dobry wpis z mediami: gałąź blog tworzona jako sieroca, commit z neutralnym autorem, wynik w zrobione/, paczka usunięta', () => {
    const s = setup();
    s.pkg(ID, { [`${ID}.md`]: `${GOOD}\n\n![Wykres](wykres.png)`, [`${ID}/wykres.png`]: PNG, [`${ID}/wykresy.json`]: '{"v":1}' });
    expect(s.run()).toMatchObject({ published: 1, rejected: 0, pushError: null });
    const head = s.head();
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    expect(s.remoteGit('rev-list', '--count', 'blog')).toBe('1');
    expect(s.remoteGit('ls-tree', '-r', '--name-only', 'blog').split('\n')).toEqual([`${ID}.md`, `${ID}/wykres.png`, `${ID}/wykresy.json`]);
    expect(s.remoteGit('log', '-1', '--format=%an <%ae>|%cn <%ce>|%s', 'blog')).toBe(`HyperQuant blog <hyperquant-blog@users.noreply.github.com>|HyperQuant blog <hyperquant-blog@users.noreply.github.com>|blog: ${ID}`);
    expect(s.result(QUEUE.done, ID)).toEqual({ v: 1, id: ID, status: 'published', md: sha256(`${GOOD}\n\n![Wykres](wykres.png)`), commit: head, committed: true, at: new Date(NOW).toISOString() });
    expect(readdirSync(path.join(s.base, QUEUE.queue))).toEqual([]);
    expect(s.status()).toMatchObject({ ok: true, alarm: null, published: 1 });
    // prawa niezależnie od UMask usługi: wynik dla grupy kolejki, status dla każdego (strażnik)
    if (process.platform !== 'win32') {
      expect(statSync(path.join(s.base, QUEUE.done, `${ID}.json`)).mode & 0o777).toBe(0o640);
      expect(statSync(path.join(s.base, QUEUE.status, 'status.json')).mode & 0o777).toBe(0o644);
    }
  });

  it('zły wpis: odrzucone/<id>.json z powodem (walidator: wezwanie; filtr: SVG, nazwa, stara data), alarm w statusie, paczka usunięta', () => {
    const s = setup();
    s.pkg('2026-11-11-wezwanie', { '2026-11-11-wezwanie.md': postText('2026-11-11-wezwanie', '2026-11-11T08:00:00+01:00', { title: 'Kupujcie teraz' }) });
    s.pkg('2026-11-11-svg', { '2026-11-11-svg.md': postText('2026-11-11-svg', '2026-11-11T08:00:00+01:00'), '2026-11-11-svg/x.svg': '<svg onload="alert(1)"/>' });
    s.pkg('2026-11-11-inny', { [`${ID}.md`]: GOOD });
    s.pkg('2026-11-01-stary', { '2026-11-01-stary.md': postText('2026-11-01-stary', '2026-11-01T08:00:00+01:00') });
    expect(s.run()).toMatchObject({ published: 0, rejected: 4 });
    expect(s.head()).toBeNull();
    // md = sha256 wysłanego <id>.md (autor rozpoznaje wynik swojej paczki); bez pliku <id>.md: null
    expect(s.result(QUEUE.rejected, '2026-11-11-wezwanie').md).toBe(sha256(postText('2026-11-11-wezwanie', '2026-11-11T08:00:00+01:00', { title: 'Kupujcie teraz' })));
    expect(s.result(QUEUE.rejected, '2026-11-11-inny').md).toBeNull();
    expect(s.result(QUEUE.rejected, '2026-11-11-wezwanie')).toMatchObject({ v: 1, id: '2026-11-11-wezwanie', status: 'rejected', reason: expect.stringMatching(/wezwanie/), at: new Date(NOW).toISOString() });
    expect(s.result(QUEUE.rejected, '2026-11-11-svg').reason).toMatch(/x\.svg: plik spoza listy/);
    expect(s.result(QUEUE.rejected, '2026-11-11-inny').reason).toMatch(/paczka 2026-11-11-inny bez pliku 2026-11-11-inny\.md/);
    expect(s.result(QUEUE.rejected, '2026-11-01-stary').reason).toMatch(/wcześniejsza niż chwila buildu − 24 h/);
    expect(readdirSync(path.join(s.base, QUEUE.queue))).toEqual([]);
    expect(s.status()).toMatchObject({ ok: false, alarm: 'odrzucone', rejected: 4, lastRejected: expect.arrayContaining([expect.objectContaining({ id: '2026-11-11-svg' })]) });
  });

  it.skipIf(!canSymlink)('dowiązania: plik wpisu jako dowiązanie i cała paczka jako dowiązanie są odrzucane, cel nie jest czytany', () => {
    const s = setup();
    const tmp = s.pkg(ID, {}, { finish: false });
    writeFileSync(path.join(s.root, 'sekret.md'), GOOD);
    symlinkSync(path.join(s.root, 'sekret.md'), path.join(tmp, `${ID}.md`));
    renameSync(tmp, path.join(s.base, QUEUE.queue, ID));
    mkdirSync(path.join(s.root, 'cel'));
    symlinkSync(path.join(s.root, 'cel'), path.join(s.base, QUEUE.queue, '2026-11-11-link'), 'dir');
    expect(s.run()).toMatchObject({ published: 0, rejected: 2 });
    expect(s.result(QUEUE.rejected, ID).reason).toMatch(/dowiązanie symboliczne/);
    expect(s.result(QUEUE.rejected, '2026-11-11-link').reason).toMatch(/paczka nie jest katalogiem/);
    expect(existsSync(path.join(s.root, 'sekret.md'))).toBe(true);
    expect(existsSync(path.join(s.root, 'cel'))).toBe(true);
    expect(readdirSync(path.join(s.base, QUEUE.queue))).toEqual([]);
  });

  it('idempotencja: ta sama treść drugi raz → zrobione bez nowego commita; inna treść → nowy commit i usunięcie starych mediów', () => {
    const s = setup();
    s.pkg(ID, { [`${ID}.md`]: GOOD, [`${ID}/wykresy.json`]: '{"v":1}' });
    s.run();
    const first = s.head();
    s.pkg(ID, { [`${ID}.md`]: GOOD, [`${ID}/wykresy.json`]: '{"v":1}' });
    expect(s.run({ now: NOW + 60_000 })).toMatchObject({ published: 1, rejected: 0 });
    expect(s.head()).toBe(first);
    expect(s.result(QUEUE.done, ID)).toMatchObject({ commit: first, committed: false, at: new Date(NOW + 60_000).toISOString() });
    // poprawka (wpis młodszy niż doba, to samo date): tekst zmieniony, wykresy.json usunięte z paczki → zniknie z gałęzi
    const edited = GOOD.replace('Kontekst', 'Kontekst po poprawce');
    s.pkg(ID, { [`${ID}.md`]: edited });
    expect(s.run({ now: NOW + 3_600_000 })).toMatchObject({ published: 1 });
    expect(s.head()).not.toBe(first);
    expect(s.remoteGit('log', '-1', '--format=%s', 'blog')).toBe(`blog: zmiana ${ID}`);
    expect(s.remoteGit('ls-tree', '-r', '--name-only', 'blog')).toBe(`${ID}.md`);
    expect(s.result(QUEUE.done, ID)).toMatchObject({ md: sha256(edited), commit: s.head(), committed: true });
  });

  it('wynik odrzucenia znika po późniejszym przyjęciu tego samego wpisu (autor czyta jeden aktualny wynik)', () => {
    const s = setup();
    s.pkg(ID, { [`${ID}.md`]: postText(ID, '2026-11-11T08:00:00+01:00', { title: 'Kupujcie teraz' }) });
    s.run();
    expect(s.result(QUEUE.rejected, ID)).not.toBeNull();
    s.pkg(ID, { [`${ID}.md`]: GOOD });
    s.run();
    expect(s.result(QUEUE.rejected, ID)).toBeNull();
    expect(s.result(QUEUE.done, ID)).toMatchObject({ status: 'published' });
  });

  it('wyścig pusha: obcy commit na gałęzi blog tuż przed wysłaniem → rebase i push w drugiej próbie; sha w wyniku po rebase', () => {
    const s = setup();
    s.pkg('2026-11-11-pierwszy', { '2026-11-11-pierwszy.md': postText('2026-11-11-pierwszy', '2026-11-11T07:00:00+01:00') });
    s.run();
    s.pkg(ID, { [`${ID}.md`]: GOOD });
    let calls = 0;
    const r = s.run({ hooks: { beforePush: () => (calls++ === 0 ? s.foreignPush('obcy.txt') : undefined) } });
    expect(r).toMatchObject({ published: 1, pushError: null, attempts: 2 });
    expect(s.remoteGit('log', '--format=%s', 'blog').split('\n')).toEqual([`blog: ${ID}`, 'obcy obcy.txt', 'blog: 2026-11-11-pierwszy']);
    expect(s.result(QUEUE.done, ID).commit).toBe(s.head());
  });

  it('push nieudany 3 razy: paczka zostaje w kolejce bez wyniku, alarm w statusie; następny przebieg publikuje', () => {
    const s = setup();
    s.pkg('2026-11-11-pierwszy', { '2026-11-11-pierwszy.md': postText('2026-11-11-pierwszy', '2026-11-11T07:00:00+01:00') });
    s.run();
    s.pkg(ID, { [`${ID}.md`]: GOOD });
    let n = 0;
    const r = s.run({ hooks: { beforePush: () => s.foreignPush(`obcy-${n++}.txt`) } });
    expect(r).toMatchObject({ published: 0, attempts: 3, pushError: expect.any(String) });
    expect(existsSync(path.join(s.base, QUEUE.queue, ID))).toBe(true);
    expect(s.result(QUEUE.done, ID)).toBeNull();
    expect(s.status()).toMatchObject({ ok: false, alarm: 'push', pushError: expect.any(String) });
    expect(s.run({ now: NOW + 60_000 })).toMatchObject({ published: 1, pushError: null });
    expect(s.remoteGit('ls-tree', '-r', '--name-only', 'blog').split('\n')).toContain(`${ID}.md`);
    expect(s.status()).toMatchObject({ ok: true, alarm: null });
  });

  it('paczka przejmowana do katalogu roboczego wydawcy; pozostałość przerwanego przebiegu wraca do kolejki i jest publikowana', () => {
    const s = setup();
    const tmp = s.pkg(ID, { [`${ID}.md`]: GOOD }, { finish: false });
    renameSync(tmp, path.join(s.base, QUEUE.work, `${ID}.w`));
    expect(s.run()).toMatchObject({ published: 1 });
    expect(readdirSync(path.join(s.base, QUEUE.work))).toEqual([]);
    expect(readdirSync(path.join(s.base, QUEUE.queue))).toEqual([]);
    expect(s.result(QUEUE.done, ID)).toMatchObject({ commit: s.head() });
  });

  it('identyfikator istniejący we wpisach main jest odrzucany (strona i tak by go pominęła)', () => {
    const s = setup();
    const main = path.join(s.root, 'main-content');
    mkdirSync(main);
    writeFileSync(path.join(main, `${ID}.md`), GOOD);
    s.pkg(ID, { [`${ID}.md`]: GOOD });
    expect(s.run({ mainContent: main })).toMatchObject({ rejected: 1 });
    expect(s.result(QUEUE.rejected, ID).reason).toMatch(/istnieje w main/);
  });
});

describe('wydawca: poprawki, kwarantanna, powody, połączenie z repo danych', { timeout: 30_000 }, () => {
  const HOUR = 3_600_000;
  const FRESH = '2026-11-11-swiezy';
  const fresh = postText(FRESH, '2026-11-11T13:00:00+01:00'); // date = NOW
  const publishFresh = (s) => {
    s.pkg(FRESH, { [`${FRESH}.md`]: fresh });
    expect(s.run()).toMatchObject({ published: 1 });
    return s.head();
  };

  it('poprawka wpisu z gałęzi 2 h po jego date (to samo date) przechodzi', () => {
    const s = setup();
    publishFresh(s);
    s.pkg(FRESH, { [`${FRESH}.md`]: fresh.replace('Kontekst', 'Kontekst po poprawce') });
    expect(s.run({ now: NOW + 2 * HOUR })).toMatchObject({ published: 1, rejected: 0 });
    expect(s.remoteGit('log', '-1', '--format=%s', 'blog')).toBe(`blog: zmiana ${FRESH}`);
  });

  it('poprawka 30 h po date wpisu: odrzucona (starszy wpis zmienia tylko właściciel); ta sama treść nadal idempotentnie przyjęta', () => {
    const s = setup();
    const head = publishFresh(s);
    s.pkg(FRESH, { [`${FRESH}.md`]: fresh.replace('Kontekst', 'Kontekst po poprawce') });
    expect(s.run({ now: NOW + 30 * HOUR })).toMatchObject({ published: 0, rejected: 1 });
    expect(s.result(QUEUE.rejected, FRESH).reason).toBe('wpis starszy niż 24 h zmienia tylko właściciel');
    expect(s.head()).toBe(head);
    s.pkg(FRESH, { [`${FRESH}.md`]: fresh });
    expect(s.run({ now: NOW + 31 * HOUR })).toMatchObject({ published: 1 });
    expect(s.result(QUEUE.done, FRESH)).toMatchObject({ committed: false, commit: head });
  });

  it('poprawka ze zmienionym date: odrzucona', () => {
    const s = setup();
    publishFresh(s);
    s.pkg(FRESH, { [`${FRESH}.md`]: postText(FRESH, '2026-11-11T13:30:00+01:00') });
    expect(s.run({ now: NOW + 2 * HOUR })).toMatchObject({ rejected: 1 });
    expect(s.result(QUEUE.rejected, FRESH).reason).toMatch(/zmiana pola date/);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'paczka, której nie da się usunąć (podkatalog chmod 500), idzie do kwarantanny; dobra paczka z tego samego przebiegu jest opublikowana',
    () => {
      const s = setup();
      const BAD = '2026-11-11-zablokowany';
      const tmp = s.pkg(BAD, { [`${BAD}.md`]: postText(BAD, '2026-11-11T08:00:00+01:00', { title: 'Kupujcie teraz' }), [`${BAD}/wykresy.json`]: '{"v":1}' }, { finish: false });
      chmodSync(path.join(tmp, BAD), 0o500);
      renameSync(tmp, path.join(s.base, QUEUE.queue, BAD));
      s.pkg(ID, { [`${ID}.md`]: GOOD });
      expect(s.run()).toMatchObject({ published: 1, rejected: 1, quarantined: 1, pushError: null });
      expect(s.result(QUEUE.done, ID)).toMatchObject({ status: 'published' });
      expect(s.result(QUEUE.rejected, BAD)).toMatchObject({ status: 'rejected', reason: expect.stringMatching(/wezwanie/) });
      const q = readdirSync(path.join(s.base, QUEUE.rejected, '_kwarantanna'));
      expect(q).toEqual([expect.stringMatching(new RegExp(`^${BAD}-`))]);
      expect(readdirSync(path.join(s.base, QUEUE.queue))).toEqual([]);
      expect(readdirSync(path.join(s.base, QUEUE.work))).toEqual([]);
      expect(s.status()).toMatchObject({ ok: false, alarm: 'kwarantanna' });
      chmodSync(path.join(s.base, QUEUE.rejected, '_kwarantanna', q[0], BAD), 0o700);
    }
  );

  it('powód odrzucenia: tylko tekst, bez ścieżek serwera, najwyżej 500 znaków', () => {
    const r = cleanReason(`EACCES: permission denied, rename '/var/lib/hyperquant-blog/kolejka/x' -> '/var/lib/hyperquant-blog/praca/x.w'; ${'a'.repeat(900)}`, ['/var/lib/hyperquant-blog']);
    expect(r).not.toMatch(/\/var\/lib/);
    expect(r.length).toBeLessThanOrEqual(500);
    expect(r).toMatch(/^EACCES: permission denied, rename '…\/kolejka\/x'/);
    expect(cleanReason('obraz „x.png”: brak pliku w content/blog/2026-11-11-a/', [])).toBe('obraz „x.png”: brak pliku w content/blog/2026-11-11-a/');
  });

  it.skipIf(!canSymlink || process.platform !== 'linux')('paczka czytana przez deskryptor katalogu (O_DIRECTORY | O_NOFOLLOW): katalog jako dowiązanie jest odrzucany', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'hq-pkg-'));
    mkdirSync(path.join(d, 'prawdziwy', ID), { recursive: true });
    writeFileSync(path.join(d, 'prawdziwy', `${ID}.md`), GOOD);
    symlinkSync(path.join(d, 'prawdziwy'), path.join(d, 'link'));
    expect(() => readPackage(path.join(d, 'link'))).toThrow(/nie jest katalogiem/);
    expect(readPackage(path.join(d, 'prawdziwy')).entries.map((e) => e.path)).toEqual([`${ID}.md`]);
  });

  it('SSH do repo danych tylko ze znanymi kluczami hosta (StrictHostKeyChecking=yes, plik z install.sh)', () => {
    const cmd = sshCommand('/run/credentials/x/deploy_key', '/opt/hyperquant/blog-publisher/known_hosts');
    expect(cmd).toBe('ssh -i /run/credentials/x/deploy_key -o IdentitiesOnly=yes -o UserKnownHostsFile=/opt/hyperquant/blog-publisher/known_hosts -o StrictHostKeyChecking=yes -o BatchMode=yes');
    expect(cmd).not.toMatch(/accept-new/);
  });
});
