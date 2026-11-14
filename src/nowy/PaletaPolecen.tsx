import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CornerDownLeft, Search } from 'lucide-react';
import { useMarkets } from '../state/markets';
import { bareName } from '../utils/marketsTable';
import { lang, tr } from '../i18n';
import type { NavItem } from '../shell/AppShell';
import { filtruj, type Akcja, type Polecenie } from './polecenia';

/**
 * Paleta poleceń (⌘K / Ctrl+K, przycisk „Szukaj”): widoki, wykres rynku z rejestru, strony statyczne, język.
 * Klawiatura: strzałki, Enter, Escape; fokus wraca do elementu sprzed otwarcia.
 */
export const PaletaPolecen: React.FC<{
  open: boolean;
  onClose: () => void;
  onAkcja: (a: Akcja) => void;
  widoki: NavItem[];
  zewnetrzne: { href: string; label: string }[];
  przelaczniki: { co: 'strumien' | 'synchronizuj' | 'dzwiek'; etykieta: string }[];
}> = ({ open, onClose, onAkcja, widoki, zewnetrzne, przelaczniki }) => {
  const { markets } = useMarkets();
  const [q, setQ] = useState('');
  const [aktywny, setAktywny] = useState(0);
  const listaId = useId();
  const poprzedni = useRef<HTMLElement | null>(null);

  const lista = useMemo<Polecenie[]>(
    () => [
      ...widoki.map((n) => ({ id: `v-${n.id}`, grupa: tr('Widoki', 'Views'), etykieta: n.label, slowa: n.id, akcja: { typ: 'widok', id: n.id } as Akcja })),
      ...markets.map((m) => ({
        id: `m-${m.coin}`,
        grupa: tr('Wykres rynku', 'Market chart'),
        etykieta: bareName(m),
        slowa: m.dex || 'Hyperliquid',
        akcja: { typ: 'rynek', coin: m.coin } as Akcja,
      })),
      ...zewnetrzne.map((l) => ({ id: `l-${l.href}`, grupa: tr('Strony', 'Pages'), etykieta: l.label, akcja: { typ: 'link', href: l.href } as Akcja })),
      ...przelaczniki.map((x) => ({ id: `p-${x.co}`, grupa: tr('Dane', 'Data'), etykieta: x.etykieta, akcja: { typ: 'przelacznik', co: x.co } as Akcja })),
      lang === 'pl'
        ? { id: 'j-en', grupa: tr('Język', 'Language'), etykieta: 'English', slowa: 'EN language jezyk', akcja: { typ: 'jezyk', lang: 'en' } as Akcja }
        : { id: 'j-pl', grupa: tr('Język', 'Language'), etykieta: 'Polski', slowa: 'PL language jezyk', akcja: { typ: 'jezyk', lang: 'pl' } as Akcja },
    ],
    [widoki, markets, zewnetrzne, przelaczniki]
  );
  const wyniki = useMemo(() => filtruj(lista, q), [lista, q]);

  useEffect(() => setAktywny(0), [q, open]);
  useEffect(() => {
    if (open) {
      poprzedni.current = document.activeElement as HTMLElement | null;
      return;
    }
    setQ('');
    poprzedni.current?.focus?.();
  }, [open]);

  const wybierz = (p: Polecenie | undefined) => {
    if (!p) return;
    onClose();
    onAkcja(p.akcja);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      // aria-modal: fokus nie wychodzi do tła (jedyny element z fokusem to pole wyszukiwania)
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAktywny((i) => (wyniki.length ? (i + 1) % wyniki.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAktywny((i) => (wyniki.length ? (i - 1 + wyniki.length) % wyniki.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      wybierz(wyniki[aktywny]);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] px-4 bg-hq-obsidian/70 backdrop-blur-sm"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={tr('Paleta poleceń', 'Command palette')}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onKey}
            className="w-full max-w-lg rounded-xl bg-hq-surface border border-hq-line-strong shadow-2xl overflow-hidden"
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-hq-line">
              <Search className="w-4 h-4 text-hq-cyan shrink-0" aria-hidden="true" />
              <input
                type="text"
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                role="combobox"
                aria-expanded="true"
                aria-controls={listaId}
                aria-activedescendant={wyniki[aktywny] ? `${listaId}-${aktywny}` : undefined}
                aria-label={tr('Szukaj widoku, rynku albo strony', 'Search for a view, market or page')}
                placeholder={tr('Widok, rynek (ETH, HYPE), strona…', 'View, market (ETH, HYPE), page…')}
                className="w-full bg-transparent text-sm text-hq-ink-1 placeholder:text-hq-ink-3 outline-none"
              />
              <kbd className="font-hq-mono text-[10px] px-1.5 py-0.5 rounded bg-hq-elevated text-hq-ink-2">Esc</kbd>
            </div>
            <ul id={listaId} role="listbox" className="max-h-80 overflow-y-auto p-2 space-y-0.5">
              {wyniki.length === 0 ? (
                <li className="py-8 text-center text-xs text-hq-ink-3">{tr('Brak wyników', 'No results')}</li>
              ) : (
                wyniki.map((p, i) => (
                  <li
                    key={p.id}
                    id={`${listaId}-${i}`}
                    role="option"
                    aria-selected={i === aktywny}
                    onMouseEnter={() => setAktywny(i)}
                    onClick={() => wybierz(p)}
                    className={`flex items-center justify-between gap-3 px-3 min-h-10 rounded-lg text-sm cursor-pointer ${
                      i === aktywny ? 'bg-hq-cyan/15 text-hq-ink-1' : 'text-hq-ink-2 hover:bg-hq-elevated'
                    }`}
                  >
                    <span className="flex items-baseline gap-2 min-w-0">
                      <span className="font-medium truncate">{p.etykieta}</span>
                      <span className="text-[11px] text-hq-ink-3 truncate">{p.grupa}</span>
                    </span>
                    {i === aktywny && <CornerDownLeft className="w-3.5 h-3.5 shrink-0 text-hq-cyan" aria-hidden="true" />}
                  </li>
                ))
              )}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
