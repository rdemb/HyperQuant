import React from 'react';
import { useDeskLedger } from '../../state/useDeskLedger';
import { LedgerVerifyCard } from './LedgerVerifyCard';
import { ModelAbCard } from './ModelAbCard';
import { LEDGER_BASE } from '../../state/usePublished';
import { Badge, EmptyState, Panel, Stat, DASH, fmtPrice } from '../../ui';
import { DeskLedgerSummary, MktScores, RetScores, TouchLevel, isAb } from '../../utils/deskLedger';
import { locale, tr } from '../../i18n';

const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
/** Procent bez „−0.0%” (zero ze znakiem minus z zaokrąglenia) */
const pct = (v: number | null | undefined, d = 0) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  const s = (v * 100).toFixed(d);
  return `${Number(s) === 0 ? (0).toFixed(d) : s}%`;
};
/** Wyniki pokazujemy dopiero od 20 rozstrzygnięć — mniejsza próba to szum, nie ocena */
const MIN_N = 20;
const LEVEL_LABEL: Record<TouchLevel, string> = { pdh: 'PDH', deq: 'D-EQ', pdl: 'PDL' };
const HORIZON_LABEL: Record<number, string> = { 60: '1 h', 240: '4 h' };
const LIQUID = tr('płynne', 'liquid');
const TIGHT = tr('wąski spread', 'tight spread');
const fromN = (n: number) => tr(`od ${MIN_N} rozstrzygnięć (jest ${n})`, `from ${MIN_N} settlements (now ${n})`);

/** Adres pliku w przeglądarce GitHuba (dla repo na raw.githubusercontent.com), inaczej bezpośredni plik. */
function fileHref(rel: string): string {
  const m = LEDGER_BASE.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)$/);
  return m ? `https://github.com/${m[1]}/${m[2]}/blob/${m[3]}/BTC/${rel}` : `${LEDGER_BASE}/BTC/${rel}`;
}

/** Weryfikowalny dziennik prognoz desku: prognozy przed faktem, łańcuch hashy, kotwica w Bitcoinie, uczciwe wyniki. */
export const DeskLedgerPanel: React.FC = () => {
  const { status, summary } = useDeskLedger();
  if (status === 'unconfigured') return null;
  const badge =
    status === 'ready' ? (
      <Badge tone="live" title={tr('Prognozy zapisywane co 15 min przed faktem; rozstrzygane ze świec 1m Hyperliquid', 'Forecasts recorded every 15 min before the fact; settled from Hyperliquid 1m candles')}>
        LIVE
      </Badge>
    ) : status === 'stale' || status === 'expired' ? (
      <Badge tone="stale" title={tr('Dziennik nie był aktualizowany od ponad 35 min', 'The ledger has not been updated for over 35 min')}>
        STALE
      </Badge>
    ) : null;
  return (
    <Panel
      eyebrow={tr('Prognozy przed faktem · łańcuch hashy · kotwica w Bitcoinie', 'Forecasts before the fact · hash chain · Bitcoin anchor')}
      title={tr('Weryfikowalny dziennik desku', 'Verifiable desk ledger')}
      actions={badge}
    >
      {!summary ? (
        <EmptyState
          title={status === 'loading' ? tr('Pobieram dziennik prognoz…', 'Loading the forecast ledger…') : tr('Dziennik prognoz chwilowo niedostępny', 'Forecast ledger temporarily unavailable')}
          detail={tr(
            'Co 15 min desk zapisuje swoje prognozy, zanim rynek je rozstrzygnie. Każda linia zawiera hash poprzedniej, po każdym slocie głowa łańcucha jest znakowana w OpenTimestamps, a historia gałęzi jest tylko dopisywana.',
            'Every 15 min the desk records its forecasts before the market settles them. Each line contains the hash of the previous one, after every slot the chain head is timestamped with OpenTimestamps, and the branch history is append-only.'
          )}
        />
      ) : (
        <LedgerBody s={summary} stale={status !== 'ready'} expired={status === 'expired'} />
      )}
    </Panel>
  );
};

