import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, X } from 'lucide-react';
import { tr, lang } from '../i18n';
import { useDeskLedger } from '../state/useDeskLedger';
import { Badge, DASH, fmtFixed } from '../ui';
import type { ModelCardId } from '../ui/modelCard';
import type { DeskLedgerSummary, RetScores } from '../utils/deskLedger';
import { GROUPS, type Kind, type Row } from '../views/sources/LineageTable';

/**
 * Karta modelu przy plakietce MODEL: metoda, dane, odświeżanie i znane słabości z tabeli pochodzenia (Źródła — jedno
 * źródło opisu), a gdy model jest zapisywany przed faktem — wynik poza próbą z weryfikowalnego rejestru prognoz
 * (liczba rozliczeń, CRPSS, pokrycie przedziałów, Brier i BSS dotknięć) z datą stanu rejestru. Modele bez zapisu mówią to
 * wprost. Bez kierunku i bez porady.
 */

const KIND_TONE = { LIVE: 'live', MODEL: 'model', SIM: 'sim' } as const satisfies Record<Kind, string>;

export function rowFor(id: ModelCardId): Row | null {
  for (const g of GROUPS) for (const r of g.rows) if (r.card === id) return r;
  return null;
}

/** Które rozliczenia rejestru dotyczą modelu (null — model nie jest zapisywany przed faktem). */
export const LEDGER_PART: Partial<Record<ModelCardId, 'ret' | 'ret+touch' | 'market'>> = {
  vol: 'ret',
  mc2h: 'ret',
  ledger: 'ret+touch',
  modelVsMarket: 'market',
};

/** Ocena poza rejestrem desku (inny dziennik), podana słowami z miejscem, gdzie ją widać. */
const OTHER_SCORE: Partial<Record<ModelCardId, string>> = {
  schrodi: tr(
    'Prognozy kota mają osobny dziennik: dowód przewagi, alarm dryfu i kalibracja w Po sesji (dymek kota).',
    'The cat’s forecasts have their own ledger: proof of edge, drift alarm and calibration in Post-session (cat panel).'
  ),
};

const pct = (v: number | null | undefined, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? `${fmtFixed(v * 100, d)}%` : DASH);
const num = (v: number | null | undefined, d = 3) => (typeof v === 'number' && Number.isFinite(v) ? fmtFixed(v, d) : DASH);
const day = (t: number) => new Date(t).toLocaleString(lang === 'en' ? 'en-GB' : 'pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const Line: React.FC<{ label: string; value: string; note?: string }> = ({ label, value, note }) => (
  <div className="flex items-baseline justify-between gap-3 py-1.5">
    <dt className="text-[13px] text-ink-2">{label}</dt>
    <dd className="text-right">
      <span className="font-mono text-[13px] tabular-nums text-ink-1">{value}</span>
      {note && <span className="block text-[11px] text-ink-3">{note}</span>}
    </dd>
  </div>
);

const RetBlock: React.FC<{ h: string; r: RetScores | undefined }> = ({ h, r }) => (
  <div>
    <h4 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{tr(`Rozkład zwrotu · ${h}`, `Return distribution · ${h}`)}</h4>
    {r ? (
      <dl className="divide-y divide-line">
        <Line label={tr('Rozliczone prognozy', 'Settled forecasts')} value={fmtFixed(r.n, 0)} />
        <Line label="CRPSS" value={num(r.crpss)} note={tr('wobec rozkładu normalnego; > 0 lepiej', 'vs a normal benchmark; > 0 is better')} />
        <Line label={tr('Pokrycie przedziału 90%', '90% interval coverage')} value={pct(r.cov90?.rate)} note={r.cov90?.kupiecP != null ? tr(`test Kupca p = ${num(r.cov90.kupiecP, 2)}`, `Kupiec test p = ${num(r.cov90.kupiecP, 2)}`) : undefined} />
        <Line label={tr('Pokrycie przedziału 60%', '60% interval coverage')} value={pct(r.cov60?.rate)} />
      </dl>
    ) : (
      <p className="py-1.5 text-[13px] text-ink-3">{tr('Jeszcze bez rozliczeń tego horyzontu.', 'No settlements for this horizon yet.')}</p>
    )}
  </div>
);

