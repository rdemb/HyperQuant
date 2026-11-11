import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const DEPLOY = join(import.meta.dirname, '..');
const ROOT = join(DEPLOY, '..', '..');
/** Katalog równany co 15 min do repo zdalnego — kod z niego nie może działać jako root */
const APP = '/opt/hyperquant/app';

type Unit = Record<string, Record<string, string[]>>;

/** Prosty parser plików systemd: sekcje, klucze, wiele wartości tego samego klucza (bez kontynuacji linii). */
function parseUnit(text: string): Unit {
  const unit: Unit = {};
  let section = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const s = /^\[(.+)\]$/.exec(line);
    if (s) {
      section = s[1];
      unit[section] ??= {};
      continue;
    }
    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim();
    (unit[section][key] ??= []).push(line.slice(eq + 1).trim());
  }
  return unit;
}

const read = (name: string) => readFileSync(join(DEPLOY, name), 'utf8');
const service = (name: string) => parseUnit(read(name)).Service;
const one = (svc: Record<string, string[]>, key: string) => svc[key]?.at(-1);

describe('usługi systemd: kod z katalogu aktualizowanego nie działa jako root', () => {
  const services = readdirSync(DEPLOY).filter((f) => f.endsWith('.service'));

  it('każda usługa root (bez User=) uruchamia tylko polecenia spoza katalogu aktualizowanego', () => {
    expect(services.length).toBeGreaterThanOrEqual(4);
    for (const name of services) {
      const svc = service(name);
      const user = one(svc, 'User');
      if (user && user !== 'root' && user !== '0') continue;
      for (const exec of svc.ExecStart ?? []) expect(exec, name).not.toContain(APP);
      expect(one(svc, 'WorkingDirectory') === APP && (svc.ExecStart ?? []).some((e) => /\bnode\b/.test(e)), name).toBe(false);
    }
  });

  it('strażnik: własny użytkownik systemowy, kod z kopii instalowanej przez install.sh', () => {
    const svc = service('hyperquant-watchdog.service');
    expect(one(svc, 'User')).toBe('hyperquant-watchdog');
    expect(one(svc, 'Group')).toBe('hyperquant-watchdog');
    // grupa usług: odczyt status.json skanera i pulsu serwera powiadomień (pliki 0640)
    expect(one(svc, 'SupplementaryGroups')).toBe('hyperquant');
    expect(one(svc, 'ExecStart')).toBe('/opt/hyperquant/node/bin/node /opt/hyperquant/watchdog/scripts/watchdog.mjs');
    expect(one(svc, 'WorkingDirectory')).toBe('/opt/hyperquant/watchdog');
    expect(read('hyperquant-watchdog.service')).not.toContain(APP);
  });

  it('strażnik nie czyta pliku skanera (sekrety R2 i reszta konfiguracji skanera), tylko własny watchdog.env', () => {
    const svc = service('hyperquant-watchdog.service');
    expect(svc.EnvironmentFile).toEqual(['/etc/hyperquant/watchdog.env']);
    expect(read('hyperquant-watchdog.service')).not.toContain('scanner.env');
  });

  it('watchdog.env z install.sh ma dokładnie zmienne, które czyta strażnik (poza ustawionymi w jednostce i kluczem z LoadCredential)', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'watchdog.mjs'), 'utf8');
    const read_ = new Set([...src.matchAll(/env\.(HQ_\w+)/g)].map((m) => m[1]));
    const inUnit = new Set((service('hyperquant-watchdog.service').Environment ?? []).map((e) => e.split('=')[0]));
    const needed = [...read_].filter((v) => !inUnit.has(v) && v !== 'HQ_GIT_SSH_KEY').sort();
    const m = /for var in ([A-Z_ ]+); do\n[^\n]*env_value/.exec(read('install.sh'));
    expect(m, 'pętla zmiennych watchdog.env w install.sh').not.toBeNull();
    expect(m![1].trim().split(/\s+/).sort()).toEqual(needed);
    expect(needed).toEqual(['HQ_GIT_REMOTE', 'HQ_OUT_DIR', 'HQ_STATE_DIR']);
  });

  it('strażnik: izolacja jak usługa skanera (bez uprawnień, zapis tylko do własnego katalogu stanu)', () => {
    const svc = service('hyperquant-watchdog.service');
    const expected: Record<string, string> = {
      UMask: '0077',
      NoNewPrivileges: 'true',
      ProtectSystem: 'strict',
      ProtectHome: 'true',
      PrivateTmp: 'true',
      PrivateDevices: 'true',
      ProtectClock: 'true',
      ProtectHostname: 'true',
      ProtectKernelTunables: 'true',
      ProtectKernelModules: 'true',
      ProtectKernelLogs: 'true',
      ProtectControlGroups: 'true',
      RestrictNamespaces: 'true',
      RestrictSUIDSGID: 'true',
      RestrictRealtime: 'true',
      LockPersonality: 'true',
      CapabilityBoundingSet: '',
      SystemCallArchitectures: 'native',
      SystemCallFilter: '@system-service',
      StateDirectory: 'hyperquant-watchdog',
      StateDirectoryMode: '0700',
    };
    for (const [k, v] of Object.entries(expected)) expect(one(svc, k), k).toBe(v);
    expect(svc.ReadWritePaths).toBeUndefined();
  });

  it('aktualizacja: polecenia z pliku instalowanego przez install.sh, nie z repo', () => {
    const svc = service('hyperquant-update.service');
    expect(one(svc, 'User')).toBeUndefined();
    expect(one(svc, 'ExecStart')).toBe('/opt/hyperquant/bin/hyperquant-update');
    expect(one(svc, 'WorkingDirectory')).toBe(APP);
    expect(svc.EnvironmentFile).toEqual(['-/etc/hyperquant/update.env']);
    for (const k of ['NoNewPrivileges', 'ProtectHome', 'PrivateTmp', 'PrivateDevices', 'RestrictSUIDSGID', 'RestrictNamespaces']) expect(one(svc, k), k).toBe('true');
    expect(one(svc, 'ProtectSystem')).toBe('strict');
    expect(svc.ReadWritePaths).toEqual([APP]);
  });
});

