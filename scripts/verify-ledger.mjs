/**
 * Niezależna weryfikacja dziennika prognoz HyperQuant — bez zaufania do serwera ani strony.
 *
 *   node scripts/verify-ledger.mjs --dir ./ledger [--bitcoin] [--market]   # pełna kontrola (zalecane):
 *       git clone -b ledger https://github.com/rdemb/hyperquant-data ledger
 *       --bitcoin: czas z bloków Bitcoina (poświadczenia OTS + nagłówki bloków); --market: ceny vs świece 1m HL
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

const SLOT_MS = 15 * 60_000;
const MIN_MS = 60_000;

/**
 * Kolejność i spójność rekordów w łańcuchu: unikalne prognozy, slot = slot chwili wydania, początek horyzontu = pełna
 * minuta po wydaniu, czasy niemalejące, rozstrzygnięcie nie przed końcem horyzontu, slot z prognozą albo skip — nie oba.
 */
export function checkOrdering(records) {
  const out = [];
  const f = new Map();
  const resolved = new Set();
  const skipped = [];
  let lastTime = -Infinity;
  for (const o of records) {
    if (o.k === 'f') {
      if (f.has(o.id)) out.push(`${o.id}: powtórzony identyfikator prognozy`);
      f.set(o.id, o);
      if (typeof o.ti === 'number') {
        if (o.slot !== Math.floor(o.ti / SLOT_MS) * SLOT_MS) out.push(`${o.id}: slot ${o.slot} nie jest slotem chwili wydania`);
        if (o.t !== Math.floor(o.ti / MIN_MS) * MIN_MS + MIN_MS) out.push(`${o.id}: początek horyzontu nie jest pełną minutą po wydaniu`);
        if (o.ti < lastTime) out.push(`${o.id}: czas cofnięty względem poprzedniego rekordu`);
        lastTime = Math.max(lastTime, o.ti);
      }
    } else if (o.k === 'r') {
      const fc = f.get(o.id);
      if (!fc) out.push(`${o.id}: rozstrzygnięcie bez wcześniejszej prognozy`);
      else if (typeof o.t === 'number' && o.t < fc.t + fc.h * MIN_MS) out.push(`${o.id}: rozstrzygnięcie przed końcem horyzontu`);
      if (resolved.has(o.id)) out.push(`${o.id}: powtórzone rozstrzygnięcie`);
      resolved.add(o.id);
      if (typeof o.t === 'number') {
        if (o.t < lastTime) out.push(`${o.id}: czas cofnięty względem poprzedniego rekordu`);
        lastTime = Math.max(lastTime, o.t);
      }
    } else if (o.k === 's') skipped.push([o.slot, o.until ?? o.slot]);
  }
  const fSlots = new Set([...f.values()].map((x) => x.slot));
  for (const [a, b] of skipped) for (const s of fSlots) if (s >= a && s <= b) out.push(`slot ${s}: jednocześnie prognoza i pominięcie`);
  return out;
}

/**
 * Pokwitowania slotów: dla każdego slotu z prognozą musi istnieć `.ots`, a jego skrót = hash ostatniej prognozy slotu.
 * `getReceipt(slot)` → bajty pliku albo null.
 */
export function checkReceipts(records, getReceipt) {
  const last = new Map();
  for (const o of records) if (o.k === 'f') last.set(o.slot, o.hash);
  const out = [];
  for (const [slot, hash] of last) {
    const bytes = getReceipt(slot);
    if (!bytes) {
      out.push(`slot ${new Date(slot).toISOString()}: brak pokwitowania`);
      continue;
    }
    if (otsDigestHex(bytes) !== hash) out.push(`slot ${new Date(slot).toISOString()}: skrót pokwitowania ≠ hash ostatniej prognozy slotu`);
  }
  return out;
}

const PENDING = Buffer.from('83dfe30d2ef90c8e', 'hex');
const BITCOIN = Buffer.from('0588960d73d71901', 'hex');

class R {
  constructor(b, i = 0) {
    this.b = b;
    this.i = i;
  }
  byte() {
    if (this.i >= this.b.length) throw new Error('koniec danych OTS');
    return this.b[this.i++];
  }
  bytes(n) {
    if (this.i + n > this.b.length) throw new Error('koniec danych OTS');
    const o = this.b.subarray(this.i, this.i + n);
    this.i += n;
    return o;
  }
  varuint() {
    let v = 0;
    let m = 1;
    for (;;) {
      const x = this.byte();
      v += (x & 0x7f) * m;
      if (!(x & 0x80)) return v;
      m *= 128;
    }
  }
  varbytes() {
    return this.bytes(this.varuint());
  }
}

