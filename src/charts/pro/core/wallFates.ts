import type { BookFrame } from './book';
import { type TradeScan, levelKey as key, onGrid, tradedAt } from './ladder';

/**
 * Losy ścian arkusza: duży poziom (od `minUsd`) śledzony przez kolejne migawki jednej agregacji. Gdy zniknie albo
 * spadnie poniżej END_SHARE swojego szczytu, dostaje werdykt: zjedzona (spadek pokryły transakcje na tym kubełku)
 * przesunięta (w tej samej migawce tyle samo przybyło na sąsiednich poziomach tej strony — zwykle animator rynku
 * przestawia kwotowanie za ceną) albo zdjęta (spadek bez transakcji i bez przeniesienia). Porównanie jest netto między migawkami (ok. 5 s):
 * zlecenia dołożone i zdjęte w tym czasie się znoszą, a zlecenie krótsze niż odstęp migawek jest niewidoczne.
 * Kubełki Hyperliquid (sprawdzone na zapisie rejestratora 1.11): bid b obejmuje ceny [b, b + krok), ask a — (a − krok, a].
 */

export type WallVerdict = 'eaten' | 'moved' | 'pulled';

export interface WallFate {
  /** Migawka, w której ściana się skończyła (ms). */
  t: number;
  /** Pierwsza migawka ściany. */
  since: number;
  px: number;
  bid: boolean;
  /** Największa wartość poziomu w czasie życia ściany (USD). */
  peakUsd: number;
  /** Ubytek pokryty transakcjami na kubełku, przeniesiony na sąsiednie poziomy i bez śladu (USD), sumy z całego życia ściany. */
  eatenUsd: number;
  movedUsd: number;
  pulledUsd: number;
  /** Transakcje na kubełku ponad widoczny ubytek (zlecenia uzupełniane w trakcie), USD. */
  refillUsd: number;
  /** Czy na kubełku była jakakolwiek transakcja w czasie życia ściany. */
  touched: boolean;
  verdict: WallVerdict;
}

/** Ściana nadal w arkuszu (stan do drabiny). */
export interface OpenWall {
  px: number;
  bid: boolean;
  since: number;
  usd: number;
  peakUsd: number;
  eatenUsd: number;
  movedUsd: number;
  pulledUsd: number;
  refillUsd: number;
}

/** Koniec ściany: poziom spadł poniżej tej części szczytu. */
export const END_SHARE = 0.25;
/** Przerwa w migawkach dłuższa niż tyle ms (zerwane połączenie, luka zapisu) zrywa śledzenie bez werdyktu. */
export const MAX_GAP_MS = 20_000;
/** Ściana poza widocznymi poziomami czeka najwyżej tyle ms na powrót ceny w zasięg; potem znika bez werdyktu. */
export const BEYOND_MS = 60_000;
/** Przesunięcie: przyrost na tylu sąsiednich poziomach tej samej strony (w krokach agregacji) w obie strony. */
export const MOVE_LEVELS = 3;

interface Track extends OpenWall {
  prevUsd: number;
  lastSeen: number;
}

/** Cena głębiej niż najdalszy widoczny poziom tej strony migawki. */
function beyond(f: BookFrame, bid: boolean, px: number): boolean {
  if (bid) return f.nBids === 0 || px < f.px[f.nBids - 1];
  return f.px.length === f.nBids || px > f.px[f.px.length - 1];
}

function verdictOf(w: OpenWall): WallVerdict {
  if (w.eatenUsd >= w.movedUsd && w.eatenUsd >= w.pulledUsd) return 'eaten';
  return w.movedUsd >= w.pulledUsd ? 'moved' : 'pulled';
}

/**
 * Losy ścian z migawek jednej agregacji (rosnąco po czasie) i taśmy. Zwraca zakończone ściany (rosnąco po czasie
 * końca) i ściany nadal w arkuszu po ostatniej migawce.
 */
