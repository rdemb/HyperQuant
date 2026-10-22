import React from 'react';
import { useDesk } from '../../state/DeskContext';
import { useAuctionContext, type AuctionContext } from '../../state/useAuctionContext';
import { Badge, EmptyState, Panel, DASH, fmtPrice } from '../../ui';
import type { OpenLoc, Rate } from '../../utils/auction';

const dayFmt = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', timeZone: 'UTC' });
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

const LOC_LABEL: Record<OpenLoc, string> = { above: 'nad VA', inside: 'w VA', below: 'pod VA' };

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
      eyebrow="Sesja UTC · świece 1m i 1h Hyperliquid · historycznie, nie prognoza"
      title="Kontekst aukcji"
      actions={
        ctx.status === 'ready' ? (
          stale ? (
            <Badge tone="stale" title="Świece nie odświeżyły się od ponad 3 min — poziomy mogą być nieaktualne">
              STALE
            </Badge>
          ) : (
            <Badge tone="live" title="Poziomy z publicznych świec Hyperliquid; częstości z ~200 pełnych sesji UTC">
              LIVE
            </Badge>
          )
        ) : null
      }
    >
      {ctx.status !== 'ready' ? (
        <EmptyState
          title={ctx.status === 'loading' ? 'Pobieram świece sesji…' : 'Świece chwilowo niedostępne'}
          detail="VWAP sesji, Initial Balance, profil poprzedniego dnia i to, jak często na BTC faktycznie działają klasyczne reguły aukcji."
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
    out.push({ label: 'VWAP sesji', px: vwap, tone: 'vwap' });
    if (sd > 0) {
      out.push({ label: 'VWAP +1σ', px: vwap + sd, tone: 'band' }, { label: 'VWAP −1σ', px: vwap - sd, tone: 'band' });
      out.push({ label: 'VWAP +2σ', px: vwap + 2 * sd, tone: 'band' }, { label: 'VWAP −2σ', px: vwap - 2 * sd, tone: 'band' });
    }
  }
  if (ctx.ib) {
    const r = ctx.ib.hi - ctx.ib.lo;
    out.push({ label: ctx.ib.done ? 'IB high' : 'IB high (w trakcie)', px: ctx.ib.hi, tone: 'ib' }, { label: ctx.ib.done ? 'IB low' : 'IB low (w trakcie)', px: ctx.ib.lo, tone: 'ib' });
    if (ctx.ib.done && r > 0) {
      out.push({ label: 'IB +1,5×', px: ctx.ib.lo + 1.5 * r, tone: 'ib' }, { label: 'IB −1,5×', px: ctx.ib.hi - 1.5 * r, tone: 'ib' });
      out.push({ label: 'IB +2×', px: ctx.ib.lo + 2 * r, tone: 'ib' }, { label: 'IB −2×', px: ctx.ib.hi - 2 * r, tone: 'ib' });
    }
  }
  if (ctx.prev) {
    const p = ctx.prev;
    // Słabość wg tej samej definicji co statystyka (świece 1h), żeby drabina i tabela się nie przeczyły
    const h1 = ctx.today?.prev1h;
    out.push({ label: 'PDH', px: p.high, tone: 'prev', note: h1?.poorHigh ? 'słaby szczyt' : undefined });
    out.push({ label: 'PDL', px: p.low, tone: 'prev', note: h1?.poorLow ? 'słabe dno' : undefined });
    out.push({ label: 'VAH wczoraj', px: p.vah, tone: 'prev' }, { label: 'POC wczoraj', px: p.poc, tone: 'prev' }, { label: 'VAL wczoraj', px: p.val, tone: 'prev' });
  }
  if (price !== null) out.push({ label: 'Cena', px: price, tone: 'price' });
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
        <section aria-label="Poziomy sesji">
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium mb-2">Poziomy</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2 mb-2">
            <span>
              cena vs VWAP: <span className="font-mono tabular-nums text-ink-1">{z === null ? DASH : `${z >= 0 ? '+' : '−'}${Math.abs(z).toFixed(1)}σ`}</span>
            </span>
            {t && (
              <span title="Położenie otwarcia liczone tą samą metodą co częstości (profil wczorajszej sesji ze świec 1h)">
                otwarcie: <span className="text-ink-1">{LOC_LABEL[t.openLoc]}</span> wczoraj{' '}
                <span className="text-ink-3">
                  (VA z 1h: {fmtPrice(t.prev1h.val, 0)}–{fmtPrice(t.prev1h.vah, 0)})
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
                    <span className="ml-2 text-[10px] text-ink-3">{`${l.px >= price ? '+' : '−'}${Math.abs(((l.px - price) / price) * 100).toFixed(2)}%`}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-label="Częstości historyczne">
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium mb-2">
            Co mówi historia{st?.from && st.to ? ` · ${st.n} sesji, ${dayFmt.format(st.from)} – ${dayFmt.format(st.to)}` : ''}
          </div>
          {!st || st.n < MIN_N ? (
            <div className="text-xs text-ink-3">Za mało pełnych sesji w danych 1h (potrzeba {MIN_N}).</div>
          ) : (
            <table className="w-full text-left text-xs">
              <caption className="sr-only">Częstości historyczne reguł aukcji z przedziałami ufności Wilsona 95%</caption>
              <thead className="text-ink-3 text-[10px] uppercase tracking-wide">
                <tr>
                  <th className="py-1 pr-2 font-medium">Reguła</th>
                  <th className="py-1 pr-2 font-medium">Częstość (95%)</th>
                  <th className="py-1 font-medium">Dziś</th>
                </tr>
              </thead>
              <tbody>
                <Row label="IB wybity w górę" rate={st.ib.up} today={t ? (t.ibBreak.up ? 'tak' : t.ibDone ? 'jeszcze nie' : 'IB w trakcie') : undefined} />
                <Row label="IB wybity w dół" rate={st.ib.down} today={t ? (t.ibBreak.down ? 'tak' : t.ibDone ? 'jeszcze nie' : 'IB w trakcie') : undefined} />
                <Row label="IB wybity w obie strony" rate={st.ib.both} />
                <Row
                  label="Reguła 80%: otwarcie nad VA → powrót do VA → dojście do VAL"
                  rate={st.rule80.above}
                  today={t?.openLoc === 'above' ? RULE80[t.rule80] : undefined}
                  highlight={t?.openLoc === 'above'}
                />
                <Row
                  label="Reguła 80%: otwarcie pod VA → powrót do VA → dojście do VAH"
                  rate={st.rule80.below}
                  today={t?.openLoc === 'below' ? RULE80[t.rule80] : undefined}
                  highlight={t?.openLoc === 'below'}
                />
                <Row label="Słaby szczyt wczoraj → przebity dziś" rate={st.poor.high.poor} today={t?.prev1h.poorHigh ? (t.pdhBroken ? 'przebity' : 'wczoraj słaby') : undefined} highlight={t?.prev1h.poorHigh} />
                <Row label="Mocny szczyt wczoraj → przebity dziś" rate={st.poor.high.strong} highlight={t ? !t.prev1h.poorHigh : false} />
                <Row label="Słabe dno wczoraj → przebite dziś" rate={st.poor.low.poor} today={t?.prev1h.poorLow ? (t.pdlBroken ? 'przebite' : 'wczoraj słabe') : undefined} highlight={t?.prev1h.poorLow} />
                <Row label="Mocne dno wczoraj → przebite dziś" rate={st.poor.low.strong} highlight={t ? !t.prev1h.poorLow : false} />
                {(['above', 'inside', 'below'] as OpenLoc[]).map((loc) => (
                  <React.Fragment key={loc}>
                    <Row label={`Otwarcie ${LOC_LABEL[loc]} → dotknięcie PDH`} rate={st.pdTouch[loc].pdh} today={t?.openLoc === loc ? (t.pdhTouched ? 'tak' : 'jeszcze nie') : undefined} highlight={t?.openLoc === loc} />
                    <Row label={`Otwarcie ${LOC_LABEL[loc]} → dotknięcie PDL`} rate={st.pdTouch[loc].pdl} today={t?.openLoc === loc ? (t.pdlTouched ? 'tak' : 'jeszcze nie') : undefined} highlight={t?.openLoc === loc} />
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
                  {side === 'high' ? 'Słaby − mocny szczyt' : 'Słabe − mocne dno'} (przebicie):{' '}
                  <span className="font-mono tabular-nums">{signedPp(p.diff.d)}</span>{' '}
                  <span className="text-ink-3">
                    (95%: {signedPp(p.diff.lo)} … {signedPp(p.diff.hi)})
                  </span>
                  {p.diff.lo > 0
                    ? ' — słabe przebijane istotnie częściej.'
                    : p.diff.hi < 0
                    ? ' — słabe przebijane istotnie rzadziej.'
                    : ' — przedział obejmuje zero: różnica nieudowodniona.'}
                </p>
              );
            })}
        </section>
      </div>
      <details className="text-[11px] text-ink-2 leading-relaxed">
        <summary className="cursor-pointer select-none text-ink-1 font-medium py-1">Metoda i zastrzeżenia</summary>
        <p className="mt-1">
          Sesja = dzień UTC (otwarcie 00:00 UTC). VWAP z ceny typowej (H+L+C)/3 świec 1m ważonej wolumenem, pasma ±σ z ważonego odchylenia — cena
          typowa przybliża ceny transakcji. Initial Balance = zakres 00:00–01:00 UTC. Profil poprzedniego dnia: wolumen świecy 1m rozłożony
          równomiernie w jej zakresie, koszyki 10 USD, value area 70% od POC. Słaby szczyt/dno: ekstremum osiągnięte w co najmniej dwóch różnych
          godzinach (w odległości ≤ 0,02%) — płaskie zakończenie aukcji bez ekscesu, jak dwa TPO na skrajnym poziomie (wierzchołek na granicy
          godzin też liczy się podwójnie, tak jak w Market Profile).
        </p>
        <p className="mt-1">
          Częstości liczone są ze świec 1h z ostatnich ~208 dni (tyle udostępnia API). Profil i słabość ekstremów są tam przybliżone (godziny zamiast
          okien 30 min), a „Dziś” klasyfikuje bieżącą sesję tą samą metodą co historia. Reguła 80%: dwie kolejne zamknięte godziny z zamknięciem w VA,
          dojście liczone od kolejnej godziny (bez podglądania). Przedziały Wilsona 95%; różnica proporcji z przedziałem Newcombe&apos;a. Mniej niż{' '}
          {MIN_N} sesji = „—”. To opis przeszłości, nie prognoza ani sygnał.
        </p>
      </details>
    </div>
  );
};

const RULE80: Record<'n/a' | 'armed' | 'triggered' | 'done', string> = {
  'n/a': '—',
  armed: 'czeka na powrót',
  triggered: 'powrót potwierdzony',
  done: 'dotarła',
};

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
