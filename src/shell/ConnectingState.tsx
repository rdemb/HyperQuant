import React from 'react';
import { tr } from '../i18n';

/** Uczciwy stan startowy: zanim przyjdą realne świece, widoki zależne od danych nic nie liczą. */
export const ConnectingState: React.FC<{ onRetry: () => void; startedAt: number; now: number }> = ({ onRetry, startedAt, now }) => {
  const slow = now - startedAt > 15000;
  return (
    <div className="max-w-xl mx-auto mt-10 bg-surface-1 border border-line rounded-xl p-6 flex flex-col gap-3">
      <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Hyperliquid</div>
      <h2 className="font-display text-lg font-semibold">{tr('Łączenie z danymi rynkowymi…', 'Connecting to market data…')}</h2>
      <p className="text-sm text-ink-2 leading-relaxed">
        {tr(
          'Desk nie pokazuje danych zastępczych — wykres, metryki i Analizator planu pojawią się po pierwszej udanej synchronizacji z publicznym API Hyperliquid.',
          'The Desk never shows placeholder data. The chart, metrics and Plan Analyzer appear after the first successful sync with the public Hyperliquid API.'
        )}
      </p>
      {slow && (
        <p className="text-sm text-warn leading-relaxed">
          {tr(
            'To trwa dłużej niż zwykle. Sprawdź połączenie lub rozszerzenia blokujące żądania do api.hyperliquid.xyz.',
            'This is taking longer than usual. Check your connection or extensions that block requests to api.hyperliquid.xyz.'
          )}
        </p>
      )}
      <div>
        <button type="button" onClick={onRetry} className="min-h-11 px-4 rounded-lg bg-surface-3 border border-line-strong text-sm font-medium hover:bg-surface-2">
          {tr('Spróbuj ponownie', 'Try again')}
        </button>
      </div>
    </div>
  );
};
