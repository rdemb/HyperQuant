import { describe, expect, it } from 'vitest';
import { VIEWS } from '../../state/route';
import { MARKETS, NAV_DZIEN, NAV_RYNEK, NAV_STRONY, NAV_TELEFON, NAV_TELEFON_WIECEJ, NAV_WIEDZA, NEWS_LABEL, RESULTS_LABEL, START_HREF, STANOWISKO, STANOWISKO_WIDOK } from '../AppShell';

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('nawigacja aplikacji (jedno źródło: szyna, dolny pasek, menu „Więcej”, paleta ⌘K)', () => {
  it('szyna: dzień (Dziś i trzy fazy), rynek, wiedza', () => {
    expect(ids(NAV_DZIEN)).toEqual(['dzis', 'before', 'charts', 'after']);
    expect(ids(NAV_RYNEK)).toEqual(['markets', 'orderflow']);
    expect(ids(NAV_WIEDZA)).toEqual(['lessons', 'research', 'sources', 'agents']);
    expect(MARKETS.label).toBe('Rynki');
  });

  it('każdy widok aplikacji jest w nawigacji komputera i telefonu, każdy raz', () => {
    // Szyna: trzy grupy i Stanowisko na dole (widok aplikacji, nie strona serwisu)
    const komputer = ids([...NAV_DZIEN, ...NAV_RYNEK, ...NAV_WIEDZA, STANOWISKO_WIDOK]);
    const telefon = ids([...NAV_TELEFON, ...NAV_TELEFON_WIECEJ]);
    for (const lista of [komputer, telefon]) {
      expect([...lista].sort()).toEqual([...VIEWS].sort());
      expect(new Set(lista).size).toBe(lista.length);
    }
  });

  it('dolny pasek telefonu: Dziś, Sesja, Order Flow, Rynki (piąta pozycja to „Więcej”)', () => {
    expect(ids(NAV_TELEFON)).toEqual(['dzis', 'charts', 'orderflow', 'markets']);
    expect(NAV_TELEFON[1].short).toBe('Sesja');
  });

  it('strona startowa to logo, nie zakładka; Stanowisko to widok aplikacji, strony serwisu zwykłe linki', () => {
    expect(START_HREF).toBe('/?lang=pl');
    expect(STANOWISKO.href).toBe('/?lang=pl#stanowisko');
    expect(NAV_TELEFON_WIECEJ.map((n) => n.id)).toContain('stanowisko');
    expect(NAV_STRONY.map((l) => l.href)).toEqual(['./blog/', './wyniki/', './co-nowego/']);
    expect(NAV_STRONY.map((l) => l.label)).toEqual(['Blog', RESULTS_LABEL, NEWS_LABEL]);
    expect(NAV_STRONY.some((l) => l.href.includes('nowy'))).toBe(false);
    expect(RESULTS_LABEL).toBe('Wyniki');
    expect(NEWS_LABEL).toBe('Co nowego');
  });
});
