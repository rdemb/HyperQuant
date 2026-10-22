/**
 * Niezależna weryfikacja dziennika prognoz HyperQuant — bez zaufania do serwera ani strony.
 *
 *   node scripts/verify-ledger.mjs                 # wszystkie dni z ostatnich 7 (pobrane z publicznego repo danych)
 *   node scripts/verify-ledger.mjs 2026-10-22      # od wskazanego dnia do dziś
 *   node scripts/verify-ledger.mjs --dir ./ledger  # lokalny klon gałęzi `ledger` (wszystkie pliki)
 *
 * Sprawdza łańcuch hashy (każda linia: hash = SHA-256 kanonicznego JSON z polem prev; prev = hash poprzedniej linii,
 * także między dniami) i przelicza wyniki z zapisanych prognoz i rozstrzygnięć. Kotwicę w Bitcoinie sprawdza klient
 * OpenTimestamps: `ots upgrade BTC/ots/<dzień>.jsonl.ots` i `ots verify -f BTC/<dzień>.jsonl BTC/ots/<dzień>.jsonl.ots`.
 * Implementacja celowo niezależna od kodu skanera (ten sam format, inny kod).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const LEDGER_BASE = 'https://raw.githubusercontent.com/rdemb/hyperquant-data/ledger';
export const GENESIS = '0'.repeat(64);

export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
    .join(',')}}`;
}

/** Weryfikacja linii od poprzednika; zwraca głowę albo pierwszą złą linię. */
export function verifyChain(lines, prev) {
  let expected = prev;
  for (let i = 0; i < lines.length; i++) {
    let o;
    try {
      o = JSON.parse(lines[i]);
    } catch {
      return { ok: false, head: expected, badLine: i, reason: 'niepoprawny JSON' };
    }
    const { hash, ...rest } = o;
    if (rest.prev !== expected) return { ok: false, head: expected, badLine: i, reason: 'prev nie wskazuje poprzedniej linii' };
    if (createHash('sha256').update(canonical(rest)).digest('hex') !== hash) return { ok: false, head: expected, badLine: i, reason: 'hash nie zgadza się z treścią' };
    expected = hash;
  }
  return { ok: true, head: expected, badLine: null, reason: null };
}

/** Przeliczenie podstawowych wyników z rekordów (średnie CRPS, pokrycie 90%, Brier). */
export function recompute(records) {
  const f = new Map();
  const r = new Map();
  for (const o of records) (o.k === 'f' ? f : r).set(o.id, o);
  const ret = {};
  let touchN = 0;
  let brierSum = 0;
  for (const [id, fc] of f) {
    const res = r.get(id);
    if (!res || res.void) continue;
    if (fc.kind === 'ret') {
      const s = (ret[fc.h] ??= { n: 0, crps: 0, crpsB: 0, in90: 0 });
      s.n++;
      s.crps += res.crps;
      s.crpsB += res.crpsB;
      s.in90 += res.in90;
    } else if (fc.kind === 'touch') {
      for (const l of ['pdh', 'pdl', 'deq']) {
        if (fc.p[l] === null) continue; // poziom już przekroczony przy wydaniu — nieoceniany
        brierSum += (fc.p[l] - res.yv[l]) ** 2;
        touchN++;
      }
    }
  }
  return {
    ret: Object.fromEntries(Object.entries(ret).map(([h, s]) => [h, { n: s.n, crps: s.crps / s.n, crpss: 1 - s.crps / s.crpsB, cov90: s.in90 / s.n }])),
    touch: { levels: touchN, brier: touchN ? brierSum / touchN : null },
    voided: [...r.values()].filter((x) => x.void).length,
  };
}

const days = (from, to) => {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

async function main() {
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf('--dir');
  const files = [];
  if (dirIdx >= 0) {
    const dir = path.resolve(args[dirIdx + 1], 'BTC');
    for (const f of readdirSync(dir).filter((x) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(x)).sort()) files.push([f, readFileSync(path.join(dir, f), 'utf8')]);
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const from = args[0] ?? new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    for (const d of days(from, today)) {
      const res = await fetch(`${LEDGER_BASE}/BTC/${d}.jsonl`, { cache: 'no-store' });
      if (res.ok) files.push([`${d}.jsonl`, await res.text()]);
    }
  }
  if (files.length === 0) {
    console.log('Brak plików dziennika do sprawdzenia.');
    process.exitCode = 1;
    return;
  }
  // Pierwszy plik zakotwiczamy w jego własnym prev (wcześniejsze dni można sprawdzić, podając wcześniejszą datę)
  let prev = JSON.parse(files[0][1].split('\n').find(Boolean)).prev;
  const records = [];
  for (const [name, text] of files) {
    const lines = text.split('\n').filter(Boolean);
    const v = verifyChain(lines, prev);
    console.log(`${v.ok ? '✓' : '✗'} ${name}: ${lines.length} linii${v.ok ? '' : ` — linia ${v.badLine + 1}: ${v.reason}`}`);
    if (!v.ok) {
      process.exitCode = 1;
      return;
    }
    prev = v.head;
    for (const l of lines) records.push(JSON.parse(l));
  }
  console.log(`Głowa łańcucha: ${prev}`);
  console.log('Wyniki przeliczone z rekordów:', JSON.stringify(recompute(records), null, 2));
  console.log('Kotwica w Bitcoinie: pobierz BTC/ots/<dzień>.jsonl.ots i uruchom `ots upgrade` oraz `ots verify -f <dzień>.jsonl <plik .ots>` (klient OpenTimestamps).');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
