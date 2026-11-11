/**
 * Stan niezależnej weryfikacji dziennika w gałęzi `health` repo danych (workflow backend/deploy/ledger-verify.yml):
 *  - `verify/latest.json` — podsumowanie ostatniego zakończonego przebiegu (strona, nadzór danych);
 *  - `verify/checkpoint.json` — punkt kontrolny: ostatni commit gałęzi `ledger` z udaną weryfikacją; następny przebieg
 *    sprawdza historię git tylko po nim (`verify-ledger.mjs --since-commit`), pełny przebieg co najmniej raz na 7 dni;
 *  - `badge/ledger.json` — znaczek shields.io: zielony tylko przy zgodnym wyniku nie starszym niż 36 h.
 *
 *   node scripts/verify-status.mjs since <katalog health>      # commit punktu kontrolnego albo pusto (pełny przebieg)
 *   node scripts/verify-status.mjs publish <katalog health> --code <kod|""> --report <plik> --head <commit> --run <url> [--since <commit>]
 *       pusty --code = weryfikacja się nie skończyła (limit czasu): podsumowanie zostaje, znaczek liczony od nowa
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { VERIFY_MAX_AGE_MS, fromFuture, verifyStale } from '../src/utils/verifyFreshness.ts';

const H = 3_600_000;
/** Pełny przebieg (cała historia git) co najmniej raz na tydzień — wykrywa zmiany sprzed punktu kontrolnego */
export const FULL_EVERY_MS = 7 * 24 * H;
const SHA = /^[0-9a-f]{40}$/;

const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const utcMin = (ms) => new Date(ms).toISOString().slice(0, 16);
const validAt = (x) => !!x && typeof x === 'object' && typeof x.at === 'number' && Number.isFinite(x.at);

/** Problem dla nadzoru danych (scripts/check-data-health.mjs); null = świeża i zgodna. */
export function verifyProblem(latest, nowMs) {
  if (!validAt(latest)) return 'niezależna weryfikacja dziennika: brak poprawnego pola at w verify/latest.json';
  if (fromFuture(latest.at, nowMs)) return `niezależna weryfikacja dziennika: czas wyniku z przyszłości (${utcMin(latest.at).replace('T', ' ')} UTC) — wynik nieważny`;
  if (verifyStale(latest.at, nowMs))
    return `niezależna weryfikacja dziennika: ostatnia ${Math.round((nowMs - latest.at) / H)} h temu (próg ${VERIFY_MAX_AGE_MS / H} h) — przebieg nie kończy się albo nie startuje`;
  if (latest.ok !== true) return `niezależna weryfikacja dziennika wykryła problem (${day(latest.at)}) — szczegóły w przebiegu ${latest.run ?? ''}`.trim();
  return null;
}

/** Znaczek shields.io (endpoint): zielony tylko przy zgodnym wyniku nie starszym niż 36 h. */
export function ledgerBadge(latest, nowMs) {
  const badge = (message, color) => ({ schemaVersion: 1, label: 'dziennik desku', message, color });
  if (!validAt(latest)) return badge('brak weryfikacji', 'red');
  if (fromFuture(latest.at, nowMs)) return badge('nieważna data weryfikacji', 'red');
  if (latest.ok !== true) return badge(`problem ${day(latest.at)}`, 'red');
  if (verifyStale(latest.at, nowMs)) return badge(`nieaktualna weryfikacja ${day(latest.at)}`, 'red');
  return badge(`zweryfikowany ${day(latest.at)}`, 'brightgreen');
}

/**
 * Punkt kontrolny z datą z przyszłości (`at` albo `fullAt` ponad zapas na zegar) jest nieważny — inaczej „pełny co 7 dni”
 * liczony od takiej daty wyłączyłby pełny przebieg na zawsze. Linia raportu albo null.
 */
export function checkpointProblem(checkpoint, nowMs) {
  if (!checkpoint || typeof checkpoint !== 'object') return null;
  const bad = [checkpoint.at, checkpoint.fullAt].find((t) => typeof t === 'number' && fromFuture(t, nowMs));
  return bad === undefined ? null : `✗ punkt kontrolny: data z przyszłości (${utcMin(bad)}Z) — nieważny, wykonano pełny przebieg historii git`;
}

