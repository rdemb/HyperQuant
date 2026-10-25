import React from 'react';
import { useDesk } from '../../state/DeskContext';
import { useDeskLedger } from '../../state/useDeskLedger';
import { useHip4, type Hip4Row } from '../../state/useHip4';
import { poolProb, type EnsWeights } from '../../utils/ensemble';
import { Badge, EmptyState, Panel, DASH, fmtPrice, fmtFixed } from '../../ui';
import { lang, locale, tr } from '../../i18n';

const whenFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
/** Procent: całe punkty (błąd Monte Carlo modelu ~1 pp), przy skrajach jedno miejsce po przecinku */
const pct = (p: number) => `${fmtFixed(p * 100, p < 0.05 || p > 0.95 ? 1 : 0)}%`;

/** Ile do terminu: „za 18 h”, „za 3 dni”. */
function until(ms: number): string {
  const h = ms / 3_600_000;
  if (h < 1) return tr(`za ${Math.max(1, Math.round(h * 60))} min`, `in ${Math.max(1, Math.round(h * 60))} min`);
  if (h < 48) return tr(`za ${Math.round(h)} h`, `in ${Math.round(h)} h`);
  return tr(`za ${Math.round(h / 24)} dni`, `in ${Math.round(h / 24)} days`);
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
      eyebrow={tr('HIP-4 · rynki wynikowe Hyperliquid · te same pytania co model desku', 'HIP-4 · Hyperliquid outcome markets · the same questions as the desk model')}
      title={tr('Model vs rynek', 'Model vs market')}
      actions={
        st.status === 'ready' ? (
          <span className="flex items-center gap-1.5">
            <Badge tone="live" title={tr('Ceny z publicznego arkusza rynków wynikowych Hyperliquid (strona „Yes”)', 'Prices from the public Hyperliquid outcome market book ("Yes" side)')}>
              LIVE
            </Badge>
            <Badge tone="model" title={tr('Prawdopodobieństwa z modelu zmienności desku (sezonowy log-HAR + FHS, Monte Carlo)', 'Probabilities from the desk volatility model (seasonal log-HAR + FHS, Monte Carlo)')}>
              MODEL
            </Badge>
          </span>
        ) : null
      }
    >
      {st.status !== 'ready' ? (
        <EmptyState
          title={st.status === 'loading' ? tr('Pobieram rynki wynikowe…', 'Loading outcome markets…') : tr('Rynki wynikowe chwilowo niedostępne', 'Outcome markets temporarily unavailable')}
          detail={tr(
            'Hyperliquid notuje rynki „BTC powyżej K w terminie” i „dotknięcie K do terminu”. Obok ceny rynku — prawdopodobieństwo z modelu desku dla tego samego pytania.',
            'Hyperliquid lists "BTC above K at expiry" and "touch K before expiry" markets. Next to the market price: the probability from the desk model for the same question.'
          )}
        />
      ) : st.rows.length === 0 ? (
        <EmptyState title={tr('Brak otwartych rynków wynikowych na BTC', 'No open BTC outcome markets')} detail={tr('Lista odświeża się co 10 minut.', 'The list refreshes every 10 minutes.')} />
      ) : (
        <div className="flex flex-col gap-3 p-4">
          <p className="text-xs text-ink-2 leading-relaxed">
            {tr(
              <>
                Cena udziału „Tak” (0–1 USDC) obok prawdopodobieństwa z tego samego modelu, który pre-rejestruje prognozy w dzienniku desku. Płynnych
                rynków: <span className="text-ink-1 font-medium">{liquid.length}</span> z {st.rows.length}; przy rzadkim arkuszu cena rynku nic nie
                mówi i jej nie pokazujemy.
              </>,
              <>
                Price of a "Yes" share (0–1 USDC) next to the probability from the same model that pre-registers forecasts in the desk ledger. Liquid
                markets: <span className="text-ink-1 font-medium">{liquid.length}</span> of {st.rows.length}; with a thin book the market price says
                nothing, so we do not show it.
              </>
            )}{' '}
            {st.rows.length > liquid.length && (
              <button type="button" className="text-accent hover:underline" onClick={() => setShowThin((v) => !v)} aria-pressed={showThin}>
                {showThin ? tr('Pokaż tylko płynne', 'Show liquid only') : tr(`Pokaż wszystkie (${st.rows.length})`, `Show all (${st.rows.length})`)}
              </button>
            )}
          </p>
          <div className="overflow-x-auto hq-scroll-cue">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">{tr('Rynki wynikowe BTC: cena rynku, prawdopodobieństwo modelu i różnica', 'BTC outcome markets: market price, model probability and the difference')}</caption>
              <thead className="text-ink-3 text-[10px] uppercase tracking-wide">
                <tr>
                  <th className="py-1 pr-3 font-medium">{tr('Pytanie', 'Question')}</th>
                  <th className="py-1 pr-3 font-medium">{tr('Termin (UTC)', 'Expiry (UTC)')}</th>
                  <th className="py-1 pr-3 font-medium">{tr('Rynek', 'Market')}</th>
                  <th className="py-1 pr-3 font-medium">Model</th>
                  <th className="py-1 pr-3 font-medium" title={tr('Model − środek rynku, w punktach procentowych', 'Model − market mid, in percentage points')}>
                    {tr('Różnica', 'Difference')}
                  </th>
                  <th
                    className="py-1 font-medium"
                    title={tr(
                      'Pooling logarytmiczny modelu i rynku z wagami z weryfikowalnego dziennika — tylko dla 15-minutowych rynków „mark ≥ K”, na których wagi dopasowano',
                      'Logarithmic pooling of model and market with weights from the verifiable ledger; only for the 15-minute "mark ≥ K" markets the weights were fitted on'
                    )}
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
                      {tr('Teraz żaden rynek BTC nie ma płynnego arkusza.', 'No BTC market has a liquid book right now.')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <details className="text-[11px] text-ink-2 leading-relaxed">
            <summary className="cursor-pointer select-none text-ink-1 font-medium py-1">{tr('Jak czytać i zastrzeżenia', 'How to read it and caveats')}</summary>
            {lang === 'en' ? (
              <ul className="mt-1 list-disc pl-4 space-y-1">
                <li>
                  Market: the best bid–ask of the "Yes" side and its mid; liquid = spread ≤ 5 pp and at least 50 USDC in orders within ±5 pp of the mid on
                  both sides (a single small order does not set the price). The market price is not a pure probability; it includes a risk premium and the
                  cost of capital.
                </li>
                <li>
                  Model: 2000 log-price paths with σ from the seasonal log-HAR and FHS innovations (5 min step up to a day, 15 min up to 3 days, 60 min
                  beyond; horizon exact to the minute), price as a martingale with no assumed direction. Touch uses the exact Brownian bridge extreme between
                  steps. Monte Carlo error is about ±1 pp, hence the difference in whole points. Beyond 14 days: "—".
                </li>
                <li>
                  Settlement price sources differ: the daily market and touches use the BTC mark from HyperCore, the "binaryPrice" ladders use the Pyth
                  price, the mark or the HL perp trade price; the market description also gives a window in seconds whose exact meaning is not officially
                  documented. The model computes on Hyperliquid candles; with a few minutes to expiry these differences matter.
                </li>
                <li>
                  Ensemble: logit p = a + b·logit(model) + c·logit(market), weights fitted in the verifiable ledger only on previously settled 15-minute "mark
                  ≥ K" questions (logarithmic pooling, prior towards equal weights). Shown only for the question selected the same way as in the ledger (the
                  single rolling "perp mark" market expiring on a full quarter hour, 5–10 min before expiry), from {ENS_MIN_N} settled questions; for other
                  expiries and sources the weights were not tested.
                </li>
                <li>The model − market difference compares the calibration of two probability sources; it is not a buy or sell signal.</li>
              </ul>
            ) : (
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
            )}
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
  const label = q.kind === 'above' ? `BTC > ${fmtPrice(q.K, 0)}` : `${tr('dotknie', 'touches')} ${fmtPrice(q.K, 0)}`;
  const src = q.source === 'pyth' ? 'Pyth' : q.source === 'trade' ? tr('transakcja HL', 'HL trade') : q.source === 'mark' ? 'mark HL' : tr('inne źródło', 'other source');
  const mid = quote?.liquid ? quote.mid : null;
  const diff = mid !== null && model !== null ? model - mid : null;
  return (
    <tr className="border-t border-line align-baseline">
      <td className="py-1.5 pr-3">
        <span className="text-ink-1 font-mono tabular-nums">{label}</span>{' '}
        <span className="text-[10px] text-ink-3">
          {src}
          {q.recurring ? tr(' · dzienny', ' · daily') : ''}
        </span>
      </td>
      <td className="py-1.5 pr-3 whitespace-nowrap text-ink-2">
        {whenFmt.format(q.expiry)} <span className="text-[10px] text-ink-3">{until(q.expiry - now)}</span>
      </td>
      <td className="py-1.5 pr-3 whitespace-nowrap font-mono tabular-nums">
        {!r.bookOk ? (
          <span className="text-warn font-sans">{tr('błąd pobierania', 'fetch error')}</span>
        ) : !quote ? (
          <span className="text-ink-3 font-sans">{tr('brak notowania', 'no quote')}</span>
        ) : quote.liquid ? (
          <>
            <span className="text-ink-1">{pct(quote.mid)}</span>{' '}
            <span className="text-[10px] text-ink-3">
              {pct(quote.bid)}–{pct(quote.ask)}
            </span>
          </>
        ) : (
          <span className="text-ink-3 font-sans" title={`bid ${quote.bid} · ask ${quote.ask}`}>
            {tr('arkusz rzadki', 'thin book')}
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
