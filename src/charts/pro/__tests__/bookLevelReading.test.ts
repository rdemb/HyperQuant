import { describe, expect, it } from 'vitest';
import { BookHistory, readBookLevel, toFrame } from '../core/book';
import { parseBook } from '../hl/parse';

const level = (px: number, sz: unknown = '1') => ({ px, sz });

function capture(bids: unknown, asks: unknown) {
  const snapshot = parseBook({ coin: 'BTC', time: 10, levels: [bids, asks] }, 'BTC');
  if (!snapshot) throw new Error('Próbka powinna zawierać co najmniej jeden prawidłowy poziom');
  const history = new BookHistory(1);
  history.add(toFrame(snapshot, 1));
  const frame = history.latest();
  if (!frame) throw new Error('Brak migawki w historii');
  return frame;
}

describe('odczyt poziomu L2 z zachowaniem jakości strony', () => {
  it('odróżnia odrzucony BID w zakresie od zera w kompletnej stronie ASK', () => {
    const frame = capture([level(103), level(102, 'uszkodzone'), level(101)], [level(105), level(107)]);
    expect(frame.quality?.bid).toEqual({ kind: 'present', rejectedRows: 1, strictlyOrdered: true });
    expect(readBookLevel(frame, 'bid', 102)).toEqual({ kind: 'missing', reason: 'incomplete' });
    expect(readBookLevel(frame, 'bid', 103)).toEqual({ kind: 'observed', size: 1 });
    expect(readBookLevel(frame, 'ask', 106)).toEqual({ kind: 'empty', size: 0 });
    expect(readBookLevel(frame, 'ask', 104)).toEqual({ kind: 'missing', reason: 'outside-range' });
  });

  it.each([[level(103), level(103)], [level(101), level(103)]])('odrzuca odczyt z niemonotonicznej strony', (...bids) => {
    const frame = capture(bids, [level(105)]);
    expect(frame.quality?.bid).toEqual({ kind: 'present', rejectedRows: 0, strictlyOrdered: false });
    expect(readBookLevel(frame, 'bid', 103)).toEqual({ kind: 'missing', reason: 'invalid' });
  });

  it('brak strony i pustą stronę odróżnia w jakości, a żadna nie wyznacza zakresu', () => {
    const missing = capture(undefined, [level(105)]);
    const empty = capture([], [level(105)]);
    const rejected = capture([level(102, null)], [level(105)]);
    expect(missing.quality?.bid).toEqual({ kind: 'missing' });
    expect(empty.quality?.bid).toEqual({ kind: 'present', rejectedRows: 0, strictlyOrdered: true });
    expect(readBookLevel(missing, 'bid', 102)).toEqual({ kind: 'missing', reason: 'side' });
    expect(readBookLevel(empty, 'bid', 102)).toEqual({ kind: 'missing', reason: 'side' });
    expect(readBookLevel(rejected, 'bid', 102)).toEqual({ kind: 'missing', reason: 'incomplete' });
  });

  it('stare archiwum bez jakości pozwala odczytać tylko jawnie zapisany poziom', () => {
    const frame = { ...capture([level(103), level(101)], []), quality: undefined };
    expect(readBookLevel(frame, 'bid', 103)).toEqual({ kind: 'observed', size: 1 });
    expect(readBookLevel(frame, 'bid', 102)).toEqual({ kind: 'missing', reason: 'incomplete' });
  });
});
