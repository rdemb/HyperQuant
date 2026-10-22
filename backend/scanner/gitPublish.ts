import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

/**
 * Publikacja agregatów do publicznego repo danych na GitHubie — darmowa, bez kart i kont w chmurze.
 * Każda publikacja to jeden commit „od zera” wypychany z --force: gałąź zawiera zawsze tylko bieżący stan, repo nie puchnie.
 * Metadane neutralne: stały autor (noreply), data w UTC — żadnej nazwy hosta, strefy czasowej ani ścieżek serwera.
 * Klucz SSH (wdrożeniowy, z prawem zapisu tylko do repo danych) istnieje wyłącznie na serwerze.
 */

const run = promisify(execFile);
const AUTHOR = 'HyperQuant scanner';
const EMAIL = 'hyperquant-scanner@users.noreply.github.com';

export interface GitTarget {
  /** Zdalne repo: SSH (git@github.com:…) albo ścieżka lokalna (testy) */
  remote: string;
  /** Katalog roboczy (odtwarzany przy każdej publikacji) */
  workDir: string;
  /** Prywatny klucz wdrożeniowy (dla zdalnego repo SSH) */
  sshKey?: string | null;
  branch?: string;
}

function gitDate(ms: number): string {
  return `${new Date(ms).toISOString().replace(/\.\d{3}Z$/, '')}+00:00`;
}

/**
 * Środowisko git bez konfiguracji globalnej i systemowej (żadne dane właściciela nie trafią do commita): stały autor
 * (noreply), data UTC, klucz wdrożeniowy tylko dla zdalnego SSH; known_hosts obok katalogu roboczego.
 */
export function gitEnv(workDir: string, sshKey: string | null | undefined, now: number): NodeJS.ProcessEnv {
  const date = gitDate(now);
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    HOME: dirname(workDir),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: AUTHOR,
    GIT_AUTHOR_EMAIL: EMAIL,
    GIT_COMMITTER_NAME: AUTHOR,
    GIT_COMMITTER_EMAIL: EMAIL,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  };
  if (sshKey) {
    const knownHosts = join(dirname(workDir), 'known_hosts');
    env.GIT_SSH_COMMAND = `ssh -i ${sshKey} -o IdentitiesOnly=yes -o UserKnownHostsFile=${knownHosts} -o StrictHostKeyChecking=accept-new -o BatchMode=yes`;
  }
  return env;
}

export async function publishToGit(t: GitTarget, files: [string, string][], now: number): Promise<boolean> {
  const branch = t.branch ?? 'main';
  try {
    rmSync(t.workDir, { recursive: true, force: true });
    mkdirSync(t.workDir, { recursive: true });
    for (const [key, body] of files) {
      const p = join(t.workDir, key);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, body);
    }
    const env = gitEnv(t.workDir, t.sshKey, now);
    const git = (...args: string[]) => run('git', ['-C', t.workDir, ...args], { env, timeout: 30_000 });
    await git('init', '-q', '-b', branch);
    await git('add', '-A');
    await git('commit', '-q', '-m', `dane: ${new Date(now).toISOString()}`);
    await git('push', '-q', '--force', t.remote, `HEAD:${branch}`);
    return true;
  } catch {
    return false;
  }
}
