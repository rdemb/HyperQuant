// Strona „Wyniki prognoz” (PL wyniki/, EN en/results/): rozliczenie weryfikowalnego dziennika prognoz w statycznym
// HTML, budowane przy każdym wdrożeniu z trzech publicznych plików — podsumowania dziennika (`ledger/BTC/summary.json`
// w repo danych), wyniku niezależnej weryfikacji (`verify/latest.json` w gałęzi wyników tego repo) i raportu
// laboratorium reguł (`lab/BTC.json` w repo danych). Bez skryptów poza danymi strukturalnymi; brak pliku albo pola
// daje „—” z powodem, a każda liczba stoi obok swojej liczności.
import { LEDGER_MIN_N, isDeskLedgerSummary } from '../../src/utils/deskLedger.ts';
import { isLabReport } from '../../src/utils/folkloreLab.ts';
import { VERIFY_LATEST_URL, verifyStale } from '../../src/utils/verifyFreshness.ts';
import { esc, layout } from './render.mjs';

export const RESULTS_PATHS = { pl: 'wyniki/', en: 'en/results/' };
/** Gałąź dziennika (pliki dzienne JSONL z łańcuchem hashy) */
export const LEDGER_BRANCH_URL = 'https://github.com/rdemb/hyperquant-data/tree/ledger';
/** Repo danych (gałąź main) — ten sam adres co VITE_DATA_BASE_URL aplikacji */
export const DATA_BASE_DEFAULT = 'https://raw.githubusercontent.com/rdemb/hyperquant-data/main';
export const resultsSources = (base = DATA_BASE_DEFAULT) => {
  const b = String(base).replace(/\/+$/, '');
  return { summary: `${b}/ledger/BTC/summary.json`, lab: `${b}/lab/BTC.json`, verify: VERIFY_LATEST_URL };
};

const FETCH_TIMEOUT_MS = 15_000;

/**
 * Pliki strony z sieci w chwili budowania: każdy osobno, z limitem czasu; błąd daje null (na stronie „—” z powodem),
 * nie zatrzymuje wdrożenia.
 */
export async function fetchResults({ base = DATA_BASE_DEFAULT, fetchImpl = fetch, now = Date.now(), timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const sources = resultsSources(base);
  const get = async (url) => {
    try {
      const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  };
  const [summary, verify, lab] = await Promise.all([get(sources.summary), get(sources.verify), get(sources.lab)]);
  return { summary, verify, lab, now, sources };
}

const isVerify = (v) => !!v && typeof v === 'object' && typeof v.ok === 'boolean' && Number.isFinite(v.at) && (v.lines === undefined || Array.isArray(v.lines));
const RUN_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/;
const fin = (x) => typeof x === 'number' && Number.isFinite(x);

/** Reguły laboratorium pod nazwą strony (bez kierunku ceny w nazwie); nieznany identyfikator zostaje identyfikatorem */
const LAB_NAMES = {
  'round-res': ['Okrągły poziom jako opór', 'Round level as resistance'],
  'round-sup': ['Okrągły poziom jako wsparcie', 'Round level as support'],
  'pdh-sweep': ['Zebranie PDH i powrót do środka zakresu', 'PDH sweep and return to mid-range'],
  'pdl-sweep': ['Zebranie PDL i powrót do środka zakresu', 'PDL sweep and return to mid-range'],
  'ib-break': ['Wybicie IB idzie dalej', 'IB breakout follows through'],
  'vwap-revert': ['Powrót do VWAP z odległości 2σ', 'Reversion to VWAP from 2σ away'],
  'cme-gap': ['Luka CME się zamyka', 'CME gap gets filled'],
  'funding-flush': ['Skrajne finansowanie i wyczyszczenie przepełnionej strony', 'Extreme funding and a flush of the crowded side'],
  'ny-10am': ['Pierwsza godzina po otwarciu giełd w USA (10:00 w Nowym Jorku)', 'The first hour after the US stock open (10:00 New York)'],
  'intraday-mom': ['Momentum śróddzienne (pierwsza i ostatnia godzina doby)', 'Intraday momentum (first and last hour of the day)'],
};

const LOCALE = { pl: 'pl-PL', en: 'en-GB' };
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n) => String(n).padStart(2, '0');

/** Formatowanie w języku strony; minus typograficzny */
function fmt(lang) {
  const nf = new Map();
  const num = (x, d) => {
    const key = d;
    if (!nf.has(key)) nf.set(key, new Intl.NumberFormat(LOCALE[lang], { minimumFractionDigits: d, maximumFractionDigits: d }));
    return nf.get(key).format(x).replace(/^-/, '−');
  };
  const int = (n) => new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 0 }).format(n);
  const date = (t) => {
    const d = new Date(t);
    return lang === 'pl' ? `${two(d.getUTCDate())}.${two(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}` : `${d.getUTCDate()} ${MONTHS_EN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  };
  const time = (t) => {
    const d = new Date(t);
    return `${date(t)}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
  };
  const pct = (x, d = 1) => `${num(x * 100, d)}%`;
  const p = (x) => (x < 0.001 ? `p < ${num(0.001, 3)}` : `p = ${num(x, 3)}`);
  const days = (n) => {
    if (lang === 'en') return `${int(n)} ${n === 1 ? 'day' : 'days'}`;
    const word = n === 1 ? 'doba' : n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? 'doby' : 'dób';
    return `${int(n)} ${word}`;
  };
  /** E-wartość: od 100 bez części ułamkowej, mniejsza z trzema cyframi znaczącymi */
  const e = (x) => (x >= 100 ? int(Math.round(x)) : num(x, Math.max(0, 2 - Math.floor(Math.log10(Math.max(x, 1e-9))))));
  return { num, int, date, time, pct, p, days, e };
}

