import React from 'react';
import { tr } from '../../i18n';
import { Badge, BadgeTone, Panel } from '../../ui';

type Kind = 'LIVE' | 'MODEL' | 'SIM';
const KIND_TONE: Record<Kind, BadgeTone> = { LIVE: 'live', MODEL: 'model', SIM: 'sim' };
const KIND_TITLE: Record<Kind, string> = {
  LIVE: tr('Realne dane ze źródła', 'Real data from the source'),
  MODEL: tr('Wynik modelu liczony z realnych danych — metoda w kolumnie obok', 'Model output computed from real data — method in the column next to it'),
  SIM: tr('Symulacja — tylko w trybie modelu, zawsze oznaczona', 'Simulation — only in model mode, always labelled'),
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
    title: tr('Hyperliquid — rdzeń desku', 'Hyperliquid — the desk core'),
    rows: [
      {
        metric: tr('Świece OHLCV BTC-PERP', 'BTC-PERP OHLCV candles'),
        source: 'Hyperliquid API: candleSnapshot (REST) + WS trades',
        method: tr(
          'OHLC i wolumen z REST; bieżąca świeca domykana transakcjami z WS (rollover po czasie transakcji)',
          'OHLC and volume from REST; the current candle is completed with WS trades (rollover by trade time)'
        ),
        kinds: ['LIVE'],
        refresh: tr('REST 15 s (10 s bez WS) · WS na żywo', 'REST 15 s (10 s without WS) · WS live'),
      },
      {
        metric: tr('Księga L2', 'L2 book'),
        source: tr('Hyperliquid WS l2Book (REST, gdy WS niedostępny)', 'Hyperliquid WS l2Book (REST when WS is unavailable)'),
        method: tr('Poziomy i wielkości wprost z API, bez mnożników', 'Levels and sizes straight from the API, no multipliers'),
        kinds: ['LIVE'],
        refresh: tr('na żywo', 'live'),
      },
      {
        metric: tr('Taśma transakcji', 'Trade tape'),
        source: 'Hyperliquid WS trades',
        method: tr('Strona agresora z pola side; rozmiar = cena·ilość, bez podłóg', 'Aggressor side from the side field; size = price·quantity, no floors'),
        kinds: ['LIVE'],
        refresh: tr('na żywo', 'live'),
      },
      {
        metric: tr('Footprint, świece delty, CVD (Wykresy)', 'Footprint, delta candles, CVD (Charts)'),
        source: tr(
          'Hyperliquid WS trades nagrywane od otwarcia widoku (zapis w przeglądarce do 24 h)',
          'Hyperliquid WS trades recorded since the view opened (stored in the browser for up to 24 h)'
        ),
        method: tr(
          'Wolumen agresywnego kupna i sprzedaży na każdym ticku ceny (strona agresora z pola side); POC i value area 70% świecy, nierównowaga diagonalna (próg i minimalna wartość w USD w ustawieniach, przeliczana na jednostki rynku po cenie), delta z maksimum i minimum w trakcie świecy, CVD zerowane wg sesji, doby UTC lub tygodnia',
          'Aggressive buy and sell volume at every price tick (aggressor side from the side field); POC and 70% value area of the candle, diagonal imbalance (ratio and minimum USD value in the settings, converted to market units at the price), delta with its maximum and minimum during the candle, CVD reset per session, UTC day or week'
        ),
        kinds: ['LIVE'],
        refresh: tr('na żywo', 'live'),
        caveat: tr(
          'API nie udostępnia historii transakcji: świece sprzed nagrania nie mają footprintu, a świeca bez pełnego pokrycia nagraniem (start, zerwane połączenie) jest oznaczona jako częściowa — bez uzupełniania szacunkiem.',
          'The API has no trade history: candles from before the recording have no footprint, and a candle not fully covered by the recording (start, dropped connection) is marked as partial — never filled in with an estimate.'
        ),
      },
      {
        metric: tr(
          'Wskaźniki na wykresie (Wykresy): VWAP ±σ, profil wolumenu, PDH/PDL, IB, klastry likwidacji',
          'Chart indicators (Charts): VWAP ±σ, volume profile, PDH/PDL, IB, liquidation clusters'
        ),
        source: tr(
          'Hyperliquid API: candleSnapshot (świece interwału i dzienne), taśma WS trades; mapa likwidacji skanera HyperQuant',
          'Hyperliquid API: candleSnapshot (timeframe and daily candles), WS trades tape; the HyperQuant scanner liquidation map'
        ),
        method: tr(
          'VWAP = Σ v·(H+L+C)/3 / Σ v ze świec 1m od 00:00 UTC lub od otwarcia sesji (na świecach dziennych ze świec 5m od poniedziałku), więc ta sama wartość na każdym interwale; dzień sprzed historii świec 1m ze świec wykresu; σ ważone wolumenem; profil widocznego zakresu: świeca z pełnej taśmy po cenach transakcji, pozostałe równomiernie na zakres H–L, value area 70% wokół POC; PDH, PDL i otwarcie dnia ze świec dziennych; IB = zakres pierwszej godziny sesji, rozszerzenia 1,5× i 2×; klastry = kubełki mapy łączone w przedziały ~0,25% ceny, 3 największe ≥ 1 mln USD po każdej stronie ceny',
          'VWAP = Σ v·(H+L+C)/3 / Σ v from 1m candles from 00:00 UTC or from the session open (on daily candles from 5m candles from Monday), so the same value on every timeframe; a day older than the 1m candle history from the chart candles; volume-weighted σ; visible-range profile: a candle with the full tape at trade prices, others spread evenly over the H–L range, 70% value area around the POC; PDH, PDL and daily open from daily candles; IB = range of the first hour of the session, 1.5× and 2× extensions; clusters = map buckets merged into ~0.25% price bands, the 3 largest ≥ USD 1M on each side of the price'
        ),
        kinds: ['LIVE', 'MODEL'],
        refresh: tr('na żywo (świece) · mapa likwidacji co minutę', 'live (candles) · liquidation map every minute'),
        caveat: tr(
          'Rozkład wolumenu świecy bez taśmy jest przybliżeniem (MODEL). Klastry likwidacji to bieżący stan mapy, nie historia; mapa nieaktualna wg reguł panelu likwidacji jest ukryta.',
          'The volume distribution of a candle without tape is an approximation (MODEL). Liquidation clusters are the current state of the map, not history; a map that is stale under the liquidation panel rules is hidden.'
        ),
      },
      {
        metric: tr(
          'Narzędzia rysowania (Wykresy): pomiar, profil zakresu, VWAP zakotwiczony, pozycja',
          'Drawing tools (Charts): measure, range profile, anchored VWAP, position'
        ),
        source: tr(
          'Hyperliquid API: candleSnapshot; taśma WS trades nagrywana od otwarcia widoku',
          'Hyperliquid API: candleSnapshot; WS trades tape recorded since the view opened'
        ),
        method: tr(
          'Pomiar: zmiana ceny, liczba świec i czas między punktami, wolumen świec z API, delta agresorów tylko ze świec z taśmą (z udziałem takich świec); profil zakresu jak profil widocznego zakresu; VWAP zakotwiczony = Σ v·(H+L+C)/3 / Σ v od wskazanej świecy z pasmami ±1σ; pozycja: cel, stop, procent od wejścia i stosunek zysku do ryzyka, bez składania zleceń',
          'Measure: price change, number of candles and time between the points, candle volume from the API, aggressor delta only from candles with tape (with the share of such candles); range profile like the visible-range profile; anchored VWAP = Σ v·(H+L+C)/3 / Σ v from the chosen candle with ±1σ bands; position: target, stop, percent from entry and reward-to-risk ratio, no order placement'
        ),
        kinds: ['LIVE', 'MODEL'],
        refresh: tr('na żywo', 'live'),
        caveat: tr(
          'Rysunki zapisują się tylko w tej przeglądarce. Delta pomiaru bez taśmy jest pokazana jako brak, nie jako zero.',
          'Drawings are saved only in this browser. Measure delta without tape is shown as missing, not as zero.'
        ),
      },
      {
        metric: tr(
          'Zderzenia z adresów (Wykresy): duże zlecenie, bitwa, seria, ściana, góra lodowa; taśma zleceń; podsumowanie adresu',
          'Address-level clashes (Charts): large order, battle, burst, wall, iceberg; order tape; address summary'
        ),
        source: tr(
          'Hyperliquid WS trades (adresy kupującego i sprzedającego, hash transakcji) i dokładny arkusz l2Book, nagrywane od otwarcia widoku',
          'Hyperliquid WS trades (buyer and seller addresses, transaction hash) and the exact l2Book, recorded since the view opened'
        ),
        method: tr(
          'Zlecenie agresora = wypełnienia tego samego biorcy i transakcji; duże od progu (ręczny albo kwantyl 98,5% wartości zleceń z ostatniej godziny zaokrąglony w górę do 1, 2 lub 5 × 10^k, w granicach 25 tys.–5 mln USD); bitwa = duże zlecenie, w którym jeden maker dał co najmniej połowę progu; seria = drobne zlecenia (każde poniżej ¼ progu) co najmniej 4 różnych biorców po jednej stronie w oknie 2 s, razem od progu; ściana = wypełnienia jednego makera na jednej cenie po jednej stronie z przerwami do 30 s, od progu i z co najmniej 3 zleceń agresora; podsumowanie adresu = zlecenia agresora tego biorcy na nagranej taśmie',
          'Aggressor order = fills of the same taker and transaction; large from the threshold (manual, or the 98.5% quantile of order values over the last hour rounded up to 1, 2 or 5 × 10^k, within USD 25k–5M); battle = a large order in which one maker supplied at least half the threshold; burst = small orders (each below ¼ of the threshold) from at least 4 different takers on one side within a 2 s window, together reaching the threshold; wall = fills of one maker at one price on one side with gaps of up to 30 s, from the threshold and from at least 3 aggressor orders; address summary = this taker’s aggressor orders on the recorded tape'
        ),
        kinds: ['LIVE'],
        refresh: tr('na żywo', 'live'),
        caveat: tr(
          'Tylko od otwarcia strony. Po kliknięciu widać pseudonim konta biorcy, nigdy adres; adres nie jest zapisywany. Ściana obejmuje tylko to, co maker oddał w transakcjach, bez zleceń zdjętych z arkusza. Góra lodowa = ściana, która wchłonęła co najmniej 2 × więcej niż największa wielkość całego poziomu w migawkach dokładnego arkusza (co ok. 5 s) i przyjmowała wypełnienia jeszcze po migawce, która w trakcie pokazywała poziom (jedno przemiecenie przed kolejną migawką się nie liczy): Hyperliquid nie ma ukrytych zleceń, więc to zlecenie odnawiane po wypełnieniach; odnowienie szybsze niż migawka może zawyżyć krotność.',
          'Only since the page opened. A click shows the taker’s account pseudonym, never the address; the address is not stored. A wall covers only what the maker gave up in trades, without orders pulled from the book. Iceberg = a wall that absorbed at least 2 × more than the largest size of the whole level in snapshots of the exact book (every ~5 s) and kept taking fills after a snapshot that showed the level in the meantime (a single sweep before the next snapshot does not count): Hyperliquid has no hidden orders, so this is an order replenished after fills; replenishment faster than the snapshot can overstate the multiple.'
        ),
      },
      {
        metric: tr('Duże zlecenia w arkuszu (Wykresy)', 'Large resting orders in the book (Charts)'),
        source: tr(
          'Hyperliquid WS l2Book w bliskiej agregacji (20 poziomów na stronę: cena, wielkość, liczba zleceń), nagrywany od otwarcia widoku',
          'Hyperliquid WS l2Book at near aggregation (20 levels per side: price, size, order count), recorded since the view opened'
        ),
        method: tr(
          'Poziom, na którym średnie zlecenie (wielkość × cena / liczba zleceń) jest w 1% największych średnich zleceń poziomów z ostatnich 30 min tego rynku (próg względny, bo stały próg w USD nie przenosi się między rynkami), nie niżej niż ¼ progu dużego zlecenia agresora; trwa, dopóki poziom mieści ¾ wartości tego zlecenia i nie traci tyle między migawkami (dołączenie drobnych zleceń nie kończy linii), a cena poza 20 widocznymi poziomami — do minuty bez przedłużania linii. Podpis po 30 s w arkuszu: liczba zleceń × średnia wartość zlecenia (największa w czasie trwania)',
          'A level where the average order (size × price / order count) is in the top 1% of average level orders over the last 30 min of this market (a relative threshold, because a fixed USD threshold does not carry over between markets), no lower than ¼ of the large aggressor order threshold; it lasts while the level holds ¾ of that order’s value and does not lose that much between snapshots (small orders joining do not end the line), and with price beyond the 20 visible levels — up to a minute without extending the line. Label after 30 s in the book: order count × average order value (the largest during its life)'
        ),
        kinds: ['LIVE'],
        refresh: tr('co migawkę arkusza (ok. 5 s)', 'every book snapshot (~5 s)'),
        caveat: tr(
          'Liczba zleceń jest na poziomie agregacji (kubełek kilku ticków), więc duże zlecenie może dzielić poziom z drobnymi. Migawka co kilka sekund: krótsze zlecenia mogą nie zostać zauważone, a koniec linii nie mówi, czy zlecenie wypełniono, czy zdjęto.',
          'The order count is per aggregation level (a bucket of several ticks), so a large order can share a level with small ones. A snapshot every few seconds: shorter-lived orders may go unnoticed, and the end of a line does not tell whether the order was filled or pulled.'
        ),
      },
      {
        metric: tr(
          'Historia ostatniej doby (Wykresy): taśma, zlecenia agresora, serie, ściany, ΔOI i arkusz sprzed otwarcia strony',
          'Last 24 hours of history (Charts): tape, aggressor orders, bursts, walls, ΔOI and the book from before the page opened'
        ),
        source: tr(
          'Rejestrator skanera na serwerze: Hyperliquid WS trades, activeAssetCtx i l2Book (agregacja bliska i daleka jak na stronie) dla BTC, ETH, SOL i HYPE; gałąź history publicznego repo danych',
          'The scanner’s recorder on the server: Hyperliquid WS trades, activeAssetCtx and l2Book (near and far aggregation as on the page) for BTC, ETH, SOL and HYPE; the history branch of the public data repository'
        ),
        method: tr(
          'Części 5-minutowe bieżącej godziny i pliki godzinowe (JSON w gzip) z odcinkami ciągłego nagrania; biorca, maker i zlecenie agresora jako numery ważne w obrębie godziny zamiast adresów i hashy. Strona wczytuje pliki od lewej krawędzi widoku (taśma do doby, arkusz do 12 h), co 2 min dociąga brakujące części i przerwy połączenia, a taśma odrzuca duplikaty po tid',
          '5-minute parts of the current hour and hourly files (gzipped JSON) with spans of continuous recording; taker, maker and aggressor order as numbers valid within the hour instead of addresses and hashes. The page loads files from the left edge of the view (tape up to a day, book up to 12 h), fetches missing parts and connection gaps every 2 min, and the tape drops duplicates by tid'
        ),
        kinds: ['LIVE'],
        refresh: tr('część co 5 min (publikacja ok. 1–2 min po jej końcu)', 'a part every 5 min (published ~1–2 min after it ends)'),
        caveat: tr(
          'Z zapisu serwera nie ma adresów (podsumowanie portfela tylko dla zleceń od otwarcia strony) ani gór lodowych (rejestrator nie nagrywa dokładnego arkusza). Przerwa w nagraniu serwera jest jawną luką. Ostatnie minuty przed otwarciem strony dochodzą z kilkuminutowym opóźnieniem.',
          'The server record has no addresses (wallet summary only for orders since the page opened) and no icebergs (the recorder does not record the exact book). A gap in the server recording is an explicit gap. The last minutes before the page opened arrive with a delay of a few minutes.'
        ),
      },
      {
        metric: tr(
          'Wieloryby (Wykresy): pozycje i duże zlecenia oczekujące największych kont',
          'Whales (Charts): positions and large resting orders of the largest accounts'
        ),
        source: tr(
          'Hyperliquid API: clearinghouseState i frontendOpenOrders kont z publicznego rankingu (największe wartości kont) i dużych pozycji BTC z taśmy, odczytywane przez skaner',
          'Hyperliquid API: clearinghouseState and frontendOpenOrders of accounts from the public leaderboard (largest account values) and large BTC positions from the tape, read by the scanner'
        ),
        method: tr(
          'Pozycje od 1 mln USD (BTC), 500 tys. (ETH), 250 tys. (SOL, HYPE): cena wejścia, wartość po cenie mark, dźwignia, cena likwidacji; zlecenia od 250 tys. (BTC), 150 tys. (ETH), 50 tys. (SOL, HYPE), także stop i take profit po cenie wyzwolenia; na wykresie 4 największe pozycje i 6 zleceń w widoku. Konto ma pseudonim ważny jedną dobę UTC (skrót adresu z sekretem serwera), więc pozycję da się połączyć z jej zleceniami. Dla prywatności wartości mają 2 cyfry znaczące, ceny wejścia i likwidacji leżą na siatce ~0,25% ceny, ceny zleceń ~0,05%, a dźwignia jest całkowita',
          'Positions from USD 1M (BTC), 500k (ETH), 250k (SOL, HYPE): entry price, value at the mark price, leverage, liquidation price; orders from 250k (BTC), 150k (ETH), 50k (SOL, HYPE), including stops and take-profits at the trigger price; the chart shows the 4 largest positions and 6 orders in view. Each account has a pseudonym valid for one UTC day (a hash of the address with a server secret), so a position can be linked to its orders. For privacy, values have 2 significant digits, entry and liquidation prices sit on a ~0.25% price grid, order prices on ~0.05%, and leverage is a whole number'
        ),
        kinds: ['LIVE'],
        refresh: tr('pozycje i zlecenia co ok. 5 min', 'positions and orders every ~5 min'),
        caveat: tr(
          'Tylko konta, które skaner obserwuje (ranking i duże pozycje BTC), więc to nie wszyscy duzi gracze. Odczyt sprzed kilku minut: zlecenie mogło zostać zdjęte. Plik starszy niż 20 min jest ukryty.',
          'Only accounts the scanner tracks (leaderboard and large BTC positions), so not all large players. The reading is a few minutes old: an order may have been pulled. A file older than 20 min is hidden.'
        ),
      },
      {
        metric: tr(
          'Tablica liczb (Wykresy): wolumen, delta, delta %, max i min delty, transakcje, tempo taśmy, ΔOI, finansowanie',
          'Numbers table (Charts): volume, delta, delta %, delta max and min, trades, tape pace, ΔOI, funding'
        ),
        source: tr(
          'Hyperliquid API: candleSnapshot, fundingHistory; WS trades i activeAssetCtx nagrywane od otwarcia widoku',
          'Hyperliquid API: candleSnapshot, fundingHistory; WS trades and activeAssetCtx recorded since the view opened'
        ),
        method: tr(
          'Wolumen ze świec API; delta, jej ekstrema, transakcje i tempo (transakcje na sekundę świecy) z taśmy; ΔOI = otwarte pozycje na końcu świecy − na początku (ostatnie próbki activeAssetCtx nie późniejsze niż te chwile); finansowanie = średnia stawek godzin świecy z historii API w % na 8 h (stawka godzinowa × 8), bieżąca godzina — stawka prognozowana',
          'Volume from API candles; delta, its extremes, trades and pace (trades per second of the candle) from the tape; ΔOI = open interest at the candle end − at its start (the last activeAssetCtx samples no later than those moments); funding = mean of the candle’s hourly rates from the API history in % per 8 h (hourly rate × 8), current hour — the predicted rate'
        ),
        kinds: ['LIVE'],
        refresh: tr('na żywo', 'live'),
        caveat: tr(
          'Delta, transakcje, tempo i ΔOI tylko dla świec nagranych od otwarcia strony; brak danych to „—”, nie zero.',
          'Delta, trades, pace and ΔOI only for candles recorded since the page opened; missing data is “—”, not zero.'
        ),
      },
      {
        metric: tr(
          'Kto handluje (Tablica liczb, Wykresy): delta dużych graczy i reszty, udział dużych w wartości wejść',
          'Who is trading (Numbers table, Charts): delta of large players and the rest, large players’ share of entry value'
        ),
        source: tr(
          'Hyperliquid: WS trades (adres biorcy przy każdej transakcji) nagrywane od otwarcia widoku i historia taśmy ostatniej doby z repo danych (konta jako numery w obrębie godziny)',
          'Hyperliquid: WS trades (taker address on every trade) recorded since the view opened and the last 24 h of tape history from the data repository (accounts as numbers within the hour)'
        ),
        method: tr(
          'Wypełnienia składane w zlecenia agresora; wartość wejść każdego konta biorcy sumowana w godzinie UTC. Konto, które w tej godzinie weszło za co najmniej 1 mln USD (BTC), 500 tys. (ETH) albo 250 tys. (SOL, HYPE), jest w niej dużym graczem — także gdy tnie zlecenie na wiele małych. Delta dużych i reszty = kupno − sprzedaż ich zleceń w świecy (jednostki rynku); udział dużych = ich wartość wejść / wartość wszystkich wejść świecy. Pokazujemy tylko sumy, bez kont',
          'Fills assembled into aggressor orders; the entry value of each taker account summed per UTC hour. An account that entered for at least USD 1M (BTC), 500k (ETH) or 250k (SOL, HYPE) in that hour is a large player in it — also when it splits an order into many small ones. Delta of large players and the rest = buys − sells of their orders in the candle (market units); large players’ share = their entry value / the value of all entries in the candle. Only sums are shown, never accounts'
        ),
        kinds: ['LIVE'],
        refresh: tr('na żywo', 'live'),
        caveat: tr(
          'W bieżącej godzinie konto staje się dużym graczem dopiero po przekroczeniu progu, a wtedy jego wcześniejsze wejścia z tej godziny też przechodzą do dużych. W godzinie otwarcia strony wejścia konta sprzed otwarcia (historia) i po nim (na żywo) liczą się osobno. Zapis taśmy w przeglądarce nie ma kont, więc świece tylko z niego są bez wartości („—”).',
          'In the current hour an account becomes a large player only after crossing the threshold, and then its earlier entries from that hour also move to the large players. In the hour the page opened, an account’s entries before the opening (history) and after it (live) are counted separately. The tape stored in the browser has no accounts, so candles only from it have no value (“—”).'
        ),
      },
      {
        metric: tr('Stan rynku (zdanie nad wykresem, Wykresy)', 'Market state (sentence above the chart, Charts)'),
        source: tr(
          'Te same dane co wykres: świece i taśma Hyperliquid, VWAP dnia, otwarte pozycje (activeAssetCtx), Kto handluje, bliski arkusz l2Book; Binance i Bybit tylko, gdy wykres już je pobiera',
          'The same data as the chart: Hyperliquid candles and tape, daily VWAP, open interest (activeAssetCtx), Who is trading, near l2Book; Binance and Bybit only when the chart already fetches them'
        ),
        method: tr(
          'Stałe reguły na ostatnich 10 świecach wykresu, przeliczane co 5 s: cena względem VWAP dnia w σ (do 0,5σ „przy”, do 2σ „nad/pod”, dalej „daleko”); kierunek CVD z delty okna (poniżej 5% wolumenu z taśmy — bez kierunku) i czas od początku ciągu świec z deltą w tę stronę; Binance i Bybit — znak ich delty w tych samych świecach z taśmy Hyperliquid (giełda bez delty w którejś z nich, np. Bybit tuż po otwarciu strony, jest pominięta); zmiana otwartych pozycji od początku okna (poniżej 0,1% — bez zmiany); strona dużych graczy i reszty z delty × cena / wartość wejść grupy (poniżej 10% — bez przewagi); arkusz — udział bidów w bliskim arkuszu (od 60% po jednej stronie — przewaga). „Skąd?” pokazuje liczby każdego faktu',
          'Fixed rules on the last 10 chart candles, recomputed every 5 s: price vs daily VWAP in σ (up to 0.5σ “at”, up to 2σ “above/below”, beyond that “far”); CVD direction from the window delta (below 5% of tape volume — no direction) and the time since the start of the run of candles with delta that way; Binance and Bybit — the sign of their delta in the same candles with Hyperliquid tape (an exchange without delta in any of them, e.g. Bybit right after the page opens, is left out); open-interest change since the window start (below 0.1% — no change); the side of large players and the rest from delta × price / the group’s entry value (below 10% — no edge); book — bid share of the near book (from 60% on one side — an edge). “Why?” shows the numbers behind each fact'
        ),
        kinds: ['LIVE'],
        refresh: tr('co 5 s', 'every 5 s'),
        caveat: tr(
          'Opis bieżącego stanu, nie sygnał ani prognoza. Fakt bez danych (np. przed nagraniem taśmy) jest pominięty, a nie zgadywany.',
          'A description of the current state, not a signal or forecast. A fact without data (e.g. before the tape is recorded) is left out, not guessed.'
        ),
      },
      {
        metric: tr('Powtórka nagranej doby (Wykresy)', 'Replay of the recorded day (Charts)'),
        source: tr(
          'Gałąź history publicznego repo danych (ten sam zapis rejestratora co historia ostatniej doby) albo kopia jej plików przy lekcjach; świece z API Hyperliquid (candleSnapshot) do końca nagrania, a tam, gdzie API ich już nie ma, z taśmy nagrania',
          'The history branch of the public data repository (the same recorder output as the last-24-hours history) or a copy of its files next to the lessons; candles from the Hyperliquid API (candleSnapshot) up to the end of the recording, and from the recorded tape where the API no longer has them'
        ),
        method: tr(
          'Pliki godzin (a bez pliku godzinowego jej części 5-minutowe) z zakresu linku, najwyżej doba, sklejone w jedną taśmę, migawki arkusza i otwarte pozycje. Wykres dostaje je po kolei do chwili odtwarzania (1×, 5×, 15× albo 60× czasu rzeczywistego) i liczy wszystko tak jak na żywo; świece po tej chwili są ukryte, a bieżąca świeca jest złożona z taśmy do tej chwili. Przewinięcie wstecz buduje wykres od nowa od początku nagrania. API trzyma ok. 5000 świec na interwał (1m — ok. 3,5 dnia), więc w starszym nagraniu brakującą świecę składamy z transakcji taśmy (otwarcie, maksimum, minimum, zamknięcie, wolumen).',
          'Hour files (or, without an hour file, its 5-minute parts) from the link range, at most one day, joined into one tape, book snapshots and open interest. The chart receives them in order up to the playback moment (1×, 5×, 15× or 60× real time) and computes everything as it does live; candles after that moment are hidden and the current candle is built from the tape up to that moment. Seeking backwards rebuilds the chart from the start of the recording. The API keeps about 5000 candles per interval (1m: about 3.5 days), so in an older recording a missing candle is built from the tape trades (open, high, low, close, volume).'
        ),
        kinds: ['LIVE'],
        refresh: tr('nagranie z przeszłości (bez odświeżania)', 'a past recording (no refresh)'),
        caveat: tr(
          'Bez Binance i Bybit, wielorybów, mapy likwidacji i alertów (to stan na teraz, nie z nagrania). Jak w historii ostatniej doby: bez adresów i gór lodowych. Przerwa w nagraniu serwera jest jawną luką w taśmie.',
          'Without Binance and Bybit, whales, the liquidation map and alerts (those are the current state, not part of the recording). As in the last-24-hours history: no addresses and no icebergs. A gap in the server recording is an explicit gap in the tape.'
        ),
      },
      {
        metric: tr('Strefy nierównowagi i niedokończone aukcje (Wykresy)', 'Imbalance zones and unfinished auctions (Charts)'),
        source: tr('Taśma WS trades nagrywana od otwarcia widoku', 'WS trades tape recorded since the view opened'),
        method: tr(
          'Siatka stała dla wszystkich świec: wysokość wiersza z ustawień albo 1/12 mediany zakresu ostatnich świec z taśmą (1, 2 lub 5 × 10^k USD). Strefa = co najmniej N kolejnych wierszy z nierównowagą diagonalną po jednej stronie; kończy się na świecy, która przechodzi przez strefę (dołek poniżej wsparcia, szczyt powyżej oporu). Niedokończona aukcja = skrajny wiersz zamkniętej, w całości nagranej świecy z kupnem i sprzedażą agresorów; kończy się na świecy, która wraca do tej ceny',
          'A fixed grid for all candles: row height from the settings or 1/12 of the median range of recent candles with tape (1, 2 or 5 × 10^k USD). Zone = at least N consecutive rows with diagonal imbalance on one side; it ends at the candle that trades through the zone (a low below support, a high above resistance). Unfinished auction = the extreme row of a closed, fully recorded candle with both aggressor buys and sells; it ends at the candle that returns to that price'
        ),
        kinds: ['LIVE'],
        refresh: tr('na żywo', 'live'),
        caveat: tr(
          'Kontekst, nie sygnał: strefy i aukcje nie mają potwierdzonej skuteczności prognostycznej.',
          'Context, not a signal: zones and auctions have no confirmed predictive power.'
        ),
      },
      {
        metric: tr('Rynki, alerty cenowe i link do widoku (Wykresy)', 'Markets, price alerts and view link (Charts)'),
        source: tr(
          'Hyperliquid WS i API dla BTC, ETH, SOL i HYPE (każdy rynek osobnym połączeniem); alerty w pamięci przeglądarki',
          'Hyperliquid WS and API for BTC, ETH, SOL and HYPE (a separate connection per market); alerts in browser storage'
        ),
        method: tr(
          'Tick ceny = 5 cyfr znaczących ceny; arkusz bliski w kroku najbliższym 2 pb ceny, daleki w 10 × większym; alert = jednorazowy poziom z kierunkiem wg położenia względem ceny przy ustawianiu, sprawdzany co sekundę na cenie bieżącej świecy rynku; link = rynek, interwał i rodzaj wykresu w adresie strony',
          'Price tick = 5 significant digits of the price; near book in the step closest to 2 bp of the price, far book in a 10 × larger one; alert = a one-off level with a direction from its position relative to the price when set, checked every second against the price of the market’s current candle; link = market, timeframe and chart type in the page address'
        ),
        kinds: ['LIVE'],
        refresh: tr('na żywo · alerty co 1 s', 'live · alerts every 1 s'),
        caveat: tr(
          'Alerty działają tylko przy otwartej stronie i zapisują się tylko w tej przeglądarce. Klastry likwidacji tylko dla BTC (skaner mapuje pozycje BTC). Taśma każdego rynku nagrywana od otwarcia strony.',
          'Alerts work only while the page is open and are saved only in this browser. Liquidation clusters for BTC only (the scanner maps BTC positions). Each market’s tape is recorded since the page opened.'
        ),
      },
      {
        metric: tr('TPO — profil czasowy doby (Wykresy)', 'TPO — daily time profile (Charts)'),
        source: tr('Świece Hyperliquid (API i WS) interwału wykresu do 30m', 'Hyperliquid candles (API and WS) at chart timeframes up to 30m'),
        method: tr(
          'Doba UTC dzielona na 48 okresów po 30 min (A–X, a–x); okres = H i L jego świec, litera w każdym wierszu ceny między nimi. POC = wiersz z największą liczbą liter (remis: bliżej środka profilu), value area = 70% liter od POC w stronę większego sąsiada, initial balance = zakres okresów A i B, pojedynczy wydruk = wiersz z jedną literą wewnątrz profilu, ogon = co najmniej dwa takie wiersze na skraju; nagi POC = POC zamkniętej doby, którego cena potem nie dotknęła. Wysokość wiersza z zakresu ceny na ekranie',
          'The UTC day split into 48 periods of 30 min (A–X, a–x); period = H and L of its candles, a letter on every price row between them. POC = the row with the most letters (tie: closer to the profile middle), value area = 70% of letters from the POC towards the larger neighbour, initial balance = range of periods A and B, single print = a row with one letter inside the profile, tail = at least two such rows at the edge; naked POC = POC of a closed day that price has not touched since. Row height from the price range on screen'
        ),
        kinds: ['LIVE'],
        refresh: tr('na żywo', 'live'),
        caveat: tr(
          'Kontekst aukcji, nie sygnał. Liczba liter zależy od wysokości wiersza, więc POC i value area mogą się nieznacznie przesuwać przy zmianie zbliżenia.',
          'Auction context, not a signal. The letter count depends on row height, so the POC and value area can shift slightly when zooming.'
        ),
      },
      {
        metric: 'Open interest, funding, mark/oracle',
        source: 'Hyperliquid API: metaAndAssetCtxs',
        method: tr('Wartości wprost z API; basis = (mark − oracle) / oracle', 'Values straight from the API; basis = (mark − oracle) / oracle'),
        kinds: ['LIVE'],
        refresh: '10–15 s',
      },
      {
        metric: tr('Funding Binance / Bybit', 'Binance / Bybit funding'),
        source: 'Hyperliquid API: predictedFundings',
        method: tr(
          'Przewidywane stawki innych giełd publikowane przez HL (bez łączenia z CEX); APR = stawka·(24/interwał)·365',
          'Predicted rates of other exchanges published by HL (no connection to the CEXs); APR = rate·(24/interval)·365'
        ),
        kinds: ['LIVE'],
        refresh: '60 s',
      },
      {
        metric: tr('Proxy makro (HIP-3)', 'Macro proxies (HIP-3)'),
        source: tr('Hyperliquid HIP-3 (dex xyz): indeksy, złoto, ropa, FX', 'Hyperliquid HIP-3 (xyz dex): indices, gold, oil, FX'),
        method: tr(
          'Ceny mark rynków HIP-3; β i R² do BTC z dopasowanych zwrotów logarytmicznych',
          'Mark prices of HIP-3 markets; β and R² to BTC from aligned log returns'
        ),
        kinds: ['LIVE', 'MODEL'],
        refresh: tr('60 s · świece 5 min', '60 s · 5-min candles'),
        caveat: tr('Lista rynków HIP-3 rozwiązywana w runtime — rynek może zniknąć.', 'The HIP-3 market list is resolved at runtime — a market can disappear.'),
      },
    ],
  },
  {
    title: tr('Modele liczone z danych', 'Models computed from data'),
    rows: [
      {
        metric: tr('Schrödi: duży ruch i kierunek BTC na 1 h (Wykresy)', 'Schrödi: BTC big move and direction for 1 h (Charts)'),
        source: tr('Świece HL 1m, 5m, 1h, 1d + kalendarz makro desku', 'HL 1m, 5m, 1h, 1d candles + the desk macro calendar'),
        method: tr(
          '22 cechy (ruch, zmienność, aukcja, zegar); średnia regresji logistycznej i 300 drzew LightGBM z public/schrodi/model-v1.json, uczonych na minutówkach BTCUSDT 2022 do 10.2026; walidacja krocząca kwartałami (docs/SCHRODI.md)',
          '22 features (move, volatility, auction, clock); average of a logistic regression and 300 LightGBM trees from public/schrodi/model-v1.json, trained on BTCUSDT 1m candles 2022 to 10.2026; quarterly walk-forward validation (docs/SCHRODI.md)'
        ),
        kinds: ['MODEL'],
        refresh: tr(
          'na żywo: przy każdej zmianie świecy 1m z WebSocket Hyperliquid, najwyżej raz na sekundę (świece 5m kończące się teraz); do dziennika co 15 min',
          'live: on every change of the 1m candle from the Hyperliquid WebSocket, at most once a second (5m candles ending now); to the ledger every 15 min'
        ),
        caveat: tr(
          'Kierunek tylko trochę lepszy niż rzut monetą (AUC 0,54, trafność 53%); po kosztach sam kierunek nie daje przewagi. Wielkość ruchu AUC 0,83.',
          'Direction only slightly better than a coin flip (AUC 0.54, accuracy 53%); after costs direction alone is no edge. Move size AUC 0.83.'
        ),
      },
      {
        metric: tr('Schrödi: dowód przewagi, alarm dryfu, kalibracja (Plan, dymek kota)', 'Schrödi: proof of edge, drift alarm, calibration (Plan, cat panel)'),
        source: tr('Weryfikowalny dziennik prognoz: pełne godziny kota od rejestracji planu schrodi-trust-v1', 'Verifiable forecast ledger: full-hour cat forecasts since the schrodi-trust-v1 plan was recorded'),
        method: tr(
          'E-proces wobec prostej reguły na różnicy wyników Briera (Henzi i Ziegel 2022), e-detektor dryfu CUSUM (Shin, Ramdas, Rinaldo 2022), rozkład CORP (Dimitriadis, Gneiting, Jordan 2021), pasma Wilsona 90%, test Spiegelhaltera (1986); src/utils/schrodiTrust.ts',
          'E-process against a simple rule on the Brier score difference (Henzi and Ziegel 2022), CUSUM e-detector for drift (Shin, Ramdas, Rinaldo 2022), CORP decomposition (Dimitriadis, Gneiting, Jordan 2021), 90% Wilson bands, Spiegelhalter test (1986); src/utils/schrodiTrust.ts'
        ),
        kinds: ['LIVE', 'MODEL'],
        refresh: tr('co godzinę, po rozstrzygnięciu', 'hourly, after resolution'),
        caveat: tr(
          'Brak dowodu to nie dowód braku przewagi: dla kierunku dowód może nie przyjść nawet przez rok. Alarm dryfu znaczy, że ostatnio kot był gorszy od reguły.',
          'No proof is not proof of no edge: for direction it may not come within a year. A drift alarm means the cat was recently worse than the rule.'
        ),
      },
      {
        metric: tr('Schrödi: godzina na żywo (dymek kota, Plan)', 'Schrödi: live hour (cat panel, Plan)'),
        source: tr(
          'Świece 1m BTC Hyperliquid od początku bieżącej godziny i prognoza kota z tej chwili; w dzienniku zapisy o :15 i :30 od rejestracji planu schrodi-hour-v1',
          'Hyperliquid BTC 1m candles since the start of the current hour and the cat forecast from that moment; in the ledger, records at :15 and :30 since the schrodi-hour-v1 plan was recorded'
        ),
        method: tr(
          'Trzy głowy LightGBM z ograniczeniami monotonicznymi i kalibracją Platta (public/schrodi/hour-v1.json, src/utils/schrodiHour.ts); e-proces wobec tej samej metody z samej drogi ceny',
          'Three LightGBM heads with monotone constraints and Platt calibration (public/schrodi/hour-v1.json, src/utils/schrodiHour.ts); e-process against the same method from the price path alone'
        ),
        kinds: ['LIVE', 'MODEL'],
        refresh: tr('co minutę w dymku, zapis co 15 min o :15 i :30', 'every minute in the panel, recorded at :15 and :30'),
        caveat: tr(
          'Wynik dotyczy godziny zegara, a nie 60 minut od teraz. Kierunek tylko z drogi ceny, bez przewagi kota. Dowód w dzienniku na historii przychodził po ok. 34 dniach.',
          'The result is for the clock hour, not the next 60 minutes. Direction from the price path only, with no edge from the cat. On history the ledger proof came after about 34 days.'
        ),
      },
      {
        metric: 'CVD (spot / perp)',
        source: tr('Świece HL + transakcje WS (+ CEX, jeśli włączone)', 'HL candles + WS trades (+ CEX, if enabled)'),
        method: tr(
          'Świece obserwowane przez WS: realna strona agresora; pozostałe: BVC V_B = V·Φ(ΔP/σ) (Easley, López de Prado, O’Hara 2012)',
          'Candles observed over WS: the real aggressor side; others: BVC V_B = V·Φ(ΔP/σ) (Easley, López de Prado, O’Hara 2012)'
        ),
        kinds: ['LIVE', 'MODEL'],
        refresh: tr('z każdą świecą', 'every candle'),
      },
      {
        metric: 'VPIN',
        source: tr('Świece HL (podział WS lub BVC)', 'HL candles (WS or BVC split)'),
        method: tr('50 kubełków o równym wolumenie; VPIN = średnia |V_B − V_S| / V', '50 equal-volume buckets; VPIN = mean |V_B − V_S| / V'),
        kinds: ['MODEL'],
        refresh: tr('z każdą świecą', 'every candle'),
        caveat: tr(
          'Kontrowersyjny — Andersen & Bondarenko (2014): słaba moc prognostyczna, zależność od klasyfikacji wolumenu.',
          'Contested — Andersen & Bondarenko (2014): weak predictive power, dependence on volume classification.'
        ),
      },
      {
        metric: tr('λ Kyle’a', 'Kyle’s λ'),
        source: tr('Świece z realnym przepływem agresora (WS)', 'Candles with real aggressor flow (WS)'),
        method: tr(
          'OLS ΔP = λ·Q + ε; na świecach BVC brak wyniku (regresja byłaby kołowa)',
          'OLS ΔP = λ·Q + ε; no result on BVC candles (the regression would be circular)'
        ),
        kinds: ['MODEL'],
        refresh: tr('z każdą świecą', 'every candle'),
      },
      {
        metric: tr('Wykładnik Hursta', 'Hurst exponent'),
        source: tr('Zwroty z zamknięć świec HL', 'Returns from HL candle closes'),
        method: tr(
          'R/S z korektą Anis-Lloyd (Peters); próg trendu z symulacji szumu',
          'R/S with the Anis-Lloyd correction (Peters); trend threshold from noise simulation'
        ),
        kinds: ['MODEL'],
        refresh: tr('z każdą świecą', 'every candle'),
        caveat: tr('Lo (1991): klasyczne R/S myli krótką pamięć z długą.', 'Lo (1991): classic R/S mistakes short memory for long memory.'),
      },
      {
        metric: 'Ornstein-Uhlenbeck',
        source: tr('Zamknięcia świec HL', 'HL candle closes'),
        method: tr(
          'OLS ΔX na X (dyskretny AR(1)); półokres = ln 2 / θ; brak wartości zastępczej',
          'OLS of ΔX on X (discrete AR(1)); half-life = ln 2 / θ; no fallback value'
        ),
        kinds: ['MODEL'],
        refresh: tr('z każdą świecą', 'every candle'),
      },
      {
        metric: tr('Model zmienności', 'Volatility model'),
        source: tr(
          'Hyperliquid API: candleSnapshot BTC 1h (~5000 ≈ 208 dni) i 5m (~5000 ≈ 17 dni)',
          'Hyperliquid API: candleSnapshot BTC 1h (~5000 ≈ 208 days) and 5m (~5000 ≈ 17 days)'
        ),
        method: tr(
          'Sezonowy log-HAR (Corsi 2009) na godzinowych wariancjach Garman–Klass z profilem godzin UTC i korektą Duana; innowacje FHS ze standaryzowanych zwrotów 5m; udział skoków (wariancja dwupotęgowa) i test Lee–Mykland jako diagnostyka; trafność: QLIKE poza próbą vs średnia 24 h',
          'Seasonal log-HAR (Corsi 2009) on hourly Garman–Klass variances with a UTC hour-of-day profile and Duan correction; FHS innovations from standardised 5m returns; jump share (bipower variation) and the Lee–Mykland test as diagnostics; accuracy: out-of-sample QLIKE vs the 24 h mean'
        ),
        kinds: ['MODEL'],
        refresh: tr('co 60 min', 'every 60 min'),
        caveat: tr(
          'Brak danych → σ Parkinsona z bieżących świec, oznaczona jako zapas.',
          'Missing data → Parkinson σ from the current candles, labelled as a fallback.'
        ),
      },
      {
        metric: tr('Monte Carlo — zasięg 2 h i Analizator planu', 'Monte Carlo — 2 h range and Plan Analyzer'),
        source: tr('Model zmienności, świece HL, poziomy PDH/PDL/D-EQ, arkusz L2', 'Volatility model, HL candles, PDH/PDL/D-EQ levels, L2 book'),
        method: tr(
          '2000 ścieżek, krok 5 min (σ z HAR, innowacje FHS), korekta mostu Browna; Analizator: faza wypełnienia od bieżącej ceny i wynik warunkowy jak w dzienniku. Wspólne liczby losowe w obrębie minuty — w tej minucie wynik zmienia się płynnie z ceną; co minutę nowe ścieżki (błąd standardowy ≤ 1,1 pp)',
          '2000 paths, 5-min step (σ from HAR, FHS innovations), Brownian-bridge correction; Analyzer: fill phase from the current price and a conditional result as in the journal. Common random numbers within a minute — within that minute the result changes smoothly with price; new paths every minute (standard error ≤ 1.1 pp)'
        ),
        kinds: ['MODEL'],
        refresh: tr('z każdą synchronizacją', 'every sync'),
        caveat: tr(
          'Bez modelu zmienności: Merton z założonym udziałem skoków 20%, krok 1 min (oznaczone w pasku).',
          'Without the volatility model: Merton with an assumed 20% jump share, 1-min step (labelled in the strip).'
        ),
      },
      {
        metric: tr('Drabina kosztów planu', 'Plan cost ladder'),
        source: tr('Wynik Analizatora (P cel / stop / żadne), arkusz L2 Hyperliquid, opłaty Hyperliquid tier 0', 'Analyzer result (P target / stop / neither), Hyperliquid L2 book, Hyperliquid tier 0 fees'),
        method: tr(
          'Koszt w bp nominału dla trzech wykonań: rynkowe (taker 0,045% dwa razy, poślizg wejścia z arkusza, P(stop) × poślizg stopu), limit na wejściu (maker 0,015% bez poślizgu), limit na wejściu i celu (maker przy celu, taker przy stopie i wyjściu z końca horyzontu); koszt w R = bp × E / (|E − S|·10⁴); próg P(cel) = P(cel) − EV/(R + 1)',
          'Cost in bp of notional for three executions: market (taker 0.045% twice, entry slippage from the book, P(stop) × stop slippage), limit entry (maker 0.015% with no slippage), limit entry and target (maker at the target, taker at the stop and at the end-of-horizon exit); cost in R = bp × E / (|E − S|·10⁴); break-even P(target) = P(target) − EV/(R + 1)'
        ),
        kinds: ['MODEL'],
        refresh: tr('z każdą synchronizacją', 'every sync'),
        caveat: tr(
          'Limit zakłada wypełnienie po cenie zlecenia, bez kolejki i selekcji negatywnej; opłaty tier 0 to założenie (wyższe tiery płacą mniej); funding pominięty.',
          'A limit order is assumed to fill at its price, with no queue and no adverse selection; tier 0 fees are an assumption (higher tiers pay less); funding ignored.'
        ),
      },
      {
        metric: tr('Mapa likwidacji (pozycje on-chain)', 'Liquidation map (on-chain positions)'),
        source: tr(
          'Skaner HyperQuant: adresy z WS trades (pole users) i z publicznego rankingu kont Hyperliquid → clearinghouseState każdego portfela; publikacja przez publiczne repo danych na GitHubie (rdemb/hyperquant-data)',
          'HyperQuant scanner: addresses from WS trades (users field) and from Hyperliquid’s public account leaderboard → clearinghouseState of each wallet; published through the public data repository on GitHub (rdemb/hyperquant-data)'
        ),
        method: tr(
          'Kubełki ceny likwidacji (krok ~0,1% ceny) dla longów i shortów, nominał |szi|·cena likwidacji (w kubełku z mniej niż 3 pozycjami do 2 cyfr znaczących); pokrycie = Σ|szi| / (2·OI); tylko agregaty, bez adresów',
          'Liquidation-price buckets (step ~0.1% of price) for longs and shorts, notional |szi|·liquidation price (to 2 significant digits in a bucket with fewer than 3 positions); coverage = Σ|szi| / (2·OI); aggregates only, no addresses'
        ),
        kinds: ['LIVE'],
        refresh: tr(
          'mapa co 2 min (repo danych + cache GitHuba do 5 min); cel odczytu: pozycje ≥ 1 mln USD co 2 min, ≥ 100 tys. co 10 min, cena likwidacji < 1% od mark co 1 min — faktyczny wiek (mediana ważona nominałem) w panelu',
          'map every 2 min (data repository + GitHub cache up to 5 min); read target: positions ≥ USD 1M every 2 min, ≥ 100k every 10 min, liquidation price < 1% from mark every 1 min — actual age (notional-weighted median) in the panel'
        ),
        caveat: tr(
          'Portfele nieaktywne od startu skanera nie są na mapie; cena likwidacji pozycji cross zmienia się z całym kontem.',
          'Wallets inactive since the scanner started are not on the map; the liquidation price of a cross position changes with the whole account.'
        ),
      },
      {
        metric: tr('Zrealizowane likwidacje (taśma 24 h)', 'Realised liquidations (24 h tape)'),
        source: tr(
          'Skaner HyperQuant: śledzone pozycje → userFillsByTime konta (pole liquidation: markPx, metoda market/backstop)',
          'HyperQuant scanner: tracked positions → the account’s userFillsByTime (liquidation field: markPx, market/backstop method)'
        ),
        method: tr(
          'Kandydat: pozycja zmalała, a cena z taśmy od poprzedniego odczytu weszła w pasmo ceny likwidacji (do 0,5% przed poziomem z mapy); zdarzenie tylko po potwierdzeniu fillem likwidacyjnym; błąd mapy = mark przy likwidacji vs cena likwidacji z ostatniego odczytu',
          'Candidate: the position shrank and the tape price since the previous read entered the liquidation-price band (up to 0.5% before the map level); an event only after confirmation by a liquidation fill; map error = mark at liquidation vs the liquidation price from the last read'
        ),
        kinds: ['LIVE'],
        refresh: tr(
          'co 2 min z mapą; potwierdzenia do 3 zapytań/min (tylko przy pełnym tempie API)',
          'every 2 min with the map; confirmations up to 3 requests/min (only at full API rate)'
        ),
        caveat: tr(
          'Hyperliquid nie publikuje likwidacji wszystkich kont — tylko zmierzona część open interest; bez adresów, czas do minuty, rozmiar zaokrąglony, opóźnienie do kilku minut.',
          'Hyperliquid does not publish liquidations for all accounts — only the measured part of open interest; no addresses, time to the minute, rounded size, a delay of up to a few minutes.'
        ),
      },
      {
        metric: tr('Weryfikowalny dziennik desku', 'Verifiable desk ledger'),
        source: tr(
          'Skaner HyperQuant: model zmienności ze świec 1h/5m, PDH/PDL ze świec 1d, rozstrzygnięcia ze świec 1m (publiczne API Hyperliquid); gałąź ledger repo danych',
          'HyperQuant scanner: volatility model from 1h/5m candles, PDH/PDL from 1d candles, settlement from 1m candles (public Hyperliquid API); the ledger branch of the data repository'
        ),
        method: tr(
          'Co 15 min przed faktem (horyzont od pełnej minuty po wydaniu): 13 kwantyli log-zwrotu 1 h / 4 h (HAR + FHS, MC 4000 ścieżek) z benchmarkiem normalnym i α ACI; P(dotknięcia PDH/PDL/D-EQ w 2 h); 5–10 min przed końcem slotu p modelu, notowanie 15-minutowego rynku HIP-4 i p ensemble (pooling logarytmiczny z wagami z wcześniej rozstrzygniętych pytań; Brier wszystkich trzech, różnice z bootstrapem). Wyniki: CRPS(S), PIT, Kupiec (podpróba rozłączna), ACI, Brier/BSS (klimatologia poziomów), Venn–Abers; łańcuch SHA-256 tylko dopisywany, pokwitowanie OpenTimestamps po każdym slocie',
          'Every 15 min before the fact (horizon from the full minute after issue): 13 quantiles of the 1 h / 4 h log return (HAR + FHS, MC 4000 paths) with a normal benchmark and ACI α; P(touch of PDH/PDL/D-EQ within 2 h); 5–10 min before the slot ends, the model’s p, the price of the 15-minute HIP-4 market and the ensemble p (logarithmic pooling with weights from previously settled questions; Brier of all three, differences with a bootstrap). Scores: CRPS(S), PIT, Kupiec (disjoint subsample), ACI, Brier/BSS (level climatology), Venn–Abers; an append-only SHA-256 chain, an OpenTimestamps receipt after every slot'
        ),
        kinds: ['MODEL'],
        refresh: tr(
          'prognozy co 15 min; podsumowanie przy każdej zmianie (najwyżej co 15 min bez zmian)',
          'forecasts every 15 min; summary on every change (no more than 15 min apart when nothing changes)'
        ),
        caveat: tr(
          'Wyniki od 20 rozstrzygnięć; prognozy nakładają się (wyniki skorelowane); brak danych 6 h po horyzoncie = jawne unieważnienie; pominięte sloty jawne; znaczniki czasu potwierdzają istnienie zapisu, nie poprawność modelu.',
          'Scores from 20 settlements; forecasts overlap (scores are correlated); no data 6 h after the horizon = explicit voiding; skipped slots are explicit; timestamps prove that a record existed, not that the model is right.'
        ),
      },
      {
        metric: tr('Płynność arkusza w ciągu doby (Mikrostruktura)', 'Book liquidity across the day (Microstructure)'),
        source: tr(
          'Skaner HyperQuant: WS l2Book Hyperliquid zagregowany w koszyki dobierane do ceny (~10–20 USD), co ~5 s; plik liquidity/BTC.json w repo danych',
          'HyperQuant scanner: Hyperliquid WS l2Book aggregated into price-scaled buckets (~USD 10–20), every ~5 s; the liquidity/BTC.json file in the data repository'
        ),
        method: tr(
          'Głębokość obu stron w ±10 i ±20 bp od środka z każdej migawki, minutowe mediany (30 dni na serwerze); mediana wg godziny UTC (sumy i strony osobno, 25. percentyl); bieżąca minuta / mediana jej godziny; odporność: po minucie z ruchem środka ≥ 15 bp — minuty do powrotu głębokości ±10 bp do 80% mediany z poprzedniej godziny; koszt wykonania: średni poślizg z krzywej głębokości strony (liniowo do ±20 bp, dalej prawo pierwiastka kwadratowego Tóth i in. 2011) + opłata takera',
          'Depth of both sides within ±10 and ±20 bp of the mid from every snapshot, per-minute medians (30 days on the server); median by UTC hour (totals and sides separately, 25th percentile); current minute / the median of its hour; resilience: after a minute with a mid move ≥ 15 bp — minutes until ±10 bp depth returns to 80% of the previous hour’s median; execution cost: average slippage from the side’s depth curve (linear up to ±20 bp, beyond that the square-root law, Tóth et al. 2011) + taker fee'
        ),
        kinds: ['LIVE'],
        refresh: tr('profil co 10 min', 'profile every 10 min'),
        caveat: tr(
          'Historia od uruchomienia rejestratora (rośnie do 30 dni); godzina z mniej niż 30 min danych wyszarzona; widoczne zlecenia — bez ukrytych i szybko anulowanych.',
          'History since the recorder started (grows to 30 days); an hour with less than 30 min of data is greyed out; visible orders only — no hidden or quickly cancelled ones.'
        ),
      },
      {
        metric: tr('Laboratorium folkloru (Plan)', 'Folklore lab (Plan)'),
        source: tr(
          'Skaner HyperQuant: archiwum świec BTC 1h/1d i godzinowego finansowania z candleSnapshot / fundingHistory Hyperliquid (gałąź archive repo danych); katalog reguł zapisany w gałęzi ledger; plik lab/BTC.json',
          'HyperQuant scanner: archive of BTC 1h/1d candles and hourly funding from Hyperliquid candleSnapshot / fundingHistory (archive branch of the data repository); the rule catalogue recorded on the ledger branch; the lab/BTC.json file'
        ),
        method: tr(
          'Zdarzenie z dwiema barierami startujące na zamknięciu świecy 1h; p0 z twierdzenia o opcjonalnym zatrzymaniu (cena = martyngał), reguły kalendarzowe p0 = 0,5 z symetrii; limit czasu → wynik ułamkowy (E = p0 pod H0); historia: p z wariancją pod H0, q Benjaminiego–Hochberga; do przodu (≥ 24 h po prerejestracji): proces zakładów aGRAPA, e-BH 5% osobno dla potwierdzeń i obaleń, sekwencja ufności 90%',
          'An event with two barriers starting at a 1h candle close; p0 from the optional stopping theorem (price = martingale), calendar rules p0 = 0.5 from symmetry; time limit → fractional outcome (E = p0 under H0); history: p with variance under H0, Benjamini–Hochberg q; forward (≥ 24 h after pre-registration): aGRAPA betting process, e-BH 5% separately for confirmations and refutations, 90% confidence sequence'
        ),
        kinds: ['LIVE'],
        refresh: tr('archiwum co 10 min, ocena co godzinę', 'archive every 10 min, scoring every hour'),
        caveat: tr(
          'Historia to eksploracja (definicje znane po fakcie); rozstrzyga ocena do przodu, która rośnie powoli (reguły tygodniowe — lata). Świeca dotykająca obu barier odrzucana; pomiar statystyczny, nie sygnał — efekt ≠ zysk po kosztach.',
          'History is exploration (definitions known after the fact); the forward score decides, and it grows slowly (weekly rules — years). A candle touching both barriers is discarded; a statistical measurement, not a signal — effect ≠ profit after costs.'
        ),
      },
      {
        metric: tr('Lekcje: wycinki rynku i symulator ryzyka', 'Lessons: market slices and risk simulator'),
        source: tr(
          'Świece BTC z archiwum desku (gałąź archive repo danych; 1m do VWAP), nagrana taśma transakcji i arkusza (gałąź history) oraz taśma likwidacji; wycinki zapisane przy budowie strony w lessons/*.json, a kopia nagrania z wieczoru 24.10 (16:00–22:00 UTC) do powtórki w Wykresach w lessons/replay/',
          'BTC candles from the desk archive (archive branch of the data repository; 1m for VWAP), the recorded trade and book tape (history branch) and the liquidation tape; slices saved at site build time in lessons/*.json, and a copy of the 24 Oct evening recording (16:00–22:00 UTC) for the Charts replay in lessons/replay/'
        ),
        method: tr(
          'Ryciny: VWAP, profil wolumenu, initial balance i footprint liczone tymi samymi funkcjami co na Wykresach, tylko ze świec zamkniętych przed chwilą zatrzymania (także zakres osi ceny). Symulator: 1000 serii transakcji o stałym ułamku ryzyka i kosztach w R, stałe ziarno (wspólne liczby losowe)',
          'Figures: VWAP, volume profile, initial balance and footprint computed with the same functions as in Charts, only from candles closed before the pause point (the price axis range too). Simulator: 1000 series of trades with a fixed risk fraction and costs in R, fixed seed (common random numbers)'
        ),
        kinds: ['LIVE', 'SIM'],
        refresh: tr('wycinki stałe · symulacja przy zmianie parametrów', 'fixed slices · simulation on parameter change'),
        caveat: tr(
          'Przykłady do nauki czytania wykresu, nie statystyka skuteczności; symulator zakłada niezależne transakcje o stałych parametrach.',
          'Examples for learning to read a chart, not hit-rate statistics; the simulator assumes independent trades with fixed parameters.'
        ),
      },
      {
        metric: tr('Dziennik zagrań i playbook (Plan)', 'Trade journal and playbook (Plan)'),
        source: tr(
          'Twoje wpisy w tej przeglądarce (localStorage, nic nie jest wysyłane) + świece BTC 1m i 1h z candleSnapshot Hyperliquid',
          'Your entries in this browser (localStorage, nothing is sent) + BTC 1m and 1h candles from Hyperliquid candleSnapshot'
        ),
        method: tr(
          'Wynik w R od stopu początkowego; MAE/MFE w R z minimum/maksimum świec 1m w oknie zagrania; kontekst aukcji przy wejściu tą samą metodą co panel „Kontekst aukcji”; per setup: trafność z przedziałem Wilsona 95%, średnie R z bootstrapem 90% (2000 losowań, stałe ziarno), profit factor, mediany MAE wygranych i MFE przegranych',
          'Result in R from the initial stop; MAE/MFE in R from the min/max of 1m candles within the trade window; auction context at entry with the same method as the “Auction context” panel; per setup: hit rate with a 95% Wilson interval, mean R with a 90% bootstrap (2000 draws, fixed seed), profit factor, median MAE of winners and MFE of losers'
        ),
        kinds: ['LIVE'],
        refresh: tr('przy zapisie zagrania', 'when a trade is saved'),
        caveat: tr(
          'Świeca minuty wejścia może zawierać ceny sprzed wejścia (przybliżenie do minuty); MAE/MFE i kontekst tylko dla zagrań z ostatnich ~3,5 doby (limit API); poniżej 20 zagrań — anegdota, nie statystyka.',
          'The candle of the entry minute can include prices from before the entry (minute approximation); MAE/MFE and context only for trades from the last ~3.5 days (API limit); below 20 trades — an anecdote, not statistics.'
        ),
      },
      {
        metric: tr('Model vs rynek (HIP-4, Rynek)', 'Model vs market (HIP-4, Market)'),
        source: tr(
          'outcomeMeta i l2Book rynków wynikowych Hyperliquid (strona „Tak” = arkusz #<10·outcome>); model zmienności desku (świece 1h/5m)',
          'outcomeMeta and l2Book of Hyperliquid outcome markets (the “Yes” side = book #<10·outcome>); the desk volatility model (1h/5m candles)'
        ),
        method: tr(
          'Rynki BTC: cena powyżej progu w terminie (dzienny Recurring — mark HyperCore o 06:00 UTC; binaryPrice — mark, transakcja HL albo Pyth) i dotknięcie poziomu do terminu (priceTouch). Rynek: bid/ask/środek, płynny przy spreadzie ≤ 5 pp i ≥ 50 USDC w zleceniach do ±5 pp od środka po obu stronach. Model: 2000 ścieżek log-ceny (σ sezonowego log-HAR, innowacje FHS, krok 5/15/60 min, cena jako martyngał), dotknięcie z dokładnym ekstremum mostu Browna; Web Worker',
          'BTC markets: price above a strike at expiry (daily Recurring — HyperCore mark at 06:00 UTC; binaryPrice — mark, HL trade or Pyth) and touching a level before expiry (priceTouch). Market: bid/ask/mid, liquid with a spread ≤ 5 pp and ≥ 50 USDC in orders within ±5 pp of the mid on both sides. Model: 2000 log-price paths (seasonal log-HAR σ, FHS innovations, 5/15/60-min step, price as a martingale), touch from the exact Brownian-bridge extreme; Web Worker'
        ),
        kinds: ['LIVE', 'MODEL'],
        refresh: tr('lista rynków co 10 min; arkusze i model co minutę', 'market list every 10 min; books and model every minute'),
        caveat: tr(
          'Cena rynku to nie czyste prawdopodobieństwo (premia za ryzyko, płynność); źródła cen rozliczenia różnią się od świec modelu; powyżej 14 dni brak wartości modelu. Porównanie kalibracji, nie sygnał.',
          'A market price is not a pure probability (risk premium, liquidity); settlement price sources differ from the model’s candles; beyond 14 days there is no model value. A calibration comparison, not a signal.'
        ),
      },
      {
        metric: tr('Kontekst aukcji (Plan, kafel na Desku)', 'Auction context (Plan, tile on the Desk)'),
        source: tr(
          'Świece BTC 1m (bieżąca i poprzednia sesja UTC) i 1h (~5000 ≈ 208 dni) z candleSnapshot Hyperliquid',
          'BTC 1m candles (current and previous UTC session) and 1h (~5000 ≈ 208 days) from Hyperliquid candleSnapshot'
        ),
        method: tr(
          'Sesja = dzień UTC. VWAP z ceny typowej ważonej wolumenem i pasma ±1σ/±2σ; Initial Balance 00:00–01:00 UTC z rozszerzeniami 1,5×/2×; profil poprzedniej sesji (wolumen świecy rozłożony w jej zakresie, koszyki 10 USD, VA 70%); słaby szczyt/dno = ekstremum w ≥ 2 oknach 30 min (≤ 0,02%). Częstości z pełnych sesji 1h: wybicia IB, reguła 80%, przebicie słabych vs mocnych ekstremów (różnica Newcombe’a), dotknięcie PDH/PDL wg otwarcia; przedziały Wilsona 95%',
          'Session = UTC day. VWAP from the volume-weighted typical price and ±1σ/±2σ bands; Initial Balance 00:00–01:00 UTC with 1.5×/2× extensions; previous session profile (candle volume spread over its range, USD 10 buckets, 70% VA); weak high/low = an extreme in ≥ 2 30-min windows (≤ 0.02%). Frequencies from full 1h sessions: IB breakouts, the 80% rule, weak vs strong extremes taken out (Newcombe difference), PDH/PDL touch by open; 95% Wilson intervals'
        ),
        kinds: ['LIVE'],
        refresh: tr('świece 1m co minutę, 1h co 30 min', '1m candles every minute, 1h every 30 min'),
        caveat: tr(
          'Cena typowa przybliża ceny transakcji; w statystyce z 1h profil i słabość ekstremów są przybliżone; poniżej 30 sesji „—”. Opis przeszłości, nie prognoza ani sygnał.',
          'The typical price approximates trade prices; in the 1h statistics the profile and weakness of extremes are approximate; below 30 sessions “—”. A description of the past, not a forecast or signal.'
        ),
      },
      {
        metric: tr('Mechanika arkusza (Mikrostruktura)', 'Book mechanics (Microstructure)'),
        source: tr(
          'WS bbo (najlepsze kwotowania, ~co 150 ms), l2Book (~co 5 s) i trades Hyperliquid w przeglądarce — od otwarcia strony, maks. 30 min',
          'Hyperliquid WS bbo (best quotes, every ~150 ms), l2Book (every ~5 s) and trades in the browser — since the page opened, max 30 min'
        ),
        method: tr(
          'OFI Cont–Kukanov–Stoikov w interwałach 10 s i regresja ΔP = α + β·OFI; Hawkes z jądrem wykładniczym (MLE, zdarzenie = blok z transakcjami), współczynnik rozgałęzienia n = α/β; mikrocena: średnia ważona i korekta wg nierównowagi (zmiana mid po 5 s); dodane/anulowane/wykonane z bilansu migawek ±10 bp; absorpcja = reszta odpornej regresji ΔP na wolumenie agresora',
          'Cont–Kukanov–Stoikov OFI in 10 s intervals and the regression ΔP = α + β·OFI; Hawkes with an exponential kernel (MLE, event = a block with trades), branching ratio n = α/β; microprice: weighted mid and an imbalance correction (mid change after 5 s); added/cancelled/executed from the balance of ±10 bp snapshots; absorption = residual of a robust regression of ΔP on aggressor volume'
        ),
        kinds: ['LIVE', 'MODEL'],
        refresh: tr('co 5 s; Hawkes co ~30 s', 'every 5 s; Hawkes every ~30 s'),
        caveat: tr(
          'Brak historii arkusza w publicznym API — estymatory dojrzewają po kilku minutach; dodania i anulowania to bilans netto między migawkami.',
          'The public API has no book history — the estimators mature after a few minutes; additions and cancellations are the net balance between snapshots.'
        ),
      },
      {
        metric: tr('Przepływ agresora per poziom (DOM) i detektor wyczerpania', 'Aggressor flow per level (DOM) and exhaustion detector'),
        source: tr('Ostatnia migawka arkusza i transakcje HL z 60 s', 'The latest book snapshot and HL trades from the last 60 s'),
        method: tr(
          'Wolumen agresora przypisany do poziomu wg odległości ceny; stany absorpcji/wyczerpania z ręcznie dobranych progów (B/S, rozmiar ściany)',
          'Aggressor volume assigned to a level by price distance; absorption/exhaustion states from hand-picked thresholds (B/S, wall size)'
        ),
        kinds: ['MODEL'],
        refresh: tr('z każdą migawką arkusza', 'every book snapshot'),
        caveat: tr(
          'Heurystyka bez walidacji statystycznej — obok pokazywana jest absorpcja z regresji (mechanika arkusza).',
          'A heuristic without statistical validation — absorption from the regression (book mechanics) is shown alongside.'
        ),
      },
      {
        metric: tr('Przepływ kohort', 'Cohort flow'),
        source: tr(
          'Skaner HyperQuant: WS trades BTC (pole users = [kupujący, sprzedający], side = strona agresora); pozycje i ranking kont z książki adresów',
          'HyperQuant scanner: BTC WS trades (users field = [buyer, seller], side = aggressor side); positions and account leaderboard from the address book'
        ),
        method: tr(
          'Kohorty: market makerzy (≥ 80% nominału jako maker, ≥ 1 mln USD), poinformowani (markout 5 min istotnie > 0: test jednostronny, n ≥ 30, FDR Benjamini–Hochberg q = 10%, empiryczny Bayes), wieloryby (pozycja ≥ 1 mln USD lub konto ≥ 10 mln USD), reszta; netto = kupno − sprzedaż wszystkich fillów (suma po kohortach = 0), agresor = fille biorcy; markouty 1/5/60 min poza próbą',
          'Cohorts: market makers (≥ 80% of notional as maker, ≥ USD 1M), informed (5-min markout significantly > 0: one-sided test, n ≥ 30, Benjamini–Hochberg FDR q = 10%, empirical Bayes), whales (position ≥ USD 1M or account ≥ USD 10M), everyone else; net = buys − sells of all fills (sum over cohorts = 0), aggressor = taker fills; 1/5/60-min markouts out of sample'
        ),
        kinds: ['LIVE', 'MODEL'],
        refresh: tr('co 2 min z mapą; kubełki 15 min; klasyfikacja co 10 min', 'every 2 min with the map; 15-min buckets; classification every 10 min'),
        caveat: tr(
          'Wyłącznie agregaty z zamkniętych kubełków; komórki z < 5 uczestnikami lub z jednym > 50% obrotu ukryte wraz z kolejnymi (ukrywanie wtórne), kwoty do 10 tys. USD; „poinformowani” to wynik statystyczny z przeszłości, nie sygnał.',
          'Aggregates from closed buckets only; cells with < 5 participants or with one > 50% of turnover are hidden along with others (secondary suppression), amounts rounded to USD 10k; “informed” is a statistical result from the past, not a signal.'
        ),
      },
      {
        metric: tr('Kaskada likwidacji', 'Liquidation cascade'),
        source: tr(
          'Mapa likwidacji, dzienna zmienność (model zmienności), obrót 24 h z API',
          'Liquidation map, daily volatility (volatility model), 24 h turnover from the API'
        ),
        method: tr(
          'Punkt stały: szok → likwidacje z mapy → wpływ Δp/p = Y·σ·√(Q/V) (Tóth i in. 2011) → kolejne likwidacje; Y = 1, pasmo 0,5–1,5',
          'Fixed point: shock → liquidations from the map → impact Δp/p = Y·σ·√(Q/V) (Tóth et al. 2011) → further liquidations; Y = 1, band 0.5–1.5'
        ),
        kinds: ['MODEL'],
        refresh: tr('z każdą mapą', 'every map'),
        caveat: tr(
          'Wpływ szczytowy i pełne trafienie w arkusz — górna granica; tylko zmierzona część OI.',
          'Peak impact and the full hit on the book — an upper bound; only the measured part of OI.'
        ),
      },
      {
        metric: tr('Heatmapa likwidacji (Lab 3D)', 'Liquidation heatmap (Lab 3D)'),
        source: tr('Ekstrema świec HL', 'HL candle extremes'),
        method: tr(
          'Teoretyczne ceny likwidacji dla dźwigni 5× / 20× / 100× od ekstremów świec',
          'Theoretical liquidation prices for 5× / 20× / 100× leverage from candle extremes'
        ),
        kinds: ['MODEL'],
        refresh: tr('z każdą świecą', 'every candle'),
        caveat: tr(
          'Szacunek, nie pozycje — zmierzona mapa jest w panelu „Mapa likwidacji i kaskada”.',
          'An estimate, not positions — the measured map is in the “Liquidation map and cascade” panel.'
        ),
      },
      {
        metric: 'Order blocks',
        source: tr('Świece HL', 'HL candles'),
        method: tr('Świeca impulsu > k·ATR(14), strefa świeża / zmitygowana (Shaakuni)', 'Impulse candle > k·ATR(14), fresh / mitigated zone (Shaakuni)'),
        kinds: ['MODEL'],
        refresh: tr('z każdą świecą', 'every candle'),
        caveat: tr('Heurystyka bez walidacji statystycznej.', 'A heuristic without statistical validation.'),
      },
      {
        metric: tr('Opcje 3D (Lab)', 'Options 3D (Lab)'),
        source: tr('Cena BTC z HL', 'BTC price from HL'),
        method: tr('Ręcznie sparametryzowany uśmiech IV + Black-Scholes (greki)', 'Hand-parameterised IV smile + Black-Scholes (Greeks)'),
        kinds: ['MODEL'],
        refresh: tr('z ceną', 'with price'),
        caveat: tr('Ilustracja — brak danych opcyjnych (bez GEX, max pain, zero-gamma).', 'An illustration — no options data (no GEX, max pain, zero-gamma).'),
      },
    ],
  },
  {
    title: tr('Dane publiczne', 'Public data'),
    rows: [
      {
        metric: tr('Kalendarz makro', 'Macro calendar'),
        source: tr('Fed (FOMC), BLS (CPI, NFP, PPI), BEA (PKB, PCE)', 'Fed (FOMC), BLS (CPI, NFP, PPI), BEA (GDP, PCE)'),
        method: tr('Oficjalne harmonogramy publikacji; czas ET → UTC z regułą DST', 'Official release schedules; ET → UTC with the DST rule'),
        kinds: ['LIVE'],
        refresh: tr('harmonogram w kodzie · BEA z potoku', 'schedule in code · BEA from the pipeline'),
      },
      {
        metric: tr('Wiadomości', 'News'),
        source: 'RSS: CoinDesk, Cointelegraph, Decrypt, The Block, Bitcoin Magazine, Fed, BLS, SEC',
        method: tr(
          'Tylko nagłówek, czas i link do wydawcy; kategoria ze słów kluczowych',
          'Headline, time and link to the publisher only; category from keywords'
        ),
        kinds: ['LIVE'],
        refresh: tr('potok · co 10 min', 'pipeline · every 10 min'),
      },
      {
        metric: tr('Makro i płynność USD', 'Macro and USD liquidity'),
        source: tr(
          'U.S. Treasury (rentowności, TGA przez FiscalData), NY Fed (reverse repo), CFTC (COT, BTC CME)',
          'U.S. Treasury (yields, TGA via FiscalData), NY Fed (reverse repo), CFTC (COT, CME BTC)'
        ),
        method: tr('Wartości wprost ze źródeł; COT: pozycje netto long − short', 'Values straight from the sources; COT: net positions long − short'),
        kinds: ['LIVE'],
        refresh: tr('dziennie (COT tyg.) · co 10 min', 'daily (COT weekly) · every 10 min'),
      },
      {
        metric: tr('Fear & Greed, ton mediów', 'Fear & Greed, media tone'),
        source: 'alternative.me; GDELT DOC 2.0 (Timeline Tone)',
        method: tr('Indeks i ton wprost ze źródeł', 'Index and tone straight from the sources'),
        kinds: ['LIVE'],
        refresh: tr('dziennie · co 10 min', 'daily · every 10 min'),
      },
      {
        metric: tr('On-chain (opłaty, trudność, hashrate)', 'On-chain (fees, difficulty, hashrate)'),
        source: 'mempool.space REST API',
        method: tr('Wartości wprost z API', 'Values straight from the API'),
        kinds: ['LIVE'],
        refresh: tr('potok · co 10 min', 'pipeline · every 10 min'),
      },
    ],
  },
  {
    title: tr('Opcjonalne (opt-in w tej przeglądarce)', 'Optional (opt-in in this browser)'),
    rows: [
      {
        metric: tr('Transakcje i likwidacje CEX', 'CEX trades and liquidations'),
        source: tr(
          'Binance Futures (USDT-M) i Spot, Bybit Linear, OKX Swap, Coinbase — publiczne WebSockety',
          'Binance Futures (USDT-M) and Spot, Bybit Linear, OKX Swap, Coinbase — public WebSockets'
        ),
        method: tr(
          'Strona agresora wg dokumentacji giełdy; OKX: kontrakty × 0,01 BTC; drobne transakcje sumowane w paczkach 250 ms',
          'Aggressor side per the exchange docs; OKX: contracts × 0.01 BTC; small trades summed in 250 ms batches'
        ),
        kinds: ['LIVE'],
        refresh: tr('na żywo (domyślnie wyłączone)', 'live (off by default)'),
      },
      {
        metric: tr(
          'CVD, ΔOI i funding giełd, grupy Binance i Bybit Tablicy liczb (Wykresy)',
          'Exchange CVD, ΔOI and funding, Binance and Bybit groups of the Numbers table (Charts)'
        ),
        source: tr(
          'Binance USDT-M (świece, openInterestHist, openInterest, premiumIndex, fundingInfo, fundingRate), Binance Spot (świece), Bybit Linear (open-interest, publicTrade, tickers) — publiczne API pobierane przez przeglądarkę',
          'Binance USDT-M (candles, openInterestHist, openInterest, premiumIndex, fundingInfo, fundingRate), Binance Spot (candles), Bybit Linear (open-interest, publicTrade, tickers) — public APIs fetched by the browser'
        ),
        method: tr(
          'Delta świecy = 2 × kupno biorców − wolumen (Binance, z historią); Bybit z transakcji od otwarcia strony (pierwsza świeca od tej chwili, świeca z przerwą połączenia bez wartości); ΔOI w panelu w monetach od początku okresu CVD, w Tablicy liczb — zmiana w świecy; funding przeliczony na 8 h (Hyperliquid co godzinę, Binance i Bybit wg okresu rynku); w Tablicy liczb funding Binance z historii rozliczeń (okres nierozliczony — stawka prognozowana)',
          'Candle delta = 2 × taker buys − volume (Binance, with history); Bybit from trades since the page opened (the first candle from that moment, a candle with a connection gap has no value); ΔOI in the panel in coins from the start of the CVD period, in the Numbers table — the change within the candle; funding converted to 8 h (Hyperliquid hourly, Binance and Bybit per the market’s period); in the Numbers table Binance funding from the settlement history (unsettled period — the predicted rate)'
        ),
        caveat: tr(
          'Bybit bez historii delty; historia OI Binance najwyżej 30 dni i co 5 min; funding w panelu to bieżąca stawka, historia fundingu Binance do ok. 166 dni wstecz (jedno zapytanie)',
          'Bybit has no delta history; Binance OI history at most 30 days and every 5 min; funding in the panel is the current rate, Binance funding history up to ~166 days back (one request)'
        ),
        kinds: ['LIVE'],
        refresh: tr(
          'na żywo, OI i funding Binance co 30 s, nowe rozliczenie Binance po końcu okresu (panele i grupy domyślnie wyłączone)',
          'live, Binance OI and funding every 30 s, a new Binance settlement after the period ends (panels and groups off by default)'
        ),
      },
    ],
  },
];

