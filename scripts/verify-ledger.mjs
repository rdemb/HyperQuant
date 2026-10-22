/**
 * Niezależna weryfikacja dziennika prognoz HyperQuant — bez zaufania do serwera ani strony.
 *
 *   node scripts/verify-ledger.mjs --dir ./ledger   # lokalny klon gałęzi `ledger` (pełna kontrola — zalecane):
 *       git clone -b ledger https://github.com/rdemb/hyperquant-data ledger
 *   node scripts/verify-ledger.mjs [RRRR-MM-DD]     # szybka kontrola ostatnich dni pobranych z GitHuba
 *
 * Sprawdza:
 *  1. łańcuch hashy: każda linia w postaci kanonicznej, hash = SHA-256 kanonicznego JSON z polem prev, prev = hash
 *     poprzedniej linii (także między dniami); w trybie --dir od GENESIS;
 *  2. wyniki: CRPS, PIT i pokrycia przeliczone z zapisanych kwantyli i zwrotu (nie przepisane z zapisu);
 *  3. historię git (--dir): każdy commit tylko dopisuje do plików dziennika;
 *  4. pokwitowania OpenTimestamps: skrót w `ots/<dzień>.jsonl.ots` = SHA-256 pliku dnia; w `ots/slots/<slot>.ots`
 *     = hash ostatniej prognozy tego slotu (prognozy istniały w chwili znakowania). Sam czas potwierdza klient OTS:
 *     `ots upgrade <plik>.ots` i `ots verify -f <plik danych> <plik>.ots` (dla slotu: skrót podaj przez `-d <hash>`).
 * Implementacja celowo niezależna od kodu skanera (ten sam format, inny kod).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const LEDGER_BASE = 'https://raw.githubusercontent.com/rdemb/hyperquant-data/ledger';
export const SUMMARY_URL = 'https://raw.githubusercontent.com/rdemb/hyperquant-data/main/ledger/BTC/summary.json';
export const GENESIS = '0'.repeat(64);
const OTS_MAGIC = Buffer.concat([Buffer.from([0]), Buffer.from('OpenTimestamps'), Buffer.from([0, 0]), Buffer.from('Proof'), Buffer.from([0, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94])]);

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
    if (canonical(o) !== lines[i]) return { ok: false, head: expected, badLine: i, reason: 'linia nie jest w postaci kanonicznej' };
    const { hash, ...rest } = o;
    if (rest.prev !== expected) return { ok: false, head: expected, badLine: i, reason: 'prev nie wskazuje poprzedniej linii' };
    if (createHash('sha256').update(canonical(rest)).digest('hex') !== hash) return { ok: false, head: expected, badLine: i, reason: 'hash nie zgadza się z treścią' };
    expected = hash;
  }
  return { ok: true, head: expected, badLine: null, reason: null };
}

const pinball = (q, y, t) => (y >= q ? t * (y - q) : (1 - t) * (q - y));
function crps(taus, qs, y) {
  let s = 0;
  for (let i = 1; i < taus.length; i++) s += ((pinball(qs[i - 1], y, taus[i - 1]) + pinball(qs[i], y, taus[i])) / 2) * (taus[i] - taus[i - 1]);
  return 2 * s;
}
function quantileAt(taus, qs, tau) {
  if (tau <= taus[0]) return qs[0];
  const last = taus.length - 1;
  if (tau >= taus[last]) return qs[last];
  let i = 1;
  while (taus[i] < tau) i++;
  return qs[i - 1] + ((tau - taus[i - 1]) / (taus[i] - taus[i - 1])) * (qs[i] - qs[i - 1]);
}

/** Rozbieżności między zapisanymi a przeliczonymi wynikami (CRPS, pokrycie 90% i 60%) — pusta lista = zgodne. */
export function checkResolutions(records) {
  const f = new Map(records.filter((o) => o.k === 'f').map((o) => [o.id, o]));
  const out = [];
  for (const r of records) {
    if (r.k !== 'r' || r.void || typeof r.y !== 'number') continue;
    const fc = f.get(r.id);
    if (!fc || fc.kind !== 'ret') continue;
    const c = crps(fc.taus, fc.q, r.y);
    if (typeof r.crps === 'number' && Math.abs(c - r.crps) > 2e-6) out.push(`${r.id}: CRPS ${r.crps} ≠ przeliczony ${c.toFixed(6)}`);
    for (const [key, lo, hi] of [
      ['in90', 0.05, 0.95],
      ['in60', 0.2, 0.8],
    ]) {
      if (typeof r[key] !== 'number') continue;
      const inside = r.y >= quantileAt(fc.taus, fc.q, lo) && r.y <= quantileAt(fc.taus, fc.q, hi) ? 1 : 0;
      if (inside !== r[key]) out.push(`${r.id}: ${key} = ${r[key]} ≠ przeliczone ${inside}`);
    }
  }
  return out;
}

/** Skrót (hex) zakotwiczony w pliku .ots — nagłówek, wersja 1, operacja SHA-256; inny format → null. */
export function otsDigestHex(bytes) {
  const b = Buffer.from(bytes);
  if (b.length < OTS_MAGIC.length + 2 + 32 || !b.subarray(0, OTS_MAGIC.length).equals(OTS_MAGIC)) return null;
  if (b[OTS_MAGIC.length] !== 1 || b[OTS_MAGIC.length + 1] !== 0x08) return null;
  return b.subarray(OTS_MAGIC.length + 2, OTS_MAGIC.length + 34).toString('hex');
}

