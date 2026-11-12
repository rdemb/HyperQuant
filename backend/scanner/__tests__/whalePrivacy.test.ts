import { describe, expect, it } from 'vitest';
import { CohortEngine } from '../cohortEngine.ts';

/**
 * Pomiar przed drabiną ziarnistości: w ilu zamkniętych kubełkach z ostatnich 7 dób kohorta wielorybów przechodzi próg
 * prywatności (co najmniej 5 uczestników, nikt powyżej 50% obrotu) przy ziarnie 15 min, 1 h i 4 h. Same liczniki, bez
 * komórek i adresów.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 10, 12, 0, 0); // pełna godzina i pełne 4 h UTC
const addr = (tag: string, i: number) => `0x${tag}${String(i).padStart(39 - tag.length + 1, '0')}`;
const W = (i: number) => addr('ee', i); // wieloryb
const R = (i: number) => addr('cc', i); // reszta
const opts = { coin: 'BTC', isWhale: (a: string) => a.startsWith('0xee') };

/** Transakcja wieloryba `w` z kontem z reszty (kupuje wieloryb) o wartości `usd`. */
const whaleTrade = (e: CohortEngine, w: number, t: number, usd = 100_000) => e.onTrade({ users: [W(w), R(w + 1000)], side: 'B', px: 100_000, sz: usd / 100_000, time: t });
/** Transakcja w samej reszcie (kubełek istnieje, wieloryby bez aktywności). */
const restTrade = (e: CohortEngine, t: number) => e.onTrade({ users: [R(1), R(2)], side: 'A', px: 100_000, sz: 0.1, time: t });
/** Silnik obserwujący od T0: kwadranse od T0 są obserwowane w całości (wcześniejsze częściowo — nie liczone). */
const engine = () => {
  const e = new CohortEngine(opts);
  restTrade(e, T0);
  return e;
};

/** Godzina od `h0`: kwadrans 1 — wieloryby 0–2, kwadrans 2 — wieloryby 3–5, kwadranse 3 i 4 — sama reszta. */
function hourOfThreeAndThree(e: CohortEngine, h0: number) {
  for (const w of [0, 1, 2]) whaleTrade(e, w, h0 + MIN + w * 1000);
  for (const w of [3, 4, 5]) whaleTrade(e, w, h0 + 16 * MIN + w * 1000);
  restTrade(e, h0 + 31 * MIN);
  restTrade(e, h0 + 46 * MIN);
}

