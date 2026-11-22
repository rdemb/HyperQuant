import { tr } from '../../i18n';
import type { ChronographAnchorResult } from './chronographAnchor';
import type { ChronographDemo } from './chronographHistory';

/**
 * Link do pytania „Co było pierwsze?” (frontend, Designer). Adres niesie kotwicę Kodera (`ChronographAnchor`:
 * źródło, rewizja klipu, kursor, transakcja, opcjonalnie para A/B) w postaci base64url JSON. Rozwiązanie kotwicy
 * należy do `resolveChronographAnchor` (backend/model); tu tylko zapis, odczyt i teksty powodów.
 */
export type QuestionLink = { workspace: ChronographDemo; anchor: unknown | null; broken: boolean };

const toB64Url = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64Url = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));

export function readQuestionLink(hash: string): QuestionLink | null {
  const [view, query] = hash.split('?', 2);
  if (view !== '#orderflow' || !query) return null;
  const q = new URLSearchParams(query);
  const workspace = q.get('w');
  if (workspace !== 'level' && workspace !== 'flip') return null;
  const raw = q.get('a');
  if (!raw) return { workspace, anchor: null, broken: false };
  try { return { workspace, anchor: JSON.parse(fromB64Url(raw)), broken: false }; } catch { return { workspace, anchor: null, broken: true }; }
}

/** Rynek i widok, do których należy kotwica pytania (archiwum v1: tylko BTC perp na Hyperliquid). */
export const QUESTION_LINK_MARKET = 'BTC';

export type QuestionLinkConflict = {
  reason: 'market' | 'workspace';
  /** Surowy parametr `m` z adresu, przed normalizacją rynku (null, gdy brak). */
  market: string | null;
  /** Surowy parametr `w` z adresu (null, gdy brak). */
  workspace: string | null;
  /** Klip zapisany w kotwicy, gdy da się go odczytać. */
  clip: ChronographDemo | null;
};

/**
 * Zgodność adresu z kotwicą pytania, sprawdzana PRZED normalizacją rynku i przed wyborem danych.
 * Tylko adres z kotwicą (`a`) podlega kontroli; zwykły link na żywo zachowuje dotychczasowe zachowanie.
 * Konflikt: jawny rynek inny niż rynek kotwicy albo `w` inne niż klip kotwicy (lub brak `w`).
 */
export function questionLinkConflict(hash: string): QuestionLinkConflict | null {
  const [view, query] = hash.split('?', 2);
  if (view !== '#orderflow' || !query) return null;
  const q = new URLSearchParams(query);
  const raw = q.get('a');
  if (!raw) return null;
  let anchor: unknown = null;
  try { anchor = JSON.parse(fromB64Url(raw)); } catch { anchor = null; }
  const clipValue = anchor && typeof anchor === 'object' ? (anchor as { clip?: unknown }).clip : undefined;
  const clip: ChronographDemo | null = clipValue === 'level' || clipValue === 'flip' ? clipValue : null;
  const market = q.get('m');
  const workspace = q.get('w');
  if (market !== null && market !== QUESTION_LINK_MARKET) return { reason: 'market', market, workspace, clip };
  // Kotwica nieczytelna: pytanie pokaże powód „uszkodzony” tylko w widoku nagrania; inne `w` to konflikt widoku
  if (clip ? workspace !== clip : workspace !== 'level' && workspace !== 'flip') return { reason: 'workspace', market, workspace, clip };
  return null;
}

/** Adres pytania z rynkiem i widokiem kotwicy — tylko do jawnego przejścia przez użytkownika, nigdy do cichej naprawy. */
export function conflictRepairHash(hash: string, conflict: QuestionLinkConflict): string | null {
  if (!conflict.clip) return null;
  const q = new URLSearchParams(hash.split('?', 2)[1] ?? '');
  const a = q.get('a');
  if (!a) return null;
  const next = new URLSearchParams({ m: QUESTION_LINK_MARKET, w: conflict.clip });
  next.set('a', a);
  return '#orderflow?' + next.toString();
}

export function questionHash(market: string, workspace: ChronographDemo, anchor: unknown | null): string {
  const q = new URLSearchParams({ m: market, w: workspace });
  if (anchor) q.set('a', toB64Url(JSON.stringify(anchor)));
  return '#orderflow?' + q.toString();
}

