import React from 'react';
import { Badge, BadgeTone, Panel } from '../../ui';

type Kind = 'LIVE' | 'MODEL' | 'SIM';
const KIND_TONE: Record<Kind, BadgeTone> = { LIVE: 'live', MODEL: 'model', SIM: 'sim' };
const KIND_TITLE: Record<Kind, string> = {
  LIVE: 'Realne dane ze źródła',
  MODEL: 'Wynik modelu liczony z realnych danych — metoda w kolumnie obok',
  SIM: 'Symulacja — tylko w trybie modelu, zawsze oznaczona',
};

interface Row {
  metric: string;
  source: string;
  method: string;
  kinds: Kind[];
  refresh: string;
  /** Zastrzeżenie metodologiczne (literatura, ograniczenia) */
  caveat?: string;
}

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: 'Hyperliquid — rdzeń desku',
    rows: [
      {
        metric: 'Świece OHLCV BTC-PERP',
        source: 'Hyperliquid API: candleSnapshot (REST) + WS trades',
        method: 'OHLC i wolumen z REST; bieżąca świeca domykana transakcjami z WS (rollover po czasie transakcji)',
        kinds: ['LIVE'],
        refresh: 'REST 15 s (10 s bez WS) · WS na żywo',
      },
      {
        metric: 'Księga L2',
        source: 'Hyperliquid WS l2Book (REST, gdy WS niedostępny)',
        method: 'Poziomy i wielkości wprost z API, bez mnożników',
        kinds: ['LIVE'],
        refresh: 'na żywo',
      },
      {
        metric: 'Taśma transakcji',
        source: 'Hyperliquid WS trades',
        method: 'Strona agresora z pola side; rozmiar = cena·ilość, bez podłóg',
        kinds: ['LIVE'],
        refresh: 'na żywo',
      },
      {
        metric: 'Open interest, funding, mark/oracle',
        source: 'Hyperliquid API: metaAndAssetCtxs',
        method: 'Wartości wprost z API; basis = (mark − oracle) / oracle',
        kinds: ['LIVE'],
        refresh: '10–15 s',
      },
      {
        metric: 'Funding Binance / Bybit',
        source: 'Hyperliquid API: predictedFundings',
        method: 'Przewidywane stawki innych giełd publikowane przez HL (bez łączenia z CEX); APR = stawka·(24/interwał)·365',
        kinds: ['LIVE'],
        refresh: '60 s',
      },
      {
        metric: 'Proxy makro (HIP-3)',
        source: 'Hyperliquid HIP-3 (dex xyz): indeksy, złoto, ropa, FX',
        method: 'Ceny mark rynków HIP-3; β i R² do BTC z dopasowanych zwrotów logarytmicznych',
        kinds: ['LIVE', 'MODEL'],
        refresh: '60 s · świece 5 min',
        caveat: 'Lista rynków HIP-3 rozwiązywana w runtime — rynek może zniknąć.',
      },
    ],
  },
  {
    title: 'Modele liczone z danych',
    rows: [
      {
        metric: 'CVD (spot / perp)',
        source: 'Świece HL + transakcje WS (+ CEX, jeśli włączone)',
        method: 'Świece obserwowane przez WS: realna strona agresora; pozostałe: BVC V_B = V·Φ(ΔP/σ) (Easley, López de Prado, O’Hara 2012)',
        kinds: ['LIVE', 'MODEL'],
        refresh: 'z każdą świecą',
      },
      {
        metric: 'VPIN',
        source: 'Świece HL (podział WS lub BVC)',
        method: '50 kubełków o równym wolumenie; VPIN = średnia |V_B − V_S| / V',
        kinds: ['MODEL'],
        refresh: 'z każdą świecą',
        caveat: 'Kontrowersyjny — Andersen & Bondarenko (2014): słaba moc prognostyczna, zależność od klasyfikacji wolumenu.',
      },
      {
        metric: 'λ Kyle’a',
        source: 'Świece z realnym przepływem agresora (WS)',
        method: 'OLS ΔP = λ·Q + ε; na świecach BVC brak wyniku (regresja byłaby kołowa)',
        kinds: ['MODEL'],
        refresh: 'z każdą świecą',
      },
      {
        metric: 'Wykładnik Hursta',
        source: 'Zwroty z zamknięć świec HL',
        method: 'R/S z korektą Anis-Lloyd (Peters); próg trendu z symulacji szumu',
        kinds: ['MODEL'],
        refresh: 'z każdą świecą',
        caveat: 'Lo (1991): klasyczne R/S myli krótką pamięć z długą.',
      },
      {
        metric: 'Ornstein-Uhlenbeck',
        source: 'Zamknięcia świec HL',
        method: 'OLS ΔX na X (dyskretny AR(1)); półokres = ln 2 / θ; brak wartości zastępczej',
        kinds: ['MODEL'],
        refresh: 'z każdą świecą',
      },
      {
        metric: 'Monte Carlo (Merton)',
        source: 'Świece HL, poziomy PDH/PDL/D-EQ',
        method: '600 ścieżek, krok 1 min, horyzont 2 h; σ Parkinsona z bieżących świec; skoki log-normalne z korektą martyngałową (20% wariancji — założenie)',
        kinds: ['MODEL'],
        refresh: 'z każdą świecą',
      },
      {
        metric: 'Heatmapa likwidacji',
        source: 'Ekstrema świec HL',
        method: 'Teoretyczne ceny likwidacji dla dźwigni 5× / 20× / 100× od ekstremów świec',
        kinds: ['MODEL'],
        refresh: 'z każdą świecą',
        caveat: 'Szacunek, nie pozycje — giełdy nie publikują rozkładu dźwigni.',
      },
      {
        metric: 'Order blocks',
        source: 'Świece HL',
        method: 'Świeca impulsu > k·ATR(14), strefa świeża / zmitygowana (Shaakuni)',
        kinds: ['MODEL'],
        refresh: 'z każdą świecą',
        caveat: 'Heurystyka bez walidacji statystycznej.',
      },
      {
        metric: 'Opcje 3D (Lab)',
        source: 'Cena BTC z HL',
        method: 'Ręcznie sparametryzowany uśmiech IV + Black-Scholes (greki)',
        kinds: ['MODEL'],
        refresh: 'z ceną',
        caveat: 'Ilustracja — brak danych opcyjnych (bez GEX, max pain, zero-gamma).',
      },
    ],
  },
  {
    title: 'Dane publiczne',
    rows: [
      {
        metric: 'Kalendarz makro',
        source: 'Fed (FOMC), BLS (CPI, NFP, PPI), BEA (PKB, PCE)',
        method: 'Oficjalne harmonogramy publikacji; czas ET → UTC z regułą DST',
        kinds: ['LIVE'],
        refresh: 'harmonogram w kodzie · BEA z potoku',
      },
      {
        metric: 'Wiadomości',
        source: 'RSS: CoinDesk, Cointelegraph, Decrypt, The Block, Bitcoin Magazine, Fed, BLS, SEC',
        method: 'Tylko nagłówek, czas i link do wydawcy; kategoria ze słów kluczowych',
        kinds: ['LIVE'],
        refresh: 'potok · co 10 min',
      },
      {
        metric: 'Makro i płynność USD',
        source: 'U.S. Treasury (rentowności, TGA przez FiscalData), NY Fed (reverse repo), CFTC (COT, BTC CME)',
        method: 'Wartości wprost ze źródeł; COT: pozycje netto long − short',
        kinds: ['LIVE'],
        refresh: 'dziennie (COT tyg.) · co 10 min',
      },
      {
        metric: 'Fear & Greed, ton mediów',
        source: 'alternative.me; GDELT DOC 2.0 (Timeline Tone)',
        method: 'Indeks i ton wprost ze źródeł',
        kinds: ['LIVE'],
        refresh: 'dziennie · co 10 min',
      },
      {
        metric: 'On-chain (opłaty, trudność, hashrate)',
        source: 'mempool.space REST API',
        method: 'Wartości wprost z API',
        kinds: ['LIVE'],
        refresh: 'potok · co 10 min',
      },
    ],
  },
  {
    title: 'Opcjonalne (opt-in w tej przeglądarce)',
    rows: [
      {
        metric: 'Transakcje i likwidacje CEX',
        source: 'Binance Futures (USDT-M) i Spot, Bybit Linear, OKX Swap, Coinbase — publiczne WebSockety',
        method: 'Strona agresora wg dokumentacji giełdy; OKX: kontrakty × 0,01 BTC; drobne transakcje sumowane w paczkach 250 ms',
        kinds: ['LIVE'],
        refresh: 'na żywo (domyślnie wyłączone)',
      },
    ],
  },
];

