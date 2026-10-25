import React, { useEffect, useState } from 'react';
import { useFolkloreLab } from '../../state/useFolkloreLab';
import { DATA_BASE } from '../../state/usePublished';
import { Badge, EmptyState, Panel, DASH, fmtSigned, fmtFixed, numLang } from '../../ui';
import { canonical, sha256Hex } from '../../utils/canonical';
import { LAB_CATALOG, LAB_RULE_EN, LAB_RULES, LAB_TEXT, type FwdVerdict, type HistVerdict, type LabHypResult, type LabReport } from '../../utils/folkloreLab';
import { lang, locale, tr } from '../../i18n';

const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const CATALOG = new Map(LAB_CATALOG.hypotheses.map((h) => [h.id, h]));

/** Punkty procentowe ze znakiem; null → „—” */
const pp = (v: number | null, d = 1) => (v === null ? DASH : fmtSigned(v * 100, d, ' pp'));
const pct = (v: number | null) => (v === null ? DASH : `${fmtFixed(v * 100, 0)}%`);
const fmtE = (e: number) => (e >= 1000 ? e.toExponential(1).replace('e+', 'e') : e >= 10 ? fmtFixed(e, 0) : fmtFixed(e, 2));
const fmtQ = (q: number | null) => (q === null ? DASH : q < 0.001 ? numLang('<0.001') : fmtFixed(q, 3));

const HIST_LABEL: Record<HistVerdict, { text: string; cls: string; folk: string; ctrl: string }> = {
  support: {
    text: tr('wspiera', 'supports'),
    cls: 'text-accent',
    folk: tr('Efekt zgodny z tezą, q ≤ 10% po korekcie FDR (eksploracyjnie)', 'Effect in line with the claim, q ≤ 10% after FDR correction (exploratory)'),
    ctrl: tr('Efekt zgodny z oczekiwanym, p ≤ 10%', 'Effect as expected, p ≤ 10%'),
  },
  against: {
    text: tr('przeczy', 'contradicts'),
    cls: 'text-warn',
    folk: tr('Efekt przeciwny do tezy, q ≤ 10% po korekcie FDR (eksploracyjnie)', 'Effect opposite to the claim, q ≤ 10% after FDR correction (exploratory)'),
    ctrl: tr('Efekt przeciwny, p ≤ 10%', 'Opposite effect, p ≤ 10%'),
  },
  none: {
    text: tr('brak dowodu', 'no evidence'),
    cls: 'text-ink-2',
    folk: tr('Brak efektu istotnego po korekcie FDR — to nie dowód braku efektu', 'No significant effect after FDR correction; this is not proof of no effect'),
    ctrl: tr('Brak efektu istotnego (p > 10%)', 'No significant effect (p > 10%)'),
  },
  few: {
    text: tr('za mało', 'too few'),
    cls: 'text-ink-3',
    folk: tr(`Mniej niż ${LAB_RULES.minHist} zdarzeń — bez werdyktu`, `Fewer than ${LAB_RULES.minHist} events; no verdict`),
    ctrl: tr(`Mniej niż ${LAB_RULES.minHist} zdarzeń — bez werdyktu`, `Fewer than ${LAB_RULES.minHist} events; no verdict`),
  },
};
const FWD_LABEL: Record<FwdVerdict, { text: string; cls: string; folk: string; ctrl: string }> = {
  confirmed: {
    text: tr('potwierdzona', 'confirmed'),
    cls: 'text-accent',
    folk: tr('e-BH: e-wartość za tezą przekroczyła próg (FDR potwierdzeń ≤ 5%)', 'e-BH: the e-value for the claim crossed the threshold (FDR of confirmations ≤ 5%)'),
    ctrl: tr(`e-wartość ≥ ${1 / LAB_RULES.alphaFamily} (pojedynczy test na 5%)`, `e-value ≥ ${1 / LAB_RULES.alphaFamily} (single test at 5%)`),
  },
  against: {
    text: tr('obalona', 'refuted'),
    cls: 'text-warn',
    folk: tr('e-BH: e-wartość przeciw tezie przekroczyła próg (FDR obaleń ≤ 5%)', 'e-BH: the e-value against the claim crossed the threshold (FDR of refutations ≤ 5%)'),
    ctrl: tr(`e-wartość przeciw ≥ ${1 / LAB_RULES.alphaFamily} (pojedynczy test na 5%)`, `e-value against ≥ ${1 / LAB_RULES.alphaFamily} (single test at 5%)`),
  },
  excluded: {
    text: tr(`efekt < ±${LAB_RULES.csExclude * 100} pp`, `effect < ±${LAB_RULES.csExclude * 100} pp`),
    cls: 'text-ink-1',
    folk: tr('Cała sekwencja ufności 90% w wąskim pasie wokół zera (przy założeniu stałego efektu)', 'The whole 90% confidence sequence lies in a narrow band around zero (assuming a constant effect)'),
    ctrl: tr('Cała sekwencja ufności 90% w wąskim pasie wokół zera (przy założeniu stałego efektu)', 'The whole 90% confidence sequence lies in a narrow band around zero (assuming a constant effect)'),
  },
  collecting: {
    text: tr('zbieram dane', 'collecting'),
    cls: 'text-ink-3',
    folk: tr('Za mało dowodów w żadną stronę — wynik ważny przy każdym podglądzie', 'Not enough evidence either way; the result stays valid at every peek'),
    ctrl: tr('Za mało dowodów w żadną stronę', 'Not enough evidence either way'),
  },
};

