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

function saveState(): void {
  const tmp = `${statePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(book.toJSON()));
  renameSync(tmp, statePath);
}

const rest = new HlRest(new WeightLimiter(cfg.weightPerMin));
const scanner = new Scanner({ coin: cfg.coin, book, rest, outDir: cfg.outDir, r2: cfg.r2 });
let lastWsCtx = 0;

const stream = new HlStream(
  cfg.coin,
  (trades) => {
    for (const t of trades) {
      const px = Number(t.px);
      const sz = Number(t.sz);
      if (t.users && px > 0 && sz > 0) book.recordTrade(t.users, px * sz, t.time);
    }
  },
  (c) => {
    scanner.setCtx(c);
    lastWsCtx = Date.now();
  }
);

/** Zasiew największymi kontami z publicznego rankingu (adresy zostają na serwerze). */
async function seedFromLeaderboard(): Promise<void> {
  if (cfg.seedTop <= 0) return;
  const accounts = await fetchLeaderboardAccounts(cfg.seedMinUsd, cfg.seedTop);
  const before = book.seededCount;
  const t = Date.now();
  for (const a of accounts) book.seed(a.address, a.accountValue, t);
  log(`ranking kont: ${accounts.length} kont ≥ ${cfg.seedMinUsd} USD, nowych ${book.seededCount - before}`);
}

const DATA_README = [
  '# HyperQuant — dane publiczne',
  '',
  'Agregaty publikowane automatycznie przez skaner [HyperQuant](https://github.com/rdemb/HyperQuant) (katalog backend/).',
  'Repozytorium zawiera zawsze jeden commit z bieżącym stanem.',
  '',
  '- `liq-map/BTC.json` — mapa likwidacji BTC z pozycji on-chain Hyperliquid: kubełki cen likwidacji, pokrycie open interest, wiek odczytów.',
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
  files.push(['README.md', DATA_README]);
  const ok = await publishToGit({ remote: cfg.git.remote, workDir: join(cfg.stateDir, 'git', 'repo'), sshKey: cfg.git.sshKey }, files, Date.now());
  if (!ok) console.error('[skaner] publikacja do repo danych nieudana (spróbuję w następnym cyklu)');
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
    await ctxFallback();
    const ok = await scanner.publish();
    const s = book.positions().length;
    log(
      `adresy=${book.size} pozycje=${s} zapytania=${rest.requests} błędy=${rest.errors} ws=${stream.connected ? 'ok' : 'brak'} ` +
        `publikacja=${ok ? 'ok' : 'brak/niepełna'}${cfg.r2 ? ' (R2)' : ' (lokalnie)'}`
    );
  }), cfg.publishEveryS * 1000),
  setInterval(guarded('czyszczenie', () => book.prune(Date.now())), 10 * 60_000),
  setInterval(guarded('zapis stanu', saveState), 5 * 60_000),
  setInterval(guarded('zasiew', seedFromLeaderboard), 6 * 60 * 60_000),
  ...(cfg.git ? [setInterval(guarded('repo danych', gitPublishTick), cfg.git.everyS * 1000)] : []),
];
setTimeout(guarded('zasiew', seedFromLeaderboard), 5_000);

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