/** Rodowód liczb: skąd pochodzi każda metryka, jak jest liczona i czy to dane, model czy symulacja. */
export const LineageTable: React.FC = () => (
  <Panel eyebrow="Rodowód liczb" title="Skąd pochodzi każda liczba" bodyClassName="flex flex-col">
    <p className="px-4 pt-3 text-xs text-ink-3 leading-relaxed max-w-prose">
      LIVE — realne dane; MODEL — wynik modelu z realnych danych (metoda obok); SIM — symulacja. Brak danych zawsze jako „—”, nigdy liczba
      zastępcza.
    </p>
    <div className="m-4 mt-3 overflow-x-auto border border-line rounded-lg" tabIndex={0} role="region" aria-label="Tabela rodowodu danych (przewijana)">
      <table className="w-full min-w-[820px] text-left text-xs">
        <thead className="bg-surface-2 text-[11px] uppercase tracking-[0.08em] text-ink-3">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium w-[17%] sticky left-0 z-10 bg-surface-2">Metryka</th>
            <th scope="col" className="px-3 py-2 font-medium w-[24%]">Źródło</th>
            <th scope="col" className="px-3 py-2 font-medium">Metoda</th>
            <th scope="col" className="px-3 py-2 font-medium w-[9%]">Typ</th>
            <th scope="col" className="px-3 py-2 font-medium w-[13%]">Odświeżanie</th>
          </tr>
        </thead>
        {GROUPS.map((g) => (
          <tbody key={g.title} className="divide-y divide-line border-t border-line">
            <tr>
              <th scope="colgroup" colSpan={5} className="px-3 pt-3 pb-1.5 text-[11px] uppercase tracking-[0.08em] text-ink-2 font-semibold bg-surface-1">
                <span className="sticky left-3">{g.title}</span>
              </th>
            </tr>
            {g.rows.map((r) => (
              <tr key={r.metric} className="align-top hover:bg-surface-2/60 transition-colors duration-150">
                <th scope="row" className="px-3 py-2 font-medium text-ink-1 sticky left-0 z-10 bg-surface-1 max-lg:shadow-[1px_0_0_var(--color-line)]">{r.metric}</th>
                <td className="px-3 py-2 text-ink-2">{r.source}</td>
                <td className="px-3 py-2 text-ink-2 leading-relaxed">
                  {r.method}
                  {r.caveat && (
                    <span className="block mt-1 text-ink-3">
                      <span className="text-warn" aria-hidden="true">⚠ </span>
                      <span className="sr-only">Zastrzeżenie: </span>
                      {r.caveat}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-1">
                    {r.kinds.map((k) => (
                      <Badge key={k} tone={KIND_TONE[k]} title={KIND_TITLE[k]}>
                        {k}
                      </Badge>
                    ))}
                  </span>
                </td>
                <td className="px-3 py-2 text-ink-2">{r.refresh}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  </Panel>
);
