/**
 * Skaner pozycji Hyperliquid → mapa likwidacji (punkt wejścia usługi).
 * Uruchomienie: `node backend/scanner/main.ts` (Node ≥ 24 — TypeScript bez kompilacji, wbudowane fetch i WebSocket).
 * Konfiguracja wyłącznie ze zmiennych środowiskowych — patrz backend/deploy/scanner.env.example.
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AddressBook } from './addressBook.ts';
import { CandleArchive } from './candleArchive.ts';
import { loadConfig } from './config.ts';
import { HlRest, HlStream, HlTradesStream } from './hl.ts';
import { LiqConfirmer, PriceRange } from './liqDetect.ts';
import { CohortEngine } from './cohortEngine.ts';
import { ForecastData } from './forecaster.ts';
import { LedgerStore, prepareLedgerRepo } from './ledgerStore.ts';
import { LedgerRunner } from './ledgerRunner.ts';
import { LAB_PREREG, LabRunner } from './labRunner.ts';
import { stampDigest } from './ots.ts';
import { marketSnapshot } from './marketQuotes.ts';
import { LiquidityRecorder, chooseAgg, type BookAgg, type MinuteRow } from './liquidity.ts';
import { WeightLimiter } from './rateLimiter.ts';
import { Scanner } from './scanner.ts';
import { fetchLeaderboardAccounts } from './seed.ts';
import { publishToGit } from './gitPublish.ts';
import { HISTORY_README, MarketRecorder, historyIndex, pruneHistory } from './history.ts';
import { prepareHistoryRepo, publishHistory, startWhenReady } from './historyGit.ts';
import { WHALE_MARKETS, WhaleWatcher } from './whales.ts';
import { MAX_DEX_QUERIES, MarketRegistryRunner } from './marketRegistryRunner.ts';
import { FlowFile, FlowMinutes, MarketShadow, parseOpenInterest } from './marketShadow.ts';
import { marketsOrDefault } from '../../src/utils/marketRegistry.ts';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const log = (msg: string) => console.log(`[skaner] ${msg}`);

const loaded = loadConfig(process.env);
if (!loaded.ok) {
  console.error(`[skaner] błędna konfiguracja:\n - ${loaded.errors.join('\n - ')}`);
  process.exit(1);
}
const cfg = loaded.config;
mkdirSync(cfg.stateDir, { recursive: true });
mkdirSync(cfg.outDir, { recursive: true });

const statePath = join(cfg.stateDir, `book-${cfg.coin}.json`);
let book: AddressBook;
try {
  book = AddressBook.fromJSON(JSON.parse(readFileSync(statePath, 'utf8')), cfg.maxAddresses);
  log(`wczytano stan: ${book.size} adresów`);
} catch {
  book = new AddressBook(cfg.maxAddresses);
}

/**
 * Taśma likwidacji: zdarzenia z 24 h (bez adresów) i ceny z taśmy na minutę. Ciągłość obserwacji (`since`) zachowana
 * tylko po przerwie < 2 min (np. restart przy aktualizacji); dłuższa przerwa = obserwacja od nowa, starsze zdarzenia wypadają.
 */
const liqStatePath = join(cfg.stateDir, `liq-${cfg.coin}.json`);
const LIQ_OPTS = { coin: cfg.coin, maxPerMin: 3 };
const MAX_GAP_MS = 2 * 60_000;
let confirmer = new LiqConfirmer(LIQ_OPTS);
let prices = new PriceRange();
let tapeSince = Date.now();
try {
  const j = JSON.parse(readFileSync(liqStatePath, 'utf8')) as { savedAt?: number; since?: number; confirmer?: unknown; prices?: unknown };
  // Najpierw ciągłość taśmy, potem kolejka: po przerwie kandydaci sprzed nowego since znikają bez wpisu, TTL tylko dla reszty
  if (typeof j.savedAt === 'number' && typeof j.since === 'number' && Date.now() - j.savedAt < MAX_GAP_MS) tapeSince = j.since;
  confirmer = LiqConfirmer.fromJSON(j.confirmer, { ...LIQ_OPTS, now: Date.now(), since: tapeSince });
  prices = PriceRange.fromJSON(j.prices);
  log(`wczytano taśmę likwidacji: ${confirmer.events().length} zdarzeń, ${confirmer.pending} kandydatów w kolejce potwierdzeń`);
} catch {
  // brak stanu — nowa taśma
}

/** Przepływ kohort: statystyki per adres i kubełki (stan serwera — adresy nigdy nie są publikowane). */
const cohortStatePath = join(cfg.stateDir, `cohorts-${cfg.coin}.json`);
const COHORT_OPTS = { coin: cfg.coin, isWhale: (a: string) => book.isWhale(a) };
let cohorts = new CohortEngine(COHORT_OPTS);
try {
  cohorts = CohortEngine.fromJSON(JSON.parse(readFileSync(cohortStatePath, 'utf8')), COHORT_OPTS);
  log('wczytano stan kohort');
} catch {
  // brak stanu — nowe kohorty
}

