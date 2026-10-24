import React, { useState } from 'react';
import { Badge, EmptyState, Panel, Segmented } from '../../ui';
import { NewsCategory, fmtAgo, freshnessBadge, partAsOf, useNow, usePublicFeed } from '../../utils/publicFeeds';
import { tr } from '../../i18n';

type Filter = 'all' | NewsCategory;

const CAT_LABEL: Record<NewsCategory, string> = { crypto: tr('Krypto', 'Crypto'), macro: tr('Makro', 'Macro'), regulation: tr('Regulacje', 'Regulation') };
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: tr('Wszystko', 'All') },
  { value: 'crypto', label: CAT_LABEL.crypto },
  { value: 'macro', label: CAT_LABEL.macro },
  { value: 'regulation', label: CAT_LABEL.regulation },
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
      title={tr('Nagłówki', 'Headlines')}
      eyebrow={tr('RSS · tylko tytuł i link', 'RSS · title and link only')}
      actions={feed ? <Badge tone={badge.tone} title={badge.title}>{badge.label}</Badge> : undefined}
    >
      {status === 'loading' && !feed ? (
        <EmptyState title={tr('Wczytuję nagłówki…', 'Loading headlines…')} />
      ) : !feed || items.length === 0 ? (
        <EmptyState
          title={tr('Brak danych publicznych', 'No public data')}
          detail={tr(
            <>
              Uruchom <code className="font-mono text-ink-2">npm run data</code> lokalnie albo poczekaj na wdrożenie (GitHub
              Actions odświeża pliki co ~30 min).
            </>,
            <>
              Run <code className="font-mono text-ink-2">npm run data</code> locally or wait for the deployment (GitHub Actions refreshes the files every ~30 min).
            </>
          )}
        />
      ) : (
        <>
          <div className="px-4 pt-3 pb-2 overflow-x-auto">
            <Segmented value={filter} options={FILTERS} onChange={setFilter} ariaLabel={tr('Kategoria nagłówków', 'Headline category')} />
          </div>
          {shown.length === 0 ? (
            <EmptyState
              title={tr('Brak nagłówków w tej kategorii', 'No headlines in this category')}
              detail={tr('W ostatnim pobraniu żaden kanał nie dostarczył pozycji tego typu.', 'In the last fetch no feed delivered items of this type.')}
            />
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
                      <span className="sr-only">{tr(' (otwiera stronę wydawcy w nowej karcie)', " (opens the publisher's page in a new tab)")}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="px-4 py-2.5 border-t border-line text-[11px] text-ink-3 leading-relaxed">
            {tr('Źródła', 'Sources')}: {SOURCES}.{' '}
            {tr('Treść należy do wydawców — pokazujemy wyłącznie tytuł i link do oryginału.', 'The content belongs to the publishers; we show only the title and a link to the original.')}
          </p>
        </>
      )}
    </Panel>
  );
};
export default NewsFeed;
