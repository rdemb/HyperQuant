import React from 'react';
import { ExternalLink } from 'lucide-react';
import { Panel } from '../../ui';
import { tr } from '../../i18n';

const A: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-0.5 text-accent underline-offset-2 hover:underline focus-visible:underline"
  >
    {children}
    <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
    <span className="sr-only">{tr('(otwiera się w nowej karcie)', '(opens in a new tab)')}</span>
  </a>
);

const ITEMS: { title: string; body: React.ReactNode }[] = [
  {
    title: 'Hyperliquid',
    body: (
      <>
        {tr('Dane rynkowe BTC-PERP, HIP-3 i funding innych giełd z publicznego API Hyperliquid', 'BTC-PERP market data, HIP-3 and other exchanges\' funding from the public Hyperliquid API')} (
        <A href="https://hyperliquid.gitbook.io/hyperliquid-docs">{tr('dokumentacja API', 'API docs')}</A>).
      </>
    ),
  },
  {
    title: 'TradingView Lightweight Charts™',
    body: (
      <>
        {tr('Silnik widoku Wykresy', 'Engine of the Charts view')}: TradingView Lightweight Charts™, Copyright (c) 2025 TradingView, Inc.,{' '}
        <A href="https://www.tradingview.com/">tradingview.com</A> · {tr('licencja', 'license')}{' '}
        <A href="https://github.com/tradingview/lightweight-charts/blob/master/LICENSE">Apache 2.0</A>.
      </>
    ),
  },
  {
    title: 'alternative.me',
    body: (
      <>
        Crypto Fear &amp; Greed Index: <A href="https://alternative.me/crypto/fear-and-greed-index/">alternative.me</A>.{' '}
        {tr('Atrybucja jest wyświetlana także obok wartości indeksu.', 'The attribution is also shown next to the index value.')}
      </>
    ),
  },
  {
    title: 'GDELT Project',
    body: (
      <>
        {tr('Ton mediów', 'Media tone')} (DOC 2.0 Timeline Tone): The GDELT Project, <A href="https://www.gdeltproject.org/">gdeltproject.org</A>.
      </>
    ),
  },
  {
    title: tr('Dane publiczne rządu USA', 'US government public data'),
    body: (
      <>
        <span className="text-ink-1">This product uses data from U.S. Treasury / CFTC / Federal Reserve.</span>{' '}
        {tr(
          'Także NY Fed (reverse repo), BLS i BEA (harmonogramy). Produkt nie jest zatwierdzony ani wspierany przez te instytucje.',
          'Also NY Fed (reverse repo), BLS and BEA (schedules). The product is not endorsed or supported by these institutions.'
        )}
      </>
    ),
  },
  {
    title: tr('Wiadomości (RSS)', 'News (RSS)'),
    body: (
      <>
        {tr(
          'Wyłącznie nagłówki z linkiem do wydawcy. Treści i prawa należą do wydawców; pełne artykuły czytasz na ich stronach.',
          "Headlines only, with a link to the publisher. Content and rights belong to the publishers; you read full articles on their sites."
        )}
      </>
    ),
  },
  {
    title: 'mempool.space',
    body: (
      <>
        {tr('Opłaty, trudność i hashrate', 'Fees, difficulty and hashrate')}: <A href="https://mempool.space">mempool.space</A>.
      </>
    ),
  },
  {
    title: tr('Giełdy CEX (opt-in)', 'CEX exchanges (opt-in)'),
    body: (
      <>
        {tr(
          'Pobierane wyłącznie przez Twoją przeglądarkę, po Twoim włączeniu. HyperQuant ich nie przechowuje, nie przetwarza na serwerze i nie udostępnia.',
          'Fetched only by your browser, after you switch them on. HyperQuant does not store, process on a server or share them.'
        )}
      </>
    ),
  },
];

/** Wymagane atrybucje źródeł, licencja kodu i link do repozytorium. */
export const Attributions: React.FC = () => (
  <Panel eyebrow={tr('Atrybucje i licencje', 'Attributions and licenses')} title={tr('Źródła danych', 'Data sources')} bodyClassName="px-4 py-3">
    <dl className="flex flex-col gap-2.5 text-xs leading-relaxed">
      {ITEMS.map((it) => (
        <div key={it.title}>
          <dt className="text-ink-1 font-medium">{it.title}</dt>
          <dd className="text-ink-2">{it.body}</dd>
        </div>
      ))}
      <div className="border-t border-line pt-2.5">
        <dt className="text-ink-1 font-medium">{tr('Kod', 'Code')}</dt>
        <dd className="text-ink-2">
          {tr('Otwarte źródła', 'Open source')}: <A href="https://github.com/rdemb/HyperQuant">github.com/rdemb/HyperQuant</A> · {tr('licencja', 'license')}{' '}
          <A href="https://github.com/rdemb/HyperQuant/blob/HEAD/LICENSE">MIT</A>.
        </dd>
      </div>
    </dl>
  </Panel>
);
