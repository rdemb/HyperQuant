/**
 * Strażnik skanera HyperQuant — uruchamiany na serwerze co 15 min (systemd: hyperquant-watchdog.timer), niezależnie od
 * harmonogramu GitHuba (best-effort, w praktyce często pomijany):
 *  1. samonaprawa — restart zawieszonego skanera (stan `failed`, brak lokalnej publikacji albo stojąca część skanera),
 *     najwyżej raz na godzinę i najwyżej 3 razy w epizodzie; ręcznie zatrzymanej usługi nie uruchamia;
 *  2. alarm — stan zdrowia (ta sama ocena co scripts/check-data-health.mjs) trafia do gałęzi `health` repo danych przez
 *     klucz wdrożeniowy skanera; push uruchamia tam workflow, który otwiera / komentuje / zamyka zgłoszenie
 *     „alert-danych”. Problem wysyłany po potwierdzeniu w dwóch przebiegach (prywatność — od razu), przypomnienie co 6 h.
 * Raport jest publiczny — bez adresów, ścieżek i danych serwera.
 */
import { execFileSync } from 'node:child_process';
import { closeSync, constants, existsSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assessHealth, fetchInput, renderReport } from './check-data-health.mjs';

const MIN = 60_000;
/** Skaner publikuje lokalnie co 30–60 s — 10 min ciszy to zawieszenie */
const LOCAL_STALE = 10 * MIN;
/** Pierwsze minuty po starcie usługi: skaner jeszcze nie zdążył opublikować */
const GRACE = 10 * MIN;
/** Pliki publiczne po starcie: profil płynności po 10 min, publikacja co 2 min, CDN do 5 min, dziennik co 15 min */
const PUBLIC_GRACE = 30 * MIN;
/** Restart działającej usługi dopiero po godzinie jej działania (bezstanowo — odporne na utratę pliku stanu) */
const RESTART_COOLDOWN = 60 * MIN;
/** Restartów w jednym epizodzie problemu — potem tylko alarm (restart nie pomaga, np. przerwany łańcuch dziennika) */
const MAX_RESTARTS = 3;
const REMIND = 6 * 60 * MIN;
const SERVICE = 'hyperquant-scanner';
/**
 * Problemy oceny oznaczające zawieszoną część skanera (nie sieć ani GitHub): publikacja, dziennik, płynność. Stojące
 * laboratorium folkloru tylko alarmuje — jego typowe przyczyny (klon archiwum w tyle, brak rejestracji przy przerwanym
 * dzienniku) restart nie naprawia, a przerwałby dziennik i WebSocket.
 */
const STALL = /skaner nie publikuje|dziennik prognoz: ostatnia aktualizacja|profil płynności: ostatnia aktualizacja|rejestrator płynności nie zapisuje/;
const TRANSIENT = new Set(['activating', 'deactivating', 'reloading']);

const none = { restart: false, reason: null, category: null };

/**
 * Decyzja o restarcie. `serviceState` — wynik `systemctl is-active` (active / inactive / failed / activating…),
 * `activeForMs` — czas działania usługi, `restarts` — restarty strażnika w bieżącym epizodzie, `publicCheck` — czy
 * ocena publicznych plików dotyczy tego skanera (jest HQ_GIT_REMOTE).
 * Kategoria (do klucza alarmu): stall / failed / inactive / giveup.
 */
export function decide({ now, localAsOf, serviceState, activeForMs, lastRestart, restarts, publicCheck, health }) {
  if (TRANSIENT.has(serviceState)) return none;
  if (serviceState === 'inactive') return { restart: false, reason: 'usługa skanera zatrzymana (ręcznie?) — strażnik jej nie uruchamia', category: 'inactive' };
  if (serviceState !== 'active') {
    if (restarts >= MAX_RESTARTS) return { restart: false, reason: `usługa w stanie ${serviceState}, ${MAX_RESTARTS} restarty nie pomogły — potrzebna interwencja`, category: 'giveup' };
    const cooled = lastRestart === null || now - lastRestart > RESTART_COOLDOWN;
    return cooled
      ? { restart: true, reason: `usługa skanera w stanie ${serviceState}`, category: 'failed' }
      : { restart: false, reason: `usługa skanera w stanie ${serviceState} (restart wstrzymany — poprzedni mniej niż godzinę temu)`, category: 'failed' };
  }
  const up = activeForMs ?? Infinity;
  if (up < GRACE) return none;
  let reason = null;
  if (localAsOf !== null && now - localAsOf > LOCAL_STALE) reason = `skaner nie publikował lokalnie od ${Math.round((now - localAsOf) / MIN)} min`;
  else if (publicCheck && localAsOf !== null && up >= PUBLIC_GRACE) {
    const stalled = health.problems.filter((p) => STALL.test(p));
    if (stalled.length) reason = `część skanera stoi mimo działającego procesu (${stalled.map((p) => p.split(':')[0]).join(', ')})`;
  }
  if (!reason) return none;
  if (restarts >= MAX_RESTARTS) return { restart: false, reason: `${reason}; ${MAX_RESTARTS} restarty nie pomogły — potrzebna interwencja`, category: 'giveup' };
  if (up < RESTART_COOLDOWN) return { restart: false, reason: `${reason} (restart możliwy po godzinie działania usługi)`, category: 'stall' };
  return { restart: true, reason, category: 'stall' };
}