const Scores: React.FC<{ part: 'ret' | 'ret+touch' | 'market'; s: DeskLedgerSummary }> = ({ part, s }) => {
  if (part === 'market') {
    const m = s.market?.scores;
    if (!m) return <p className="text-[13px] text-ink-3">{tr('Rejestr jeszcze bez porównania z rynkiem.', 'The ledger has no market comparison yet.')}</p>;
    return (
      <dl className="divide-y divide-line">
        <Line label={tr('Ocenione pytania', 'Scored questions')} value={fmtFixed(m.n, 0)} note={tr('płynne notowania', 'liquid quotes')} />
        <Line label={tr('Brier modelu', 'Model Brier')} value={num(m.brierModel)} note={tr('niżej lepiej', 'lower is better')} />
        <Line label={tr('Brier rynku', 'Market Brier')} value={num(m.brierMarket)} />
      </dl>
    );
  }
  const t = s.scores.touch;
  return (
    <div className="flex flex-col gap-3">
      <RetBlock h="1 h" r={s.scores.ret['60']} />
      <RetBlock h="4 h" r={s.scores.ret['240']} />
      {part === 'ret+touch' && (
        <div>
          <h4 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{tr('Dotknięcia PDH, D-EQ, PDL w 2 h', 'Touches of PDH, D-EQ, PDL within 2 h')}</h4>
          <dl className="divide-y divide-line">
            <Line label={tr('Rozliczone prognozy', 'Settled forecasts')} value={fmtFixed(t.n, 0)} />
            <Line label="Brier" value={num(t.brier)} note={tr('niżej lepiej', 'lower is better')} />
            {/* BSS zawsze parą: wobec częstości poziomu i wobec odległości (sama częstość zawyża umiejętność) */}
            <Line
              label="BSS"
              value={`${num(t.bssClim ?? t.bss, 2)} / ${num(t.bssDist, 2)}`}
              note={tr('wobec częstości poziomu / wobec odległości', 'vs level base rate / vs distance')}
            />
          </dl>
        </div>
      )}
    </div>
  );
};