/** Próg e-wartości, gdy odrzucana jest jedna reguła z rodziny (e-BH: K/(α·k) dla k = 1) */
const E_THRESHOLD_ONE = LAB_CATALOG.hypotheses.filter((h) => h.family === 'folklore').length / LAB_RULES.alphaFamily;

/** Plik w przeglądarce GitHuba dla gałęzi repo danych (raw.githubusercontent.com), inaczej bezpośredni adres. */
function branchHref(branch: string, rel = ''): string {
  const m = DATA_BASE.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/[^/]+$/);
  return m ? `https://github.com/${m[1]}/${m[2]}/tree/${branch}/${rel}` : `${DATA_BASE.replace(/\/main$/, `/${branch}`)}/${rel}`;
}

/** Hash katalogu w tej wersji strony (WebCrypto) — porównanie z zarejestrowanym; null = jeszcze liczony / brak WebCrypto. */
function useBundledCatalogHash(): string | null {
  const [h, setH] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    sha256Hex(canonical(LAB_CATALOG))
      .then((x) => live && setH(x))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return h;
}

/** Efekt z przedziałem 90% na wspólnej skali ±20 pp (poza skalą — strzałka przy krawędzi). */
const EffectBar: React.FC<{ eff: number | null; lo: number | null; hi: number | null; strong: boolean }> = ({ eff, lo, hi, strong }) => {
  const W = 132;
  const H = 18;
  const R = 0.2;
  const x = (v: number) => ((Math.max(-R, Math.min(R, v)) + R) / (2 * R)) * (W - 8) + 4;
  if (eff === null) return <span className="text-ink-3 text-xs">{DASH}</span>;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tr(`Efekt ${pp(eff)}, przedział 90% od ${pp(lo)} do ${pp(hi)}`, `Effect ${pp(eff)}, 90% interval from ${pp(lo)} to ${pp(hi)}`)} className={strong ? 'text-accent' : 'text-ink-2'}>
      <line x1={x(0)} x2={x(0)} y1={1} y2={H - 1} stroke="var(--color-line-strong)" strokeWidth={1} />
      {lo !== null && hi !== null && <line x1={x(lo)} x2={x(hi)} y1={H / 2} y2={H / 2} stroke="currentColor" strokeWidth={2} strokeLinecap="round" opacity={0.55} />}
      {Math.abs(eff) > R ? (
        // Poza skalą: strzałka przy krawędzi zamiast punktu udającego ±20 pp
        <path d={eff > 0 ? `M${W - 9},${H / 2 - 5}L${W - 2},${H / 2}L${W - 9},${H / 2 + 5}Z` : `M9,${H / 2 - 5}L2,${H / 2}L9,${H / 2 + 5}Z`} fill="currentColor" />
      ) : (
        <circle cx={x(eff)} cy={H / 2} r={4} fill="currentColor" stroke="var(--color-surface-1)" strokeWidth={2} />
      )}
    </svg>
  );
};

