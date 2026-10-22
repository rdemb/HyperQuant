import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { gitEnv } from './gitPublish.ts';
import { GENESIS, makeLine, verifyLines } from './ledger.ts';

/**
 * Magazyn dziennika prognoz: katalog roboczy gałęzi `ledger` repo danych (klon git), pliki `<rynek>/RRRR-MM-DD.jsonl`
 * (dzień UTC), łańcuch hashy ciągły między dniami. Gałąź ma prawdziwą, przyrostową historię (push bez --force) —
 * w przeciwieństwie do gałęzi `main`, która zawsze ma jeden commit z bieżącym stanem.
 */

const run = promisify(execFile);
const DAY = 24 * 3_600_000;
export const LEDGER_BRANCH = 'ledger';
export const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

export type LedgerRecord = Record<string, unknown> & { k?: unknown; id?: unknown; t?: unknown };

export class LedgerStore {
  readonly dir: string;
  readonly coin: string;
  head = GENESIS;
  lines = 0;
  private broken = false;

  constructor(o: { dir: string; coin: string }) {
    this.dir = o.dir;
    this.coin = o.coin;
  }

  private coinDir(): string {
    return join(this.dir, this.coin);
  }

  /** Weryfikuje cały łańcuch i wczytuje rekordy z ostatnich 31 dni. Zepsuty łańcuch → ok = false i blokada dopisywania. */
  load(now: number): {
    ok: boolean;
    forecasts: Map<string, LedgerRecord>;
    resolutions: Map<string, LedgerRecord>;
    skips: LedgerRecord[];
    /** Ostatni rozliczony slot w całym dzienniku (prognoza albo skip, także zakresowy); null = pusty */
    lastSlot: number | null;
    error?: string;
  } {
    const forecasts = new Map<string, LedgerRecord>();
    const resolutions = new Map<string, LedgerRecord>();
    const skips: LedgerRecord[] = [];
    const cd = this.coinDir();
    const files = existsSync(cd) ? readdirSync(cd).filter((f) => DAY_FILE.test(f)).sort() : [];
    const fromDay = dayKey(now - 31 * DAY);
    let prev = GENESIS;
    let count = 0;
    let lastSlot: number | null = null;
    for (const f of files) {
      const lines = readFileSync(join(cd, f), 'utf8').split('\n').filter(Boolean);
      // Najpierw łańcuch (także niepełna linia po awarii zapisu → ok = false, nie wyjątek)
      const v = verifyLines(lines, prev);
      if (!v.ok) {
        this.broken = true;
        return { ok: false, forecasts, resolutions, skips, lastSlot: null, error: `łańcuch przerwany w ${f}, linia ${(v.badLine ?? 0) + 1}` };
      }
      // Ostatni slot: z każdego pliku (tanio — tylko rekordy f/s), żeby ciągłość przetrwała przerwy dłuższe niż 31 dni
      for (const l of lines) {
        if (!l.includes('"k":"f"') && !l.includes('"k":"s"')) continue;
        const o = JSON.parse(l) as { slot?: unknown; until?: unknown };
        const s = typeof o.until === 'number' ? o.until : o.slot;
        if (typeof s === 'number' && (lastSlot === null || s > lastSlot)) lastSlot = s;
      }
      prev = v.head;
      count += lines.length;
      if (f.slice(0, 10) < fromDay) continue;
      for (const l of lines) {
        const o = JSON.parse(l) as LedgerRecord;
        if (o.k === 's' && typeof o.slot === 'number') {
          skips.push(o);
          continue;
        }
        if (typeof o.id !== 'string') continue;
        if (o.k === 'f') forecasts.set(o.id, o);
        else if (o.k === 'r') resolutions.set(o.id, o);
      }
    }
    this.head = prev;
    this.lines = count;
    this.broken = false;
    return { ok: true, forecasts, resolutions, skips, lastSlot };
  }

  /** Dopisuje rekordy do pliku bieżącego dnia UTC; zwraca linie (z prev i h). */
  append(bodies: Record<string, unknown>[], now: number): string[] {
    if (this.broken) throw new Error('łańcuch dziennika jest przerwany — dopisywanie wstrzymane');
    const cd = this.coinDir();
    mkdirSync(cd, { recursive: true });
    const file = join(cd, `${dayKey(now)}.jsonl`);
    const out: string[] = [];
    for (const b of bodies) {
      const { line, hash } = makeLine(this.head, b);
      appendFileSync(file, `${line}\n`);
      this.head = hash;
      this.lines++;
      out.push(line);
    }
    return out;
  }

  path(rel: string): string {
    return join(this.dir, this.coin, rel);
  }