function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, path);
}

/**
 * Pomiar w cieniu M0 (HQ_MARKETS_SHADOW, domyślnie włączony): pozycje rynków głównych z odczytów, które skaner i tak robi,
 * OI z kontekstów pobieranych przez rejestr, transakcje rynków rejestru z jednego dodatkowego połączenia (same `trades`).
 * W `status.json` same liczby (`markets`, `xyz`, `marketsHours`); stan z adresami tylko w HQ_STATE_DIR.
 * K2: przepływ minutowy (kupno i sprzedaż agresywna, USD) w `HQ_STATE_DIR/flow-1m/RRRR-MM-DD.jsonl`, 14 dób, niepublikowany.
 */
const shadowStatePath = join(cfg.stateDir, 'markets-m0.json');
let shadow: MarketShadow | null = null;
if (cfg.marketsShadow) {
  try {
    shadow = MarketShadow.fromJSON(JSON.parse(readFileSync(shadowStatePath, 'utf8')), Date.now());
    log('wczytano stan pomiaru rynków (M0)');
  } catch {
    shadow = new MarketShadow();
  }
}
const flow = new FlowMinutes();
const flowFile = new FlowFile(join(cfg.stateDir, 'flow-1m'));

function saveState(): void {
  if (shadow) writeJsonAtomic(shadowStatePath, shadow.toJSON());
  writeJsonAtomic(statePath, book.toJSON());
  writeJsonAtomic(liqStatePath, { savedAt: Date.now(), since: scanner.tapeSince, confirmer: scanner.confirmer.toJSON(), prices: scanner.prices.toJSON() });
  writeJsonAtomic(cohortStatePath, cohorts.toJSON());
  if (whales) writeJsonAtomic(whaleStatePath, whales.secret);
}

/**
 * Trzy osobne budżety wag (każdy z własnym wiadrem i wycofaniem po błędach): odczyty pozycji (mapa likwidacji), potwierdzenia
 * likwidacji (`userFillsByTime`) oraz prognozy dziennika, rynek HIP-4, archiwum świec i rejestr rynków. Potwierdzenia i prognozy nie
 * zabierają już odczytów pozycji.
 */
const rest = new HlRest(new WeightLimiter(cfg.weightPerMin));
const liqRest = new HlRest(new WeightLimiter(cfg.liqWeightPerMin));
const forecastRest = new HlRest(new WeightLimiter(cfg.forecastWeightPerMin));
const scanner = new Scanner({
  coin: cfg.coin,
  book,
  rest,
  liqRest,
  outDir: cfg.outDir,
  r2: cfg.r2,
  confirmer,
  tapeSince,
  prices,
  cohorts,
  ...(shadow
    ? {
        onScan: (addr: string, st: unknown) => shadow.onScan(addr, st),
        extraStatus: (asOf: number, coverage: number) => shadow.status(asOf, { inBook: (a) => book.has(a), btc: { coin: cfg.coin, coverage } }),
      }
    : {}),
});
let lastWsCtx = 0;
/** Ostatnia wiadomość WebSocket (transakcje lub kontekst) — przerwa > 2 min zeruje okres obserwacji taśmy */
let lastWsMsg = Date.now();
let wsGap = false;
function wsAlive(): void {
  const now = Date.now();
  if (wsGap) {
    wsGap = false;
    scanner.resetObservation(now);
    log('taśma likwidacji: przerwa w danych WebSocket — obserwacja od nowa');
  }
  lastWsMsg = now;
}

/**
 * Rejestrator płynności arkusza: wiersze minutowe w pliku JSONL na serwerze (30 dni), publikowany wyłącznie profil
 * (`liquidity/BTC.json`). Plik dopisywany co minutę, kompaktowany przy starcie i raz na dobę.
 */
const liquidityStatePath = join(cfg.stateDir, `liquidity-${cfg.coin}.jsonl`);
const liquidityOutPath = join(cfg.outDir, 'liquidity', `${cfg.coin}.json`);
const liquidity = new LiquidityRecorder(cfg.coin);
function compactLiquidity(): void {
  const rows = liquidity.allRows();
  const tmp = `${liquidityStatePath}.tmp`;
  writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  renameSync(tmp, liquidityStatePath);
}
try {
  const rows: MinuteRow[] = [];
  for (const line of readFileSync(liquidityStatePath, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      rows.push(JSON.parse(line) as MinuteRow);
    } catch {
      // uszkodzona linia (np. przerwany zapis) — pomijana
    }
  }
  liquidity.load(rows, Date.now());
  compactLiquidity();
  log(`wczytano historię płynności: ${liquidity.allRows().length} minut`);
} catch {
  // brak stanu — historia od teraz
}