/** Problem bez zmiennych szczegółów: liczby → #, treść błędu pobrania pominięta. */
const normalize = (p) => p.replace(/: nie udało się pobrać \(.*\)$/, ': nie udało się pobrać').replace(/\d+([.,]\d+)?/g, '#');

/**
 * Stan alarmu: problemy oceny + informacja strażnika (do raportu). Klucz stanu — kategoria i znormalizowane problemy
 * oceny, bez słów strażnika (restart / wstrzymanie zmieniają się co przebieg i wysyłałyby alarm w kółko).
 */
export function alertState(health, d) {
  const problems = [...health.problems];
  if (d.restart) problems.push(`Strażnik zrestartował skaner: ${d.reason}.`);
  else if (d.reason) problems.push(`Strażnik: ${d.reason}.`);
  const ok = problems.length === 0;
  const key = ok ? 'ok' : [d.category ?? '-', ...health.problems.map(normalize).sort()].join('|');
  return { ok, problems, key };
}

/**
 * Wysyłka: powrót do „ok” od razu; problem — gdy ten sam stan był już w poprzednim przebiegu (`seenKey`; pojedyncze
 * błędy sieci nie otwierają zgłoszenia), prywatność (`urgent`) od razu; ten sam problem — przypomnienie co 6 h.
 */
export function shouldPush({ prevKey, seenKey, key, lastPushAt, ok, urgent, now }) {
  if (ok) return prevKey !== 'ok';
  if (!urgent && key !== seenKey) return false;
  if (key !== prevKey) return true;
  return lastPushAt === null || now - lastPushAt >= REMIND;
}

/** Surowe pliki repo danych z adresu git (GitHub, SSH albo HTTPS); null = brak / inny serwis. */
export function dataBaseFromRemote(remote) {
  const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec((remote ?? '').trim());
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/main` : null;
}

/** Środowisko git jak `gitEnv` skanera: bez konfiguracji globalnej, stały autor noreply, czas UTC (bez strefy serwera). */
export function gitEnv(work, key, now) {
  const date = `${new Date(now).toISOString().replace(/\.\d{3}Z$/, '')}+00:00`;
  return {
    PATH: process.env.PATH,
    HOME: work,
    TZ: 'UTC',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'HyperQuant scanner',
    GIT_AUTHOR_EMAIL: 'hyperquant-scanner@users.noreply.github.com',
    GIT_COMMITTER_NAME: 'HyperQuant scanner',
    GIT_COMMITTER_EMAIL: 'hyperquant-scanner@users.noreply.github.com',
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
    GIT_SSH_COMMAND: `ssh -i ${key} -o IdentitiesOnly=yes -o UserKnownHostsFile=${path.join(work, 'known_hosts')} -o StrictHostKeyChecking=accept-new -o BatchMode=yes`,
  };
}

function serviceState() {
  try {
    return execFileSync('systemctl', ['is-active', SERVICE], { encoding: 'utf8' }).trim();
  } catch (e) {
    // is-active kończy się kodem ≠ 0 dla każdego stanu poza active — stan jest na stdout
    const out = e && typeof e === 'object' && 'stdout' in e ? String(e.stdout).trim() : '';
    return out || 'unknown';
  }
}

/** Czas działania usługi: oba zegary CLOCK_MONOTONIC (systemd i libuv); null = nieznany. */
function activeForMs() {
  try {
    const us = Number(execFileSync('systemctl', ['show', '-p', 'ActiveEnterTimestampMonotonic', '--value', SERVICE], { encoding: 'utf8' }).trim());
    if (!(us > 0)) return null;
    return Math.max(0, Number(process.hrtime.bigint() / 1000n) - us) / 1000;
  } catch {
    return null;
  }
}

/** Lokalny status.json skanera — tylko zwykły plik (bez dowiązań i kolejek FIFO podłożonych w katalogu usługi). */
function readLocalAsOf(file) {
  let fd = null;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!fstatSync(fd).isFile()) return null;
    const a = JSON.parse(readFileSync(fd, 'utf8')).asOf;
    return typeof a === 'number' && Number.isFinite(a) ? a : null;
  } catch {
    return null; // skaner jeszcze nic nie opublikował albo plik uszkodzony
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** Zapis stanu atomowo (plik tymczasowy + rename) — przerwany zapis nie gubi licznika restartów. */
function saveState(file, st) {
  writeFileSync(`${file}.tmp`, JSON.stringify(st), 'utf8');
  renameSync(`${file}.tmp`, file);
}

/** Zapis stanu w gałęzi `health` repo danych (klon w katalogu strażnika); false = nie wysłano. */
function pushAlert(remote, key, work, a, report, now) {
  const dir = path.join(work, 'health-repo');
  const env = gitEnv(work, key, now);
  const git = (args) => execFileSync('git', args, { encoding: 'utf8', env, timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    if (!existsSync(path.join(dir, '.git'))) {
      rmSync(dir, { recursive: true, force: true });
      git(['clone', '--quiet', '--branch', 'health', '--single-branch', remote, dir]);
    } else {
      git(['-C', dir, 'fetch', '--quiet', remote, 'health']);
      git(['-C', dir, 'reset', '--quiet', '--hard', 'FETCH_HEAD']);
    }
    const alert = { v: 1, ok: a.ok, checkedAt: now, problems: a.problems };
    writeFileSync(path.join(dir, 'alert.json'), `${JSON.stringify(alert, null, 2)}\n`, 'utf8');
    writeFileSync(path.join(dir, 'report.md'), report, 'utf8');
    git(['-C', dir, 'add', 'alert.json', 'report.md']);
    git(['-C', dir, 'commit', '--quiet', '-m', `strażnik: ${a.ok ? 'ok' : 'problem'} ${new Date(now).toISOString().slice(0, 16)} UTC`]);
    git(['-C', dir, 'push', '--quiet', remote, 'HEAD:health']);
    return true;
  } catch (e) {
    console.error(`[strażnik] wysyłka stanu nieudana: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    // Uszkodzony klon nie może blokować alarmów na zawsze — następny przebieg sklonuje od nowa (repo jest małe)
    rmSync(dir, { recursive: true, force: true });
    return false;
  }
}

