import React, { useMemo, useState } from 'react';
import { Copy, Eye, EyeOff, Plus, Search, Settings, Star, Trash2, X } from 'lucide-react';
import type { ChartSettings } from './settings';
import { GROUPS, INDICATORS, IndicatorInstance, MAX_INDICATORS, addIndicator, copyIndicator, indicatorDef, indicatorLabel } from '../indicators/registry';
import { tr } from '../../../i18n';

/**
 * Okno wskaźników, jak w TradingView: wyszukiwarka (PL i EN, skróty, aliasy), ulubione, lista „Na wykresie”
 * z ustawieniami, kopią i usunięciem, a w sekcjach warstwy orderflow, klasyczne wskaźniki i panele pod wykresem.
 * Klawisze: `/` otwiera okno z kursorem w wyszukiwarce, strzałki wybierają, Enter dodaje albo włącza, Esc zamyka.
 */

/** Przełącznik ustawień wykresu (warstwa orderflow albo panel pod wykresem). */
export type ToggleKey = { [K in keyof ChartSettings]: ChartSettings[K] extends boolean ? K : never }[keyof ChartSettings];

export interface ToggleItem {
  key: ToggleKey;
  label: string;
  hint: string;
  /** Klasa próbki koloru (Tailwind). */
  swatch?: string;
  /** Powód, dla którego warstwa nie działa na tym interwale lub rynku. */
  off?: string;
  /** Dodatkowe słowa wyszukiwania (np. nazwa wskaźnika w TradingView). */
  aliases?: string;
}

export type IndicatorsSection = 'fav' | 'chart' | 'flow' | 'classic' | 'hl' | 'panes';

/** Wiersz listy: klasyczny wskaźnik (dodawany, `on` brak) albo przełącznik (`on` — stan). */
interface Entry {
  key: string;
  section: 'flow' | 'classic' | 'hl' | 'panes';
  label: string;
  hint: string;
  badge?: string;
  swatch?: string;
  off?: string;
  words: string;
  on?: boolean;
  run: () => void;
}

const FAV_KEY = 'hq.charts.indicators.fav.v1';

function loadFavs(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveFavs(list: string[]): void {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(list));
  } catch {
    // Prywatne okno albo zablokowana pamięć — ulubione działają do zamknięcia okna
  }
}

/** Tekst do wyszukiwania: małe litery bez polskich znaków („zmiennosc” znajduje „Zmienność”). */
const norm = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l');

const SECTION_NAME: Record<IndicatorsSection, string> = {
  fav: tr('Ulubione', 'Favourites'),
  chart: tr('Na wykresie', 'On the chart'),
  flow: 'Orderflow',
  classic: tr('Klasyczne', 'Classic'),
  hl: tr('Tylko Hyperliquid', 'Hyperliquid only'),
  panes: tr('Pod wykresem', 'Below the chart'),
};

const ICON_BTN = 'w-8 h-8 shrink-0 inline-flex items-center justify-center rounded-md text-ink-3 hover:text-ink-1 hover:bg-surface-3';