  write(rel: string, body: string | Uint8Array): void {
    const p = this.path(rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }

  exists(rel: string): boolean {
    return existsSync(this.path(rel));
  }
}

export interface LedgerRepo {
  /** Zdalne repo danych (SSH albo ścieżka lokalna w testach) */
  remote: string;
  /** Katalog roboczy gałęzi `ledger` (na serwerze, w katalogu stanu) */
  dir: string;
  sshKey?: string | null;
}

/**
 * Klon gałęzi `ledger` (przez katalog tymczasowy — przerwany klon nie zostawia połowy drzewa), a gdy gałęzi jeszcze nie
 * ma — nowe repo. Istniejący klon: pobranie `origin/ledger` i odmowa, gdy lokalna gałąź jest w tyle (ktoś inny dopisał
 * albo stan lokalny jest stary — dopisanie do starej głowy rozwidliłoby historię). Zdalne repo nieosiągalne → false.
 */
export async function prepareLedgerRepo(o: LedgerRepo, now: number): Promise<boolean> {
  const env = gitEnv(o.dir, o.sshKey, now);
  try {
    if (existsSync(join(o.dir, '.git'))) {
      const git = (...args: string[]) => run('git', ['-C', o.dir, ...args], { env, timeout: 60_000 });
      const heads = await run('git', ['ls-remote', '--heads', o.remote, LEDGER_BRANCH], { env, timeout: 30_000 });
      if (!heads.stdout.trim()) return true; // gałąź jeszcze nie opublikowana
      await git('fetch', '-q', 'origin', `${LEDGER_BRANCH}:refs/remotes/origin/${LEDGER_BRANCH}`);
      const hasHead = await git('rev-parse', '--verify', '-q', 'HEAD').then(
        () => true,
        () => false
      );
      if (!hasHead) return false;
      const counts = await git('rev-list', '--left-right', '--count', `HEAD...origin/${LEDGER_BRANCH}`);
      const behind = Number(counts.stdout.trim().split(/\s+/)[1] ?? '0');
      return behind === 0;
    }
    mkdirSync(dirname(o.dir), { recursive: true });
    const tmp = `${o.dir}.tmp-${now}`;
    rmSync(tmp, { recursive: true, force: true });
    const heads = await run('git', ['ls-remote', '--heads', o.remote, LEDGER_BRANCH], { env, timeout: 30_000 });
    if (heads.stdout.trim()) {
      await run('git', ['clone', '-q', '--branch', LEDGER_BRANCH, '--single-branch', o.remote, tmp], { env, timeout: 120_000 });
    } else {
      mkdirSync(tmp, { recursive: true });
      await run('git', ['-C', tmp, 'init', '-q', '-b', LEDGER_BRANCH], { env });
      await run('git', ['-C', tmp, 'remote', 'add', 'origin', o.remote], { env });
      // Pliki dziennika bajt w bajt (bez konwersji końców linii) — inaczej `ots verify` na klonie z Windows by zawiodło
      writeFileSync(join(tmp, '.gitattributes'), '*.jsonl -text\n*.ots binary\n');
    }
    renameSync(tmp, o.dir);
    return true;
  } catch {
    return false;
  }
}

export interface CommitResult {
  ok: boolean;
  /** Czy gałąź zdalna ma już wszystkie lokalne commity */
  pushed: boolean;
  error?: string;
}

/**
 * Commit zmian i push (bez --force) na gałąź `ledger`. Dozwolone wyłącznie dopisanie: nowe pliki, pliki `.jsonl`,
 * których dotychczasowa treść jest prefiksem nowej, i indeks kotwic. Zmiana wstecz, usunięcie albo zmiana pokwitowania
 * `.ots` → commit odrzucony (i zmiany zdjęte z indeksu). Brak zmian → ok bez commita.
 */
export async function commitLedger(o: LedgerRepo, message: string, now: number): Promise<CommitResult> {
  const env = gitEnv(o.dir, o.sshKey, now);
  const git = (...args: string[]) => run('git', ['-C', o.dir, ...args], { env, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  try {
    await git('add', '-A');
    const hasHead = await git('rev-parse', '--verify', '-q', 'HEAD').then(
      () => true,
      () => false
    );
    const staged = (await git('diff', '--cached', '--name-status', '--no-renames')).stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split('\t'));
    for (const [status, path] of staged) {
      const bad = (why: string) => ({ ok: false, pushed: false, error: `zmiana nie jest dopisaniem (${why}): ${path}` });
      let refusal: CommitResult | null = null;
      if (status.startsWith('D')) refusal = bad('usunięcie');
      else if (status.startsWith('M')) {
        if (path.endsWith('.jsonl') && hasHead) {
          const before = (await git('show', `HEAD:${path}`)).stdout;
          const after = readFileSync(join(o.dir, path), 'utf8');
          if (!after.startsWith(before)) refusal = bad('zmiana zapisanych linii');
        } else if (!path.endsWith('ots/index.json')) refusal = bad('modyfikacja pliku niedozwolona');
      } else if (!status.startsWith('A')) refusal = bad(`status ${status}`);
      if (refusal) {
        await git('reset', '-q');
        return refusal;
      }
    }
    if (staged.length > 0) await git('commit', '-q', '-m', message);
    if (!(await git('rev-parse', '--verify', '-q', 'HEAD').then(
      () => true,
      () => false
    )))
      return { ok: true, pushed: true };
    const ahead = await git('rev-list', '--count', 'HEAD', '--not', '--remotes=origin').catch(() => ({ stdout: '1' }));
    if (ahead.stdout.trim() !== '0') {
      try {
        await git('push', '-q', 'origin', `HEAD:${LEDGER_BRANCH}`);
        await git('fetch', '-q', 'origin', `${LEDGER_BRANCH}:refs/remotes/origin/${LEDGER_BRANCH}`).catch(() => undefined);
      } catch (e) {
        return { ok: true, pushed: false, error: `push nieudany: ${String(e).slice(0, 200)}` };
      }
    }
    return { ok: true, pushed: true };
  } catch (e) {
    return { ok: false, pushed: false, error: String(e).slice(0, 200) };
  }
}