describe('whalePrivacy: liczniki kubełków wielorybów nad progiem prywatności', () => {
  it('trzech uczestników w kwadransie i sześciu w godzinie: m15.ok = 0, h1.ok = 1', () => {
    const e = engine();
    hourOfThreeAndThree(e, T0);
    const now = T0 + HOUR + MIN;
    e.housekeep(now);
    const p = e.whalePrivacy(now);
    // Kwadranse bez aktywności wielorybów nie są liczone (nic nie ujawniają)
    expect(p.m15).toEqual({ ok: 0, n: 2 });
    expect(p.h1).toEqual({ ok: 1, n: 1 });
    // Okno 4 h (12:00–16:00) jeszcze się nie zamknęło
    expect(p.h4).toEqual({ ok: 0, n: 0 });
  });

  it('pięciu uczestników, ale jeden ponad 50% obrotu: kubełek nie przechodzi progu', () => {
    const e = engine();
    whaleTrade(e, 0, T0 + MIN, 1_000_000);
    for (const w of [1, 2, 3, 4]) whaleTrade(e, w, T0 + 2 * MIN + w * 1000, 100_000);
    for (const w of [5, 6, 7, 8, 9]) whaleTrade(e, w, T0 + 16 * MIN + w * 1000, 100_000);
    e.housekeep(T0 + 31 * MIN);
    expect(e.whalePrivacy(T0 + 31 * MIN).m15).toEqual({ ok: 1, n: 2 });
  });

  it('okno 4 h: 16 kwadransów, w każdym inny wieloryb — h4 przechodzi, każda godzina i kwadrans nie', () => {
    const e = engine();
    for (let q = 0; q < 16; q++) whaleTrade(e, q, T0 + q * 15 * MIN + MIN);
    const now = T0 + 4 * HOUR + MIN;
    e.housekeep(now);
    const p = e.whalePrivacy(now);
    expect(p.m15).toEqual({ ok: 0, n: 16 });
    expect(p.h1).toEqual({ ok: 0, n: 4 });
    expect(p.h4).toEqual({ ok: 1, n: 1 });
  });

  it('godzina z brakującym kwadransem (przerwa w danych) nie jest liczona', () => {
    const e = engine();
    for (const w of [0, 1, 2]) whaleTrade(e, w, T0 + MIN + w * 1000);
    for (const w of [3, 4, 5]) whaleTrade(e, w, T0 + 16 * MIN + w * 1000);
    restTrade(e, T0 + 46 * MIN); // kwadrans 12:30 bez żadnej transakcji
    e.housekeep(T0 + HOUR + MIN);
    expect(e.whalePrivacy(T0 + HOUR + MIN).h1).toEqual({ ok: 0, n: 0 });
  });

  it('okno 7 dób: starsze kubełki wypadają', () => {
    const e = engine();
    hourOfThreeAndThree(e, T0);
    e.housekeep(T0 + HOUR + MIN);
    const later = T0 + 7 * DAY + 2 * HOUR;
    e.housekeep(later);
    expect(e.whalePrivacy(later)).toEqual({ m15: { ok: 0, n: 0 }, h1: { ok: 0, n: 0 }, h4: { ok: 0, n: 0 } });
  });

  it('kwadrans obserwowany częściowo (start silnika w jego trakcie) nie jest liczony, jak w publikacji', () => {
    const e = new CohortEngine(opts);
    for (const w of [0, 1, 2, 3, 4]) whaleTrade(e, w, T0 + MIN + w * 1000);
    e.housekeep(T0 + 16 * MIN);
    expect(e.whalePrivacy(T0 + 16 * MIN).m15).toEqual({ ok: 0, n: 0 });
  });

  it('bez adresów i komórek: same liczby', () => {
    const e = engine();
    hourOfThreeAndThree(e, T0);
    e.housekeep(T0 + HOUR + MIN);
    const txt = JSON.stringify(e.whalePrivacy(T0 + HOUR + MIN));
    expect(txt).not.toMatch(/0x/);
    expect(Object.keys(JSON.parse(txt))).toEqual(['m15', 'h1', 'h4']);
  });

  it('restart skanera: liczniki i niedomknięta godzina przetrwają zapis stanu; stary stan bez pola — od zera', () => {
    const e = engine();
    // Pierwsze dwa kwadranse przed restartem, dwa po nim
    for (const w of [0, 1, 2]) whaleTrade(e, w, T0 + MIN + w * 1000);
    for (const w of [3, 4, 5]) whaleTrade(e, w, T0 + 16 * MIN + w * 1000);
    e.housekeep(T0 + 31 * MIN);
    const back = CohortEngine.fromJSON(JSON.parse(JSON.stringify(e.toJSON())), opts);
    expect(back.whalePrivacy(T0 + 31 * MIN).m15).toEqual({ ok: 0, n: 2 });
    restTrade(back, T0 + 31 * MIN);
    restTrade(back, T0 + 46 * MIN);
    back.housekeep(T0 + HOUR + MIN);
    expect(back.whalePrivacy(T0 + HOUR + MIN).h1).toEqual({ ok: 1, n: 1 });

    const old = e.toJSON() as Record<string, unknown>;
    delete old.privacy;
    expect(CohortEngine.fromJSON(old, opts).whalePrivacy(T0 + 31 * MIN)).toEqual({ m15: { ok: 0, n: 0 }, h1: { ok: 0, n: 0 }, h4: { ok: 0, n: 0 } });
  });
});
