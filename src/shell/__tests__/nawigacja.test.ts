import { describe, expect, it } from 'vitest';
import { VIEWS } from '../../state/route';
import { MARKETS, NAV_DZIEN, NAV_STRONY, NAV_TELEFON, NAV_TELEFON_WIECEJ, NAV_WIEDZA, NEWS_LABEL, RESULTS_LABEL } from '../AppShell';

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('nawigacja aplikacji (jedno źródło: szyna, dolny pasek, menu „Więcej”, paleta ⌘K)', () => {
  it('szyna: dzień tradera (trzy fazy), potem Rynki i wiedza; Rynki pierwsze', () => {
    expect(ids(NAV_DZIEN)).toEqual(['before', 'charts', 'after']);
    expect(ids(NAV_WIEDZA)).toEqual(['markets', 'lessons', 'research', 'sources', 'agents']);
    expect(MARKETS.label).toBe('Rynki');
  });

  it('każdy widok poza Startem (logo) jest w nawigacji komputera i telefonu, każdy raz', () => {
    const bezStartu = VIEWS.filter((v) => v !== 'start');
    const komputer = ids([...NAV_DZIEN, ...NAV_WIEDZA]);
    const telefon = ids([...NAV_TELEFON, ...NAV_TELEFON_WIECEJ]);
    for (const lista of [komputer, telefon]) {
      expect([...lista].sort()).toEqual([...bezStartu].sort());
      expect(new Set(lista).size).toBe(lista.length);
    }
  });

  it('dolny pasek telefonu: trzy fazy i Rynki (piąta pozycja to „Więcej”)', () => {
    expect(ids(NAV_TELEFON)).toEqual(['before', 'charts', 'after', 'markets']);
  });

  it('strony serwisu: Blog, Wyniki, Co nowego (w tej kolejności, adresy PL)', () => {
    expect(NAV_STRONY.map((l) => l.href)).toEqual(['./blog/', './wyniki/', './co-nowego/']);
    expect(NAV_STRONY.map((l) => l.label)).toEqual(['Blog', RESULTS_LABEL, NEWS_LABEL]);
    expect(RESULTS_LABEL).toBe('Wyniki');
    expect(NEWS_LABEL).toBe('Co nowego');
  });
});
