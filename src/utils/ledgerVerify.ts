/**
 * Weryfikacja weryfikowalnego dziennika desku w przeglądarce (WebCrypto) — bez zaufania do HyperQuant: pliki dzienne
 * prosto z gałęzi `ledger` repo danych, łańcuch hashy SHA-256 od GENESIS (postać kanoniczna każdej linii), głowa
 * z publikowanego podsumowania musi należeć do łańcucha, skróty pokwitowań OpenTimestamps ostatnich slotów = hash
 * ostatniej prognozy partii, hash katalogu każdej prerejestracji. Ta sama logika co scripts/verify-ledger.mjs (bez
 * przeliczania wyników, historii git i bloków Bitcoina — to robi skrypt).
 */

import { canonical, sha256Hex } from './canonical.ts';

export { canonical, sha256Hex };

export const GENESIS = '0'.repeat(64);

export interface ChainCheck {
  ok: boolean;
  head: string;
  badLine: number | null;
  reason: string | null;
}

/** Linie od poprzednika `prev`: postać kanoniczna, `prev` = hash poprzedniej, `hash` = SHA-256 treści bez `hash`. */
export async function verifyChain(lines: readonly string[], prev: string): Promise<ChainCheck> {
  let expected = prev;
  for (let i = 0; i < lines.length; i++) {
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(lines[i]) as Record<string, unknown>;
    } catch {
      return { ok: false, head: expected, badLine: i, reason: 'niepoprawny JSON' };
    }
    if (canonical(o) !== lines[i]) return { ok: false, head: expected, badLine: i, reason: 'linia nie jest w postaci kanonicznej' };
    const { hash, ...rest } = o;
    if (rest.prev !== expected) return { ok: false, head: expected, badLine: i, reason: 'prev nie wskazuje poprzedniej linii' };
    if ((await sha256Hex(canonical(rest))) !== hash) return { ok: false, head: expected, badLine: i, reason: 'hash nie zgadza się z treścią' };
    expected = hash as string;
  }
  return { ok: true, head: expected, badLine: null, reason: null };
}

const OTS_MAGIC = new Uint8Array([
  0x00, ...new TextEncoder().encode('OpenTimestamps'), 0x00, 0x00, ...new TextEncoder().encode('Proof'), 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
]);

/** Skrót (hex) zakotwiczony w pliku .ots — nagłówek, wersja 1, operacja SHA-256; inny format → null. */
export function otsDigestHex(b: Uint8Array): string | null {
  const m = OTS_MAGIC.length;
  if (b.length < m + 34) return null;
  for (let i = 0; i < m; i++) if (b[i] !== OTS_MAGIC[i]) return null;
  if (b[m] !== 1 || b[m + 1] !== 0x08) return null;
  return Array.from(b.subarray(m + 2, m + 34), (x) => x.toString(16).padStart(2, '0')).join('');
}

export interface RemoteVerification {
  ok: boolean;
  /** Sprawdzone linie i pliki dzienne */
  lines: number;
  days: number;
  /** Czy łańcuch sprawdzono od pierwszej linii (GENESIS) — przy długiej historii tylko ostatnie dni */
  fromGenesis: boolean;
  head: string | null;
  receipts: { checked: number; ok: number };
  preregs: { id: string; ok: boolean }[];
  problems: string[];
}

export interface RemoteOptions {
  /** Surowe pliki gałęzi ledger, np. https://raw.githubusercontent.com/<konto>/<repo>/ledger */
  ledgerBase: string;
  /** <konto>/<repo> — lista plików z API GitHuba */
  repo: string;
  /** Głowa z publikowanego podsumowania (null = bez tego sprawdzenia) */
  summaryHead: string | null;
  fetchFn?: typeof fetch;
  /** Ile ostatnich partii slotów sprawdzić pod kątem pokwitowań */
  receipts?: number;
  /** Najwięcej dni do pobrania (starsze — skrypt) */
  maxDays?: number;
  onProgress?: (msg: string) => void;
}

const DAY_FILE = /^\d{4}-\d\d-\d\d\.jsonl$/;
/** Pokwitowanie najnowszych prognoz może jeszcze nie być w repo — brak w tym oknie to „czeka”, nie problem */
const RECEIPT_GRACE_MS = 30 * 60_000;

