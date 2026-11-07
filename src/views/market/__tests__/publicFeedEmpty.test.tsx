import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Brak plików potoku danych publicznych (np. przerwa w publikacji): stan pusty, bez danych
vi.mock('../../../utils/publicFeeds', async (orig) => ({
  ...(await orig<typeof import('../../../utils/publicFeeds')>()),
  usePublicFeed: () => ({ status: 'error', feed: null }),
  useNow: () => Date.UTC(2026, 10, 7, 12),
}));

describe('Dane publiczne: pusty stan mówi do czytelnika, nie do programisty', () => {
  it('makro i nagłówki bez plików: „—” z powodem, bez poleceń npm i GitHub Actions', async () => {
    const { MacroTiles } = await import('../MacroTiles');
    const { NewsFeed } = await import('../NewsFeed');
    for (const html of [renderToStaticMarkup(<MacroTiles />), renderToStaticMarkup(<NewsFeed />)]) {
      expect(html).toContain('Brak danych publicznych');
      expect(html).not.toMatch(/npm|GitHub Actions|lokalnie/);
      expect(html).toContain('co ok. 30 min');
    }
  });
});
