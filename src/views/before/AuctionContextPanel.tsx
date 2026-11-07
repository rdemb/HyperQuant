import React from 'react';
import { useDesk } from '../../state/DeskContext';
import { useAuctionContext, type AuctionContext } from '../../state/useAuctionContext';
import { Badge, EmptyState, Panel, DASH, fmtPrice, fmtFixed } from '../../ui';
import type { OpenLoc, Rate } from '../../utils/auction';
import { locale, tr } from '../../i18n';

const dayFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
/** Minimalna liczba sesji dla częstości — mniej to szum */
const MIN_N = 30;
/** Dane starsze niż 3 min (odświeżanie co minutę) = nieaktualne */
export const STALE_MS = 3 * 60_000;

const pct = (p: number) => `${Math.round(p * 100)}%`;
/** „62% (55–69%) · n 180” albo „—” przy zbyt małej próbie */
function RateText({ r }: { r: Rate }) {
  if (!r.ci || r.n < MIN_N) return <span className="text-ink-3">{DASH} <span className="text-[10px]">n {r.n}</span></span>;
  return (
    <span className="font-mono tabular-nums">
      <span className="text-ink-1">{pct(r.ci.p)}</span>{' '}
      <span className="text-ink-3 text-[10px]">
        ({pct(r.ci.lo)}–{pct(r.ci.hi)}) · n {r.n}
      </span>
    </span>
  );
}

const LOC_LABEL: Record<OpenLoc, string> = { above: tr('nad VA', 'above VA'), inside: tr('w VA', 'inside VA'), below: tr('pod VA', 'below VA') };

/** Kontekst aukcji sesji UTC: poziomy (VWAP ±σ, IB, profil wczoraj) i częstości historyczne z przedziałami Wilsona. */
export const AuctionContextPanel: React.FC = () => {
  const ctx = useAuctionContext();
  const { feed } = useDesk();
  const price = Number.isFinite(feed.currentPrice) && feed.currentPrice > 0 ? feed.currentPrice : null;
  // Zegar dla oznaczenia nieaktualnych danych (gdy pobieranie świec zawodzi, stan się nie zmienia)
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const stale = ctx.asOf !== null && now - ctx.asOf > STALE_MS;
  return (
    <Panel
      eyebrow={tr('Sesja UTC · świece 1m i 1h Hyperliquid · historycznie, nie prognoza', 'UTC session · Hyperliquid 1m and 1h candles · historical, not a forecast')}
      title={tr('Kontekst aukcji', 'Auction context')}
      actions={
        ctx.status === 'ready' ? (
          stale ? (
            <Badge tone="stale" title={tr('Świece nie odświeżyły się od ponad 3 min — poziomy mogą być nieaktualne', 'Candles have not refreshed for over 3 min, levels may be out of date')}>
              STALE
            </Badge>
          ) : (
            <Badge tone="live" title={tr('Poziomy z publicznych świec Hyperliquid; częstości z ~200 pełnych sesji UTC', 'Levels from public Hyperliquid candles; frequencies from ~200 full UTC sessions')}>
              LIVE
            </Badge>
          )
        ) : null
      }
    >
      {ctx.status !== 'ready' ? (
        <EmptyState
          title={ctx.status === 'loading' ? tr('Pobieram świece sesji…', 'Loading session candles…') : tr('Świece chwilowo niedostępne', 'Candles temporarily unavailable')}
          detail={tr(
            'VWAP sesji, Initial Balance, profil poprzedniego dnia i to, jak często na BTC faktycznie działają klasyczne reguły aukcji.',
            "Session VWAP, Initial Balance, the previous day's profile and how often the classic auction rules actually work on BTC."
          )}
        />
      ) : (
        <Body ctx={ctx} price={price} />
      )}
    </Panel>
  );
};

interface Level {
  label: string;
  px: number;
  tone: 'vwap' | 'band' | 'ib' | 'prev' | 'price';
  note?: string;
}

