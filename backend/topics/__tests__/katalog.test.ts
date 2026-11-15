import { describe, expect, it } from 'vitest';
import { sessionOpens } from '../../../src/charts/pro/core/sessions';
import { COOLDOWN_MS, DAY_CAP, type Snap, emptyState, evaluate, opensOf, snapFrom } from '../katalog';

const T0 = Date.UTC(2026, 10, 16, 3, 0); // 03:00 UTC, przed otwarciami
const s = (p: Partial<Snap>): Snap => ({ at: T0, price: 100, pdh: 110, pdl: 90, move15: 0.2, ...p });

describe('tematy 24/7: katalog', () => {
  it('pierwsza migawka i przerwa w danych > 10 min nie dają zdarzeń', () => {
    const a = evaluate(emptyState(), s({ price: 120 }));
    expect(a.events).toEqual([]);
    const b = evaluate(a.state, s({ at: T0 + 11 * 60_000, price: 100 }));
    expect(b.events).toEqual([]);
  });

  it('przecięcie PDH i PDL; przerwa 10 min na temat; limit dzienny', () => {
    let st = evaluate(emptyState(), s({})).state;
    let r = evaluate(st, s({ at: T0 + 30_000, price: 111 }));
    expect(r.events.map((e) => e.topic)).toEqual(['pdh']);
    st = r.state;
    r = evaluate(st, s({ at: T0 + 60_000, price: 109 }));
    expect(r.events).toEqual([]); // przerwa
    st = r.state;
    r = evaluate(st, s({ at: T0 + 30_000 + COOLDOWN_MS + 1000, price: 111 }));
    expect(r.events.map((e) => e.topic)).toEqual(['pdh']);
    // Limit: po DAY_CAP zdarzeniach w dobie temat milknie
    let state = evaluate(emptyState(), s({})).state;
    let n = 0;
    // Krok równy przerwie (nie dłuższy niż 10 min — dłuższa luka w danych to brak zdarzeń); 30 kroków od 00:00 UTC, przed Londynem
    const D0 = Date.UTC(2026, 10, 16, 0, 0);
    state = evaluate(emptyState(), s({ at: D0 })).state;
    for (let i = 1; i <= 30; i++) {
      const out = evaluate(state, s({ at: D0 + i * COOLDOWN_MS, price: i % 2 ? 111 : 109 }));
      n += out.events.filter((e) => e.topic === 'pdh').length;
      state = out.state;
    }
    expect(n).toBe(DAY_CAP);
    expect(evaluate(state, s({ at: D0 + 31 * COOLDOWN_MS, price: 89 })).events.map((e) => e.topic)).toEqual(['pdl']);
  });

  it('otwarcia Londynu i Nowego Jorku te same co w aplikacji (czas letni i zimowy); zdarzenie raz przy przejściu', () => {
    for (const d of [Date.UTC(2026, 10, 16), Date.UTC(2026, 6, 1), Date.UTC(2026, 2, 9)]) {
      const [, london, ny] = sessionOpens(d);
      expect(opensOf(d + 3_600_000)).toEqual({ london, ny });
    }
    const { london } = opensOf(T0);
    const st = evaluate(emptyState(), s({ at: london - 20_000 })).state;
    const r = evaluate(st, s({ at: london + 10_000 }));
    expect(r.events.map((e) => e.topic)).toEqual(['sesje']);
    expect(r.events[0].message).toMatch(/Londynu/);
  });

  it('ruch ≥ 1% w 15 min tylko przy wejściu ponad próg', () => {
    const st = evaluate(emptyState(), s({ move15: 0.5 })).state;
    const r = evaluate(st, s({ at: T0 + 30_000, move15: 1.3 }));
    expect(r.events.map((e) => e.topic)).toEqual(['ruch']);
    expect(evaluate(r.state, s({ at: T0 + 60_000, move15: 1.6 })).events).toEqual([]);
  });

  it('treść: opis stanu po polsku i angielsku, bez kierunku i bez porady', () => {
    const st = evaluate(emptyState(), s({ move15: 0.5 })).state;
    const r = evaluate(st, s({ at: T0 + 30_000, price: 111, move15: 1.3 }));
    for (const e of r.events) {
      expect(`${e.title} ${e.message} ${e.tags}`).not.toMatch(/sygna|signal|kup|sprzeda|buy|sell|long|short|wzrost|spadek|up|down|bull|bear/i);
      expect(e.message).toMatch(/·/);
    }
  });

  it('migawka ze świec: cena, PDH/PDL poprzedniej doby UTC, ruch od zamknięcia sprzed 15 min', () => {
    const at = Date.UTC(2026, 10, 16, 12, 0);
    const m1 = Array.from({ length: 20 }, (_, i) => ({ t: at - (19 - i) * 60_000, c: 100 + i }));
    const d1 = [{ t: Date.UTC(2026, 10, 15), h: 130, l: 80 }, { t: Date.UTC(2026, 10, 16), h: 125, l: 95 }];
    expect(snapFrom(at, m1, d1)).toEqual({ at, price: 119, pdh: 130, pdl: 80, move15: ((119 - 104) / 104) * 100 });
    expect(snapFrom(at, [], d1)).toBeNull();
  });
});
