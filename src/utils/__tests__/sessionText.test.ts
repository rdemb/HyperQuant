import { describe, expect, it } from 'vitest';
import { gotWhy } from '../fourNumbers';
import { WAIT_TEXT, missingWhy } from '../sessionText';

describe('missingWhy: powód pierwszego brakującego wejścia (nagłówek układu, Czwórka, Rozliczenie, serwer MCP)', () => {
  it('pierwsze wejście w drodze — „czekam na dane”; pierwsze z powodem — ten powód; kolejność decyduje', () => {
    expect(missingWhy(undefined, { why: 'b' })).toBe(WAIT_TEXT);
    expect(missingWhy({ why: 'a' }, undefined)).toBe('a');
    expect(missingWhy(1, { why: 'b' }, { why: 'c' })).toBe('b');
  });

  it('wszystkie wejścia są albo brak wejść — „czekam na dane” (nigdy pusty powód)', () => {
    expect(missingWhy(1, 'x')).toBe(WAIT_TEXT);
    expect(missingWhy()).toBe(WAIT_TEXT);
  });

  it('jedna implementacja: gotWhy Czwórki to ten sam pomocnik', () => {
    expect(gotWhy).toBe(missingWhy);
  });
});