const T = {
  pl: {
    title: 'Wyniki prognoz BTC: rozliczenie dziennika · HyperQuant',
    h1: 'Wyniki prognoz',
    eyebrow: 'Dziennik prognoz',
    description:
      'Rozliczenie prognoz BTC zapisanych przed faktem: CRPSS, pokrycie przedziałów i test Kupca, Brier i BSS dotknięć, wyniki kota Schrödi, plany ocen i niezależna weryfikacja.',
    card: { title: 'Wyniki prognoz BTC', subtitle: 'Rozliczenie dziennika prognoz zapisanych przed faktem, z niezależną weryfikacją' },
    cardFoot: 'dziennik prognoz · bez sygnałów',
    lead: 'Co 15 minut desk zapisuje prognozy przed faktem w publicznym dzienniku z łańcuchem hashy: rozkład zwrotu BTC na 1 h i 4 h, szanse dotknięcia poziomów w 2 h i szanse kota Schrödi na najbliższą godzinę. Ta strona rozlicza ostatnie 30 dni. Każda liczba stoi obok liczby rozstrzygnięć, z których powstała.',
    asOf: (s) => `Stan na ${s}.`,
    live: 'Liczby na żywo i wykresy kalibracji: Po sesji',
    why: {
      summaryMissing: 'podsumowanie dziennika niedostępne przy budowaniu strony',
      summaryFormat: 'podsumowanie dziennika w nieznanym formacie',
      verifyMissing: 'wynik weryfikacji niedostępny przy budowaniu strony',
      verifyFormat: 'wynik weryfikacji w nieznanym formacie',
      labMissing: 'raport laboratorium niedostępny przy budowaniu strony',
      labFormat: 'raport laboratorium w nieznanym formacie',
      fromN: (n) => `wyniki od ${LEDGER_MIN_N} rozstrzygnięć, jest ${n}`,
      ciOld: 'przedział: brak w tym podsumowaniu',
      ciDays: (d) => `przedział od 7 dób z danymi, jest ${d}`,
      ciBase: 'przedział: baza bez błędu',
      k60Old: 'test 60%: brak w tym podsumowaniu',
      noDisjoint: 'brak prognoz rozłącznych',
      aciOld: 'udział: brak w tym podsumowaniu',
      noSettled: 'brak rozstrzygnięć',
      noHorizon: 'brak tego horyzontu w podsumowaniu',
      noDist: 'brak bazy odległości w tym podsumowaniu; BSS podajemy tylko w parze',
      seasonOld: 'baza sezonowa: brak w tym podsumowaniu',
      noRel: 'brak w podsumowaniu',
      notApplicable: 'nie dotyczy',
      noCat: 'brak wyników kota w podsumowaniu',
      noPlan: 'jeszcze nie w dzienniku',
      noRun: 'brak linku do przebiegu',
      noValue: 'brak wartości w podsumowaniu',
    },
    returns: {
      h2: 'Prognozy rozkładu zwrotu',
      head: ['Horyzont', 'n', 'CRPSS [przedział 95%]', 'Pokrycie 60%', 'Pokrycie 90%', 'Test Kupca 90%', 'Test Kupca 60%', 'Nieskończony przedział ACI'],
      horizon: (h) => (h === 60 ? '1 h' : `${h / 60} h`),
      disjoint: (n) => `n = ${n} rozłącznych`,
      disjointCover: (n, c) => `n = ${n} rozłącznych, pokrycie ${c}`,
      of: (a, b) => `${a} z ${b}`,
      notes: [
        'CRPSS to umiejętność wobec rozkładu normalnego ze zmienności 30 dni: powyżej zera prognoza jest trafniejsza od tej bazy. Przedział pochodzi z bootstrapu blokowego po dobach UTC (1000 losowań).',
        'Prognozy co 15 minut nakładają się horyzontami, więc odsetki pokrycia opisują wszystkie prognozy, a test Kupca liczymy na próbie rozłącznej. Małe p znaczy, że pokrycie odbiega od nominału.',
        'Przedział ACI ma pokrycie 90% z konstrukcji (samokorekta α), więc nie mierzy trafności; podajemy, jak często jego granica była nieskończona.',
      ],
    },
    touch: {
      h2: 'Szanse dotknięcia poziomów w 2 h',
      head: ['Miara', 'Wynik'],
      brier: 'Brier modelu (PDH, PDL, D-EQ)',
      bss: 'BSS wobec częstości poziomu',
      bssDist: 'BSS wobec bazy odległości',
      pairs: (n) => `n = ${n} par`,
      note: 'BSS podajemy w parze: częstość poziomu nie zna jego odległości od ceny, więc sama zawyża umiejętność; baza odległości to wzór odbicia ze stałą zmiennością godzinową z 30 dni.',
    },
    cat: {
      h2: 'Kot Schrödi: szanse na najbliższą godzinę',
      head: ['Prognoza', 'n', 'AUC', 'BSS wobec stałej częstości', 'BSS wobec bazy sezonowej', 'Średnie p', 'Częstość'],
      big: 'Duży ruch w 1 h',
      dir: 'Znak zwrotu w 1 h',
      seasonN: (n) => `n = ${n}`,
      note: 'Stała częstość to odsetek wyników w oknie 30 dni; baza sezonowa to częstość tej samej godziny UTC w 20 poprzednich dobach tego samego typu (dzień roboczy albo weekend).',
      calibration:
        'Kalibracja procentów kota jest w toku: ranking (AUC) jest już mierzony, a średnie p obok częstości pokazuje, o ile procenty odbiegają od wyników. Poprawioną kalibrację oceni osobny plan zapisany w dzienniku przed pierwszym ocenianym okresem.',
    },
    plans: {
      h2: 'Testy A/B i plany ocen',
      head: ['Plan', 'Start', 'Kryterium', 'Stan'],
      lead: 'Plan oceny trafia do dziennika przed pierwszym ocenianym okresem; weryfikator sprawdza, że zapisany plan jest taki sam jak kod.',
      abCrit: 'Wersja B ma niższy CRPS zwrotu 1 h niż wersja A; wniosek po zakończeniu 14-dniowego okresu, z 95% przedziałem HAC, od 672 par.',
      trustCrit: 'Brier kota niższy niż prostej reguły; dowód przy e-wartości co najmniej 20, osobno dla dużego ruchu, znaku zwrotu i dotknięć poziomów.',
      hourCrit: 'Godzina na żywo kota trafia duży ruch w tej godzinie lepiej (Brier) niż ta sama metoda z samej drogi ceny; dowód przy e-wartości co najmniej 20.',
      abVerdict: (d) => (d.hi < 0 ? 'B trafniejsza' : d.lo > 0 ? 'A trafniejsza' : 'różnica nieudowodniona'),
      abBlock: (v, a, b, diff, n) => `${v} (okres ${a} do ${b}, B − A = ${diff}, n = ${n} par)`,
      abNoCi: (a, b, n) => `okres ${a} do ${b} zakończony bez przedziału (n = ${n} par)`,
      abCurrent: (b, n) => `okres w toku do ${b}, n = ${n} par`,
      heads: { big: 'duży ruch', dir: 'znak zwrotu', touch: 'dotknięcia', hourBig: 'duży ruch wobec samej drogi ceny' },
      head1: (label, e, n, proof) => `${label}: E = ${e} (n = ${n} godzin)${proof ? `, dowód od ${proof}` : ', bez dowodu'}`,
    },
    verify: {
      h2: 'Niezależna weryfikacja',
      lead: 'Co 6 godzin GitHub Actions klonuje gałąź ledger repo danych z pełną historią i przelicza wszystko od pierwszej linii: łańcuch hashy, historię git (tylko dopisywanie), kolejność rekordów, pokwitowania OpenTimestamps, wyniki z kwantyli i ceny ze świec 1m.',
      status: { ok: 'zgodna', bad: 'niezgodna', stale: 'nieaktualna (wynik starszy niż 36 h)' },
      last: (t) => `Ostatni przebieg: ${t}`,
      run: 'przebieg w GitHub Actions',
      checks: (a, b) => `pozycje zgodne: ${a} z ${b}`,
      self: 'Sprawdź sam (Node.js 24):',
      branch: 'Gałąź dziennika',
    },
    refuted: {
      h2: 'Co się nie potwierdziło',
      lead: 'Reguły z prerejestrowanego katalogu laboratorium i wersje modeli, które nie przeszły testu zapisanego w dzienniku albo jeszcze go nie przeszły. Lista mówi, czego nie widać w danych, nie dokąd pójdzie cena.',
      hist: { none: (n, q) => `test historyczny bez efektu (n = ${n}${q})`, against: (n, q) => `test historyczny przeciw regule (n = ${n}${q})` },
      fwd: {
        collecting: (n) => `test do przodu zbiera dane (n = ${n})`,
        against: (n) => `test do przodu przeciw regule (n = ${n})`,
        excluded: (n) => `efekt wykluczony w teście do przodu (n = ${n})`,
        confirmed: (n) => `test do przodu potwierdza (n = ${n})`,
      },
      ab: (a, b, n) => `Wersja B modelu zwrotu 1 h (ab-v1): w okresie ${a} do ${b} nie była trafniejsza od A (n = ${n} par)`,
      none: 'Na razie żadna reguła ani wersja nie została obalona.',
      registered: (id, t) => `Katalog ${id} zapisany w dzienniku ${t}.`,
    },
    footer: 'Wyniki prognoz',
  },
  en: {
    title: 'BTC forecast results: the ledger scorecard · HyperQuant',
    h1: 'Forecast results',
    eyebrow: 'Forecast ledger',
    description:
      'Scores of BTC forecasts recorded before the fact: CRPSS, interval coverage with the Kupiec test, touch Brier and BSS, the Schrödi cat, evaluation plans and independent verification.',
    card: { title: 'BTC forecast results', subtitle: 'The scorecard of forecasts recorded before the fact, with independent verification' },
    cardFoot: 'forecast ledger · no signals',
    lead: 'Every 15 minutes the desk records forecasts before the fact in a public ledger with a hash chain: the distribution of the BTC return over 1 h and 4 h, the chances of touching levels within 2 h and the Schrödi cat’s chances for the next hour. This page scores the last 30 days. Every number stands next to the number of settlements it comes from.',
    asOf: (s) => `As of ${s}.`,
    live: 'Live numbers and calibration charts: Post-session',
    why: {
      summaryMissing: 'ledger summary unavailable when the page was built',
      summaryFormat: 'ledger summary in an unknown format',
      verifyMissing: 'verification result unavailable when the page was built',
      verifyFormat: 'verification result in an unknown format',
      labMissing: 'lab report unavailable when the page was built',
      labFormat: 'lab report in an unknown format',
      fromN: (n) => `scores from ${LEDGER_MIN_N} settlements, now ${n}`,
      ciOld: 'interval: not in this summary',
      ciDays: (d) => `interval from 7 days with data, now ${d}`,
      ciBase: 'interval: the baseline has no error',
      k60Old: '60% test: not in this summary',
      noDisjoint: 'no disjoint forecasts',
      aciOld: 'share: not in this summary',
      noSettled: 'no settlements',
      noHorizon: 'this horizon is not in the summary',
      noDist: 'no distance baseline in this summary; BSS is given only as a pair',
      seasonOld: 'seasonal baseline: not in this summary',
      noRel: 'not in the summary',
      notApplicable: 'not applicable',
      noCat: 'no cat scores in the summary',
      noPlan: 'not in the ledger yet',
      noRun: 'no link to the run',
      noValue: 'no value in the summary',
    },
    returns: {
      h2: 'Return distribution forecasts',
      head: ['Horizon', 'n', 'CRPSS [95% interval]', '60% coverage', '90% coverage', 'Kupiec test 90%', 'Kupiec test 60%', 'Infinite ACI interval'],
      horizon: (h) => (h === 60 ? '1 h' : `${h / 60} h`),
      disjoint: (n) => `n = ${n} disjoint`,
      disjointCover: (n, c) => `n = ${n} disjoint, coverage ${c}`,
      of: (a, b) => `${a} of ${b}`,
      notes: [
        'CRPSS is the skill against a normal distribution with 30-day volatility: above zero the forecast beats that baseline. The interval comes from a block bootstrap over UTC days (1000 draws).',
        'Forecasts every 15 minutes overlap their horizons, so coverage rates describe all forecasts while the Kupiec test runs on a disjoint subsample. A small p means the coverage differs from the nominal level.',
        'The ACI interval has 90% coverage by construction (self-correcting α), so it does not measure accuracy; we report how often its bound was infinite.',
      ],
    },
    touch: {
      h2: 'Chances of touching levels within 2 h',
      head: ['Measure', 'Score'],
      brier: 'Model Brier score (PDH, PDL, D-EQ)',
      bss: 'BSS against the level base rate',
      bssDist: 'BSS against the distance baseline',
      pairs: (n) => `n = ${n} pairs`,
      note: 'BSS comes as a pair: the level base rate ignores the distance of the level from the price, so on its own it overstates skill; the distance baseline is the reflection formula with a constant 30-day hourly volatility.',
    },
    cat: {
      h2: 'The Schrödi cat: chances for the next hour',
      head: ['Forecast', 'n', 'AUC', 'BSS against the constant rate', 'BSS against the seasonal baseline', 'Mean p', 'Rate'],
      big: 'Big move within 1 h',
      dir: 'Sign of the 1 h return',
      seasonN: (n) => `n = ${n}`,
      note: 'The constant rate is the share of outcomes in the 30-day window; the seasonal baseline is the rate of the same UTC hour on the previous 20 days of the same type (weekday or weekend).',
      calibration:
        'Calibration of the cat’s percentages is in progress: the ranking (AUC) is already measured, and the mean p next to the rate shows how far the percentages are from the outcomes. A separate plan, written to the ledger before its first scored period, will score the improved calibration.',
    },
    plans: {
      h2: 'A/B tests and evaluation plans',
      head: ['Plan', 'Start', 'Criterion', 'Status'],
      lead: 'An evaluation plan is written to the ledger before its first scored period; the verifier checks that the recorded plan matches the code.',
      abCrit: 'Version B has a lower CRPS of the 1 h return than version A; the conclusion comes after each 14-day period, with a 95% HAC interval, from 672 pairs.',
      trustCrit: 'The cat’s Brier score is lower than a simple rule’s; proof at an e-value of at least 20, separately for the big move, the sign of the return and level touches.',
      hourCrit: 'The cat’s live hour scores the big move in that hour better (Brier) than the same method from the price path alone; proof at an e-value of at least 20.',
      abVerdict: (d) => (d.hi < 0 ? 'B more accurate' : d.lo > 0 ? 'A more accurate' : 'difference not proven'),
      abBlock: (v, a, b, diff, n) => `${v} (period ${a} to ${b}, B − A = ${diff}, n = ${n} pairs)`,
      abNoCi: (a, b, n) => `period ${a} to ${b} closed without an interval (n = ${n} pairs)`,
      abCurrent: (b, n) => `period in progress until ${b}, n = ${n} pairs`,
      heads: { big: 'big move', dir: 'sign of the return', touch: 'touches', hourBig: 'big move against the price path alone' },
      head1: (label, e, n, proof) => `${label}: E = ${e} (n = ${n} hours)${proof ? `, proof since ${proof}` : ', no proof'}`,
    },
    verify: {
      h2: 'Independent verification',
      lead: 'Every 6 hours GitHub Actions clones the ledger branch of the data repository with its full history and recomputes everything from the first line: the hash chain, the git history (append-only), record ordering, OpenTimestamps receipts, scores from the quantiles and prices from 1m candles.',
      status: { ok: 'passed', bad: 'failed', stale: 'out of date (result older than 36 h)' },
      last: (t) => `Last run: ${t}`,
      run: 'the run on GitHub Actions',
      checks: (a, b) => `checks passed: ${a} of ${b}`,
      self: 'Check it yourself (Node.js 24):',
      branch: 'Ledger branch',
    },
    refuted: {
      h2: 'What did not hold up',
      lead: 'Rules from the pre-registered lab catalogue and model versions that failed the test recorded in the ledger or have not passed it yet. The list says what the data does not show, not where the price will go.',
      hist: { none: (n, q) => `historical test shows no effect (n = ${n}${q})`, against: (n, q) => `historical test against the rule (n = ${n}${q})` },
      fwd: {
        collecting: (n) => `forward test collecting data (n = ${n})`,
        against: (n) => `forward test against the rule (n = ${n})`,
        excluded: (n) => `effect ruled out in the forward test (n = ${n})`,
        confirmed: (n) => `forward test confirms (n = ${n})`,
      },
      ab: (a, b, n) => `Version B of the 1 h return model (ab-v1): in the period ${a} to ${b} it was not more accurate than A (n = ${n} pairs)`,
      none: 'No rule or version has been refuted so far.',
      registered: (id, t) => `Catalogue ${id} recorded in the ledger on ${t}.`,
    },
    footer: 'Forecast results',
  },
};