/** Karta przy plakietce (komputer) albo od dołu ekranu (telefon). Esc, klik obok i przycisk zamykają; fokus wraca na plakietkę. */
export const KartaModelu: React.FC<{ id: ModelCardId; anchor: HTMLElement; onClose: () => void }> = ({ id, anchor, onClose }) => {
  const row = rowFor(id);
  const part = LEDGER_PART[id] ?? null;
  const ledger = useDeskLedger();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const reduce = useReducedMotion();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const close = () => {
    onClose();
    anchor.focus();
  };

  // Komputer: pod plakietką (albo nad nią, gdy brak miejsca), w granicach okna
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || window.innerWidth < 640) return setPos(null);
    const a = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.min(Math.max(8, a.left), window.innerWidth - w - 8);
    const below = a.bottom + 8;
    const above = a.top - h - 8;
    // Pod plakietką, nad nią, a gdy nigdzie się nie mieści — jak najbliżej niej, dosunięta do dołu okna
    const top = below + h <= window.innerHeight - 8 ? below : above >= 8 ? above : Math.max(8, window.innerHeight - h - 8);
    setPos({ left, top });
  }, [anchor, id, ledger.status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    ref.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  return (
    <motion.div
      ref={ref}
      data-karta-modelu={id}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
      style={pos ? { left: pos.left, top: pos.top } : undefined}
      // Telefon: od dołu nad dolnym paskiem; od 640 px szerokość 420 px i miejsce przy plakietce (do pomiaru niewidoczna)
      className={`fixed z-50 flex flex-col rounded-2xl border border-line-strong bg-surface-1 shadow-2xl outline-none inset-x-2 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] max-h-[70dvh] sm:inset-x-auto sm:bottom-auto sm:w-[420px] sm:max-h-[min(70dvh,640px)] lg:bottom-auto ${
        pos ? '' : 'sm:invisible'
      }`}
    >
      <div className="flex items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{tr('Karta modelu', 'Model card')}</p>
          <h2 id={titleId} className="mt-1 font-display text-lg font-bold leading-tight tracking-tight [font-stretch:90%] text-ink-1">
            {row?.metric ?? tr('Model', 'Model')}
          </h2>
          {row && (
            <span className="mt-2 flex flex-wrap gap-1">
              {row.kinds.map((k) => (
                <Badge key={k} tone={KIND_TONE[k]}>
                  {k}
                </Badge>
              ))}
            </span>
          )}
        </div>
        <button type="button" aria-label={tr('Zamknij kartę modelu', 'Close model card')} onClick={close} className="-mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink-1">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 flex flex-col gap-4 text-[13px] leading-relaxed">
        {row ? (
          <dl className="flex flex-col gap-3">
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{tr('Metoda', 'Method')}</dt>
              <dd className="mt-1 text-ink-1">{row.method}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{tr('Dane', 'Data')}</dt>
              <dd className="mt-1 text-ink-2">{row.source}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{tr('Odświeżanie', 'Refresh')}</dt>
              <dd className="mt-1 text-ink-2">{row.refresh}</dd>
            </div>
            {row.caveat && (
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-warn">{tr('Znane słabości', 'Known weaknesses')}</dt>
                <dd className="mt-1 text-ink-2">{row.caveat}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="text-ink-3">{tr('Brak opisu tego modelu w tabeli pochodzenia.', 'This model has no entry in the lineage table.')}</p>
        )}

        <section aria-labelledby={`${titleId}-wynik`} className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3">
          <h3 id={`${titleId}-wynik`} className="text-sm font-semibold text-ink-1">
            {tr('Wynik poza próbą', 'Out-of-sample score')}
          </h3>
          {part === null ? (
            <p className="text-ink-2">
              {OTHER_SCORE[id] ??
                tr(
                  'Ten model nie jest zapisywany przed faktem w rejestrze prognoz, więc nie ma tu rozliczeń. Traktuj liczbę jako opis, nie jako sprawdzoną prognozę.',
                  'This model is not recorded before the fact in the forecast ledger, so there are no settlements here. Read the number as a description, not as a tested forecast.'
                )}
            </p>
          ) : ledger.summary ? (
            <>
              {id === 'mc2h' && (
                <p className="text-ink-2">
                  {tr(
                    'Sama symulacja nie jest rozliczana; poniżej rozliczenia modelu zmienności, z którego bierze σ i innowacje.',
                    'The simulation itself is not settled; below are the settlements of the volatility model it takes σ and innovations from.'
                  )}
                </p>
              )}
              <Scores part={part} s={ledger.summary} />
              <p className="text-[11px] text-ink-3">
                {tr('Stan rejestru', 'Ledger as of')} {day(ledger.summary.asOf)}
                {ledger.status === 'stale' || ledger.status === 'expired' ? tr(' · dane nieświeże', ' · stale data') : ''}
                {tr(' · zapis przed faktem, łańcuch hashy i kotwica w Bitcoinie', ' · recorded before the fact, hash chain and a Bitcoin anchor')}
              </p>
            </>
          ) : (
            <p className="text-ink-3">
              {ledger.status === 'loading'
                ? tr('Wczytuję rejestr prognoz…', 'Loading the forecast ledger…')
                : ledger.status === 'unconfigured'
                  ? tr('Ta wersja strony nie ma adresu rejestru prognoz.', 'This build has no forecast ledger address.')
                  : tr('Nie udało się pobrać rejestru prognoz.', 'Could not load the forecast ledger.')}
            </p>
          )}
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-[13px]">
        <a
          href={`#sources`}
          onClick={() => {
            onClose();
            // Po przejściu do Źródeł: przewinięcie do wiersza tego modelu w tabeli pochodzenia
            window.setTimeout(() => document.getElementById(`model-${id}`)?.scrollIntoView({ block: 'center' }), 600);
          }}
          className="inline-flex min-h-10 items-center font-medium text-ink-1 underline decoration-line-strong underline-offset-4 hover:decoration-ink-1"
        >
          {tr('Tabela pochodzenia', 'Lineage table')}
        </a>
        {part !== null && part !== 'market' && (
          <a href={tr('./wyniki/', './en/results/')} className="inline-flex min-h-10 items-center gap-1 font-medium text-ink-1 underline decoration-line-strong underline-offset-4 hover:decoration-ink-1">
            {tr('Wyniki prognoz', 'Forecast results')}
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
      </div>
    </motion.div>
  );
};

export default KartaModelu;
