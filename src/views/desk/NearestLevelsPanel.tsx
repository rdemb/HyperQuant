import React, { useEffect, useState } from 'react';
import { Badge, DASH, EmptyState, Panel, fmtCompact, fmtFixed, fmtPct } from '../../ui';
import { fmtPx } from '../../charts/pro/core/footprintBar';
import { fmtHm } from '../../charts/pro/core/time';
import { storeFor } from '../../charts/pro/store/proStore';
import { startRecording } from '../../charts/pro/store/recording';
import { useStoreVersion } from '../../charts/pro/store/useStoreVersion';
import { marketLabel } from '../../config/deskMarkets';
import { tr } from '../../i18n';
import { marketOf } from '../../state/markets';
import { useDeskLedger } from '../../state/useDeskLedger';
import { useEntryMap } from '../../state/useEntryMap';
import { useLiqMap } from '../../state/useLiqMap';
import { ATR_N, type LevelRow, type MissingLevel, type NearestLevels, type ScanMeta, nearestLevels } from '../../utils/nearestLevels';
import { scannerAge } from '../../utils/scanState';
import { type Got, isAbsent } from '../../utils/sessionText';
import { readLevelInputs } from './nearestInputs';

/** Bez zmian w magazynie (cisza, brak połączenia) i tak co tyle przeliczamy: wiek migawek skanera, granice sesji. */
const TICK_MS = 30_000;

/**
 * Najbliższe poziomy (W sesji i Przed sesją): poziomy nad i pod ceną rynku wykresu z odległością w % i w ATR świec 5m
 * oraz paliwem likwidacji między ceną a poziomem (utils/nearestLevels — te same funkcje co linie na wykresie).
 * Przeliczane najwyżej co 2 s przy zmianach magazynu.
 */
export const NearestLevelsPanel: React.FC<{ coin: string }> = ({ coin }) => {
  const store = storeFor(coin);
  useEffect(() => startRecording(store), [store]);
  useStoreVersion(store, 2_000);
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);
  const liq = useLiqMap();
  const entry = useEntryMap();
  const ledger = useDeskLedger();
  const n = nearestLevels(readLevelInputs(store, { liq, entry, ledger }));
  return <NearestLevelsView n={n} />;
};

