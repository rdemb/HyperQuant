import React, { useEffect, useId, useRef, useState } from 'react';
import { CircleHelp } from 'lucide-react';

/**
 * Znak „?” w nagłówku panelu: objaśnienie (stały akapit, który wcześniej zabierał wiersze danych) w okienku pod
 * nagłówkiem. Przycisk ma `aria-expanded` i `aria-controls`; Escape i kliknięcie obok zamykają (Escape oddaje fokus).
 * Na telefonie cel dotyku 44 px.
 */
export const HelpButton: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({ label, children, className = '' }) => {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      btn.current?.focus();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <span ref={ref} className={`static shrink-0 ${className}`}>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center justify-center w-11 h-11 sm:w-7 sm:h-7 rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${open ? 'text-ink-1 bg-surface-3' : 'text-ink-3 hover:text-ink-1 hover:bg-surface-2'}`}
      >
        <CircleHelp className="w-4 h-4" aria-hidden="true" />
      </button>
      {open && (
        <div id={id} role="note" className="absolute left-2 right-2 top-full mt-1 z-30 max-h-[60vh] overflow-y-auto rounded-xl border border-line-strong bg-surface-2 p-3 shadow-2xl text-[11px] leading-snug text-ink-2 space-y-1.5">
          {children}
        </div>
      )}
    </span>
  );
};
