// Rynki desku w jednym miejscu (projekt 60, M1): z tej listy czytają aplikacja (wybór rynku, Rynki, Start, nagłówek),
// index.html i manifest (wtyczka Vite), README (scripts/markets/sync.mjs) i blog. Nowy rynek = nowy wpis tutaj.
// Tylko składnia TS usuwalna bez kompilacji (Node czyta ten plik wprost w skryptach i na serwerze).

export type DeskMarketSlug = 'btc' | 'gold' | 'sp500' | 'brent';
export type DeskMarketClass = 'crypto' | 'commodity' | 'index';
/** Kalendarz rynku bazowego: krypto bez przerw, CME (metale), NYSE z futures CME poza sesją, ICE (ropa Brent). */
export type UnderlyingCalendar = 'crypto' | 'cme' | 'nyse+cme' | 'ice';

export interface DeskMarket {
  slug: DeskMarketSlug;
  /** Nazwa rynku na Hyperliquid (giełda HIP-3 z przedrostkiem `dex:`). */
  coin: string;
  dex: '' | 'xyz';
  class: DeskMarketClass;
  /** Nazwa w zdaniu: PL mianownik i dopełniacz, EN. */
  name: { pl: { nom: string; gen: string }; en: string };
  /** Krótka etykieta (nagłówek, karty). */
  label: string;
  /** Pełna nazwa instrumentu w kartach. */
  full: { pl: string; en: string };
  szDecimals: number;
  maxLeverage: number;
  scanner: 'full' | 'none';
  underlying: {
    /** Co wycenia wyrocznia (opis dla użytkownika). */
    ref: { pl: string; en: string };
    calendar: UnderlyingCalendar;
    /** Sesja regularna rynku bazowego (np. NYSE 9:30–16:00 ET). */
    rth?: { open: string; close: string; tz: string };
  };
  /** Katalog historii taśmy w repo danych (bez dwukropka: checkout na Windows). */
  historyDir: string;
  /** Progi wstępne jakości na żywo (projekt 60, Q3), w punktach bazowych i sekundach. */
  quality: { markOracleOkBp: number; markOracleBadBp: number; spreadOkBp: number; spreadBadBp: number; oracleStaleSec: number };
  enabled: boolean;
}

const HIP3_QUALITY = { markOracleOkBp: 10, markOracleBadBp: 30, spreadOkBp: 3, spreadBadBp: 10, oracleStaleSec: 60 };

export const DESK_MARKETS: readonly DeskMarket[] = [
  {
    slug: 'btc',
    coin: 'BTC',
    dex: '',
    class: 'crypto',
    name: { pl: { nom: 'BTC', gen: 'BTC' }, en: 'BTC' },
    label: 'BTC',
    full: { pl: 'Bitcoin', en: 'Bitcoin' },
    szDecimals: 5,
    maxLeverage: 40,
    scanner: 'full',
    underlying: { ref: { pl: 'kontrakt wieczysty BTC na Hyperliquid', en: 'the BTC perpetual on Hyperliquid' }, calendar: 'crypto' },
    historyDir: 'BTC',
    quality: { markOracleOkBp: 10, markOracleBadBp: 30, spreadOkBp: 2, spreadBadBp: 6, oracleStaleSec: 60 },
    enabled: true,
  },
  {
    slug: 'gold',
    coin: 'xyz:GOLD',
    dex: 'xyz',
    class: 'commodity',
    name: { pl: { nom: 'złoto', gen: 'złota' }, en: 'gold' },
    label: 'GOLD',
    full: { pl: 'Złoto', en: 'Gold' },
    szDecimals: 4,
    maxLeverage: 25,
    scanner: 'none',
    underlying: { ref: { pl: 'złoto spot XAU/USD', en: 'spot gold XAU/USD' }, calendar: 'cme' },
    historyDir: 'xyz-GOLD',
    quality: HIP3_QUALITY,
    enabled: true,
  },
  {
    slug: 'sp500',
    coin: 'xyz:SP500',
    dex: 'xyz',
    class: 'index',
    name: { pl: { nom: 'S&P 500', gen: 'S&P 500' }, en: 'the S&P 500' },
    label: 'S&P 500',
    full: { pl: 'S&P 500', en: 'S&P 500' },
    szDecimals: 3,
    maxLeverage: 50,
    scanner: 'none',
    underlying: {
      ref: { pl: 'indeks S&P 500 w sesji NYSE, poza nią futures', en: 'the S&P 500 index during NYSE hours, futures outside them' },
      calendar: 'nyse+cme',
      rth: { open: '09:30', close: '16:00', tz: 'America/New_York' },
    },
    historyDir: 'xyz-SP500',
    quality: HIP3_QUALITY,
    enabled: true,
  },
  {
    // Brent później (projekt 60 §6): rolowanie, ostatnie połączenie WS, kalendarz ICE niepotwierdzony
    slug: 'brent',
    coin: 'xyz:BRENTOIL',
    dex: 'xyz',
    class: 'commodity',
    name: { pl: { nom: 'ropa Brent', gen: 'ropy Brent' }, en: 'Brent crude' },
    label: 'BRENT',
    full: { pl: 'Ropa Brent', en: 'Brent crude' },
    szDecimals: 2,
    maxLeverage: 20,
    scanner: 'none',
    underlying: { ref: { pl: 'futures Brent z rolowaniem', en: 'Brent futures with rolling' }, calendar: 'ice' },
    historyDir: 'xyz-BRENTOIL',
    quality: HIP3_QUALITY,
    enabled: false,
  },
];

/** Rynki włączone w aplikacji, w kolejności konfiguracji. */
export const ENABLED_MARKETS: readonly DeskMarket[] = DESK_MARKETS.filter((m) => m.enabled);

export const isHip3DeskMarket = (coin: string): boolean => coin === 'xyz:GOLD' || coin === 'xyz:SP500';

/** Wpis konfiguracji dla rynku Hyperliquid; null poza listą. */
export function deskMarketOf(coin: string): DeskMarket | null {
  return DESK_MARKETS.find((m) => m.coin === coin) ?? null;
}

/** Etykieta rynku (nagłówek, karty): z konfiguracji, a poza nią nazwa bez przedrostka giełdy. */
export function marketLabel(coin: string): string {
  return deskMarketOf(coin)?.label ?? coin.replace(/^[a-z]+:/, '');
}

/**
 * Lista nazw rynków włączonych w zdaniu, z „i” / „and” przed ostatnią: PL mianownik „BTC, złoto i S&P 500”,
 * dopełniacz „BTC, złota i S&P 500”; EN „BTC, gold and the S&P 500”.
 */
export function deskPhrase(lang: 'pl' | 'en', kase: 'nom' | 'gen' = 'nom', markets: readonly DeskMarket[] = ENABLED_MARKETS): string {
  const names = markets.map((m) => (lang === 'pl' ? m.name.pl[kase] : m.name.en));
  if (names.length <= 1) return names[0] ?? '';
  const and = lang === 'pl' ? ' i ' : ' and ';
  return `${names.slice(0, -1).join(', ')}${and}${names.at(-1)}`;
}

/** Krótkie etykiety rozdzielone kropką: „BTC · GOLD · S&P 500”. */
export function deskLabels(markets: readonly DeskMarket[] = ENABLED_MARKETS): string {
  return markets.map((m) => m.label).join(' · ');
}