const UNARY = {
  0x02: (m) => createHash('sha1').update(m).digest(),
  0x03: (m) => createHash('ripemd160').update(m).digest(),
  0x08: (m) => createHash('sha256').update(m).digest(),
  0xf2: (m) => Buffer.from(m).reverse(),
  0xf3: (m) => Buffer.from(m.toString('hex'), 'ascii'),
};

/**
 * Przechodzi drzewo znacznika od wiadomości `msg`, stosując operacje (SHA-256, SHA-1, RIPEMD-160, append, prepend,
 * reverse, hexlify); zwraca poświadczenia z wiadomością w ich węźle. Operacja nieobsługiwana (np. Keccak) → gałąź bez
 * wiadomości (msg = null), struktura nadal czytana.
 */
function walk(r, msg, out) {
  for (;;) {
    let tag = r.byte();
    const more = tag === 0xff;
    if (more) tag = r.byte();
    const hex = msg ? msg.toString('hex') : null;
    if (tag === 0x00) {
      const t = Buffer.from(r.bytes(8));
      const payload = new R(Buffer.from(r.varbytes()));
      if (t.equals(PENDING)) out.push({ kind: 'pending', uri: payload.varbytes().toString('utf8'), msg: hex });
      else if (t.equals(BITCOIN)) out.push({ kind: 'bitcoin', height: payload.varuint(), msg: hex });
    } else if (tag === 0xf0 || tag === 0xf1) {
      const arg = Buffer.from(r.varbytes());
      walk(r, msg ? (tag === 0xf0 ? Buffer.concat([msg, arg]) : Buffer.concat([arg, msg])) : null, out);
    } else if (UNARY[tag]) {
      walk(r, msg ? UNARY[tag](msg) : null, out);
    } else if (tag === 0x67) {
      walk(r, null, out); // Keccak-256 — brak w bibliotece standardowej; gałąź pominięta przy weryfikacji
    } else throw new Error(`nieznany znacznik OTS 0x${tag.toString(16)}`);
    if (!more) return;
  }
}

/** Poświadczenia z pliku `.ots` (oczekujące — adres kalendarza; Bitcoin — wysokość bloku) z wiadomością w węźle. */
export function otsAttestations(bytes) {
  const b = Buffer.from(bytes);
  const hex = otsDigestHex(b);
  if (!hex) return [];
  const out = [];
  walk(new R(b, OTS_MAGIC.length + 34), Buffer.from(hex, 'hex'), out);
  return out;
}

/**
 * Ceny źródłowe rozstrzygnięć zgodne ze świecami 1m: zwrot — zamknięcia w t i t + h; dotknięcia — max/min w oknie.
 * `candles` — tablica { time, high, low, close } (czas otwarcia, ms).
 */
export function checkMarket(records, candles) {
  const byTime = new Map(candles.map((c) => [c.time, c]));
  const f = new Map(records.filter((o) => o.k === 'f').map((o) => [o.id, o]));
  const out = [];
  for (const r of records) {
    if (r.k !== 'r' || r.void) continue;
    const fc = f.get(r.id);
    if (!fc) continue;
    if (fc.kind === 'ret' && typeof r.c0 === 'number') {
      const a = byTime.get(fc.t - MIN_MS);
      const b = byTime.get(fc.t + fc.h * MIN_MS - MIN_MS);
      if (!a || !b) continue; // poza zakresem pobranych świec
      if (a.close !== r.c0 || b.close !== r.c1) out.push(`${r.id}: ceny ${r.c0}/${r.c1} ≠ świece ${a.close}/${b.close}`);
    } else if (fc.kind === 'touch' && typeof r.hi === 'number') {
      const win = candles.filter((c) => c.time >= fc.t && c.time + MIN_MS <= fc.t + fc.h * MIN_MS);
      if (win.length < fc.h) continue;
      const hi = Math.max(...win.map((c) => c.high));
      const lo = Math.min(...win.map((c) => c.low));
      if (hi !== r.hi || lo !== r.lo) out.push(`${r.id}: max/min ${r.hi}/${r.lo} ≠ świece ${hi}/${lo}`);
    }
  }
  return out;
}

/** Wysokość bloku → { hash, czas, korzeń Merkle } (publiczny eksplorator; ten sam wynik da każdy węzeł Bitcoina). */
async function bitcoinBlock(height) {
  const hash = (await (await fetch(`https://mempool.space/api/block-height/${height}`)).text()).trim();
  const b = await (await fetch(`https://mempool.space/api/block/${hash}`)).json();
  return { hash, time: b.timestamp * 1000, merkleRoot: b.merkle_root };
}

