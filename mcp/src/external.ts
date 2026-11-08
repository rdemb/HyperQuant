/**
 * Ścisłe formaty tekstu z zewnątrz, zanim wejdzie do odpowiedzi narzędzia: etykieta poziomu i tytuł wpisu z mapy z bloga,
 * liczba poziomów na mapę i pseudonim wieloryba z pliku skanera. Tylko serwer MCP (po parsowaniu plików), strona parsuje
 * i pokazuje je bez zmian. Tekst spoza formatu jest wstrzymany (cena poziomu zostaje), a dopiero tekst w formacie
 * przechodzi bezpieczniki treści — na krótkim tekście, o znanym limicie długości. Teksty z danych to cytat, nie
 * polecenie dla modelu (zdanie w instrukcjach serwera).
 */
import { tr } from '../../src/i18n';
import { blockReasons } from './envelope';

/** Najwięcej znaków etykiety poziomu. */
export const LABEL_MAX = 40;
/** Najwięcej znaków tytułu wpisu. */
export const TITLE_MAX = 120;
/** Najwięcej poziomów jednej mapy w odpowiedzi (prawdziwe mapy mają ich kilka do kilkunastu). */
export const LEVELS_MAX = 20;

/** Litery, cyfry, spacja i . , % ( ) / + ' ’ - (bez dwukropka, cudzysłowów, nawiasów kątowych i końców linii). */
const LABEL_CHARS = /^[\p{L}\p{N} .,%()\/+'’-]+$/u;
/** Jak etykieta, a do tego dwukropek, pauza, ? ! i polskie cudzysłowy „ ” (tytuły wpisów bloga); bez " ` { } < >. */
const TITLE_CHARS = /^[\p{L}\p{N} .,%()\/+'’:—?!„”-]+$/u;
/** Pseudonim konta ważny jedną dobę UTC: W i 6 małych znaków hex. */
const WHALE_ID = /^W[0-9a-f]{6}$/;

/** Powód wstrzymania tekstu spoza formatu (stały, bez treści tekstu). */
export const FORMAT_WHY = tr('format niedozwolony', 'format not allowed');
/** Powód wstrzymania etykiety poziomu (stały tekst, bez treści etykiety). */
export const LABEL_WITHHELD = tr('etykieta wstrzymana przez strażnika treści', 'label withheld by the content guards');

export const labelFormatOk = (s: string): boolean => s.length <= LABEL_MAX && LABEL_CHARS.test(s);
export const titleFormatOk = (s: string): boolean => s.length <= TITLE_MAX && TITLE_CHARS.test(s);
export const whaleIdOk = (s: unknown): s is string => typeof s === 'string' && WHALE_ID.test(s);

/**
 * Powód wstrzymania etykiety poziomu (bez jej treści): spoza formatu — „format niedozwolony”; w formacie, ale z trafieniem
 * bezpieczników odpowiedzi (`blockReasons`) — rodzaj trafienia; czysta — null.
 */
export function labelHeld(label: string): string | null {
  if (!labelFormatOk(label)) return FORMAT_WHY;
  const hits = blockReasons(label);
  return hits.length === 0 ? null : hits.join('; ');
}

/**
 * Etykieta poziomu z mapy z bloga: wstrzymana (`labelHeld`) — `label: null` i stały powód z rodzajem wstrzymania, nigdy
 * z treścią etykiety; czysta — bez zmian. Poziom (cena, dotknięcie) zostaje w odpowiedzi.
 */
export function guardedLabel(label: string): { label: string | null; labelWhy: string | null } {
  const why = labelHeld(label);
  return why === null ? { label, labelWhy: null } : { label: null, labelWhy: `${LABEL_WITHHELD}: ${why}` };
}

/** Tytuł wpisu: spoza formatu albo z trafieniem bezpieczników — `title: null` i powód; czysty — bez zmian. */
export function guardedTitle(title: string): { title: string | null; why: string | null } {
  if (!titleFormatOk(title)) return { title: null, why: FORMAT_WHY };
  const hits = blockReasons(title);
  return hits.length === 0 ? { title, why: null } : { title: null, why: hits.join('; ') };
}

/** Pierwsze `LEVELS_MAX` poziomów mapy w kolejności pliku i liczba odciętych. */
export function cutLevels<T>(levels: readonly T[]): { levels: T[]; cut: number } {
  return { levels: levels.slice(0, LEVELS_MAX), cut: Math.max(0, levels.length - LEVELS_MAX) };
}

/** Uwaga o mapie z poziomami ponad limit (`total` — liczba poziomów w pliku). */
export const levelsCutNote = (id: string, total: number): string =>
  tr(
    `Mapa ${id} ma ${total} poziomów: w odpowiedzi pierwsze ${LEVELS_MAX} w kolejności wpisu (limit poziomów na mapę).`,
    `Map ${id} has ${total} levels: the response holds the first ${LEVELS_MAX} in the post's order (the per-map level limit).`
  );