const stream = new HlStream(
  cfg.coin,
  (trades) => {
    wsAlive();
    for (const t of trades) {
      const px = Number(t.px);
      const sz = Number(t.sz);
      if (px > 0) scanner.recordTrade(px, t.time);
      if (t.users && px > 0 && sz > 0) {
        book.recordTrade(t.users, px * sz, t.time);
        if (t.side === 'B' || t.side === 'A') cohorts.onTrade({ users: t.users, side: t.side, px, sz, time: t.time });
      }
    }
  },
  (c) => {
    wsAlive();
    scanner.setCtx(c);
    lastWsCtx = Date.now();
  },
  WebSocket,
  (t, levels) => liquidity.onBook(t, levels)
);

/** Jedno dodatkowe połączenie: `trades` dla każdego rynku rejestru (z BTC, żeby wszystkie rynki K2 miały ten sam odcinek połączenia). */
const shadowStream = shadow
  ? new HlTradesStream(
      (trades) => {
        for (const t of trades) {
          shadow!.onTrade(t, (a) => book.has(a));
          flow.onTrade(t.coin, t.side, Number(t.px) * Number(t.sz), t.time);
        }
      },
      (up, at) => flow.onState(up, at),
      WebSocket
    )
  : null;
/** Rynki z `markets.json` (rejestr budowany przez skaner); brak albo zły plik → 4 stałe rynki. */
function applyShadowMarkets(): void {
  if (!shadow || !shadowStream) return;
  let raw: unknown = null;
  try {
    raw = JSON.parse(readFileSync(join(cfg.outDir, 'markets.json'), 'utf8'));
  } catch {
    // brak rejestru — rynki domyślne
  }
  const coins = marketsOrDefault(raw).map((m) => m.coin);
  shadow.setCoins(coins);
  flow.setCoins(coins, Date.now());
  shadowStream.setCoins(coins);
}
applyShadowMarkets();

/**
 * Rejestrator historii (gałąź `history` repo danych, rynki z HQ_HISTORY_MARKETS): na rynek osobne połączenie WebSocket
 * (taśma, kontekst, arkusz bliski i daleki jak na stronie, dla BTC także dokładny). Części 5-minutowe i pliki godzinowe
 * w katalogu repo gałęzi, commit po każdym zapisie; po zamknięciu doby jej profil (kupno, sprzedaż i zmiana OI na cenach);
 * raz na dobę (po 00:15 UTC) usunięcie dni spoza okna i spłaszczenie gałęzi do jednego commita.
 */
const DAY_MS = 86_400_000;
const historyRepo = cfg.git && cfg.history ? { remote: cfg.git.remote, dir: join(cfg.stateDir, 'git', 'history'), sshKey: cfg.git.sshKey, branch: 'history' } : null;
const historyDir = historyRepo ? historyRepo.dir : join(cfg.stateDir, 'history');
if (cfg.history) mkdirSync(historyDir, { recursive: true });
const recorders = (cfg.history?.markets ?? []).map((coin) => {
  const rec = new MarketRecorder(coin, historyDir);
  const s: HlStream = new HlStream(
    coin,
    (t) => rec.onTrades(t),
    (c) => {
      rec.onCtx(c, Date.now());
      const aggs = rec.aggs();
      if (aggs) s.setBookAggs(aggs, rec.exactBook());
    },
    WebSocket,
    (t, levels) => rec.onBook(t, levels),
    (up, at) => rec.onState(up, at)
  );
  return { rec, stream: s };
});
/** Repo gałęzi przygotowane (bez repo — od razu): dopiero wtedy rejestratory słuchają, a takt historii zapisuje i wypycha */
let historyReady = historyRepo === null;
let historyBusy = false;
/** Doba UTC ostatniego sprzątania (od startu bieżąca — pierwsze spłaszczenie następnej doby) */
let historyDay = Math.floor(Date.now() / DAY_MS);

async function historyTick(): Promise<void> {
  // Przed przygotowaniem repo (startWhenReady przy starcie) rejestratory jeszcze nie słuchają — nic do zapisu ani pushu
  if (!cfg.history || historyBusy || !historyReady) return;
  historyBusy = true;
  try {
    const now = Date.now();
    let written = 0;
    for (const { rec } of recorders) written += rec.flush(now);
    // Profile zamkniętych dób (po połączeniu ostatniej godziny doby; po wdrożeniu — po jednej dobie wstecz na takt)
    for (const { rec } of recorders) written += rec.profiles(now);
    const day = Math.floor(now / DAY_MS);
    const daily = day !== historyDay && now - day * DAY_MS >= 15 * 60_000;
    if (daily) pruneHistory(historyDir, cfg.history.markets, cfg.history.keepDays, now);
    if (written > 0 || daily) {
      writeJsonAtomic(join(historyDir, 'index.json'), historyIndex(historyDir, cfg.history.markets, cfg.history.keepDays, now));
      writeFileSync(join(historyDir, 'README.md'), HISTORY_README);
    }
    if (!historyRepo) {
      if (daily) historyDay = day;
      return;
    }
    if (written === 0 && !daily) return;
    const r = await publishHistory(historyRepo, `historia: ${new Date(now).toISOString()}`, now, daily);
    if (r.ok && r.pushed) {
      if (daily) historyDay = day;
    } else console.error(`[skaner] historia: ${r.error ?? 'commit/push nieudany'}`);
  } finally {
    historyBusy = false;
  }
}

