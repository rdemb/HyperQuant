import React from 'react';
import { tr } from '../i18n';

const SLOW_MS = 15000;

/**
 * Uczciwy stan startowy: zanim przyjdą realne świece, widoki zależne od danych nic nie liczą. `compact` — jeden wiersz
 * w miejscu pojedynczego panelu (np. pas kontekstu Przed sesją), z tym samym ostrzeżeniem po 15 s i ponowieniem.
 */
export const ConnectingState: React.FC<{ onRetry: () => void; startedAt: number; now: number; compact?: boolean }> = ({ onRetry, startedAt, now, compact }) => {
  const slow = now - startedAt > SLOW_MS;
  const slowText = tr(
    'To trwa dłużej niż zwykle. Sprawdź połączenie lub rozszerzenia blokujące żądania do api.hyperliquid.xyz.',
    'This is taking longer than usual. Check your connection or extensions that block requests to api.hyperliquid.xyz.'
  );
  const retry = (
    <button type="button" onClick={onRetry} className="min-h-11 px-4 rounded-lg bg-surface-3 border border-line-strong text-sm font-medium hover:bg-surface-2">
      {tr('Spróbuj ponownie', 'Try again')}
    </button>
  );
  if (compact) {
    return (
      <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-surface-1 border border-line rounded-xl px-4 py-2.5 text-sm">
        <span className="flex-1 min-w-[14rem] text-ink-2 leading-relaxed">
          {tr('Łączenie z Hyperliquid… Liczby pojawią się po pierwszej synchronizacji.', 'Connecting to Hyperliquid… The numbers appear after the first sync.')}
          {slow && <span className="block text-warn">{slowText}</span>}
        </span>
        {retry}
      </div>
    );
  }
  return (
    <div className="max-w-xl mx-auto mt-10 bg-surface-1 border border-line rounded-xl p-6 flex flex-col gap-3">
      <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Hyperliquid</div>
      <h2 className="font-display text-lg font-semibold">{tr('Łączenie z danymi rynkowymi…', 'Connecting to market data…')}</h2>
      <p className="text-sm text-ink-2 leading-relaxed">
        {tr(
          'HyperQuant nie pokazuje danych zastępczych — wykres i metryki pojawią się po pierwszej udanej synchronizacji z publicznym API Hyperliquid.',
          'HyperQuant never shows placeholder data. The chart and metrics appear after the first successful sync with the public Hyperliquid API.'
        )}
      </p>
      {slow && <p className="text-sm text-warn leading-relaxed">{slowText}</p>}
      <div>{retry}</div>
    </div>
  );
};
