#!/usr/bin/env node
// Wydawca wpisów bloga na serwerze (usługa hyperquant-blog-publisher, co minutę): bierze kompletne paczki z kolejki, sprawdza
// je tym samym filtrem (intake.mjs) i walidatorem wpisów (posts.mjs) co build strony, commituje na gałąź `blog` repo danych
// i wypycha kluczem repo danych (LoadCredential). Autor wpisów nie ma żadnego klucza: tylko dodaje paczki do kolejki.
// Kontrakt kolejki (katalogi, paczka, wynik dla autora, plik statusu): docs/BLOG.md, „Publishing queue on the server”.
// Użycie (systemd): HQ_BLOG_DIR=/var/lib/hyperquant-blog HQ_BLOG_STATE=/var/lib/hyperquant-blog-publisher \
//   HQ_GIT_REMOTE=git@github.com:<właściciel>/<repo-danych>.git node scripts/blog/publisher.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LIMITS, intake } from './intake.mjs';
import { loadPostFile } from './posts.mjs';

/** Podkatalogi katalogu wspólnego autora i wydawcy (HQ_BLOG_DIR). */
export const QUEUE = { queue: 'kolejka', done: 'zrobione', rejected: 'odrzucone', status: 'stan', work: 'praca' };
/** Gotowa paczka: katalog o nazwie identyfikatora wpisu (paczka w budowie ma nazwę `<id>.tmp-<losowe>` i jest pomijana). */
const PACKAGE = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,60}$/;
const BRANCH = 'blog';
const PUSH_ATTEMPTS = 3;
const MAX_FILES = 64;
const KEEP_REJECTED = 20;
const AUTHOR = { name: 'HyperQuant blog', email: 'hyperquant-blog@users.noreply.github.com' };

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const firstLine = (e) => (e instanceof Error ? e.message : String(e)).split('\n').find((l) => l.trim()) ?? 'błąd';

