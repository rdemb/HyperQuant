/**
 * Skrypt aktualizacji (backend/deploy/hyperquant-update.sh) na prawdziwym git: repo „zdalne” w katalogu tymczasowym,
 * atrapa systemctl zapisująca wywołania, jednorazowe klucze ssh do podpisu tagów (tylko w katalogu tymczasowym testu).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = join(import.meta.dirname, '..', 'hyperquant-update.sh').replaceAll('\\', '/');
const hasTools = spawnSync('bash', ['-c', 'command -v git && command -v ssh-keygen'], { encoding: 'utf8' }).status === 0;

/** Wspólny początek każdego polecenia: izolowana konfiguracja git, atrapa systemctl w PATH, ścieżki bezwzględne. */
const PRELUDE = `set -euo pipefail
abs() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL="$PWD/gitconfig" HOME="$PWD/home" PATH="$PWD/bin:$PATH" HQ_TEST_LOG="$PWD/systemctl.log"
ROOT="$PWD"
commit() { (cd "$ROOT/dev" && mkdir -p "$(dirname "$1")" && echo "$2" > "$1" && git add -A && git commit -qm "$2" && git push -q origin HEAD:main); }
sign() { (cd "$ROOT/dev" && git -c gpg.format=ssh -c user.signingkey="$(abs "$ROOT/keys/$1")" tag -s "$2" -m "$2" "\${3:-HEAD}" && git push -q origin "refs/tags/$2"); }
update() { (cd "$ROOT/app" && HQ_UPDATE_SIGNERS="$(abs "$ROOT/$1")" bash "${SCRIPT}"); }
`;

let dir = '';

function sh(cmd: string) {
  const r = spawnSync('bash', ['-c', PRELUDE + cmd], { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`bash: ${r.status}\n${r.stdout}\n${r.stderr}`);
  return r.stdout.trim();
}

const appHead = () => sh('git -C app rev-parse HEAD');
const devRev = (ref: string) => sh(`git -C dev rev-parse "${ref}^{commit}"`);
/** Wywołania systemctl od ostatniego odczytu */
function calls(): string[] {
  const file = join(dir, 'systemctl.log');
  const out = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  writeFileSync(file, '');
  return out;
}

describe.skipIf(!hasTools)('hyperquant-update.sh', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'hq-update-'));
    writeFileSync(join(dir, 'gitconfig'), '[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n[core]\n\tautocrlf = false\n');
    writeFileSync(join(dir, 'systemctl.log'), '');
    sh(`mkdir -p bin home keys
printf '#!/bin/sh\\necho "$*" >> "$HQ_TEST_LOG"\\n' > bin/systemctl && chmod +x bin/systemctl
ssh-keygen -q -t ed25519 -N "" -C trusted -f keys/trusted
ssh-keygen -q -t ed25519 -N "" -C other -f keys/other
echo "test@example.com $(cat keys/trusted.pub)" > signers
git init -q --bare origin.git
git clone -q origin.git dev
commit backend/a.ts c1
commit content/blog/p.md c1-blog
git clone -q --branch main origin.git app`);
  }, 120_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  describe('tryb gałęzi (brak pliku zaufanych kluczy): jak dotąd', () => {
    it('zmiana kodu skanera: kod równany do gałęzi zdalnej i restart skanera', () => {
      sh('commit backend/a.ts c2');
      sh('update none');
      expect(appHead()).toBe(devRev('main'));
      expect(calls()).toEqual(['restart hyperquant-scanner']);
    }, 60_000);

    it('zmiana serwera powiadomień: restart obu usług', () => {
      sh('commit backend/alerts/x.ts c3');
      sh('update none');
      expect(appHead()).toBe(devRev('main'));
      expect(calls()).toEqual(['restart hyperquant-scanner', 'try-restart hyperquant-alerts']);
    }, 60_000);

    it('sam wpis bloga: pliki zaktualizowane, bez restartu', () => {
      sh('commit content/blog/p.md c4');
      sh('update none');
      expect(appHead()).toBe(devRev('main'));
      expect(calls()).toEqual([]);
    }, 60_000);
  });

  describe('tryb podpisanych tagów (jest plik zaufanych kluczy)', () => {
    it('push bez podpisu (gałąź, tag z opisem bez podpisu, tag lekki) nie zmienia kodu', () => {
      const before = appHead();
      sh(`commit backend/a.ts unsigned
(cd dev && git tag -a v1.1.0 -m v1.1.0 && git tag v1.2.0 && git push -q origin v1.1.0 v1.2.0)`);
      const out = sh('update signers 2>&1');
      expect(appHead()).toBe(before);
      expect(calls()).toEqual([]);
      expect(out).toContain('v1.2.0');
    }, 60_000);

    it('tag podpisany kluczem spoza listy zaufanych nie zmienia kodu', () => {
      const before = appHead();
      sh('sign other v1.3.0');
      sh('update signers');
      expect(appHead()).toBe(before);
      expect(calls()).toEqual([]);
    }, 60_000);

    it('tag z ważnym podpisem zaufanego klucza: kod do tego tagu i restart skanera', () => {
      sh('commit backend/b.ts signed && sign trusted v1.4.0');
      sh('commit backend/a.ts after-tag');
      sh('update signers');
      expect(appHead()).toBe(devRev('v1.4.0'));
      expect(appHead()).not.toBe(devRev('main'));
      expect(calls()).toEqual(['restart hyperquant-scanner']);
    }, 60_000);

    it('podpisany tag pod inną nazwą (przeniesiona referencja) jest pomijany', () => {
      sh('commit backend/c.ts c5 && sign trusted v1.5.0 && (cd dev && git tag v9.0.0 v1.5.0 && git push -q origin v9.0.0)');
      const out = sh('update signers 2>&1');
      expect(out).toContain('v9.0.0');
      expect(appHead()).toBe(devRev('v1.5.0'));
      calls();
    }, 60_000);

    it('podpisany tag na starszym commicie nie cofa wersji', () => {
      const before = appHead();
      sh(`sign trusted v10.0.0 "$(git -C dev rev-list --max-parents=0 HEAD)"`);
      const out = sh('update signers 2>&1');
      expect(appHead()).toBe(before);
      expect(calls()).toEqual([]);
      expect(out).toContain('v10.0.0');
    }, 60_000);
  });
});
