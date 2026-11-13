import React, { useMemo, useState } from 'react';
import { marketGroups } from '../charts/pro/chart/marketMenu';
import { fmtHms } from '../charts/pro/core/time';
import { tr } from '../i18n';
import { useMarkets } from '../state/markets';
import { useMarketsTable } from '../state/useMarketsTable';
import { Badge, DASH, Panel, Segmented, fmtCompact, fmtPct } from '../ui';
import { noScannerWhy } from '../utils/marketCaps';
import {
  HL_WEIGHT_LIMIT_PER_MIN,
  MARKETS_REFRESH_MS,
  type MarketRow,
  type SortKey,
  dexLabel,
  fmtMarketPrice,
  fundingHourPct,
  fundingYearPct,
  marketRows,
  rowWhyText,
  sortRows,
} from '../utils/marketsTable';

/**
 * Widok „Rynki” (`#markets`): tabela rynków z rejestru w grupach jak wybór rynku wykresu (krypto oraz rynki HIP-3),
 * domyślnie według otwartych pozycji. Liczby LIVE z odpowiedzi Hyperliquid pobranej w przeglądarce, z godziną odczytu;
 * odczyt starszy niż 3 min albo rynek bez odpowiedzi giełdy — „—” z powodem. Opis rynku, bez oceny ruchu ceny.
 */

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'oi', label: tr('Otwarte pozycje', 'Open interest') },
  { value: 'volume', label: tr('Obrót 24 h', '24h volume') },
];

const TH = 'px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3 whitespace-nowrap';
const TD = 'px-3 py-2.5 align-top whitespace-nowrap';
const NUM = `${TD} text-right font-mono tabular-nums text-ink-1`;
const LINK = 'underline decoration-line-strong underline-offset-2 hover:text-ink-1';

const Row: React.FC<{ r: MarketRow; scannerWhy: string }> = ({ r, scannerWhy }) => {
  const c = r.ctx;
  const dash = <span className="text-ink-3">{DASH}</span>;
  return (
    <tr className="border-t border-line" data-market-row={r.market.coin}>
      <th scope="row" className={`${TD} text-left font-normal sticky left-0 bg-surface-1 z-10`}>
        <span className="flex items-baseline gap-1.5">
          <span className="font-medium text-ink-1">{r.name}</span>
          <span className="rounded border border-line px-1 text-[10px] text-ink-3" title={dexLabel(r.market.dex)}>
            {r.market.dex === '' ? 'Hyperliquid' : r.market.dex}
          </span>
        </span>
      </th>
      <td className={NUM}>
        {c ? fmtMarketPrice(c.markPx, r.market.szDecimals) : dash}
        <span className="block text-[10.5px] font-sans text-ink-3">
          {r.why === null && r.at !== null ? (
            <span title={tr('Godzina odczytu (czas lokalny)', 'Reading time (local time)')}>LIVE · {fmtHms(r.at)}</span>
          ) : (
            rowWhyText(r.why ?? 'waiting', r.market.dex)
          )}
        </span>
      </td>
      <td className={NUM}>{c ? fmtCompact(c.dayNtlVlm, '$') : dash}</td>
      <td className={NUM}>{c ? fmtCompact(r.oiUsd, '$') : dash}</td>
      <td className={NUM}>
        {c ? fmtPct(fundingHourPct(c.funding), 4) : dash}
        {c && c.funding !== null && (
          <span className="block text-[10.5px] font-sans text-ink-3">
            {tr('rocznie', 'per year')} {fmtPct(fundingYearPct(c.funding), 1)} {tr('(przeliczone)', '(annualised)')}
          </span>
        )}
      </td>
      <td className={TD}>
        <a href={`#charts?m=${r.market.coin}`} className={LINK}>
          {tr('Wykres', 'Chart')}
        </a>
      </td>
      <td className={`${TD} text-ink-2`}>{r.market.scanner === 'full' ? tr('mapa likwidacji', 'liquidation map') : <span title={scannerWhy}>{DASH}</span>}</td>
    </tr>
  );
};

