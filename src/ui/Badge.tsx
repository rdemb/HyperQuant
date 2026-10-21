import React from 'react';

export type BadgeTone = 'live' | 'model' | 'sim' | 'stale' | 'neutral' | 'warn';

const TONES: Record<BadgeTone, string> = {
  live: 'text-buy-ink border-buy/40 bg-buy/10',
  model: 'text-accent border-accent/40 bg-accent/10',
  sim: 'text-zone border-zone/50 bg-zone/10',
  stale: 'text-warn border-warn/40 bg-warn/10',
  warn: 'text-warn border-warn/40 bg-warn/10',
  neutral: 'text-ink-2 border-line-strong bg-surface-2',
};

/** Znacznik pochodzenia/stanu danych: LIVE / MODEL / SIM / STALE. */
export const Badge: React.FC<{ tone: BadgeTone; children: React.ReactNode; title?: string; testId?: string }> = ({
  tone,
  children,
  title,
  testId,
}) => (
  <span
    data-testid={testId}
    title={title}
    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold tracking-wide uppercase whitespace-nowrap ${TONES[tone]}`}
  >
    {children}
  </span>
);
