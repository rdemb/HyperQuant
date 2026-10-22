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

const r6 = (x) => Math.round(x * 1e6) / 1e6;
/** „Blisko progu” rynku HIP-4 (względnie, 5 bp) — jak w skanerze */
const MKT_NEAR = 0.0005;
/** Płynność notowania jak w skanerze: spread ≤ 5 pp i ≥ 50 USDC w ±5 pp od środka po obu stronach */
const MKT_MAX_SPREAD = 0.05;
const MKT_MIN_DEPTH = 50;
const SLOT_LEN_MS = 15 * 60_000;

/** Niezmienniki rekordu „model vs rynek” (niezależnie od rozstrzygnięcia) — lista problemów. */
function mktRecordProblems(fc) {
  const out = [];
  if (fc.t + fc.h * 60_000 !== fc.expiry) out.push(`${fc.id}: t + h ≠ termin rynku`);
  if (fc.expiry !== fc.slot + SLOT_LEN_MS) out.push(`${fc.id}: termin rynku ≠ koniec slotu`);
  if (!(fc.p >= 0 && fc.p <= 1)) out.push(`${fc.id}: p poza [0, 1]`);
  if (fc.bid !== null && fc.ask !== null && !(fc.bid <= fc.ask)) out.push(`${fc.id}: bid > ask`);
  if (typeof fc.depthBid === 'number' || typeof fc.depthAsk === 'number') {
    const liquid =
      fc.bid !== null && fc.ask !== null && fc.ask - fc.bid <= MKT_MAX_SPREAD + 1e-12 && fc.depthBid >= MKT_MIN_DEPTH && fc.depthAsk >= MKT_MIN_DEPTH;
    if (liquid !== fc.liquid) out.push(`${fc.id}: liquid = ${fc.liquid} ≠ przeliczone ze spreadu i głębokości ${liquid}`);
  }
  return out;
}

/** Wynik dotknięć z max/min okna (ta sama reguła co w skanerze: D-EQ od strony ceny przy wydaniu). */
function touchOutcome(fc, hi, lo) {
  const deqBelow = fc.lv.deq <= fc.px0;
  return { pdh: hi >= fc.lv.pdh ? 1 : 0, pdl: lo <= fc.lv.pdl ? 1 : 0, deq: (deqBelow ? lo <= fc.lv.deq : hi >= fc.lv.deq) ? 1 : 0 };
}

/**
 * Rozbieżności między zapisanymi a przeliczonymi wynikami — pusta lista = zgodne. Wynik musi wynikać z cen źródłowych
 * (zwrot: y = ln(c1/c0); dotknięcia: yv z max/min okna), a te sprawdza z rynkiem `checkMarket` (--market).
 */