export async function verifyLedgerRemote(o: RemoteOptions): Promise<RemoteVerification> {
  const f = o.fetchFn ?? globalThis.fetch.bind(globalThis);
  const problems: string[] = [];
  const say = (m: string) => o.onProgress?.(m);
  const res: RemoteVerification = { ok: false, lines: 0, days: 0, fromGenesis: true, head: null, receipts: { checked: 0, ok: 0 }, preregs: [], problems };

  say('Lista plików dziennika…');
  const list = await f(`https://api.github.com/repos/${o.repo}/contents/BTC?ref=ledger`);
  if (!list.ok) {
    problems.push(`nie udało się pobrać listy plików (HTTP ${list.status})`);
    return res;
  }
  let names = ((await list.json()) as { name: string; type: string }[])
    .filter((x) => x.type === 'file' && DAY_FILE.test(x.name))
    .map((x) => x.name)
    .sort();
  const maxDays = o.maxDays ?? 60;
  if (names.length > maxDays) {
    names = names.slice(-maxDays);
    res.fromGenesis = false;
  }

  const records: Record<string, unknown>[] = [];
  let prev: string | null = res.fromGenesis ? GENESIS : null;
  for (const name of names) {
    say(`Łańcuch: ${name}…`);
    const r = await f(`${o.ledgerBase}/BTC/${name}`);
    if (!r.ok) {
      problems.push(`${name}: nie udało się pobrać (HTTP ${r.status})`);
      return res;
    }
    const lines = (await r.text()).split('\n').filter(Boolean);
    if (prev === null) prev = String((JSON.parse(lines[0]) as { prev?: unknown }).prev ?? '');
    const v = await verifyChain(lines, prev);
    if (!v.ok) {
      problems.push(`${name}: linia ${(v.badLine ?? 0) + 1} — ${v.reason}`);
      return res;
    }
    prev = v.head;
    res.lines += lines.length;
    res.days++;
    for (const l of lines) records.push(JSON.parse(l) as Record<string, unknown>);
  }
  res.head = prev;

  if (o.summaryHead && !records.some((x) => x.hash === o.summaryHead)) problems.push('głowa z publikowanego podsumowania nie występuje w łańcuchu');

  // Pokwitowania ostatnich partii slotów: skrót = hash ostatniej prognozy partii
  const lastOf = new Map<string, { slot: number; batch: string; hash: string; t: number }>();
  for (const x of records) {
    if (x.k !== 'f' || typeof x.slot !== 'number') continue;
    const batch = x.kind === 'mkt' ? 'm' : '';
    lastOf.set(`${x.slot}|${batch}`, { slot: x.slot, batch, hash: String(x.hash), t: Number(x.ti ?? x.t) });
  }
  const latest = Math.max(...records.map((x) => Number(x.ti ?? x.t ?? 0)).filter(Number.isFinite));
  const batches = [...lastOf.values()].sort((a, b) => a.slot - b.slot || a.batch.localeCompare(b.batch)).slice(-(o.receipts ?? 12));
  for (const b of batches) {
    say(`Pokwitowanie slotu ${new Date(b.slot).toISOString().slice(11, 16)} UTC…`);
    const day = new Date(b.slot).toISOString().slice(0, 10);
    const r = await f(`${o.ledgerBase}/BTC/ots/slots/${day}/${b.slot}${b.batch ? `-${b.batch}` : ''}.ots`);
    if (!r.ok) {
      if (latest - b.t > RECEIPT_GRACE_MS) problems.push(`slot ${new Date(b.slot).toISOString().slice(0, 16)}Z: brak pokwitowania`);
      continue;
    }
    res.receipts.checked++;
    if (otsDigestHex(new Uint8Array(await r.arrayBuffer())) === b.hash) res.receipts.ok++;
    else problems.push(`slot ${new Date(b.slot).toISOString().slice(0, 16)}Z: skrót pokwitowania ≠ hash ostatniej prognozy`);
  }

  for (const x of records) {
    if (x.k !== 'p') continue;
    const ok = !!x.catalog && (await sha256Hex(canonical(x.catalog))) === x.catalogHash;
    res.preregs.push({ id: String(x.id), ok });
    if (!ok) problems.push(`prerejestracja ${String(x.id)}: hash katalogu nie zgadza się z treścią`);
  }
  res.ok = problems.length === 0;
  return res;
}