/** Commit, od którego sprawdzać historię git; null = pełny przebieg (brak punktu, nieważny albo pełny starszy niż 7 dni). */
export function sinceCommit(checkpoint, nowMs) {
  if (!checkpoint || typeof checkpoint !== 'object' || !SHA.test(String(checkpoint.commit))) return null;
  if (checkpointProblem(checkpoint, nowMs)) return null;
  if (typeof checkpoint.fullAt !== 'number' || !(nowMs - checkpoint.fullAt <= FULL_EVERY_MS)) return null;
  return checkpoint.commit;
}

/**
 * Nowy stan gałęzi health po przebiegu. `code` — kod wyjścia weryfikatora jako tekst ('' = nie skończył się);
 * `since` — punkt kontrolny użyty w przebiegu (null = pełny). Punkt kontrolny przesuwa tylko przebieg z kodem 0.
 * Nieważny poprzedni punkt (data z przyszłości) to problem w raporcie tego przebiegu (ok = false); nowy punkt powstaje
 * z pełnego przebiegu, więc następny jest znów przyrostowy.
 */
export function publishVerify({ code, report, prevLatest, prevCheckpoint, head, since, run, nowMs }) {
  const finished = /^\d+$/.test(String(code ?? ''));
  const passed = finished && Number(code) === 0;
  const cpProblem = checkpointProblem(prevCheckpoint, nowMs);
  const latest = finished
    ? {
        v: 1,
        ok: passed && !cpProblem,
        at: nowMs,
        run,
        commit: head,
        lines: [
          ...(cpProblem ? [cpProblem] : []),
          ...String(report)
            .split('\n')
            .filter((l) => /^(✓|✗|ℹ)/.test(l)),
        ].slice(0, 40),
      }
    : prevLatest;
  const checkpoint = passed && SHA.test(String(head)) ? { v: 1, commit: head, at: nowMs, fullAt: since ? prevCheckpoint?.fullAt ?? null : nowMs } : prevCheckpoint;
  return { latest, checkpoint, badge: ledgerBadge(latest, nowMs) };
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null; // pierwszy przebieg albo plik uszkodzony
  }
}

function main() {
  const [cmd, dir, ...rest] = process.argv.slice(2);
  const opt = (name) => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? (rest[i + 1] ?? '') : null;
  };
  const now = Date.now();
  const file = (...p) => path.join(dir, ...p);
  if (cmd === 'since' && dir) {
    const cp = readJson(file('verify', 'checkpoint.json'));
    const problem = checkpointProblem(cp, now);
    if (problem) console.error(problem); // dziennik przebiegu; do raportu (latest.json) trafia przy publish
    console.log(sinceCommit(cp, now) ?? '');
    return;
  }
  if (cmd === 'publish' && dir) {
    const reportFile = opt('report');
    let report = '';
    try {
      if (reportFile) report = readFileSync(reportFile, 'utf8');
    } catch {
      // brak raportu — przebieg przerwany przed zapisem
    }
    const since = opt('since');
    const r = publishVerify({
      code: opt('code') ?? '',
      report,
      prevLatest: readJson(file('verify', 'latest.json')),
      prevCheckpoint: readJson(file('verify', 'checkpoint.json')),
      head: opt('head') ?? '',
      since: since && SHA.test(since) ? since : null,
      run: opt('run') ?? '',
      nowMs: now,
    });
    mkdirSync(file('verify'), { recursive: true });
    mkdirSync(file('badge'), { recursive: true });
    if (r.latest) writeFileSync(file('verify', 'latest.json'), `${JSON.stringify(r.latest, null, 2)}\n`, 'utf8');
    if (r.checkpoint) writeFileSync(file('verify', 'checkpoint.json'), `${JSON.stringify(r.checkpoint, null, 2)}\n`, 'utf8');
    writeFileSync(file('badge', 'ledger.json'), `${JSON.stringify(r.badge)}\n`, 'utf8');
    console.log(`${r.badge.message}`);
    return;
  }
  console.error('użycie: verify-status.mjs since <katalog> | publish <katalog> --code <kod> --report <plik> --head <commit> --run <url> [--since <commit>]');
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