export function checkResolutions(records) {
  const f = new Map(records.filter((o) => o.k === 'f').map((o) => [o.id, o]));
  const out = [];
  for (const r of records) {
    if (r.k !== 'r' || r.void) continue;
    const fc = f.get(r.id);
    if (!fc) continue;
    if (fc.kind === 'mkt') {
      out.push(...mktRecordProblems(fc));
      if (!(r.c1 > 0)) {
        out.push(`${r.id}: brak cen źródłowych (c1)`);
        continue;
      }
      const y = r.c1 >= fc.K ? 1 : 0;
      const near = Math.abs(r.c1 - fc.K) <= MKT_NEAR * fc.K ? 1 : 0;
      if (r.y !== y) out.push(`${r.id}: y = ${r.y} ≠ [c1 ≥ K] = ${y}`);
      if (r.near !== near) out.push(`${r.id}: near = ${r.near} ≠ przeliczone ${near}`);
      continue;
    }
    if (fc.kind === 'touch') {
      if (!(typeof r.hi === 'number' && typeof r.lo === 'number')) {
        out.push(`${r.id}: brak cen źródłowych (hi/lo)`);
        continue;
      }
      const want = touchOutcome(fc, r.hi, r.lo);
      for (const l of ['pdh', 'pdl', 'deq']) if (r.yv?.[l] !== want[l]) out.push(`${r.id}: yv.${l} = ${r.yv?.[l]} ≠ z max/min okna ${want[l]}`);
      continue;
    }
    if (fc.kind !== 'ret') continue;
    if (!(r.c0 > 0 && r.c1 > 0)) {
      out.push(`${r.id}: brak cen źródłowych (c0/c1)`);
      continue;
    }
    const y = r6(Math.log(r.c1 / r.c0));
    if (typeof r.y !== 'number' || Math.abs(y - r.y) > 1e-9) {
      out.push(`${r.id}: y = ${r.y} ≠ ln(c1/c0) = ${y}`);
      continue;
    }
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
/** Unieważnienie (brak danych) dopuszczalne dopiero 6 h po końcu horyzontu — jak w skanerze */
const VOID_MS = 6 * 60 * MIN_MS;
/**
 * Zapas na swobodę znacznika czasu bloku Bitcoina: znacznik musi być tylko większy od mediany 11 poprzednich bloków,
 * więc bywa do ~1–2 h wcześniejszy niż faktyczne wydobycie. Blok liczy się jako dowód przed faktem z tym zapasem.
 */
const BLOCK_TIME_MARGIN_MS = 2 * 60 * MIN_MS;

/**
 * Kolejność i spójność rekordów w łańcuchu: unikalne prognozy, slot = slot chwili wydania, początek horyzontu = pełna
 * minuta po wydaniu, czasy niemalejące, rozstrzygnięcie nie przed końcem horyzontu, slot z prognozą albo skip — nie oba.
 */
export function checkOrdering(records, opts = {}) {
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
      // Tryb szybki (ostatnie dni): prognoza mogła paść przed pierwszym pobranym dniem
      const before = opts.since !== undefined && Number(String(o.id).split('-')[0]) < opts.since;
      if (!fc && !before) out.push(`${o.id}: rozstrzygnięcie bez wcześniejszej prognozy`);
      else if (fc && typeof o.t === 'number' && o.t < fc.t + fc.h * MIN_MS) out.push(`${o.id}: rozstrzygnięcie przed końcem horyzontu`);
      else if (fc && o.void && !(o.t >= fc.t + fc.h * MIN_MS + VOID_MS)) out.push(`${o.id}: unieważnienie przed upływem 6 h po horyzoncie`);
      if (resolved.has(o.id)) out.push(`${o.id}: powtórzone rozstrzygnięcie`);
      resolved.add(o.id);
      if (typeof o.t === 'number') {
        if (o.t < lastTime) out.push(`${o.id}: czas cofnięty względem poprzedniego rekordu`);
        lastTime = Math.max(lastTime, o.t);
      }
    } else if (o.k === 's') skipped.push([o.slot, o.until ?? o.slot]);
    else if (o.k === 'p' && typeof o.t === 'number') {
      // Prerejestracja: czas nie może się cofać względem wcześniejszych zapisów (od niego liczy się ocena do przodu)
      if (o.t < lastTime) out.push(`prerejestracja ${o.id}: czas cofnięty względem poprzedniego rekordu`);
      lastTime = Math.max(lastTime, o.t);
    }
  }
  const fSlots = new Set([...f.values()].map((x) => x.slot));
  for (const [a, b] of skipped) for (const s of fSlots) if (s >= a && s <= b) out.push(`slot ${s}: jednocześnie prognoza i pominięcie`);
  return out;
}

/**
 * Prerejestracje katalogów (laboratorium folkloru, rekordy `k: 'p'`): `catalogHash` = SHA-256 kanonicznego JSON
 * zapisanego katalogu, czasy niemalejące. Łańcuch hashy i pokwitowania OTS dowodzą, że katalog istniał przed oceną.
 */
export function checkPreregs(records) {
  const problems = [];
  const preregs = [];
  let last = -Infinity;
  for (const o of records) {
    if (o.k !== 'p') continue;
    const id = String(o.id);
    if (!o.catalog || typeof o.catalog !== 'object') problems.push(`${id}: brak katalogu w rekordzie prerejestracji`);
    else if (createHash('sha256').update(canonical(o.catalog)).digest('hex') !== o.catalogHash) problems.push(`${id}: hash katalogu nie zgadza się z treścią`);
    if (typeof o.t !== 'number') problems.push(`${id}: brak czasu prerejestracji`);
    else {
      if (o.t < last) problems.push(`${id}: czas cofnięty względem poprzedniej prerejestracji`);
      last = Math.max(last, o.t);
    }
    preregs.push({ id, t: o.t, catalogHash: o.catalogHash });
  }
  return { problems, preregs };
}