/**
 * Warstwa wielorybów (HQ_WHALE_TOP > 0): pozycje i zlecenia największych kont z rankingu i dużych pozycji BTC, we własnym
 * budżecie wag; plik `whales.json` bez adresów (pseudonim konta na dobę UTC, sekret doby tylko w stanie serwera).
 */
const whaleStatePath = join(cfg.stateDir, 'whale-salt.json');
let whaleSalt: { day: number; key: string } | undefined;
try {
  const j = JSON.parse(readFileSync(whaleStatePath, 'utf8')) as { day?: unknown; key?: unknown };
  if (typeof j.day === 'number' && typeof j.key === 'string' && j.key.length >= 32) whaleSalt = { day: j.day, key: j.key };
} catch {
  // brak stanu — nowy sekret doby
}
const whaleCfg = cfg.whales;
const whales = whaleCfg
  ? new WhaleWatcher({ rest: new HlRest(new WeightLimiter(whaleCfg.weightPerMin)), candidates: () => book.whaleCandidates(whaleCfg.top), coins: WHALE_MARKETS, salt: whaleSalt })
  : null;

/**
 * Rejestr rynków `markets.json` (reguła `reg-v1`): raz na godzinę, start od 3. do 8. minuty slotu dziennika, `perpDexs`
 * i `metaAndAssetCtxs` najwyżej 19 giełd (reszta w kolejnych godzinach), po 20 wag, z budżetu prognoz, z odstępem 20 s
 * między giełdami (przy 11 giełdach 240 wag na godzinę); dzienne próbki OI w `HQ_STATE_DIR` przetrwają restart.
 * Pełne warstwy skanera (`scanner: "full"`) ma rynek `HQ_COIN`.
 */
const marketRegistry = new MarketRegistryRunner({
  rest: forecastRest,
  statePath: join(cfg.stateDir, 'markets-state.json'),
  outPath: join(cfg.outDir, 'markets.json'),
  scannerCoins: [cfg.coin],
  onDexCtxs: (dex, raw, at) => {
    const oi = dex === '' && shadow ? parseOpenInterest(raw) : null;
    if (oi) shadow!.setOi(oi, at);
  },
});

async function marketRegistryTick(): Promise<void> {
  const r = await marketRegistry.tick(Date.now());
  if (r.error) console.error(`[skaner] rejestr rynków: ${r.error}`);
  if (!r.ran) return;
  applyShadowMarkets();
  log(`rejestr rynków: ${r.markets} rynków z ${r.dexes} giełd`);
  if (r.entered?.length) log(`rejestr rynków: weszły ${r.entered.join(', ')}`);
  if (r.left?.length) log(`rejestr rynków: wyszły ${r.left.join(', ')}`);
  if (r.skipped?.length) log(`rejestr rynków: giełdy pominięte w tej godzinie (limit ${MAX_DEX_QUERIES} zapytań): ${r.skipped.join(', ')}`);
}

/** Zasiew największymi kontami z publicznego rankingu (adresy zostają na serwerze). */
async function seedFromLeaderboard(): Promise<void> {
  if (cfg.seedTop <= 0) return;
  const accounts = await fetchLeaderboardAccounts(cfg.seedMinUsd, cfg.seedTop);
  const fresh = accounts.filter((a) => !book.has(a.address)).length;
  const t = Date.now();
  for (const a of accounts) book.seed(a.address, a.accountValue, t);
  log(`ranking kont: ${accounts.length} kont ≥ ${cfg.seedMinUsd} USD, nowych ${fresh}, w książce z rankingu ${book.seededCount}`);
}