const MarketsView: React.FC = () => {
  const { markets, ready } = useMarkets();
  const { snap, now, meter } = useMarketsTable(markets, ready);
  const [sort, setSort] = useState<SortKey>('oi');
  const groups = useMemo(() => {
    const rows = sortRows(marketRows(markets, snap.dexes, now), sort);
    const byCoin = new Map(rows.map((r) => [r.market.coin, r]));
    return marketGroups(
      rows.map((r) => r.market),
      ''
    ).map((g) => ({ ...g, rows: g.markets.map((m) => byCoin.get(m.coin)!) }));
  }, [markets, snap, now, sort]);
  const weight = meter.lastMinute(now);

  return (
    <div className="flex flex-col gap-4" data-markets-view>
      <Panel
        hero
        eyebrow={tr('Rejestr rynków HyperQuant', 'HyperQuant market registry')}
        title={tr('Rynki', 'Markets')}
        actions={<Segmented<SortKey> ariaLabel={tr('Sortowanie', 'Sort by')} size="xs" value={sort} onChange={setSort} options={SORTS} />}
      >
        <p className="px-4 pt-3 text-xs leading-relaxed text-ink-2 max-w-prose">
          {tr(
            'Rynki Hyperliquid z rejestru HyperQuant (pierwsza dwudziestka według otwartych pozycji). Liczby pobiera Twoja przeglądarka prosto z giełdy co minutę, gdy karta jest widoczna.',
            'Hyperliquid markets from the HyperQuant registry (the top twenty by open interest). Your browser fetches the numbers straight from the exchange every minute while the tab is visible.'
          )}{' '}
          <Badge tone="live" title={tr('Realne dane Hyperliquid z godziną odczytu w każdym wierszu', 'Real Hyperliquid data with the reading time in every row')}>
            LIVE
          </Badge>
        </p>
        <div className="mt-3 overflow-x-auto hq-scroll-cue [--cue-bg:var(--color-surface-1)]">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                <th scope="col" className={`${TH} sticky left-0 bg-surface-1 z-10`}>
                  {tr('Rynek', 'Market')}
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  {tr('Cena', 'Price')}
                </th>
                <th scope="col" className={`${TH} text-right`} aria-sort={sort === 'volume' ? 'descending' : undefined}>
                  {tr('Obrót 24 h', '24h volume')}
                </th>
                <th scope="col" className={`${TH} text-right`} aria-sort={sort === 'oi' ? 'descending' : undefined}>
                  {tr('Otwarte pozycje', 'Open interest')}
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  {tr('Funding 1 h', 'Funding 1h')}
                </th>
                <th scope="col" className={TH}>
                  {tr('Wykres', 'Chart')}
                </th>
                <th scope="col" className={TH}>
                  {tr('Skaner', 'Scanner')}
                </th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.id}>
                <tr>
                  <th scope="colgroup" colSpan={7} className="px-3 pt-4 pb-1.5 text-left text-xs font-semibold text-ink-2 sticky left-0 bg-surface-1">
                    {g.title}
                  </th>
                </tr>
                {g.rows.map((r) => (
                  <Row key={r.market.coin} r={r} scannerWhy={noScannerWhy(r.market.coin, markets)} />
                ))}
              </tbody>
            ))}
          </table>
        </div>
        <div className="px-4 py-3 mt-1 border-t border-line text-[11px] leading-relaxed text-ink-3 flex flex-col gap-1">
          <p>
            {tr(
              `Źródło: Hyperliquid (metaAndAssetCtxs), jedno zapytanie na giełdę co ${MARKETS_REFRESH_MS / 1000} s z Twojej przeglądarki; serwer HyperQuant nic nie pobiera. Otwarte pozycje = liczba kontraktów × cena mark. Funding roczny przeliczony ze stawki godzinowej (× 24 × 365). Odczyt starszy niż 3 min albo rynek bez odpowiedzi giełdy: „—” z powodem.`,
              `Source: Hyperliquid (metaAndAssetCtxs), one request per exchange every ${MARKETS_REFRESH_MS / 1000} s from your browser; the HyperQuant server fetches nothing. Open interest = contracts × mark price. Annual funding is annualised from the hourly rate (× 24 × 365). A reading older than 3 min or a market missing from the exchange response: “—” with the reason.`
            )}
          </p>
          <p data-markets-weight={weight}>
            {tr(
              `Waga zapytań tej strony w ostatniej minucie: ${weight} z ${HL_WEIGHT_LIMIT_PER_MIN} (limit Hyperliquid na adres IP).`,
              `Request weight of this page in the last minute: ${weight} of ${HL_WEIGHT_LIMIT_PER_MIN} (the Hyperliquid limit per IP address).`
            )}
          </p>
        </div>
      </Panel>
    </div>
  );
};

export default MarketsView;