async function main() {
  const now = Date.now();
  const env = process.env;
  const outDir = env.HQ_OUT_DIR || '/var/lib/hyperquant/out';
  // Katalog strażnika należy do root i leży poza katalogiem usługi skanera (StateDirectory w jednostce systemd)
  const work = env.HQ_WATCHDOG_DIR || '/var/lib/hyperquant-watchdog';
  mkdirSync(work, { recursive: true, mode: 0o700 });
  const stateFile = path.join(work, 'state.json');
  let st = { lastRestart: null, restarts: 0, prevKey: null, seenKey: null, lastPushAt: null };
  try {
    st = { ...st, ...JSON.parse(readFileSync(stateFile, 'utf8')) };
  } catch {
    // pierwszy przebieg
  }
  const remote = (env.HQ_GIT_REMOTE ?? '').trim();
  const base = dataBaseFromRemote(remote);
  const health = base ? assessHealth(await fetchInput(base), now) : { ok: true, problems: [], facts: [] };
  const state = serviceState();
  const d = decide({
    now,
    localAsOf: readLocalAsOf(path.join(outDir, 'status.json')),
    serviceState: state,
    activeForMs: state === 'active' ? activeForMs() : null,
    lastRestart: st.lastRestart,
    restarts: st.restarts,
    publicCheck: base !== null,
    health,
  });
  if (d.restart) {
    st.lastRestart = now;
    st.restarts += 1;
    saveState(stateFile, st); // przed restartem — utrata zapisu nie może skasować przerwy między restartami
    try {
      execFileSync('systemctl', ['restart', SERVICE], { timeout: 120_000 });
    } catch (e) {
      d.reason = `${d.reason} — restart nieudany (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`;
    }
  }
  const a = alertState(health, d);
  if (a.ok) st.restarts = 0; // koniec epizodu
  console.log(`[strażnik] ${a.ok ? 'ok' : `problem: ${a.problems.join('; ')}`}`);
  const urgent = a.problems.some((p) => p.startsWith('PRYWATNOŚĆ'));
  const key = env.HQ_GIT_SSH_KEY;
  if (remote && key && shouldPush({ prevKey: st.prevKey, seenKey: st.seenKey, key: a.key, lastPushAt: st.lastPushAt, ok: a.ok, urgent, now })) {
    if (pushAlert(remote, key, work, a, renderReport({ ok: a.ok, problems: a.problems, facts: health.facts }, now), now)) {
      st.prevKey = a.key;
      st.lastPushAt = now;
    }
  }
  st.seenKey = a.key;
  saveState(stateFile, st);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