const DATA_README = [
  '# HyperQuant — dane publiczne',
  '',
  'Agregaty publikowane automatycznie przez skaner [HyperQuant](https://github.com/rdemb/HyperQuant) (katalog backend/).',
  'Repozytorium zawiera zawsze jeden commit z bieżącym stanem.',
  '',
  '- `liq-map/BTC.json` — mapa likwidacji BTC z pozycji on-chain Hyperliquid: kubełki cen likwidacji, pokrycie open interest, wiek odczytów.',
  '- `liq-tape/BTC.json` — likwidacje śledzonych pozycji z 24 h, potwierdzone fillami z polem `liquidation`: czas, strona, rozmiar, cena, błąd mapy.',
  '- `cohorts/BTC.json` — przepływ kohort (market makerzy, statystycznie poinformowani, wieloryby, reszta): kubełki 15 min z 24 h, markouty poza próbą; k-anonimowość (komórki z < 5 uczestnikami lub z dominującym uczestnikiem ukryte); wolumen taśmy i ukryte komórki razem w oknach 1 h i 24 h.',
  '- `liquidity/BTC.json` — profil płynności arkusza: mediana głębokości obu stron w ±10 / ±20 bp wg godziny UTC (do 30 dni), bieżąca płynność względem normy godziny, odporność po gwałtownych ruchach.',
  '- `lab/BTC.json` — laboratorium folkloru: reguły day tradingu (okrągłe poziomy, zebranie PDH/PDL, IB, VWAP, luka CME, finansowanie, 10:00 NY, momentum) — test historyczny z FDR i prerejestrowany test do przodu (e-wartości, e-BH) ze wszystkimi zdarzeniami do przeliczenia.',
  '- `whales.json` — warstwa wielorybów (BTC, ETH, SOL, HYPE): pozycje (wartość, wejście, likwidacja, dźwignia) i zlecenia oczekujące z wyzwalanymi (limit, stop, TP) największych kont z publicznego rankingu i dużych pozycji BTC; konto jako pseudonim ważny jedną dobę UTC, bez adresów; kwoty i ceny zaokrąglone.',
  '- `markets.json` — rejestr rynków (reguła `reg-v1`, co godzinę): największe rynki wszystkich giełd perp Hyperliquid, także HIP-3 (`xyz:NVDA`), według średniej otwartych pozycji z 7 dni; wejście po 3 dniach w pierwszej 20, wyjście po 7 dniach poza 30. miejscem; BTC, ETH, SOL i HYPE zawsze. Przez histerezę (rynek między 21. a 30. miejscem zostaje) i 4 stałe rynki plik może mieć więcej niż 20 rynków.',
  '- `status.json` — stan skanera (liczby adresów i pozycji, błędy API).',
  '- `alerts/keys.json` — klucze publiczne serwera powiadomień o alarmach: VAPID (subskrypcje push przeglądarek) i Ed25519 (podpis zapytań do skrzynki alarmów).',
  '',
  'Gałąź `history` — nagranie taśmy, arkusza i kontekstu rynków (części 5-minutowe i pliki godzinowe JSON w gzip, okno ostatnich dni, jeden commit): historia footprintu, Delty, CVD i mapy ciepła od pierwszej sekundy na stronie, profile zamkniętych dób (kupno, sprzedaż i zmiana OI na cenach); opis w README gałęzi.',
  '',
  'Gałąź `ledger` — weryfikowalny dziennik prognoz desku (historia przyrostowa): pliki dzienne `BTC/RRRR-MM-DD.jsonl` z łańcuchem hashy SHA-256,',
  'kotwice OpenTimestamps `BTC/ots/`, podsumowanie `BTC/summary.json`. Weryfikacja: `node scripts/verify-ledger.mjs` w repo HyperQuant.',
  '',
  'Gałąź `archive` — archiwum świec BTC 1m / 1h / 1d i godzinowego finansowania (CSV, historia przyrostowa, tylko dopisywanie): API Hyperliquid oddaje najwyżej ~5000 ostatnich świec, archiwum zachowuje resztę.',
  '',
  'Gałąź `health` — stan strażnika skanera (`alert.json`, `report.md`) zapisywany przy zmianie stanu; workflow tej gałęzi otwiera i zamyka zgłoszenie `alert-danych`.',
  '',
  'Wyłącznie agregaty — bez adresów portfeli. Źródło: publiczne API Hyperliquid. Metoda: src/utils/liqMap.ts w repo HyperQuant.',
  '',
].join('\n');

/** Publikacja do publicznego repo danych (darmowa): bieżące pliki z HQ_OUT_DIR + README, jeden commit. */
async function gitPublishTick(): Promise<void> {
  if (!cfg.git) return;
  const files: [string, string][] = [];
  for (const key of [`liq-map/${cfg.coin}.json`, 'status.json']) {
    try {
      files.push([key, readFileSync(join(cfg.outDir, key), 'utf8')]);
    } catch {
      return; // jeszcze nic nie opublikowano lokalnie
    }
  }
  // Pliki opcjonalne (np. kohorty po błędzie budowy) nie wstrzymują publikacji mapy
  for (const key of [`liq-tape/${cfg.coin}.json`, `cohorts/${cfg.coin}.json`, `ledger/${cfg.coin}/summary.json`, `liquidity/${cfg.coin}.json`, `lab/${cfg.coin}.json`, 'whales.json', 'markets.json', 'alerts/keys.json']) {
    try {
      files.push([key, readFileSync(join(cfg.outDir, key), 'utf8')]);
    } catch {
      // brak pliku — pomijam
    }
  }
  files.push(['README.md', DATA_README]);
  const ok = await publishToGit({ remote: cfg.git.remote, workDir: join(cfg.stateDir, 'git', 'repo'), sshKey: cfg.git.sshKey }, files, Date.now());
  if (!ok) console.error('[skaner] publikacja do repo danych nieudana (spróbuję w następnym cyklu)');
}

/**
 * Weryfikowalny dziennik prognoz: gałąź `ledger` repo danych (przyrostowa historia, łańcuch hashy, OpenTimestamps).
 * Bez publikacji git — lokalny katalog w HQ_STATE_DIR (np. test dymny).
 */
let ledger: LedgerRunner | null = null;
/** Zepsuty łańcuch: dziennik wyłączony do restartu (bez ponownej weryfikacji całości co minutę) */
let ledgerBroken = false;
let ledgerInit: Promise<void> | null = null;
const ledgerSummaryPath = join(cfg.outDir, 'ledger', cfg.coin, 'summary.json');