const LedgerBody: React.FC<{ s: DeskLedgerSummary; stale: boolean; expired: boolean }> = ({ s, stale, expired }) => (
  <div className="flex flex-col gap-5 p-4">
    <p className="text-xs text-ink-2 leading-relaxed">
      {tr(
        'Co 15 min desk zapisuje prognozy, zanim rynek je rozstrzygnie: rozkład zwrotu BTC na 1 h i 4 h (ten sam model zmienności co Analizator) oraz szanse dotknięcia PDH / D-EQ / PDL w 2 h (ten sam silnik co pas „Zasięg 2h”). Horyzont liczy się od pełnej minuty po wydaniu. Każda linia zawiera hash poprzedniej. Zaraz po wydaniu głowa łańcucha jest znakowana w OpenTimestamps (niezależne kalendarze od razu, blok Bitcoina po kilku godzinach), a historia gałęzi jest tylko dopisywana. Pominięte sloty są zapisywane jawnie. Wyniki obok liczone są z tych zapisów i każdy może je przeliczyć sam.',
        'Every 15 min the desk records forecasts before the market settles them: the distribution of the BTC return over 1 h and 4 h (the same volatility model as the Plan Analyzer) and the chances of touching PDH / D-EQ / PDL within 2 h (the same engine as the "2h reach" tile). The horizon counts from the full minute after issue. Each line contains the hash of the previous one. Right after issue the chain head is timestamped with OpenTimestamps (independent calendars at once, a Bitcoin block after a few hours), and the branch history is append-only. Skipped slots are recorded explicitly. The scores alongside are computed from these records and anyone can recompute them.'
      )}
      {stale && (
        <span className="text-warn">
          {' '}
          {tr('Ostatnia aktualizacja', 'Last update')} {(expired ? dateTimeFmt : timeFmt).format(s.asOf)}.
        </span>
      )}
    </p>

    <div className="grid gap-4 lg:grid-cols-2">
      {s.latest.ret.map((r) => (
        <RetCard key={r.h} r={r} sc={s.scores.ret[String(r.h)]} />
      ))}
    </div>

    <TouchCard s={s} />

    {s.market && <MarketCard m={s.market} />}

    {s.ab && isAb(s.ab) && <ModelAbCard ab={s.ab} />}

    <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-2/50 px-3 py-2.5 text-xs text-ink-2">
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <span>
          {tr('Głowa łańcucha', 'Chain head')} <code className="font-mono text-ink-1" title={s.head.hash}>{s.head.hash.slice(0, 16)}…</code>
        </span>
        <span>
          {tr('linie', 'lines')} <span className="font-mono text-ink-1">{s.head.lines.toLocaleString(locale)}</span>
        </span>
        <span>
          {tr('czeka na rozstrzygnięcie', 'awaiting settlement')} <span className="font-mono text-ink-1">{s.pending}</span>
        </span>
        <span
          title={tr(
            'Prognozy, których nie dało się rozstrzygnąć (brak świec 1m przez 6 h po horyzoncie) — jawnie unieważnione, nie pominięte',
            'Forecasts that could not be settled (no 1m candles for 6 h after the horizon), explicitly voided, not dropped'
          )}
        >
          {tr('unieważnione', 'voided')} <span className="font-mono text-ink-1">{s.voided}</span>
        </span>
        <span
          title={tr(
            'Sloty z prognozą vs jawnie pominięte (brak modelu, ceny albo przerwa) — braki nie znikają po cichu',
            'Slots with a forecast vs explicitly skipped (no model, no price or an outage), so gaps never vanish silently'
          )}
        >
          {tr('sloty', 'slots')} <span className="font-mono text-ink-1">{s.participation.issued}</span> {tr('wydane', 'issued')} ·{' '}
          <span className="font-mono text-ink-1">{s.participation.skipped}</span> {tr('pominięte', 'skipped')}
        </span>
        <span title={tr('Pokwitowania OpenTimestamps głowy łańcucha po wydaniu slotu, ostatnie 24 h', 'OpenTimestamps receipts of the chain head after each slot, last 24 h')}>
          {tr('pokwitowania 24 h', 'receipts 24 h')} <span className="font-mono text-ink-1">{s.slotStamps}</span>
        </span>
      </div>
      {s.participation.gaps.length > 0 && (
        <div className="text-ink-3">
          {tr('Ostatnie pominięte sloty:', 'Latest skipped slots:')}{' '}
          {s.participation.gaps
            .slice(-5)
            .map(
              (g) =>
                `${dateTimeFmt.format(g.slot)}${g.until !== undefined && g.until !== g.slot ? ` – ${dateTimeFmt.format(g.until)}` : ''} ` +
                `(${
                  g.reason === 'outage'
                    ? tr('przerwa', 'outage')
                    : g.reason === 'no-model'
                    ? tr('brak modelu', 'no model')
                    : g.reason === 'no-price'
                    ? tr('brak ceny', 'no price')
                    : g.reason
                })`
            )
            .join(' · ')}
        </div>
      )}
      {s.ots.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {tr('Kotwice w Bitcoinie:', 'Bitcoin anchors:')}
          {s.ots.map((o) => (
            <a key={o.day} href={fileHref(o.file)} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline font-mono">
              {o.day}
            </a>
          ))}
        </div>
      )}
      <LedgerVerifyCard summaryHead={s.head.hash} />
      <details>
        <summary className="cursor-pointer select-none text-ink-1 font-medium py-1">{tr('Jak to sprawdzić samodzielnie', 'How to verify it yourself')}</summary>
        <ol className="list-decimal pl-4 mt-1.5 space-y-1 leading-relaxed">
          <li>
            {tr('Pliki dzienne:', 'Daily files:')}{' '}
            <a className="text-accent hover:underline" href={fileHref('')} target="_blank" rel="noopener noreferrer">
              {tr('gałąź ledger repo danych', 'the ledger branch of the data repo')}
            </a>{' '}
            {tr('— jedna linia JSON na prognozę albo rozstrzygnięcie.', ', one JSON line per forecast or settlement.')}
          </li>
          <li>
            {tr('Pełna kontrola:', 'Full check:')} <code className="font-mono text-ink-1">git clone -b ledger …/hyperquant-data ledger</code>, {tr('potem', 'then')}{' '}
            <code className="font-mono text-ink-1">node scripts/verify-ledger.mjs --dir ledger --market --bitcoin</code> {tr('(repo HyperQuant).', '(HyperQuant repo).')}{' '}
            {tr(
              'To niezależna implementacja: sprawdza łańcuch od początku, historię git (tylko dopisywanie), kolejność zapisów, pokwitowanie każdego slotu, przelicza wyniki z kwantyli;',
              'An independent implementation: it checks the chain from the start, the git history (append-only), the record order and every slot receipt, and recomputes scores from quantiles;'
            )}{' '}
            <code className="font-mono text-ink-1">--market</code>{' '}
            {tr('porównuje zapisane ceny rozstrzygnięć ze świecami 1m Hyperliquid,', 'compares recorded settlement prices with Hyperliquid 1m candles,')}{' '}
            <code className="font-mono text-ink-1">--bitcoin</code> {tr('odczytuje czas bloku Bitcoina z pokwitowań.', 'reads the Bitcoin block time from the receipts.')}
          </li>
          <li>
            {tr('Czas:', 'Time:')} <code className="font-mono text-ink-1">ots upgrade</code>, {tr('potem', 'then')} <code className="font-mono text-ink-1">ots verify</code>{' '}
            {tr('(klient OpenTimestamps) na pokwitowaniu slotu', '(OpenTimestamps client) on a slot receipt')} (
            <code className="font-mono text-ink-1">ots/slots/&lt;{tr('dzień', 'day')}&gt;/</code>, {tr('skrót = hash ostatniej prognozy slotu', 'digest = hash of the slot\'s last forecast')}){' '}
            {tr('albo dnia', 'or a day receipt')} (<code className="font-mono text-ink-1">ots/&lt;{tr('dzień', 'day')}&gt;.jsonl.ots</code>).{' '}
            {tr(
              'Potwierdza, że zapis istniał przed blokiem Bitcoina. Blok przychodzi zwykle po 1–6 h, więc dla prognoz 1 h dowodem zapisu przed faktem są kalendarze OpenTimestamps (niezależni operatorzy, przyjęcie od razu), a blok potwierdza je później; dla 4 h blok zwykle zdąży przed rozstrzygnięciem.',
              'It confirms the record existed before the Bitcoin block. The block usually arrives after 1–6 h, so for 1 h forecasts the proof of recording before the fact is the OpenTimestamps calendars (independent operators, accepted at once), and the block confirms them later; for 4 h the block usually lands before settlement.'
            )}
          </li>
        </ol>
      </details>
    </div>
  </div>
);

