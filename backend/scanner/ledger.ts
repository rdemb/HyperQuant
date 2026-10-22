import { createHash } from 'node:crypto';

/**
 * Dziennik prognoz desku — tylko dopisywanie, łańcuch hashy (jak w rejestrze zdarzeń): każda linia JSONL zawiera `prev`
 * (hash poprzedniej linii) i `hash` = SHA-256(kanoniczny JSON linii bez `hash`). Klucze `prev` i `hash` są zarezerwowane. Zmiana dowolnej liczby wstecz, usunięcie lub
 * przestawienie linii psuje łańcuch; pliki dzienne są dodatkowo zakotwiczane w Bitcoinie przez OpenTimestamps.
 * Weryfikacja bez zaufania do HyperQuant: scripts/verify-ledger.mjs.
 */

export const GENESIS = '0'.repeat(64);

/** JSON z kluczami posortowanymi rekurencyjnie, bez białych znaków — jedna postać bajtowa dla tych samych danych. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(',')}}`;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Nowa linia łańcucha: treść + prev → hash. Treść z kluczem `prev` albo `hash` → wyjątek (pola łańcucha są zarezerwowane). */
export function makeLine(prev: string, body: Record<string, unknown>): { line: string; hash: string } {
  if ('prev' in body || 'hash' in body) throw new Error('klucze prev i hash są zarezerwowane dla łańcucha dziennika');
  const withPrev = { ...body, prev };
  const hash = sha256(canonicalJson(withPrev));
  return { line: canonicalJson({ ...withPrev, hash }), hash };
}

/** Weryfikacja kolejnych linii od zadanego poprzednika; badLine = indeks pierwszej złej linii. */
export function verifyLines(lines: string[], prev: string): { ok: boolean; n: number; head: string; badLine: number | null } {
  let expected = prev;
  for (let i = 0; i < lines.length; i++) {
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(lines[i]) as Record<string, unknown>;
    } catch {
      return { ok: false, n: i, head: expected, badLine: i };
    }
    const { hash, ...rest } = o;
    if (typeof hash !== 'string' || rest.prev !== expected || sha256(canonicalJson(rest)) !== hash) return { ok: false, n: i, head: expected, badLine: i };
    expected = hash;
  }
  return { ok: true, n: lines.length, head: expected, badLine: null };
}