/** Widok listy: drabinka od najdalszego poziomu nad ceną, przez cenę, do najdalszego pod nią; braki z powodem pod spodem. */
export const NearestLevelsView: React.FC<{ n: NearestLevels }> = ({ n }) => {
  const sz = marketOf(n.coin)?.szDecimals;
  const px = (p: number) => fmtPx(p, sz);
  const atr = isAbsent(n.atr) ? null : n.atr;
  // Wspólna skala osi odległości: najdalszy poziom listy dochodzi do brzegu osi
  const skala = Math.max(0, ...[...n.above, ...n.below].map((r) => Math.abs(r.distPct)).filter(Number.isFinite));
  const atrTag = (
    <span className="text-[11px] text-ink-3" title={atr ? tr(`ATR(${atr.n}) świec 5m: średni prawdziwy zakres ${atr.n} ostatnich zamkniętych świec`, `ATR(${atr.n}) of 5m candles: mean true range of the last ${atr.n} closed candles`) : isAbsent(n.atr) ? n.atr.why : undefined}>
      <span data-etykieta>{`ATR(${ATR_N}) 5m`}</span> <span className="font-mono tabular-nums text-ink-2">{atr ? px(atr.value) : DASH}</span>
    </span>
  );
  return (
    <Panel
      id="najblizsze-poziomy"
      eyebrow={tr(`Poziomy wokół ceny · ${marketLabel(n.coin)}`, `Levels around the price · ${marketLabel(n.coin)}`)}
      title={tr('Najbliższe poziomy', 'Nearest levels')}
      actions={atrTag}
    >
      {isAbsent(n.price) ? (
        <EmptyState
          title={n.price.why}
          detail={tr('Lista pojawi się po pierwszej cenie rynku; poziomy liczymy ze świec Hyperliquid i migawek skanera.', 'The list appears after the first market price; the levels come from Hyperliquid candles and scanner snapshots.')}
        />
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_4.25rem_2.5rem_4.75rem] md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_5rem_3.5rem_5rem] gap-x-2 px-4 pt-2.5 pb-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-3 sm:grid-cols-[minmax(0,1fr)_5rem_3.5rem_5rem]">
            <span>{tr('Poziom', 'Level')}</span>
            <span className="hidden md:block text-center" title={tr('Położenie poziomu wobec ceny (środek osi) w skali najdalszego poziomu z listy', 'Level position against the price (axis centre), scaled to the farthest level in the list')}>
              {tr('Oś: pod ceną · nad ceną', 'Axis: below · above')}
            </span>
            <span className="text-right">{tr('Odległość', 'Distance')}</span>
            <span className="text-right">ATR</span>
            <span className="text-right" title={tr('USD likwidacji z mapy skanera między ceną a poziomem', 'USD of liquidations on the scanner map between the price and the level')}>
              {tr('Paliwo', 'Fuel')}
            </span>
          </div>
          <ol className="flex flex-col pb-1" aria-label={tr('Poziomy nad ceną i pod nią', 'Levels above and below the price')}>
            {[...n.above].reverse().map((r) => (
              <Row key={r.id} r={r} px={px} skala={skala} />
            ))}
            <li className="mx-4 my-1 flex items-center justify-between gap-2 rounded-md border border-line-strong bg-surface-2 px-2.5 py-1 text-xs">
              <span className="text-ink-2">{tr('Cena', 'Price')}</span>
              <span className="font-mono tabular-nums text-ink-1">{px(n.price)}</span>
            </li>
            {n.below.map((r) => (
              <Row key={r.id} r={r} px={px} skala={skala} />
            ))}
            {n.above.length === 0 && n.below.length === 0 && <li className="px-4 py-2 text-xs text-ink-3">{tr('Żaden poziom nie ma jeszcze liczby (powody niżej).', 'No level has a number yet (reasons below).')}</li>}
          </ol>
          <Missing list={n.missing} />
          <Legend n={n} />
        </>
      )}
    </Panel>
  );
};

/** Wiersz poziomu; dotknięcie rozwija opis (skąd liczba), jak kafle Czwórki. */
const Row: React.FC<{ r: LevelRow; px: (p: number) => string; skala: number }> = ({ r, px, skala }) => {
  const [open, setOpen] = useState(false);
  // Położenie na osi: środek = cena, brzeg = najdalszy poziom listy (te same procenty co kolumna „Odległość”)
  const pos = skala > 0 && Number.isFinite(r.distPct) ? 50 + Math.max(-1, Math.min(1, r.distPct / skala)) * 46 : 50;
  const fuelWhy = isAbsent(r.fuel) ? r.fuel.why : undefined;
  return (
    <li>
      <button
        type="button"
        data-poziom={r.id}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={r.hint}
        className="grid w-full grid-cols-[minmax(0,1fr)_4.25rem_2.5rem_4.75rem] md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_5rem_3.5rem_5rem] items-center gap-x-2 px-4 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:grid-cols-[minmax(0,1fr)_5rem_3.5rem_5rem]"
      >
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
            <span className="min-w-0 leading-snug text-ink-1">{r.label}</span>
            <Badge tone={r.badge === 'LIVE' ? 'live' : 'model'} size="sm">
              {r.badge}
            </Badge>
          </span>
          <span className="font-mono text-[11px] tabular-nums text-ink-3">{px(r.px)}</span>
        </span>
        <span aria-hidden="true" className="hq-os-poziomu hidden md:block relative h-5">
          <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
          <span className="absolute left-1/2 top-0.5 bottom-0.5 w-px bg-lume shadow-[0_0_6px_var(--color-lume)]" />
          <span className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-ink-3/45" style={{ left: `${Math.min(50, pos)}%`, width: `${Math.abs(pos - 50)}%` }} />
          <span
            className={`hq-os-kropka absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${r.badge === 'LIVE' ? 'border-ink-1 bg-ink-1' : 'border-ink-1 bg-surface-1'}`}
            style={{ left: `${pos}%` }}
          />
        </span>
        <span className="text-right font-mono tabular-nums text-ink-1">{fmtPct(r.distPct, 2)}</span>
        <span className="text-right font-mono tabular-nums text-ink-2">{r.distAtr === null ? DASH : fmtFixed(r.distAtr, 1)}</span>
        <span className={`text-right font-mono tabular-nums ${fuelWhy ? 'text-ink-3' : 'text-ink-2'}`} title={fuelWhy}>
          {isAbsent(r.fuel) ? DASH : fmtCompact(r.fuel, '$')}
        </span>
      </button>
      {open && <p className="px-4 pb-2 text-[11px] leading-snug text-ink-3">{r.hint}</p>}
    </li>
  );
};