/** Rodowód liczb: skąd pochodzi każda metryka, jak jest liczona i czy to dane, model czy symulacja. */
export const LineageTable: React.FC = () => (
  <Panel eyebrow={tr('Rodowód liczb', 'Data lineage')} title={tr('Skąd pochodzi każda liczba', 'Where every number comes from')} bodyClassName="flex flex-col">
    <p className="px-4 pt-3 text-xs text-ink-3 leading-relaxed max-w-prose">
      {tr(
        'LIVE — realne dane; MODEL — wynik modelu z realnych danych (metoda obok); SIM — symulacja. Brak danych zawsze jako „—”, nigdy liczba zastępcza.',
        'LIVE — real data; MODEL — model output from real data (method alongside); SIM — simulation. Missing data is always “—”, never a placeholder number.'
      )}
    </p>
    <div className="m-4 mt-3 overflow-x-auto hq-scroll-cue border border-line rounded-lg" tabIndex={0} role="region" aria-label={tr('Tabela rodowodu danych (przewijana)', 'Data lineage table (scrollable)')}>
      <table className="w-full min-w-[820px] text-left text-xs">
        <thead className="bg-surface-2 text-[11px] uppercase tracking-[0.08em] text-ink-3">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium w-[17%] sticky left-0 z-10 bg-surface-2">{tr('Metryka', 'Metric')}</th>
            <th scope="col" className="px-3 py-2 font-medium w-[24%]">{tr('Źródło', 'Source')}</th>
            <th scope="col" className="px-3 py-2 font-medium">{tr('Metoda', 'Method')}</th>
            <th scope="col" className="px-3 py-2 font-medium w-[9%]">{tr('Typ', 'Type')}</th>
            <th scope="col" className="px-3 py-2 font-medium w-[13%]">{tr('Odświeżanie', 'Refresh')}</th>
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
                      <span className="sr-only">{tr('Zastrzeżenie: ', 'Caveat: ')}</span>
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
