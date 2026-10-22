import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { publishToGit } from '../gitPublish.ts';

const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

function bareRemote(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hq-remote-'));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', dir]);
  return dir;
}

describe('publishToGit — publikacja agregatów do publicznego repo danych', () => {
  it('każda publikacja zastępuje gałąź jednym commitem (repo nie puchnie); treść = ostatnia publikacja', async () => {
    const remote = bareRemote();
    const work = join(mkdtempSync(join(tmpdir(), 'hq-work-')), 'repo');
    const t0 = Date.UTC(2026, 9, 22, 8, 0, 0);
    expect(await publishToGit({ remote, workDir: work }, [['liq-map/BTC.json', '{"v":1,"a":1}'], ['README.md', '# dane']], t0)).toBe(true);
    expect(await publishToGit({ remote, workDir: work }, [['liq-map/BTC.json', '{"v":1,"a":2}'], ['README.md', '# dane']], t0 + 120_000)).toBe(true);
    expect(git(remote, 'rev-list', '--count', 'main')).toBe('1');
    expect(git(remote, 'show', 'main:liq-map/BTC.json')).toBe('{"v":1,"a":2}');
  });

  it('neutralny autor i data w UTC — żadnych danych serwera w metadanych commita', async () => {
    const remote = bareRemote();
    const work = join(mkdtempSync(join(tmpdir(), 'hq-work-')), 'repo');
    await publishToGit({ remote, workDir: work }, [['status.json', '{}']], Date.UTC(2026, 9, 22, 8, 2, 0));
    expect(git(remote, 'log', '-1', '--format=%an <%ae> | %cn <%ce> | %ad | %s', '--date=iso-strict', 'main')).toBe(
      'HyperQuant scanner <hyperquant-scanner@users.noreply.github.com> | HyperQuant scanner <hyperquant-scanner@users.noreply.github.com> | 2026-10-22T08:02:00Z | dane: 2026-10-22T08:02:00.000Z'
    );
  });

  it('niedostępne zdalne repo → false, bez wyjątku', async () => {
    const work = join(mkdtempSync(join(tmpdir(), 'hq-work-')), 'repo');
    expect(await publishToGit({ remote: join(tmpdir(), 'nie-ma-takiego-repo-hq'), workDir: work }, [['a.json', '{}']], 0)).toBe(false);
  });
});
