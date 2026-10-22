/**
 * Skaner pozycji Hyperliquid → mapa likwidacji (punkt wejścia usługi).
 * Uruchomienie: `node backend/scanner/main.ts` (Node ≥ 24 — TypeScript bez kompilacji, wbudowane fetch i WebSocket).
 * Konfiguracja wyłącznie ze zmiennych środowiskowych — patrz backend/deploy/scanner.env.example.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AddressBook } from './addressBook.ts';
import { loadConfig } from './config.ts';
import { HlRest, HlStream } from './hl.ts';
import { LiqConfirmer, PriceRange } from './liqDetect.ts';
import { CohortEngine } from './cohortEngine.ts';
import { ForecastData } from './forecaster.ts';
import { LedgerStore, prepareLedgerRepo } from './ledgerStore.ts';
import { LedgerRunner } from './ledgerRunner.ts';
import { WeightLimiter } from './rateLimiter.ts';
import { Scanner } from './scanner.ts';
import { fetchLeaderboardAccounts } from './seed.ts';
import { publishToGit } from './gitPublish.ts';

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
  confirmer = LiqConfirmer.fromJSON(j.confirmer, LIQ_OPTS);
  prices = PriceRange.fromJSON(j.prices);
  if (typeof j.savedAt === 'number' && typeof j.since === 'number' && Date.now() - j.savedAt < MAX_GAP_MS) tapeSince = j.since;
  log(`wczytano taśmę likwidacji: ${confirmer.events().length} zdarzeń`);
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

function saveState(): void {
  writeJsonAtomic(statePath, book.toJSON());
  writeJsonAtomic(liqStatePath, { savedAt: Date.now(), since: scanner.tapeSince, confirmer: scanner.confirmer.toJSON(), prices: scanner.prices.toJSON() });
  writeJsonAtomic(cohortStatePath, cohorts.toJSON());
}

const rest = new HlRest(new WeightLimiter(cfg.weightPerMin));
const scanner = new Scanner({ coin: cfg.coin, book, rest, outDir: cfg.outDir, r2: cfg.r2, confirmer, tapeSince, prices, cohorts });
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
  }
);

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
  '- `cohorts/BTC.json` — przepływ kohort (market makerzy, statystycznie poinformowani, wieloryby, reszta): kubełki 15 min z 24 h, markouty poza próbą; k-anonimowość (komórki z < 5 uczestnikami lub z dominującym uczestnikiem ukryte).',
  '',
  'Gałąź `ledger` — weryfikowalny dziennik prognoz desku (historia przyrostowa): pliki dzienne `BTC/RRRR-MM-DD.jsonl` z łańcuchem hashy SHA-256,',
  'kotwice OpenTimestamps `BTC/ots/`, podsumowanie `BTC/summary.json`. Weryfikacja: `node scripts/verify-ledger.mjs` w repo HyperQuant.',
  '- `status.json` — stan skanera (liczby adresów i pozycji, błędy API).',
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
  for (const key of [`liq-tape/${cfg.coin}.json`, `cohorts/${cfg.coin}.json`]) {
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
async function initLedger(): Promise<void> {
  const now = Date.now();
  const dir = cfg.git ? join(cfg.stateDir, 'git', 'ledger') : join(cfg.stateDir, 'ledger');
  const repo = cfg.git ? { remote: cfg.git.remote, dir, sshKey: cfg.git.sshKey } : null;
  if (repo && !(await prepareLedgerRepo(repo, now))) {
    console.error('[skaner] dziennik: repo danych niedostępne — spróbuję za minutę');
    return;
  }
  const store = new LedgerStore({ dir, coin: cfg.coin });
  const runner = new LedgerRunner({ coin: cfg.coin, data: new ForecastData({ coin: cfg.coin, rest }), store, repo, markPx: () => scanner.freshMarkPx() });
  const r = runner.init(now);
  if (!r.ok) {
    console.error(`[skaner] dziennik: ${r.error} — dopisywanie wstrzymane`);
    return;
  }
  ledger = runner;
  log(`dziennik: ${store.lines} linii, głowa ${store.head.slice(0, 12)}`);
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
      const q = await scanner.confirmLiquidations();
      if (n === 0 && q === 0) await sleep(1000);
    } catch (e) {
      // Nieoczekiwany błąd nie może zatrzymać skanera — odczekaj i próbuj dalej
      console.error(`[skaner] błąd pętli skanu: ${String(e)}`);
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
    const s = book.positions().length;
    log(
      `adresy=${book.size} pozycje=${s} zapytania=${rest.requests} błędy=${rest.errors} ws=${stream.connected ? 'ok' : 'brak'} ` +
        `publikacja=${ok ? 'ok' : 'brak/niepełna'}${cfg.r2 ? ' (R2)' : ' (lokalnie)'}`
    );
  }), cfg.publishEveryS * 1000),
  setInterval(guarded('czyszczenie', () => book.prune(Date.now())), 10 * 60_000),
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
    guarded('dziennik', async () => {
      if (!ledger) await initLedger();
      else await ledger.tick(Date.now());
    }),
    60_000
  ),
  setInterval(guarded('zapis stanu', saveState), 5 * 60_000),
  setInterval(guarded('zasiew', seedFromLeaderboard), 6 * 60 * 60_000),
  ...(cfg.git ? [setInterval(guarded('repo danych', gitPublishTick), cfg.git.everyS * 1000)] : []),
];
setTimeout(guarded('zasiew', seedFromLeaderboard), 5_000);
// Klasyfikacja kohort wkrótce po starcie (liczności i zbiory po restarcie bez czekania 10 min)
setTimeout(guarded('klasyfikacja kohort', () => cohorts.classify(Date.now())), 30_000);

function shutdown(): void {
  if (stopping) return;
  stopping = true;
  for (const t of timers) clearInterval(t);
  stream.stop();
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
  `start: rynek ${cfg.coin}, budżet ${cfg.weightPerMin} wag/min, publikacja co ${cfg.publishEveryS} s ${cfg.r2 ? 'do R2' : 'lokalnie'}` +
    (cfg.git ? `, repo danych co ${cfg.git.everyS} s` : '')
);
stream.start();
void scanLoop();
