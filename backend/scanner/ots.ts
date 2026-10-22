import { createHash, randomBytes } from 'node:crypto';

/**
 * OpenTimestamps (opentimestamps.org) — darmowe zakotwiczenie skrótu SHA-256 w blockchainie Bitcoina przez publiczne kalendarze.
 * Tworzy plik `.ots` zgodny z klientem referencyjnym (python-opentimestamps: DetachedTimestampFile / Timestamp.serialize):
 *   MAGIC ‖ wersja 1 ‖ OP_SHA256 ‖ digest ‖ append(nonce) → sha256 → [gałęzie kalendarzy]
 * Kalendarze zwracają poświadczenia oczekujące (pending); po kilku godzinach `ots upgrade plik.ots` dopisuje dowód z bloku,
 * a `ots verify` sprawdza go względem pliku dziennika — bez zaufania do HyperQuant.
 */

export const OTS_MAGIC = new Uint8Array([
  0x00, ...new TextEncoder().encode('OpenTimestamps'), 0x00, 0x00, ...new TextEncoder().encode('Proof'), 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
]);
export const PENDING_TAG = new Uint8Array([0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e]);
const BITCOIN_TAG = new Uint8Array([0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01]);

export const CALENDARS = [
  'https://a.pool.opentimestamps.org',
  'https://b.pool.opentimestamps.org',
  'https://a.pool.eternitywall.com',
  'https://ots.btc.catallaxy.com',
];

const OP_SHA256 = 0x08;
const OP_APPEND = 0xf0;
const OP_PREPEND = 0xf1;
/** Operacje bez argumentu (skróty) i z argumentem (append/prepend) — pozostałe tagi traktujemy jako błędny format */
const UNARY = new Set([0x02, 0x03, 0x08, 0x67, 0xf2, 0xf3]);
const BINARY = new Set([OP_APPEND, OP_PREPEND]);

export function varuint(n: number): number[] {
  const out: number[] = [];
  let v = n;
  do {
    let b = v & 0x7f;
    v = Math.floor(v / 128);
    if (v > 0) b |= 0x80;
    out.push(b);
  } while (v > 0);
  return out;
}

export function varbytes(b: Uint8Array): number[] {
  return [...varuint(b.length), ...b];
}

class Reader {
  i = 0;
  readonly b: Uint8Array;
  constructor(b: Uint8Array) {
    this.b = b;
  }
  byte(): number {
    if (this.i >= this.b.length) throw new Error('koniec danych OTS');
    return this.b[this.i++];
  }
  bytes(n: number): Uint8Array {
    if (this.i + n > this.b.length) throw new Error('koniec danych OTS');
    const out = this.b.slice(this.i, this.i + n);
    this.i += n;
    return out;
  }
  varuint(): number {
    let v = 0;
    let shift = 1;
    for (;;) {
      const b = this.byte();
      v += (b & 0x7f) * shift;
      if (!(b & 0x80)) return v;
      shift *= 128;
      if (shift > 2 ** 49) throw new Error('za długi varuint');
    }
  }
  varbytes(max = 8192): Uint8Array {
    const n = this.varuint();
    if (n > max) throw new Error('za długie pole OTS');
    return this.bytes(n);
  }
}

interface ParsedTree {
  pending: string[];
  bitcoin: number[];
}

/** Parser drzewa znacznika (od bieżącej pozycji do końca gałęzi). */
function parseTree(r: Reader, out: ParsedTree, depth = 0): void {
  if (depth > 256) throw new Error('za głębokie drzewo OTS');
  for (;;) {
    let tag = r.byte();
    const more = tag === 0xff;
    if (more) tag = r.byte();
    if (tag === 0x00) {
      const atag = r.bytes(8);
      const payload = new Reader(r.varbytes());
      if (atag.every((v, i) => v === PENDING_TAG[i])) out.pending.push(new TextDecoder().decode(payload.varbytes()));
      else if (atag.every((v, i) => v === BITCOIN_TAG[i])) out.bitcoin.push(payload.varuint());
    } else if (BINARY.has(tag)) {
      r.varbytes(4096);
      parseTree(r, out, depth + 1);
    } else if (UNARY.has(tag)) {
      parseTree(r, out, depth + 1);
    } else throw new Error(`nieznany tag OTS 0x${tag.toString(16)}`);
    if (!more) return;
  }
}