function levels(ctx: AuctionContext, price: number | null): Level[] {
  const out: Level[] = [];
  if (ctx.vwap) {
    const { vwap, sd } = ctx.vwap;
    out.push({ label: tr('VWAP sesji', 'Session VWAP'), px: vwap, tone: 'vwap' });
    if (sd > 0) {
      out.push({ label: 'VWAP +1σ', px: vwap + sd, tone: 'band' }, { label: 'VWAP −1σ', px: vwap - sd, tone: 'band' });
      out.push({ label: 'VWAP +2σ', px: vwap + 2 * sd, tone: 'band' }, { label: 'VWAP −2σ', px: vwap - 2 * sd, tone: 'band' });
    }
  }
  if (ctx.ib) {
    const r = ctx.ib.hi - ctx.ib.lo;
    out.push(
      { label: ctx.ib.done ? 'IB high' : tr('IB high (w trakcie)', 'IB high (forming)'), px: ctx.ib.hi, tone: 'ib' },
      { label: ctx.ib.done ? 'IB low' : tr('IB low (w trakcie)', 'IB low (forming)'), px: ctx.ib.lo, tone: 'ib' }
    );
    if (ctx.ib.done && r > 0) {
      out.push({ label: tr('IB +1,5×', 'IB +1.5×'), px: ctx.ib.lo + 1.5 * r, tone: 'ib' }, { label: tr('IB −1,5×', 'IB −1.5×'), px: ctx.ib.hi - 1.5 * r, tone: 'ib' });
      out.push({ label: 'IB +2×', px: ctx.ib.lo + 2 * r, tone: 'ib' }, { label: 'IB −2×', px: ctx.ib.hi - 2 * r, tone: 'ib' });
    }
  }
  if (ctx.prev) {
    const p = ctx.prev;
    // Słabość wg tej samej definicji co statystyka (świece 1h), żeby drabina i tabela się nie przeczyły
    const h1 = ctx.today?.prev1h;
    out.push({ label: 'PDH', px: p.high, tone: 'prev', note: h1?.poorHigh ? tr('słaby szczyt', 'poor high') : undefined });
    out.push({ label: 'PDL', px: p.low, tone: 'prev', note: h1?.poorLow ? tr('słabe dno', 'poor low') : undefined });
    out.push(
      { label: tr('VAH wczoraj', 'Yesterday VAH'), px: p.vah, tone: 'prev' },
      { label: tr('POC wczoraj', 'Yesterday POC'), px: p.poc, tone: 'prev' },
      { label: tr('VAL wczoraj', 'Yesterday VAL'), px: p.val, tone: 'prev' }
    );
  }
  if (price !== null) out.push({ label: tr('Cena', 'Price'), px: price, tone: 'price' });
  return out.sort((a, b) => b.px - a.px);
}

const TONE: Record<Level['tone'], string> = {
  vwap: 'text-accent',
  band: 'text-ink-2',
  ib: 'text-level',
  prev: 'text-ink-1',
  price: 'text-ink-1 font-semibold',
};

