import React from 'react';
import { useDesk } from '../../state/DeskContext';
import { Stat, fmtCompact, fmtPct, DASH } from '../../ui';
import { FundingStrip } from '../market/FundingStrip';
import { NextEventStat } from '../market/NextEventStat';
import { useDeskLedger } from '../../state/useDeskLedger';
import { calibrate } from '../../utils/deskLedger';
import { useAuctionContext } from '../../state/useAuctionContext';
import { tr } from '../../i18n';

const CAL_TITLE = tr('Skalibrowane na rozstrzygniętej historii (dziennik desku)', 'Calibrated on resolved history (desk ledger)');

/** Pas kontekstu pod wykresem: zasięg MC, głębokość arkusza, mikrostruktura, funding, najbliższe makro. */
export const DeskRail: React.FC = () => {
  const { feed, quant, shaakuni } = useDesk();
  const mc = feed.backendTelemetry?.monteCarlo ?? null;
  // Poziom już przekroczony (cena nad PDH / pod PDL) — „100%” byłoby pozorną prognozą
  const lv = feed.realHtfLevels;
  const px = feed.currentPrice;
  const pdhCrossed = !!lv && px > 0 && lv.pdh <= px;
  const pdlCrossed = !!lv && px > 0 && lv.pdl >= px;
  const crossedNote = (
    <div className="text-[10px] text-ink-3 font-sans" title={tr('Cena jest już za poziomem — dotknięcie nie jest prognozą', 'Price is already past the level, a touch is not a forecast')}>
      {tr('za poziomem', 'past level')}
    </div>
  );
  const depthAsk = quant.bookDepthAskUsd;
  const depthBid = quant.bookDepthBidUsd;
  const depthTotal = depthAsk + depthBid;
  const bidShare = depthTotal > 0 ? depthBid / depthTotal : null;
  const mins = (v: number | null | undefined) => (typeof v === 'number' ? `~${v} min` : 'n/a');
  // Kalibracja z weryfikowalnego dziennika (izotonicznie na rozstrzygniętych prognozach tego samego silnika): tylko przy
  // ≥ 300 ocenionych parach, aktualnym podsumowaniu i tej samej metodzie (mapa z HAR+FHS nie pasuje do zapasu Mertona)
  const { status: ledgerStatus, summary } = useDeskLedger();
  const cal =
    summary && ledgerStatus !== 'expired' && mc?.method === 'fhs-har' && summary.scores.touch.pairs >= 300 ? summary.scores.touch.calibration : null;
  const calText = (p: number | undefined) => {
    const c = cal && typeof p === 'number' ? calibrate(cal, p / 100) : null;
    return c === null ? null : `${tr('skal.', 'cal.')} ${Math.round(c * 100)}%`;
  };

  // Kontekst aukcji sesji UTC (ten sam stan co panel w widoku Plan — jedno pobieranie)
  const auction = useAuctionContext();
  const auctionStale = auction.asOf !== null && Date.now() - auction.asOf > 3 * 60_000;
  const vw = auction.vwap;
  const vwapZ = vw && vw.sd > 0 && px > 0 ? (px - vw.vwap) / vw.sd : null;
  const ibText = !auction.ib
    ? DASH
    : !auction.ib.done
    ? tr('IB w trakcie (00–01 UTC)', 'IB forming (00–01 UTC)')
    : auction.today
    ? `IB ${auction.today.ibBreak.up ? tr('↑ wybity', '↑ broken') : '↑ —'} · ${auction.today.ibBreak.down ? tr('↓ wybity', '↓ broken') : '↓ —'}`
    : tr('IB zamknięty', 'IB closed');

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
      <div className="bg-surface-1 border border-line rounded-xl p-3.5 col-span-2 md:col-span-1">
        <Stat
          label={tr('Zasięg 2h · MC', '2h reach · MC')}
          source={{
            tone: 'model',
            label: 'MODEL',
            title:
              mc?.method === 'fhs-har'
                ? tr('Sezonowy log-HAR + innowacje FHS, 2000 ścieżek, krok 5 min z korektą mostu', 'Seasonal log-HAR + FHS innovations, 2000 paths, 5-min step with bridge correction')
                : tr(
                    'Zapas: Merton jump-diffusion (skoki 20% wariancji — założenie), σ z Parkinsona, 2000 ścieżek, krok 1 min',
                    'Fallback: Merton jump-diffusion (jumps 20% of variance, an assumption), Parkinson σ, 2000 paths, 1-min step'
                  ),
          }}
          value={
            <div className="grid grid-cols-3 gap-2 text-sm font-mono tabular-nums">
              <div>
                <div className="text-[10px] text-ink-3 font-sans">PDH</div>
                {pdhCrossed ? (
                  crossedNote
                ) : (
                  <>
                    <div>{mc ? `${mc.probTouchPDH2h}%` : DASH}</div>
                    <div className="text-[10px] text-ink-3">{mins(mc?.expectedMinsToPDH)}</div>
                    {calText(mc?.probTouchPDH2h) && <div className="text-[10px] text-accent" title={CAL_TITLE}>{calText(mc?.probTouchPDH2h)}</div>}
                  </>
                )}
              </div>
              <div>
                <div className="text-[10px] text-ink-3 font-sans">D-EQ</div>
                <div>{mc ? `${mc.probTouchDEQ2h}%` : DASH}</div>
                <div className="text-[10px] text-ink-3">{mins(mc?.expectedMinsToDEQ)}</div>
                {calText(mc?.probTouchDEQ2h) && <div className="text-[10px] text-accent" title={CAL_TITLE}>{calText(mc?.probTouchDEQ2h)}</div>}
              </div>
              <div>
                <div className="text-[10px] text-ink-3 font-sans">PDL</div>
                {pdlCrossed ? (
                  crossedNote
                ) : (
                  <>
                    <div>{mc ? `${mc.probTouchPDL2h}%` : DASH}</div>
                    <div className="text-[10px] text-ink-3">{mins(mc?.expectedMinsToPDL)}</div>
                    {calText(mc?.probTouchPDL2h) && <div className="text-[10px] text-accent" title={CAL_TITLE}>{calText(mc?.probTouchPDL2h)}</div>}
                  </>
                )}
              </div>
            </div>
          }
        />
      </div>

      <div className="bg-surface-1 border border-line rounded-xl p-3.5">
        <Stat
          label={tr('Głębokość L2', 'L2 depth')}
          source={{
            tone: depthTotal > 0 ? 'live' : 'stale',
            label: depthTotal > 0 ? 'LIVE' : tr('BRAK', 'NONE'),
            title: tr('Suma płynności 12 poziomów arkusza Hyperliquid', 'Total liquidity of 12 Hyperliquid book levels'),
          }}
          value={<span className="text-base">{fmtCompact(depthBid, '$')} <span className="text-ink-3">/</span> {fmtCompact(depthAsk, '$')}</span>}
          hint={
            bidShare !== null ? (
              <span className="flex items-center gap-1.5">
                <span className="relative h-1.5 w-20 rounded-full bg-sell/70 overflow-hidden" aria-hidden="true">
                  <span className="absolute inset-y-0 left-0 bg-buy" style={{ width: `${(bidShare * 100).toFixed(0)}%` }} />
                </span>
                BID {(bidShare * 100).toFixed(0)}%
              </span>
            ) : (
              tr('Czekam na arkusz', 'Waiting for the book')
            )
          }
        />
      </div>

      <div className="bg-surface-1 border border-line rounded-xl p-3.5">
        <Stat
          label="VPIN · λ"
          source={{ tone: 'model', label: 'MODEL', title: tr('VPIN na kubełkach wolumenowych; λ z OLS na realnym przepływie WS', 'VPIN on volume buckets; λ from OLS on real WS flow') }}
          value={<span className="text-base">{fmtPct(quant.vpinToxicity * 100, 1, false)}</span>}
          hint={`λ = ${quant.kyleLambdaPer1M !== null ? `$${quant.kyleLambdaPer1M.toFixed(2)} / $1M` : 'n/a'}`}
        />
      </div>

      <div className="bg-surface-1 border border-line rounded-xl p-3.5">
        <Stat
          label={tr('Powrót do D-EQ', 'Reversion to D-EQ')}
          source={{ tone: 'model', label: 'MODEL', title: tr('Regresja OU wokół 0.65·D-EQ + 0.35·W-EQ', 'OU regression around 0.65·D-EQ + 0.35·W-EQ') }}
          value={<span className="text-base">Z {quant.ouZScore > 0 ? '+' : ''}{quant.ouZScore}σ</span>}
          hint={`t½ ${Number.isFinite(quant.ouHalfLifeBars) ? `${quant.ouHalfLifeBars} ${tr('świec', 'bars')}` : tr('∞ (brak powrotu)', '∞ (no reversion)')} · ${shaakuni.nySession}`}
        />
      </div>

      <div className="bg-surface-1 border border-line rounded-xl p-3.5">
        <Stat
          label={tr('Aukcja · sesja UTC', 'Auction · UTC session')}
          source={
            auctionStale
              ? { tone: 'stale', label: 'STALE', title: tr('Świece nie odświeżyły się od ponad 3 min', 'Candles have not refreshed for over 3 min') }
              : {
                  tone: 'live',
                  label: 'LIVE',
                  title: tr(
                    'VWAP sesji UTC ze świec 1m (cena typowa ważona wolumenem) i Initial Balance 00:00–01:00 UTC; szczegóły w widoku Plan',
                    'UTC session VWAP from 1m candles (volume-weighted typical price) and Initial Balance 00:00–01:00 UTC; details in the Plan view'
                  ),
                }
          }
          value={<span className="text-base">{vwapZ === null ? DASH : `${vwapZ >= 0 ? '+' : '−'}${Math.abs(vwapZ).toFixed(1)}σ`}</span>}
          hint={`${tr('od VWAP', 'from VWAP')} · ${ibText}`}
        />
      </div>

      <FundingStrip />
      <NextEventStat />
    </div>
  );
};