/** Pierwsza operacja odpowiedzi kalendarza (klucz sortowania gałęzi); null = zły kształt. */
function firstOp(resp: Uint8Array): { tag: number; arg: Uint8Array } | null {
  try {
    const r = new Reader(resp);
    const tag = r.byte();
    if (BINARY.has(tag)) {
      const arg = r.varbytes(4096);
      // cała odpowiedź musi być poprawnym drzewem
      parseTree(new Reader(resp), { pending: [], bitcoin: [] });
      return { tag, arg };
    }
    if (UNARY.has(tag)) {
      parseTree(new Reader(resp), { pending: [], bitcoin: [] });
      return { tag, arg: new Uint8Array() };
    }
    return null;
  } catch {
    return null;
  }
}

function cmpOps(a: { tag: number; arg: Uint8Array }, b: { tag: number; arg: Uint8Array }): number {
  if (a.tag !== b.tag) return a.tag - b.tag;
  const n = Math.min(a.arg.length, b.arg.length);
  for (let i = 0; i < n; i++) if (a.arg[i] !== b.arg[i]) return a.arg[i] - b.arg[i];
  return a.arg.length - b.arg.length;
}

/** Składa plik `.ots` z odpowiedzi kalendarzy (każda: drzewo dla sha256(digest ‖ nonce)). Bez poprawnej odpowiedzi — wyjątek. */
export function buildOtsFile(digest: Uint8Array, nonce: Uint8Array, responses: Uint8Array[]): Uint8Array {
  const branches = responses
    .map((resp) => ({ resp, op: firstOp(resp) }))
    .filter((b): b is { resp: Uint8Array; op: { tag: number; arg: Uint8Array } } => b.op !== null)
    .sort((a, b) => cmpOps(a.op, b.op))
    .filter((b, i, arr) => i === 0 || cmpOps(arr[i - 1].op, b.op) !== 0);
  if (branches.length === 0) throw new Error('brak poprawnej odpowiedzi kalendarza OTS');
  const out: number[] = [...OTS_MAGIC, 0x01, OP_SHA256, ...digest, OP_APPEND, ...varbytes(nonce), OP_SHA256];
  branches.forEach((b, i) => {
    if (i < branches.length - 1) out.push(0xff);
    out.push(...b.resp);
  });
  return new Uint8Array(out);
}

/** Odczyt pliku `.ots` (do testów i weryfikacji własnych plików): digest, adresy oczekujących poświadczeń, wysokości bloków. */
export function parseOts(bytes: Uint8Array): { digest: Uint8Array; pending: string[]; bitcoin: number[] } {
  const r = new Reader(bytes);
  const magic = r.bytes(OTS_MAGIC.length);
  if (!magic.every((v, i) => v === OTS_MAGIC[i])) throw new Error('to nie jest plik OpenTimestamps');
  if (r.byte() !== 1) throw new Error('nieobsługiwana wersja OTS');
  if (r.byte() !== OP_SHA256) throw new Error('obsługiwany tylko skrót SHA-256 pliku');
  const digest = r.bytes(32);
  const out: ParsedTree = { pending: [], bitcoin: [] };
  parseTree(r, out);
  return { digest, ...out };
}

/**
 * Znakuje digest w kalendarzach (POST {kalendarz}/digest z surowym sha256(digest ‖ nonce)). Zwraca plik `.ots`
 * i listę kalendarzy, które odpowiedziały; żaden → null.
 */
export async function stampDigest(
  digest: Uint8Array,
  o: { fetchFn?: typeof fetch; calendars?: string[]; nonce?: Uint8Array; timeoutMs?: number } = {}
): Promise<{ ots: Uint8Array; calendars: string[] } | null> {
  const fetchFn = o.fetchFn ?? fetch;
  const nonce = o.nonce ?? new Uint8Array(randomBytes(16));
  const msg = new Uint8Array(createHash('sha256').update(digest).update(nonce).digest());
  const cals = o.calendars ?? CALENDARS;
  const got = await Promise.all(
    cals.map(async (c) => {
      try {
        const res = await fetchFn(`${c}/digest`, {
          method: 'POST',
          headers: { Accept: 'application/vnd.opentimestamps.v1', 'User-Agent': 'HyperQuant-ledger' },
          body: Buffer.from(msg),
          signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
        });
        if (!res.ok) return null;
        const body = new Uint8Array(await res.arrayBuffer());
        return body.length > 0 && body.length < 10_000 && firstOp(body) ? { c, body } : null;
      } catch {
        return null;
      }
    })
  );
  const ok = got.filter((g) => g !== null) as { c: string; body: Uint8Array }[];
  if (ok.length === 0) return null;
  return { ots: buildOtsFile(digest, nonce, ok.map((g) => g.body)), calendars: ok.map((g) => g.c) };
}
