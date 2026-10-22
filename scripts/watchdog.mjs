/**
 * Strażnik skanera HyperQuant — uruchamiany na serwerze co 15 min (systemd: hyperquant-watchdog.timer), niezależnie od
 * harmonogramu GitHuba (best-effort, w praktyce często pomijany):
 *  1. samonaprawa — gdy skaner przestaje publikować (lokalnie albo do repo danych) albo usługa stoi, restartuje usługę
 *     (najwyżej raz na godzinę);
 *  2. alarm — stan zdrowia (ta sama ocena co scripts/check-data-health.mjs) trafia do gałęzi `health` repo danych przez
 *     klucz wdrożeniowy skanera; push uruchamia tam workflow, który otwiera / aktualizuje / zamyka zgłoszenie
 *     „alert-danych”. Wysyłka tylko przy zmianie stanu (i przypomnienie co 6 h przy trwałym problemie).
 * Raport jest publiczny — bez adresów, ścieżek i danych serwera.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assessHealth, fetchInput, renderReport } from './check-data-health.mjs';

const MIN = 60_000;
/** Skaner publikuje lokalnie co 30–60 s — 10 min ciszy to zawieszenie */
const LOCAL_STALE = 10 * MIN;
const RESTART_COOLDOWN = 60 * MIN;
const REMIND = 6 * 60 * MIN;
const SERVICE = 'hyperquant-scanner';
/** Problemy oceny oznaczające zawieszoną część skanera (nie sieć ani GitHub): publikacja, dziennik, rejestrator płynności */
const STALL = /skaner nie publikuje|dziennik prognoz: ostatnia aktualizacja|profil płynności: ostatnia aktualizacja|rejestrator płynności nie zapisuje/;

/**
 * Restart skanera: usługa zatrzymana, brak lokalnej publikacji > 10 min albo — przy świeżych danych lokalnych — stoi
 * publikacja, dziennik prognoz lub rejestrator płynności. Błąd pobrania (sieć, GitHub) i problemy jakości (pokrycie OI)
 * restartu nie wywołują. Najwyżej raz na godzinę; usługa uruchomiona < 10 min temu albo brak pliku lokalnego — bez
 * restartu (skaner jeszcze nie zdążył opublikować).
 */
export function decide({ now, localAsOf, serviceActive, activeForMs = null, lastRestart, health }) {
  let reason = null;
  if (!serviceActive) reason = 'usługa skanera była zatrzymana';
  else if (activeForMs !== null && activeForMs < LOCAL_STALE) reason = null;
  else if (localAsOf !== null && now - localAsOf > LOCAL_STALE) reason = `skaner nie publikował lokalnie od ${Math.round((now - localAsOf) / MIN)} min`;
  else if (localAsOf !== null) {
    const stalled = health.problems.filter((p) => STALL.test(p));
    if (stalled.length) reason = `część skanera stoi mimo działającego procesu (${stalled.map((p) => p.split(':')[0]).join(', ')})`;
  }
  if (!reason) return { restart: false, reason: null };
  const cooled = lastRestart === null || now - lastRestart > RESTART_COOLDOWN;
  return cooled ? { restart: true, reason } : { restart: false, reason: `${reason} (restart wstrzymany — poprzedni mniej niż godzinę temu)` };
}

/** Stan alarmu: problemy oceny + informacja o restarcie; klucz stanu bez liczb (np. wieku danych), żeby nie wysyłać co 15 min. */
export function alertState(health, d) {
  const problems = [...health.problems];
  if (d.restart) problems.push(`Strażnik zrestartował skaner: ${d.reason}.`);
  else if (d.reason) problems.push(`Strażnik: ${d.reason}.`);
  const ok = problems.length === 0;
  const key = ok ? 'ok' : problems.map((p) => p.replace(/\d+([.,]\d+)?/g, '#')).sort().join('|');
  return { ok, problems, key };
}

/** Wysyłka przy zmianie stanu albo (trwały problem) przypomnienie co 6 h; pierwszy przebieg — zawsze. */
export function shouldPush({ prevKey, key, lastPushAt, ok, now }) {
  if (prevKey === null || key !== prevKey) return true;
  return !ok && (lastPushAt === null || now - lastPushAt >= REMIND);
}

function serviceActive() {
  try {
    return execFileSync('systemctl', ['is-active', SERVICE], { encoding: 'utf8' }).trim() === 'active';
  } catch {
    return false;
  }
}

