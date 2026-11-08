import React, { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { tr } from '../../i18n';

/** Przycisk drugorzędny zakładki (kopiowanie, linki instalacji): wysokość dotykowa na telefonie, niższy od `sm`. */
export const BTN_SECONDARY =
  'inline-flex items-center justify-center gap-1.5 min-h-11 sm:min-h-9 px-3 rounded-lg border border-line-strong bg-surface-2 text-ink-1 text-sm font-medium hover:bg-surface-3 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-surface-2';

/**
 * Kopiowanie tekstu do schowka z potwierdzeniem na przycisku (3 s). Bez dostępu do schowka komunikat `fallback` mówi,
 * jak skopiować ręcznie; stan ogłasza region `aria-live`.
 */
export const CopyButton: React.FC<{ text: string; label: string; fallback: string }> = ({ text, label, fallback }) => {
  const [state, setState] = useState<'idle' | 'done' | 'fail'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const id = window.setTimeout(() => setState('idle'), state === 'done' ? 3000 : 8000);
    return () => window.clearTimeout(id);
  }, [state]);

  const copy = () => {
    if (!navigator.clipboard) return setState('fail');
    navigator.clipboard.writeText(text).then(
      () => setState('done'),
      () => setState('fail')
    );
  };

  return (
    <span className="inline-flex flex-col items-start gap-1 min-w-0">
      <button type="button" onClick={copy} className={BTN_SECONDARY}>
        {state === 'done' ? <Check className="w-4 h-4 text-accent" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
        {state === 'done' ? tr('Skopiowano', 'Copied') : label}
      </button>
      <span role="status" aria-live="polite" className="text-xs text-warn leading-snug">
        {state === 'fail' ? fallback : ''}
      </span>
    </span>
  );
};
