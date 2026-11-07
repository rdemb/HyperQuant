/**
 * Koperta odpowiedzi narzędzi MCP: każda liczba to `Num` (wartość, jednostka, oznaczenie LIVE/MODEL/SIM, powód braku),
 * każda odpowiedź ma czas ISO UTC, źródła i stałą stopkę. Przed wysłaniem cała treść przechodzi bezpieczniki treści
 * strony (`TITLE_GUARDS`) i regex adresu; trafienie zamyka odpowiedź (`isError`) bez przepuszczenia tekstu.
 */
import type { CallToolResult } from '@modelcontextprotocol/server';
import { tr } from '../../src/i18n';
import { TITLE_GUARDS, guardHits } from '../../src/utils/safeguards.mjs';
import { type Got, WAIT_TEXT, isAbsent } from '../../src/utils/sessionText';

export type Badge = 'LIVE' | 'MODEL' | 'SIM';
/** `pct` — procent 0–100; `ratio` — ułamek albo krotność (1 = 100%); `price` — cena BTC w USD; `min` — minuty. */
export type Unit = 'usd' | 'btc' | 'price' | 'pct' | 'sigma' | 'ratio' | 'count' | 'min';

export interface Num {
  /** Liczba albo null z powodem w `why` — nigdy 0, NaN ani wartość zastępcza. */
  value: number | null;
  unit: Unit;
  /** null tylko przy braku liczby. */
  badge: Badge | null;
  why: string | null;
  method?: string;
  note?: string;
}

export const DISCLAIMER = 'Opis rynku, nie porada inwestycyjna. Market description, not investment advice.' as const;

/** Liczba z oznaczeniem; brak albo nieskończona — `value: null`, `badge: null` i powód (domyślnie „czekam na dane”). */
export function num(value: number | null | undefined, unit: Unit, badge: Badge, extra: { why?: string; method?: string; note?: string } = {}): Num {
  const { why, method, note } = extra;
  const tail = { ...(method !== undefined && { method }), ...(note !== undefined && { note }) };
  if (typeof value !== 'number' || !Number.isFinite(value)) return { value: null, unit, badge: null, why: why ?? WAIT_TEXT, ...tail };
  return { value, unit, badge, why: null, ...tail };
}

/** `Got<number>` z funkcji strony (`src/utils`) jako `Num`: Absent — jego powód, wczytywane (undefined) — „czekam na dane”. */
export function fromGot(v: Got<number> | undefined, unit: Unit, badge: Badge, method?: string): Num {
  if (v === undefined || isAbsent(v)) return num(null, unit, badge, { why: v?.why });
  return num(v, unit, badge, method === undefined ? {} : { method });
}

export interface SourceRef {
  name: string;
  url: string;
  /** Czas danych źródła (ISO UTC) albo null, gdy źródło nie odpowiedziało. */
  asOf: string | null;
}

export interface Envelope<T> {
  tool: string;
  coin: 'BTC';
  asOf: string;
  data: T;
  sources: SourceRef[];
  notes: string[];
  disclaimer: typeof DISCLAIMER;
}

export const iso = (t: number): string => new Date(t).toISOString();

export function envelope<T>(tool: string, data: T, sources: SourceRef[], now: number, notes: string[] = []): Envelope<T> {
  return { tool, coin: 'BTC', asOf: iso(now), data, sources, notes, disclaimer: DISCLAIMER };
}

/** Odpowiedź-błąd narzędzia: tylko nazwa i powód, bez danych. */
export function blocked(tool: string, why: string): CallToolResult {
  return { content: [{ type: 'text', text: `${tool}: ${why}` }], isError: true };
}

const ADDRESS = /0x[0-9a-fA-F]{40}/;
const ADDRESS_WHY = tr('adres portfela lub hash transakcji', 'a wallet address or transaction hash');
const PRIVACY_GUARDS = TITLE_GUARDS.filter((g) => g.kind === 'privacy');

/** Stały znacznik blokady w obu językach (klient i testy rozpoznają go bez względu na `HQ_LANG`). */
export const BLOCK_MARK = 'blokada treści / content blocked';

function hitsOf(x: unknown, out: Set<string>): void {
  if (typeof x === 'string') {
    if (ADDRESS.test(x)) out.add(ADDRESS_WHY);
    for (const h of guardHits(x, TITLE_GUARDS)) out.add(tr(h.guard.why, h.guard.en));
  } else if (Array.isArray(x)) {
    for (const v of x) hitsOf(v, out);
  } else if (typeof x === 'object' && x !== null) {
    for (const [k, v] of Object.entries(x)) {
      if (ADDRESS.test(k)) out.add(ADDRESS_WHY);
      for (const h of guardHits(k, PRIVACY_GUARDS)) out.add(tr(h.guard.why, h.guard.en));
      hitsOf(v, out);
    }
  }
}

/**
 * Powody trafień bezpieczników w treści (bez fragmentów tekstu): wartości tekstowe rekurencyjnie pełnymi `TITLE_GUARDS`,
 * klucze obiektów bezpiecznikami prywatności („sell” jako nazwa pola to nie wezwanie), adres wszędzie. Puste — czysto.
 */
export function blockReasons(x: unknown): string[] {
  const out = new Set<string>();
  hitsOf(x, out);
  return [...out];
}

/**
 * Tekst z zewnątrz (komunikat błędu) przycięty do `max` znaków. Bezpieczniki najpierw na całości (adres przecięty na
 * granicy przeszedłby jako krótszy ciąg hex), potem na wyniku (ucięte słowo może dać wzorzec rady, np. „kupony” → „kup”).
 * Trafienie — sam znacznik blokady, bez treści.
 */
export function guardedCut(text: string, max: number): string {
  const cut = text.slice(0, max);
  return blockReasons(text).length === 0 && blockReasons(cut).length === 0 ? cut : BLOCK_MARK;
}

/**
 * Koperta jako wynik narzędzia: tekst to JSON koperty, `structuredContent` ten sam obiekt po JSON (bez `undefined`).
 * Trafienie bezpiecznika — `blocked` z powodem „blokada treści”, bez żadnej treści koperty (fail closed).
 */
export function toToolResult(e: Envelope<unknown>): CallToolResult {
  const hits = blockReasons(e);
  if (hits.length > 0) return blocked(e.tool, `${BLOCK_MARK}: ${hits.join('; ')}`);
  const text = JSON.stringify(e);
  return { content: [{ type: 'text', text }], structuredContent: JSON.parse(text) as Record<string, unknown> };
}
