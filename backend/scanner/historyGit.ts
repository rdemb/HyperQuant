import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gitEnv } from './gitPublish.ts';
import type { CommitResult, LedgerRepo } from './ledgerStore.ts';

/**
 * Gałąź `history` repo danych: klon na serwerze jest źródłem prawdy (nikt inny do niej nie pisze), więc push zawsze z
 * --force — rozjazd po nieudanym pushu nie blokuje kolejnych. Commit co zapis części; raz na dobę gałąź jest
 * spłaszczana do jednego commita (okno ostatnich dni bez historii usuniętych plików), a stare obiekty sprzątane lokalnie.
 * Pliki to gzip (nie kompresują się dalej): pakowanie bez szukania delt — mało pamięci w limicie usługi.
 */

const run = promisify(execFile);
const LEAN = ['-c', 'gc.auto=0', '-c', 'pack.window=0', '-c', 'pack.depth=0', '-c', 'pack.threads=1', '-c', 'core.compression=0'];

/**
 * Repo gałęzi w katalogu rejestratora (pliki mogą już tam być — rejestrator pisze od startu): `git init` na miejscu,
 * a gdy gałąź istnieje — jej stan jako HEAD i brakujące pliki odtworzone z niej (lokalne zostają). Znacznik gotowości
 * dopiero po całości: przerwane przygotowanie powtarza się, zamiast wypchnąć niepełne drzewo w miejsce gałęzi.
 */
export async function prepareHistoryRepo(o: LedgerRepo, now: number): Promise<boolean> {
  const marker = join(o.dir, '.git', 'hq-ready');
  if (existsSync(marker)) return true;
  const env = gitEnv(o.dir, o.sshKey, now);
  const branch = o.branch ?? 'history';
  const git = (...args: string[]) => run('git', [...LEAN, '-C', o.dir, ...args], { env, timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
  try {
    mkdirSync(o.dir, { recursive: true });
    if (!existsSync(join(o.dir, '.git'))) await git('init', '-q', '-b', branch);
    await git('remote', 'remove', 'origin').catch(() => undefined);
    await git('remote', 'add', 'origin', o.remote);
    const heads = await run('git', ['ls-remote', '--heads', o.remote, branch], { env, timeout: 30_000 });
    if (heads.stdout.trim()) {
      await git('fetch', '-q', 'origin', `${branch}:refs/remotes/origin/${branch}`);
      await git('reset', '-q', '--mixed', `origin/${branch}`);
      const missing = (await git('ls-files', '--deleted', '-z')).stdout.split('\0').filter(Boolean);
      if (missing.length > 0) await git('checkout', '--', ...missing);
    }
    writeFileSync(marker, '');
    return true;
  } catch {
    return false;
  }
}

/** Commit wszystkich zmian (także usunięć) i push; `squash` — gałąź od nowa jako jeden commit z bieżącym drzewem. */
export async function publishHistory(o: LedgerRepo, message: string, now: number, squash: boolean): Promise<CommitResult> {
  const env = gitEnv(o.dir, o.sshKey, now);
  const branch = o.branch ?? 'history';
  const git = (...args: string[]) => run('git', [...LEAN, '-C', o.dir, ...args], { env, timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
  try {
    await git('add', '-A');
    const staged = (await git('diff', '--cached', '--name-only')).stdout.trim() !== '';
    const hasHead = await git('rev-parse', '--verify', '-q', 'HEAD').then(
      () => true,
      () => false
    );
    if (squash && hasHead) {
      await git('checkout', '-q', '--orphan', `hq-squash-${now}`);
      await git('commit', '-q', '--allow-empty', '-m', message);
      await git('branch', '-q', '-M', branch);
      // Gałęzie po przerwanym spłaszczeniu trzymałyby stare obiekty przy sprzątaniu
      const heads = (await git('for-each-ref', '--format=%(refname:short)', 'refs/heads')).stdout.split('\n').filter((h) => h && h !== branch);
      for (const h of heads) await git('branch', '-q', '-D', h);
    } else if (staged) {
      await git('commit', '-q', '-m', message);
    }
    if (!(await git('rev-parse', '--verify', '-q', 'HEAD').then(
      () => true,
      () => false
    )))
      return { ok: true, pushed: true };
    const ahead = await git('rev-list', '--count', 'HEAD', '--not', '--remotes=origin').catch(() => ({ stdout: '1' }));
    if (squash || ahead.stdout.trim() !== '0') {
      try {
        await git('push', '-q', '--force', 'origin', `HEAD:${branch}`);
        await git('update-ref', `refs/remotes/origin/${branch}`, 'HEAD');
      } catch (e) {
        return { ok: true, pushed: false, error: `push nieudany: ${String(e).slice(0, 200)}` };
      }
    }
    if (squash) {
      await git('reflog', 'expire', '--expire=now', '--all');
      await git('gc', '-q', '--prune=now');
    }
    return { ok: true, pushed: true };
  } catch (e) {
    return { ok: false, pushed: false, error: String(e).slice(0, 200) };
  }
}
