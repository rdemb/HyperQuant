import React from 'react';
import { tr } from '../i18n';
import { fmtFixed } from './format';
import type { Quality } from '../utils/marketQuality';

/**
 * Plakietka jakości danych rynku (projekt 60, Q4): dobre / ograniczone / złe / cena platformy, powód w podpowiedzi.
 * Kolory neutralne i ostrzegawcze, bez kolorów kierunku.
 */
const LABEL: Record<Quality['level'], string> = {
  good: tr('dane: dobre', 'data: good'),
  limited: tr('dane: ograniczone', 'data: limited'),
  bad: tr('dane: złe', 'data: poor'),
  platform: tr('cena platformy', 'platform price'),
  na: tr('dane: —', 'data: —'),
};
const TONE: Record<Quality['level'], string> = {
  good: 'border-line-strong text-ink-2',
  limited: 'border-warn/50 text-warn',
  bad: 'border-sell/60 text-sell-ink',
  platform: 'border-line-strong text-ink-3',
  na: 'border-line text-ink-3',
};

export function qualityWhy(q: Quality): string {
  const parts: string[] = [];
  if (q.reasons.includes('no-ctx')) parts.push(tr('brak świeżego odczytu giełdy', 'no fresh exchange reading'));
  if (q.reasons.includes('platform')) parts.push(tr('rynek bazowy nie notuje: cenę wyznacza arkusz platformy, wyrocznia stoi', 'the underlying market is closed: the platform order book sets the price, the oracle is idle'));
  if (q.spreadBp !== null) parts.push(tr(`spread impact ${fmtFixed(q.spreadBp, 1)} pb`, `impact spread ${fmtFixed(q.spreadBp, 1)} bp`));
  else if (q.reasons.includes('no-impact')) parts.push(tr('—: brak notowań impact', '—: no impact quotes'));
  if (q.markOracleBp !== null && !q.reasons.includes('platform')) parts.push(tr(`mark − wyrocznia ${fmtFixed(q.markOracleBp, 1)} pb`, `mark − oracle ${fmtFixed(q.markOracleBp, 1)} bp`));
  return parts.join(' · ');
}

export const QualityChip: React.FC<{ q: Quality }> = ({ q }) => (
  <span data-jakosc={q.level} title={qualityWhy(q)} className={`inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-medium whitespace-nowrap ${TONE[q.level]}`}>
    {LABEL[q.level]}
  </span>
);
