import React, { useSyncExternalStore } from 'react';
import { Search, X } from 'lucide-react';
import { tr } from '../i18n';
import { useMarketsPage } from '../state/useMarketsTable';
import { Badge, SectionHeading, Segmented } from '../ui';
import type { MarketFilter, SortKey } from '../utils/marketsTable';
import type { MarketClass } from '../utils/marketRegistry';
import { CLASS_LABEL, MarketList } from './markets/MarketList';

/**
 * Widok „Rynki” (`#markets`): wszystkie rynki perpetual Hyperliquid (giełda główna i giełdy HIP-3 z `perpDexs`), z
 * wyszukiwarką, filtrami giełdy i klasy oraz sortowaniem. Liczby LIVE z odpowiedzi Hyperliquid pobranej w przeglądarce, z
 * godziną odczytu; odczyt starszy niż 3 min albo rynek bez odpowiedzi giełdy — „—” z powodem. Opis rynku, bez oceny ruchu.
 * Dane i przeliczenia: `useMarketsPage` (czyste funkcje w `utils/marketsTable`); tu i w `views/markets/` sama prezentacja.
 */

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'oi', label: tr('Otwarte pozycje', 'Open interest') },
  { value: 'volume', label: tr('Obrót', 'Volume') },
  { value: 'funding', label: 'Funding' },
];

const PHONE = '(max-width: 767px)';
const subscribePhone = (fn: () => void) => {
  const mq = window.matchMedia(PHONE);
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
};
const isPhone = () => window.matchMedia(PHONE).matches;

const chip = (on: boolean) =>
  `inline-flex h-9 items-center rounded-full border px-3 text-xs font-medium transition-colors duration-150 ${
    on ? 'border-line-strong bg-surface-3 text-ink-1' : 'border-line text-ink-3 hover:text-ink-1 hover:border-line-strong'
  }`;