/**
 * Ensemble model + rynek (rekordy mkt z polami `pe` i `ens`): p_e = σ(a + bm·logit p + bk·logit środek) z zapisanych wag
 * (logit z obcięciem do [1e-4, 1 − 1e-4], zaokrąglenie do 4 miejsc); przy pełnym dzienniku (`full`) także `ens.n` ≤ liczba
 * par (wąski spread, z dala od progu) rozstrzygniętych przed wydaniem — wagi nie mogły użyć przyszłych wyników.
 */
export function checkEnsemble(records, { full = false } = {}) {
  const fcs = new Map();
  const res = new Map();
  for (const o of records) {
    if (o.k === 'f' && o.kind === 'mkt') fcs.set(o.id, o);
    else if (o.k === 'r') res.set(o.id, o);
  }
  const resolvedAt = [];
  for (const [id, fc] of fcs) {
    const r = res.get(id);
    if (r && r.near === 0 && (r.y === 0 || r.y === 1) && fc.bid !== null && fc.ask !== null && fc.ask - fc.bid <= MKT_MAX_SPREAD + 1e-12) resolvedAt.push(r.t);
  }
  const logit = (p) => {
    const q = Math.min(1 - 1e-4, Math.max(1e-4, p));
    return Math.log(q / (1 - q));
  };
  const problems = [];
  let checked = 0;
  for (const fc of fcs.values()) {
    if (fc.pe === undefined) continue; // rekordy sprzed ensemble
    const e = fc.ens;
    if (!e || ![e.a, e.bm, e.bk, e.n].every(Number.isFinite)) {
      problems.push(`${fc.id}: brak wag ensemble`);
      continue;
    }
    if (full) {
      const before = resolvedAt.filter((t) => t < fc.ti).length;
      if (e.n > before) problems.push(`${fc.id}: wagi ensemble z ${e.n} par, a przed wydaniem rozstrzygnięto ${before}`);
    }
    if (fc.bid === null || fc.ask === null) {
      if (fc.pe !== null) problems.push(`${fc.id}: p_e bez notowania rynku`);
      continue;
    }
    const z = e.a + e.bm * logit(fc.p) + e.bk * logit((fc.bid + fc.ask) / 2);
    const want = Math.round((1 / (1 + Math.exp(-z))) * 1e4) / 1e4;
    if (!(Math.abs(want - fc.pe) <= 1e-4 + 1e-12)) problems.push(`${fc.id}: p_e ${fc.pe} ≠ ${want} ze wzoru i zapisanych wag`);
    else checked++;
  }
  return { problems, checked };
}

/** Partia slotu: prognozy główne ('') i „model vs rynek” ('m', wydawane później w slocie — osobne pokwitowanie). */
export const batchOf = (o) => (o.kind === 'mkt' ? 'm' : '');

/**
 * Pokwitowania slotów: dla każdej partii slotu z prognozą musi istnieć `.ots`, a jego skrót = hash ostatniej prognozy
 * partii. `getReceipt(slot, batch)` → bajty pliku albo null.
 */