/** Czas działania usługi (ms) z zegara monotonicznego systemd i /proc/uptime; null = nieznany. */
function activeForMs() {
  try {
    const us = Number(execFileSync('systemctl', ['show', '-p', 'ActiveEnterTimestampMonotonic', '--value', SERVICE], { encoding: 'utf8' }).trim());
    const up = Number(readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
    return us > 0 && up > 0 ? Math.max(0, up * 1000 - us / 1000) : null;
  } catch {
    return null;
  }
}

/** Git bez konfiguracji globalnej i systemowej (jak `gitEnv` skanera): stały autor noreply, klucz wdrożeniowy skanera. */
function git(work, key, args) {
  const env = {
    PATH: process.env.PATH,
    HOME: work,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'HyperQuant scanner',
    GIT_AUTHOR_EMAIL: 'hyperquant-scanner@users.noreply.github.com',
    GIT_COMMITTER_NAME: 'HyperQuant scanner',
    GIT_COMMITTER_EMAIL: 'hyperquant-scanner@users.noreply.github.com',
    GIT_SSH_COMMAND: `ssh -i ${key} -o IdentitiesOnly=yes -o UserKnownHostsFile=${path.join(work, 'known_hosts')} -o StrictHostKeyChecking=accept-new -o BatchMode=yes`,
  };
  return execFileSync('git', args, { encoding: 'utf8', env, timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Zapis stanu w gałęzi `health` repo danych (klon w katalogu strażnika); false = nie wysłano. */
function pushAlert(env, work, a, report, now) {
  if (!env.HQ_GIT_REMOTE || !env.HQ_GIT_SSH_KEY) {
    console.log('[strażnik] brak HQ_GIT_REMOTE / HQ_GIT_SSH_KEY — stan tylko w dzienniku');
    return false;
  }
  const dir = path.join(work, 'health-repo');
  try {
    const key = env.HQ_GIT_SSH_KEY;
    if (!existsSync(path.join(dir, '.git'))) git(work, key, ['clone', '--quiet', '--branch', 'health', '--single-branch', env.HQ_GIT_REMOTE, dir]);
    else {
      git(work, key, ['-C', dir, 'fetch', '--quiet', 'origin', 'health']);
      git(work, key, ['-C', dir, 'reset', '--quiet', '--hard', 'origin/health']);
    }
    const alert = { v: 1, ok: a.ok, checkedAt: now, problems: a.problems };
    writeFileSync(path.join(dir, 'alert.json'), `${JSON.stringify(alert, null, 2)}\n`, 'utf8');
    writeFileSync(path.join(dir, 'report.md'), report, 'utf8');
    git(work, key, ['-C', dir, 'add', 'alert.json', 'report.md']);
    const msg = `strażnik: ${a.ok ? 'ok' : 'problem'} ${new Date(now).toISOString().slice(0, 16)} UTC`;
    // --allow-empty: przypomnienie przy niezmienionej treści też musi uruchomić workflow
    git(work, key, ['-C', dir, 'commit', '--quiet', '--allow-empty', '-m', msg]);
    git(work, key, ['-C', dir, 'push', '--quiet', 'origin', 'HEAD:health']);
    return true;
  } catch (e) {
    console.error(`[strażnik] wysyłka stanu nieudana: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    return false;
  }
}

async function main() {
  const now = Date.now();
  const env = process.env;
  const outDir = env.HQ_OUT_DIR || '/var/lib/hyperquant/out';
  const work = env.HQ_WATCHDOG_DIR || '/var/lib/hyperquant/watchdog';
  mkdirSync(work, { recursive: true });
  const stateFile = path.join(work, 'state.json');
  let st = { lastRestart: null, prevKey: null, lastPushAt: null };
  try {
    st = { ...st, ...JSON.parse(readFileSync(stateFile, 'utf8')) };
  } catch {
    // pierwszy przebieg
  }
  let localAsOf = null;
  try {
    const a = JSON.parse(readFileSync(path.join(outDir, 'status.json'), 'utf8')).asOf;
    localAsOf = typeof a === 'number' ? a : null;
  } catch {
    // skaner jeszcze nic nie opublikował
  }
  const health = assessHealth(await fetchInput(), now);
  const active = serviceActive();
  const d = decide({ now, localAsOf, serviceActive: active, activeForMs: active ? activeForMs() : null, lastRestart: st.lastRestart, health });
  if (d.restart) {
    st.lastRestart = now;
    try {
      execFileSync('systemctl', ['restart', SERVICE], { timeout: 120_000 });
    } catch (e) {
      d.reason = `${d.reason} — restart nieudany (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`;
    }
  }
  const a = alertState(health, d);
  console.log(`[strażnik] ${a.ok ? 'ok' : `problem: ${a.problems.join('; ')}`}`);
  if (shouldPush({ prevKey: st.prevKey, key: a.key, lastPushAt: st.lastPushAt, ok: a.ok, now })) {
    if (pushAlert(env, work, a, renderReport({ ok: a.ok, problems: a.problems, facts: health.facts }, now), now)) {
      st.prevKey = a.key;
      st.lastPushAt = now;
    }
  }
  writeFileSync(stateFile, JSON.stringify(st), 'utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