type Rule = (action: { id: string; lookup: (k: string) => string | undefined }, subject: { user: string }) => unknown;

/** Reguła polkit wykonana w piaskownicy z atrapą obiektu `polkit` (jak w polkitd: addRule + Result). */
function loadPolkitRules(): Rule[] {
  const rules: Rule[] = [];
  const polkit = { Result: { NO: 'no', YES: 'yes', AUTH_ADMIN: 'auth_admin', NOT_HANDLED: null }, addRule: (r: Rule) => rules.push(r) };
  new Function('polkit', read('hyperquant-watchdog.rules'))(polkit);
  return rules;
}

function decide(user: string, unit: string, verb: string, id = 'org.freedesktop.systemd1.manage-units') {
  const details: Record<string, string> = { unit, verb };
  for (const rule of loadPolkitRules()) {
    const r = rule({ id, lookup: (k) => details[k] }, { user });
    if (r !== null && r !== undefined) return r;
  }
  return null;
}

describe('reguła polkit strażnika', () => {
  it('pozwala tylko na restart skanera i serwera powiadomień', () => {
    expect(decide('hyperquant-watchdog', 'hyperquant-scanner.service', 'restart')).toBe('yes');
    expect(decide('hyperquant-watchdog', 'hyperquant-alerts.service', 'restart')).toBe('yes');
  });

  it('nic więcej: inne czynności, inne usługi, inni użytkownicy, inne akcje', () => {
    for (const verb of ['start', 'stop', 'reload', 'try-restart', 'kill', 'reset-failed', 'enable']) {
      expect(decide('hyperquant-watchdog', 'hyperquant-scanner.service', verb), verb).toBeNull();
    }
    for (const unit of ['hyperquant-update.service', 'hyperquant-watchdog.service', 'ssh.service', 'hyperquant-scanner', 'hyperquant-scanner.service.d']) {
      expect(decide('hyperquant-watchdog', unit, 'restart'), unit).toBeNull();
    }
    expect(decide('hyperquant', 'hyperquant-scanner.service', 'restart')).toBeNull();
    expect(decide('nobody', 'hyperquant-alerts.service', 'restart')).toBeNull();
    expect(decide('hyperquant-watchdog', 'hyperquant-scanner.service', 'restart', 'org.freedesktop.systemd1.manage-unit-files')).toBeNull();
  });
});

