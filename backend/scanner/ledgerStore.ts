import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  load(now: number): { ok: boolean; forecasts: Map<string, LedgerRecord>; resolutions: Map<string, LedgerRecord>; error?: string } {
    const forecasts = new Map<string, LedgerRecord>();
    const resolutions = new Map<string, LedgerRecord>();
    const cd = this.coinDir();
    const files = existsSync(cd) ? readdirSync(cd).filter((f) => DAY_FILE.test(f)).sort() : [];
    const fromDay = dayKey(now - 31 * DAY);
    let prev = GENESIS;
    let count = 0;
    for (const f of files) {
      const lines = readFileSync(join(cd, f), 'utf8').split('\n').filter(Boolean);
      const v = verifyLines(lines, prev);
      if (!v.ok) {
        this.broken = true;
        return { ok: false, forecasts, resolutions, error: `łańcuch przerwany w ${f}, linia ${(v.badLine ?? 0) + 1}` };
      }
      prev = v.head;
      count += lines.length;
      if (f.slice(0, 10) < fromDay) continue;
      for (const l of lines) {
        const o = JSON.parse(l) as LedgerRecord;
        if (typeof o.id !== 'string') continue;
        if (o.k === 'f') forecasts.set(o.id, o);
        else if (o.k === 'r') resolutions.set(o.id, o);
      }
    }
    this.head = prev;
    this.lines = count;
    this.broken = false;
    return { ok: true, forecasts, resolutions };
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

/** Klon gałęzi `ledger`, a gdy jej jeszcze nie ma — nowe repo z tą gałęzią. Zdalne repo nieosiągalne → false. */
export async function prepareLedgerRepo(o: LedgerRepo, now: number): Promise<boolean> {
  if (existsSync(join(o.dir, '.git'))) return true;
  mkdirSync(dirname(o.dir), { recursive: true });
  const env = gitEnv(o.dir, o.sshKey, now);
  try {
    const heads = await run('git', ['ls-remote', '--heads', o.remote, LEDGER_BRANCH], { env, timeout: 30_000 });
    if (heads.stdout.trim()) {
      await run('git', ['clone', '-q', '--branch', LEDGER_BRANCH, '--single-branch', o.remote, o.dir], { env, timeout: 120_000 });
    } else {
      mkdirSync(o.dir, { recursive: true });
      await run('git', ['-C', o.dir, 'init', '-q', '-b', LEDGER_BRANCH], { env });
      await run('git', ['-C', o.dir, 'remote', 'add', 'origin', o.remote], { env });
    }
    return true;
  } catch {
    return false;
  }
}

/** Commit zmian i push (bez --force) na gałąź `ledger`; brak zmian → true bez commita. */
export async function commitLedger(o: LedgerRepo, message: string, now: number): Promise<boolean> {
  const env = gitEnv(o.dir, o.sshKey, now);
  const git = (...args: string[]) => run('git', ['-C', o.dir, ...args], { env, timeout: 60_000 });
  try {
    await git('add', '-A');
    const st = await git('status', '--porcelain');
    if (st.stdout.trim()) await git('commit', '-q', '-m', message);
    const ahead = await git('rev-list', '--count', 'HEAD', '--not', '--remotes=origin').catch(() => ({ stdout: '1' }));
    if (ahead.stdout.trim() !== '0') await git('push', '-q', 'origin', `HEAD:${LEDGER_BRANCH}`);
    return true;
  } catch {
    return false;
  }
}
