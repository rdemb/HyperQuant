import { replayHash } from '../charts/pro/replay/link';
import type { Market } from '../charts/pro/store/proStore';
import type { MarketCaps } from './marketCaps';
import { HIST_HOUR_MS, type HistoryIndex } from './tapeHistory';

/**
 * Pierwszy kontakt z ekranem W sesji: dymki objaśniające i przycisk „Powtórka ostatnich 15 min”. Zapis pierwszej wizyty
 * (`hq.onboarding.v1`) w utils/firstVisit — bez modułów wykresu, bo zapisuje go już start aplikacji (DeskProvider).
 */
export { ONBOARDING_KEY, QUICK_REPLAY_WINDOW_MS, isFirstVisit, markSeen, quickReplayVisible, startOnboarding, tipsPending } from './firstVisit';

/** Okno powtórki: ostatnie 15 minut. */
export const QUICK_REPLAY_MS = 15 * 60_000;
/** Najmniej minut okna, które musi pokrywać nagranie, żeby powtórka miała sens. */
export const QUICK_REPLAY_MIN_COVER_MS = 10 * 60_000;

/**
 * Escape zamyka kartę tylko, gdy fokus jest w niej i nikt inny nie obsłużył klawisza (okno, menu, pole): Esc gdzie indziej
 * na ekranie ma swoje znaczenie. Zwraca true, gdy zamknął.
 */
export function dismissOnEscape(e: { key: string; defaultPrevented: boolean; target: unknown }, card: { contains(n: never): boolean } | null, close: () => void): boolean {
  if (e.key !== 'Escape' || e.defaultPrevented || !card || !card.contains(e.target as never)) return false;
  close();
  return true;
}

export type QuickReplay = { ok: true; hash: string } | { ok: false; reason: 'market' | 'no-recording' };

/** Suma minut okna [from, to], które pokrywają pliki godzin i części ze spisu (nakładanie liczone raz, luki nie liczą się). */
function coveredMs(index: HistoryIndex, coin: string, from: number, to: number): number {
  const m = index.markets[coin];
  if (!m) return 0;
  const spans = [...m.hours.map((h) => [h, h + HIST_HOUR_MS]), ...m.parts.map((p) => [p, p + index.partMs])]
    .map(([a, b]) => [Math.max(a, from), Math.min(b, to)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let sum = 0;
  let end = from;
  for (const [a, b] of spans) {
    if (b <= end) continue;
    sum += b - Math.max(a, end);
    end = b;
  }
  return sum;
}

/**
 * Link powtórki ostatnich 15 min na Kokpicie. Nagranie serwera jest dla rynków z pełnym skanerem (`caps.scanner` z rejestru;
 * inny rynek — powód `market`). Gdy pliki ze spisu (godziny i części, każdy ucięty do okna [now − 15 min, now]) pokrywają razem mniej
 * niż 10 min — albo nie ma spisu — wynik to `no-recording`, zamiast niemal pustej powtórki; luki w nagraniu nie liczą się.
 */
export function quickReplay(coin: Market, caps: Pick<MarketCaps, 'scanner'>, now: number, index: HistoryIndex | null): QuickReplay {
  if (!caps.scanner) return { ok: false, reason: 'market' };
  const from = now - QUICK_REPLAY_MS;
  if (!index || coveredMs(index, coin, from, now) < QUICK_REPLAY_MIN_COVER_MS) return { ok: false, reason: 'no-recording' };
  return { ok: true, hash: replayHash({ source: 'history', coin, from, to: now, station: 'cockpit' }) };
}
