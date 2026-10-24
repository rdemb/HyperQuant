import React from 'react';

/** Uczciwy stan startowy: zanim przyjdą realne świece, widoki zależne od danych nic nie liczą. */
export const ConnectingState: React.FC<{ onRetry: () => void; startedAt: number; now: number }> = ({ onRetry, startedAt, now }) => {
  const slow = now - startedAt > 15000;
  return (
    <div className="max-w-xl mx-auto mt-10 bg-surface-1 border border-line rounded-xl p-6 flex flex-col gap-3">
      <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Hyperliquid</div>
      <h2 className="font-display text-lg font-semibold">Łączenie z danymi rynkowymi…</h2>
      <p className="text-sm text-ink-2 leading-relaxed">
        Desk nie pokazuje danych zastępczych — wykres, metryki i Analizator planu pojawią się po pierwszej udanej synchronizacji z publicznym API Hyperliquid.
      </p>
      {slow && (
        <p className="text-sm text-warn leading-relaxed">
          To trwa dłużej niż zwykle. Sprawdź połączenie lub rozszerzenia blokujące żądania do api.hyperliquid.xyz.
        </p>
      )}
      <div>
        <button type="button" onClick={onRetry} className="min-h-11 px-4 rounded-lg bg-surface-3 border border-line-strong text-sm font-medium hover:bg-surface-2">
          Spróbuj ponownie
        </button>
      </div>
    </div>
  );
};
