import React from 'react';
import { useDeskLedger } from '../../state/useDeskLedger';
import { LedgerVerifyCard } from './LedgerVerifyCard';
import { ModelAbCard } from './ModelAbCard';
import { LEDGER_BASE } from '../../state/usePublished';
import { Badge, EmptyState, Panel, Stat, DASH, fmtPrice } from '../../ui';
import { DeskLedgerSummary, MktScores, RetScores, TouchLevel, isAb } from '../../utils/deskLedger';

const timeFmt = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
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
      <Badge tone="live" title="Prognozy zapisywane co 15 min przed faktem; rozstrzygane ze świec 1m Hyperliquid">
        LIVE
      </Badge>
    ) : status === 'stale' || status === 'expired' ? (
      <Badge tone="stale" title="Dziennik nie był aktualizowany od ponad 35 min">
        STALE
      </Badge>
    ) : null;
  return (
    <Panel eyebrow="Prognozy przed faktem · łańcuch hashy · kotwica w Bitcoinie" title="Weryfikowalny dziennik desku" actions={badge}>
      {!summary ? (
        <EmptyState
          title={status === 'loading' ? 'Pobieram dziennik prognoz…' : 'Dziennik prognoz chwilowo niedostępny'}
          detail="Co 15 min desk zapisuje swoje prognozy, zanim rynek je rozstrzygnie. Każda linia zawiera hash poprzedniej, po każdym slocie głowa łańcucha jest znakowana w OpenTimestamps, a historia gałęzi jest tylko dopisywana."
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
      Co 15 min desk zapisuje prognozy, zanim rynek je rozstrzygnie: rozkład zwrotu BTC na 1 h i 4 h (ten sam model zmienności co Analizator)
      oraz szanse dotknięcia PDH / D-EQ / PDL w 2 h (ten sam silnik co pas „Zasięg 2h”). Horyzont liczy się od pełnej minuty po wydaniu.
      Każda linia zawiera hash poprzedniej. Zaraz po wydaniu głowa łańcucha jest znakowana w OpenTimestamps (niezależne kalendarze od razu, blok
      Bitcoina po kilku godzinach), a historia gałęzi jest tylko dopisywana. Pominięte sloty są zapisywane jawnie. Wyniki obok liczone są z tych
      zapisów i każdy może je przeliczyć sam.
      {stale && <span className="text-warn"> Ostatnia aktualizacja {(expired ? dateTimeFmt : timeFmt).format(s.asOf)}.</span>}
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
          Głowa łańcucha <code className="font-mono text-ink-1" title={s.head.hash}>{s.head.hash.slice(0, 16)}…</code>
        </span>
        <span>
          linie <span className="font-mono text-ink-1">{s.head.lines.toLocaleString('pl-PL')}</span>
        </span>
        <span>
          czeka na rozstrzygnięcie <span className="font-mono text-ink-1">{s.pending}</span>
        </span>
        <span title="Prognozy, których nie dało się rozstrzygnąć (brak świec 1m przez 6 h po horyzoncie) — jawnie unieważnione, nie pominięte">
          unieważnione <span className="font-mono text-ink-1">{s.voided}</span>
        </span>
        <span title="Sloty z prognozą vs jawnie pominięte (brak modelu, ceny albo przerwa) — braki nie znikają po cichu">
          sloty <span className="font-mono text-ink-1">{s.participation.issued}</span> wydane ·{' '}
          <span className="font-mono text-ink-1">{s.participation.skipped}</span> pominięte
        </span>
        <span title="Pokwitowania OpenTimestamps głowy łańcucha po wydaniu slotu, ostatnie 24 h">
          pokwitowania 24 h <span className="font-mono text-ink-1">{s.slotStamps}</span>
        </span>
      </div>
      {s.participation.gaps.length > 0 && (
        <div className="text-ink-3">
          Ostatnie pominięte sloty:{' '}
          {s.participation.gaps
            .slice(-5)
            .map(
              (g) =>
                `${dateTimeFmt.format(g.slot)}${g.until !== undefined && g.until !== g.slot ? ` – ${dateTimeFmt.format(g.until)}` : ''} ` +
                `(${g.reason === 'outage' ? 'przerwa' : g.reason === 'no-model' ? 'brak modelu' : g.reason === 'no-price' ? 'brak ceny' : g.reason})`
            )
            .join(' · ')}
        </div>
      )}
      {s.ots.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          Kotwice w Bitcoinie:
          {s.ots.map((o) => (
            <a key={o.day} href={fileHref(o.file)} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline font-mono">
              {o.day}
            </a>
          ))}
        </div>
      )}
      <LedgerVerifyCard summaryHead={s.head.hash} />
      <details>
        <summary className="cursor-pointer select-none text-ink-1 font-medium py-1">Jak to sprawdzić samodzielnie</summary>
        <ol className="list-decimal pl-4 mt-1.5 space-y-1 leading-relaxed">
          <li>
            Pliki dzienne: <a className="text-accent hover:underline" href={fileHref('')} target="_blank" rel="noopener noreferrer">gałąź ledger repo danych</a> — jedna linia JSON na
            prognozę albo rozstrzygnięcie.
          </li>
          <li>
            Pełna kontrola: <code className="font-mono text-ink-1">git clone -b ledger …/hyperquant-data ledger</code>, potem{' '}
            <code className="font-mono text-ink-1">node scripts/verify-ledger.mjs --dir ledger --market --bitcoin</code> (repo HyperQuant). To niezależna
            implementacja: sprawdza łańcuch od początku, historię git (tylko dopisywanie), kolejność zapisów, pokwitowanie każdego slotu, przelicza wyniki z
            kwantyli; <code className="font-mono text-ink-1">--market</code> porównuje zapisane ceny rozstrzygnięć ze świecami 1m Hyperliquid,{' '}
            <code className="font-mono text-ink-1">--bitcoin</code> odczytuje czas bloku Bitcoina z pokwitowań.
          </li>
          <li>
            Czas: <code className="font-mono text-ink-1">ots upgrade</code>, potem <code className="font-mono text-ink-1">ots verify</code> (klient
            OpenTimestamps) na pokwitowaniu slotu (<code className="font-mono text-ink-1">ots/slots/&lt;dzień&gt;/</code>, skrót = hash ostatniej prognozy
            slotu) albo dnia (<code className="font-mono text-ink-1">ots/&lt;dzień&gt;.jsonl.ots</code>). Potwierdza, że zapis istniał przed blokiem Bitcoina.
            Blok przychodzi zwykle po 1–6 h, więc dla prognoz 1 h dowodem zapisu przed faktem są kalendarze OpenTimestamps (niezależni operatorzy, przyjęcie
            od razu), a blok potwierdza je później; dla 4 h blok zwykle zdąży przed rozstrzygnięciem.
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
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">Zwrot za {HORIZON_LABEL[r.h] ?? `${r.h} min`}</div>
        <span className="text-[11px] text-ink-3">
          wydano {timeFmt.format(r.t)} · cena {fmtPrice(r.px0, 0)}
        </span>
      </div>
      <div className="relative h-9" role="img" aria-label={`Przedziały prognozy: 90% ${fmtPrice(price(q(0.05)), 0)}–${fmtPrice(price(q(0.95)), 0)}, 60% ${fmtPrice(price(q(0.2)), 0)}–${fmtPrice(price(q(0.8)), 0)}`}>
        <div className="absolute top-3 h-3 rounded-sm bg-accent/20" style={{ left: x(price(q(0.05))), right: `calc(100% - ${x(price(q(0.95)))})` }} />
        <div className="absolute top-3 h-3 rounded-sm bg-accent/50" style={{ left: x(price(q(0.2))), right: `calc(100% - ${x(price(q(0.8)))})` }} />
        <div className="absolute top-1.5 h-6 w-0.5 bg-ink-1" style={{ left: x(price(q(0.5))) }} />
        <div
          className="absolute top-2 h-5 rounded-sm border border-dashed border-warn"
          title={`Przedział ACI tej prognozy (α = ${r.aci.alpha.toFixed(3)}${r.aci.lo === null ? ', nieskończony' : ''}; bieżące α = ${r.aci.alphaNow.toFixed(3)}) — samokorygujący się przedział 90%`}
          style={{ left: x(aciLo), right: `calc(100% - ${x(aciHi)})` }}
        />
      </div>
      <div className="flex justify-between text-[10px] font-mono tabular-nums text-ink-3">
        <span>{fmtPrice(price(q(0.05)), 0)}</span>
        <span className="text-ink-2">mediana {fmtPrice(price(q(0.5)), 0)}</span>
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
          ACI (samokorekta pokrycia)
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
        <Stat
          label="Umiejętność (CRPSS)"
          value={<span className="font-mono tabular-nums text-base">{enough ? pct(sc!.crpss, 1) : DASH}</span>}
          hint={enough ? `> 0 = lepszy od rozkładu normalnego z 30 dni; CRPS obcięty do τ ∈ [0.025; 0.975] · n ${sc!.n}` : `od ${MIN_N} rozstrzygnięć (jest ${sc?.n ?? 0})`}
        />
        <Stat
          label="Pokrycie 90%"
          value={<span className="font-mono tabular-nums text-base">{enough ? pct(sc!.cov90?.rate, 1) : DASH}</span>}
          hint={
            enough && sc!.cov90 && sc!.cov90.kupiecP !== null
              ? `test Kupca p = ${sc!.cov90.kupiecP.toFixed(2)} na ${sc!.cov90.nEff} rozłącznych`
              : 'nominał 90%'
          }
        />
        <Stat
          label="Pokrycie 60%"
          value={<span className="font-mono tabular-nums text-base">{enough ? pct(sc!.cov60?.rate, 1) : DASH}</span>}
          hint="nominał 60%"
        />
        <Stat
          label="Pokrycie ACI"
          value={<span className="font-mono tabular-nums text-base">{enough ? pct(sc!.covAci?.rate, 1) : DASH}</span>}
          hint="cel 90%, korekta online"
        />
      </div>
      {enough && <PitHist hist={sc!.pitHist} />}
      {enough && (
        <p className="text-[10px] text-ink-3 leading-snug">
          Prognozy co 15 min z horyzontem {HORIZON_LABEL[r.h] ?? `${r.h} min`} nakładają się, więc ich wyniki są skorelowane. Odsetki pokrycia opisują
          wszystkie prognozy, a test Kupca liczony jest na podpróbie rozłącznej.
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
      <div className="text-[10px] text-ink-3">Histogram PIT — płaski = kalibracja; „U” = za wąskie przedziały; garb = za szerokie</div>
      <div className="flex items-end gap-0.5 h-10" role="img" aria-label={`Histogram PIT: ${hist.join(', ')}`}>
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
      <td className="py-1.5 pr-3">{enough ? sc.n : `${sc.n} (od ${MIN_N})`}</td>
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
      <td className="py-1.5 pr-3">{ok ? n : `${n} (od ${MIN_N})`}</td>
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
      ? `wagi startowe (równy pooling logarytmiczny) — dopasowanie od 50 rozstrzygniętych pytań, teraz ${e.n}`
      : e.bm < -0.1
      ? 'ujemna waga modelu: przy znanej cenie rynku odchylenia modelu od rynku wskazywały częściej zły kierunek (nadmierna pewność)'
      : e.bm < 0.1
      ? 'model prawie nic nie dodaje do ceny rynku'
      : e.bk < 0.1
      ? 'rynek prawie nic nie dodaje do modelu'
      : e.bm + e.bk > 1.15
      ? 'suma wag > 1: połączenie „ekstremizuje” (oba źródła są zbyt ostrożne)'
      : 'oba źródła wnoszą informację';
  return (
    <div className="text-[11px] text-ink-2 leading-relaxed">
      <span className="text-ink-3">Ensemble: </span>
      logit p = <span className="font-mono text-ink-1">{f2(e.a)}</span> + <span className="font-mono text-ink-1">{f2(e.bm)}</span>·logit model +{' '}
      <span className="font-mono text-ink-1">{f2(e.bk)}</span>·logit rynek
      {e.rec && (
        <>
          {' '}
          · <span className="text-ink-3">rynek skalibrowany: </span>
          <span className="font-mono text-ink-1">{f2(e.rec.a)}</span> + <span className="font-mono text-ink-1">{f2(e.rec.bk)}</span>·logit rynek
        </>
      )}{' '}
      <span className="text-ink-3">
        ({e.n} pytań z 30 dni; {note}; wagi z małej próby są niepewne — rozstrzyga tabela niżej)
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
      ? 'model trafniejszy (Brier) niż rynek'
      : sc.diff.lo > 0
      ? 'rynek trafniejszy (Brier) niż model'
      : 'różnica nieudowodniona';
  const hasEns = sc.nEns !== undefined;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">Model vs rynek predykcyjny · HIP-4 · 15 min</div>
        {l && <span className="text-[11px] text-ink-3">ostatnie: BTC ≥ {fmtPrice(l.K, 0)} o {timeFmt.format(l.expiry)}</span>}
      </div>
      <p className="text-[11px] text-ink-2 leading-relaxed">
        Hyperliquid notuje co 15 min rynek „czy mark BTC na koniec kwadransa będzie ≥ ceny z jego początku”. 5–10 min przed terminem desk zapisuje w
        tym dzienniku cenę rynku (strona „Tak”) i prawdopodobieństwo z własnego modelu — obie przed faktem — a potem rozstrzyga je ze świec. Wyniki
        w pobliżu progu (≤ 0,05%) są pomijane, bo rynek rozlicza po cenie mark, a dziennik ze świec transakcji.
      </p>
      {l && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2">
          <span>
            model <span className="font-mono tabular-nums text-ink-1">{pct(l.p)}</span>
          </span>
          <span>
            rynek <span className="font-mono tabular-nums text-ink-1">{mid === null ? DASH : pct(mid)}</span>
            {!l.liquid && <span className="ml-1 text-[10px] text-ink-3">arkusz płytki</span>}
          </span>
          {l.pe != null && (
            <span title="Pooling logarytmiczny modelu i rynku z wagami dopasowanymi przed wydaniem na wcześniej rozstrzygniętych pytaniach">
              ensemble <span className="font-mono tabular-nums text-ink-1">{pct(l.pe)}</span>
            </span>
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left font-mono tabular-nums text-[11px]">
          <caption className="sr-only">Brier modelu i rynku na tych samych pytaniach, różnica z przedziałem bootstrap 90%</caption>
          <thead className="text-ink-3">
            <tr>
              <th className="py-1 pr-3 font-medium font-sans">Notowania</th>
              <th className="py-1 pr-3 font-medium font-sans">Pytań</th>
              <th className="py-1 pr-3 font-medium font-sans">Brier model</th>
              <th className="py-1 pr-3 font-medium font-sans">Brier rynek</th>
              <th className="py-1 font-medium font-sans" title="Ujemne = model trafniejszy; przedział bootstrap 90% (pary pytań)">
                Model − rynek
              </th>
            </tr>
          </thead>
          <tbody>
            <MarketRow label="płynne" title="Spread ≤ 5 pp i ≥ 50 USDC w ±5 pp od środka po obu stronach" sc={m.scores} />
            {m.tight && <MarketRow label="wąski spread" title="Spread ≤ 5 pp, także płytkie arkusze (cena może wynikać z małego zlecenia)" sc={m.tight} />}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-ink-3">
        Brier: 0 = idealnie, 0,25 = rzut monetą. Pominięte: blisko progu {sc.near}, notowanie niepłynne {sc.illiquid}.
        {verdict ? (
          <span className="text-ink-1"> Wniosek na tej próbie (notowania płynne): {verdict}.</span>
        ) : (
          <span> Wniosek dopiero od {VERDICT_N} pytań z płynnym notowaniem.</span>
        )}
      </div>
      {hasEns && (
        <>
          {m.ensemble && <EnsembleWeights e={m.ensemble} />}
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono tabular-nums text-[11px]">
              <caption className="sr-only">
                Ensemble i rynek skalibrowany: Brier modelu, rynku, rynku skalibrowanego i ensemble na tych samych pytaniach (z zapisanym p ensemble); wartość dodana
                modelu = ensemble − rynek skalibrowany z przedziałem bootstrap 90%
              </caption>
              <thead className="text-ink-3">
                <tr>
                  <th className="py-1 pr-3 font-medium font-sans">Notowania</th>
                  <th className="py-1 pr-3 font-medium font-sans" title="Pytania z zapisanym p ensemble">
                    Pytań
                  </th>
                  <th className="py-1 pr-3 font-medium font-sans">Model</th>
                  <th className="py-1 pr-3 font-medium font-sans">Rynek</th>
                  <th className="py-1 pr-3 font-medium font-sans" title="a + b·logit(rynek) — ta sama procedura dopasowania, bez modelu">
                    Rynek skal.
                  </th>
                  <th className="py-1 pr-3 font-medium font-sans">Ensemble</th>
                  <th className="py-1 font-medium font-sans" title="Ensemble − rynek skalibrowany: ujemne = model dodaje informację ponad rekalibrację ceny rynku">
                    Wartość modelu
                  </th>
                </tr>
              </thead>
              <tbody>
                <EnsembleRow label="płynne" sc={m.scores} />
                {m.tight && <EnsembleRow label="wąski spread" sc={m.tight} />}
              </tbody>
            </table>
          </div>
          <div className="text-[11px] text-ink-3 leading-relaxed">
            Wszystkie kolumny liczone na tych samych pytaniach (z zapisanym p ensemble). Rynek skalibrowany to sama cena rynku poprawiona tą samą procedurą
            (np. o błąd faworyt–outsider) — dopiero przewaga ensemble nad nim pokazuje, że model wnosi informację, której cena rynku nie zawiera. Wagi obu
            dopasowuje się przy wydaniu wyłącznie na pytaniach rozstrzygniętych w 30 dniach wcześniej; weryfikator odtwarza je ponownym dopasowaniem.
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
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">Dotknięcie poziomu w 2 h</div>
        {t && <span className="text-[11px] text-ink-3">wydano {timeFmt.format(t.t)} · cena {fmtPrice(t.px0, 0)}</span>}
      </div>
      {t ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono tabular-nums text-[11px]">
            <caption className="sr-only">Najnowsze prognozy dotknięcia poziomów</caption>
            <thead className="text-ink-3">
              <tr>
                <th className="py-1 pr-3 font-medium font-sans">Poziom</th>
                <th className="py-1 pr-3 font-medium">Cena</th>
                <th className="py-1 pr-3 font-medium">Model</th>
                <th className="py-1 font-medium" title="Venn–Abers: przedział i scalone prawdopodobieństwo z rozstrzygniętej historii">
                  Skalibrowane
                </th>
              </tr>
            </thead>
            <tbody>
              {(['pdh', 'deq', 'pdl'] as TouchLevel[]).map((l) => (
                <tr key={l} className="border-t border-line">
                  <td className="py-1 pr-3 font-sans">{LEVEL_LABEL[l]}</td>
                  <td className="py-1 pr-3">{fmtPrice(t.lv[l], 0)}</td>
                  <td className="py-1 pr-3">{t.p[l] === null ? <span className="font-sans text-ink-3">cena już za poziomem</span> : pct(t.p[l])}</td>
                  <td className="py-1">{enough && t.va[l] ? `${pct(t.va[l]!.p)} (${pct(t.va[l]!.p0)}–${pct(t.va[l]!.p1)})` : DASH}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-xs text-ink-3">Brak bieżącej prognozy (np. przed wyznaczeniem PDH/PDL nowej doby).</div>
      )}
      <p className="text-[10px] text-ink-3 leading-snug">
        Prognozy 2 h co 15 min nakładają się, więc przedziały Venna–Abersa i mapa kalibracji są orientacyjne. Poziom, za którym cena już jest,
        nie jest prognozowany ani oceniany.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
        <Stat
          label="Brier"
          value={<span className="font-mono tabular-nums text-base">{enough && sc.brier !== null ? sc.brier.toFixed(3) : DASH}</span>}
          hint={enough ? `n ${sc.n} · klimatologia ${sc.brierBase?.toFixed(3) ?? DASH}` : `od ${MIN_N} rozstrzygnięć (jest ${sc.n})`}
        />
        <Stat
          label="Umiejętność (BSS)"
          value={<span className="font-mono tabular-nums text-base">{enough ? pct(sc.bss, 1) : DASH}</span>}
          hint="> 0 = lepiej niż częstość bazowa każdego poziomu"
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
      <svg width={S} height={S} role="img" aria-label="Diagram niezawodności prognoz dotknięć">
        <rect x={0} y={0} width={S} height={S} fill="none" stroke="var(--color-line)" />
        <line x1={0} y1={S} x2={S} y2={0} stroke="var(--color-ink-3)" strokeDasharray="2 2" />
        {pts.map((b, i) => (
          <circle key={i} cx={b.meanP! * S} cy={S - b.freq! * S} r={Math.min(5, 1.5 + Math.sqrt(b.n) / 4)} fill="var(--color-accent)" opacity={0.85} />
        ))}
      </svg>
      <span className="text-[10px] text-ink-3 leading-snug">niezawodność: punkty na przekątnej = p zgodne z częstością</span>
    </div>
  );
};