/** Prognoza rozkładu zwrotu: przedziały 90/60% i ACI w cenie, wyniki z rozstrzygnięć. */
const RetCard: React.FC<{ r: DeskLedgerSummary['latest']['ret'][number]; sc: RetScores | undefined }> = ({ r, sc }) => {
  const q = (tau: number) => r.q[r.taus.indexOf(tau)];
  const price = (lr: number) => r.px0 * Math.exp(lr);
  const lo = price(q(0.025));
  const hi = price(q(0.975));
  // Przedział ACI może wychodzić poza siatkę (ogony) albo być nieskończony (α ≤ 0) — rysowany przycięty do skali
  const aciLo = r.aci.lo === null ? lo : price(r.aci.lo);
  const aciHi = r.aci.hi === null ? hi : price(r.aci.hi);
  const x = (p: number) => `${Math.min(100, Math.max(0, ((p - lo) / (hi - lo)) * 100))}%`;
  const enough = !!sc && sc.n >= MIN_N;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">
          {tr('Zwrot za', 'Return over')} {HORIZON_LABEL[r.h] ?? `${r.h} min`}
        </div>
        <span className="text-[11px] text-ink-3">
          {tr('wydano', 'issued')} {timeFmt.format(r.t)} · {tr('cena', 'price')} {fmtPrice(r.px0, 0)}
        </span>
      </div>
      <div className="relative h-9" role="img" aria-label={`${tr('Przedziały prognozy', 'Forecast intervals')}: 90% ${fmtPrice(price(q(0.05)), 0)}–${fmtPrice(price(q(0.95)), 0)}, 60% ${fmtPrice(price(q(0.2)), 0)}–${fmtPrice(price(q(0.8)), 0)}`}>
        <div className="absolute top-3 h-3 rounded-sm bg-accent/20" style={{ left: x(price(q(0.05))), right: `calc(100% - ${x(price(q(0.95)))})` }} />
        <div className="absolute top-3 h-3 rounded-sm bg-accent/50" style={{ left: x(price(q(0.2))), right: `calc(100% - ${x(price(q(0.8)))})` }} />
        <div className="absolute top-1.5 h-6 w-0.5 bg-ink-1" style={{ left: x(price(q(0.5))) }} />
        <div
          className="absolute top-2 h-5 rounded-sm border border-dashed border-warn"
          title={tr(
            `Przedział ACI tej prognozy (α = ${r.aci.alpha.toFixed(3)}${r.aci.lo === null ? ', nieskończony' : ''}; bieżące α = ${r.aci.alphaNow.toFixed(3)}) — samokorygujący się przedział 90%`,
            `ACI interval of this forecast (α = ${r.aci.alpha.toFixed(3)}${r.aci.lo === null ? ', infinite' : ''}; current α = ${r.aci.alphaNow.toFixed(3)}), a self-correcting 90% interval`
          )}
          style={{ left: x(aciLo), right: `calc(100% - ${x(aciHi)})` }}
        />
      </div>
      <div className="flex justify-between text-[10px] font-mono tabular-nums text-ink-3">
        <span>{fmtPrice(price(q(0.05)), 0)}</span>
        <span className="text-ink-2">
          {tr('mediana', 'median')} {fmtPrice(price(q(0.5)), 0)}
        </span>
        <span>{fmtPrice(price(q(0.95)), 0)}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-3">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-2 rounded-sm bg-accent/20" aria-hidden="true" />
          90%
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-2 rounded-sm bg-accent/50" aria-hidden="true" />
          60%
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-2 rounded-sm border border-dashed border-warn" aria-hidden="true" />
          {tr('ACI (samokorekta pokrycia)', 'ACI (self-correcting coverage)')}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
        <Stat
          label={tr('Umiejętność (CRPSS)', 'Skill (CRPSS)')}
          value={<span className="font-mono tabular-nums text-base">{enough ? pct(sc!.crpss, 1) : DASH}</span>}
          hint={
            enough
              ? tr(
                  `> 0 = lepszy od rozkładu normalnego z 30 dni; CRPS obcięty do τ ∈ [0.025; 0.975] · n ${sc!.n}`,
                  `> 0 = better than a 30-day normal distribution; CRPS truncated to τ ∈ [0.025; 0.975] · n ${sc!.n}`
                )
              : fromN(sc?.n ?? 0)
          }
        />
        <Stat
          label={tr('Pokrycie 90%', 'Coverage 90%')}
          value={<span className="font-mono tabular-nums text-base">{enough ? pct(sc!.cov90?.rate, 1) : DASH}</span>}
          hint={
            enough && sc!.cov90 && sc!.cov90.kupiecP !== null
              ? tr(`test Kupca p = ${sc!.cov90.kupiecP.toFixed(2)} na ${sc!.cov90.nEff} rozłącznych`, `Kupiec test p = ${sc!.cov90.kupiecP.toFixed(2)} on ${sc!.cov90.nEff} disjoint`)
              : tr('nominał 90%', 'nominal 90%')
          }
        />
        <Stat
          label={tr('Pokrycie 60%', 'Coverage 60%')}
          value={<span className="font-mono tabular-nums text-base">{enough ? pct(sc!.cov60?.rate, 1) : DASH}</span>}
          hint={tr('nominał 60%', 'nominal 60%')}
        />
        <Stat
          label={tr('Pokrycie ACI', 'ACI coverage')}
          value={<span className="font-mono tabular-nums text-base">{enough ? pct(sc!.covAci?.rate, 1) : DASH}</span>}
          hint={tr('cel 90%, korekta online', 'target 90%, online correction')}
        />
      </div>
      {enough && <PitHist hist={sc!.pitHist} />}
      {enough && (
        <p className="text-[10px] text-ink-3 leading-snug">
          {tr(
            `Prognozy co 15 min z horyzontem ${HORIZON_LABEL[r.h] ?? `${r.h} min`} nakładają się, więc ich wyniki są skorelowane. Odsetki pokrycia opisują wszystkie prognozy, a test Kupca liczony jest na podpróbie rozłącznej.`,
            `Forecasts every 15 min with a ${HORIZON_LABEL[r.h] ?? `${r.h} min`} horizon overlap, so their outcomes are correlated. Coverage rates describe all forecasts, while the Kupiec test runs on a disjoint subsample.`
          )}
        </p>
      )}
    </div>
  );
};