/** Mały wykres liniowy z opcjonalną linią odniesienia (przerywana) — wartości po kolei, bez osi czasu. */
const MiniChart: React.FC<{ values: number[]; refLine?: number; refLabel?: string; zero?: boolean; ariaLabel: string }> = ({ values, refLine, refLabel, zero, ariaLabel }) => {
  const W = 220;
  const H = 64;
  if (values.length < 2) return <div className="text-ink-3 text-xs h-16 flex items-center">{DASH}</div>;
  const all = [...values, ...(refLine !== undefined ? [refLine] : []), ...(zero ? [0] : [])];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const x = (i: number) => 4 + (i / (values.length - 1)) * (W - 8);
  const y = (v: number) => 4 + (1 - (v - min) / span) * (H - 8);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="text-accent shrink-0">
      {zero && <line x1={4} x2={W - 4} y1={y(0)} y2={y(0)} stroke="var(--color-line-strong)" strokeWidth={1} />}
      {refLine !== undefined && (
        <>
          <line x1={4} x2={W - 4} y1={y(refLine)} y2={y(refLine)} stroke="var(--color-warn)" strokeWidth={1} strokeDasharray="4 3" />
          {refLabel && (
            <text x={W - 6} y={y(refLine) < 14 ? y(refLine) + 11 : y(refLine) - 3} textAnchor="end" fontSize={9} fill="var(--color-ink-3)">
              {refLabel}
            </text>
          )}
        </>
      )}
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

export const FolkloreLabPanel: React.FC = () => {
  const { status, report } = useFolkloreLab();
  if (status === 'unconfigured') return null;
  const badge =
    status === 'ready' ? (
      <Badge tone="live" title={tr('Przeliczane co godzinę ze świec Hyperliquid (archiwum skanera)', 'Recomputed hourly from Hyperliquid candles (scanner archive)')}>
        LIVE
      </Badge>
    ) : status === 'stale' ? (
      <Badge tone="stale" title={tr('Raport starszy niż 3 h', 'Report older than 3 h')}>
        STALE
      </Badge>
    ) : null;
  return (
    <Panel eyebrow={tr('Prerejestracja · e-wartości · kontrola FDR', 'Pre-registration · e-values · FDR control')} title={tr('Laboratorium folkloru', 'Folklore lab')} actions={badge}>
      {!report ? (
        <EmptyState
          title={status === 'loading' ? tr('Pobieram wyniki laboratorium…', 'Loading lab results…') : tr('Laboratorium chwilowo niedostępne', 'Lab temporarily unavailable')}
          detail={tr(
            'Popularne reguły day tradingu BTC testowane uczciwie: z hipotezą zerową, korektą na wiele testów i prerejestrowaną oceną do przodu.',
            'Popular BTC day trading rules tested honestly: with a null hypothesis, a multiple-testing correction and a pre-registered forward evaluation.'
          )}
        />
      ) : (
        <LabBody r={report} stale={status === 'stale'} />
      )}
    </Panel>
  );
};

const LabBody: React.FC<{ r: LabReport; stale: boolean }> = ({ r, stale }) => {
  const [open, setOpen] = useState<string | null>(null);
  const bundled = useBundledCatalogHash();
  const folk = r.hypotheses.filter((h) => h.family === 'folklore');
  const ctrl = r.hypotheses.filter((h) => h.family === 'control');
  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-xs text-ink-2 leading-relaxed">
        {tr(
          <>
            Reguły barierowe (poziomy, PDH/PDL, IB, VWAP, luka CME, finansowanie) to zdarzenia z dwiema barierami: tą, którą przewiduje folklor, i przeciwną.
            Gdyby cena była martyngałem (bez przewidywalnego kierunku), sukces zdarzałby się dokładnie z prawdopodobieństwem p0 wynikającym z odległości do
            barier (twierdzenie o opcjonalnym zatrzymaniu), niezależnie od kształtu rozkładu ruchów. Reguły kalendarzowe (10:00 w Nowym Jorku, momentum, weekend)
            mają p0 = 50% z symetrii znaku albo wymienialności dni. <span className="text-ink-1">Efekt</span> to nadwyżka sukcesów ponad p0. Historia to
            eksploracja z korektą FDR. Rozstrzyga ocena do przodu: katalog reguł zapisano w weryfikowalnym dzienniku, zanim pojawiły się oceniane dane, a
            e-wartości pozostają ważne przy każdym podglądzie.
          </>,
          <>
            Barrier rules (levels, PDH/PDL, IB, VWAP, CME gap, funding) are events with two barriers: the one folklore predicts and the opposite one. If price
            were a martingale (no predictable direction), success would happen exactly with the probability p0 implied by the distances to the barriers
            (optional stopping theorem), whatever the shape of the move distribution. Calendar rules (10:00 in New York, momentum, weekend) have p0 = 50% from
            sign symmetry or exchangeability of days. <span className="text-ink-1">Effect</span> is the excess of successes over p0. History is exploration with
            FDR correction. The forward evaluation decides: the rule catalog was written to the verifiable ledger before the evaluated data existed, and
            e-values stay valid at every peek.
          </>
        )}
        {stale && (
          <span className="text-warn">
            {' '}
            {tr('Ostatnie przeliczenie', 'Last recomputed')} {dateTimeFmt.format(r.asOf)}.
          </span>
        )}
      </p>

      {bundled !== null && bundled !== r.catalogHash && (
        <div role="status" className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          {tr(
            'Definicje reguł w tej wersji strony różnią się od katalogu, dla którego policzono wyniki (strona albo skaner zaktualizowane w innym momencie). Opisy mogą nie odpowiadać liczbom do czasu aktualizacji obu stron.',
            'The rule definitions in this version of the page differ from the catalog the results were computed for (the page or the scanner was updated at a different moment). Descriptions may not match the numbers until both sides are updated.'
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-md border border-line bg-surface-2/50 px-3 py-2 text-xs text-ink-2">
        <span>
          {tr('Katalog', 'Catalog')} <span className="font-mono text-ink-1">{r.version}</span> · hash{' '}
          <code className="font-mono text-ink-1" title={r.catalogHash}>
            {r.catalogHash.slice(0, 12)}…
          </code>
        </span>
        {r.registeredAt !== null ? (
          <>
            <span title={r.registrationHash ? tr(`Hash linii rekordu prerejestracji w łańcuchu: ${r.registrationHash}`, `Hash of the pre-registration record line in the chain: ${r.registrationHash}`) : undefined}>
              {tr('zapisany w dzienniku', 'written to the ledger')} <span className="text-ink-1">{dateTimeFmt.format(r.registeredAt)}</span>
              {r.registrationHash && (
                <>
                  {' '}
                  ({tr('linia', 'line')} <code className="font-mono text-ink-1">{r.registrationHash.slice(0, 12)}…</code>)
                </>
              )}
            </span>
            <span title={tr('24 h karencji — pokwitowanie OpenTimestamps w bloku Bitcoina powstaje z opóźnieniem', '24 h grace period: the OpenTimestamps receipt in a Bitcoin block arrives with a delay')}>
              {tr('ocena do przodu od', 'forward evaluation from')} <span className="text-ink-1">{r.forwardFrom !== null ? dateTimeFmt.format(r.forwardFrom) : DASH}</span>
            </span>
          </>
        ) : (
          <span className="text-warn">{tr('czeka na zapis w dzienniku — ocena do przodu jeszcze nie ruszyła', 'waiting for the ledger entry; the forward evaluation has not started yet')}</span>
        )}
        <span>
          {tr('świece 1h od', '1h candles from')} <span className="text-ink-1">{r.data.hourlyFrom !== null ? dateFmt.format(r.data.hourlyFrom) : DASH}</span>
        </span>
      </div>

      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full min-w-[760px] text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-ink-3">
              <th className="text-left font-medium pb-1" rowSpan={2}>
                {tr('Reguła', 'Rule')}
              </th>
              <th className="text-center font-medium pb-1 border-b border-line" colSpan={5}>
                {tr('Historia (eksploracja)', 'History (exploration)')}
              </th>
              <th className="text-center font-medium pb-1 border-b border-line" colSpan={3}>
                {tr('Do przodu (prerejestracja)', 'Forward (pre-registered)')}
              </th>
            </tr>
            <tr className="text-[10px] uppercase tracking-wide text-ink-3">
              <th className="text-right font-medium py-1 px-2" title={tr('Zdarzenia (bez nakładania się)', 'Events (non-overlapping)')}>
                n
              </th>
              <th className="text-right font-medium py-1 px-2 whitespace-nowrap" title={tr('Odsetek sukcesów vs oczekiwany pod hipotezą zerową', 'Success rate vs the rate expected under the null hypothesis')}>
                {tr('sukces / p0', 'success / p0')}
              </th>
              <th className="text-left font-medium py-1 px-2" title={tr('Efekt z przedziałem 90%, skala ±20 pp', 'Effect with a 90% interval, ±20 pp scale')}>
                {tr('efekt', 'effect')}
              </th>
              <th className="text-right font-medium py-1 px-2" title={tr('Reguły: q-wartość Benjaminiego–Hochberga w rodzinie 10 reguł; kontrole: p-wartość', 'Rules: Benjamini–Hochberg q-value in the family of 10 rules; controls: p-value')}>
                q / p
              </th>
              <th className="text-left font-medium py-1 px-2">{tr('werdykt', 'verdict')}</th>
              <th className="text-right font-medium py-1 px-2">n</th>
              <th
                className="text-right font-medium py-1 px-2"
                title={tr(
                  `e-wartość za tezą; próg dla jednej reguły ${E_THRESHOLD_ONE}, dla kontroli ${1 / LAB_RULES.alphaFamily}`,
                  `e-value for the claim; threshold for one rule ${E_THRESHOLD_ONE}, for controls ${1 / LAB_RULES.alphaFamily}`
                )}
              >
                e
              </th>
              <th className="text-left font-medium py-1 px-2">{tr('werdykt', 'verdict')}</th>
            </tr>
          </thead>
          <tbody>
            {folk.map((h) => (
              <Row key={h.id} h={h} open={open === h.id} onToggle={() => setOpen(open === h.id ? null : h.id)} />
            ))}
            <tr>
              <td colSpan={9} className="pt-3 pb-1 text-[10px] uppercase tracking-wide text-ink-3">
                {tr('Kontrole metody (poza rodziną FDR: p-wartość i pojedynczy test na 5%)', 'Method controls (outside the FDR family: p-value and a single test at 5%)')}
              </td>
            </tr>
            {ctrl.map((h) => (
              <Row key={h.id} h={h} open={open === h.id} onToggle={() => setOpen(open === h.id ? null : h.id)} />
            ))}
          </tbody>
        </table>
      </div>

      <details className="text-xs text-ink-2">
        <summary className="cursor-pointer select-none text-ink-1 font-medium py-1">{tr('Metoda i samodzielna weryfikacja', 'Method and self-verification')}</summary>
        {lang === 'en' ? (
          <ul className="list-disc pl-4 mt-1.5 space-y-1 leading-relaxed">
            <li>
              An event starts at the close of the 1h candle that triggered it. The path to the barriers comes from the high/low of the following candles. A candle
              touching both barriers is ambiguous and is discarded. Such discarding is neutral only when moves are symmetric, so every barrier rule needs a band
              of at least {LAB_RULES.minBandRanges} × the median hourly range and ambiguous events are rare. At the time limit the result is fractional: the
              martingale value at the last close, whose expected value under H0 is still p0. Events of one rule do not overlap.
            </li>
            <li>
              History: two-sided p-value from a normal approximation with the variance under H0, Benjamini–Hochberg q-values in the family of 10 rules, verdict
              from {LAB_RULES.minHist} events. This is exploration: the definitions were written after looking at the past.
            </li>
            <li>
              Forward, only events that started at least {LAB_RULES.forwardGraceH} h after the catalog was written to the ledger count. The proof that it was
              written before the data is the hash chain with an OpenTimestamps receipt. The catalog also contains a control vector, the hash of the whole
              engine's output on fixed test data, so a code change needs a new version and a new registration. The betting process (Waudby-Smith and Ramdas
              2023) gives an e-value valid at arbitrarily frequent peeks (Ville's inequality). e-BH (Wang and Ramdas 2022) runs separately for confirmations and
              refutations, each family at 5%, together FDR ≤ 10% under any dependence between rules. The 90% confidence sequence bounds the effect size,
              assuming it is constant.
            </li>
            <li>
              Source data:{' '}
              <a className="text-accent hover:underline" href={branchHref('archive', 'BTC')} target="_blank" rel="noopener noreferrer">
                archive branch
              </a>{' '}
              (candles and funding in CSV). The pre-registration record (<code className="font-mono text-ink-1">k: &quot;p&quot;</code>, the full catalog and its
              hash) is in the{' '}
              <a className="text-accent hover:underline" href={branchHref('ledger', 'BTC')} target="_blank" rel="noopener noreferrer">
                ledger branch
              </a>{' '}
              and is checked by <code className="font-mono text-ink-1">scripts/verify-ledger.mjs</code>. The file{' '}
              <code className="font-mono text-ink-1">lab/BTC.json</code> contains all forward events, from which anyone can recompute the e-values.
            </li>
            <li>This is a statistical measurement, not a trading signal. A “confirmed” rule only says the effect exists. It does not say it pays after costs.</li>
          </ul>
        ) : (
          <ul className="list-disc pl-4 mt-1.5 space-y-1 leading-relaxed">
            <li>
              Zdarzenie startuje na zamknięciu świecy 1h, która je wywołała. Ścieżka do barier pochodzi z high/low kolejnych świec. Świeca dotykająca obu barier
              jest niejednoznaczna i zostaje odrzucona. Takie odrzucenie jest neutralne tylko przy symetrii ruchów, dlatego każda reguła barierowa wymaga pasma co
              najmniej {LAB_RULES.minBandRanges} × mediana zakresu godziny i niejednoznaczne zdarzenia są rzadkie. Przy limicie czasu wynik jest ułamkowy: wartość
              martyngału z ostatniego zamknięcia, której oczekiwana wartość pod H0 nadal wynosi p0. Zdarzenia jednej reguły nie nakładają się.
            </li>
            <li>
              Historia: p-wartość dwustronna z przybliżenia normalnego z wariancją pod H0, q-wartości Benjaminiego–Hochberga w rodzinie 10 reguł, werdykt od{' '}
              {LAB_RULES.minHist} zdarzeń. To eksploracja: definicje powstały po obejrzeniu przeszłości.
            </li>
            <li>
              Do przodu liczą się wyłącznie zdarzenia rozpoczęte co najmniej {LAB_RULES.forwardGraceH} h po zapisie katalogu w dzienniku. Dowodem zapisu przed
              danymi jest łańcuch hashy z pokwitowaniem OpenTimestamps. Katalog zawiera też wektor kontrolny, czyli hash wyniku całego silnika na stałych danych
              testowych, więc zmiana kodu wymaga nowej wersji i nowej rejestracji. Proces zakładów (Waudby-Smith i Ramdas 2023) daje e-wartość ważną przy
              dowolnie częstym podglądzie (nierówność Ville’a). e-BH (Wang i Ramdas 2022) działa osobno dla potwierdzeń i dla obaleń, każda rodzina na 5%,
              łącznie FDR ≤ 10% przy dowolnej zależności między regułami. Sekwencja ufności 90% ogranicza wielkość efektu przy założeniu, że jest stały.
            </li>
            <li>
              Dane źródłowe: <a className="text-accent hover:underline" href={branchHref('archive', 'BTC')} target="_blank" rel="noopener noreferrer">gałąź archive</a>{' '}
              (świece i finansowanie w CSV). Rekord prerejestracji (<code className="font-mono text-ink-1">k: &quot;p&quot;</code>, pełny katalog i jego hash)
              znajduje się w <a className="text-accent hover:underline" href={branchHref('ledger', 'BTC')} target="_blank" rel="noopener noreferrer">gałęzi ledger</a>{' '}
              i sprawdza go <code className="font-mono text-ink-1">scripts/verify-ledger.mjs</code>. Plik <code className="font-mono text-ink-1">lab/BTC.json</code>{' '}
              zawiera wszystkie zdarzenia do przodu, z których każdy może przeliczyć e-wartości.
            </li>
            <li>To pomiar statystyczny, a nie sygnał transakcyjny. Reguła „potwierdzona” mówi tylko, że efekt istnieje. Nie mówi, że opłaca się po kosztach.</li>
          </ul>
        )}
      </details>
    </div>
  );
};

const Row: React.FC<{ h: LabHypResult; open: boolean; onToggle: () => void }> = ({ h, open, onToggle }) => {
  const text = LAB_TEXT[h.id];
  const ctrl = h.family === 'control';
  const hv = HIST_LABEL[h.hist.verdict];
  const fv = FWD_LABEL[h.fwd.verdict];
  const strong = h.hist.verdict === 'support' || h.hist.verdict === 'against';
  const detailsId = `lab-${h.id}`;
  return (
    <>
      <tr className="border-t border-line/60 hover:bg-surface-2/40 cursor-pointer" onClick={onToggle}>
        <td className="py-1.5 pr-2 min-w-[150px]">
          <button type="button" className="text-left text-ink-1 font-medium hover:text-accent" aria-expanded={open} aria-controls={detailsId}>
            <span className="text-ink-3 mr-1" aria-hidden="true">
              {open ? '▾' : '▸'}
            </span>
            {text?.name ?? h.id}
          </button>
        </td>
        <td className="py-1.5 px-2 text-right font-mono tabular-nums whitespace-nowrap text-ink-1">{h.hist.n}</td>
        <td className="py-1.5 px-2 text-right font-mono tabular-nums whitespace-nowrap text-ink-2">
          {pct(h.hist.rate)} / {pct(h.hist.p0)}
        </td>
        <td className="py-1 px-2">
          <div className="flex items-center gap-2">
            <EffectBar eff={h.hist.effect} lo={h.hist.lo} hi={h.hist.hi} strong={strong} />
            <span className="font-mono tabular-nums text-ink-1 whitespace-nowrap">{pp(h.hist.effect)}</span>
          </div>
        </td>
        <td className="py-1.5 px-2 text-right font-mono tabular-nums whitespace-nowrap text-ink-2">{ctrl ? fmtQ(h.hist.p) : fmtQ(h.hist.q)}</td>
        <td className={`py-1.5 px-2 whitespace-nowrap ${hv.cls}`} title={ctrl ? hv.ctrl : hv.folk}>
          {hv.text}
        </td>
        <td className="py-1.5 px-2 text-right font-mono tabular-nums whitespace-nowrap text-ink-1">{h.fwd.n}</td>
        <td className="py-1.5 px-2 text-right font-mono tabular-nums whitespace-nowrap text-ink-1" title={`${tr('przeciw tezie', 'against the claim')}: ${fmtE(h.fwd.eAgainst)}`}>
          {h.fwd.n ? fmtE(h.fwd.e) : DASH}
        </td>
        <td className={`py-1.5 px-2 whitespace-nowrap ${fv.cls}`} title={ctrl ? fv.ctrl : fv.folk}>
          {fv.text}
        </td>
      </tr>
      {open && (
        <tr className="bg-surface-2/40" id={detailsId}>
          <td colSpan={9} className="px-3 py-3">
            {/* Przypięte do lewej i nie szersze niż ekran — tabela przewija się poziomo na wąskich ekranach */}
            <div className="sticky left-0 max-w-[calc(100vw-4rem)]">
              <Details h={h} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

const Details: React.FC<{ h: LabHypResult }> = ({ h }) => {
  const def = CATALOG.get(h.id);
  const text = LAB_TEXT[h.id];
  const d = h.hist.dropped;
  const threshold = h.family === 'control' ? 1 / LAB_RULES.alphaFamily : E_THRESHOLD_ONE;
  const logE = h.fwd.path.map(([, e]) => Math.log10(Math.max(e, 1e-6)));
  let acc = 0;
  const cum = h.fwd.events.map(([, , x, p0]) => (acc += x - p0));
  return (
    <div className="grid gap-4 md:grid-cols-2 text-xs text-ink-2 leading-relaxed">
      <div className="flex flex-col gap-1.5">
        <div className="text-ink-1">{text?.claim}</div>
        <div>
          <span className="text-ink-3">{tr('Definicja (prerejestrowana): ', 'Definition (pre-registered): ')}</span>
          {def && tr(def.rule, LAB_RULE_EN[h.id] ?? def.rule)}
        </div>
        {text?.source && (
          <div className="text-ink-3">
            {tr('Źródło', 'Source')}: {text.source}
          </div>
        )}
        <div className="text-ink-3">
          {tr('Historia', 'History')} {h.hist.from !== null ? dateFmt.format(h.hist.from) : DASH} – {h.hist.to !== null ? dateFmt.format(h.hist.to) : DASH};{' '}
          {tr('przedział 90% efektu', '90% effect interval')} {pp(h.hist.lo)} … {pp(h.hist.hi)}; p = {h.hist.p === null ? DASH : fmtFixed(h.hist.p, 4)}.{' '}
          {tr(
            `Odrzucone: niejednoznaczne ${d.ambiguous}, wąskie pasmo ${d.narrow}; wynik ułamkowy: limit czasu ${d.timeout}, luka w danych ${d.gap}.`,
            `Discarded: ambiguous ${d.ambiguous}, narrow band ${d.narrow}; fractional result: time limit ${d.timeout}, data gap ${d.gap}.`
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <MiniChart
            values={logE}
            refLine={Math.log10(threshold)}
            refLabel={tr(`próg e = ${threshold}`, `threshold e = ${threshold}`)}
            ariaLabel={tr(`Trajektoria e-wartości (log10) z ${h.fwd.n} zdarzeń do przodu; próg ${threshold}`, `e-value path (log10) from ${h.fwd.n} forward events; threshold ${threshold}`)}
          />
          <div>
            <div>
              {tr('e za tezą', 'e for the claim')} <span className="font-mono text-ink-1">{h.fwd.n ? fmtE(h.fwd.e) : DASH}</span> · {tr('przeciw', 'against')}{' '}
              <span className="font-mono text-ink-1">{h.fwd.n ? fmtE(h.fwd.eAgainst) : DASH}</span>
            </div>
            <div className="text-ink-3">
              {tr('log10 e-wartości; przerywana linia — próg potwierdzenia, gdy potwierdzana jest jedna reguła', 'log10 of the e-value; dashed line: the confirmation threshold when one rule is confirmed')}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MiniChart values={cum} zero ariaLabel={tr(`Skumulowana nadwyżka sukcesów ponad p0 z ${h.fwd.n} zdarzeń do przodu`, `Cumulative excess of successes over p0 from ${h.fwd.n} forward events`)} />
          <div className="text-ink-3">
            {tr('skumulowane (x − p0) do przodu: rośnie, gdy folklor trafia częściej, niż wynika z hipotezy zerowej', 'cumulative forward (x − p0): rises when folklore hits more often than the null hypothesis implies')}
          </div>
        </div>
        <div>
          {tr(
            `Do przodu: ${h.fwd.n} zdarzeń, sukces ${pct(h.fwd.rate)} vs p0 ${pct(h.fwd.p0)}, efekt ${pp(h.fwd.effect)}; sekwencja ufności 90%:`,
            `Forward: ${h.fwd.n} events, success ${pct(h.fwd.rate)} vs p0 ${pct(h.fwd.p0)}, effect ${pp(h.fwd.effect)}; 90% confidence sequence:`
          )}{' '}
          <span className="font-mono text-ink-1">{h.fwd.cs ? `${pp(h.fwd.cs.lo)} … ${pp(h.fwd.cs.hi)}` : DASH}</span>.
        </div>
      </div>
    </div>
  );
};