export function checkReceipts(records, getReceipt) {
  const last = new Map();
  for (const o of records) if (o.k === 'f') last.set(`${o.slot}|${batchOf(o)}`, { slot: o.slot, batch: batchOf(o), hash: o.hash });
  const out = [];
  for (const { slot, batch, hash } of last.values()) {
    const name = `slot ${new Date(slot).toISOString()}${batch ? ` (partia ${batch})` : ''}`;
    const bytes = getReceipt(slot, batch);
    if (!bytes) {
      out.push(`${name}: brak pokwitowania`);
      continue;
    }
    if (otsDigestHex(bytes) !== hash) out.push(`${name}: skrót pokwitowania ≠ hash ostatniej prognozy partii`);
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
  const problems = [];
  let checked = 0;
  let eligible = 0;
  for (const r of records) {
    if (r.k !== 'r') continue;
    const fc = f.get(r.id);
    if (!fc || (fc.kind !== 'ret' && fc.kind !== 'touch' && fc.kind !== 'mkt')) continue;
    eligible++;
    let market = null; // ceny z rynku albo null, gdy poza zakresem pobranych świec
    if (fc.kind === 'ret') {
      const a = byTime.get(fc.t - MIN_MS);
      const b = byTime.get(fc.t + fc.h * MIN_MS - MIN_MS);
      if (a && b) market = { c0: a.close, c1: b.close };
    } else if (fc.kind === 'mkt') {
      const b = byTime.get(fc.t + fc.h * MIN_MS - MIN_MS);
      if (b) market = { c1: b.close };
    } else {
      const win = candles.filter((c) => c.time >= fc.t && c.time + MIN_MS <= fc.t + fc.h * MIN_MS);
      if (win.length >= fc.h) market = { hi: Math.max(...win.map((c) => c.high)), lo: Math.min(...win.map((c) => c.low)) };
    }
    if (!market) continue;
    checked++;
    if (r.void) problems.push(`${r.id}: unieważnione mimo kompletu świec rynku`);
    else if (fc.kind === 'ret' && (market.c0 !== r.c0 || market.c1 !== r.c1)) problems.push(`${r.id}: ceny ${r.c0}/${r.c1} ≠ świece ${market.c0}/${market.c1}`);
    else if (fc.kind === 'mkt' && market.c1 !== r.c1) problems.push(`${r.id}: cena ${r.c1} ≠ świeca ${market.c1}`);
    else if (fc.kind === 'touch' && (market.hi !== r.hi || market.lo !== r.lo)) problems.push(`${r.id}: max/min ${r.hi}/${r.lo} ≠ świece ${market.hi}/${market.lo}`);
  }
  return { problems, checked, eligible };
}

const NET_TIMEOUT_MS = 15_000;
const blockCache = new Map();

/** Wysokość bloku → { hash, czas, korzeń Merkle } (publiczny eksplorator; ten sam wynik da każdy węzeł Bitcoina). */
function bitcoinBlock(height) {
  if (!blockCache.has(height)) {
    const p = (async () => {
      const hash = (await (await fetch(`https://mempool.space/api/block-height/${height}`, { signal: AbortSignal.timeout(NET_TIMEOUT_MS) })).text()).trim();
      const b = await (await fetch(`https://mempool.space/api/block/${hash}`, { signal: AbortSignal.timeout(NET_TIMEOUT_MS) })).json();
      return { hash, time: b.timestamp * 1000, merkleRoot: b.merkle_root };
    })();
    p.catch(() => blockCache.delete(height)); // błąd sieci — bez zapamiętywania
    blockCache.set(height, p);
  }
  return blockCache.get(height);
}

/** Czas zakotwiczenia w Bitcoinie (ms) dla pliku .ots: poświadczenia z pliku i — dla oczekujących — z kalendarza; null = brak. */
export async function bitcoinTime(bytes) {
  let atts;
  try {
    atts = otsAttestations(bytes);
  } catch {
    return null; // uszkodzony albo nieobsługiwany plik — brak czasu z Bitcoina (nie przerywa weryfikacji)
  }
  const btc = atts.filter((a) => a.kind === 'bitcoin');
  for (const p of atts.filter((a) => a.kind === 'pending' && a.msg)) {
    try {
      // Adres kalendarza pochodzi z pliku — tylko https (odpowiedź i tak jest sprawdzana kryptograficznie)
      if (new URL(p.uri).protocol !== 'https:') continue;
      const res = await fetch(`${p.uri}/timestamp/${p.msg}`, {
        headers: { Accept: 'application/vnd.opentimestamps.v1' },
        signal: AbortSignal.timeout(NET_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const out = [];
      walk(new R(Buffer.from(await res.arrayBuffer())), Buffer.from(p.msg, 'hex'), out);
      btc.push(...out.filter((a) => a.kind === 'bitcoin'));
    } catch {
      // kalendarz niedostępny albo odpowiedź nieczytelna — próbujemy pozostałe
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
  const market = { n: 0, brierModel: 0, brierMarket: 0 };
  const marketTight = { n: 0, brierModel: 0, brierMarket: 0 };
  for (const [id, fc] of f) {
    const res = r.get(id);
    if (!res || res.void) continue;
    if (fc.kind === 'ret') {
      const s = (ret[fc.h] ??= { n: 0, crps: 0, crpsB: 0, in90: 0 });
      s.n++;
      s.crps += crps(fc.taus, fc.q, res.y);
      s.crpsB += crps(fc.taus, fc.bq, res.y);
      s.in90 += res.y >= quantileAt(fc.taus, fc.q, 0.05) && res.y <= quantileAt(fc.taus, fc.q, 0.95) ? 1 : 0;
    } else if (fc.kind === 'mkt') {
      if (res.near !== 0 || fc.bid === null || fc.ask === null) continue;
      const y = res.c1 >= fc.K ? 1 : 0;
      const add = (acc) => {
        acc.n++;
        acc.brierModel += (fc.p - y) ** 2;
        acc.brierMarket += ((fc.bid + fc.ask) / 2 - y) ** 2;
      };
      if (fc.ask - fc.bid <= MKT_MAX_SPREAD + 1e-12) add(marketTight);
      if (fc.liquid) add(market);
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
    market: { n: market.n, brierModel: market.n ? market.brierModel / market.n : null, brierMarket: market.n ? market.brierMarket / market.n : null },
    marketTight: {
      n: marketTight.n,
      brierModel: marketTight.n ? marketTight.brierModel / marketTight.n : null,
      brierMarket: marketTight.n ? marketTight.brierMarket / marketTight.n : null,
    },
    voided: [...r.values()].filter((x) => x.void).length,
    skipped: records.filter((o) => o.k === 's').reduce((n, o) => n + (typeof o.until === 'number' ? Math.round((o.until - o.slot) / SLOT_MS) + 1 : 1), 0),
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
  // Tryb szybki: rozstrzygnięcia prognoz sprzed pierwszego pobranego dnia nie są błędem
  const order = checkOrdering(records, local ? {} : { since: Date.parse(`${files[0][0].slice(0, 10)}T00:00:00Z`) });
  console.log(order.length ? `✗ kolejność / spójność (${order.length}): ${order.slice(0, 5).join('; ')}` : '✓ kolejność i spójność rekordów');
  if (order.length) ok = false;
  const mismatch = checkResolutions(records);
  console.log(mismatch.length ? `✗ wyniki niezgodne z przeliczonymi (${mismatch.length}): ${mismatch.slice(0, 5).join('; ')}` : '✓ wyniki zgodne z przeliczonymi z kwantyli');
  if (mismatch.length) ok = false;
  const ens = checkEnsemble(records, { full: !!local });
  if (ens.checked || ens.problems.length)
    console.log(ens.problems.length ? `✗ ensemble (${ens.problems.length}): ${ens.problems.slice(0, 5).join('; ')}` : `✓ ensemble: ${ens.checked} p_e zgodnych z zapisanymi wagami${local ? ', wagi tylko z wcześniej rozstrzygniętych pytań' : ''}`);
  if (ens.problems.length) ok = false;
  const pre = checkPreregs(records);
  if (pre.preregs.length || pre.problems.length)
    console.log(
      pre.problems.length
        ? `✗ prerejestracje (${pre.problems.length}): ${pre.problems.slice(0, 5).join('; ')}`
        : `✓ prerejestracje katalogów: ${pre.preregs.map((p) => `${p.id} ${new Date(p.t).toISOString().slice(0, 16)}Z (${String(p.catalogHash).slice(0, 12)}…)`).join(', ')}`
    );
  if (pre.problems.length) ok = false;
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
    const receiptPath = (slot, batch = '') => path.join(otsDir, 'slots', new Date(slot).toISOString().slice(0, 10), `${slot}${batch ? `-${batch}` : ''}.ots`);
    const getReceipt = (slot, batch = '') => (existsSync(receiptPath(slot, batch)) ? readFileSync(receiptPath(slot, batch)) : null);
    const rec = checkReceipts(records, getReceipt);
    const groups = new Set(records.filter((o) => o.k === 'f').map((o) => `${o.slot}|${batchOf(o)}`)).size;
    slots = groups - rec.length;
    console.log(rec.length ? `✗ pokwitowania slotów (${rec.length}): ${rec.slice(0, 5).join('; ')}` : `✓ pokwitowania slotów (partie): ${slots}/${groups}`);
    if (rec.length) ok = false;
    console.log(`✓ kotwice dni zgodne: ${daily}`);

    if (args.includes('--bitcoin')) {
      // Czas z Bitcoina: poświadczenie (z pliku albo uzupełnione z kalendarza) → nagłówek bloku → czas; prognoza jest
      // dowiedziona blokiem, gdy blok jest wcześniejszy niż koniec jej horyzontu. Dla 1 h blok często przychodzi później —
      // wtedy dowodem przed faktem są kalendarze (niezależni operatorzy), a blok potwierdza je później.
      const bySlot = new Map();
      for (const o of records) if (o.k === 'f') bySlot.set(`${o.slot}|${batchOf(o)}`, [...(bySlot.get(`${o.slot}|${batchOf(o)}`) ?? []), o]);
      const stat = {};
      for (const fs of bySlot.values()) {
        const bytes = getReceipt(fs[0].slot, batchOf(fs[0]));
        if (!bytes) continue;
        const bt = await bitcoinTime(bytes);
        for (const fc of fs) {
          const key = fc.kind === 'mkt' ? 'rynek HIP-4 (15 min)' : `horyzont ${fc.h} min`;
          const s = (stat[key] ??= { n: 0, proven: 0, late: 0, pending: 0 });
          s.n++;
          if (bt === null) s.pending++;
          else if (bt + BLOCK_TIME_MARGIN_MS <= fc.t + fc.h * MIN_MS) s.proven++;
          else s.late++;
        }
      }
      for (const [label, s] of Object.entries(stat)) {
        console.log(
          `ℹ ${label} (${s.n}): blok Bitcoina przed rozstrzygnięciem (z zapasem 2 h na znacznik czasu bloku) ${s.proven}; ` +
            `blok później ${s.late} ` +
            `(przed faktem — tylko kalendarze OTS, zaufanie do ich operatorów); jeszcze bez bloku ${s.pending}`
        );
      }
    }
    if (args.includes('--market')) {
      // Ceny źródłowe vs publiczne świece 1m Hyperliquid (API udostępnia ok. 3.5 doby wstecz)
      const since = Date.now() - 3.4 * 86_400_000;
      let status = 'brak odpowiedzi';
      let candles = [];
      try {
        const res = await fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'candleSnapshot', req: { coin: 'BTC', interval: '1m', startTime: since } }),
          signal: AbortSignal.timeout(NET_TIMEOUT_MS),
        });
        status = `HTTP ${res.status}`;
        const raw = res.ok ? await res.json() : null;
        candles = (Array.isArray(raw) ? raw : []).map((c) => ({ time: c.t, high: Number(c.h), low: Number(c.l), close: Number(c.c) }));
      } catch (e) {
        status = String(e?.message ?? e);
      }
      if (candles.length === 0) {
        console.log(`✗ --market: nie udało się pobrać świec 1m z Hyperliquid (${status}) — ceny nie zostały sprawdzone`);
        ok = false;
      } else {
        const mk = checkMarket(records, candles);
        if (mk.problems.length) {
          console.log(`✗ ceny źródłowe niezgodne ze świecami (${mk.problems.length}): ${mk.problems.slice(0, 5).join('; ')}`);
          ok = false;
        } else if (mk.eligible === 0) console.log('ℹ --market: brak rozstrzygnięć do sprawdzenia');
        else if (mk.checked === 0) console.log(`ℹ --market: żadne z ${mk.eligible} rozstrzygnięć nie mieści się w zakresie świec 1m (~3.4 doby) — nic nie sprawdzono`);
        else console.log(`✓ ceny źródłowe zgodne ze świecami 1m: sprawdzone ${mk.checked}/${mk.eligible} (pozostałe starsze niż ~3.4 doby)`);
      }
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