/** Poziomy bez liczby, zgrupowane po wspólnym powodzie (np. rynek bez skanera: cztery poziomy, jedno zdanie). */
const Missing: React.FC<{ list: readonly MissingLevel[] }> = ({ list }) => {
  if (list.length === 0) return null;
  const groups = new Map<string, MissingLevel[]>();
  for (const m of list) groups.set(m.why, [...(groups.get(m.why) ?? []), m]);
  return (
    <div className="border-t border-line px-4 py-2.5">
      <h3 className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-3">{tr('Bez liczby', 'No number')}</h3>
      <ul className="mt-1 flex flex-col gap-1">
        {[...groups].map(([why, ms]) => (
          <li key={why} className="text-[11px] leading-snug text-ink-3">
            <span className="text-ink-2">{ms.map((m) => m.label).join(', ')}</span> {DASH} {why}
          </li>
        ))}
      </ul>
    </div>
  );
};

/**
 * Stan migawki skanera w legendzie: pokrycie open interest i chwila stanu (wiek po 2 min), albo „—” z powodem (powód już
 * widoczny przy poziomach bez liczby — bez powtórki).
 */
function scanText(m: Got<ScanMeta>, n: NearestLevels, name: string): string {
  const now = n.now;
  if (isAbsent(m)) {
    const why = m.why;
    return n.missing.some((x) => x.why === why) ? `${name}: ${DASH}` : `${name}: ${DASH} ${why}`;
  }
  const age = scannerAge(m.asOf, now);
  const late = m.delayed ? tr(', połowa wartości z odczytów starszych niż 15 min', ', half of the value from reads older than 15 min') : '';
  return tr(
    `${name}: pokrycie ${fmtFixed(m.share * 100, 0)}% open interest, stan z ${fmtHm(m.asOf)}${age ? ` (${age} temu)` : ''}${late}`,
    `${name}: coverage ${fmtFixed(m.share * 100, 0)}% of open interest, as of ${fmtHm(m.asOf)}${age ? ` (${age} ago)` : ''}${late}`
  );
}

const Legend: React.FC<{ n: NearestLevels }> = ({ n }) => (
  <p className="border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-ink-3">
    {tr(
      `Odległość w % od ceny (plus: poziom nad ceną) i w ATR(${ATR_N}) świec 5m. Paliwo: USD likwidacji z mapy skanera między ceną a poziomem, longi i shorty razem. `,
      `Distance in % of the price (plus: the level is above the price) and in ATR(${ATR_N}) of 5m candles. Fuel: USD of liquidations on the scanner map between the price and the level, longs and shorts together. `
    )}
    {scanText(n.liq, n, tr('Mapa likwidacji', 'Liquidation map'))}. {scanText(n.entry, n, tr('Uwięzieni', 'Trapped positions'))}.{' '}
    {n.hidden > 0 && tr(`Dalszych poziomów poza listą: ${n.hidden}. `, `Further levels left off the list: ${n.hidden}. `)}
    {tr('LIVE: z ceny, świec i VWAP; MODEL: skaner i dziennik prognoz. Opis, nie rekomendacja.', 'LIVE: from price, candles and VWAP; MODEL: scanner and forecast ledger. A description, not a recommendation.')}
  </p>
);