/** Zwykły plik bez podążania za dowiązaniem (O_NOFOLLOW, fstat); null = nie zwykły plik. */
function readRegular(file) {
  let fd = null;
  try {
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    if (!fstatSync(fd).isFile()) return null;
    return readFileSync(fd);
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * Pliki paczki jako wpisy dla filtra intake (ścieżki jak w gałęzi: `<id>.md`, `<id>/…`) i treść przeczytana raz do pamięci:
 * sprawdzane i commitowane są te same bajty, więc późniejsza zmiana pliku przez autora niczego nie podmieni.
 */
export function readPackage(dir) {
  const entries = [];
  const data = new Map();
  const walk = (rel, depth) => {
    for (const name of readdirSync(path.join(dir, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(path.join(dir, r));
      if (st.isSymbolicLink()) entries.push({ path: r, mode: '120000', size: 0, kind: 'symlink' });
      else if (st.isDirectory() && depth === 0) walk(r, 1);
      else if (st.isDirectory()) entries.push({ path: r, mode: '040000', size: 0, kind: 'dir' });
      else if (!st.isFile()) entries.push({ path: r, mode: '100644', size: 0, kind: 'other' });
      else {
        const e = { path: r, mode: st.mode & 0o111 ? '100755' : '100644', size: st.size, kind: 'file' };
        if (st.size <= LIMITS.post) {
          const buf = readRegular(path.join(dir, r));
          if (!buf) e.kind = 'other';
          else {
            data.set(r, buf);
            e.size = buf.length;
            if (/\.(png|jpg|webp)$/.test(r)) e.head = buf.subarray(0, 16);
            if (r.endsWith('.md')) e.text = buf.toString('utf8');
          }
        }
        entries.push(e);
      }
      if (entries.length > MAX_FILES) throw new Error(`ponad ${MAX_FILES} plików w paczce`);
    }
  };
  walk('', 0);
  return { entries, data };
}

/** Środowisko git: bez konfiguracji globalnej i systemowej, stały neutralny autor, klucz repo danych (gdy jest). */
function gitEnv(base, home, key, now) {
  const date = `${new Date(now).toISOString().replace(/\.\d{3}Z$/, '')}+00:00`;
  return {
    ...base,
    HOME: home,
    TZ: 'UTC',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: AUTHOR.name,
    GIT_AUTHOR_EMAIL: AUTHOR.email,
    GIT_COMMITTER_NAME: AUTHOR.name,
    GIT_COMMITTER_EMAIL: AUTHOR.email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
    ...(key ? { GIT_SSH_COMMAND: `ssh -i ${key} -o IdentitiesOnly=yes -o UserKnownHostsFile=${path.join(home, 'known_hosts')} -o StrictHostKeyChecking=accept-new -o BatchMode=yes` } : {}),
  };
}

/**
 * Zapis atomowy (plik tymczasowy w tym samym katalogu + rename): autor i strażnik nigdy nie widzą połowy pliku. Prawa
 * jawnie po zapisie (UMask usługi by je obciął): wyniki 0640 (grupa kolejki), status 0644 (czyta każdy, np. strażnik).
 */
function writeAtomic(file, text, mode = 0o640) {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  chmodSync(tmp, mode);
  renameSync(tmp, file);
}

/** Klon gałęzi blog w katalogu stanu, równo z repo danych; gałęzi jeszcze nie ma → pusta gałąź sieroca. */
function prepareClone(clone, remote, git) {
  if (!existsSync(path.join(clone, '.git'))) {
    rmSync(clone, { recursive: true, force: true });
    mkdirSync(clone, { recursive: true });
    git(['init', '-q', clone]);
  }
  const g = (args) => git(['-C', clone, ...args]);
  try {
    g(['rebase', '--abort']);
  } catch {
    // nie było przerwanego rebase
  }
  if (git(['ls-remote', '--heads', remote, `refs/heads/${BRANCH}`]).trim()) {
    g(['fetch', '-q', '--no-tags', remote, `refs/heads/${BRANCH}`]);
    g(['checkout', '-q', '-f', '-B', BRANCH, 'FETCH_HEAD']);
    g(['reset', '-q', '--hard', 'FETCH_HEAD']);
  } else {
    try {
      g(['update-ref', '-d', `refs/heads/${BRANCH}`]);
    } catch {
      // gałęzi lokalnej też nie było
    }
    g(['symbolic-ref', 'HEAD', `refs/heads/${BRANCH}`]);
    g(['read-tree', '--empty']);
  }
  g(['clean', '-q', '-f', '-d', '-x']);
}

/** Identyfikatory wpisów (pliki <id>.md) w katalogu; brak katalogu = pusto. */
function postIds(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && PACKAGE.test(f.slice(0, -3)))
    .map((f) => f.slice(0, -3));
}

/**
 * Sprawdzenie jednej paczki: kształt, filtr gałęzi (te same zasady co build strony; wpis już w gałęzi = poprawka, bez okna
 * daty), limit doby, walidator wpisów na kopii w katalogu roboczym. Zwraca { files } albo { reason }.
 */
function checkPackage(id, pkgDir, { branchIds, mainIds, now, scratch }) {
  const st = lstatSync(pkgDir);
  if (st.isSymbolicLink() || !st.isDirectory()) return { reason: 'paczka nie jest katalogiem (dowiązanie albo plik)' };
  let pkg;
  try {
    pkg = readPackage(pkgDir);
  } catch (e) {
    return { reason: firstLine(e) };
  }
  // sha256 przysłanego <id>.md w każdym wyniku: autor rozpoznaje wynik swojej paczki (null = brak zwykłego pliku <id>.md)
  const mdBuf = pkg.data.get(`${id}.md`);
  const md = mdBuf ? sha256(mdBuf) : null;
  const fail = (reason) => ({ reason, md });
  if (!pkg.entries.some((e) => e.path === `${id}.md`)) return fail(`paczka ${id} bez pliku ${id}.md`);
  const r = intake({ entries: pkg.entries, registry: Object.fromEntries([...branchIds].map((b) => [b, {}])), mainIds, now });
  if (r.skipped.length) return fail(r.skipped.map((s) => `${s.id ?? s.path}: ${s.reason}`).join('; '));
  const files = r.posts.find((p) => p.id === id)?.files;
  if (!files || r.posts.length !== 1) return fail(`paczka ${id}: oczekiwany dokładnie jeden wpis ${id}`);
  if (!branchIds.has(id) && [...branchIds].filter((b) => b.startsWith(id.slice(0, 10))).length >= LIMITS.perDay)
    return fail(`limit ${LIMITS.perDay} nowych wpisów na dobę kalendarzową (${id.slice(0, 10)})`);
  // Walidator wpisów (ten sam co build strony) na kopii z pamięci
  rmSync(scratch, { recursive: true, force: true });
  for (const f of files) {
    mkdirSync(path.dirname(path.join(scratch, f)), { recursive: true });
    writeFileSync(path.join(scratch, f), pkg.data.get(f));
  }
  const { errors } = loadPostFile(path.join(scratch, `${id}.md`));
  rmSync(scratch, { recursive: true, force: true });
  if (errors.length) return fail(errors.join('; '));
  return { files, data: pkg.data, md };
}

/**
 * Jeden przebieg wydawcy. `base`: katalog wspólny (kolejka, wyniki, status); `state`: prywatny katalog wydawcy (klon gałęzi,
 * kopia robocza); `remote`: repo danych; `env`: bazowe środowisko poleceń git; `key`: klucz SSH repo danych; `mainContent`:
 * wpisy z main (content/blog), których identyfikatorów gałąź nie może przejąć; `hooks.beforePush` — do testów (wyścig).
 * Zwraca { published, rejected, pushError, attempts }; zapisuje wyniki dla autora i status.
 */
export function runPublisher({ base, state, remote, now = Date.now(), env = { PATH: process.env.PATH }, key = null, mainContent = null, hooks = {} }) {
  const at = new Date(now).toISOString();
  const dir = (k) => path.join(base, QUEUE[k]);
  const statusFile = path.join(dir('status'), 'status.json');
  let prev = {};
  try {
    prev = JSON.parse(readFileSync(statusFile, 'utf8'));
  } catch {
    // pierwszy przebieg
  }
  const rejectedNow = [];
  let published = 0;
  let pushError = null;
  let attempts = 0;
  const writeResult = (kind, id, body) => {
    writeAtomic(path.join(dir(kind), `${id}.json`), `${JSON.stringify({ v: 1, id, ...body, at })}\n`);
    rmSync(path.join(dir(kind === 'done' ? 'rejected' : 'done'), `${id}.json`), { force: true });
  };
  // Paczka przejęta do katalogu roboczego wydawcy (0700): autor nie ma tam dostępu, więc nie podmieni pliku ani katalogu
  // na dowiązanie między sprawdzeniem a odczytem. rename nie podąża za dowiązaniami (przenosi sam wpis katalogu).
  const taken = new Map();
  const work = (id) => path.join(dir('work'), `${id}.w`);
  const exists = (p) => {
    try {
      lstatSync(p);
      return true;
    } catch {
      return false;
    }
  };
  const removePackage = (id) => {
    rmSync(taken.get(id) ?? path.join(dir('queue'), id), { recursive: true, force: true });
    taken.delete(id);
  };
  /** Paczka nieopublikowana (błąd repo danych) wraca do kolejki; nowsza paczka tego wpisu w kolejce ma pierwszeństwo. */
  const giveBack = (id, from) => {
    try {
      if (exists(path.join(dir('queue'), id))) rmSync(from, { recursive: true, force: true });
      else renameSync(from, path.join(dir('queue'), id));
    } catch (e) {
      console.error(`[wydawca] zwrot paczki ${id} do kolejki nieudany: ${firstLine(e)}`);
    }
  };
  // Pozostałości przerwanego przebiegu wracają do kolejki
  for (const n of readdirSync(dir('work'))) if (n.endsWith('.w') && PACKAGE.test(n.slice(0, -2))) giveBack(n.slice(0, -2), path.join(dir('work'), n));
  const reject = (id, reason, md = null) => {
    writeResult('rejected', id, { status: 'rejected', md, reason });
    rejectedNow.push({ id, reason, at });
    removePackage(id);
  };

  const ready = readdirSync(dir('queue')).filter((n) => PACKAGE.test(n)).sort();
  if (ready.length) {
    const genv = gitEnv(env, state, key, now);
    const git = (args) => execFileSync('git', args, { env: genv, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const clone = path.join(state, 'blog-repo');
    try {
      prepareClone(clone, remote, git);
      const branchIds = new Set(postIds(clone));
      const mainIds = new Set(postIds(mainContent));
      const accepted = [];
      for (const id of ready) {
        const st = lstatSync(path.join(dir('queue'), id));
        if (st.isSymbolicLink() || !st.isDirectory()) {
          reject(id, 'paczka nie jest katalogiem (dowiązanie albo plik)');
          continue;
        }
        rmSync(work(id), { recursive: true, force: true });
        try {
          renameSync(path.join(dir('queue'), id), work(id));
        } catch (e) {
          reject(id, `nie można przejąć paczki (katalog paczki musi mieć prawo zapisu grupy, umask 0007): ${firstLine(e)}`);
          continue;
        }
        taken.set(id, work(id));
        const c = checkPackage(id, work(id), { branchIds, mainIds, now, scratch: path.join(state, 'sprawdzenie') });
        if (c.reason) {
          reject(id, c.reason, c.md ?? null);
          continue;
        }
        // Wpis w gałęzi zastępowany w całości: .md i folder mediów dokładnie z paczki
        const existed = branchIds.has(id);
        rmSync(path.join(clone, `${id}.md`), { force: true });
        rmSync(path.join(clone, id), { recursive: true, force: true });
        for (const f of c.files) {
          mkdirSync(path.dirname(path.join(clone, f)), { recursive: true });
          writeFileSync(path.join(clone, f), c.data.get(f));
        }
        // Poprzednie paczki są już zatwierdzone, więc zmiany w drzewie to tylko ten wpis
        git(['-C', clone, 'add', '-A', '--', '.']);
        let committed = false;
        try {
          git(['-C', clone, 'diff', '--cached', '--quiet']);
        } catch {
          git(['-C', clone, 'commit', '-q', '-m', `blog: ${existed ? 'zmiana ' : ''}${id}`]);
          committed = true;
        }
        branchIds.add(id);
        accepted.push({ id, md: c.md, committed });
      }
      if (accepted.some((a) => a.committed)) {
        for (attempts = 1; attempts <= PUSH_ATTEMPTS; attempts++) {
          hooks.beforePush?.(attempts);
          try {
            git(['-C', clone, 'push', '-q', remote, `HEAD:refs/heads/${BRANCH}`]);
            pushError = null;
            break;
          } catch (e) {
            pushError = firstLine(e);
            if (attempts === PUSH_ATTEMPTS) break;
            // Ktoś wypchnął w międzyczasie: nasze commity na nową głowę gałęzi i ponowna próba
            git(['-C', clone, 'fetch', '-q', '--no-tags', remote, `refs/heads/${BRANCH}`]);
            git(['-C', clone, 'rebase', '-q', 'FETCH_HEAD']);
          }
        }
        attempts = Math.min(attempts, PUSH_ATTEMPTS);
      }
      if (!pushError)
        for (const a of accepted) {
          const commit = git(['-C', clone, 'log', '-1', '--format=%H', '--', `${a.id}.md`, a.id]).trim();
          writeResult('done', a.id, { status: 'published', md: a.md, commit, committed: a.committed });
          removePackage(a.id);
          published++;
        }
    } catch (e) {
      // Repo danych nieosiągalne albo przerwany rebase: paczki zostają w kolejce, następny przebieg zaczyna od czystego klonu
      pushError = firstLine(e);
    } finally {
      for (const [id, from] of taken) giveBack(id, from);
    }
  }

  const lastRejected = [...rejectedNow, ...(Array.isArray(prev.lastRejected) ? prev.lastRejected : [])].slice(0, KEEP_REJECTED);
  const alarm = pushError ? 'push' : rejectedNow.length ? 'odrzucone' : null;
  writeAtomic(statusFile, `${JSON.stringify({ v: 1, at, ok: alarm === null, alarm, published, rejected: rejectedNow.length, pending: readdirSync(dir('queue')).filter((n) => PACKAGE.test(n)).length, pushError, lastRejected }, null, 2)}\n`, 0o644);
  return { published, rejected: rejectedNow.length, pushError, attempts };
}

/** Klucz repo danych: kopia od systemd (LoadCredential) albo ścieżka z HQ_GIT_SSH_KEY (uruchomienie ręczne). */
function deployKey(env) {
  const cred = env.CREDENTIALS_DIRECTORY ? path.join(env.CREDENTIALS_DIRECTORY, 'deploy_key') : null;
  if (cred && existsSync(cred)) return cred;
  return (env.HQ_GIT_SSH_KEY ?? '').trim() || null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const env = process.env;
  const need = (k) => {
    const v = (env[k] ?? '').trim();
    if (!v) {
      console.error(`[wydawca] brak ${k}`);
      process.exit(2);
    }
    return v;
  };
  const r = runPublisher({
    base: need('HQ_BLOG_DIR'),
    state: need('HQ_BLOG_STATE'),
    remote: need('HQ_GIT_REMOTE'),
    env: { PATH: env.PATH ?? '/usr/bin:/bin' },
    key: deployKey(env),
    mainContent: env.HQ_BLOG_MAIN_CONTENT || null,
  });
  console.log(`[wydawca] opublikowane ${r.published}, odrzucone ${r.rejected}${r.pushError ? `, błąd repo danych: ${r.pushError}` : ''}`);
  if (r.pushError) process.exit(1);
}