/** Zapis bez nowego wpisu historii (Wstecz nie przechodzi po każdym wyborze w pytaniu). */
export function writeQuestionLink(market: string, workspace: ChronographDemo, anchor: unknown | null): void {
  const next = questionHash(market, workspace, anchor);
  if (window.location.hash !== next) window.history.replaceState(window.history.state, '', next);
}

type Reason = Extract<ChronographAnchorResult, { kind: 'unavailable' }>['reason'];

/** Zdanie dla użytkownika: co jest niedostępne i że niczego nie podstawiono. */
/** Zdanie o konflikcie adresu i kotwicy: co jest w adresie, czego dotyczy pytanie, i że niczego nie otwarto. */
export function linkConflictText(c: QuestionLinkConflict): string {
  const clipName = c.clip === 'level' ? tr('próba poziomu', 'level test') : c.clip === 'flip' ? tr('powtórka zmiany delty', 'delta flip replay') : null;
  if (c.reason === 'market') return tr(
    `Rynek w adresie (${c.market}) nie zgadza się z pytaniem z linku, które dotyczy nagrania BTC perp z Hyperliquid. Nie otwarto wyniku i nie zmieniono adresu.`,
    `The market in the address (${c.market}) does not match the linked question, which is about the Hyperliquid BTC perp recording. No result was opened and the address was not changed.`);
  return clipName
    ? tr(`Widok w adresie (${c.workspace ?? 'brak'}) nie zgadza się z nagraniem zapisanym w pytaniu (${clipName}). Nie otwarto wyniku i nie zmieniono adresu.`,
      `The view in the address (${c.workspace ?? 'none'}) does not match the recording saved in the question (${clipName}). No result was opened and the address was not changed.`)
    : tr(`Link do pytania jest uszkodzony, a widok w adresie (${c.workspace ?? 'brak'}) nie jest nagraniem. Nic nie otwarto.`,
      `The question link is damaged and the view in the address (${c.workspace ?? 'none'}) is not a recording. Nothing was opened.`);
}

export function anchorReasonText(reason: Reason | 'broken'): string {
  switch (reason) {
    case 'broken': case 'invalid-anchor': return tr('Link do pytania jest uszkodzony. Nic nie otwarto.', 'The question link is damaged. Nothing was opened.');
    case 'wrong-source': return tr('Link dotyczy innego rynku lub źródła danych. Nic nie podstawiono.', 'The link refers to another market or data source. Nothing was substituted.');
    case 'wrong-revision': return tr('Link dotyczy innej wersji nagrania. Nie podstawiono transakcji z tej wersji.', 'The link refers to another recording version. No trade from this version was substituted.');
    case 'trade-missing': return tr('Transakcji z linku nie ma w tej wersji nagrania. Nie podstawiono innej.', 'The linked trade is not in this recording version. No other trade was substituted.');
    case 'trade-conflict': return tr('Pod kluczem z linku jest inna transakcja (inna cena, ilość lub strona). Nie podstawiono jej.', 'A different trade (price, size or side) sits under the linked key. It was not substituted.');
    case 'trade-after-cursor': return tr('Transakcja z linku jest po kursorze. Dane z przyszłości nie są pokazywane.', 'The linked trade is after the cursor. Future data is not shown.');
    case 'tape-gap': return tr('Taśma nie ma pokrycia w chwili transakcji z linku.', 'The tape has no coverage at the linked trade time.');
    case 'book-gap': return tr('Brak ciągłości arkusza między migawkami A i B z linku. Wybierz parę ponownie.', 'Book coverage between the linked A and B snapshots is incomplete. Choose a pair again.');
    case 'book-after-cursor': return tr('Migawka B z linku jest po kursorze. Odsłoń ją jawnie przyciskiem „Pokaż późniejszą migawkę”.', 'The linked snapshot B is after the cursor. Reveal it explicitly with “Show later snapshot”.');
    case 'book-missing': return tr('Para A–B z linku nie występuje przy tej cenie w tej wersji nagrania.', 'The linked A–B pair does not exist at this price in this recording version.');
  }
}
