import { describe, expect, it } from 'vitest';
import { type ListaNowosci, NOWOSCI_W_OKNIE, WIDZIANE_DO, czyLista, nowosciDoPokazania } from '../nowosci';

const poz = (date: string, pl: string) => ({ id: `${date}|${pl}`, date, group: 'wykres' as const, pl, en: pl, body: `${pl}.` });
const LISTA: ListaNowosci = {
  v: 1,
  groups: { wykres: { pl: 'Wykres', en: 'Chart' }, prognozy: { pl: 'P', en: 'F' }, rynki: { pl: 'Rynki', en: 'Markets' }, skaner: { pl: 'S', en: 'S' }, blog: { pl: 'B', en: 'B' } },
  items: [poz('2026-11-28', 'A'), poz('2026-11-28', 'B'), poz('2026-11-27', 'C'), poz('2026-11-23', 'D'), poz('2026-11-20', 'E')],
};

describe('okno „Co nowego”: które pozycje pokazać', () => {
  it('nowy użytkownik: nic (lista zmian mu niepotrzebna); stały po raz pierwszy z tym oknem: pozycje po 23.11', () => {
    expect(WIDZIANE_DO).toBe('2026-11-23');
    expect(nowosciDoPokazania(LISTA, null, false)).toEqual([]);
    expect(nowosciDoPokazania(LISTA, null, true).map((i) => i.pl)).toEqual(['A', 'B', 'C']);
  });

  it('po aktualizacji: tylko pozycje, których nie widział (najnowsze pierwsze); wszystkie widziane — nic', () => {
    const seen = ['2026-11-27|C', '2026-11-23|D', '2026-11-20|E'];
    expect(nowosciDoPokazania(LISTA, seen, true).map((i) => i.pl)).toEqual(['A', 'B']);
    expect(nowosciDoPokazania(LISTA, LISTA.items.map((i) => i.id), true)).toEqual([]);
  });

  it(`najwyżej ${NOWOSCI_W_OKNIE} pozycji w oknie`, () => {
    const dlugo: ListaNowosci = { ...LISTA, items: Array.from({ length: 8 }, (_, i) => poz('2026-11-28', `N${i}`)) };
    expect(nowosciDoPokazania(dlugo, [], true)).toHaveLength(NOWOSCI_W_OKNIE);
  });

  it('plik z buildu: poprawny kształt przyjęty; inna wersja, nieznana grupa albo brak pola — odrzucony', () => {
    expect(czyLista(LISTA)).toBe(true);
    expect(czyLista({ ...LISTA, v: 2 })).toBe(false);
    expect(czyLista({ ...LISTA, items: [{ ...LISTA.items[0], group: 'inna' }] })).toBe(false);
    expect(czyLista({ ...LISTA, items: [{ ...LISTA.items[0], body: undefined }] })).toBe(false);
    expect(czyLista(null)).toBe(false);
  });
});