async function initLedger(): Promise<void> {
  const now = Date.now();
  const dir = cfg.git ? join(cfg.stateDir, 'git', 'ledger') : join(cfg.stateDir, 'ledger');
  const repo = cfg.git ? { remote: cfg.git.remote, dir, sshKey: cfg.git.sshKey } : null;
  if (repo && !(await prepareLedgerRepo(repo, now))) {
    console.error('[skaner] dziennik: repo danych niedostępne albo klon w tyle za origin — spróbuję za minutę');
    return;
  }
  const store = new LedgerStore({ dir, coin: cfg.coin });
  const runner = new LedgerRunner({
    coin: cfg.coin,
    data: new ForecastData({ coin: cfg.coin, rest: forecastRest }),
    store,
    repo,
    markPx: () => scanner.freshMarkPx(),
    // Model vs rynek (HIP-4): aktywny 15-minutowy rynek binarny BTC — outcomeMeta + arkusz strony „Tak”
    markets: (expiry, at) => marketSnapshot(forecastRest, expiry, at),
    stamp: (d) => stampDigest(d),
    clock: Date.now,
    publish: (json) => {
      mkdirSync(join(cfg.outDir, 'ledger', cfg.coin), { recursive: true });
      writeJsonAtomic(ledgerSummaryPath, JSON.parse(json));
    },
  });
  const r = runner.init(now);
  if (!r.ok) {
    ledgerBroken = true;
    console.error(`[skaner] dziennik: ${r.error} — dopisywanie wstrzymane do naprawy (restart po naprawie)`);
    return;
  }
  ledger = runner;
  if (store.repairedTail) log(`dziennik: ucięta ostatnia linia ${store.repairedTail.file} (${store.repairedTail.bytes} B) usunięta, rekord naprawy dopisany`);
  log(`dziennik: ${store.lines} linii, głowa ${store.head.slice(0, 12)}`);
}

async function ledgerTick(): Promise<void> {
  if (ledgerBroken) return;
  if (!ledger) {
    // Jedna inicjalizacja naraz (klon może trwać dłużej niż interwał timera)
    if (!ledgerInit) ledgerInit = initLedger().finally(() => (ledgerInit = null));
    await ledgerInit;
    return;
  }
  const res = await ledger.tick(Date.now());
  if (res.commit && (!res.commit.ok || !res.commit.pushed)) console.error(`[skaner] dziennik: ${res.commit.error ?? 'commit/push nieudany'}`);
}

/**
 * Archiwum świec (gałąź `archive` repo danych, tylko dopisywanie) i laboratorium folkloru: co 10 min nowe świece,
 * commit najwyżej co godzinę; katalog reguł prerejestrowany w dzienniku, ocena co godzinę → `lab/<coin>.json`.
 */
const archiveDir = cfg.git ? join(cfg.stateDir, 'git', 'archive') : join(cfg.stateDir, 'archive');
const ledgerStoreForLookup = () => new LedgerStore({ dir: cfg.git ? join(cfg.stateDir, 'git', 'ledger') : join(cfg.stateDir, 'ledger'), coin: cfg.coin });
const lab = new LabRunner({
  coin: cfg.coin,
  archive: new CandleArchive({ dir: archiveDir, coin: cfg.coin, rest: forecastRest }),
  repo: cfg.git ? { remote: cfg.git.remote, dir: archiveDir, sshKey: cfg.git.sshKey, branch: 'archive' } : null,
  // Dziennik gotowy → rejestracja (albo istniejący rekord); jeszcze się ładuje → rekord odczytany wprost z plików
  register: () => ledger?.register(LAB_PREREG, Date.now()) ?? ledgerStoreForLookup().findPrereg(LAB_PREREG.catalogHash),
  publish: (report) => {
    mkdirSync(join(cfg.outDir, 'lab'), { recursive: true });
    writeJsonAtomic(join(cfg.outDir, 'lab', `${cfg.coin}.json`), report);
  },
});

async function labTick(): Promise<void> {
  const r = await lab.tick(Date.now());
  if (r.error) console.error(`[skaner] archiwum/laboratorium: ${r.error}`);
  if (r.added > 0 || r.evaluated) log(`archiwum: +${r.added} wierszy${r.committed ? ' (commit)' : ''}${r.evaluated ? ', laboratorium przeliczone' : ''}`);
}

/**
 * Agregacja arkusza rejestratora płynności: 20 poziomów ma pokrywać ±20 bp (przy cenie ≥ 100 tys. 4 cyfry znaczące dają
 * koszyki 100 USD — pomiar ±10 bp byłby zdegenerowany). Histereza w `chooseAgg`; zmiana = nowa subskrypcja.
 */