/** Wyniki opisowe przeliczone z rekordów. */
export function recompute(records) {
  const f = new Map();
  const r = new Map();
  for (const o of records) {
    if (o.k === 'f') f.set(o.id, o);
    else if (o.k === 'r') r.set(o.id, o);
  }
  const ret = {};
  let touchN = 0;
  let brierSum = 0;
  for (const [id, fc] of f) {
    const res = r.get(id);
    if (!res || res.void) continue;
    if (fc.kind === 'ret') {
      const s = (ret[fc.h] ??= { n: 0, crps: 0, crpsB: 0, in90: 0 });
      s.n++;
      s.crps += crps(fc.taus, fc.q, res.y);
      s.crpsB += crps(fc.taus, fc.bq, res.y);
      s.in90 += res.y >= quantileAt(fc.taus, fc.q, 0.05) && res.y <= quantileAt(fc.taus, fc.q, 0.95) ? 1 : 0;
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
    skipped: records.filter((o) => o.k === 's').length,
  };
}

const days = (from, to) => {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

/** Historia git (--dir): każdy kolejny commit tylko dopisuje do istniejących plików dziennika. */
function checkGitAppendOnly(dir) {
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const commits = git('log', '--format=%H', '--reverse').split('\n').filter(Boolean);
  const problems = [];
  for (let i = 1; i < commits.length; i++) {
    const files = git('ls-tree', '-r', '--name-only', commits[i - 1]).split('\n').filter((f) => f.endsWith('.jsonl'));
    for (const f of files) {
      const before = git('show', `${commits[i - 1]}:${f}`);
      let after;
      try {
        after = git('show', `${commits[i]}:${f}`);
      } catch {
        problems.push(`${commits[i].slice(0, 10)}: usunięto ${f}`);
        continue;
      }
      if (!after.startsWith(before)) problems.push(`${commits[i].slice(0, 10)}: zmieniono zapisane linie w ${f}`);
    }
  }
  return { commits: commits.length, problems };
}

async function main() {
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf('--dir');
  const local = dirIdx >= 0 ? path.resolve(args[dirIdx + 1]) : null;
  const files = [];
  if (local) {
    const dir = path.join(local, 'BTC');
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
  const first = JSON.parse(files[0][1].split('\n').find(Boolean));
  // Pełny klon: łańcuch musi zaczynać się od GENESIS; tryb sieciowy (ostatnie dni) — od własnego prev pierwszego pliku
  let prev = local ? GENESIS : first.prev;
  const records = [];
  let ok = true;
  for (const [name, text] of files) {
    const lines = text.split('\n').filter(Boolean);
    const v = verifyChain(lines, prev);
    console.log(`${v.ok ? '✓' : '✗'} ${name}: ${lines.length} linii${v.ok ? '' : ` — linia ${v.badLine + 1}: ${v.reason}`}`);
    if (!v.ok) {
      ok = false;
      break;
    }
    prev = v.head;
    for (const l of lines) records.push(JSON.parse(l));
  }
  const mismatch = checkResolutions(records);
  console.log(mismatch.length ? `✗ wyniki niezgodne z przeliczonymi (${mismatch.length}): ${mismatch.slice(0, 5).join('; ')}` : '✓ wyniki zgodne z przeliczonymi z kwantyli');
  if (mismatch.length) ok = false;
  console.log(`Głowa łańcucha: ${prev}`);

  if (local) {
    if (existsSync(path.join(local, '.git'))) {
      const g = checkGitAppendOnly(local);
      console.log(g.problems.length ? `✗ historia git: ${g.problems.slice(0, 5).join('; ')}` : `✓ historia git: ${g.commits} commitów, tylko dopisywanie`);
      if (g.problems.length) ok = false;
    }
    const otsDir = path.join(local, 'BTC', 'ots');
    let daily = 0;
    let slots = 0;
    const lastHashBySlot = new Map();
    for (const o of records) if (o.k === 'f') lastHashBySlot.set(o.slot, o.hash);
    if (existsSync(otsDir)) {
      for (const f of readdirSync(otsDir).filter((x) => x.endsWith('.jsonl.ots'))) {
        const day = f.replace('.ots', '');
        const dataPath = path.join(local, 'BTC', day);
        if (!existsSync(dataPath)) continue;
        const want = createHash('sha256').update(readFileSync(dataPath)).digest('hex');
        if (otsDigestHex(readFileSync(path.join(otsDir, f))) !== want) {
          console.log(`✗ kotwica ${f}: skrót nie zgadza się z plikiem dnia`);
          ok = false;
        } else daily++;
      }
      const sd = path.join(otsDir, 'slots');
      if (existsSync(sd)) {
        for (const f of readdirSync(sd).filter((x) => x.endsWith('.ots'))) {
          const slot = Number(f.replace('.ots', ''));
          const want = lastHashBySlot.get(slot);
          if (want && otsDigestHex(readFileSync(path.join(sd, f))) !== want) {
            console.log(`✗ pokwitowanie slotu ${f}: skrót nie jest hashem ostatniej prognozy slotu`);
            ok = false;
          } else if (want) slots++;
        }
      }
    }
    console.log(`✓ kotwice dni zgodne: ${daily}; pokwitowania slotów zgodne: ${slots} (czas potwierdza klient OpenTimestamps: ots upgrade / ots verify)`);
  } else {
    try {
      const s = await (await fetch(SUMMARY_URL, { cache: 'no-store' })).json();
      console.log(s?.head?.hash === prev ? '✓ głowa zgodna z podsumowaniem na stronie' : `ℹ podsumowanie wskazuje inną głowę (${String(s?.head?.hash).slice(0, 12)}…) — mogło zostać opublikowane przed/po ostatnim dopisaniu`);
    } catch {
      // brak podsumowania — nie wpływa na wynik
    }
  }
  console.log('Wyniki przeliczone z rekordów:', JSON.stringify(recompute(records), null, 2));
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
