import React from 'react';
import { useDeskLedger } from '../../state/useDeskLedger';
import { LEDGER_BASE } from '../../state/usePublished';
import { Badge, EmptyState, Panel, Stat, DASH, fmtPrice } from '../../ui';
import { DeskLedgerSummary, RetScores, TouchLevel } from '../../utils/deskLedger';

const timeFmt = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' });
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
          detail="Co 15 min desk zapisuje swoje prognozy, zanim rynek je rozstrzygnie. Zapisu nie da się poprawić wstecz: każda linia zawiera hash poprzedniej, a pliki dzienne są zakotwiczane w blockchainie Bitcoina (OpenTimestamps)."
        />
      ) : (
        <LedgerBody s={summary} stale={status !== 'ready'} />
      )}
    </Panel>
  );
};

const LedgerBody: React.FC<{ s: DeskLedgerSummary; stale: boolean }> = ({ s, stale }) => (
  <div className="flex flex-col gap-5 p-4">
    <p className="text-xs text-ink-2 leading-relaxed">
      Co 15 min desk zapisuje prognozy, zanim rynek je rozstrzygnie: rozkład zwrotu BTC na 1 h i 4 h (ten sam model zmienności co Analizator)
      oraz szanse dotknięcia PDH / D-EQ / PDL w 2 h (ten sam silnik co pas „Zasięg 2h”). Każda linia zawiera hash poprzedniej, pliki dzienne
      są zakotwiczane w Bitcoinie. Wyniki obok liczone są z tych zapisów i każdy może je przeliczyć sam.
      {stale && <span className="text-warn"> Ostatnia aktualizacja {timeFmt.format(s.asOf)}.</span>}
    </p>

    <div className="grid gap-4 lg:grid-cols-2">
      {s.latest.ret.map((r) => (
        <RetCard key={r.h} r={r} sc={s.scores.ret[String(r.h)]} />
      ))}
    </div>

    <TouchCard s={s} />

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
      </div>
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
      <details>
        <summary className="cursor-pointer select-none text-ink-1 font-medium py-1">Jak to sprawdzić samodzielnie</summary>
        <ol className="list-decimal pl-4 mt-1.5 space-y-1 leading-relaxed">
          <li>
            Pliki dzienne: <a className="text-accent hover:underline" href={fileHref('')} target="_blank" rel="noopener noreferrer">gałąź ledger repo danych</a> — jedna linia JSON na
            prognozę albo rozstrzygnięcie.
          </li>
          <li>
            Łańcuch i wyniki: <code className="font-mono text-ink-1">node scripts/verify-ledger.mjs</code> (repo HyperQuant) — niezależna implementacja,
            przelicza hashe i wyniki z rekordów.
          </li>
          <li>
            Kotwica: <code className="font-mono text-ink-1">ots upgrade &lt;dzień&gt;.jsonl.ots</code>, potem{' '}
            <code className="font-mono text-ink-1">ots verify -f &lt;dzień&gt;.jsonl &lt;dzień&gt;.jsonl.ots</code> (klient OpenTimestamps) — potwierdza, że
            plik istniał przed wydobyciem bloku Bitcoina.
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
          title={`Przedział ACI (α = ${r.aci.alpha.toFixed(3)}) — samokorygujący się przedział 90%`}
          style={{ left: x(price(r.aci.lo)), right: `calc(100% - ${x(price(r.aci.hi))})` }}
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
          hint={enough ? `> 0 = lepszy od rozkładu normalnego z 30 dni · n ${sc!.n}` : `od ${MIN_N} rozstrzygnięć (jest ${sc?.n ?? 0})`}
        />
        <Stat
          label="Pokrycie 90%"
          value={<span className="font-mono tabular-nums text-base">{enough ? pct(sc!.cov90?.rate, 1) : DASH}</span>}
          hint={enough && sc!.cov90?.kupiecP !== null && sc!.cov90 ? `test Kupca p = ${sc!.cov90.kupiecP!.toFixed(2)}` : 'nominał 90%'}
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
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
        <Stat
          label="Brier"
          value={<span className="font-mono tabular-nums text-base">{enough && sc.brier !== null ? sc.brier.toFixed(3) : DASH}</span>}
          hint={enough ? `n ${sc.n} · klimatologia ${sc.brierBase?.toFixed(3) ?? DASH}` : `od ${MIN_N} rozstrzygnięć (jest ${sc.n})`}
        />
        <Stat
          label="Umiejętność (BSS)"
          value={<span className="font-mono tabular-nums text-base">{enough ? pct(sc.bss, 1) : DASH}</span>}
          hint="> 0 = lepiej niż stała częstość bazowa"
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