let bookAgg: BookAgg = { nSigFigs: 4 };
function adjustBookAgg(): void {
  const px = scanner.freshMarkPx() ?? liquidity.lastMid();
  if (!px) return;
  const next = chooseAgg(px, bookAgg);
  if (next.nSigFigs === bookAgg.nSigFigs && next.mantissa === bookAgg.mantissa) return;
  bookAgg = { nSigFigs: next.nSigFigs, ...(next.mantissa ? { mantissa: next.mantissa } : {}) };
  stream.setBookAgg(bookAgg);
  log(`płynność: agregacja arkusza ${bookAgg.nSigFigs} cyfr znaczących${bookAgg.mantissa ? `, mantysa ${bookAgg.mantissa}` : ''} (koszyk ${next.bucket} USD)`);
}

/** Zapas dla kontekstu rynku, gdy WebSocket milczy > 2 min (waga 20). */
async function ctxFallback(): Promise<void> {
  if (Date.now() - lastWsCtx < 120_000) return;
  const res = (await rest.info({ type: 'metaAndAssetCtxs' }, 20)) as [{ universe?: { name: string }[] }, Record<string, string>[]] | null;
  if (!Array.isArray(res) || !Array.isArray(res[0]?.universe) || !Array.isArray(res[1])) return;
  const i = res[0].universe!.findIndex((u) => u.name === cfg.coin);
  const ctx = i >= 0 ? res[1][i] : null;
  if (ctx) scanner.setCtx({ markPx: Number(ctx.markPx), oiBtc: Number(ctx.openInterest), dayNtlVlm: Number(ctx.dayNtlVlm) });
}

let stopping = false;
async function scanLoop(): Promise<void> {
  while (!stopping) {
    try {
      const n = await scanner.scanDue(20);
      if (n === 0) await sleep(1000);
    } catch (e) {
      // Nieoczekiwany błąd nie może zatrzymać skanera — odczekaj i próbuj dalej
      console.error(`[skaner] błąd pętli skanu: ${String(e)}`);
      await sleep(5000);
    }
  }
}

/** Potwierdzenia likwidacji we własnej pętli (własny budżet wag): czekanie na ich żetony nie wstrzymuje skanu pozycji. */
async function liqLoop(): Promise<void> {
  while (!stopping) {
    try {
      if ((await scanner.confirmLiquidations()) === 0) await sleep(2000);
    } catch (e) {
      console.error(`[skaner] błąd potwierdzeń likwidacji: ${String(e)}`);
      await sleep(5000);
    }
  }
}

/** Pętla warstwy wielorybów (własny budżet wag — nie spowalnia skanu pozycji BTC). */
async function whaleLoop(): Promise<void> {
  while (!stopping && whales) {
    try {
      if ((await whales.tick(Date.now)) === 0) await sleep(5000);
    } catch (e) {
      console.error(`[skaner] błąd warstwy wielorybów: ${String(e)}`);
      await sleep(5000);
    }
  }
}

/** Zadanie timera z przechwyceniem błędów (np. pełny dysk) — błąd jest logowany, proces działa dalej. */
function guarded(name: string, fn: () => unknown): () => Promise<void> {
  return async () => {
    try {
      await fn();
    } catch (e) {
      console.error(`[skaner] błąd zadania ${name}: ${String(e)}`);
    }
  };
}

