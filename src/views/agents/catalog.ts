/**
 * Treść zakładki Agenci AI: 10 narzędzi serwera `hyperquant-mcp` (nazwa, tytuł, krótki opis, przykładowe pytanie) i pięć
 * przepisów skilla `hyperquant`. Same dane, bez importu kodu serwera: SDK MCP i zod nie trafiają do bundla strony. Zgodność
 * z serwerem (nazwy i tytuły z `TOOLS`), z README paczki (przykładowe pytania) i z SKILL.md pilnuje test `catalog.test.ts`.
 */

type Text = { pl: string; en: string };

export interface ToolMeta {
  /** Nazwa jak w `tools/list`. */
  name: string;
  /** Tytuł narzędzia jak w serwerze. */
  title: Text;
  about: Text;
  /** Przykładowe pytanie do asystenta; angielskie jak w README paczki. */
  ask: Text;
}

/** Narzędzia w kolejności dnia tradera: przed sesją, w sesji, po sesji, potem przepływy i dziennik prognoz. */
export const TOOL_META: ToolMeta[] = [
  {
    name: 'market_brief',
    title: { pl: 'Skrót przed sesją BTC', en: 'BTC pre-session brief' },
    about: {
      pl: 'Skrót jak ekran Przed sesją: cztery liczby, poziomy dzisiejszej Mapy dnia, VAH, POC i VAL poprzedniej sesji oraz najbliższe otwarcie. Z argumentem level sprawdza podaną cenę.',
      en: "The brief of the Pre-session screen: the four numbers, today's Day map levels, the previous session's VAH, POC and VAL and the next open. With the level argument it checks a price you name.",
    },
    ask: { pl: 'Przygotuj mnie do otwarcia Londynu.', en: 'Prepare me for the London open.' },
  },
  {
    name: 'session_context',
    title: { pl: 'Sesja Londynu albo NY w toku', en: 'London or NY session now' },
    about: {
      pl: 'Sesja w toku: IB, typ dnia dotąd, oczekiwany zakres i budżet zakresu (MODEL), VWAP doby UTC i RVOL bieżącej godziny (MODEL). W godzinach azjatyckich godzina następnego otwarcia.',
      en: 'The session in progress: IB, day type so far, expected range and range budget (MODEL), the UTC-day VWAP and the RVOL of the current hour (MODEL). In Asian hours, the next open.',
    },
    ask: { pl: 'Co się dzieje teraz w sesji NY?', en: 'What is happening in the NY session right now?' },
  },
  {
    name: 'day_map',
    title: { pl: 'Mapa dnia z bloga HyperQuant', en: 'HyperQuant blog day map' },
    about: {
      pl: 'Poziomy dzisiejszej Mapy dnia z bloga: których cena dotknęła od wpisu i o której minucie, z pokryciem świec 1m.',
      en: "Today's blog Day map levels: which ones price has touched since the post and at which minute, with the 1m candle coverage.",
    },
    ask: { pl: 'Których poziomów z dzisiejszej Mapy dnia cena już dotknęła?', en: "Which levels of today's Day map has price touched?" },
  },
  {
    name: 'session_review',
    title: { pl: 'Rozliczenie sesji Londynu albo NY', en: 'London or NY session review' },
    about: {
      pl: 'Wiersze karty Rozliczenie sesji: typ dnia, migracja value area, wynik IB, zakres wobec oczekiwanego, dotknięte poziomy, likwidacje w sesji. Ostatnia sesja każdego typu.',
      en: 'The rows of the Session review card: day type, value area migration, IB result, range against the expected range, touched levels, liquidations in the session. The latest session of each type.',
    },
    ask: { pl: 'Jak poszła ostatnia sesja NY?', en: 'How did the last NY session go?' },
  },
  {
    name: 'liquidation_map',
    title: { pl: 'Mapa likwidacji BTC', en: 'BTC liquidation map' },
    about: {
      pl: 'Paliwo likwidacji w 1% i 3% pod ceną i nad nią, po 5 największych klastrów z każdej strony, pokrycie open interest i wiek migawki skanera.',
      en: 'Liquidation fuel within 1% and 3% below and above the price, the 5 largest clusters on each side, open interest coverage and the scanner snapshot age.',
    },
    ask: { pl: 'Gdzie są klastry likwidacji wokół ceny?', en: 'Where are the liquidation clusters around the price?' },
  },
  {
    name: 'liquidation_tape',
    title: { pl: 'Taśma likwidacji BTC', en: 'BTC liquidation tape' },
    about: {
      pl: 'Zrealizowane likwidacje śledzonych pozycji: sumy longów i shortów z godziny i doby oraz do 10 ostatnich zdarzeń, bez adresów.',
      en: 'Realised liquidations of tracked positions: 1 h and 24 h sums of longs and shorts and up to 10 latest events, without addresses.',
    },
    ask: { pl: 'Czy w ostatniej godzinie były duże likwidacje?', en: 'Were there large liquidations in the last hour?' },
  },
  {
    name: 'cohort_flow',
    title: { pl: 'Przepływ kohort BTC', en: 'BTC cohort flow' },
    about: {
      pl: 'Cztery kohorty uczestników (market makerzy, poinformowani, wieloryby, reszta): saldo, delta agresora, obrót i udział w obrocie z ostatniej godziny i doby.',
      en: 'Four participant cohorts (market makers, informed, whales, rest): net flow, aggressor delta, volume and volume share over the last hour and day.',
    },
    ask: { pl: 'Która kohorta była w ostatniej godzinie agresorem netto?', en: 'Which cohort has been the net taker in the last hour?' },
  },
  {
    name: 'whales',
    title: { pl: 'Wieloryby BTC', en: 'BTC whales' },
    about: {
      pl: 'Największe konta BTC pod pseudonimami ważnymi jedną dobę UTC: saldo longów i shortów, największe pozycje i grupy zleceń oczekujących.',
      en: 'The largest BTC accounts under pseudonyms valid for one UTC day: the balance of longs and shorts, the largest positions and groups of resting orders.',
    },
    ask: { pl: 'Jakie są teraz największe pozycje na BTC?', en: 'What are the largest BTC positions right now?' },
  },
  {
    name: 'twaps',
    title: { pl: 'Udział TWAP w taśmie BTC', en: 'TWAP share of the BTC tape' },
    about: {
      pl: 'Udział wypełnień z hashem zerowym (wśród nich podzlecenia TWAP) w wartości taśmy z ostatnich 15 i 60 minut, łącznie i po stronie agresora.',
      en: 'The share of zero-hash fills (TWAP suborders among them) in the tape value over the last 15 and 60 minutes, in total and per aggressor side.',
    },
    ask: { pl: 'Jaką część taśmy stanowią TWAP-y?', en: 'How much of the tape is TWAP flow?' },
  },
  {
    name: 'forecast_ledger',
    title: { pl: 'Dziennik prognoz HyperQuant', en: 'HyperQuant forecast ledger' },
    about: {
      pl: 'Wyniki weryfikowalnego dziennika prognoz: CRPSS, pokrycie przedziałów z testem Kupca, Brier i BSS dotknięć poziomów wobec odległości i wobec częstości oraz link do samodzielnej weryfikacji.',
      en: 'Scores of the verifiable forecast ledger: CRPSS, interval coverage with the Kupiec test, Brier score and BSS for level touches against distance and against the base rate, and a link to verify them yourself.',
    },
    ask: { pl: 'Jak dobrze skalibrowane są prognozy HyperQuant?', en: 'How well calibrated are the HyperQuant forecasts?' },
  },
];

