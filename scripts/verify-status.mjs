/**
 * Stan niezależnej weryfikacji dziennika w gałęzi wyników repo HyperQuant (workflow .github/workflows/ledger-verify.yml,
 * adresy w src/utils/verifyFreshness.ts):
 *  - `verify/latest.json` — podsumowanie ostatniego zakończonego przebiegu (strona, nadzór danych);
 *  - `verify/anchor.json` — kotwica: commit gałęzi `ledger` z ostatniej udanej weryfikacji; każdy przebieg sprawdza całą
 *    historię git i to, że kotwica nadal w niej jest (`verify-ledger.mjs --anchor`) — inaczej historia przepisana;
 *  - `badge/ledger.json` — znaczek shields.io: zielony tylko przy zgodnym wyniku nie starszym niż 36 h.
 *
 *   node scripts/verify-status.mjs anchor <katalog wyników>     # commit kotwicy albo pusto (pierwszy przebieg)
 *   node scripts/verify-status.mjs publish <katalog wyników> --code <kod|""> --report <plik> --head <commit> --run <url>
 *       pusty --code = weryfikacja się nie skończyła (limit czasu): podsumowanie i kotwica zostają, znaczek liczony od nowa
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { VERIFY_MAX_AGE_MS, fromFuture, verifyStale } from '../src/utils/verifyFreshness.ts';

const H = 3_600_000;
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

/** Commit kotwicy dla weryfikatora; null = brak albo uszkodzona (pierwszy przebieg — bez kontroli kotwicy). */
export function anchorCommit(anchor) {
  return anchor && typeof anchor === 'object' && SHA.test(String(anchor.commit)) ? anchor.commit : null;
}

/**
 * Kotwicy brak albo jest uszkodzona, a poprzedni wynik był zgodny (wtedy kotwica musiała powstać) — usunięcie kotwicy
 * nie może udawać pierwszego przebiegu i ukryć przepisanej historii. Brak obu plików = prawdziwy pierwszy przebieg.
 */
export function anchorProblem(anchor, prevLatest) {
  if (anchorCommit(anchor) || !prevLatest || typeof prevLatest !== 'object' || prevLatest.ok !== true) return null;
  return '✗ kotwica usunięta albo uszkodzona (verify/anchor.json), choć poprzedni wynik był zgodny — ciągłości historii git nie da się sprawdzić';
}

/**
 * Nowy stan gałęzi wyników po przebiegu. `code` — kod wyjścia weryfikatora jako tekst ('' = nie skończył się).
 * Kotwicę przesuwa tylko przebieg z kodem 0 — po wykryciu przepisanej historii zostaje, więc alarm trwa do wyjaśnienia.
 * Usunięta albo uszkodzona kotwica (`anchorProblem`) to problem tego przebiegu i nowa kotwica z niego nie powstaje.
 */
export function publishVerify({ code, report, prevLatest, prevAnchor, head, run, nowMs }) {
  const finished = /^\d+$/.test(String(code ?? ''));
  const passed = finished && Number(code) === 0;
  const lost = anchorProblem(prevAnchor, prevLatest);
  const latest = finished
    ? {
        v: 1,
        ok: passed && !lost,
        at: nowMs,
        run,
        commit: head,
        lines: [
          ...(lost ? [lost] : []),
          ...String(report)
            .split('\n')
            .filter((l) => /^(✓|✗|ℹ)/.test(l)),
        ].slice(0, 40),
      }
    : prevLatest;
  const anchor = passed && !lost && SHA.test(String(head)) ? { v: 1, commit: head, at: nowMs } : prevAnchor;
  return { latest, anchor, badge: ledgerBadge(latest, nowMs) };
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
  const file = (...p) => path.join(dir, ...p);
  if (cmd === 'anchor' && dir) {
    const anchor = readJson(file('verify', 'anchor.json'));
    const lost = anchorProblem(anchor, readJson(file('verify', 'latest.json')));
    if (lost) console.error(lost); // dziennik przebiegu; do raportu (latest.json) trafia przy publish
    console.log(anchorCommit(anchor) ?? '');
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
    const r = publishVerify({
      code: opt('code') ?? '',
      report,
      prevLatest: readJson(file('verify', 'latest.json')),
      prevAnchor: readJson(file('verify', 'anchor.json')),
      head: opt('head') ?? '',
      run: opt('run') ?? '',
      nowMs: Date.now(),
    });
    mkdirSync(file('verify'), { recursive: true });
    mkdirSync(file('badge'), { recursive: true });
    if (r.latest) writeFileSync(file('verify', 'latest.json'), `${JSON.stringify(r.latest, null, 2)}\n`, 'utf8');
    if (r.anchor) writeFileSync(file('verify', 'anchor.json'), `${JSON.stringify(r.anchor, null, 2)}\n`, 'utf8');
    writeFileSync(file('badge', 'ledger.json'), `${JSON.stringify(r.badge)}\n`, 'utf8');
    console.log(`${r.badge.message}`);
    return;
  }
  console.error('użycie: verify-status.mjs anchor <katalog> | publish <katalog> --code <kod> --report <plik> --head <commit> --run <url>');
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
