import React, { useState } from 'react';
import { Badge, EmptyState, Panel, Segmented } from '../../ui';
import { NewsCategory, fmtAgo, freshnessBadge, partAsOf, useNow, usePublicFeed } from '../../utils/publicFeeds';

type Filter = 'all' | NewsCategory;

const CAT_LABEL: Record<NewsCategory, string> = { crypto: 'Krypto', macro: 'Makro', regulation: 'Regulacje' };
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Wszystko' },
  { value: 'crypto', label: 'Krypto' },
  { value: 'macro', label: 'Makro' },
  { value: 'regulation', label: 'Regulacje' },
];
const SOURCES = 'CoinDesk, Cointelegraph, Decrypt, The Block, Bitcoin Magazine, Federal Reserve, BLS, SEC';

/** Nagłówki z publicznych RSS: wyłącznie tytuł, źródło, czas i link do wydawcy (bez opisów i obrazków). */
export const NewsFeed: React.FC = () => {
  const { feed, status } = usePublicFeed('news');
  const now = useNow(60000);
  const [filter, setFilter] = useState<Filter>('all');

  const items = feed?.data.items ?? [];
  const shown = filter === 'all' ? items : items.filter((i) => i.category === filter);
  const badge = freshnessBadge(partAsOf(feed, 'items'), now);

  return (
    <Panel
      title="Nagłówki"
      eyebrow="RSS · tylko tytuł i link"
      actions={feed ? <Badge tone={badge.tone} title={badge.title}>{badge.label}</Badge> : undefined}
    >
      {status === 'loading' && !feed ? (
        <EmptyState title="Wczytuję nagłówki…" />
      ) : !feed || items.length === 0 ? (
        <EmptyState
          title="Brak danych publicznych"
          detail={
            <>
              Uruchom <code className="font-mono text-ink-2">npm run data</code> lokalnie albo poczekaj na wdrożenie (GitHub
              Actions odświeża pliki co ~30 min).
            </>
          }
        />
      ) : (
        <>
          <div className="px-4 pt-3 pb-2 overflow-x-auto">
            <Segmented value={filter} options={FILTERS} onChange={setFilter} ariaLabel="Kategoria nagłówków" />
          </div>
          {shown.length === 0 ? (
            <EmptyState title="Brak nagłówków w tej kategorii" detail="W ostatnim pobraniu żaden kanał nie dostarczył pozycji tego typu." />
          ) : (
            <ul className="max-h-[440px] overflow-y-auto divide-y divide-line border-t border-line">
              {shown.map((i) => (
                <li key={i.link}>
                  <a
                    href={i.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block px-4 py-2.5 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                  >
                    <span className="block text-sm text-ink-1 leading-snug">{i.title}</span>
                    <span className="mt-0.5 block text-[11px] text-ink-3">
                      {i.source} · <time dateTime={new Date(i.time).toISOString()}>{fmtAgo(i.time, now)}</time> · {CAT_LABEL[i.category]}
                      <span className="sr-only"> (otwiera stronę wydawcy w nowej karcie)</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="px-4 py-2.5 border-t border-line text-[11px] text-ink-3 leading-relaxed">
            Źródła: {SOURCES}. Treść należy do wydawców — pokazujemy wyłącznie tytuł i link do oryginału.
          </p>
        </>
      )}
    </Panel>
  );
};
export default NewsFeed;
