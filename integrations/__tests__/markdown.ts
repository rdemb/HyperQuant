/** Odczyt plików Markdown integracji w testach: treść z repo, sekcja pod nagłówkiem, nazwy w kształcie nazwy narzędzia. */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');

/** Plik z katalogu repo, z końcami linii `\n` (checkout na Windows może mieć `\r\n`). */
export const readRepo = (p: string): string => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

/** Poziom nagłówka Markdown (1–6); zwykła linia — 0. */
const headingLevel = (line: string): number => /^(#{1,6})\s/.exec(line)?.[1].length ?? 0;

/** Treść pod nagłówkiem `title` (dowolny poziom) do następnego nagłówka tego samego albo wyższego poziomu; brak — null. */
export function section(md: string, title: string): string | null {
  const lines = md.split('\n');
  const at = lines.findIndex((l) => headingLevel(l) > 0 && l.replace(/^#+\s+/, '').trim() === title);
  if (at < 0) return null;
  const level = headingLevel(lines[at]);
  const next = lines.findIndex((l, i) => i > at && headingLevel(l) > 0 && headingLevel(l) <= level);
  return lines
    .slice(at + 1, next < 0 ? undefined : next)
    .join('\n')
    .trim();
}

/** Podsekcje (nagłówki o poziom niższe) sekcji `title`: tytuł i treść. */
export function subsections(md: string, title: string): { title: string; body: string }[] {
  const body = section(md, title);
  if (body === null) return [];
  const parts: { title: string; body: string }[] = [];
  for (const line of body.split('\n')) {
    if (headingLevel(line) > 0) parts.push({ title: line.replace(/^#+\s+/, '').trim(), body: '' });
    else if (parts.length > 0) parts[parts.length - 1].body += `${line}\n`;
  }
  return parts;
}

/**
 * Nazwy narzędzi w backtickach: w kształcie nazwy narzędzia MCP (małe litery z podkreśleniem, `x_y`) albo dokładnie jedna
 * z nazw `known` (narzędzia jednowyrazowe: `whales`, `twaps`). Pole po kropce się nie liczy: `session_context.rvolHour`
 * daje `session_context`, `twaps.share60` daje `twaps`. Inne zapisy w backtickach (`asOf`, `HQ_LANG`, `hyperquant-mcp`) pomija.
 */
export function toolLikeNames(md: string, known: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(/`([^`\n]+)`/g)) {
    const id = /^([a-z][a-z0-9_]*)(?![A-Za-z0-9-])/.exec(m[1])?.[1];
    if (id && (id.includes('_') || known.has(id))) out.push(id);
  }
  return out;
}

/** Litery polskie: publikowane pliki skilla i szablonów są po angielsku. */
export const POLISH_LETTERS = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
