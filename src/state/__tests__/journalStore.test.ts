import { describe, expect, it } from 'vitest';
import { createJournalStore } from '../journalStore';
import { serializeJournal, type Journal, type Trade } from '../../utils/tradeJournal';

const KEY = 'hq.journal.v1';
const tr = (id: string): Trade => ({
  id, setupId: null, dir: 'LONG', entryT: Date.UTC(2026, 9, 22, 10), entryPx: 100_000, stopPx: 99_500,
  exitT: null, exitPx: null, sizeBtc: null, note: '', mae: null, mfe: null, ctx: null,
});
function mem(init: Record<string, string> = {}, opts: { failWrites?: boolean } = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts.failWrites && k === KEY) throw new Error('QuotaExceededError');
      m.set(k, v);
    },
  };
}
const J = (trades: Trade[]): Journal => ({ v: 1, setups: [], trades });

describe('journalStore — trwałość dziennika', () => {
  it('zapis czyta najpierw aktualny stan pamięci (zmiany z innej karty nie giną)', () => {
    const s = mem({ [KEY]: serializeJournal(J([tr('a')])) });
    const store = createJournalStore(s);
    s.m.set(KEY, serializeJournal(J([tr('a'), tr('z-innej-karty')]))); // inna karta dopisała
    store.update((j) => ({ ...j, trades: [tr('b'), ...j.trades] }));
    expect(store.get().journal.trades.map((t) => t.id)).toEqual(['b', 'a', 'z-innej-karty']);
    expect(JSON.parse(s.m.get(KEY)!).trades).toHaveLength(3);
  });

  it('błąd zapisu (pełna pamięć) jest zgłaszany, a zmiany zostają w pamięci strony', () => {
    const store = createJournalStore(mem({}, { failWrites: true }));
    store.update((j) => ({ ...j, trades: [tr('x')] }));
    expect(store.get().saveError).toBe(true);
    store.update((j) => ({ ...j, trades: [...j.trades, tr('y')] }));
    expect(store.get().journal.trades.map((t) => t.id)).toEqual(['x', 'y']);
  });

  it('uszkodzony zapis: kopia surowej wartości przed nadpisaniem i informacja dla użytkownika', () => {
    const s = mem({ [KEY]: '{nie json' });
    const store = createJournalStore(s);
    expect(store.get().recovered).toBe(`${KEY}.uszkodzony`);
    expect(s.m.get(`${KEY}.uszkodzony`)).toBe('{nie json');
    store.update((j) => ({ ...j, trades: [tr('n')] }));
    expect(s.m.get(`${KEY}.uszkodzony`)).toBe('{nie json');
  });

  it('subskrybenci dostają zmiany; reload() po zdarzeniu storage innej karty', () => {
    const s = mem();
    const store = createJournalStore(s);
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.update((j) => ({ ...j, trades: [tr('q')] }));
    s.m.set(KEY, serializeJournal(J([tr('q'), tr('r')])));
    store.reload();
    expect(store.get().journal.trades).toHaveLength(2);
    expect(calls).toBe(2);
    off();
  });
});
