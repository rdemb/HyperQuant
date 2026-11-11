import React from 'react';
import { Eye, EyeOff, Layers, MoreHorizontal } from 'lucide-react';
import { Badge } from '../../../ui';
import { Dropdown, MenuItem, MenuSection, MenuSeparator } from '../../../ui/Dropdown';
import { INTERVALS } from '../core/time';
import type { ChartView } from './footprintSeries';
import type { LayerChip } from './layerSources';
import type { FootprintStyle } from './layout';
import { tr } from '../../../i18n';

/**
 * Listy rozwijane paska wykresu (jeden rząd zamiast przełączników): rodzaj wykresu, warstwy na cenie i menu „⋯” z
 * rzadziej używanymi narzędziami. Stan trzyma wykres (ProChart); tu tylko wygląd i wybór.
 */

/** Rodzaj wykresu jednym wyborem: świece albo footprint w jednym z trzech stylów. */
export type ChartKind = 'candles' | `fp-${FootprintStyle}`;

export const kindOf = (view: ChartView, style: FootprintStyle): ChartKind => (view === 'candles' ? 'candles' : `fp-${style}`);

/** Zmiana ustawień dla wybranego rodzaju (styl footprintu zostaje przy przejściu na świece). */
export function kindPatch(k: ChartKind): { view: ChartView; fpStyle?: FootprintStyle } {
  return k === 'candles' ? { view: 'candles' } : { view: 'footprint', fpStyle: k.slice(3) as FootprintStyle };
}

export const KIND_OPTIONS: readonly { value: ChartKind; label: string; short: string; title: string }[] = [
  { value: 'candles', label: tr('Świece', 'Candles'), short: tr('Świece', 'Candles'), title: tr('Same świece (OHLC z API Hyperliquid)', 'Plain candles (OHLC from the Hyperliquid API)') },
  {
    value: 'fp-bidask',
    label: tr('Footprint Bid × Ask', 'Footprint Bid × Ask'),
    short: 'Bid × Ask',
    title: tr('Sprzedaż agresywna (uderza w bid) × kupno agresywne (zdejmuje ask) w każdym wierszu', 'Aggressive selling (hits the bid) × aggressive buying (lifts the ask) on every row'),
  },
  { value: 'fp-delta', label: tr('Footprint Delta', 'Footprint Delta'), short: 'FP Delta', title: tr('Delta wiersza: kupno − sprzedaż agresorów', 'Row delta: aggressor buys − sells') },
  { value: 'fp-volume', label: tr('Footprint Wolumen', 'Footprint Volume'), short: tr('FP Wolumen', 'FP Volume'), title: tr('Łączny wolumen wiersza', 'Total row volume') },
];

/** Ulubione interwały: przyciski obok listy na szerokim ekranie (od 1600 px). */
export const FAVOURITE_INTERVALS = ['1m', '5m', '15m', '1h'] as const;

export const INTERVAL_MENU = INTERVALS.map((i, k) => ({ value: i.id, label: i.label, hint: k < 10 ? String((k + 1) % 10) : undefined }));

/** Warstwy włączone na wykresie ceny: oko (ukryj / pokaż), plakietka źródła i wiek danych; na dole całe okno wskaźników. */
export const LayersMenu: React.FC<{
  chips: readonly LayerChip[];
  /** Klucze, które użytkownik ukrył okiem w tym otwarciu (zostają na liście, żeby dało się je przywrócić). */
  hidden: ReadonlySet<string>;
  onToggle: (c: LayerChip, show: boolean) => void;
  onAll: () => void;
  compact?: boolean;
}> = ({ chips, hidden, onToggle, onAll, compact = false }) => {
  const shown = chips.filter((c) => !hidden.has(c.key)).length;
  // To, co odbiega od danych na żywo (MODEL, SIM, wiek migawki, „—, tylko BTC”), widać na samym przycisku
  const odd = chips.find((c) => !hidden.has(c.key) && c.tone !== 'live');
  return (
    <Dropdown
      ariaLabel={tr(`Warstwy na wykresie: ${shown}`, `Layers on the chart: ${shown}`)}
      title={tr('Warstwy na wykresie ceny: źródło danych, wiek, ukrycie', 'Layers on the price chart: data source, age, hide')}
      width="w-72"
      label={
        <>
          <Layers aria-hidden="true" className="w-4 h-4 shrink-0" />
          {!compact && <span className="hidden @min-[1180px]:inline">{tr('Warstwy', 'Layers')}</span>}
          <span className="font-mono text-ink-3">({shown})</span>
          {odd && (
            <Badge tone={odd.tone} size="sm">
              {odd.text}
            </Badge>
          )}
        </>
      }
    >
      {(close) => (
        <>
          {chips.length === 0 && <p className="px-2.5 py-2 text-[11px] leading-snug text-ink-3">{tr('Na wykresie ceny nie ma włączonych warstw.', 'No layers are on the price chart.')}</p>}
          {chips.map((c) => {
            const on = !hidden.has(c.key);
            return (
              <MenuItem
                key={c.key}
                kind="check"
                checked={on}
                title={c.hint}
                icon={on ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                onSelect={() => onToggle(c, !on)}
                hint={
                  <Badge tone={c.tone} size="sm">
                    {c.text}
                  </Badge>
                }
              >
                <span className={on ? 'text-ink-1' : 'text-ink-3 line-through'}>{c.label}</span>
              </MenuItem>
            );
          })}
          <MenuSeparator />
          <MenuItem
            icon={<Layers className="w-4 h-4" />}
            onSelect={() => {
              close();
              onAll();
            }}
          >
            {tr('Wszystkie warstwy i wskaźniki…', 'All layers and indicators…')}
          </MenuItem>
        </>
      )}
    </Dropdown>
  );
};

/** Pozycja menu „⋯”: zwykła, przełącznik albo wybór z grupy; `section` — nagłówek przed pozycją. */
export interface MoreEntry {
  key: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  on: () => void;
  kind?: 'item' | 'check' | 'radio';
  checked?: boolean;
  hint?: string;
  section?: string;
  title?: string;
}

export const MoreMenu: React.FC<{ entries: readonly MoreEntry[]; btnRef?: React.RefObject<HTMLButtonElement | null>; badge?: boolean }> = ({ entries, btnRef, badge = false }) => (
  <Dropdown
    icon
    caret={false}
    align="right"
    width="w-72"
    btnRef={btnRef}
    ariaLabel={tr('Więcej: rysowanie, taśma, alarmy, ustawienia, układ, zrzut, link, pełny ekran', 'More: drawing, tape, alerts, settings, layout, screenshot, link, full screen')}
    menuLabel={tr('Więcej', 'More')}
    label={
      <span className="relative inline-flex">
        <MoreHorizontal aria-hidden="true" className="w-4 h-4" />
        {badge && <span aria-hidden="true" className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-critical ring-2 ring-surface-1" />}
      </span>
    }
  >
    {(close) => {
      const indent = entries.some((e) => e.kind === 'check' || e.kind === 'radio');
      return entries.map((e) => {
        const Icon = e.icon;
        return (
          <React.Fragment key={e.key}>
            {e.section && <MenuSection title={e.section} />}
            <MenuItem
              kind={e.kind}
              checked={e.checked}
              indent={indent}
              title={e.title}
              hint={e.hint}
              icon={Icon ? <Icon className="w-4 h-4" /> : undefined}
              onSelect={() => {
                close();
                e.on();
              }}
            >
              {e.label}
            </MenuItem>
          </React.Fragment>
        );
      });
    }}
  </Dropdown>
);
