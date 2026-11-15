import type { SessionId } from '../../charts/pro/core/sessions';
import { tr } from '../../i18n';
import type { Rule, RuleKind } from './straznicy';

/**
 * Załoga wyspy: każdy rodzaj strażnika ma postać-czasomierz (tarcza z oczami i emblematem swojej roboty; rysunek
 * w `Postac.tsx`). Postać to tylko twarz reguł danego rodzaju: reguły zostają w `magazyn.ts` jak dotąd. Częstość „zwykle
 * ok. N na dobę” pochodzi z kalibracji na danych historycznych (te same zasady co `straznicy.ts`: zdarzenie przy wejściu
 * ponad próg albo przecięciu poziomu, 10 min przerwy, ocena co minutę); `null` — brak historii do kalibracji.
 */

export type PersonaId = 'latarnik' | 'dzwonnik' | 'sejsmograf' | 'kotwicz' | 'iskra' | 'skarbnik' | 'sufler';

export interface Preset {
  kind: RuleKind;
  value?: number;
  session?: SessionId;
}

export interface Persona {
  id: PersonaId;
  name: string;
  /** Jedno zdanie: co pilnuje (stan rynku, nie kierunek). */
  role: string;
  /** Rodzaje reguł tej postaci (Sufler: brak, to przepisy dla agenta AI). */
  kinds: RuleKind[];
  /** Gotowe warunki jednym dotknięciem. */
  presets: Preset[];
  /** Częstość z kalibracji (opis) albo null, gdy nie ma historii. */
  freq: string | null;
  /** Zastrzeżenie przy postaci (źródło danych, opóźnienie, rzadkość). */
  note?: string;
}

/** Kalibracja z 60 dni do 15.11.2026: Binance fapi BTCUSDT 1m (ruch, PDH/PDL z dób UTC), Hyperliquid fundingHistory BTC. */
export const KALIBRACJA = { dni: 60, do: '2026-11-15' } as const;

export const PERSONY: Persona[] = [
  {
    id: 'latarnik',
    name: tr('Latarnik', 'Lighthouse'),
    role: tr('Świeci na wczorajszy szczyt i dołek (PDH, PDL) i daje znać, gdy cena przez nie przechodzi.', 'Shines on yesterday’s high and low (PDH, PDL) and tells you when price passes through them.'),
    kinds: ['pdh', 'pdl'],
    presets: [{ kind: 'pdh' }, { kind: 'pdl' }],
    freq: tr('zwykle ok. 3,4 przecięcia PDH i 2,7 PDL na dobę', 'usually about 3.4 PDH and 2.7 PDL crosses a day'),
  },
  {
    id: 'dzwonnik',
    name: tr('Dzwonnik', 'Bell-ringer'),
    role: tr('Dzwoni na otwarcie sesji: Azji, Londynu i Nowego Jorku.', 'Rings at each session open: Asia, London and New York.'),
    kinds: ['sesja'],
    presets: [
      { kind: 'sesja', session: 'london' },
      { kind: 'sesja', session: 'ny' },
      { kind: 'sesja', session: 'asia' },
    ],
    freq: tr('raz na dobę na każdą wybraną sesję', 'once a day for each chosen session'),
  },
  {
    id: 'sejsmograf',
    name: tr('Sejsmograf', 'Seismograph'),
    role: tr('Mierzy, jak mocno cena ruszyła się w ostatnich 15 minutach, w obie strony.', 'Measures how hard price has moved in the last 15 minutes, either way.'),
    kinds: ['ruch'],
    presets: [{ kind: 'ruch', value: 1 }],
    freq: tr('przy progu 1%: zwykle ok. 1,1 na dobę (0,75%: ok. 2,3)', 'at 1%: usually about 1.1 a day (0.75%: about 2.3)'),
  },
  {
    id: 'kotwicz',
    name: tr('Kotwicz', 'Anchor'),
    role: tr('Trzyma wybrany przez Ciebie poziom ceny i daje znać, gdy cena przez niego przechodzi.', 'Holds a price level you choose and tells you when price passes through it.'),
    kinds: ['poziom'],
    presets: [],
    freq: null,
    note: tr('Częstość zależy od poziomu. Przy zamkniętej stronie poziomu pilnuje alarm ceny 24/7 na wykresie (W sesji, dzwonek).', 'How often depends on the level. With the page closed, a 24/7 price alert on the chart watches the level (In session, bell).'),
  },
  {
    id: 'iskra',
    name: tr('Iskra', 'Spark'),
    role: tr('Liczy likwidacje BTC z ostatnich 5 minut na Binance, Bybit i OKX.', 'Counts BTC liquidations from the last 5 minutes on Binance, Bybit and OKX.'),
    kinds: ['likwidacje'],
    presets: [{ kind: 'likwidacje', value: 3_000_000 }],
    freq: null,
    note: tr(
      'Hyperliquid nie publikuje strumienia likwidacji, więc Iskra słucha strumieni Binance, Bybit i OKX (włączane w ustawieniach). Giełdy publikują tylko część likwidacji; częstości nie da się skalibrować z publicznej historii.',
      'Hyperliquid does not publish a liquidation stream, so Spark listens to the Binance, Bybit and OKX streams (turned on in settings). Exchanges publish only part of their liquidations; the frequency cannot be calibrated from public history.'
    ),
  },
  {
    id: 'skarbnik',
    name: tr('Skarbnik', 'Treasurer'),
    role: tr('Pilnuje fundingu Hyperliquid w skali roku i budzi się, gdy wychodzi poza zwykły poziom.', 'Watches the Hyperliquid funding rate per year and wakes up when it leaves its usual level.'),
    kinds: ['funding'],
    presets: [{ kind: 'funding', value: 15 }],
    freq: tr('rzadko: przy progu 15% ok. raz na 2 tygodnie (zwykle funding stoi przy ok. 11% rocznie)', 'rarely: at 15% about once in 2 weeks (funding usually sits near 11% a year)'),
  },
  {
    id: 'sufler',
    name: tr('Sufler', 'Prompter'),
    role: tr('Podsuwa gotowe pytania dla Twojego agenta AI (Claude, ChatGPT, OpenBot) przez serwer MCP HyperQuant.', 'Hands your AI agent (Claude, ChatGPT, OpenBot) ready-made questions through the HyperQuant MCP server.'),
    kinds: [],
    presets: [],
    freq: null,
  },
];

export const STRAZNICY = PERSONY.filter((p) => p.kinds.length > 0);

export const personaOf = (kind: RuleKind): Persona => STRAZNICY.find((p) => p.kinds.includes(kind))!;

/** Stan postaci: śpi (brak włączonych reguł, pauza albo brak danych), czuwa, alarm (zdarzenie przed chwilą). */
export type PersonaState = 'spi' | 'czuwa' | 'alarm';

export function personaState(p: Persona, rules: readonly Rule[], opts: { paused: boolean; live: boolean; alarmIds: ReadonlySet<string>; cex: boolean }): PersonaState {
  const mine = rules.filter((r) => p.kinds.includes(r.kind));
  if (mine.some((r) => opts.alarmIds.has(r.id))) return 'alarm';
  if (opts.paused || !opts.live || !mine.some((r) => r.on)) return 'spi';
  if (p.id === 'iskra' && !opts.cex) return 'spi';
  return 'czuwa';
}