export const IndicatorsDialog: React.FC<{
  s: ChartSettings;
  layers: readonly ToggleItem[];
  /** Panele pod wykresem w wynikach wyszukiwania (na telefonie wybór panelu jest w sekcji). */
  panes: readonly ToggleItem[];
  /** Zawartość sekcji „Pod wykresem”. */
  panesTab: React.ReactNode;
  section: IndicatorsSection;
  onSection: (s: IndicatorsSection) => void;
  narrow: boolean;
  onChange: (p: Partial<ChartSettings>) => void;
  onEdit: (iid: string) => void;
  onClose: () => void;
}> = ({ s, layers, panes, panesTab, section, onSection, narrow, onChange, onEdit, onClose }) => {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [favs, setFavs] = useState(loadFavs);
  const list = s.indicators;
  const full = list.length >= MAX_INDICATORS;
  const setList = (indicators: IndicatorInstance[]) => onChange({ indicators });

  const entries = useMemo((): Entry[] => {
    const toggle = (section: Entry['section']) => (i: ToggleItem): Entry => ({
      key: i.key,
      section,
      label: i.label,
      hint: i.off ?? i.hint,
      swatch: i.swatch,
      off: i.off,
      words: norm(`${i.label} ${i.key.replace(/^show/, '')} ${i.aliases ?? ''}`),
      on: s[i.key],
      run: () => onChange({ [i.key]: !s[i.key] }),
    });
    return [
      ...layers.map(toggle('flow')),
      ...INDICATORS.map(
        (d): Entry => ({
          key: d.id,
          section: d.group === 'hyperliquid' ? 'hl' : 'classic',
          label: d.name,
          hint: d.hint,
          // Długi skrót (Supertrend, Stoch RSI) nie mieści się w kolumnie skrótów; jest też w nazwie
          badge: d.short.length > 5 ? undefined : d.short,
          words: norm(`${d.short} ${d.name} ${d.aliases}`),
          run: () => onChange({ indicators: addIndicator(s.indicators, d.id) }),
        })
      ),
      ...panes.map(toggle('panes')),
    ];
  }, [s, layers, panes, onChange]);

  const q = norm(query.trim());
  const shown = useMemo(() => {
    if (q) {
      const words = q.split(/\s+/);
      const hits = entries.filter((e) => words.every((w) => e.words.includes(w)));
      // Najpierw trafienia od początku skrótu albo nazwy („rsi”, „vwap”)
      const head = (e: Entry) => norm(e.badge ?? '').startsWith(q) || norm(e.label).startsWith(q);
      return [...hits.filter(head), ...hits.filter((e) => !head(e))];
    }
    if (section === 'fav') return favs.map((k) => entries.find((e) => e.key === k)).filter((e): e is Entry => e !== undefined);
    if (section === 'flow' || section === 'classic' || section === 'hl') return entries.filter((e) => e.section === section);
    return [];
  }, [q, entries, section, favs]);
  const at = Math.min(active, shown.length - 1);

  const toggleFav = (key: string) => {
    const next = favs.includes(key) ? favs.filter((k) => k !== key) : [...favs, key];
    setFavs(next);
    saveFavs(next);
  };

  const row = (e: Entry, i: number) => {
    const fav = favs.includes(e.key);
    const add = e.on === undefined;
    return (
      <li key={e.key} role="option" aria-selected={i === at} className={`flex items-start gap-1 rounded-lg ${i === at && q ? 'bg-surface-3' : ''} ${e.off ? 'opacity-55' : ''}`}>
        <button
          type="button"
          aria-pressed={fav}
          aria-label={fav ? tr(`Usuń z ulubionych: ${e.label}`, `Remove from favourites: ${e.label}`) : tr(`Dodaj do ulubionych: ${e.label}`, `Add to favourites: ${e.label}`)}
          title={fav ? tr('Usuń z ulubionych', 'Remove from favourites') : tr('Dodaj do ulubionych', 'Add to favourites')}
          onClick={() => toggleFav(e.key)}
          className={`${ICON_BTN} mt-0.5 ${fav ? 'text-warn hover:text-warn' : ''}`}
        >
          <Star className="w-4 h-4" fill={fav ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          disabled={add && full}
          aria-pressed={add ? undefined : e.on}
          aria-label={add ? tr(`Dodaj: ${e.label}`, `Add: ${e.label}`) : undefined}
          onMouseEnter={() => q && setActive(i)}
          onClick={e.run}
          className="flex-1 min-w-0 flex items-start gap-2.5 py-1.5 pr-2 text-left rounded-lg hover:bg-surface-3/60 disabled:opacity-40"
        >
          {add ? (
            <span className="mt-0.5 w-9 shrink-0 font-mono text-[11px] text-ink-2">{e.badge}</span>
          ) : (
            <span
              className={`mt-0.5 w-4 h-4 shrink-0 rounded border grid place-items-center text-[11px] leading-none ${e.on ? 'bg-accent border-accent text-page' : 'border-line-strong'}`}
              aria-hidden="true"
            >
              {e.on ? '✓' : ''}
            </span>
          )}
          <span className="flex flex-col gap-0.5 min-w-0 flex-1">
            <span className="flex items-center gap-2 text-ink-1">
              {e.swatch && <span className={`inline-block w-3.5 h-[3px] rounded-full shrink-0 ${e.swatch}`} aria-hidden="true" />}
              {e.label}
              {q && <span className="ml-auto pl-2 text-[10px] text-ink-3 whitespace-nowrap">{SECTION_NAME[e.section]}</span>}
            </span>
            <span className="text-[11px] leading-snug text-ink-3">{e.hint}</span>
          </span>
          {add && <Plus className="mt-0.5 w-4 h-4 shrink-0 text-ink-3" aria-hidden="true" />}
        </button>
      </li>
    );
  };

  const ownShown = list.filter((x) => x.visible && indicatorDef(x.id).pane === 'own').length;
  const flowAll = layers.every((i) => s[i.key]);
  const counts: Partial<Record<IndicatorsSection, number>> = {
    fav: favs.length,
    chart: list.length,
    flow: layers.filter((i) => s[i.key]).length,
  };

  return (
    <div
      role="dialog"
      aria-label={tr('Wskaźniki', 'Indicators')}
      className="flex flex-col h-full rounded-xl border border-line-strong bg-surface-2 text-xs shadow-2xl"
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          setActive(Math.max(0, Math.min(shown.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1))));
        } else if (e.key === 'Enter' && e.target instanceof HTMLInputElement && shown[at]) {
          e.preventDefault();
          shown[at].run();
        }
      }}
    >
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2 border-b border-line">
        <Search className="w-4 h-4 shrink-0 text-ink-3" aria-hidden="true" />
        <input
          type="search"
          value={query}
          autoFocus={!narrow}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          aria-label={tr('Szukaj wskaźnika', 'Search indicators')}
          placeholder={tr('Szukaj: RSI, Bollinger, VWAP, CVD…', 'Search: RSI, Bollinger, VWAP, CVD…')}
          className="flex-1 min-w-0 h-9 bg-transparent text-sm text-ink-1 placeholder:text-ink-3 outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button type="button" aria-label={tr('Wyczyść', 'Clear')} title={tr('Wyczyść', 'Clear')} onClick={() => setQuery('')} className="h-8 px-2 rounded-md text-ink-3 hover:text-ink-1 hover:bg-surface-3">
            {tr('Wyczyść', 'Clear')}
          </button>
        )}
        <button type="button" aria-label={tr('Zamknij', 'Close')} title={tr('Zamknij (Esc)', 'Close (Esc)')} onClick={onClose} className={ICON_BTN}>
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex flex-col sm:flex-row flex-1 min-h-0">
        {!q && (
          <nav
            aria-label={tr('Sekcje', 'Sections')}
            className="flex sm:flex-col gap-0.5 shrink-0 sm:w-40 p-1.5 overflow-x-auto [scrollbar-width:none] border-b sm:border-b-0 sm:border-r border-line"
          >
            {(Object.keys(SECTION_NAME) as IndicatorsSection[]).map((id) => (
              <button
                key={id}
                type="button"
                aria-current={section === id}
                onClick={() => {
                  onSection(id);
                  setActive(0);
                }}
                className={`flex items-center gap-1.5 h-9 px-2.5 rounded-md whitespace-nowrap text-left ${section === id ? 'bg-surface-3 text-ink-1 font-medium' : 'text-ink-2 hover:text-ink-1 hover:bg-surface-3/60'}`}
              >
                {id === 'fav' && <Star className="w-3.5 h-3.5 text-warn" fill="currentColor" aria-hidden="true" />}
                <span className="flex-1">{SECTION_NAME[id]}</span>
                {!!counts[id] && <span className="font-mono text-[10px] text-ink-3">{counts[id]}</span>}
              </button>
            ))}
          </nav>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
          {q ? (
            shown.length > 0 ? (
              <ul role="listbox" aria-label={tr('Wyniki', 'Results')} className="flex flex-col gap-0.5">
                {shown.map(row)}
              </ul>
            ) : (
              <p className="px-2 py-6 text-center text-ink-3">{tr('Nic nie pasuje. Spróbuj skrótu (RSI) albo innej nazwy.', 'Nothing matches. Try a short name (RSI) or another name.')}</p>
            )
          ) : section === 'chart' ? (
            <OnChart list={list} onList={setList} onEdit={onEdit} narrow={narrow} ownShown={ownShown} />
          ) : section === 'panes' ? (
            <div className="px-1">{panesTab}</div>
          ) : section === 'fav' && shown.length === 0 ? (
            <p className="px-2 py-6 text-center text-ink-3 leading-snug">
              {tr('Kliknij gwiazdkę przy wskaźniku albo warstwie, a znajdziesz je tutaj.', 'Click the star next to an indicator or layer and it will be here.')}
            </p>
          ) : section === 'classic' ? (
            <>
              {GROUPS.map((g) => (
                <div key={g.id} className="mb-1.5">
                  <div className="px-2 pt-1 pb-0.5 text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">{g.name}</div>
                  <ul className="flex flex-col gap-0.5">{shown.map((e, i) => (indicatorDef(e.key as IndicatorInstance['id']).group === g.id ? row(e, i) : null))}</ul>
                </div>
              ))}
              <p className="px-2 pt-1 text-[11px] leading-snug text-ink-3">
                {tr(
                  'Wzory i wartości domyślne jak we wbudowanych wskaźnikach TradingView, liczone ze świec Hyperliquid. Wskaźnik opisuje ostatnie świece, nie przewiduje następnych.',
                  "Formulas and defaults as in TradingView's built-in indicators, computed from Hyperliquid candles. An indicator describes recent candles; it does not predict the next ones."
                )}
              </p>
            </>
          ) : (
            <>
              {section === 'flow' && (
                <div className="flex justify-end px-1 pb-1">
                  <button
                    type="button"
                    onClick={() => onChange(Object.fromEntries(layers.map((i) => [i.key, !flowAll])) as Partial<ChartSettings>)}
                    className="min-h-8 px-2.5 rounded-md border border-line-strong text-ink-2 hover:text-ink-1 hover:bg-surface-3"
                  >
                    {flowAll ? tr('Wyłącz wszystkie', 'Turn all off') : tr('Włącz wszystkie', 'Turn all on')}
                  </button>
                </div>
              )}
              <ul className="flex flex-col gap-0.5">{shown.map(row)}</ul>
              {section === 'hl' && (
                <p className="px-2 pt-1 text-[11px] leading-snug text-ink-3">
                  {tr(
                    'Wskaźniki z danych, których nie ma w samych świecach: nagranej taśmy transakcji i otwartych pozycji Hyperliquid. Nie ma ich w TradingView. Opisują ostatnie świece, nie przewidują następnych.',
                    'Indicators from data the candles alone do not carry: the recorded Hyperliquid trade tape and open interest. TradingView does not have them. They describe recent candles; they do not predict the next ones.'
                  )}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/** Wskaźniki na wykresie: ustawienia (klik w nazwę albo koło zębate), widoczność, kopia i usunięcie. */
const OnChart: React.FC<{ list: IndicatorInstance[]; onList: (l: IndicatorInstance[]) => void; onEdit: (iid: string) => void; narrow: boolean; ownShown: number }> = ({
  list,
  onList,
  onEdit,
  narrow,
  ownShown,
}) => {
  const patch = (iid: string, p: Partial<IndicatorInstance>) => onList(list.map((x) => (x.iid === iid ? { ...x, ...p } : x)));
  if (list.length === 0)
    return (
      <p className="px-2 py-6 text-center text-ink-3 leading-snug">
        {tr('Brak klasycznych wskaźników. Dodaj je w sekcji „Klasyczne” albo wyszukaj (np. EMA).', 'No classic indicators yet. Add them in “Classic” or search (e.g. EMA).')}
      </p>
    );
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-0.5">
        {list.map((x) => {
          const label = indicatorLabel(x);
          return (
            <li key={x.iid} className={`flex items-center gap-1 min-h-10 rounded-lg pl-2 ${x.visible ? '' : 'opacity-55'}`}>
              <button type="button" onClick={() => onEdit(x.iid)} title={tr('Ustawienia', 'Settings')} className="flex-1 min-w-0 flex items-center gap-2.5 h-9 text-left text-ink-1 hover:underline underline-offset-2">
                <span className="inline-block w-4 h-[3px] rounded-full shrink-0" style={{ background: x.color, opacity: Math.max(x.alpha, 0.15) }} aria-hidden="true" />
                <span className="font-mono truncate">{label}</span>
                <span className="text-ink-3 truncate hidden sm:inline">{indicatorDef(x.id).pane === 'own' ? tr('własny panel', 'own pane') : tr('na cenie', 'on price')}</span>
              </button>
              <button
                type="button"
                aria-pressed={!x.visible}
                aria-label={x.visible ? tr(`Ukryj: ${label}`, `Hide: ${label}`) : tr(`Pokaż: ${label}`, `Show: ${label}`)}
                title={x.visible ? tr('Ukryj', 'Hide') : tr('Pokaż', 'Show')}
                onClick={() => patch(x.iid, { visible: !x.visible })}
                className={`${ICON_BTN} ${x.visible ? '' : 'text-ink-1'}`}
              >
                {x.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>
              <button type="button" aria-label={tr(`Ustawienia: ${label}`, `Settings: ${label}`)} title={tr('Ustawienia', 'Settings')} onClick={() => onEdit(x.iid)} className={ICON_BTN}>
                <Settings className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={list.length >= MAX_INDICATORS}
                aria-label={tr(`Kopiuj: ${label}`, `Copy: ${label}`)}
                title={tr('Kopiuj (te same parametry, inny kolor)', 'Copy (same inputs, another colour)')}
                onClick={() => onList(copyIndicator(list, x.iid))}
                className={`${ICON_BTN} disabled:opacity-40`}
              >
                <Copy className="w-4 h-4" />
              </button>
              <button type="button" aria-label={tr(`Usuń: ${label}`, `Remove: ${label}`)} title={tr('Usuń', 'Remove')} onClick={() => onList(list.filter((y) => y.iid !== x.iid))} className={`${ICON_BTN} hover:text-critical`}>
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          );
        })}
      </ul>
      {narrow && ownShown > 1 && (
        <p className="px-2 text-[11px] leading-snug text-ink-3">
          {tr(
            'Na telefonie pod wykresem widać jeden panel wskaźnika: pierwszy widoczny na liście. Pozostałe wracają na szerszym ekranie.',
            'On a phone one indicator pane shows below the chart: the first visible one in the list. The others return on a wider screen.'
          )}
        </p>
      )}
      <p className="px-2 text-[11px] leading-snug text-ink-3">
        {tr(
          'Kliknij nazwę wskaźnika tutaj albo w legendzie wykresu, żeby zmienić parametry i styl. Link do widoku zawiera widoczne wskaźniki.',
          'Click an indicator name here or in the chart legend to change its inputs and style. The view link includes the visible indicators.'
        )}
      </p>
    </div>
  );
};