describe('install.sh', () => {
  const sh = read('install.sh');

  it('tworzy użytkownika strażnika i instaluje regułę polkit', () => {
    expect(sh).toMatch(/id hyperquant-watchdog >\/dev\/null 2>&1 \|\| useradd --system [^\n]*--shell \/usr\/sbin\/nologin hyperquant-watchdog/);
    expect(sh).toContain('backend/deploy/hyperquant-watchdog.rules" /etc/polkit-1/rules.d/50-hyperquant-watchdog.rules');
  });

  it('kopiuje strażnika i skrypt aktualizacji poza katalog aktualizowany (root, bez prawa zapisu dla usług)', () => {
    expect(sh).toMatch(/install -D -o root -g root -m 0644 "\$PREFIX\/app\/\$f" "\$PREFIX\/watchdog\.new\/\$f"/);
    expect(sh).toMatch(/install -o root -g root -m 0755 "\$PREFIX\/app\/backend\/deploy\/hyperquant-update\.sh" "\$PREFIX\/bin\/hyperquant-update"/);
  });

  // Kopia strażnika zachowuje układ repo; brak choćby jednego lokalnego importu = strażnik nie startuje po install.sh
  const copied = (): string[] => {
    const m = /WATCHDOG_FILES="([^"]+)"/.exec(sh);
    return m ? m[1].trim().split(/\s+/) : [];
  };
  const localImports = (rel: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(rel)) return seen;
    seen.add(rel);
    const src = readFileSync(join(ROOT, rel), 'utf8');
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*'(\.{1,2}\/[^']+)'/g)) {
      localImports(join(rel, '..', m[1]).replace(/\\/g, '/'), seen);
    }
    return seen;
  };

  it('kopia strażnika obejmuje wszystkie lokalne importy scripts/watchdog.mjs (i package.json z typem modułu)', () => {
    const files = copied();
    for (const f of localImports('scripts/watchdog.mjs')) expect(files, f).toContain(f);
    expect(files).toContain('package.json');
  });

  it('kopia strażnika w osobnym katalogu wczytuje się bez reszty repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-watchdog-copy-'));
    try {
      for (const f of copied()) {
        mkdirSync(join(dir, f, '..'), { recursive: true });
        copyFileSync(join(ROOT, f), join(dir, f));
      }
      const url = pathToFileURL(join(dir, 'scripts', 'watchdog.mjs')).href;
      const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)})`], { encoding: 'utf8' });
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('klucz wdrożeniowy dla strażnika przez LoadCredential (plik zostaje własnością skanera)', () => {
    expect(sh).toContain('LoadCredential=deploy_key:');
  });

  it('w trybie podpisanych tagów instaluje tylko wskazany tag z ważnym podpisem', () => {
    expect(sh).toMatch(/verify-tag "refs\/tags\/\$TAG"/);
    expect(sh).toContain('gpg.ssh.allowedSignersFile');
  });

  /**
   * check_polkit z install.sh (plik bez końcowego wywołania main) z atrapą pkaction: `version` = wynik
   * `pkaction --version`, null = brak polecenia (atrapa bez wyniku i z kodem 127).
   */
  function checkPolkit(version: string | null, consent = false) {
    const dir = mkdtempSync(join(tmpdir(), 'hq-polkit-'));
    const lib = sh.replace(/\nmain "\$@"\s*$/, '\n');
    expect(lib).not.toBe(sh);
    writeFileSync(join(dir, 'lib.sh'), lib);
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin', 'pkaction'), version === null ? '#!/bin/sh\nexit 127\n' : `#!/bin/sh\necho "${version}"\n`);
    const env = { ...process.env, HQ_WATCHDOG_NO_POLKIT: consent ? '1' : '' };
    const r = spawnSync('bash', ['-c', 'chmod +x bin/pkaction; export PATH="$PWD/bin:$PATH"; source ./lib.sh; check_polkit'], { cwd: dir, env, encoding: 'utf8' });
    rmSync(dir, { recursive: true, force: true });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  }

  it.skipIf(spawnSync('bash', ['-c', 'true']).status !== 0)('polkit < 0.106 albo brak: install.sh zatrzymuje się, chyba że jest jawna zgoda HQ_WATCHDOG_NO_POLKIT=1', () => {
    for (const v of [null, 'pkaction version 0.105', 'pkaction version 0.105.33']) {
      const r = checkPolkit(v);
      expect(r.status, String(v)).not.toBe(0);
      expect(r.out).toContain('HQ_WATCHDOG_NO_POLKIT=1');
    }
    for (const v of [null, 'pkaction version 0.105']) {
      const r = checkPolkit(v, true);
      expect(r.status, String(v)).toBe(0);
      expect(r.out).toContain('tylko alarmuje');
    }
    for (const v of ['pkaction version 0.106', 'pkaction version 124', 'pkaction version 126']) {
      const r = checkPolkit(v);
      expect(r.status, v).toBe(0);
      expect(r.out).toBe('');
    }
  });

  it.skipIf(spawnSync('bash', ['-c', 'true']).status !== 0)('składnia bash poprawna (bash -n)', () => {
    for (const f of ['install.sh', 'hyperquant-update.sh']) {
      const r = spawnSync('bash', ['-n'], { input: read(f), encoding: 'utf8' });
      expect(r.status, `${f}: ${r.stderr}`).toBe(0);
    }
  });
});

