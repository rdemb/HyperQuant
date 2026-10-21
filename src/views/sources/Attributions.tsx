import React from 'react';
import { ExternalLink } from 'lucide-react';
import { Panel } from '../../ui';

const A: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-0.5 text-accent underline-offset-2 hover:underline focus-visible:underline"
  >
    {children}
    <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
    <span className="sr-only">(otwiera się w nowej karcie)</span>
  </a>
);

const ITEMS: { title: string; body: React.ReactNode }[] = [
  {
    title: 'Hyperliquid',
    body: (
      <>
        Dane rynkowe BTC-PERP, HIP-3 i funding innych giełd z publicznego API Hyperliquid (<A href="https://hyperliquid.gitbook.io/hyperliquid-docs">dokumentacja API</A>).
      </>
    ),
  },
  {
    title: 'alternative.me',
    body: (
      <>
        Crypto Fear &amp; Greed Index: <A href="https://alternative.me/crypto/fear-and-greed-index/">alternative.me</A>. Atrybucja jest wyświetlana także
        obok wartości indeksu.
      </>
    ),
  },
  {
    title: 'GDELT Project',
    body: (
      <>
        Ton mediów (DOC 2.0 Timeline Tone): The GDELT Project, <A href="https://www.gdeltproject.org/">gdeltproject.org</A>.
      </>
    ),
  },
  {
    title: 'Dane publiczne rządu USA',
    body: (
      <>
        <span className="text-ink-1">This product uses data from U.S. Treasury / CFTC / Federal Reserve.</span> Także NY Fed (reverse repo), BLS i BEA
        (harmonogramy). Produkt nie jest zatwierdzony ani wspierany przez te instytucje.
      </>
    ),
  },
  {
    title: 'Wiadomości (RSS)',
    body: <>Wyłącznie nagłówki z linkiem do wydawcy. Treści i prawa należą do wydawców; pełne artykuły czytasz na ich stronach.</>,
  },
  {
    title: 'mempool.space',
    body: (
      <>
        Opłaty, trudność i hashrate: <A href="https://mempool.space">mempool.space</A>.
      </>
    ),
  },
  {
    title: 'Giełdy CEX (opt-in)',
    body: <>Pobierane wyłącznie przez Twoją przeglądarkę, po Twoim włączeniu. HyperQuant ich nie przechowuje, nie przetwarza na serwerze i nie udostępnia.</>,
  },
];

/** Wymagane atrybucje źródeł, licencja kodu i link do repozytorium. */
export const Attributions: React.FC = () => (
  <Panel eyebrow="Atrybucje i licencje" title="Źródła danych" bodyClassName="px-4 py-3">
    <dl className="flex flex-col gap-2.5 text-xs leading-relaxed">
      {ITEMS.map((it) => (
        <div key={it.title}>
          <dt className="text-ink-1 font-medium">{it.title}</dt>
          <dd className="text-ink-2">{it.body}</dd>
        </div>
      ))}
      <div className="border-t border-line pt-2.5">
        <dt className="text-ink-1 font-medium">Kod</dt>
        <dd className="text-ink-2">
          Otwarte źródła: <A href="https://github.com/rdemb/HyperQuant">github.com/rdemb/HyperQuant</A> · licencja{' '}
          <A href="https://github.com/rdemb/HyperQuant/blob/HEAD/LICENSE">MIT</A>.
        </dd>
      </div>
    </dl>
  </Panel>
);