/** Tekst stopki (link do wyników) dla szablonu stron */
export const RESULTS_LINK = { pl: T.pl.footer, en: T.en.footer };

/** Brak danej: „—” z powodem */
const na = (why) => `<span class="na">— <span class="why">(${esc(why)})</span></span>`;

/** Stan pliku: wartość albo powód braku */
function input(x, guard, missing, format) {
  if (x === null || x === undefined) return { ok: false, why: missing };
  return guard(x) ? { ok: true, value: x } : { ok: false, why: format };
}

const table = (head, rows) =>
  `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${c}</th>` : `<td>${c}</td>`)).join('')}</tr>`)
    .join('')}</tbody></table></div>`;

/** Strona wyników w języku `lang`. `results` = { summary, verify, lab, now, sources? } (brak = „—” z powodem). */
export function resultsPage(site, lang, results = {}) {
  const t = T[lang];
  const f = fmt(lang);
  const w = t.why;
  const path = RESULTS_PATHS[lang];
  const root = '../'.repeat(path.split('/').filter(Boolean).length);
  const url = `${site.url}${path}`;
  const alternates = Object.entries(RESULTS_PATHS).map(([l, p]) => ({ lang: l, url: `${site.url}${p}` }));
  const sources = results.sources ?? resultsSources();
  const now = fin(results.now) ? results.now : Date.now();
  const S = input(results.summary, isDeskLedgerSummary, w.summaryMissing, w.summaryFormat);
  const V = input(results.verify, isVerify, w.verifyMissing, w.verifyFormat);
  const L = input(results.lab, isLabReport, w.labMissing, w.labFormat);
  const s = S.ok ? S.value : null;
  const ok = (x) => fin(x);
  /** Przedział z bootstrapu: „[lo; hi], d dób” albo „—” z powodem */
  const ci = (c, d) => {
    if (!c) return na(w.ciOld);
    if (!ok(c.lo) || !ok(c.hi)) return na(c.reason === 'no-base' ? w.ciBase : w.ciDays(c.days ?? 0));
    return `[${f.num(c.lo, d)}; ${f.num(c.hi, d)}], ${f.days(c.days)}`;
  };

  // 1. Wstęp
  const intro = `<section class="block" id="intro">
<p class="lead">${esc(t.lead)}</p>
<p>${s ? esc(t.asOf(f.time(s.asOf))) : `${esc(t.asOf('')).replace(/\s*\.$/, '')} ${na(S.why)}`}</p>
<p><a href="${root}#after">${esc(t.live)}</a></p>
</section>`;

  // 2. Zwroty
  const retRow = (h) => {
    const label = esc(t.returns.horizon(h));
    if (!s) return [label, ...Array(7).fill(na(S.why))];
    const sc = s.scores.ret[String(h)];
    if (!sc) return [label, ...Array(7).fill(na(w.noHorizon))];
    if (sc.n < LEDGER_MIN_N) return [label, f.int(sc.n), ...Array(6).fill(na(w.fromN(sc.n)))];
    const crpssV = sc.crpssCi && ok(sc.crpssCi.value) ? sc.crpssCi.value : sc.crpss;
    const crpss = ok(crpssV) ? `${f.num(crpssV, 4)} ${ci(sc.crpssCi, 4)}` : na(w.noValue);
    const covCell = (c) => (c && ok(c.rate) ? `${f.pct(c.rate)} (n = ${f.int(c.n)})` : na(w.noValue));
    const k90 = sc.cov90 && ok(sc.cov90.kupiecP) ? `${esc(f.p(sc.cov90.kupiecP))} (${esc(t.returns.disjoint(f.int(sc.cov90.nEff)))})` : na(w.noDisjoint);
    const k = sc.kupiec60;
    const k60 = !k ? na(w.k60Old) : ok(k.p) && ok(k.cover) ? `${esc(f.p(k.p))} (${esc(t.returns.disjointCover(f.int(k.n), f.pct(k.cover)))})` : na(w.noDisjoint);
    const a = sc.aciInf;
    const aci = !a ? na(w.aciOld) : ok(a.share) ? `${f.pct(a.share)} (${esc(t.returns.of(f.int(a.inf), f.int(a.n)))})` : na(w.noSettled);
    return [label, f.int(sc.n), crpss, covCell(sc.cov60), covCell(sc.cov90), k90, k60, aci];
  };
  const returns = `<section class="block" id="returns">
<h2>${esc(t.returns.h2)}</h2>
${table(t.returns.head, [retRow(60), retRow(240)])}
${t.returns.notes.map((n) => `<p>${esc(n)}</p>`).join('\n')}
</section>`;

  // 3. Dotknięcia
  const touchRows = (() => {
    const lab = [esc(t.touch.brier), esc(t.touch.bss), esc(t.touch.bssDist)];
    if (!s) return lab.map((l) => [l, na(S.why)]);
    const x = s.scores.touch;
    if (x.n < LEDGER_MIN_N) return lab.map((l) => [l, na(w.fromN(x.n))]);
    const pairs = esc(t.touch.pairs(f.int(x.pairs)));
    const brier = ok(x.brier) ? `${f.num(x.brier, 4)} (${pairs})` : na(w.noValue);
    // BSS tylko w parze z bazą odległości (jak na stronie Po sesji)
    const distOk = ok(x.bssDist);
    const bssCell = (v, c, n) => (ok(v) ? `${f.num(v, 3)} ${ci(c, 3)}; ${esc(t.touch.pairs(f.int(n)))}` : na(w.noValue));
    const bss = distOk ? bssCell(x.bssCi && ok(x.bssCi.value) ? x.bssCi.value : x.bss, x.bssCi, x.pairs) : na(w.noDist);
    const dist = distOk ? bssCell(x.bssDistCi && ok(x.bssDistCi.value) ? x.bssDistCi.value : x.bssDist, x.bssDistCi, x.pairsDist ?? x.pairs) : na(w.noDist);
    return [
      [lab[0], brier],
      [lab[1], bss],
      [lab[2], dist],
    ];
  })();
  const touch = `<section class="block" id="touch">
<h2>${esc(t.touch.h2)}</h2>
${table(t.touch.head, touchRows)}
<p>${esc(t.touch.note)}</p>
</section>`;

  // 4. Kot
  const catRows = (() => {
    const labels = [esc(t.cat.big), esc(t.cat.dir)];
    const c = s?.cat?.scores;
    if (!s) return labels.map((l) => [l, ...Array(6).fill(na(S.why))]);
    if (!c || !ok(c.n) || !c.big || !c.dir) return labels.map((l) => [l, ...Array(6).fill(na(w.noCat))]);
    if (c.n < LEDGER_MIN_N) return labels.map((l) => [l, f.int(c.n), ...Array(5).fill(na(w.fromN(c.n)))]);
    const v3 = (x) => (ok(x) ? f.num(x, 3) : na(w.noValue));
    const big = c.big;
    const sea = big.bssSeasonal;
    const season = !sea ? na(w.seasonOld) : ok(sea.value) ? `${f.num(sea.value, 3)} ${ci(sea, 3)}; ${esc(t.cat.seasonN(f.int(sea.n)))}` : na(sea.reason === 'no-base' ? w.ciBase : w.ciDays(sea.days ?? 0));
    let n = 0;
    let sp = 0;
    let sy = 0;
    for (const b of big.reliability ?? []) {
      if (!ok(b.n) || !ok(b.meanP) || !ok(b.freq) || b.n <= 0) continue;
      n += b.n;
      sp += b.n * b.meanP;
      sy += b.n * b.freq;
    }
    const meanP = n ? f.pct(sp / n) : na(w.noRel);
    const rate = n ? f.pct(sy / n) : na(w.noRel);
    return [
      [labels[0], f.int(c.n), v3(big.auc), v3(big.bss), season, meanP, rate],
      [labels[1], f.int(c.n), v3(c.dir.auc), v3(c.dir.bss), na(w.notApplicable), na(w.noRel), na(w.noRel)],
    ];
  })();
  const cat = `<section class="block" id="cat">
<h2>${esc(t.cat.h2)}</h2>
${table(t.cat.head, catRows)}
<p>${esc(t.cat.note)}</p>
<p>${esc(t.cat.calibration)}</p>
</section>`;

  // 5. Plany
  const P = t.plans;
  const planRows = (() => {
    const rows = [];
    const ab = s?.ab;
    const abState = (() => {
      if (!s) return na(S.why);
      if (!ab) return na(w.noValue);
      const parts = [];
      const l = ab.last;
      const span = (b) => b && ok(b.start) && ok(b.end) && ok(b.n);
      if (span(l) && l.diff && ok(l.diff.d) && ok(l.diff.lo) && ok(l.diff.hi)) {
        const diff = `${f.num(l.diff.d, 6)} [${f.num(l.diff.lo, 6)}; ${f.num(l.diff.hi, 6)}]`;
        parts.push(esc(P.abBlock(P.abVerdict(l.diff), f.date(l.start), f.date(l.end), diff, f.int(l.n))));
      } else if (span(l)) parts.push(esc(P.abNoCi(f.date(l.start), f.date(l.end), f.int(l.n))));
      if (span(ab.current)) parts.push(esc(P.abCurrent(f.date(ab.current.end), f.int(ab.current.n))));
      return parts.length ? parts.join('; ') : na(w.noValue);
    })();
    // Plan na stronie tylko z rekordem w dzienniku (pojawia się w dniu rejestracji)
    if (ab && ok(ab.registeredAt)) rows.push(['ab-v1', f.date(ab.registeredAt), esc(P.abCrit), abState]);
    const trustState = (tr, heads) => {
      if (!s) return na(S.why);
      if (!tr || !tr.plan) return na(w.noPlan);
      const out = [];
      for (const [k, label] of heads) {
        const h = tr[k];
        if (!h || !ok(h.lg) || !ok(h.n)) continue;
        out.push(esc(P.head1(label, f.e(10 ** h.lg), f.int(h.n), ok(h.proofAt) ? f.date(h.proofAt) : null)));
      }
      return out.length ? out.join('; ') : na(w.noValue);
    };
    const trust = s?.cat?.trust;
    if (trust?.plan && ok(trust.plan.at)) rows.push([
      esc(trust.plan.id ?? 'schrodi-trust-v1'),
      f.date(trust.plan.at),
      esc(P.trustCrit),
      trustState(trust, [
        ['big', P.heads.big],
        ['dir', P.heads.dir],
        ['touch', P.heads.touch],
      ]),
    ]);
    const hour = s?.cat?.hour;
    if (hour?.plan && ok(hour.plan.at)) rows.push([esc(hour.plan.id ?? 'schrodi-hour-v1'), f.date(hour.plan.at), esc(P.hourCrit), trustState(hour, [['big', P.heads.hourBig]])]);
    return rows;
  })();
  const plans = `<section class="block" id="plans">
<h2>${esc(P.h2)}</h2>
<p>${esc(P.lead)}</p>
${planRows.length ? table(P.head, planRows) : `<p>${na(s ? w.noPlan : S.why)}</p>`}
</section>`;

  // 6. Weryfikacja
  const Vt = t.verify;
  const v = V.ok ? V.value : null;
  const state = !v ? null : !v.ok ? 'bad' : verifyStale(v.at, now) ? 'stale' : 'ok';
  const lines = Array.isArray(v?.lines) ? v.lines.filter((l) => typeof l === 'string') : [];
  const passed = lines.filter((l) => l.startsWith('✓')).length;
  const runLink = v && typeof v.run === 'string' && RUN_URL.test(v.run) ? `<a href="${esc(v.run)}">${esc(Vt.run)}</a>` : na(w.noRun);
  const cmd = [`git clone -b ledger https://github.com/rdemb/hyperquant-data ledger`, `git clone ${site.repo}`, `cd ${site.repo.split('/').pop()}`, 'node scripts/verify-ledger.mjs --dir ../ledger'];
  const verify = `<section class="block" id="verify">
<h2>${esc(Vt.h2)}</h2>
<p>${esc(Vt.lead)}</p>
<p>${state ? `<span class="status status--${state}">${esc(Vt.status[state])}</span>` : na(V.why)}</p>
${v ? `<p>${esc(Vt.last(f.time(v.at)))} · ${runLink}${lines.length ? ` · ${esc(Vt.checks(f.int(passed), f.int(lines.length)))}` : ''}</p>` : ''}
<p>${esc(Vt.self)}</p>
<pre class="cmd"><code>${cmd.map(esc).join('\n')}</code></pre>
<p>${esc(Vt.branch)}: <a href="${LEDGER_BRANCH_URL}">${esc(LEDGER_BRANCH_URL.replace(/^https:\/\//, ''))}</a></p>
</section>`;

  // 7. Co się nie potwierdziło
  const R = t.refuted;
  const refutedItems = (() => {
    if (!L.ok) return null;
    const out = [];
    for (const h of L.value.hypotheses) {
      if (h.family !== 'folklore') continue;
      const fv = h.fwd.verdict;
      const hv = h.hist.verdict;
      const refuted = fv === 'against' || fv === 'excluded' || ((hv === 'none' || hv === 'against') && fv !== 'confirmed');
      if (!refuted) continue;
      const name = LAB_NAMES[h.id]?.[lang === 'pl' ? 0 : 1] ?? h.id;
      const q = ok(h.hist.q) ? `, q = ${f.num(h.hist.q, 2)}` : '';
      const hist = hv === 'none' || hv === 'against' ? R.hist[hv](f.int(h.hist.n), q) : null;
      const fwd = R.fwd[fv] ? R.fwd[fv](f.int(h.fwd.n)) : null;
      out.push(`<li><b>${esc(name)}</b>: ${esc([hist, fwd].filter(Boolean).join('; '))}</li>`);
    }
    const l = s?.ab?.last;
    if (l && ok(l.start) && ok(l.end) && ok(l.n) && l.diff && ok(l.diff.hi) && !(l.diff.hi < 0)) out.push(`<li>${esc(R.ab(f.date(l.start), f.date(l.end), f.int(l.n)))}</li>`);
    return out;
  })();
  const reg = L.ok && ok(L.value.registeredAt) ? ` ${esc(R.registered(L.value.version, f.date(L.value.registeredAt)))}` : '';
  const refuted = `<section class="block" id="refuted">
<h2>${esc(R.h2)}</h2>
<p>${esc(R.lead)}${reg}</p>
${refutedItems === null ? `<p>${na(L.why)}</p>` : refutedItems.length ? `<ul class="refuted">${refutedItems.join('')}</ul>` : `<p>${esc(R.none)}</p>`}
</section>`;

  const main = `<article class="page page--results">
<p class="eyebrow"><span>${esc(t.eyebrow)}</span></p>
<h1>${esc(t.h1)}</h1>
${intro}
${returns}
${touch}
${cat}
${plans}
${verify}
${refuted}
</article>`;
  const description = t.description;
  const org = { '@type': 'Organization', name: 'HyperQuant', url: site.url };
  const dataset = {
    '@type': 'Dataset',
    name: lang === 'pl' ? 'Dziennik prognoz HyperQuant (BTC, Hyperliquid)' : 'HyperQuant forecast ledger (BTC, Hyperliquid)',
    description: t.lead,
    url,
    sameAs: LEDGER_BRANCH_URL,
    inLanguage: lang,
    isAccessibleForFree: true,
    creator: org,
    publisher: org,
    keywords: ['BTC', 'Hyperliquid', 'forecast verification', 'CRPS', 'PIT', 'Kupiec test', 'Brier score', 'OpenTimestamps'],
    measurementTechnique: 'CRPS, PIT, Kupiec test, Brier score, Brier skill score, adaptive conformal inference, block bootstrap',
    distribution: [
      { '@type': 'DataDownload', name: 'ledger/BTC/summary.json', encodingFormat: 'application/json', contentUrl: sources.summary },
      { '@type': 'DataDownload', name: 'ledger branch (daily JSONL files with a hash chain)', encodingFormat: 'application/x-ndjson', contentUrl: LEDGER_BRANCH_URL },
    ],
    ...(s ? { dateModified: new Date(s.asOf).toISOString(), temporalCoverage: `${new Date(s.asOf - 30 * 86_400_000).toISOString()}/${new Date(s.asOf).toISOString()}` } : {}),
  };
  return {
    path,
    lang,
    alternates,
    card: { section: t.eyebrow, ...t.card, foot: [url.replace(/^https?:\/\//, ''), t.cardFoot] },
    html: layout(site, {
      title: t.title,
      description,
      url,
      root,
      image: `${url}og.png`,
      imageAlt: `HyperQuant: ${t.card.title}`,
      jsonLd: {
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebPage', name: t.title, url, inLanguage: lang, description, isPartOf: { '@type': 'WebSite', name: 'HyperQuant', url: site.url } },
          dataset,
          {
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'HyperQuant', item: site.url },
              { '@type': 'ListItem', position: 2, name: t.h1, item: url },
            ],
          },
        ],
      },
      main,
      lang,
      current: 'after',
      alternates,
      disclaimer: lang === 'pl' ? 'Rozliczenie zapisanych prognoz, nie porada inwestycyjna ani sygnał do transakcji. Handel kontraktami z dźwignią wiąże się z wysokim ryzykiem utraty środków.' : 'A scorecard of recorded forecasts, not investment advice or a trading signal. Trading leveraged contracts carries a high risk of losing money.',
    }),
  };
}
