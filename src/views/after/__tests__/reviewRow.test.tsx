import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReviewRow } from '../../../utils/sessionReview';
import { RowView } from '../SessionReview';

const row = (over: Partial<ReviewRow>): ReviewRow => ({
  id: 'range',
  key: 'range',
  label: 'Zakres / oczekiwany',
  value: '—',
  badge: 'MODEL',
  hint: 'MODEL · Parkinson: brak świec',
  why: 'brak świec 1m',
  scope: 'session',
  replayAt: null,
  ...over,
});

describe('Rozliczenie sesji: wiersz', () => {
  it('„—” bez plakietki źródła, z powodem obok', () => {
    const html = renderToStaticMarkup(<RowView row={row({})} replay={null} />);
    expect(html).not.toMatch(/>(LIVE|MODEL)</);
    expect(html).toContain('brak świec 1m');
  });

  it('liczba z plakietką źródła', () => {
    const html = renderToStaticMarkup(<RowView row={row({ value: '82%', why: undefined })} replay={null} />);
    expect(html).toMatch(/>MODEL</);
    expect(html).toMatch(/text-accent[^>]*>MODEL</);
  });

  it('liczba częściowa (luka): plakietka źródła w tonie nieaktualnym, powód obok', () => {
    const html = renderToStaticMarkup(<RowView row={row({ id: 'map', value: '2/4 dotknięte', badge: 'LIVE', why: 'reszta nierozliczona' })} replay={null} />);
    expect(html).toMatch(/text-warn[^>]*>LIVE</);
    expect(html).toContain('reszta nierozliczona');
  });
});
