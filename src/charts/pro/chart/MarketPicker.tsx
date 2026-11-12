import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Dropdown, MenuItem, MenuSection } from '../../../ui/Dropdown';
import type { ChartMarket } from '../../../utils/marketRegistry';
import { tr } from '../../../i18n';
import { marketGroups, marketTitle } from './marketMenu';

/**
 * Wybór rynku wykresu (komputer): lista rozwijana z polem wyszukiwania i dwiema grupami (krypto; akcje, indeksy, surowce)
 * w kolejności rejestru. Enter w polu wybiera pierwszy pasujący rynek, strzałka w dół przechodzi do listy, Escape zamyka.
 */
export const MarketPicker: React.FC<{ value: string; markets: readonly ChartMarket[]; onChange: (coin: string) => void }> = ({ value, markets, onChange }) => (
  <Dropdown label={value} ariaLabel={tr(`Rynek: ${value}`, `Market: ${value}`)} title={tr('Rynek (M — następny)', 'Market (M — next)')} menuLabel={tr('Rynki', 'Markets')} width="w-60">
    {(close) => (
      <MarketMenu
        value={value}
        markets={markets}
        onClose={close}
        onPick={(coin) => {
          close();
          if (coin !== value) onChange(coin);
        }}
      />
    )}
  </Dropdown>
);

const MarketMenu: React.FC<{ value: string; markets: readonly ChartMarket[]; onPick: (coin: string) => void; onClose: () => void }> = ({ value, markets, onPick, onClose }) => {
  const [q, setQ] = useState('');
  const groups = marketGroups(markets, q);
  const first = groups[0]?.markets[0];
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && first) {
      e.preventDefault();
      onPick(first.coin);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.currentTarget.closest('[role="menu"]')?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus();
    } else if (e.key === 'Escape') {
      // Escape nie trafia dalej (skróty wykresu, szuflada DOM)
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };
  return (
    <>
      <input
        data-menu-search
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
        aria-label={tr('Szukaj rynku', 'Search markets')}
        placeholder={tr('Szukaj: NVDA, xyz, PEPE…', 'Search: NVDA, xyz, PEPE…')}
        autoComplete="off"
        spellCheck={false}
        className="mx-1 mb-1 h-11 sm:h-9 px-2.5 rounded-lg border border-line bg-surface-1 text-xs text-ink-1 placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      {groups.map((g) => (
        <React.Fragment key={g.id}>
          <MenuSection title={g.title} />
          {g.markets.map((m) => (
            <MenuItem key={m.coin} kind="radio" checked={m.coin === value} title={marketTitle(m)} onSelect={() => onPick(m.coin)}>
              {m.coin}
            </MenuItem>
          ))}
        </React.Fragment>
      ))}
      {groups.length === 0 && <p className="px-2.5 py-2 text-ink-3">{tr(`Brak rynku „${q.trim()}” na liście`, `No market “${q.trim()}” on the list`)}</p>}
    </>
  );
};

/** Wybór rynku na telefonie: systemowa lista (wygodna palcem, nie ucina jej przewijany pasek) z tymi samymi grupami. */
export const PhoneMarketSelect: React.FC<{ value: string; markets: readonly ChartMarket[]; onChange: (coin: string) => void }> = ({ value, markets, onChange }) => (
  <span className="relative inline-flex shrink-0">
    <select
      aria-label={tr('Rynek', 'Market')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="appearance-none h-11 pl-2.5 pr-6 rounded-lg border border-line bg-surface-2 text-xs font-medium text-ink-1 max-w-[7.5rem] truncate"
    >
      {/* Rynek spoza listy (przed odpowiedzią rejestru) też widać w polu */}
      {!markets.some((m) => m.coin === value) && <option value={value}>{value}</option>}
      {marketGroups(markets, '').map((g) => (
        <optgroup key={g.id} label={g.title}>
          {g.markets.map((m) => (
            <option key={m.coin} value={m.coin}>
              {m.coin}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
    <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-3" />
  </span>
);
