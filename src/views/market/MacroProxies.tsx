import React from 'react';
import { useDesk } from '../../state/DeskContext';
import { freshness, MacroFit, PERIOD_MS, useCrossMarket } from '../../state/useCrossMarket';
import { HIP3_MACRO, Hip3Tile, recentlyFlat } from '../../utils/hlMarkets';
import { Badge, Panel, Sparkline, Stat, fmtPrice, fmtSigned, DASH } from '../../ui';

const H = 3_600_000;

function priceDigits(p: number): number {
  return p >= 1000 ? 1 : p >= 10 ? 2 : p >= 1 ? 4 : 6;
}

/** Interpretacja R² (udział wariancji 5-min ruchów BTC współwystępującej z proxy). */
function r2Text(r2: number): string {
  if (r2 < 0.1) return 'BTC porusza się głównie własnym rytmem — makro wyjaśnia mniej niż 10% wariancji.';
  if (r2 < 0.3) return 'Umiarkowane sprzężenie z akcjami — ruch indeksu warto mieć na oku przy planie.';
  return 'Silne sprzężenie z rynkiem akcji — ruchy indeksu przenoszą się na BTC.';
}

/** Proxy makro z HIP-3 (trade.xyz): kafle cen, sparkline 48×1h i udział makro w ruchu BTC (R²). */
export const MacroProxies: React.FC = () => {
  const { feed } = useDesk();
  const cm = useCrossMarket(['macro']);
  const now = feed.nowTick;
  const fr = freshness(cm.hip3At, PERIOD_MS.macro, now);
  const tiles: (Hip3Tile | null)[] = cm.hip3 ?? HIP3_MACRO.map(() => null);
  const best = cm.macroFit ? Math.max(cm.macroFit.XYZ100.fit?.r2 ?? -1, cm.macroFit.SP500.fit?.r2 ?? -1) : -1;

  return (
    <Panel
      title="Proxy makro (HIP-3)"
      eyebrow="trade.xyz na Hyperliquid — proxy, nie indeks kasowy"
      actions={
        <Badge tone={fr === 'live' ? 'live' : 'stale'} title="metaAndAssetCtxs (dex „xyz”) co 60 s, świece co 5 min — publiczne API Hyperliquid">
          {fr === 'live' ? 'LIVE' : fr === 'stale' ? 'STALE' : 'BRAK'}
        </Badge>
      }
      bodyClassName="p-4 flex flex-col gap-4"
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-5">
        {tiles.map((t, i) => {
          const spec = HIP3_MACRO[i];
          if (!t) return <Stat key={spec.key} label={spec.label} value={<span className="text-ink-3">{DASH}</span>} hint="Czekam na API" />;
          if (!t.coin)
            return <Stat key={t.key} label={t.label} value={<span className="text-ink-3">n/a</span>} hint="Brak rynku w dexie xyz" />;
          const candles = cm.hip3Candles[t.key] ?? [];
          const closed = t.quiet || recentlyFlat(candles, now, H) === true;
          const closes = candles.map((c) => c.c);
          return (
            <div key={t.key} title={`${t.coin} · cena perpa HIP-3, nie indeks kasowy`} className="min-w-0">
              <Stat
                label={t.label}
                value={<span className="text-base">{t.markPx !== null ? fmtPrice(t.markPx, priceDigits(t.markPx)) : 'n/a'}</span>}
                delta={t.change24hPct !== null ? { value: t.change24hPct, text: `${Math.abs(t.change24hPct).toFixed(2)}%` } : null}
                hint={closed ? <span title="Brak wolumenu albo zmian w ostatnich godzinach — sesja kasowa mogła się skończyć">rynek zamknięty?</span> : t.coin}
                trend={
                  <Sparkline
                    values={closes}
                    width={64}
                    height={28}
                    className="text-ink-2"
                    ariaLabel={
                      closes.length > 1
                        ? `${t.label}, 48 h co 1 h: od ${fmtPrice(closes[0], priceDigits(closes[0]))} do ${fmtPrice(closes[closes.length - 1], priceDigits(closes[0]))}`
                        : `${t.label}: brak świec`
                    }
                  />
                }
              />
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-ink-3 -mt-1">Zmiana: 24 h · linia: ostatnie 48 h (świece 1h) · ceny perpów HIP-3, nie indeksy kasowe.</p>

      <section className="pt-3 border-t border-line flex flex-col gap-3" aria-labelledby="macro-share-title">
        <div className="flex items-center justify-between gap-2">
          <h3 id="macro-share-title" className="text-[13px] font-semibold text-ink-1 font-sans">
            Udział makro w ruchu BTC (R²)
          </h3>
          <Badge tone="model" title="OLS na log-zwrotach 5m z ostatnich 24 h, wyrównanych po czasie; zwroty przez lukę pominięte">
            MODEL
          </Badge>
        </div>
        <FitRow label="Nasdaq-100" m={cm.macroFit?.XYZ100 ?? null} />
        <FitRow label="S&P 500" m={cm.macroFit?.SP500 ?? null} />
        <p className="text-xs text-ink-2 leading-relaxed">{best >= 0 ? r2Text(best) : 'Za mało wspólnych świec 5m, by policzyć zależność (proxy stoi albo rynek zamknięty).'}</p>
        <p className="text-[11px] text-ink-3 leading-relaxed">
          Zastrzeżenie: zależność jest niestabilna w czasie (IMF 2022: korelacja BTC–S&P 500 wzrosła z 0.01 do 0.36 po 2020) i liczona z jednej doby.
          Poza sesją kasową i w weekend proxy stoi — wtedy R² nic nie mówi o makro. β: ruch proxy o 1% ≈ ruch BTC o β% w tym oknie.
        </p>
      </section>
    </Panel>
  );
};

/** Wiersz: R² jako miernik 0–100% + β i liczba par zwrotów. */
const FitRow: React.FC<{ label: string; m: MacroFit | null }> = ({ label, m }) => {
  const r2 = m?.fit?.r2 ?? null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[180px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <span className="text-xs text-ink-2 truncate">{label}</span>
      <span className="hidden sm:block relative h-2 rounded-full bg-surface-3 overflow-hidden" aria-hidden="true">
        {r2 !== null && <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.max(1, r2 * 100).toFixed(1)}%` }} />}
      </span>
      <span className="text-xs font-mono tabular-nums text-ink-1 text-right whitespace-nowrap">
        {m?.fit ? (
          <>
            R² {(m.fit.r2 * 100).toFixed(0)}% <span className="text-ink-3">· β {fmtSigned(m.fit.beta, 2)} · n {m.fit.n}</span>
          </>
        ) : (
          <span className="text-ink-3">n/a{m ? ` · n ${m.n} < 30 lub proxy stoi` : ''}</span>
        )}
      </span>
    </div>
  );
};

export default MacroProxies;
