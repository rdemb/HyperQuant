import React from 'react';
import { tr } from '../i18n';
import { type ModelCardId, openModelCard } from './modelCard';

export type BadgeTone = 'live' | 'model' | 'sim' | 'stale' | 'neutral' | 'warn';

const TONES: Record<BadgeTone, string> = {
  live: 'text-ink-1 border-line-strong bg-surface-2',
  model: 'text-ink-1 border-line-strong bg-surface-2',
  sim: 'text-sim border-dashed border-sim/70 bg-sim/10',
  stale: 'text-warn border-warn/40 bg-warn/10',
  warn: 'text-warn border-warn/40 bg-warn/10',
  neutral: 'text-ink-2 border-line-strong bg-surface-2',
};

/**
 * Znak pochodzenia czytelny bez koloru: ● LIVE (pełny, „lume”), ◐ MODEL (połowa), ○ SIM (przerywany), ◌ STALE (pusty).
 * Kształt niesie znaczenie, kolor tylko je wzmacnia (WCAG 1.4.1).
 */
const MARKS: Partial<Record<BadgeTone, string>> = {
  live: 'bg-lume ring-1 ring-ink-1/60',
  model: 'border-[1.5px] border-ink-1 bg-[linear-gradient(90deg,var(--color-ink-1)_50%,transparent_50%)]',
  sim: 'border-[1.5px] border-dashed border-sim',
  stale: 'border-[1.5px] border-warn',
};

/**
 * Znacznik pochodzenia/stanu danych: LIVE / MODEL / SIM / STALE. `size="sm"` — mniejszy (nagłówek układu na telefonie).
 * `card` — plakietka jest przyciskiem karty modelu (metoda, dane, słabości, wynik poza próbą; `ui/modelCard`).
 */
export const Badge: React.FC<{ tone: BadgeTone; children: React.ReactNode; title?: string; testId?: string; size?: 'sm'; card?: ModelCardId }> = ({
  tone,
  children,
  title,
  testId,
  size,
  card,
}) => {
  const cls = `inline-flex items-center gap-1 rounded border font-semibold tracking-wide uppercase whitespace-nowrap ${size === 'sm' ? 'px-1 py-px text-[9px]' : 'px-1.5 py-0.5 text-[10px]'} ${TONES[tone]}`;
  const inner = (
    <>
      {MARKS[tone] && <span aria-hidden="true" className={`shrink-0 rounded-full ${size === 'sm' ? 'size-1.5' : 'size-2'} ${MARKS[tone]}`} />}
      {children}
    </>
  );
  if (!card)
    return (
      <span data-testid={testId} data-tone={tone} title={title} className={cls}>
        {inner}
      </span>
    );
  return (
    <button
      type="button"
      data-testid={testId}
      data-tone={tone}
      data-model-card={card}
      title={title ? `${title} · ${tr('karta modelu', 'model card')}` : tr('Karta modelu', 'Model card')}
      aria-haspopup="dialog"
      aria-label={tr(`${typeof children === 'string' ? children : 'MODEL'}: karta modelu`, `${typeof children === 'string' ? children : 'MODEL'}: model card`)}
      onClick={(e) => {
        // Plakietka bywa w klikalnej karcie albo wierszu: karta modelu zamiast akcji rodzica
        e.preventDefault();
        e.stopPropagation();
        openModelCard(card, e.currentTarget);
      }}
      className={`${cls} cursor-help hover:border-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent transition-colors duration-150`}
    >
      {inner}
    </button>
  );
};