describe('wydawca bloga (hyperquant-blog-publisher): autor bez klucza, kolejka na serwerze', () => {
  const svc = () => service('hyperquant-blog-publisher.service');
  const sh = read('install.sh');
  const COPY = '/opt/hyperquant/blog-publisher';
  const DIRS = ['/var/lib/hyperquant-blog/kolejka', '/var/lib/hyperquant-blog/zrobione', '/var/lib/hyperquant-blog/odrzucone', '/var/lib/hyperquant-blog/stan', '/var/lib/hyperquant-blog/praca'];

  it('osobny użytkownik (nie skaner, nie autor), grupa kolejki, kod z kopii poza katalogiem aktualizowanym', () => {
    expect(one(svc(), 'User')).toBe('hyperquant-blog');
    expect(one(svc(), 'Group')).toBe('hyperquant-blog');
    expect(one(svc(), 'SupplementaryGroups')).toBe('hqblog');
    expect(one(svc(), 'Type')).toBe('oneshot');
    expect(one(svc(), 'ExecStart')).toBe(`/opt/hyperquant/node/bin/node ${COPY}/scripts/blog/publisher.mjs`);
    expect(one(svc(), 'WorkingDirectory')).toBe(COPY);
    // z katalogu aktualizowanego tylko wpisy main (dane, nie kod), do sprawdzenia identyfikatorów
    expect(read('hyperquant-blog-publisher.service').match(new RegExp(APP.replaceAll('/', '\\/'), 'g'))).toHaveLength(1);
    expect(svc().Environment).toEqual([
      'HQ_BLOG_DIR=/var/lib/hyperquant-blog',
      'HQ_BLOG_STATE=/var/lib/hyperquant-blog-publisher',
      `HQ_BLOG_MAIN_CONTENT=${APP}/content/blog`,
      `HQ_GIT_KNOWN_HOSTS=${COPY}/known_hosts`,
    ]);
  });

  it('tylko własny plik środowiska (bez sekretów skanera); klucz repo danych przez LoadCredential', () => {
    expect(svc().EnvironmentFile).toEqual(['/etc/hyperquant/blog-publisher.env']);
    expect(read('hyperquant-blog-publisher.service')).not.toContain('scanner.env');
    expect(sh).toMatch(/dropin=\/etc\/systemd\/system\/hyperquant-blog-publisher\.service\.d[\s\S]*LoadCredential=deploy_key:%s/);
  });

  it('blog-publisher.env z install.sh ma dokładnie zmienne, które czyta wydawca (poza jednostką i kluczem)', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'blog', 'publisher.mjs'), 'utf8');
    const used = new Set([...src.matchAll(/(?:env\.|need\(')(HQ_\w+)/g)].map((m) => m[1]));
    const inUnit = new Set((svc().Environment ?? []).map((e) => e.split('=')[0]));
    const needed = [...used].filter((v) => !inUnit.has(v) && v !== 'HQ_GIT_SSH_KEY').sort();
    expect(needed).toEqual(['HQ_GIT_REMOTE']);
    expect(sh).toMatch(/printf 'HQ_GIT_REMOTE=%s\\n' "\$\(env_value HQ_GIT_REMOTE \/etc\/hyperquant\/scanner\.env\)" >\/etc\/hyperquant\/blog-publisher\.env\.tmp/);
  });

  it('izolacja jak strażnik; zapis tylko do katalogu stanu i katalogów kolejki', () => {
    const expected: Record<string, string> = {
      UMask: '0027',
      NoNewPrivileges: 'true',
      ProtectSystem: 'strict',
      ProtectHome: 'true',
      PrivateTmp: 'true',
      PrivateDevices: 'true',
      ProtectClock: 'true',
      ProtectHostname: 'true',
      ProtectKernelTunables: 'true',
      ProtectKernelModules: 'true',
      ProtectKernelLogs: 'true',
      ProtectControlGroups: 'true',
      ProtectProc: 'invisible',
      RestrictNamespaces: 'true',
      RestrictSUIDSGID: 'true',
      RestrictRealtime: 'true',
      LockPersonality: 'true',
      CapabilityBoundingSet: '',
      SystemCallArchitectures: 'native',
      SystemCallFilter: '@system-service',
      StateDirectory: 'hyperquant-blog-publisher',
      StateDirectoryMode: '0700',
    };
    for (const [k, v] of Object.entries(expected)) expect(one(svc(), k), k).toBe(v);
    // jedna ścieżka (jedno montowanie): rename kolejka → praca między dwoma montowaniami ReadWritePaths dałby EXDEV;
    // w samym katalogu wspólnym (root, 0755) wydawca i tak nie może pisać, tylko w podkatalogach z prawami z install.sh
    expect(svc().ReadWritePaths).toEqual(['/var/lib/hyperquant-blog']);
    for (const d of DIRS) expect(sh).toContain(d);
  });

  it('klucze hosta GitHuba w repo (api.github.com/meta), kopiowane przez install.sh; bez akceptowania nowych kluczy', () => {
    const lines = read('github_known_hosts')
      .split('\n')
      .filter((l) => l && !l.startsWith('#'));
    expect(lines.map((l) => l.split(' ').slice(0, 2).join(' '))).toEqual(['github.com ssh-ed25519', 'github.com ecdsa-sha2-nistp256', 'github.com ssh-rsa']);
    for (const l of lines) expect(l).toMatch(/^github\.com (ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa) [A-Za-z0-9+/]+=*$/);
    expect(sh).toContain('install -o root -g root -m 0644 "$PREFIX/app/backend/deploy/github_known_hosts" "$PREFIX/blog-publisher.new/known_hosts"');
    expect(readFileSync(join(ROOT, 'scripts', 'blog', 'publisher.mjs'), 'utf8')).not.toContain('accept-new');
  });

  it('timer co minutę', () => {
    const t = parseUnit(read('hyperquant-blog-publisher.timer'));
    expect(t.Timer.OnCalendar).toEqual(['*-*-* *:*:00']);
    expect(t.Install.WantedBy).toEqual(['timers.target']);
  });

  it('install.sh: grupa kolejki, użytkownik wydawcy, autor dopisany do grupy tylko z HQ_BLOG_AUTHOR, katalogi z prawami kontraktu', () => {
    expect(sh).toMatch(/getent group hqblog >\/dev\/null \|\| groupadd --system hqblog/);
    expect(sh).toMatch(/id hyperquant-blog >\/dev\/null 2>&1 \|\| useradd --system --user-group --home-dir \/var\/lib\/hyperquant-blog-publisher --shell \/usr\/sbin\/nologin hyperquant-blog/);
    expect(sh).toContain('usermod -a -G hqblog hyperquant-blog');
    expect(sh).toMatch(/if \[ -n "\$\{HQ_BLOG_AUTHOR:-\}" \]; then[\s\S]{0,200}usermod -a -G hqblog "\$HQ_BLOG_AUTHOR"/);
    expect(sh).toContain('install -d -o root -g hqblog -m 0755 /var/lib/hyperquant-blog');
    expect(sh).toContain('install -d -o hyperquant-blog -g hqblog -m 3770 /var/lib/hyperquant-blog/kolejka');
    expect(sh).toContain('install -d -o hyperquant-blog -g hqblog -m 2750 /var/lib/hyperquant-blog/zrobione /var/lib/hyperquant-blog/odrzucone');
    expect(sh).toContain('install -d -o hyperquant-blog -g hqblog -m 0755 /var/lib/hyperquant-blog/stan');
    // katalog roboczy (paczki przejęte z kolejki): tylko wydawca, ten sam system plików co kolejka (rename)
    expect(sh).toContain('install -d -o hyperquant-blog -g hyperquant-blog -m 0700 /var/lib/hyperquant-blog/praca');
    expect(sh).toContain('systemctl enable --now --quiet hyperquant-blog-publisher.timer');
  });

  it('install.sh: pakiet yaml z adresu i sumy z package-lock.json (podpisany tag), bez npm na serwerze', () => {
    expect(sh).toMatch(/packages\["node_modules\/yaml"\]/);
    expect(sh).toMatch(/openssl dgst -sha512 -binary "\$TMP_DIR\/yaml\.tgz" \| base64 -w0/);
    expect(sh).toMatch(/tar --no-same-owner -xzf "\$TMP_DIR\/yaml\.tgz" -C "\$PREFIX\/blog-publisher\.new\/node_modules\/yaml" --strip-components=1/);
    expect(sh).not.toMatch(/\bnpm (ci|install)\b/);
  });

  const copied = (): string[] => {
    const m = /PUBLISHER_FILES="([^"]+)"/.exec(sh);
    return m ? m[1].trim().split(/\s+/) : [];
  };
  const localImports = (rel: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(rel)) return seen;
    seen.add(rel);
    const src = readFileSync(join(ROOT, rel), 'utf8');
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*'(\.{1,2}\/[^']+)'/g)) localImports(join(rel, '..', m[1]).replace(/\\/g, '/'), seen);
    return seen;
  };

  it('kopia wydawcy obejmuje wszystkie lokalne importy scripts/blog/publisher.mjs i package.json', () => {
    const files = copied();
    for (const f of localImports('scripts/blog/publisher.mjs')) expect(files, f).toContain(f);
    expect(files).toContain('package.json');
  });

  it('kopia wydawcy (z pakietem yaml) wczytuje się bez reszty repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-publisher-copy-'));
    try {
      for (const f of copied()) {
        mkdirSync(join(dir, f, '..'), { recursive: true });
        copyFileSync(join(ROOT, f), join(dir, f));
      }
      cpSync(join(ROOT, 'node_modules', 'yaml'), join(dir, 'node_modules', 'yaml'), { recursive: true });
      const url = pathToFileURL(join(dir, 'scripts', 'blog', 'publisher.mjs')).href;
      const r = spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(url)}); if (typeof m.runPublisher !== 'function') process.exit(3)`], { encoding: 'utf8' });
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
