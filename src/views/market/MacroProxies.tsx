import React from 'react';
import { useDesk } from '../../state/DeskContext';
import { freshness, MacroFit, PERIOD_MS, useCrossMarket } from '../../state/useCrossMarket';
import { HIP3_MACRO, Hip3Tile, recentlyFlat } from '../../utils/hlMarkets';
import { Badge, Panel, Sparkline, Stat, fmtPrice, fmtSigned, DASH, fmtFixed } from '../../ui';
import { tr } from '../../i18n';

const H = 3_600_000;

function priceDigits(p: number): number {
  return p >= 1000 ? 1 : p >= 10 ? 2 : p >= 1 ? 4 : 6;
}

/** Interpretacja R² (udział wariancji 5-min ruchów BTC współwystępującej z proxy). */
function r2Text(r2: number): string {
  if (r2 < 0.1) return tr('BTC porusza się głównie własnym rytmem — makro wyjaśnia mniej niż 10% wariancji.', 'BTC moves mostly to its own rhythm; macro explains less than 10% of the variance.');
  if (r2 < 0.3) return tr('Umiarkowane sprzężenie z akcjami — ruch indeksu warto mieć na oku przy planie.', 'Moderate coupling with equities; keep an eye on the index when planning.');
  return tr('Silne sprzężenie z rynkiem akcji — ruchy indeksu przenoszą się na BTC.', 'Strong coupling with the stock market; index moves carry over to BTC.');
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
      title={tr('Proxy makro (HIP-3)', 'Macro proxies (HIP-3)')}
      eyebrow={tr('trade.xyz na Hyperliquid — proxy, nie indeks kasowy', 'trade.xyz on Hyperliquid: a proxy, not the cash index')}
      actions={
        <Badge
          tone={fr === 'live' ? 'live' : 'stale'}
          title={tr('metaAndAssetCtxs (dex „xyz”) co 60 s, świece co 5 min — publiczne API Hyperliquid', 'metaAndAssetCtxs (dex "xyz") every 60 s, candles every 5 min; public Hyperliquid API')}
        >
          {fr === 'live' ? 'LIVE' : fr === 'stale' ? 'STALE' : tr('BRAK', 'NONE')}
        </Badge>
      }
      bodyClassName="p-4 flex flex-col gap-4"
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-5">
        {tiles.map((t, i) => {
          const spec = HIP3_MACRO[i];
          if (!t) return <Stat key={spec.key} label={spec.label} value={<span className="text-ink-3">{DASH}</span>} hint={tr('Czekam na API', 'Waiting for the API')} />;
          if (!t.coin)
            return <Stat key={t.key} label={t.label} value={<span className="text-ink-3">n/a</span>} hint={tr('Brak rynku w dexie xyz', 'No market in the xyz dex')} />;
          const candles = cm.hip3Candles[t.key] ?? [];
          const closed = t.quiet || recentlyFlat(candles, now, H) === true;
          const closes = candles.map((c) => c.c);
          return (
            <div key={t.key} title={`${t.coin} · ${tr('cena perpa HIP-3, nie indeks kasowy', 'HIP-3 perp price, not the cash index')}`} className="min-w-0">
              <Stat
                label={t.label}
                value={<span className="text-base">{t.markPx !== null ? fmtPrice(t.markPx, priceDigits(t.markPx)) : 'n/a'}</span>}
                delta={t.change24hPct !== null ? { value: t.change24hPct, text: `${fmtFixed(Math.abs(t.change24hPct), 2)}%` } : null}
                hint={
                  closed ? (
                    <span title={tr('Brak wolumenu albo zmian w ostatnich godzinach — sesja kasowa mogła się skończyć', 'No volume or changes in recent hours; the cash session may have ended')}>
                      {tr('rynek zamknięty?', 'market closed?')}
                    </span>
                  ) : (
                    t.coin
                  )
                }
                trend={
                  <Sparkline
                    values={closes}
                    width={64}
                    height={28}
                    className="text-ink-2"
                    ariaLabel={
                      closes.length > 1
                        ? tr(
                            `${t.label}, 48 h co 1 h: od ${fmtPrice(closes[0], priceDigits(closes[0]))} do ${fmtPrice(closes[closes.length - 1], priceDigits(closes[0]))}`,
                            `${t.label}, 48 h hourly: from ${fmtPrice(closes[0], priceDigits(closes[0]))} to ${fmtPrice(closes[closes.length - 1], priceDigits(closes[0]))}`
                          )
                        : `${t.label}: ${tr('brak świec', 'no candles')}`
                    }
                  />
                }
              />
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-ink-3 -mt-1">
        {tr('Zmiana: 24 h · linia: ostatnie 48 h (świece 1h) · ceny perpów HIP-3, nie indeksy kasowe.', 'Change: 24 h · line: last 48 h (1h candles) · HIP-3 perp prices, not cash indices.')}
      </p>

      <section className="pt-3 border-t border-line flex flex-col gap-3" aria-labelledby="macro-share-title">
        <div className="flex items-center justify-between gap-2">
          <h3 id="macro-share-title" className="text-[13px] font-semibold text-ink-1 font-sans">
            {tr('Udział makro w ruchu BTC (R²)', 'Macro share of the BTC move (R²)')}
          </h3>
          <Badge tone="model" title={tr('OLS na log-zwrotach 5m z ostatnich 24 h, wyrównanych po czasie; zwroty przez lukę pominięte', 'OLS on 5m log returns from the last 24 h, aligned in time; returns across a gap skipped')}>
            MODEL
          </Badge>
        </div>
        <FitRow label="Nasdaq-100" m={cm.macroFit?.XYZ100 ?? null} />
        <FitRow label="S&P 500" m={cm.macroFit?.SP500 ?? null} />
        <p className="text-xs text-ink-2 leading-relaxed">{best >= 0 ? r2Text(best) : tr('Za mało wspólnych świec 5m, by policzyć zależność (proxy stoi albo rynek zamknięty).', 'Too few common 5m candles to compute the relationship (the proxy is flat or the market is closed).')}</p>
        <p className="text-[11px] text-ink-3 leading-relaxed">
          {tr(
            'Zastrzeżenie: zależność jest niestabilna w czasie (IMF 2022: korelacja BTC–S&P 500 wzrosła z 0,01 do 0,36 po 2020) i liczona z jednej doby. Poza sesją kasową i w weekend proxy stoi — wtedy R² nic nie mówi o makro. β: ruch proxy o 1% ≈ ruch BTC o β% w tym oknie.',
            'Caveat: the relationship is unstable over time (IMF 2022: the BTC–S&P 500 correlation rose from 0.01 to 0.36 after 2020) and is computed from one day. Outside the cash session and at weekends the proxy is flat, so R² says nothing about macro. β: a 1% proxy move ≈ a β% BTC move in this window.'
          )}
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
            R² {fmtFixed(m.fit.r2 * 100, 0)}% <span className="text-ink-3">· β {fmtSigned(m.fit.beta, 2)} · n {m.fit.n}</span>
          </>
        ) : (
          <span className="text-ink-3">n/a{m ? ` · n ${m.n} < 30 ${tr('lub proxy stoi', 'or proxy flat')}` : ''}</span>
        )}
      </span>
    </div>
  );
};

export default MacroProxies;