export interface SkillRecipe {
  /** Angielski tytuł jak nagłówek przepisu w SKILL.md (bez numeru). */
  title: Text;
  /** Przykładowe pytanie; angielskie z linii „Asked as” przepisu. */
  ask: Text;
  /** Narzędzia, które przepis wywołuje. */
  tools: string[];
}

/** Pięć przepisów skilla w kolejności SKILL.md. */
export const SKILL_RECIPES: SkillRecipe[] = [
  {
    title: { pl: 'Przygotowanie do sesji Londynu albo Nowego Jorku', en: 'Prepare for the London or New York session' },
    ask: { pl: 'Przygotuj mnie do otwarcia Londynu', en: 'Prepare me for the London open' },
    tools: ['market_brief', 'session_context', 'day_map'],
  },
  {
    title: { pl: 'Co się dzieje teraz', en: 'What is happening now' },
    ask: { pl: 'Co się dzieje teraz w sesji NY?', en: 'What is happening in the NY session right now?' },
    tools: ['session_context', 'liquidation_tape', 'cohort_flow', 'twaps'],
  },
  {
    title: { pl: 'Rozliczenie ostatniej sesji', en: 'Review the last session' },
    ask: { pl: 'Jak poszła sesja londyńska?', en: 'How did the London session go?' },
    tools: ['session_review'],
  },
  {
    title: { pl: 'Sprawdzenie poziomu ceny', en: 'Check a price level' },
    ask: { pl: 'Co jest w okolicy 100 000?', en: 'What sits around 100,000?' },
    tools: ['market_brief'],
  },
  {
    title: { pl: 'Krótki wpis o rynku na X (Twitter)', en: 'Short market note for X (Twitter)' },
    ask: { pl: 'Napisz krótki wpis o BTC na X.', en: 'Write a short post about BTC for X.' },
    tools: ['market_brief', 'session_context'],
  },
];

export const SKILL_FILE = 'integrations/skills/hyperquant/SKILL.md';
export const MCP_README_FILE = 'mcp/README.md';

/** Plik repozytorium na GitHubie (gałąź main). */
export const githubUrl = (file: string): string => `https://github.com/rdemb/HyperQuant/blob/main/${file}`;