/** Histogram PIT (10 koszyków): płaski = prognozy dobrze skalibrowane; U = za wąskie; garb = za szerokie. */
const PitHist: React.FC<{ hist: number[] }> = ({ hist }) => {
  const max = Math.max(1, ...hist);
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] text-ink-3">
        {tr('Histogram PIT — płaski = kalibracja; „U” = za wąskie przedziały; garb = za szerokie', 'PIT histogram: flat = calibrated; "U" = intervals too narrow; hump = too wide')}
      </div>
      <div className="flex items-end gap-0.5 h-10" role="img" aria-label={`${tr('Histogram PIT', 'PIT histogram')}: ${hist.join(', ')}`}>
        {hist.map((v, i) => (
          <div key={i} className="flex-1 rounded-t-sm bg-accent/60" style={{ height: `${(v / max) * 100}%` }} title={`${i * 10}–${i * 10 + 10}%: ${v}`} />
        ))}
      </div>
    </div>
  );
};

/** Werdykt „kto trafniejszy” dopiero od 100 pytań — przy ocenie co 15 min mniejsza próba to ryzyko przypadkowego „dowodu” */
const VERDICT_N = 100;

/** Wiersz wyników poziomu oceny: Brier modelu i rynku, różnica z przedziałem 90%. */
const sd3 = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(3)}`;
const DiffCell: React.FC<{ d: { d: number; lo: number; hi: number } | null | undefined; show: boolean }> = ({ d, show }) =>
  show && d ? (
    <>
      {sd3(d.d)}{' '}
      <span className="text-[10px] text-ink-3">
        ({sd3(d.lo)} … {sd3(d.hi)})
      </span>
    </>
  ) : (
    <>{DASH}</>
  );

const MarketRow: React.FC<{ label: string; title: string; sc: MktScores }> = ({ label, title, sc }) => {
  const enough = sc.n >= MIN_N;
  const f3 = (v: number | null) => (enough && v !== null ? v.toFixed(3) : DASH);
  return (
    <tr className="border-t border-line align-baseline">
      <td className="py-1.5 pr-3 font-sans text-ink-1" title={title}>
        {label}
      </td>
      <td className="py-1.5 pr-3">{enough ? sc.n : `${sc.n} (${tr('od', 'from')} ${MIN_N})`}</td>
      <td className="py-1.5 pr-3">{f3(sc.brierModel)}</td>
      <td className="py-1.5 pr-3">{f3(sc.brierMarket)}</td>
      <td className="py-1.5">
        <DiffCell d={sc.diff} show={enough} />
      </td>
    </tr>
  );
};

/** Ensemble na pytaniach z zapisanym p_e: model, rynek, rynek skalibrowany i ensemble na tym samym podzbiorze. */
const EnsembleRow: React.FC<{ label: string; sc: MktScores }> = ({ label, sc }) => {
  const n = sc.nEns ?? 0;
  const ok = n >= MIN_N;
  const f3 = (v: number | null | undefined) => (ok && v != null ? v.toFixed(3) : DASH);
  return (
    <tr className="border-t border-line align-baseline">
      <td className="py-1.5 pr-3 font-sans text-ink-1">{label}</td>
      <td className="py-1.5 pr-3">{ok ? n : `${n} (${tr('od', 'from')} ${MIN_N})`}</td>
      <td className="py-1.5 pr-3">{f3(sc.brierModelE)}</td>
      <td className="py-1.5 pr-3">{f3(sc.brierMarketE)}</td>
      <td className="py-1.5 pr-3">{f3(sc.brierRec)}</td>
      <td className="py-1.5 pr-3">{f3(sc.brierEns)}</td>
      <td className="py-1.5">
        <DiffCell d={sc.diffAdd} show={ok} />
      </td>
    </tr>
  );
};

/** Bieżące wagi ensemble z interpretacją (b_model ≈ 0 → model nic nie dodaje do ceny rynku). */
const EnsembleWeights: React.FC<{ e: NonNullable<NonNullable<DeskLedgerSummary['market']>['ensemble']> }> = ({ e }) => {
  const f2 = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`;
  const note =
    e.n < 50
      ? tr(
          `wagi startowe (równy pooling logarytmiczny) — dopasowanie od 50 rozstrzygniętych pytań, teraz ${e.n}`,
          `starting weights (equal logarithmic pooling), fitted from 50 settled questions, now ${e.n}`
        )
      : e.bm < -0.1
      ? tr(
          'ujemna waga modelu: przy znanej cenie rynku odchylenia modelu od rynku wskazywały częściej zły kierunek (nadmierna pewność)',
          "negative model weight: given the market price, the model's deviations from it more often pointed the wrong way (overconfidence)"
        )
      : e.bm < 0.1
      ? tr('model prawie nic nie dodaje do ceny rynku', 'the model adds almost nothing to the market price')
      : e.bk < 0.1
      ? tr('rynek prawie nic nie dodaje do modelu', 'the market adds almost nothing to the model')
      : e.bm + e.bk > 1.15
      ? tr('suma wag > 1: połączenie „ekstremizuje” (oba źródła są zbyt ostrożne)', 'weights sum > 1: the pool "extremises" (both sources are too cautious)')
      : tr('oba źródła wnoszą informację', 'both sources add information');
  return (
    <div className="text-[11px] text-ink-2 leading-relaxed">
      <span className="text-ink-3">Ensemble: </span>
      logit p = <span className="font-mono text-ink-1">{f2(e.a)}</span> + <span className="font-mono text-ink-1">{f2(e.bm)}</span>·logit {tr('model', 'model')} +{' '}
      <span className="font-mono text-ink-1">{f2(e.bk)}</span>·logit {tr('rynek', 'market')}
      {e.rec && (
        <>
          {' '}
          · <span className="text-ink-3">{tr('rynek skalibrowany', 'recalibrated market')}: </span>
          <span className="font-mono text-ink-1">{f2(e.rec.a)}</span> + <span className="font-mono text-ink-1">{f2(e.rec.bk)}</span>·logit {tr('rynek', 'market')}
        </>
      )}{' '}
      <span className="text-ink-3">
        (
        {tr(
          `${e.n} pytań z 30 dni; ${note}; wagi z małej próby są niepewne — rozstrzyga tabela niżej`,
          `${e.n} questions from 30 days; ${note}; weights from a small sample are uncertain, the table below decides`
        )}
        )
      </span>
    </div>
  );
};

