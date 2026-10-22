import React from 'react';
import { useDesk } from '../../state/DeskContext';
import { useDeskLedger } from '../../state/useDeskLedger';
import { useHip4, type Hip4Row } from '../../state/useHip4';
import { poolProb, type EnsWeights } from '../../utils/ensemble';
import { Badge, EmptyState, Panel, DASH, fmtPrice } from '../../ui';

const whenFmt = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
/** Procent: całe punkty (błąd Monte Carlo modelu ~1 pp), przy skrajach jedno miejsce po przecinku */
const pct = (p: number) => `${(p * 100).toFixed(p < 0.05 || p > 0.95 ? 1 : 0)}%`;

/** Ile do terminu: „za 18 h”, „za 3 dni”. */
function until(ms: number): string {
  const h = ms / 3_600_000;
  if (h < 1) return `za ${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `za ${Math.round(h)} h`;
  return `za ${Math.round(h / 24)} dni`;
}

/**
 * Model desku vs rynek predykcyjny Hyperliquid (HIP-4): te same pytania o BTC — cena powyżej progu w terminie i dotknięcie
 * poziomu do terminu. Porównanie kalibracji, nie sygnał.
 */
export const ModelVsMarketPanel: React.FC = () => {
  const { feed } = useDesk();
  const st = useHip4(feed.vol.model, feed.currentPrice);
  // Wagi ensemble z dziennika (dopasowane na rozstrzygniętych 15-minutowych rynkach „mark ≥ K”) — od 50 pytań
  const ledger = useDeskLedger();
  const ens = ledger.status === 'expired' ? null : ledger.summary?.market?.ensemble ?? null;
  const weights = ens && ens.n >= ENS_MIN_N ? ens : null;
  // Tylko pytania wybierane tak samo jak w dzienniku: jedyny rolujący rynek „perp mark ≥ K” z terminem na pełnym kwadransie,
  // 5–10 min przed terminem — wagi dopasowano wyłącznie na takich pytaniach
  const now = st.asOf ?? Date.now();
  const ledgerLike = st.rows.filter(
    (r) =>
      r.q.kind === 'above' &&
      !r.q.recurring &&
      r.q.source === 'mark' &&
      /perp mark/i.test(r.q.description) &&
      r.q.expiry % (15 * 60_000) === 0 &&
      r.q.expiry - now >= 5 * 60_000 &&
      r.q.expiry - now <= 10 * 60_000
  );
  const ensIds = new Set(ledgerLike.filter((r) => ledgerLike.filter((x) => x.q.expiry === r.q.expiry).length === 1).map((r) => r.q.id));
  const [showThin, setShowThin] = React.useState(false);
  const liquid = st.rows.filter((r) => r.quote?.liquid);
  const shown = showThin ? st.rows : liquid;
  return (
    <Panel
      eyebrow="HIP-4 · rynki wynikowe Hyperliquid · te same pytania co model desku"
      title="Model vs rynek"
      actions={
        st.status === 'ready' ? (
          <span className="flex items-center gap-1.5">
            <Badge tone="live" title="Ceny z publicznego arkusza rynków wynikowych Hyperliquid (strona „Yes”)">
              LIVE
            </Badge>
            <Badge tone="model" title="Prawdopodobieństwa z modelu zmienności desku (sezonowy log-HAR + FHS, Monte Carlo)">
              MODEL
            </Badge>
          </span>
        ) : null
      }
    >
      {st.status !== 'ready' ? (
        <EmptyState
          title={st.status === 'loading' ? 'Pobieram rynki wynikowe…' : 'Rynki wynikowe chwilowo niedostępne'}
          detail="Hyperliquid notuje rynki „BTC powyżej K w terminie” i „dotknięcie K do terminu”. Obok ceny rynku — prawdopodobieństwo z modelu desku dla tego samego pytania."
        />
      ) : st.rows.length === 0 ? (
        <EmptyState title="Brak otwartych rynków wynikowych na BTC" detail="Lista odświeża się co 10 minut." />
      ) : (
        <div className="flex flex-col gap-3 p-4">
          <p className="text-xs text-ink-2 leading-relaxed">
            Cena udziału „Tak” (0–1 USDC) obok prawdopodobieństwa z tego samego modelu, który pre-rejestruje prognozy w dzienniku desku. Płynnych
            rynków: <span className="text-ink-1 font-medium">{liquid.length}</span> z {st.rows.length}; przy rzadkim arkuszu cena rynku nic nie mówi
            i jej nie pokazujemy.{' '}
            {st.rows.length > liquid.length && (
              <button type="button" className="text-accent hover:underline" onClick={() => setShowThin((v) => !v)} aria-pressed={showThin}>
                {showThin ? 'Pokaż tylko płynne' : `Pokaż wszystkie (${st.rows.length})`}
              </button>
            )}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">Rynki wynikowe BTC: cena rynku, prawdopodobieństwo modelu i różnica</caption>
              <thead className="text-ink-3 text-[10px] uppercase tracking-wide">
                <tr>
                  <th className="py-1 pr-3 font-medium">Pytanie</th>
                  <th className="py-1 pr-3 font-medium">Termin (UTC)</th>
                  <th className="py-1 pr-3 font-medium">Rynek</th>
                  <th className="py-1 pr-3 font-medium">Model</th>
                  <th className="py-1 pr-3 font-medium" title="Model − środek rynku, w punktach procentowych">Różnica</th>
                  <th
                    className="py-1 font-medium"
                    title="Pooling logarytmiczny modelu i rynku z wagami z weryfikowalnego dziennika — tylko dla 15-minutowych rynków „mark ≥ K”, na których wagi dopasowano"
                  >
                    Ensemble
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <Row key={r.q.id} r={r} now={now} ens={weights && ensIds.has(r.q.id) ? weights : null} />
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-2 text-ink-3">
                      Teraz żaden rynek BTC nie ma płynnego arkusza.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <details className="text-[11px] text-ink-2 leading-relaxed">
            <summary className="cursor-pointer select-none text-ink-1 font-medium py-1">Jak czytać i zastrzeżenia</summary>
            <ul className="mt-1 list-disc pl-4 space-y-1">
              <li>
                Rynek: najlepszy bid–ask strony „Tak” i jego środek; płynny = spread ≤ 5 pp i co najmniej 50 USDC w zleceniach do ±5 pp od środka po
                obu stronach (pojedyncze małe zlecenie nie ustala ceny). Cena rynku to nie czyste prawdopodobieństwo — zawiera premię za ryzyko i koszt
                kapitału.
              </li>
              <li>
                Model: 2000 ścieżek log-ceny z σ sezonowego log-HAR i innowacjami FHS (krok 5 min do doby, 15 min do 3 dni, 60 min dalej; horyzont
                dokładny co do minuty), cena jako martyngał — bez założenia kierunku. Dotknięcie z dokładnym ekstremum mostu Browna między krokami. Błąd
                Monte Carlo ok. ±1 pp, dlatego różnica w pełnych punktach. Ponad 14 dni — „—”.
              </li>
              <li>
                Źródła cen rozliczenia różnią się: rynek dzienny i dotknięcia — mark BTC z HyperCore, drabinki „binaryPrice” — cena Pyth, mark albo cena
                transakcji perpa HL; opis rynku podaje też okno w sekundach, którego dokładne znaczenie nie jest oficjalnie udokumentowane. Model liczy na
                świecach Hyperliquid — przy kilku minutach do terminu te różnice mają znaczenie.
              </li>
              <li>
                Ensemble: logit p = a + b·logit(model) + c·logit(rynek), wagi dopasowane w weryfikowalnym dzienniku wyłącznie na wcześniej rozstrzygniętych
                15-minutowych pytaniach „mark ≥ K” (pooling logarytmiczny, prior w stronę równych wag). Pokazywane tylko dla pytania wybieranego tak
                samo jak w dzienniku (jedyny rolujący rynek „perp mark” z terminem na pełnym kwadransie, 5–10 min przed terminem), od {ENS_MIN_N}{' '}
                rozstrzygniętych pytań — dla innych terminów i źródeł wagi nie były sprawdzane.
              </li>
              <li>Różnica model − rynek to porównanie kalibracji dwóch źródeł prawdopodobieństwa, nie sygnał kupna ani sprzedaży.</li>
            </ul>
          </details>
        </div>
      )}
    </Panel>
  );
};

/** Ensemble od tylu rozstrzygniętych pytań (wcześniej wagi startowe, bez informacji z danych) */
const ENS_MIN_N = 50;

const Row: React.FC<{ r: Hip4Row; now: number; ens: EnsWeights | null }> = ({ r, now, ens }) => {
  const { q, quote, model } = r;
  const ensOk = ens !== null;
  const label = q.kind === 'above' ? `BTC > ${fmtPrice(q.K, 0)}` : `dotknie ${fmtPrice(q.K, 0)}`;
  const src = q.source === 'pyth' ? 'Pyth' : q.source === 'trade' ? 'transakcja HL' : q.source === 'mark' ? 'mark HL' : 'inne źródło';
  const mid = quote?.liquid ? quote.mid : null;
  const diff = mid !== null && model !== null ? model - mid : null;
  return (
    <tr className="border-t border-line align-baseline">
      <td className="py-1.5 pr-3">
        <span className="text-ink-1 font-mono tabular-nums">{label}</span>{' '}
        <span className="text-[10px] text-ink-3">
          {src}
          {q.recurring ? ' · dzienny' : ''}
        </span>
      </td>
      <td className="py-1.5 pr-3 whitespace-nowrap text-ink-2">
        {whenFmt.format(q.expiry)} <span className="text-[10px] text-ink-3">{until(q.expiry - now)}</span>
      </td>
      <td className="py-1.5 pr-3 whitespace-nowrap font-mono tabular-nums">
        {!r.bookOk ? (
          <span className="text-warn font-sans">błąd pobierania</span>
        ) : !quote ? (
          <span className="text-ink-3 font-sans">brak notowania</span>
        ) : quote.liquid ? (
          <>
            <span className="text-ink-1">{pct(quote.mid)}</span>{' '}
            <span className="text-[10px] text-ink-3">
              {pct(quote.bid)}–{pct(quote.ask)}
            </span>
          </>
        ) : (
          <span className="text-ink-3 font-sans" title={`bid ${quote.bid} · ask ${quote.ask}`}>
            arkusz rzadki
          </span>
        )}
      </td>
      <td className="py-1.5 pr-3 font-mono tabular-nums text-ink-1">{model === null ? DASH : pct(model)}</td>
      <td className="py-1.5 pr-3 font-mono tabular-nums text-ink-2">
        {diff === null ? DASH : Math.round(Math.abs(diff * 100)) === 0 ? '0 pp' : `${diff >= 0 ? '+' : '−'}${Math.round(Math.abs(diff * 100))} pp`}
      </td>
      <td className="py-1.5 font-mono tabular-nums text-ink-1">{ensOk && mid !== null && model !== null ? pct(poolProb(ens!, model, mid)) : DASH}</td>
    </tr>
  );
};
