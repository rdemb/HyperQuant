import React from 'react';
import { ExternalLink } from 'lucide-react';
import { DASH, EmptyState, Panel, Sparkline, Stat, fmtPct, fmtSigned } from '../../ui';
import { freshnessBadge, partAsOf, useNow, usePublicFeed } from '../../utils/publicFeeds';

const LINKS = {
  treasury: { name: 'U.S. Treasury', url: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve' },
  fiscal: { name: 'FiscalData (DTS)', url: 'https://fiscaldata.treasury.gov/datasets/daily-treasury-statement/' },
  nyfed: { name: 'NY Fed', url: 'https://www.newyorkfed.org/markets/desk-operations/reverse-repo' },
  cftc: { name: 'CFTC (TFF)', url: 'https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm' },
  fng: { name: 'alternative.me', url: 'https://alternative.me/crypto/fear-and-greed-index/' },
  mempool: { name: 'mempool.space', url: 'https://mempool.space' },
  gdelt: { name: 'GDELT Project', url: 'https://www.gdeltproject.org/' },
} as const;

const FNG_PL: Record<string, string> = {
  'Extreme Fear': 'skrajny strach',
  Fear: 'strach',
  Neutral: 'neutralnie',
  Greed: 'chciwość',
  'Extreme Greed': 'skrajna chciwość',
};

const lastOf = <T,>(a: T[]): T | null => (a.length ? a[a.length - 1] : null);
const prevOf = <T,>(a: T[]): T | null => (a.length >= 2 ? a[a.length - 2] : null);
const fmtDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const signedInt = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('pl-PL')}`;
const bn = (v: number) => `$${v < 10 ? v.toFixed(2) : v.toLocaleString('pl-PL', { maximumFractionDigits: 0 })} mld`;
const range = (vals: number[], f: (v: number) => string) => (vals.length ? `Zakres: ${f(Math.min(...vals))} – ${f(Math.max(...vals))}` : undefined);

interface TileProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  trend?: number[];
  trendLabel?: string;
  trendTitle?: string;
  asOf: string | null;
  now: number;
  link: { name: string; url: string };
  wide?: boolean;
}

/** Komórka siatki: Stat + świeżość (LIVE/STALE/BRAK) + link do źródła. */
const Tile: React.FC<TileProps> = ({ label, value, hint, trend, trendLabel, trendTitle, asOf, now, link, wide }) => (
  <div className={`bg-surface-1 p-3.5 flex flex-col gap-1.5 min-w-0 ${wide ? 'min-[420px]:col-span-2' : ''}`}>
    <Stat
      label={label}
      value={value}
      hint={hint}
      source={freshnessBadge(asOf, now)}
      trend={
        trend && trend.length >= 2 ? (
          <span title={trendTitle}>
            <Sparkline values={trend} width={72} height={26} ariaLabel={trendLabel ?? label} />
          </span>
        ) : undefined
      }
    />
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="self-start inline-flex items-center gap-1 rounded text-[11px] text-ink-3 hover:text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      Źródło: {link.name}
      <ExternalLink size={11} aria-hidden="true" />
    </a>
  </div>
);

/** Kafle makro i sentymentu z potoku danych publicznych (bez kluczy API). Brak danych = „—”, nigdy liczba zastępcza. */
export const MacroTiles: React.FC = () => {
  const now = useNow(60000);
  const macro = usePublicFeed('macro');
  const cot = usePublicFeed('cot');
  const sentiment = usePublicFeed('sentiment');
  const onchain = usePublicFeed('onchain');
  const all = [macro, cot, sentiment, onchain];

  const header = { title: 'Makro i sentyment', eyebrow: 'Dane publiczne · bez kluczy API' };
  if (all.every((f) => f.status === 'loading')) {
    return (
      <Panel {...header}>
        <EmptyState title="Wczytuję dane publiczne…" />
      </Panel>
    );
  }
  if (all.every((f) => !f.feed)) {
    return (
      <Panel {...header}>
        <EmptyState
          title="Brak danych publicznych"
          detail={
            <>
              Uruchom <code className="font-mono text-ink-2">npm run data</code> lokalnie albo poczekaj na wdrożenie (GitHub
              Actions odświeża pliki co ~30 min).
            </>
          }
        />
      </Panel>
    );
  }

  // Rentowności UST
  const ust = macro.feed?.data.ust ?? [];
  const ust2 = ust.filter((p) => p.y2 !== null) as { date: string; y2: number }[];
  const ust10 = ust.filter((p) => p.y10 !== null) as { date: string; y10: number }[];
  const spread = ust.filter((p) => p.y2 !== null && p.y10 !== null).map((p) => ({ date: p.date, bp: ((p.y10 as number) - (p.y2 as number)) * 100 }));
  const ustAsOf = partAsOf(macro.feed, 'ust');
  const yieldTile = (label: string, pts: { date: string; v: number }[]) => {
    const l = lastOf(pts);
    const p = prevOf(pts);
    const vals = pts.map((x) => x.v);
    return (
      <Tile
        label={label}
        value={l ? `${l.v.toFixed(2)}%` : DASH}
        hint={l ? `${p ? `${fmtSigned((l.v - p.v) * 100, 0, ' bp')} d/d · ` : ''}sesja ${fmtDay(l.date)}` : undefined}
        trend={vals}
        trendLabel={`${label}, ostatnie ${vals.length} sesji`}
        trendTitle={range(vals, (v) => `${v.toFixed(2)}%`)}
        asOf={ustAsOf}
        now={now}
        link={LINKS.treasury}
      />
    );
  };
  const sLast = lastOf(spread);

  // Płynność: TGA i RRP ($ mld)
  const tga = macro.feed?.data.tga ?? [];
  const rrp = macro.feed?.data.rrp ?? [];
  const tL = lastOf(tga);
  const tP = prevOf(tga);
  const rL = lastOf(rrp);
  const rP = prevOf(rrp);

  // CFTC TFF — Bitcoin CME
  const cotRows = cot.feed?.data.btc ?? [];
  const cL = lastOf(cotRows);

  // Sentyment
  const fng = sentiment.feed?.data.fng ?? [];
  const fL = lastOf(fng);
  const fP = prevOf(fng);
  const tone = sentiment.feed?.data.gdeltTone ?? [];
  const tone24 = tone.slice(-24);
  const toneAvg = tone24.length ? tone24.reduce((s, p) => s + p.tone, 0) / tone24.length : null;

  // mempool.space
  const fees = onchain.feed?.data.fees ?? null;
  const diff = onchain.feed?.data.difficulty ?? null;
  const hr = lastOf(onchain.feed?.data.hashrate ?? []);

  return (
    <Panel {...header}>
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-px bg-line rounded-b-[11px] overflow-hidden">
        {yieldTile('UST 2Y', ust2.map((x) => ({ date: x.date, v: x.y2 })))}
        {yieldTile('UST 10Y', ust10.map((x) => ({ date: x.date, v: x.y10 })))}
        <Tile
          label="Spread 10Y−2Y"
          value={sLast ? fmtSigned(sLast.bp, 0, ' bp') : DASH}
          hint={sLast ? `${sLast.bp < 0 ? 'krzywa odwrócona' : 'krzywa dodatnia'} · ${fmtDay(sLast.date)}` : undefined}
          trend={spread.map((x) => x.bp)}
          trendLabel={`Spread 10Y−2Y, ostatnie ${spread.length} sesji`}
          trendTitle={range(spread.map((x) => x.bp), (v) => fmtSigned(v, 0, ' bp'))}
          asOf={ustAsOf}
          now={now}
          link={LINKS.treasury}
        />
        <Tile
          label="TGA (Skarb USA)"
          value={tL ? bn(tL.value) : DASH}
          hint={tL ? `${tP ? `${fmtSigned(tL.value - tP.value, 1, ' mld')} d/d · ` : ''}${fmtDay(tL.date)}` : undefined}
          trend={tga.map((x) => x.value)}
          trendLabel={`Saldo TGA, ostatnie ${tga.length} dni`}
          trendTitle={range(tga.map((x) => x.value), bn)}
          asOf={partAsOf(macro.feed, 'tga')}
          now={now}
          link={LINKS.fiscal}
        />
        <Tile
          label="Reverse repo (RRP)"
          value={rL ? bn(rL.value) : DASH}
          hint={rL ? `${rP ? `${fmtSigned(rL.value - rP.value, 2, ' mld')} d/d · ` : ''}${fmtDay(rL.date)}` : undefined}
          trend={rrp.map((x) => x.value)}
          trendLabel={`RRP, ostatnie ${rrp.length} operacji`}
          trendTitle={range(rrp.map((x) => x.value), bn)}
          asOf={partAsOf(macro.feed, 'rrp')}
          now={now}
          link={LINKS.nyfed}
        />
        <Tile
          label="CFTC · lev. funds netto"
          value={
            cL ? (
              <span title="Kontrakty CME po 5 BTC">
                {signedInt(cL.levNet)} <span className="text-sm font-medium text-ink-3">kontr.</span>
              </span>
            ) : (
              DASH
            )
          }
          hint={
            cL ? (
              <>
                CME BTC · asset managers {signedInt(cL.assetMgrNet)} · dealerzy {signedInt(cL.dealerNet)} · OI {cL.oi.toLocaleString('pl-PL')}
                <br />
                Raport z {fmtDay(cL.date)} (dane wtorkowe, publikacja pt 15:30 ET)
              </>
            ) : undefined
          }
          trend={cotRows.map((x) => x.levNet)}
          trendLabel={`Pozycja netto leveraged funds, ostatnie ${cotRows.length} tygodni`}
          trendTitle={range(cotRows.map((x) => x.levNet), signedInt)}
          asOf={partAsOf(cot.feed, 'btc')}
          now={now}
          link={LINKS.cftc}
        />
        <Tile
          label="Fear & Greed (krypto)"
          value={fL ? `${fL.value} · ${FNG_PL[fL.classification] ?? fL.classification}` : DASH}
          hint={fL ? `${fP ? `${fmtSigned(fL.value - fP.value, 0)} d/d · ` : ''}skala 0–100` : undefined}
          trend={fng.map((x) => x.value)}
          trendLabel={`Fear & Greed, ostatnie ${fng.length} dni`}
          trendTitle={range(fng.map((x) => x.value), (v) => v.toFixed(0))}
          asOf={partAsOf(sentiment.feed, 'fng')}
          now={now}
          link={LINKS.fng}
        />
        <Tile
          label="Opłata mempool (priorytet)"
          value={fees?.fastestFee !== null && fees?.fastestFee !== undefined ? `${fees.fastestFee} sat/vB` : DASH}
          hint={
            fees ? (
              <>
                ½ h {fees.halfHourFee ?? DASH} · 1 h {fees.hourFee ?? DASH} sat/vB
                {diff?.difficultyChange !== null && diff?.difficultyChange !== undefined && (
                  <>
                    <br />
                    Korekta trudności {fmtPct(diff.difficultyChange, 1)}
                    {diff.remainingBlocks !== null ? ` za ${diff.remainingBlocks} bl.` : ''}
                    {hr ? ` · hashrate ${(hr.hashrate / 1e18).toFixed(0)} EH/s` : ''}
                  </>
                )}
              </>
            ) : undefined
          }
          asOf={partAsOf(onchain.feed, 'fees')}
          now={now}
          link={LINKS.mempool}
        />
        {tone.length > 0 && (
          <Tile
            wide
            label="Ton mediów o BTC (GDELT, 24 h)"
            value={toneAvg !== null ? fmtSigned(toneAvg, 2) : DASH}
            hint="Średni ton artykułów anglojęzycznych (skala ok. −10…+10); wykres: 7 dni, średnie godzinowe"
            trend={tone.map((x) => x.tone)}
            trendLabel="Ton mediów GDELT, 7 dni"
            trendTitle={range(tone.map((x) => x.tone), (v) => fmtSigned(v, 2))}
            asOf={partAsOf(sentiment.feed, 'gdeltTone')}
            now={now}
            link={LINKS.gdelt}
          />
        )}
      </div>
    </Panel>
  );
};
export default MacroTiles;