const MarketsView: React.FC = () => {
  const page = useMarketsPage();
  const phone = useSyncExternalStore(subscribePhone, isPhone, () => false);
  const f = page.filter;
  const set = (patch: Partial<MarketFilter>) => page.setFilter({ ...f, ...patch });
  const classes: (MarketClass | 'none' | null)[] = [null, ...page.classes, 'none'];
  return (
    <div className="flex flex-col gap-4" data-markets-view>
      <SectionHeading
        id="rynki-tytul"
        eyebrow={tr('Hyperliquid · giełda główna i HIP-3', 'Hyperliquid · main exchange and HIP-3')}
        title={tr('Rynki', 'Markets')}
        note={tr(
          `Wszystkie rynki perpetual Hyperliquid: ${page.total} na ${page.dexes.length} giełdach. Liczby pobiera Twoja przeglądarka prosto z giełdy co ${page.refreshSec} s, gdy karta jest widoczna. Wykres jest dla ${page.marketCount} rynków z rejestru HyperQuant.`,
          `Every Hyperliquid perpetual market: ${page.total} across ${page.dexes.length} exchanges. Your browser fetches the numbers straight from the exchange every ${page.refreshSec} s while the tab is visible. Charts cover the ${page.marketCount} markets in the HyperQuant registry.`
        )}
        aside={
          <Badge tone="live" title={tr('Realne dane Hyperliquid z godziną odczytu w każdym wierszu', 'Real Hyperliquid data with the reading time in every row')}>
            LIVE
          </Badge>
        }
      />

      <section aria-labelledby="rynki-tytul" className="rounded-xl border border-line bg-surface-1">
        {/* Pasek: wyszukiwarka, giełda, sortowanie; pod nim klasy */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <label className="relative flex min-w-[200px] flex-1 items-center">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 h-4 w-4 text-ink-3" />
            <input
              type="search"
              value={f.q}
              onChange={(e) => set({ q: e.target.value })}
              placeholder={tr('Szukaj rynku (np. NVDA, GOLD, xyz)', 'Search market (e.g. NVDA, GOLD, xyz)')}
              aria-label={tr('Szukaj rynku', 'Search market')}
              className="h-10 w-full rounded-lg border border-line bg-page pl-9 pr-9 text-sm text-ink-1 placeholder:text-ink-3 focus:border-line-strong focus:outline-none"
            />
            {f.q !== '' && (
              <button type="button" aria-label={tr('Wyczyść', 'Clear')} onClick={() => set({ q: '' })} className="absolute right-1 grid h-8 w-8 place-items-center rounded-md text-ink-3 hover:text-ink-1">
                <X className="h-4 w-4" />
              </button>
            )}
          </label>
          <select
            value={f.dex ?? '*'}
            onChange={(e) => set({ dex: e.target.value === '*' ? null : e.target.value })}
            aria-label={tr('Giełda', 'Exchange')}
            className="h-10 rounded-lg border border-line bg-page px-3 text-sm text-ink-1"
          >
            <option value="*">{tr('Wszystkie giełdy', 'All exchanges')}</option>
            {page.dexes.map((d) => (
              <option key={d.id} value={d.id}>
                {d.id === '' ? tr('Hyperliquid (główna)', 'Hyperliquid (main)') : `${d.label} (HIP-3)`}
              </option>
            ))}
          </select>
          <div className="overflow-x-auto [scrollbar-width:none]">
            <Segmented<SortKey> ariaLabel={tr('Sortowanie', 'Sort by')} size="xs" value={page.sort} onChange={page.setSort} options={SORTS} />
          </div>
        </div>
        <div role="group" aria-label={tr('Klasa rynku', 'Market class')} className="flex gap-1.5 overflow-x-auto px-4 py-2.5 border-b border-line [scrollbar-width:none]">
          {classes.map((c) => (
            <button key={c ?? 'all'} type="button" aria-pressed={f.cls === c} onClick={() => set({ cls: c })} className={`${chip(f.cls === c)} shrink-0`}>
              {c === null ? tr('Wszystkie', 'All') : c === 'none' ? tr('Bez klasy', 'Unclassified') : CLASS_LABEL[c]}
            </button>
          ))}
        </div>

        <p className="px-4 pt-3 pb-1 text-[11px] text-ink-3" aria-live="polite">
          {page.loading
            ? tr('Czekam na pierwszą odpowiedź giełd…', 'Waiting for the first exchange responses…')
            : tr(`Pokazane: ${page.rows.length} z ${page.total}`, `Shown: ${page.rows.length} of ${page.total}`)}
        </p>
        {page.rows.length > 0 ? (
          <MarketList rows={page.rows} cards={phone} />
        ) : (
          !page.loading && <p className="px-4 py-10 text-center text-sm text-ink-3">{tr('Żaden rynek nie pasuje do filtrów.', 'No market matches the filters.')}</p>
        )}

        <div className="mt-1 flex flex-col gap-1 border-t border-line px-4 py-3 text-[11px] leading-relaxed text-ink-3">
          <p>
            {tr(
              `Źródło: Hyperliquid (perpDexs raz, potem metaAndAssetCtxs każdej giełdy co ${page.refreshSec} s) z Twojej przeglądarki; serwer HyperQuant nic nie pobiera. Rynki wycofane z giełdy są pominięte. Otwarte pozycje = liczba kontraktów × cena mark. Funding roczny przeliczony ze stawki godzinowej (× 24 × 365). Klasa rynku z rejestru HyperQuant; rynki HIP-3 spoza rejestru są „bez klasy” (giełda jej nie podaje).`,
              `Source: Hyperliquid (perpDexs once, then each exchange's metaAndAssetCtxs every ${page.refreshSec} s) from your browser; the HyperQuant server fetches nothing. Delisted markets are skipped. Open interest = contracts × mark price. Annual funding is annualised from the hourly rate (× 24 × 365). Market class comes from the HyperQuant registry; HIP-3 markets outside it are “unclassified” (the exchange does not provide it).`
            )}
          </p>
          <p data-wall-street-note>
            {tr(
              'Etykieta Wall Street opisuje giełdę bazową (sesja regularna NYSE 9:30–16:00 czasu Nowego Jorku w dni robocze), a nie rynek na Hyperliquid, który działa całą dobę.',
              'The Wall Street label describes the underlying exchange (the NYSE regular session, 9:30–16:00 New York time on weekdays), not the market on Hyperliquid, which trades around the clock.'
            )}{' '}
            {page.calendar ? (
              <>
                {tr('Święta i sesje skrócone: ', 'Holidays and early closes: ')}
                <a href={page.calendar.source} target="_blank" rel="noopener noreferrer" className="underline decoration-line-strong underline-offset-2 hover:text-ink-1">
                  nyse.com
                </a>
                {tr(`, odczyt ${page.calendar.readAt}, lata ${page.calendar.years.join(', ')}.`, `, read on ${page.calendar.readAt}, years ${page.calendar.years.join(', ')}.`)}
              </>
            ) : (
              tr('Brak kalendarza NYSE w tej wersji strony: etykieta „—”.', 'No NYSE calendar in this version of the site: the label is “—”.')
            )}
          </p>
          <p data-markets-weight={page.weight}>
            {tr(
              `Waga zapytań tej strony w ostatniej minucie: ${page.weight} z ${page.weightLimit} (limit Hyperliquid na adres IP).`,
              `Request weight of this page in the last minute: ${page.weight} of ${page.weightLimit} (the Hyperliquid limit per IP address).`
            )}
          </p>
        </div>
      </section>
    </div>
  );
};

export default MarketsView;