const timers = [
  setInterval(guarded('publikacja', async () => {
    if (Date.now() - lastWsMsg > MAX_GAP_MS) wsGap = true;
    await ctxFallback();
    const ok = await scanner.publish();
    if (whales) writeJsonAtomic(join(cfg.outDir, 'whales.json'), whales.build(Date.now()));
    const s = book.positions().length;
    log(
      `adresy=${book.size} pozycje=${s} zapytania=${rest.requests}/${liqRest.requests}/${forecastRest.requests} błędy=${rest.errors + liqRest.errors + forecastRest.errors} ws=${stream.connected ? 'ok' : 'brak'} ` +
        `publikacja=${ok ? 'ok' : 'brak/niepełna'}${cfg.r2 ? ' (R2)' : ' (lokalnie)'}`
    );
  }), cfg.publishEveryS * 1000),
  setInterval(guarded('czyszczenie', () => book.prune(Date.now())), 10 * 60_000),
  ...(shadowStream
    ? [
        setInterval(guarded('przepływ minutowy', () => flowFile.append(flow.flush(Date.now()))), 60_000),
        setInterval(
          guarded('czyszczenie pomiaru rynków', () => {
            const now = Date.now();
            shadow?.prune(now, (a) => book.has(a));
            flowFile.prune(now);
          }),
          10 * 60_000
        ),
      ]
    : []),
  setInterval(
    guarded('markouty kohort', () => {
      const now = Date.now();
      cohorts.settle(now);
      cohorts.housekeep(now);
    }),
    5_000
  ),
  setInterval(guarded('klasyfikacja kohort', () => cohorts.classify(Date.now())), 10 * 60_000),
  setInterval(
    guarded('dziennik', ledgerTick),
    60_000
  ),
  setInterval(guarded('zapis stanu', saveState), 5 * 60_000),
  setInterval(
    guarded('płynność', () => {
      const rows = liquidity.flush(Date.now());
      if (rows.length) appendFileSync(liquidityStatePath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    }),
    60_000
  ),
  setInterval(
    guarded('profil płynności', () => {
      mkdirSync(join(cfg.outDir, 'liquidity'), { recursive: true });
      writeJsonAtomic(liquidityOutPath, liquidity.profile(Date.now()));
    }),
    10 * 60_000
  ),
  setInterval(guarded('kompaktowanie płynności', compactLiquidity), 24 * 60 * 60_000),
  setInterval(guarded('agregacja arkusza', adjustBookAgg), 10 * 60_000),
  setInterval(guarded('zasiew', seedFromLeaderboard), 6 * 60 * 60_000),
  setInterval(guarded('archiwum i laboratorium', labTick), 10 * 60_000),
  setInterval(guarded('rejestr rynków', marketRegistryTick), 5 * 60_000),
  ...(cfg.git ? [setInterval(guarded('repo danych', gitPublishTick), cfg.git.everyS * 1000)] : []),
  ...(cfg.history ? [setInterval(guarded('historia', historyTick), 15_000)] : []),
];
setTimeout(guarded('zasiew', seedFromLeaderboard), 5_000);
// Archiwum i laboratorium po inicjalizacji dziennika (rejestracja katalogu wymaga gotowego łańcucha)
setTimeout(guarded('archiwum i laboratorium', labTick), 90_000);
// Rejestr rynków po starcie (bez zapytań, gdy ostatnia próbka ze stanu ma mniej niż godzinę), potem takt co 5 min
setTimeout(guarded('rejestr rynków', marketRegistryTick), 2 * 60_000);
// Klasyfikacja kohort wkrótce po starcie (liczności i zbiory po restarcie bez czekania 10 min)
setTimeout(guarded('klasyfikacja kohort', () => cohorts.classify(Date.now())), 30_000);

function shutdown(): void {
  if (stopping) return;
  stopping = true;
  for (const t of timers) clearInterval(t);
  stream.stop();
  for (const r of recorders) r.stream.stop();
  shadowStream?.stop();
  try {
    if (shadowStream) flowFile.append(flow.flush(Date.now()));
  } catch (e) {
    console.error(`[skaner] zapis przepływu minutowego przy zatrzymaniu nieudany: ${String(e)}`);
  }
  try {
    // Bieżąca część taśmy do chwili zatrzymania (aktualizacja restartuje skaner — bez tego luka do 5 min)
    for (const { rec } of recorders) rec.flush(Date.now(), true);
  } catch (e) {
    console.error(`[skaner] zapis historii przy zatrzymaniu nieudany: ${String(e)}`);
  }
  try {
    saveState();
  } catch (e) {
    console.error(`[skaner] zapis stanu nieudany: ${String(e)}`);
  }
  log('zatrzymano');
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Pomocniczo do testu dymnego: zakończ po N minutach
const runMinutes = Number(process.env.HQ_RUN_MINUTES ?? '');
if (runMinutes > 0) setTimeout(shutdown, runMinutes * 60_000);

log(
  `start: rynek ${cfg.coin}, budżety wag/min: pozycje ${cfg.weightPerMin}, likwidacje ${cfg.liqWeightPerMin}, prognozy ${cfg.forecastWeightPerMin}, publikacja co ${cfg.publishEveryS} s ${cfg.r2 ? 'do R2' : 'lokalnie'}` +
    (cfg.git ? `, repo danych co ${cfg.git.everyS} s` : '') +
    (cfg.history ? `, historia ${cfg.history.markets.join('/')} (${cfg.history.keepDays} dni${historyRepo ? '' : ', lokalnie'})` : '') +
    (whales ? `, wieloryby: ${whaleCfg?.top} kont, ${whaleCfg?.weightPerMin} wag/min` : '')
);
// Agregacja arkusza dobrana do ceny przed pierwszym połączeniem (z ostatniej zapisanej minuty), potem co 10 min
adjustBookAgg();
stream.start();
if (shadowStream) {
  shadowStream.start();
  log(`pomiar rynków (M0, K2): jedno połączenie, ${shadowStream.subscriptions} subskrypcji trades`);
}
// Rejestratory historii z repo gałęzi dopiero po jego przygotowaniu: na świeżym klonie numeracja doby musi widzieć pliki
// doby odtworzone z gałęzi (inaczej numery od 0 powtórzyłyby numery innych kont); reszta skanera startuje od razu
const startRecorders = () => {
  for (const r of recorders) r.stream.start();
};
if (historyRepo)
  void startWhenReady(
    () => prepareHistoryRepo(historyRepo, Date.now()),
    () => {
      historyReady = true;
      startRecorders();
    },
    30_000,
    () => console.error('[skaner] historia: repo gałęzi niedostępne — nagrywanie wstrzymane, spróbuję za 30 s')
  );
else startRecorders();
setTimeout(guarded('agregacja arkusza', adjustBookAgg), 60_000);
void scanLoop();
void liqLoop();
void whaleLoop();
