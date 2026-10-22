/**
 * Nadzór publicznych danych skanera (repo rdemb/hyperquant-data): świeżość, pokrycie open interest i strażnik prywatności.
 * Uruchamiany przez .github/workflows/data-health.yml co 30 min; wynik trafia do zgłoszenia z etykietą „alert-danych”.
 * Czyta wyłącznie publiczne pliki — nie potrzebuje żadnych kluczy ani dostępu do serwera.
 *
 * Wyjście: plik raportu (HEALTH_REPORT_FILE) i `ok=true|false` w GITHUB_OUTPUT; kod wyjścia ≠ 0 tylko przy błędzie skryptu.
 */
import { appendFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DATA_BASE = 'https://raw.githubusercontent.com/rdemb/hyperquant-data/main';
export const FILES = ['status.json', 'liq-map/BTC.json', 'liq-tape/BTC.json', 'cohorts/BTC.json', 'ledger/BTC/summary.json', 'liquidity/BTC.json', 'README.md'];
/** Pliki, których brak nie jest alarmem (nowsze niż część wdrożeń skanera) — gdy są, przechodzą strażnika prywatności */
export const OPTIONAL = new Set(['liq-tape/BTC.json', 'cohorts/BTC.json', 'ledger/BTC/summary.json', 'liquidity/BTC.json']);
/** Profil płynności arkusza (publikowany co 10 min) */
export const LIQUIDITY_MAX_AGE_MIN = 30;
/** Podsumowanie dziennika prognoz (prognozy co 15 min; pliki dziennika — gałąź `ledger`) */
export const LEDGER_MAX_AGE_MIN = 60;
export const LIMITS = {
  /** Publikacja co 2 min (+ do 5 min pamięci podręcznej CDN) — 30 min to jednoznaczna awaria */
  maxAgeMin: 30,
  /** Mediana wieku odczytów pozycji ważona nominałem */
  maxNtlAgeMin: 30,
  /** Udział open interest widziany przez skaner (typowo 25–35%) */
  minCoverage: 0.05,
};

const MIN = 60_000;
const LEAKS = [
  { name: 'adres portfela (0x…)', re: /0x[0-9a-fA-F]{40}/ },
  { name: 'adres IPv4', re: /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/ },
];

/** Nazwy wykrytych rodzajów wycieku — nigdy same wartości (raport jest publiczny). */
export function findLeaks(text) {
  return LEAKS.filter((l) => l.re.test(text)).map((l) => l.name);
}

const fmtMin = (m) => `${Math.round(m)} min`;
const fmtPct = (x) => `${(x * 100).toFixed(1)}%`;

function ageOf(file, json, nowMs) {
  const asOf = json && typeof json === 'object' ? json.asOf : undefined;
  if (typeof asOf !== 'number' || !Number.isFinite(asOf)) return { ok: false, problem: `${file}: brak poprawnego pola asOf` };
  return { ok: true, ageMin: (nowMs - asOf) / MIN };
}

/**
 * @param {{status: object|null, liqMap: object|null, raw: Record<string,string>, errors: Record<string,string>}} input
 * @returns {{ok: boolean, problems: string[], facts: {label: string, value: string}[]}}
 */
export function assessHealth(input, nowMs, limits = LIMITS) {
  const problems = [];
  const facts = [];
  for (const [file, err] of Object.entries(input.errors ?? {})) {
    if (OPTIONAL.has(file) && /HTTP 404/.test(err)) continue;
    problems.push(`${file}: nie udało się pobrać (${err})`);
  }

  for (const [file, json] of [
    ['status.json', input.status],
    ['liq-map/BTC.json', input.liqMap],
  ]) {
    if (json == null) continue; // błąd pobrania już zgłoszony
    const a = ageOf(file, json, nowMs);
    if (!a.ok) {
      problems.push(a.problem);
      continue;
    }
    facts.push({ label: `Wiek ${file}`, value: fmtMin(a.ageMin) });
    if (a.ageMin > limits.maxAgeMin) problems.push(`${file}: dane sprzed ${fmtMin(a.ageMin)} (próg ${limits.maxAgeMin} min) — skaner nie publikuje`);
  }

  if (input.ledger && typeof input.ledger === 'object') {
    const a = ageOf('dziennik (ledger/BTC/summary.json)', input.ledger, nowMs);
    if (!a.ok) problems.push(a.problem);
    else {
      facts.push({ label: 'Wiek dziennika prognoz', value: fmtMin(a.ageMin) });
      if (a.ageMin > LEDGER_MAX_AGE_MIN) problems.push(`dziennik prognoz: ostatnia aktualizacja ${fmtMin(a.ageMin)} temu (próg ${LEDGER_MAX_AGE_MIN} min)`);
    }
  }

  if (input.liquidity && typeof input.liquidity === 'object') {
    const a = ageOf('płynność (liquidity/BTC.json)', input.liquidity, nowMs);
    if (!a.ok) problems.push(a.problem);
    else {
      facts.push({ label: 'Wiek profilu płynności', value: fmtMin(a.ageMin) });
      if (a.ageMin > LIQUIDITY_MAX_AGE_MIN) problems.push(`profil płynności: ostatnia aktualizacja ${fmtMin(a.ageMin)} temu (próg ${LIQUIDITY_MAX_AGE_MIN} min)`);
    }
  }

  const s = input.status;
  if (s && typeof s === 'object') {
    if (typeof s.coverage === 'number') {
      facts.push({ label: 'Pokrycie OI', value: fmtPct(s.coverage) });
      if (s.coverage < limits.minCoverage) problems.push(`pokrycie open interest ${fmtPct(s.coverage)} < ${fmtPct(limits.minCoverage)} — skanowanie pozycji nie nadąża`);
    }
    if (typeof s.ageNtlP50Min === 'number') {
      facts.push({ label: 'Mediana wieku pozycji (ważona)', value: fmtMin(s.ageNtlP50Min) });
      if (s.ageNtlP50Min > limits.maxNtlAgeMin) problems.push(`odczyty pozycji opóźnione: mediana ważona ${fmtMin(s.ageNtlP50Min)} (próg ${limits.maxNtlAgeMin} min)`);
    }
    if (typeof s.positions === 'number') facts.push({ label: 'Pozycje / adresy', value: `${s.positions} / ${s.addresses ?? '—'}` });
    if (typeof s.apiErrors === 'number') facts.push({ label: 'Błędy API (od startu procesu)', value: String(s.apiErrors) });
  }

  for (const [file, text] of Object.entries(input.raw ?? {})) {
    const leaks = findLeaks(text);
    if (leaks.length) problems.push(`PRYWATNOŚĆ: ${file} zawiera ${leaks.join(' i ')} — natychmiast wstrzymaj publikację i sprawdź skaner`);
  }

  return { ok: problems.length === 0, problems, facts };
}

const utc = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** Raport Markdown do zgłoszenia (publiczny: bez adresów, ścieżek i danych serwera). */
export function renderReport(result, nowMs) {
  const lines = [result.ok ? `✅ **Dane skanera świeże** — sprawdzono ${utc(nowMs)}` : `⚠️ **Problem z danymi skanera** — sprawdzono ${utc(nowMs)}`, ''];
  if (!result.ok) {
    lines.push('**Wykryte problemy:**', ...result.problems.map((p) => `- ${p}`), '');
  }
  if (result.facts.length) {
    lines.push('| Miara | Wartość |', '|---|---|', ...result.facts.map((f) => `| ${f.label} | ${f.value} |`), '');
  }
  lines.push(`Źródło: ${DATA_BASE}`);
  if (!result.ok) {
    lines.push('', 'Diagnostyka: stan usługi `hyperquant-scanner` i jej dziennik (`journalctl -u hyperquant-scanner`) na serwerze skanera. Zgłoszenie zamknie się samo, gdy dane znów będą świeże.');
  }
  return `${lines.join('\n')}\n`;
}

async function fetchText(url, timeoutMs = 20_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const raw = {};
  const errors = {};
  const json = {};
  await Promise.all(
    FILES.map((f) => [f, `${DATA_BASE}/${f}`]).map(async ([file, url]) => {
      try {
        raw[file] = await fetchText(url);
        if (file.endsWith('.json')) json[file] = JSON.parse(raw[file]);
      } catch (e) {
        errors[file] = e instanceof Error ? e.message : String(e);
      }
    })
  );
  const now = Date.now();
  const result = assessHealth(
    { status: json['status.json'] ?? null, liqMap: json['liq-map/BTC.json'] ?? null, ledger: json['ledger/BTC/summary.json'] ?? null, liquidity: json['liquidity/BTC.json'] ?? null, raw, errors },
    now
  );
  const report = renderReport(result, now);
  console.log(report);
  if (process.env.HEALTH_REPORT_FILE) await writeFile(process.env.HEALTH_REPORT_FILE, report, 'utf8');
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `ok=${result.ok}\n`, 'utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