/** Czas zakotwiczenia w Bitcoinie (ms) dla pliku .ots: poświadczenia z pliku i — dla oczekujących — z kalendarza; null = brak. */
export async function bitcoinTime(bytes) {
  const atts = otsAttestations(bytes);
  const btc = atts.filter((a) => a.kind === 'bitcoin');
  for (const p of atts.filter((a) => a.kind === 'pending' && a.msg)) {
    try {
      const res = await fetch(`${p.uri}/timestamp/${p.msg}`, { headers: { Accept: 'application/vnd.opentimestamps.v1' } });
      if (!res.ok) continue;
      const out = [];
      walk(new R(Buffer.from(await res.arrayBuffer())), Buffer.from(p.msg, 'hex'), out);
      btc.push(...out.filter((a) => a.kind === 'bitcoin'));
    } catch {
      // kalendarz niedostępny — próbujemy pozostałe
    }
  }
  let best = null;
  for (const a of btc) {
    if (!a.msg) continue;
    try {
      const blk = await bitcoinBlock(a.height);
      // Wiadomość w węźle poświadczenia = korzeń Merkle bloku (kolejność bajtów odwrócona względem zapisu w eksploratorze)
      if (Buffer.from(a.msg, 'hex').reverse().toString('hex') !== blk.merkleRoot) continue;
      if (best === null || blk.time < best) best = blk.time;
    } catch {
      // eksplorator niedostępny
    }
  }
  return best;
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
  const order = checkOrdering(records);
  console.log(order.length ? `✗ kolejność / spójność (${order.length}): ${order.slice(0, 5).join('; ')}` : '✓ kolejność i spójność rekordów');
  if (order.length) ok = false;
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
    }
    // Pokwitowania wymagane dla każdego slotu z prognozą (brak = problem, nie „0 zgodnych”)
    const receiptPath = (slot) => path.join(otsDir, 'slots', new Date(slot).toISOString().slice(0, 10), `${slot}.ots`);
    const getReceipt = (slot) => (existsSync(receiptPath(slot)) ? readFileSync(receiptPath(slot)) : null);
    const rec = checkReceipts(records, getReceipt);
    slots = lastHashBySlot.size - rec.length;
    console.log(rec.length ? `✗ pokwitowania slotów (${rec.length}): ${rec.slice(0, 5).join('; ')}` : `✓ pokwitowania slotów: ${slots}/${lastHashBySlot.size}`);
    if (rec.length) ok = false;
    console.log(`✓ kotwice dni zgodne: ${daily}`);

    if (args.includes('--bitcoin')) {
      // Czas z Bitcoina: poświadczenie (z pliku albo uzupełnione z kalendarza) → nagłówek bloku → czas; prognoza jest
      // dowiedziona blokiem, gdy blok jest wcześniejszy niż koniec jej horyzontu. Dla 1 h blok często przychodzi później —
      // wtedy dowodem przed faktem są kalendarze (niezależni operatorzy), a blok potwierdza je później.
      const bySlot = new Map();
      for (const o of records) if (o.k === 'f') bySlot.set(o.slot, [...(bySlot.get(o.slot) ?? []), o]);
      const stat = {};
      for (const [slot, fs] of bySlot) {
        const bytes = getReceipt(slot);
        if (!bytes) continue;
        const bt = await bitcoinTime(bytes);
        for (const fc of fs) {
          const s = (stat[fc.h] ??= { n: 0, proven: 0, late: 0, pending: 0 });
          s.n++;
          if (bt === null) s.pending++;
          else if (bt <= fc.t + fc.h * MIN_MS) s.proven++;
          else s.late++;
        }
      }
      for (const [h, s] of Object.entries(stat)) {
        console.log(
          `ℹ horyzont ${h} min (${s.n}): blok Bitcoina przed rozstrzygnięciem ${s.proven}; blok po rozstrzygnięciu ${s.late} ` +
            `(przed faktem — tylko kalendarze OTS, zaufanie do ich operatorów); jeszcze bez bloku ${s.pending}`
        );
      }
    }
    if (args.includes('--market')) {
      // Ceny źródłowe vs publiczne świece 1m Hyperliquid (API udostępnia ok. 3.5 doby wstecz)
      const since = Date.now() - 3.4 * 86_400_000;
      const res = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'candleSnapshot', req: { coin: 'BTC', interval: '1m', startTime: since } }),
      });
      const raw = await res.json();
      const candles = (Array.isArray(raw) ? raw : []).map((c) => ({ time: c.t, high: Number(c.h), low: Number(c.l), close: Number(c.c) }));
      const mk = checkMarket(records, candles);
      console.log(mk.length ? `✗ ceny źródłowe niezgodne ze świecami (${mk.length}): ${mk.slice(0, 5).join('; ')}` : `✓ ceny źródłowe zgodne ze świecami 1m (ostatnie ~3.4 doby)`);
      if (mk.length) ok = false;
    }
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
