import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { menuKey, openFocusIndex } from './menuKeys';

/**
 * Lista rozwijana paska wykresu (wzorzec WAI-ARIA „menu button”): przycisk z `aria-haspopup`, `aria-expanded` i
 * `aria-controls`, panel `role="menu"` z pozycjami `menuitem` / `menuitemradio` / `menuitemcheckbox`. Strzałki, Home i End
 * chodzą po pozycjach, Enter i spacja wybierają, Escape zamyka i oddaje fokus przyciskowi, Tab i kliknięcie obok zamykają.
 * Po otwarciu fokus na zaznaczonej pozycji. Na telefonie pozycje mają co najmniej 44 px wysokości.
 */

const ITEM_SEL = '[role="menuitem"]:not([disabled]),[role="menuitemradio"]:not([disabled]),[role="menuitemcheckbox"]:not([disabled])';

/** Wygląd przycisku paska (ten sam co przyciski narzędzi): wysokość 36 px na komputerze, 44 px na telefonie. */
export const BAR_BTN =
  'inline-flex items-center gap-1.5 min-h-11 sm:min-h-0 sm:h-9 px-2.5 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
export const barBtnTone = (on: boolean) => (on ? 'bg-surface-3 text-ink-1 border-line-strong' : 'text-ink-2 border-line hover:text-ink-1 hover:bg-surface-2');

export interface DropdownProps {
  /** Treść przycisku (bez strzałki). */
  label: React.ReactNode;
  ariaLabel: string;
  title?: string;
  /** Nazwa panelu dla czytnika ekranu (domyślnie `ariaLabel`). */
  menuLabel?: string;
  align?: 'left' | 'right';
  /** Klasa szerokości panelu. */
  width?: string;
  /** Klasy opakowania (np. `hidden sm:block`). */
  className?: string;
  /** Przycisk wyróżniony (np. włączona warstwa). */
  active?: boolean;
  /** Strzałka przy przycisku (lista); bez niej sam przycisk ikony (np. ⋯). */
  caret?: boolean;
  /** Przycisk ikony bez ramki: kwadrat 36 px (44 px na telefonie). */
  icon?: boolean;
  btnRef?: React.RefObject<HTMLButtonElement | null>;
  /** Zawartość panelu; `close` zamyka (fokus wraca na przycisk). */
  children: (close: () => void) => React.ReactNode;
}

