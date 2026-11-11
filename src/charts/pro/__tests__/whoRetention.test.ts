import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Fill, Side } from '../hl/parse';
import { HlStream } from '../hl/stream';
import { ProStore, RETENTION_MS } from '../store/proStore';

const M = 60_000;
const H = 60 * M;
const T0 = Date.UTC(2026, 10, 7, 11);
const PX = 80_000;
let tid = 0;
const fill = (time: number, side: Side, usd: number, taker: string, maker: string): Fill => ({ time, px: PX, sz: usd / PX, side, tid: tid++, hash: '', taker, maker });

const store = () => new ProStore(new HlStream({ wsFactory: () => ({}) as WebSocket }));
/** Historia serwera [T0, T0 + 2 h) z taśmą z kontami przez cały odcinek. */
const load = (s: ProStore, fills: Fill[]) =>
  s.restoreHistory({ trades: { from: T0, to: T0 + 2 * H, spans: [[T0, T0 + 2 * H]], zeroSpans: [], fills, oi: [] }, frames: [] });
/** Sprzątanie jak co minutę w działającej stronie (metoda prywatna; `start` otwiera połączenia). */
const prune = (s: ProStore) => (s as unknown as { prune(): void }).prune();

/**
 * Biorca a: 600 tys. USD o 11:10 i 600 tys. w świecy 11:45 (razem próg BTC 1 mln w jej oknie); biorca c sprzedaje w tej świecy.
 * Maker y po obu stronach w minutach 25–45 (21 z 46 minut taśmy w oknie — reszta), maker z raz w świecy 11:45.
 */
function history(): Fill[] {
  const out = [fill(T0 + 10 * M, 1, 600_000, 'a', 'z'), fill(T0 + 45 * M + 500, 1, 600_000, 'a', 'z'), fill(T0 + 45 * M + 1000, -1, 300_000, 'c', 'z')];
  // Biorca d: 600 tys. o 11:05 i 300 tys. w świecy — 900 tys., reszta (zdublowane 11:05 dałoby 1,5 mln)
  out.push(fill(T0 + 5 * M, 1, 600_000, 'd', 'z'), fill(T0 + 45 * M + 1500, 1, 300_000, 'd', 'z'));
  for (let k = 25; k <= 45; k++) out.push(fill(T0 + k * M + 2000, k % 2 ? 1 : -1, 20_000, 'b', 'y'));
  return out.sort((p, q) => p.time - q.time);
}

describe('Kto handluje i makerzy: najstarsza świeca na krawędzi retencji', () => {
  afterEach(() => vi.useRealTimers());

  // Świeca 1m 11:45 zamknięta 23 h 30 min temu: jej okno (10:46–11:46) zaczyna się przed granicą retencji (11:16)
  const t = T0 + 45 * M;
  const now = t + M + 23 * H + 30 * M;

  it('wartość zamkniętej świecy przed sprzątaniem i po nim jest ta sama', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    expect(now - RETENTION_MS).toBe(T0 + 16 * M);
    const s = store();
    load(s, history());
    const before = { players: s.players.split(t, M, now), makers: s.makerSplit(t, t + M) };
    expect(before.players!.big).toBeCloseTo(7.5, 9);
    expect(before.makers!.mmShare).toBe(0);
    prune(s);
    expect({ players: s.players.split(t, M, now), makers: s.makerSplit(t, t + M) }).toEqual(before);
  });

  it('historia sprzed granicy sprzątania nie oznacza okna jako pełnego (zleceń sprzed granicy już się nie składa)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const s = store();
    // granica sprzątania (T0 + 16 min) ustalona przed wczytaniem pliku [T0, T0 + 2 h)
    prune(s);
    load(s, history());
    // świeca 1m 12:10: okno 11:11–12:11 sięga przed granicę 11:16
    expect(s.players.split(T0 + 70 * M, M, now)!.complete).toBe(false);
    // świeca 1m 12:20: okno 11:21–12:21 w całości po granicy
    expect(s.players.split(T0 + 80 * M, M, now)!.complete).toBe(true);
  });

  it('ponownie dostarczony plik historii sprzed granicy nie dubluje zleceń ani wypełnień po sprzątaniu', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const s = store();
    const file = history();
    load(s, file);
    const before = { players: s.players.split(t, M, now), makers: s.makerSplit(t, t + M) };
    prune(s);
    // Ten sam plik jeszcze raz (te same tid; np. po błędzie arkusza): taśma po sprzątaniu nie ma już jego początku
    load(s, file);
    expect({ players: s.players.split(t, M, now), makers: s.makerSplit(t, t + M) }).toEqual(before);
  });
});
