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
        metric: 'Model zmienności',
        source: 'Hyperliquid API: candleSnapshot BTC 1h (~5000 ≈ 208 dni) i 5m (~5000 ≈ 17 dni)',
        method:
          'Sezonowy log-HAR (Corsi 2009) na godzinowych wariancjach Garman–Klass z profilem godzin UTC i korektą Duana; innowacje FHS ze standaryzowanych zwrotów 5m; udział skoków (wariancja dwupotęgowa) i test Lee–Mykland jako diagnostyka; trafność: QLIKE poza próbą vs średnia 24 h',
        kinds: ['MODEL'],
        refresh: 'co 60 min',
        caveat: 'Brak danych → σ Parkinsona z bieżących świec, oznaczona jako zapas.',
      },
      {
        metric: 'Monte Carlo — zasięg 2 h i Analizator planu',
        source: 'Model zmienności, świece HL, poziomy PDH/PDL/D-EQ, arkusz L2',
        method:
          '2000 ścieżek, krok 5 min (σ z HAR, innowacje FHS), korekta mostu Browna; Analizator: faza wypełnienia od bieżącej ceny i wynik warunkowy jak w dzienniku. Wspólne liczby losowe w obrębie minuty — w tej minucie wynik zmienia się płynnie z ceną; co minutę nowe ścieżki (błąd standardowy ≤ 1.1 pp)',
        kinds: ['MODEL'],
        refresh: 'z każdą synchronizacją',
        caveat: 'Bez modelu zmienności: Merton z założonym udziałem skoków 20%, krok 1 min (oznaczone w pasku).',
      },
      {
        metric: 'Mapa likwidacji (pozycje on-chain)',
        source:
          'Skaner HyperQuant: adresy z WS trades (pole users) i z publicznego rankingu kont Hyperliquid → clearinghouseState każdego portfela; publikacja przez publiczne repo danych na GitHubie (rdemb/hyperquant-data)',
        method:
          'Kubełki ceny likwidacji (krok ~0.1% ceny) dla longów i shortów, nominał |szi|·cena likwidacji; pokrycie = Σ|szi| / (2·OI); tylko agregaty, bez adresów',
        kinds: ['LIVE'],
        refresh: 'mapa co 2 min (repo danych + cache GitHuba do 5 min); cel odczytu: pozycje ≥ 1 mln USD co 2 min, ≥ 100 tys. co 10 min, cena likwidacji < 1% od mark co 1 min — faktyczny wiek (mediana ważona nominałem) w panelu',
        caveat: 'Portfele nieaktywne od startu skanera nie są na mapie; cena likwidacji pozycji cross zmienia się z całym kontem.',
      },
      {
        metric: 'Zrealizowane likwidacje (taśma 24 h)',
        source: 'Skaner HyperQuant: śledzone pozycje → userFillsByTime konta (pole liquidation: markPx, metoda market/backstop)',
        method:
          'Kandydat: pozycja zmalała, a cena z taśmy od poprzedniego odczytu weszła w pasmo ceny likwidacji (do 0.5% przed poziomem z mapy); zdarzenie tylko po potwierdzeniu fillem likwidacyjnym; błąd mapy = mark przy likwidacji vs cena likwidacji z ostatniego odczytu',
        kinds: ['LIVE'],
        refresh: 'co 2 min z mapą; potwierdzenia do 3 zapytań/min (tylko przy pełnym tempie API)',
        caveat: 'Hyperliquid nie publikuje likwidacji wszystkich kont — tylko zmierzona część open interest; bez adresów, czas do minuty, rozmiar zaokrąglony, opóźnienie do kilku minut.',
      },
      {
        metric: 'Weryfikowalny dziennik desku',
        source: 'Skaner HyperQuant: model zmienności ze świec 1h/5m, PDH/PDL ze świec 1d, rozstrzygnięcia ze świec 1m (publiczne API Hyperliquid); gałąź ledger repo danych',
        method:
          'Co 15 min przed faktem (horyzont od pełnej minuty po wydaniu): 13 kwantyli log-zwrotu 1 h / 4 h (HAR + FHS, MC 4000 ścieżek) z benchmarkiem normalnym i α ACI; P(dotknięcia PDH/PDL/D-EQ w 2 h); 5–10 min przed końcem slotu p modelu, notowanie 15-minutowego rynku HIP-4 i p ensemble (pooling logarytmiczny z wagami z wcześniej rozstrzygniętych pytań; Brier wszystkich trzech, różnice z bootstrapem). Wyniki: CRPS(S), PIT, Kupiec (podpróba rozłączna), ACI, Brier/BSS (klimatologia poziomów), Venn–Abers; łańcuch SHA-256 tylko dopisywany, pokwitowanie OpenTimestamps po każdym slocie',
        kinds: ['MODEL'],
        refresh: 'prognozy co 15 min; podsumowanie przy każdej zmianie (najwyżej co 15 min bez zmian)',
        caveat: 'Wyniki od 20 rozstrzygnięć; prognozy nakładają się (wyniki skorelowane); brak danych 6 h po horyzoncie = jawne unieważnienie; pominięte sloty jawne; znaczniki czasu potwierdzają istnienie zapisu, nie poprawność modelu.',
      },
      {
        metric: 'Płynność arkusza w ciągu doby (Mikrostruktura)',
        source: 'Skaner HyperQuant: WS l2Book Hyperliquid zagregowany w koszyki dobierane do ceny (~10–20 USD), co ~5 s; plik liquidity/BTC.json w repo danych',
        method:
          'Głębokość obu stron w ±10 i ±20 bp od środka z każdej migawki, minutowe mediany (30 dni na serwerze); mediana wg godziny UTC; bieżąca minuta / mediana jej godziny; odporność: po minucie z ruchem środka ≥ 15 bp — minuty do powrotu głębokości ±10 bp do 80% mediany z poprzedniej godziny',
        kinds: ['LIVE'],
        refresh: 'profil co 10 min',
        caveat: 'Historia od uruchomienia rejestratora (rośnie do 30 dni); godzina z mniej niż 30 min danych wyszarzona; widoczne zlecenia — bez ukrytych i szybko anulowanych.',
      },
      {
        metric: 'Laboratorium folkloru (Plan)',
        source: 'Skaner HyperQuant: archiwum świec BTC 1h/1d i godzinowego finansowania z candleSnapshot / fundingHistory Hyperliquid (gałąź archive repo danych); katalog reguł zapisany w gałęzi ledger; plik lab/BTC.json',
        method:
          'Zdarzenie z dwiema barierami startujące na zamknięciu świecy 1h; p0 z twierdzenia o opcjonalnym zatrzymaniu (cena = martyngał), reguły kalendarzowe p0 = 0,5 z symetrii; limit czasu → wynik ułamkowy (E = p0 pod H0); historia: p z wariancją pod H0, q Benjaminiego–Hochberga; do przodu (≥ 24 h po prerejestracji): proces zakładów aGRAPA, e-BH 5% osobno dla potwierdzeń i obaleń, sekwencja ufności 90%',
        kinds: ['LIVE'],
        refresh: 'archiwum co 10 min, ocena co godzinę',
        caveat: 'Historia to eksploracja (definicje znane po fakcie); rozstrzyga ocena do przodu, która rośnie powoli (reguły tygodniowe — lata). Świeca dotykająca obu barier odrzucana; pomiar statystyczny, nie sygnał — efekt ≠ zysk po kosztach.',
      },
      {
        metric: 'Dziennik zagrań i playbook (Plan)',
        source: 'Twoje wpisy w tej przeglądarce (localStorage, nic nie jest wysyłane) + świece BTC 1m i 1h z candleSnapshot Hyperliquid',
        method:
          'Wynik w R od stopu początkowego; MAE/MFE w R z minimum/maksimum świec 1m w oknie zagrania; kontekst aukcji przy wejściu tą samą metodą co panel „Kontekst aukcji”; per setup: trafność z przedziałem Wilsona 95%, średnie R z bootstrapem 90% (2000 losowań, stałe ziarno), profit factor, mediany MAE wygranych i MFE przegranych',
        kinds: ['LIVE'],
        refresh: 'przy zapisie zagrania',
        caveat: 'Świeca minuty wejścia może zawierać ceny sprzed wejścia (przybliżenie do minuty); MAE/MFE i kontekst tylko dla zagrań z ostatnich ~3,5 doby (limit API); poniżej 20 zagrań — anegdota, nie statystyka.',
      },
      {
        metric: 'Model vs rynek (HIP-4, Rynek)',
        source: 'outcomeMeta i l2Book rynków wynikowych Hyperliquid (strona „Tak” = arkusz #<10·outcome>); model zmienności desku (świece 1h/5m)',
        method:
          'Rynki BTC: cena powyżej progu w terminie (dzienny Recurring — mark HyperCore o 06:00 UTC; binaryPrice — mark, transakcja HL albo Pyth) i dotknięcie poziomu do terminu (priceTouch). Rynek: bid/ask/środek, płynny przy spreadzie ≤ 5 pp i ≥ 50 USDC w zleceniach do ±5 pp od środka po obu stronach. Model: 2000 ścieżek log-ceny (σ sezonowego log-HAR, innowacje FHS, krok 5/15/60 min, cena jako martyngał), dotknięcie z dokładnym ekstremum mostu Browna; Web Worker',
        kinds: ['LIVE', 'MODEL'],
        refresh: 'lista rynków co 10 min; arkusze i model co minutę',
        caveat: 'Cena rynku to nie czyste prawdopodobieństwo (premia za ryzyko, płynność); źródła cen rozliczenia różnią się od świec modelu; powyżej 14 dni brak wartości modelu. Porównanie kalibracji, nie sygnał.',
      },
      {
        metric: 'Kontekst aukcji (Plan, kafel na Desku)',
        source: 'Świece BTC 1m (bieżąca i poprzednia sesja UTC) i 1h (~5000 ≈ 208 dni) z candleSnapshot Hyperliquid',
        method:
          'Sesja = dzień UTC. VWAP z ceny typowej ważonej wolumenem i pasma ±1σ/±2σ; Initial Balance 00:00–01:00 UTC z rozszerzeniami 1,5×/2×; profil poprzedniej sesji (wolumen świecy rozłożony w jej zakresie, koszyki 10 USD, VA 70%); słaby szczyt/dno = ekstremum w ≥ 2 oknach 30 min (≤ 0,02%). Częstości z pełnych sesji 1h: wybicia IB, reguła 80%, przebicie słabych vs mocnych ekstremów (różnica Newcombe’a), dotknięcie PDH/PDL wg otwarcia; przedziały Wilsona 95%',
        kinds: ['LIVE'],
        refresh: 'świece 1m co minutę, 1h co 30 min',
        caveat: 'Cena typowa przybliża ceny transakcji; w statystyce z 1h profil i słabość ekstremów są przybliżone; poniżej 30 sesji „—”. Opis przeszłości, nie prognoza ani sygnał.',
      },
      {
        metric: 'Mechanika arkusza (Mikrostruktura)',
        source: 'WS bbo (najlepsze kwotowania, ~co 150 ms), l2Book (~co 5 s) i trades Hyperliquid w przeglądarce — od otwarcia strony, maks. 30 min',
        method:
          'OFI Cont–Kukanov–Stoikov w interwałach 10 s i regresja ΔP = α + β·OFI; Hawkes z jądrem wykładniczym (MLE, zdarzenie = blok z transakcjami), współczynnik rozgałęzienia n = α/β; mikrocena: średnia ważona i korekta wg nierównowagi (zmiana mid po 5 s); dodane/anulowane/wykonane z bilansu migawek ±10 bp; absorpcja = reszta odpornej regresji ΔP na wolumenie agresora',
        kinds: ['LIVE', 'MODEL'],
        refresh: 'co 5 s; Hawkes co ~30 s',
        caveat: 'Brak historii arkusza w publicznym API — estymatory dojrzewają po kilku minutach; dodania i anulowania to bilans netto między migawkami.',
      },
      {
        metric: 'Przepływ agresora per poziom (DOM) i detektor wyczerpania',
        source: 'Ostatnia migawka arkusza i transakcje HL z 60 s',
        method: 'Wolumen agresora przypisany do poziomu wg odległości ceny; stany absorpcji/wyczerpania z ręcznie dobranych progów (B/S, rozmiar ściany)',
        kinds: ['MODEL'],
        refresh: 'z każdą migawką arkusza',
        caveat: 'Heurystyka bez walidacji statystycznej — obok pokazywana jest absorpcja z regresji (mechanika arkusza).',
      },
      {
        metric: 'Przepływ kohort',
        source: 'Skaner HyperQuant: WS trades BTC (pole users = [kupujący, sprzedający], side = strona agresora); pozycje i ranking kont z książki adresów',
        method:
          'Kohorty: market makerzy (≥ 80% nominału jako maker, ≥ 1 mln USD), poinformowani (markout 5 min istotnie > 0: test jednostronny, n ≥ 30, FDR Benjamini–Hochberg q = 10%, empiryczny Bayes), wieloryby (pozycja ≥ 1 mln USD lub konto ≥ 10 mln USD), reszta; netto = kupno − sprzedaż wszystkich fillów (suma po kohortach = 0), agresor = fille biorcy; markouty 1/5/60 min poza próbą',
        kinds: ['LIVE', 'MODEL'],
        refresh: 'co 2 min z mapą; kubełki 15 min; klasyfikacja co 10 min',
        caveat: 'Wyłącznie agregaty z zamkniętych kubełków; komórki z < 5 uczestnikami lub z jednym > 50% obrotu ukryte wraz z kolejnymi (ukrywanie wtórne), kwoty do 10 tys. USD; „poinformowani” to wynik statystyczny z przeszłości, nie sygnał.',
      },
      {
        metric: 'Kaskada likwidacji',
        source: 'Mapa likwidacji, dzienna zmienność (model zmienności), obrót 24 h z API',
        method: 'Punkt stały: szok → likwidacje z mapy → wpływ Δp/p = Y·σ·√(Q/V) (Tóth i in. 2011) → kolejne likwidacje; Y = 1, pasmo 0.5–1.5',
        kinds: ['MODEL'],
        refresh: 'z każdą mapą',
        caveat: 'Wpływ szczytowy i pełne trafienie w arkusz — górna granica; tylko zmierzona część OI.',
      },
      {
        metric: 'Heatmapa likwidacji (wykres świec)',
        source: 'Ekstrema świec HL',
        method: 'Teoretyczne ceny likwidacji dla dźwigni 5× / 20× / 100× od ekstremów świec',
        kinds: ['MODEL'],
        refresh: 'z każdą świecą',
        caveat: 'Szacunek, nie pozycje — zmierzona mapa jest w panelu „Mapa likwidacji i kaskada”.',
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