export const Dropdown: React.FC<DropdownProps> = ({ label, ariaLabel, title, menuLabel, align = 'left', width = 'w-64', className = '', active = false, caret = true, icon = false, btnRef, children }) => {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const ownBtn = useRef<HTMLButtonElement>(null);
  const btn = btnRef ?? ownBtn;
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useCallback(
    (refocus = true) => {
      setOpen(false);
      if (refocus) btn.current?.focus();
    },
    [btn]
  );
  const items = () => [...(panelRef.current?.querySelectorAll<HTMLElement>(ITEM_SEL) ?? [])];

  // Po otwarciu: fokus na zaznaczonej pozycji (albo pierwszej); kliknięcie obok zamyka bez cofania fokusu
  useEffect(() => {
    if (!open) return;
    const list = items();
    list[openFocusIndex(list.map((el) => el.getAttribute('aria-checked') === 'true'))]?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const onPanelKey = (e: React.KeyboardEvent) => {
    // Pola tekstowe w panelu (np. nazwa karty) obsługują klawisze same
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const list = items();
    const res = menuKey(e.key, list.indexOf(document.activeElement as HTMLElement), list.length);
    if (!res) return;
    if (res.kind === 'move') {
      e.preventDefault();
      list[res.to]?.focus();
    } else {
      if (res.refocus) e.preventDefault();
      // Escape nie trafia dalej (skróty wykresu, szuflada DOM)
      e.stopPropagation();
      close(res.refocus);
    }
  };

  return (
    <div ref={rootRef} className={`relative shrink-0 ${className}`}>
      <button
        ref={btn}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={ariaLabel}
        title={title ?? ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={
          icon
            ? `inline-flex items-center justify-center w-11 h-11 sm:w-9 sm:h-9 rounded-lg border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${open || active ? 'bg-surface-3 text-ink-1 border-line-strong' : 'text-ink-2 border-transparent hover:text-ink-1 hover:bg-surface-2 hover:border-line'}`
            : `${BAR_BTN} ${barBtnTone(open || active)}`
        }
      >
        {label}
        {caret && <ChevronDown aria-hidden="true" className={`w-3.5 h-3.5 shrink-0 text-ink-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />}
      </button>
      {open && (
        <div
          ref={panelRef}
          id={id}
          role="menu"
          aria-label={menuLabel ?? ariaLabel}
          onKeyDown={onPanelKey}
          className={`absolute top-full mt-1 z-40 ${align === 'right' ? 'right-0' : 'left-0'} ${width} max-w-[calc(100vw-16px)] max-h-[min(70vh,560px)] overflow-y-auto bg-surface-2 border border-line-strong rounded-xl p-1.5 shadow-2xl flex flex-col text-xs`}
        >
          {children(() => close(true))}
        </div>
      )}
    </div>
  );
};

/** Pozycja listy: zwykła (`menuitem`), wybór jednego (`radio`) albo przełącznik (`check`). */
export const MenuItem: React.FC<{
  onSelect: () => void;
  children: React.ReactNode;
  kind?: 'item' | 'radio' | 'check';
  checked?: boolean;
  icon?: React.ReactNode;
  /** Dopisek z prawej (skrót klawiszowy, interwały karty). */
  hint?: React.ReactNode;
  disabled?: boolean;
  title?: string;
  className?: string;
  /** Miejsce na znacznik wyboru także przy zwykłej pozycji (lista z przełącznikami i zwykłymi pozycjami). */
  indent?: boolean;
}> = ({ onSelect, children, kind = 'item', checked, icon, hint, disabled, title, className = '', indent = false }) => (
  <button
    type="button"
    role={kind === 'radio' ? 'menuitemradio' : kind === 'check' ? 'menuitemcheckbox' : 'menuitem'}
    aria-checked={kind === 'item' ? undefined : !!checked}
    disabled={disabled}
    title={title}
    tabIndex={-1}
    onClick={onSelect}
    className={`flex items-center gap-2.5 w-full min-h-11 sm:min-h-9 px-2.5 rounded-lg text-left text-ink-1 hover:bg-surface-3 focus:bg-surface-3 focus:outline-none disabled:opacity-40 disabled:hover:bg-transparent ${className}`}
  >
    {(kind !== 'item' || indent) && <Check aria-hidden="true" className={`w-4 h-4 shrink-0 ${kind !== 'item' && checked ? 'text-accent' : 'invisible'}`} />}
    {icon && <span className="w-4 h-4 shrink-0 grid place-items-center text-ink-3">{icon}</span>}
    <span className="flex-1 min-w-0 truncate">{children}</span>
    {hint && <span className="shrink-0 font-mono text-[10px] text-ink-3">{hint}</span>}
  </button>
);

/** Nagłówek grupy pozycji (bez fokusu). */
export const MenuSection: React.FC<{ title: string }> = ({ title }) => (
  <div role="presentation" className="px-2.5 pt-2 pb-1 text-[10px] uppercase tracking-[0.08em] text-ink-3 font-medium first:pt-1">
    {title}
  </div>
);

export const MenuSeparator: React.FC = () => <div role="separator" className="my-1 border-t border-line" />;

/** Lista wyboru jednej wartości (rynek, interwał, rodzaj wykresu). */
export function DropdownSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  label,
  title,
  width = 'w-48',
  className,
}: {
  value: T;
  options: readonly { value: T; label: React.ReactNode; title?: string; hint?: React.ReactNode }[];
  onChange: (v: T) => void;
  ariaLabel: string;
  label: React.ReactNode;
  title?: string;
  width?: string;
  className?: string;
}) {
  return (
    <Dropdown label={label} ariaLabel={ariaLabel} title={title} width={width} className={className}>
      {(close) =>
        options.map((o) => (
          <MenuItem
            key={o.value}
            kind="radio"
            checked={o.value === value}
            title={o.title}
            hint={o.hint}
            onSelect={() => {
              close();
              if (o.value !== value) onChange(o.value);
            }}
          >
            {o.label}
          </MenuItem>
        ))
      }
    </Dropdown>
  );
}