const Body: React.FC<{ ctx: AuctionContext; price: number | null }> = ({ ctx, price }) => {
  const lv = levels(ctx, price);
  const z = ctx.vwap && ctx.vwap.sd > 0 && price !== null ? (price - ctx.vwap.vwap) / ctx.vwap.sd : null;
  const t = ctx.today;
  const st = ctx.stats;
  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section aria-label={tr('Poziomy sesji', 'Session levels')}>
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium mb-2">{tr('Poziomy', 'Levels')}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2 mb-2">
            <span>
              {tr('cena vs VWAP', 'price vs VWAP')}: <span className="font-mono tabular-nums text-ink-1">{z === null ? DASH : `${z >= 0 ? '+' : '−'}${fmtFixed(Math.abs(z), 1)}σ`}</span>
            </span>
            {t && (
              <span
                title={tr(
                  'Położenie otwarcia liczone tą samą metodą co częstości (profil wczorajszej sesji ze świec 1h)',
                  "Open location computed with the same method as the frequencies (yesterday's session profile from 1h candles)"
                )}
              >
                {tr('otwarcie', 'open')}: <span className="text-ink-1">{LOC_LABEL[t.openLoc]}</span> {tr('wczoraj', 'of yesterday')}{' '}
                <span className="text-ink-3">
                  ({tr('VA z 1h', 'VA from 1h')}: {fmtPrice(t.prev1h.val, 0)}–{fmtPrice(t.prev1h.vah, 0)})
                </span>
              </span>
            )}
          </div>
          <ol className="flex flex-col text-xs">
            {lv.map((l) => (
              <li
                key={l.label}
                className={`flex items-baseline justify-between gap-3 border-t border-line py-1 ${l.tone === 'price' ? 'bg-surface-2/70 -mx-1 px-1 rounded' : ''}`}
              >
                <span className={TONE[l.tone]}>
                  {l.label}
                  {l.note && <span className="ml-1.5 text-[10px] text-warn">{l.note}</span>}
                </span>
                <span className="font-mono tabular-nums text-ink-1">
                  {fmtPrice(l.px, 0)}
                  {price !== null && l.tone !== 'price' && (
                    <span className="ml-2 text-[10px] text-ink-3">{`${l.px >= price ? '+' : '−'}${fmtFixed(Math.abs(((l.px - price) / price) * 100), 2)}%`}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-label={tr('Częstości historyczne', 'Historical frequencies')}>
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium mb-2">
            {tr('Co mówi historia', 'What history says')}
            {st?.from && st.to ? ` · ${st.n} ${tr('sesji', 'sessions')}, ${dayFmt.format(st.from)} – ${dayFmt.format(st.to)}` : ''}
          </div>
          {!st || st.n < MIN_N ? (
            <div className="text-xs text-ink-3">{tr(`Za mało pełnych sesji w danych 1h (potrzeba ${MIN_N}).`, `Not enough full sessions in the 1h data (need ${MIN_N}).`)}</div>
          ) : (
            <table className="w-full text-left text-xs">
              <caption className="sr-only">{tr('Częstości historyczne reguł aukcji z przedziałami ufności Wilsona 95%', 'Historical frequencies of auction rules with 95% Wilson confidence intervals')}</caption>
              <thead className="text-ink-3 text-[10px] uppercase tracking-wide">
                <tr>
                  <th className="py-1 pr-2 font-medium">{tr('Reguła', 'Rule')}</th>
                  <th className="py-1 pr-2 font-medium">{tr('Częstość (95%)', 'Frequency (95%)')}</th>
                  <th className="py-1 font-medium">{tr('Dziś', 'Today')}</th>
                </tr>
              </thead>
              <tbody>
                <Row label={tr('IB wybity w górę', 'IB broken up')} rate={st.ib.up} today={t ? (t.ibBreak.up ? YES : t.ibDone ? NOT_YET : IB_FORMING) : undefined} />
                <Row label={tr('IB wybity w dół', 'IB broken down')} rate={st.ib.down} today={t ? (t.ibBreak.down ? YES : t.ibDone ? NOT_YET : IB_FORMING) : undefined} />
                <Row label={tr('IB wybity w obie strony', 'IB broken both ways')} rate={st.ib.both} />
                <Row
                  label={tr('Reguła 80%: otwarcie nad VA → powrót do VA → dojście do VAL', '80% rule: open above VA → back into VA → reaches VAL')}
                  rate={st.rule80.above}
                  today={t?.openLoc === 'above' ? RULE80[t.rule80] : undefined}
                  highlight={t?.openLoc === 'above'}
                />
                <Row
                  label={tr('Reguła 80%: otwarcie pod VA → powrót do VA → dojście do VAH', '80% rule: open below VA → back into VA → reaches VAH')}
                  rate={st.rule80.below}
                  today={t?.openLoc === 'below' ? RULE80[t.rule80] : undefined}
                  highlight={t?.openLoc === 'below'}
                />
                <Row
                  label={tr('Słaby szczyt wczoraj → przebity dziś', 'Poor high yesterday → taken out today')}
                  rate={st.poor.high.poor}
                  today={t?.prev1h.poorHigh ? (t.pdhBroken ? tr('przebity', 'taken out') : tr('wczoraj słaby', 'poor yesterday')) : undefined}
                  highlight={t?.prev1h.poorHigh}
                />
                <Row label={tr('Mocny szczyt wczoraj → przebity dziś', 'Strong high yesterday → taken out today')} rate={st.poor.high.strong} highlight={t ? !t.prev1h.poorHigh : false} />
                <Row
                  label={tr('Słabe dno wczoraj → przebite dziś', 'Poor low yesterday → taken out today')}
                  rate={st.poor.low.poor}
                  today={t?.prev1h.poorLow ? (t.pdlBroken ? tr('przebite', 'taken out') : tr('wczoraj słabe', 'poor yesterday')) : undefined}
                  highlight={t?.prev1h.poorLow}
                />
                <Row label={tr('Mocne dno wczoraj → przebite dziś', 'Strong low yesterday → taken out today')} rate={st.poor.low.strong} highlight={t ? !t.prev1h.poorLow : false} />
                {(['above', 'inside', 'below'] as OpenLoc[]).map((loc) => (
                  <React.Fragment key={loc}>
                    <Row
                      label={`${tr('Otwarcie', 'Open')} ${LOC_LABEL[loc]} → ${tr('dotknięcie PDH', 'PDH touch')}`}
                      rate={st.pdTouch[loc].pdh}
                      today={t?.openLoc === loc ? (t.pdhTouched ? YES : NOT_YET) : undefined}
                      highlight={t?.openLoc === loc}
                    />
                    <Row
                      label={`${tr('Otwarcie', 'Open')} ${LOC_LABEL[loc]} → ${tr('dotknięcie PDL', 'PDL touch')}`}
                      rate={st.pdTouch[loc].pdl}
                      today={t?.openLoc === loc ? (t.pdlTouched ? YES : NOT_YET) : undefined}
                      highlight={t?.openLoc === loc}
                    />
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
          {st &&
            (['high', 'low'] as const).map((side) => {
              const p = st.poor[side];
              if (!p.diff || p.poor.n < MIN_N || p.strong.n < MIN_N) return null;
              return (
                <p key={side} className="mt-2 text-[11px] text-ink-2">
                  {side === 'high' ? tr('Słaby − mocny szczyt', 'Poor − strong high') : tr('Słabe − mocne dno', 'Poor − strong low')} ({tr('przebicie', 'taken out')}):{' '}
                  <span className="font-mono tabular-nums">{signedPp(p.diff.d)}</span>{' '}
                  <span className="text-ink-3">
                    (95%: {signedPp(p.diff.lo)} … {signedPp(p.diff.hi)})
                  </span>
                  {p.diff.lo > 0
                    ? tr(' — słabe przebijane istotnie częściej.', ': poor extremes are taken out significantly more often.')
                    : p.diff.hi < 0
                    ? tr(' — słabe przebijane istotnie rzadziej.', ': poor extremes are taken out significantly less often.')
                    : tr(' — przedział obejmuje zero: różnica nieudowodniona.', ': the interval includes zero, the difference is not proven.')}
                </p>
              );
            })}
        </section>
      </div>
      <details className="text-[11px] text-ink-2 leading-relaxed">
        <summary className="cursor-pointer select-none text-ink-1 font-medium py-1">{tr('Metoda i zastrzeżenia', 'Method and caveats')}</summary>
        <p className="mt-1">
          {tr(
            'Sesja = dzień UTC (otwarcie 00:00 UTC). VWAP z ceny typowej (H+L+C)/3 świec 1m ważonej wolumenem, pasma ±σ z ważonego odchylenia — cena typowa przybliża ceny transakcji. Initial Balance = zakres 00:00–01:00 UTC. Profil poprzedniego dnia: wolumen świecy 1m rozłożony równomiernie w jej zakresie, koszyki 10 USD, value area 70% od POC. Słaby szczyt/dno: ekstremum osiągnięte w co najmniej dwóch różnych godzinach (w odległości ≤ 0,02%) — płaskie zakończenie aukcji bez ekscesu, jak dwa TPO na skrajnym poziomie (wierzchołek na granicy godzin też liczy się podwójnie, tak jak w Market Profile).',
            "Session = UTC day (open 00:00 UTC). VWAP from the volume-weighted typical price (H+L+C)/3 of 1m candles, ±σ bands from the weighted deviation; the typical price approximates trade prices. Initial Balance = the 00:00–01:00 UTC range. Previous day's profile: each 1m candle's volume spread evenly across its range, 10 USD buckets, 70% value area from the POC. Poor high/low: an extreme reached in at least two different hours (within ≤ 0.02%), a flat end of the auction with no excess, like two TPOs at the extreme level (a top on an hour boundary also counts twice, as in Market Profile)."
          )}
        </p>
        <p className="mt-1">
          {tr(
            `Częstości liczone są ze świec 1h z ostatnich ~208 dni (tyle udostępnia API). Profil i słabość ekstremów są tam przybliżone (godziny zamiast okien 30 min), a „Dziś” klasyfikuje bieżącą sesję tą samą metodą co historia. Reguła 80%: dwie kolejne zamknięte godziny z zamknięciem w VA, dojście liczone od kolejnej godziny (bez podglądania). Przedziały Wilsona 95%; różnica proporcji z przedziałem Newcombe'a. Mniej niż ${MIN_N} sesji = „—”. To opis przeszłości, nie prognoza ani sygnał.`,
            `Frequencies are computed from 1h candles over the last ~208 days (as much as the API provides). Profile and extreme weakness are approximate there (hours instead of 30-min periods), and "Today" classifies the current session with the same method as history. 80% rule: two consecutive closed hours closing inside the VA, the target counted from the next hour (no look-ahead). 95% Wilson intervals; difference of proportions with Newcombe's interval. Fewer than ${MIN_N} sessions = "—". This describes the past; it is not a forecast or a signal.`
          )}
        </p>
      </details>
    </div>
  );
};

const RULE80: Record<'n/a' | 'armed' | 'triggered' | 'done', string> = {
  'n/a': '—',
  armed: tr('czeka na powrót', 'waiting for re-entry'),
  triggered: tr('powrót potwierdzony', 're-entry confirmed'),
  done: tr('dotarła', 'reached'),
};

const YES = tr('tak', 'yes');
const NOT_YET = tr('jeszcze nie', 'not yet');
const IB_FORMING = tr('IB w trakcie', 'IB forming');

const signedPp = (d: number) => `${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d * 100))} pp`;

const Row: React.FC<{ label: string; rate: Rate; today?: string; highlight?: boolean }> = ({ label, rate, today, highlight }) => (
  <tr className={`border-t border-line align-baseline ${highlight ? 'bg-accent/5' : ''}`}>
    <td className="py-1 pr-2 text-ink-2">{label}</td>
    <td className="py-1 pr-2 whitespace-nowrap">
      <RateText r={rate} />
    </td>
    <td className="py-1 text-ink-1 whitespace-nowrap">{today ?? ''}</td>
  </tr>
);