/**
 * Model vs rynek predykcyjny (HIP-4, 15 min): te same pytania „mark BTC ≥ K w terminie”, p modelu i cena rynku zapisane
 * przed faktem; Brier obu i różnica z niepewnością na dwóch poziomach: notowania płynne i notowania z wąskim spreadem.
 * Ensemble i rynek skalibrowany — osobna tabela na pytaniach z zapisanym p_e (porównanie jak z jak).
 */
const MarketCard: React.FC<{ m: NonNullable<DeskLedgerSummary['market']> }> = ({ m }) => {
  const l = m.latest;
  const mid = l && l.bid !== null && l.ask !== null ? (l.bid + l.ask) / 2 : null;
  const sc = m.scores;
  const verdict =
    sc.n < VERDICT_N || !sc.diff
      ? null
      : sc.diff.hi < 0
      ? tr('model trafniejszy (Brier) niż rynek', 'the model is more accurate (Brier) than the market')
      : sc.diff.lo > 0
      ? tr('rynek trafniejszy (Brier) niż model', 'the market is more accurate (Brier) than the model')
      : tr('różnica nieudowodniona', 'difference not proven');
  const hasEns = sc.nEns !== undefined;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">{tr('Model vs rynek predykcyjny · HIP-4 · 15 min', 'Model vs prediction market · HIP-4 · 15 min')}</div>
        {l && (
          <span className="text-[11px] text-ink-3">
            {tr('ostatnie', 'latest')}: BTC ≥ {fmtPrice(l.K, 0)} {tr('o', 'at')} {timeFmt.format(l.expiry)}
          </span>
        )}
      </div>
      <p className="text-[11px] text-ink-2 leading-relaxed">
        {tr(
          'Hyperliquid notuje co 15 min rynek „czy mark BTC na koniec kwadransa będzie ≥ ceny z jego początku”. 5–10 min przed terminem desk zapisuje w tym dzienniku cenę rynku (strona „Tak”) i prawdopodobieństwo z własnego modelu — obie przed faktem — a potem rozstrzyga je ze świec. Wyniki w pobliżu progu (≤ 0,05%) są pomijane, bo rynek rozlicza po cenie mark, a dziennik ze świec transakcji.',
          'Every 15 min Hyperliquid lists a market "will the BTC mark at the end of the quarter-hour be ≥ the price at its start". 5–10 min before expiry the desk records in this ledger the market price (the "Yes" side) and its own model probability, both before the fact, and later settles them from candles. Outcomes near the threshold (≤ 0.05%) are skipped, because the market settles on the mark price and the ledger on trade candles.'
        )}
      </p>
      {l && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2">
          <span>
            {tr('model', 'model')} <span className="font-mono tabular-nums text-ink-1">{pct(l.p)}</span>
          </span>
          <span>
            {tr('rynek', 'market')} <span className="font-mono tabular-nums text-ink-1">{mid === null ? DASH : pct(mid)}</span>
            {!l.liquid && <span className="ml-1 text-[10px] text-ink-3">{tr('arkusz płytki', 'thin book')}</span>}
          </span>
          {l.pe != null && (
            <span
              title={tr(
                'Pooling logarytmiczny modelu i rynku z wagami dopasowanymi przed wydaniem na wcześniej rozstrzygniętych pytaniach',
                'Logarithmic pooling of model and market with weights fitted before issue on previously settled questions'
              )}
            >
              ensemble <span className="font-mono tabular-nums text-ink-1">{pct(l.pe)}</span>
            </span>
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left font-mono tabular-nums text-[11px]">
          <caption className="sr-only">{tr('Brier modelu i rynku na tych samych pytaniach, różnica z przedziałem bootstrap 90%', 'Brier of model and market on the same questions, difference with a 90% bootstrap interval')}</caption>
          <thead className="text-ink-3">
            <tr>
              <th className="py-1 pr-3 font-medium font-sans">{tr('Notowania', 'Quotes')}</th>
              <th className="py-1 pr-3 font-medium font-sans">{tr('Pytań', 'Questions')}</th>
              <th className="py-1 pr-3 font-medium font-sans">{tr('Brier model', 'Brier model')}</th>
              <th className="py-1 pr-3 font-medium font-sans">{tr('Brier rynek', 'Brier market')}</th>
              <th className="py-1 font-medium font-sans" title={tr('Ujemne = model trafniejszy; przedział bootstrap 90% (pary pytań)', 'Negative = model more accurate; 90% bootstrap interval (question pairs)')}>
                {tr('Model − rynek', 'Model − market')}
              </th>
            </tr>
          </thead>
          <tbody>
            <MarketRow label={LIQUID} title={tr('Spread ≤ 5 pp i ≥ 50 USDC w ±5 pp od środka po obu stronach', 'Spread ≤ 5 pp and ≥ 50 USDC within ±5 pp of mid on both sides')} sc={m.scores} />
            {m.tight && (
              <MarketRow label={TIGHT} title={tr('Spread ≤ 5 pp, także płytkie arkusze (cena może wynikać z małego zlecenia)', 'Spread ≤ 5 pp, thin books included (the price may come from a small order)')} sc={m.tight} />
            )}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-ink-3">
        {tr(
          `Brier: 0 = idealnie, 0,25 = rzut monetą. Pominięte: blisko progu ${sc.near}, notowanie niepłynne ${sc.illiquid}.`,
          `Brier: 0 = perfect, 0.25 = coin flip. Skipped: near threshold ${sc.near}, illiquid quote ${sc.illiquid}.`
        )}
        {verdict ? (
          <span className="text-ink-1">
            {' '}
            {tr('Wniosek na tej próbie (notowania płynne):', 'Conclusion on this sample (liquid quotes):')} {verdict}.
          </span>
        ) : (
          <span> {tr(`Wniosek dopiero od ${VERDICT_N} pytań z płynnym notowaniem.`, `Conclusions only from ${VERDICT_N} questions with a liquid quote.`)}</span>
        )}
      </div>
      {hasEns && (
        <>
          {m.ensemble && <EnsembleWeights e={m.ensemble} />}
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono tabular-nums text-[11px]">
              <caption className="sr-only">
                {tr(
                  'Ensemble i rynek skalibrowany: Brier modelu, rynku, rynku skalibrowanego i ensemble na tych samych pytaniach (z zapisanym p ensemble); wartość dodana modelu = ensemble − rynek skalibrowany z przedziałem bootstrap 90%',
                  "Ensemble and recalibrated market: Brier of model, market, recalibrated market and ensemble on the same questions (with a recorded ensemble p); the model's added value = ensemble − recalibrated market with a 90% bootstrap interval"
                )}
              </caption>
              <thead className="text-ink-3">
                <tr>
                  <th className="py-1 pr-3 font-medium font-sans">{tr('Notowania', 'Quotes')}</th>
                  <th className="py-1 pr-3 font-medium font-sans" title={tr('Pytania z zapisanym p ensemble', 'Questions with a recorded ensemble p')}>
                    {tr('Pytań', 'Questions')}
                  </th>
                  <th className="py-1 pr-3 font-medium font-sans">Model</th>
                  <th className="py-1 pr-3 font-medium font-sans">{tr('Rynek', 'Market')}</th>
                  <th className="py-1 pr-3 font-medium font-sans" title={tr('a + b·logit(rynek) — ta sama procedura dopasowania, bez modelu', 'a + b·logit(market), the same fitting procedure without the model')}>
                    {tr('Rynek skal.', 'Recal. market')}
                  </th>
                  <th className="py-1 pr-3 font-medium font-sans">Ensemble</th>
                  <th
                    className="py-1 font-medium font-sans"
                    title={tr(
                      'Ensemble − rynek skalibrowany: ujemne = model dodaje informację ponad rekalibrację ceny rynku',
                      'Ensemble − recalibrated market: negative = the model adds information beyond recalibrating the market price'
                    )}
                  >
                    {tr('Wartość modelu', 'Model value')}
                  </th>
                </tr>
              </thead>
              <tbody>
                <EnsembleRow label={LIQUID} sc={m.scores} />
                {m.tight && <EnsembleRow label={TIGHT} sc={m.tight} />}
              </tbody>
            </table>
          </div>
          <div className="text-[11px] text-ink-3 leading-relaxed">
            {tr(
              'Wszystkie kolumny liczone na tych samych pytaniach (z zapisanym p ensemble). Rynek skalibrowany to sama cena rynku poprawiona tą samą procedurą (np. o błąd faworyt–outsider) — dopiero przewaga ensemble nad nim pokazuje, że model wnosi informację, której cena rynku nie zawiera. Wagi obu dopasowuje się przy wydaniu wyłącznie na pytaniach rozstrzygniętych w 30 dniach wcześniej; weryfikator odtwarza je ponownym dopasowaniem.',
              'All columns are computed on the same questions (with a recorded ensemble p). The recalibrated market is the market price alone corrected by the same procedure (e.g. for the favourite–longshot bias); only an ensemble edge over it shows that the model adds information the market price does not contain. Both sets of weights are fitted at issue only on questions settled in the previous 30 days; the verifier reproduces them by refitting.'
            )}
          </div>
        </>
      )}
    </div>
  );
};

/** Szanse dotknięcia poziomów 2h: surowe z modelu i skalibrowane (Venn–Abers), wyniki Briera, niezawodność. */
const TouchCard: React.FC<{ s: DeskLedgerSummary }> = ({ s }) => {
  const t = s.latest.touch;
  const sc = s.scores.touch;
  const enough = sc.n >= MIN_N;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">{tr('Dotknięcie poziomu w 2 h', 'Level touch within 2 h')}</div>
        {t && (
          <span className="text-[11px] text-ink-3">
            {tr('wydano', 'issued')} {timeFmt.format(t.t)} · {tr('cena', 'price')} {fmtPrice(t.px0, 0)}
          </span>
        )}
      </div>
      {t ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono tabular-nums text-[11px]">
            <caption className="sr-only">{tr('Najnowsze prognozy dotknięcia poziomów', 'Latest level touch forecasts')}</caption>
            <thead className="text-ink-3">
              <tr>
                <th className="py-1 pr-3 font-medium font-sans">{tr('Poziom', 'Level')}</th>
                <th className="py-1 pr-3 font-medium">{tr('Cena', 'Price')}</th>
                <th className="py-1 pr-3 font-medium">Model</th>
                <th className="py-1 font-medium" title={tr('Venn–Abers: przedział i scalone prawdopodobieństwo z rozstrzygniętej historii', 'Venn–Abers: interval and merged probability from settled history')}>
                  {tr('Skalibrowane', 'Calibrated')}
                </th>
              </tr>
            </thead>
            <tbody>
              {(['pdh', 'deq', 'pdl'] as TouchLevel[]).map((l) => (
                <tr key={l} className="border-t border-line">
                  <td className="py-1 pr-3 font-sans">{LEVEL_LABEL[l]}</td>
                  <td className="py-1 pr-3">{fmtPrice(t.lv[l], 0)}</td>
                  <td className="py-1 pr-3">{t.p[l] === null ? <span className="font-sans text-ink-3">{tr('cena już za poziomem', 'price already past the level')}</span> : pct(t.p[l])}</td>
                  <td className="py-1">{enough && t.va[l] ? `${pct(t.va[l]!.p)} (${pct(t.va[l]!.p0)}–${pct(t.va[l]!.p1)})` : DASH}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-xs text-ink-3">{tr('Brak bieżącej prognozy (np. przed wyznaczeniem PDH/PDL nowej doby).', 'No current forecast (e.g. before the new day\'s PDH/PDL are set).')}</div>
      )}
      <p className="text-[10px] text-ink-3 leading-snug">
        {tr(
          'Prognozy 2 h co 15 min nakładają się, więc przedziały Venna–Abersa i mapa kalibracji są orientacyjne. Poziom, za którym cena już jest, nie jest prognozowany ani oceniany.',
          '2 h forecasts every 15 min overlap, so the Venn–Abers intervals and the calibration map are indicative. A level price is already past is neither forecast nor scored.'
        )}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
        <Stat
          label="Brier"
          value={<span className="font-mono tabular-nums text-base">{enough && sc.brier !== null ? sc.brier.toFixed(3) : DASH}</span>}
          hint={enough ? `n ${sc.n} · ${tr('klimatologia', 'climatology')} ${sc.brierBase?.toFixed(3) ?? DASH}` : fromN(sc.n)}
        />
        <Stat
          label={tr('Umiejętność (BSS)', 'Skill (BSS)')}
          value={<span className="font-mono tabular-nums text-base">{enough ? pct(sc.bss, 1) : DASH}</span>}
          hint={tr('> 0 = lepiej niż częstość bazowa każdego poziomu', '> 0 = better than the base rate of each level')}
        />
        {enough && <ReliabilityMini bins={sc.reliability} />}
      </div>
    </div>
  );
};

/** Diagram niezawodności: częstość vs średnie p w koszykach (przekątna = idealna kalibracja). */
const ReliabilityMini: React.FC<{ bins: DeskLedgerSummary['scores']['touch']['reliability'] }> = ({ bins }) => {
  const S = 64;
  const pts = bins.filter((b) => b.n > 0 && b.meanP !== null && b.freq !== null);
  return (
    <div className="flex items-center gap-2">
      <svg width={S} height={S} role="img" aria-label={tr('Diagram niezawodności prognoz dotknięć', 'Reliability diagram of touch forecasts')}>
        <rect x={0} y={0} width={S} height={S} fill="none" stroke="var(--color-line)" />
        <line x1={0} y1={S} x2={S} y2={0} stroke="var(--color-ink-3)" strokeDasharray="2 2" />
        {pts.map((b, i) => (
          <circle key={i} cx={b.meanP! * S} cy={S - b.freq! * S} r={Math.min(5, 1.5 + Math.sqrt(b.n) / 4)} fill="var(--color-accent)" opacity={0.85} />
        ))}
      </svg>
      <span className="text-[10px] text-ink-3 leading-snug">{tr('niezawodność: punkty na przekątnej = p zgodne z częstością', 'reliability: points on the diagonal = p matches frequency')}</span>
    </div>
  );
};