export function wallFates(frames: readonly BookFrame[], scan: TradeScan, minUsd: number): { fates: WallFate[]; open: OpenWall[] } {
  const live = new Map<string, Track>();
  const fates: WallFate[] = [];
  const end = (w: Track, t: number) => {
    fates.push({
      t,
      since: w.since,
      px: w.px,
      bid: w.bid,
      peakUsd: w.peakUsd,
      eatenUsd: w.eatenUsd,
      movedUsd: w.movedUsd,
      pulledUsd: w.pulledUsd,
      refillUsd: w.refillUsd,
      touched: w.eatenUsd + w.refillUsd > 0,
      verdict: verdictOf(w),
    });
  };
  let prev: BookFrame | null = null;
  let was = new Map<string, number>();
  for (const f of frames) {
    if (prev && f.t - prev.t > MAX_GAP_MS) live.clear();
    const step = f.step;
    const traded = prev && live.size > 0 ? tradedAt(scan, prev.t + 1, f.t + 1, step) : null;
    const now = new Map<string, number>();
    for (let i = 0; i < f.px.length; i++) now.set(key(i < f.nBids, f.px[i]), f.sz[i] * f.px[i]);
    // Przyrost netto sąsiednich poziomów od poprzedniej migawki — miejsce, dokąd mogła przejść zdjęta ściana
    // (netto, więc zwykła rotacja zleceń obok, gdzie tyle samo przybywa i ubywa, nie udaje przeniesienia)
    const grown = (bid: boolean, px: number): number => {
      let g = 0;
      for (let d = -MOVE_LEVELS; d <= MOVE_LEVELS; d++) {
        if (d === 0) continue;
        const k = key(bid, onGrid(px + d * step, step));
        g += (now.get(k) ?? 0) - (was.get(k) ?? 0);
      }
      return Math.max(0, g);
    };

    for (const [k, w] of live) {
      const tr = traded?.get(k) ?? 0;
      const cur = now.get(k);
      if (cur === undefined && beyond(f, w.bid, w.px)) {
        // Poza zasięgiem migawki: transakcje tu nie trafiają (cena daleko), czekamy na powrót
        if (f.t - w.lastSeen > BEYOND_MS) live.delete(k);
        continue;
      }
      const usd = cur ?? 0;
      const drop = Math.max(0, w.prevUsd - usd);
      const eaten = Math.min(drop, tr);
      const moved = drop > eaten ? Math.min(drop - eaten, grown(w.bid, w.px)) : 0;
      w.eatenUsd += eaten;
      w.movedUsd += moved;
      w.pulledUsd += drop - eaten - moved;
      w.refillUsd += tr - eaten;
      w.prevUsd = usd;
      w.usd = usd;
      w.lastSeen = f.t;
      if (usd > w.peakUsd) w.peakUsd = usd;
      if (usd < END_SHARE * w.peakUsd) {
        end(w, f.t);
        live.delete(k);
      }
    }

    for (let i = 0; i < f.px.length; i++) {
      const usd = f.sz[i] * f.px[i];
      if (usd < minUsd) continue;
      const bid = i < f.nBids;
      const k = key(bid, f.px[i]);
      if (live.has(k)) continue;
      live.set(k, { px: f.px[i], bid, since: f.t, usd, peakUsd: usd, eatenUsd: 0, movedUsd: 0, pulledUsd: 0, refillUsd: 0, prevUsd: usd, lastSeen: f.t });
    }
    prev = f;
    was = now;
  }
  const open: OpenWall[] = [];
  for (const w of live.values()) {
    if (w.lastSeen !== prev?.t) continue;
    open.push({ px: w.px, bid: w.bid, since: w.since, usd: w.usd, peakUsd: w.peakUsd, eatenUsd: w.eatenUsd, movedUsd: w.movedUsd, pulledUsd: w.pulledUsd, refillUsd: w.refillUsd });
  }
  return { fates, open };
}

/** Próg ściany: kwantyl `q` wartości poziomów (USD) z migawek, nie niżej niż `floorUsd`. */
export function wallThreshold(frames: readonly BookFrame[], floorUsd: number, q = 0.95): number {
  const xs: number[] = [];
  for (const f of frames) for (let i = 0; i < f.px.length; i++) xs.push(f.sz[i] * f.px[i]);
  if (xs.length === 0) return floorUsd;
  xs.sort((a, b) => a - b);
  return Math.max(floorUsd, xs[Math.min(xs.length - 1, Math.floor(q * xs.length))]);
}
