/**
 * Wzorce plików do publikacji: ścieżki domowe, sekrety, adresy, e-maile i słowa wewnętrznego procesu pracy. Wspólne dla
 * testu plików repo (`publishable.test.ts`) i testu archiwum `.mcpb` (`mcp/__tests__/mcpb.test.ts`). Wzorce są ogólne:
 * ten plik też jest publiczny i też jest czytany.
 */
import { GUARDS } from '../../src/utils/safeguards.mjs';

/** Ścieżka w katalogu domowym dowolnego użytkownika (Windows, także z ucieczką w JSON, macOS, Linux). */
export const HOME_PATTERNS: { why: string; re: RegExp }[] = [
  // Ścieżka domowa Windows także z podwójnym ukośnikiem wstecznym (JSON, literał w kodzie) i z ukośnikami zwykłymi
  { why: 'ścieżka domowa (Windows)', re: /[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)[^\\/\s"']+/i },
  // Katalog domowy macOS albo Linuksa jako początek ścieżki (nie fragment adresu URL)
  { why: 'ścieżka domowa (macOS, Linux)', re: /(?<![\w.-])\/(?:Users|home)\/[^/\s"'`]+/ },
];

// Klasy znaków w nawiasach w słowach procesu: wzorzec nie trafia we własny zapis w tym pliku (on też jest czytany)
const PATTERNS: { why: string; re: RegExp }[] = [
  ...HOME_PATTERNS,
  { why: 'adres portfela', re: /0x[0-9a-fA-F]{40}/ },
  { why: 'hash albo klucz (64 hex)', re: /[0-9a-fA-F]{64}/ },
  { why: 'sekret przypisany wprost', re: /(api[_-]?key|secret|token)\s*[:=]\s*\S{8,}/i },
  { why: 'słowo procesu pracy', re: /\b(Review[ ]Focus|sub[a]gent|ledger[ ]file|task[ ]brief)\b/i },
  { why: 'katalog notatek procesu', re: /\.super[p]owers/i },
  { why: 'katalog notatek procesu', re: /docs\/super[p]owers/i },
  // Bezpieczniki prywatności bloga i strony (m.in. tokeny i klucze dostępu w znanych formatach); IP i e-mail osobno niżej
  ...GUARDS.filter((g) => g.kind === 'privacy' && g.en !== 'an IP address' && g.en !== 'an e-mail address').map((g) => ({ why: g.why, re: g.re })),
];

const IP = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g;
/** Dozwolone w przykładach: pętla zwrotna, 0.0.0.0 i zakresy do dokumentacji (RFC 5737). */
const EXAMPLE_IP = /^(?:127\.\d+\.\d+\.\d+|0\.0\.0\.0|192\.0\.2\.\d+|198\.51\.100\.\d+|203\.0\.113\.\d+)$/;
const EMAIL = /[\w.+-]+@([\w-]+(?:\.[\w-]+)*\.[a-z]{2,})/gi;
/** Dozwolone w przykładach: domeny zarezerwowane do testów i dokumentacji (RFC 2606, RFC 6761). */
const EXAMPLE_DOMAIN = /(?:^|\.)(?:example\.(?:com|net|org)|[\w-]+\.(?:test|example|invalid|localhost))$/i;

/** Fragment tekstu z kontekstem wokół trafienia. */
const around = (text: string, at: number, len: number) => text.slice(Math.max(0, at - 20), at + len + 20).replace(/\s+/g, ' ');

/** Trafienia w tekście: powód i fragment z kontekstem. */
export function publishHits(text: string): string[] {
  const out: string[] = [];
  const hit = (why: string, at: number, len: number) => out.push(`${why} (${around(text, at, len)})`);
  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    if (m) hit(p.why, m.index, m[0].length);
  }
  for (const m of text.matchAll(IP)) if (!EXAMPLE_IP.test(m[0])) hit('adres IP', m.index, m[0].length);
  for (const m of text.matchAll(EMAIL)) if (!EXAMPLE_DOMAIN.test(m[1])) hit('adres e-mail', m.index, m[0].length);
  return out;
}

/** Tylko ścieżki domowe (pliki zależności w archiwum: ich kod ma własne przykłady i nazwy pól, ale nie nasze ścieżki). */
export function homePathHits(text: string): string[] {
  const out: string[] = [];
  for (const p of HOME_PATTERNS) {
    const m = p.re.exec(text);
    if (m) out.push(`${p.why} (${around(text, m.index, m[0].length)})`);
  }
  return out;
}
