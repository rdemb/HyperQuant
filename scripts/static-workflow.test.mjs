// Wdrożenie strony (.github/workflows/static.yml): wpisy z gałęzi blog repo danych jako niezaufana treść, uprawnienia
// tylko na poziomie jobów, akcje przypięte do hashy, bramka wdrożenia po sha gałęzi blog.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = path.join(import.meta.dirname, '..');
const wfText = readFileSync(path.join(ROOT, '.github', 'workflows', 'static.yml'), 'utf8');
const wf = parse(wfText);
const { build, deploy } = wf.jobs;
const step = (name) => build.steps.find((s) => s.name === name);
const index = (name) => build.steps.findIndex((s) => s.name === name);

describe('static.yml: wyzwalacze i uprawnienia', () => {
  it('push na main, harmonogram co 5 min, ręczne uruchomienie', () => {
    expect(wf.on.push).toEqual({ branches: ['main', 'master'] });
    expect(wf.on.schedule).toEqual([{ cron: '*/5 * * * *' }]);
    expect(wf.on).toHaveProperty('workflow_dispatch');
  });

  it('uprawnienia tylko w jobach: build czyta repo, Pages i id-token tylko w deploy', () => {
    expect(wf.permissions).toEqual({});
    expect(build.permissions).toEqual({ contents: 'read' });
    expect(deploy.permissions).toEqual({ pages: 'write', 'id-token': 'write' });
  });

  it('akcje przypięte do pełnego hasha commita, te same wersje co wcześniej', () => {
    const uses = [...wfText.matchAll(/uses: (\S+)(.*)$/gm)].map((m) => `${m[1]}${m[2]}`);
    expect(uses).toEqual([
      'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7',
      'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7',
      'actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5',
      'actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346 # v5',
    ]);
  });

  it('bez sekretów i tokenu w buildzie; checkout bez zapisanych poświadczeń', () => {
    expect(wfText).not.toMatch(/secrets\.|github\.token|GITHUB_TOKEN|extraheader|x-access-token/i);
    for (const s of build.steps.filter((x) => String(x.uses).startsWith('actions/checkout@'))) expect(s.with['persist-credentials']).toBe(false);
  });
});

describe('static.yml: gałąź blog repo danych', () => {
  const SWITCH = "vars.BLOG_INTAKE == 'on'";

  it('wyłącznik: kroki gałęzi blog tylko przy zmiennej repozytorium BLOG_INTAKE = on (domyślnie brak, workflow jak wcześniej)', () => {
    expect(step('Blog Branch Head').if).toBe(SWITCH);
    expect(step('Blog Intake').if).toBe(`${SWITCH} && steps.gate.outputs.deploy == 'true'`);
    // poza tymi krokami gałąź blog i jej wyniki pojawiają się tylko w bramce (z wyłącznikiem) i w IndexNow (puste wyniki = jak dotąd)
    const others = build.steps.filter((s) => !['Blog Branch Head', 'Blog Intake', 'Decide Deploy', 'List New Blog Posts For IndexNow'].includes(s.name));
    for (const s of others) expect(JSON.stringify(s), s.name).not.toMatch(/BLOG_|steps\.blog|intake\.mjs/);
    expect(step('Decide Deploy').env.INTAKE).toBe('${{ vars.BLOG_INTAKE }}');
  });

  it('głowa gałęzi bez uwierzytelnienia (git ls-remote) i opublikowany source.json przed setup-node i przed bramką', () => {
    const s = step('Blog Branch Head');
    expect(s['continue-on-error']).toBe(true);
    expect(s.run).toMatch(/GIT_TERMINAL_PROMPT=0 timeout 30 git ls-remote --heads "\$BLOG_REPO" refs\/heads\/blog/);
    expect(s.run).toMatch(/node scripts\/blog\/intake\.mjs published --save "\$RUNNER_TEMP\/published\.json" >> "\$GITHUB_OUTPUT"/);
    expect(build.env.BLOG_REPO).toBe('https://github.com/rdemb/hyperquant-data.git');
    expect(index('Blog Branch Head')).toBe(index('Checkout Repository') + 1);
    expect(index('Blog Branch Head')).toBeLessThan(index('Setup Node.js 24'));
    expect(index('Blog Branch Head')).toBeLessThan(index('Decide Deploy'));
  });

  it('klon pełnej historii poza repo (katalog tymczasowy runnera), bez poświadczeń, limit 120 s; filtr z rejestrem przed npm ci', () => {
    const s = step('Blog Intake');
    expect(s.run).toMatch(/GIT_TERMINAL_PROMPT=0 timeout 120 git clone -q --no-tags --single-branch --branch blog "\$BLOG_REPO" "\$RUNNER_TEMP\/blog"/);
    expect(s.run).not.toMatch(/--depth/);
    expect(s.run).toMatch(/node scripts\/blog\/intake\.mjs filter --src "\$src" --dest content\/blog --published "\$RUNNER_TEMP\/published\.json" --out "\$RUNNER_TEMP\/blog-intake\.json"/);
    expect(s.run).toMatch(/BLOG_INTAKE=\$RUNNER_TEMP\/blog-intake\.json" >> "\$GITHUB_ENV"/);
    expect(index('Blog Intake')).toBeLessThan(index('Install Dependencies'));
    expect(index('Blog Intake')).toBeGreaterThan(index('Decide Deploy'));
  });

  it('job build ma limit 20 min (grupa pages nie przerywa trwających przebiegów)', () => {
    expect(build['timeout-minutes']).toBe(20);
    expect(wf.concurrency['cancel-in-progress']).toBe(false);
  });

  it('IndexNow: diff w klonie gałęzi blog od opublikowanego sha, push na main jak dotąd', () => {
    const s = step('List New Blog Posts For IndexNow');
    expect(s.if).toMatch(/steps\.blog\.outputs\.sha != steps\.blog\.outputs\.published/);
    expect(s.run).toMatch(/git diff --name-only --diff-filter=AM "\$BEFORE" HEAD/);
    expect(s.run).toMatch(/node scripts\/blog\/intake\.mjs changed --src "\$RUNNER_TEMP\/blog" --prev "\$PUBLISHED"/);
    expect(s.run).toMatch(/\| node scripts\/blog\/indexnow\.mjs >> "\$GITHUB_OUTPUT"/);
  });
});

const hasBash = spawnSync('bash', ['-c', 'exit 0']).status === 0;

describe.skipIf(!hasBash)('static.yml: bramka wdrożenia (krok Decide Deploy uruchomiony w bash)', () => {
  const SHA = 'a'.repeat(40);
  const MAIN = 'c'.repeat(40);
  // Wyniki kroków przy wyłączniku: krok blog pominięty, więc puste
  const OFF = { INTAKE: '', BLOG_SHA: '', PUBLISHED: '', PUBLISHED_MAIN: '', KNOWN: '' };
  const ON = { INTAKE: 'on', BLOG_SHA: SHA, PUBLISHED: SHA, PUBLISHED_MAIN: MAIN, KNOWN: 'true' };
  const gate = (env) => {
    const out = path.join(mkdtempSync(path.join(tmpdir(), 'hq-gate-')), 'out');
    const r = spawnSync('bash', ['-e', '-c', `: > "$GITHUB_OUTPUT"\n${step('Decide Deploy').run}`], { env: { ...process.env, EVENT: 'schedule', CHANGED: 'false', MAIN_SHA: MAIN, ...env, GITHUB_OUTPUT: out }, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    return readFileSync(out, 'utf8').trim();
  };

  it('zmienne kroku: wyłącznik, wyniki kroków blog i feeds, głowa main', () => {
    expect(step('Decide Deploy').env).toEqual({
      INTAKE: '${{ vars.BLOG_INTAKE }}',
      EVENT: '${{ github.event_name }}',
      CHANGED: '${{ steps.feeds.outputs.changed }}',
      MAIN_SHA: '${{ github.sha }}',
      BLOG_SHA: '${{ steps.blog.outputs.sha }}',
      PUBLISHED: '${{ steps.blog.outputs.published }}',
      PUBLISHED_MAIN: '${{ steps.blog.outputs.main }}',
      KNOWN: '${{ steps.blog.outputs.known }}',
    });
  });

  it('wyłącznik (brak zmiennej): dokładnie jak dotąd', () => {
    expect(gate({ ...OFF })).toBe('');
    expect(gate({ ...OFF, CHANGED: 'true' })).toBe('deploy=true');
    expect(gate({ ...OFF, EVENT: 'push' })).toBe('deploy=true');
    expect(gate({ ...OFF, EVENT: 'workflow_dispatch' })).toBe('deploy=true');
    expect(gate({ ...OFF, INTAKE: 'off', BLOG_SHA: SHA, PUBLISHED: 'b'.repeat(40), KNOWN: 'false' })).toBe('');
  });

  it('harmonogram: ten sam sha gałęzi i main co w opublikowanym source.json, dane bez zmian: bez wdrożenia', () => {
    expect(gate({ ...ON })).toBe('');
  });

  it('harmonogram: inny sha gałęzi blog albo pierwszy sha: wdrożenie', () => {
    expect(gate({ ...ON, PUBLISHED: 'b'.repeat(40) })).toBe('deploy=true');
    expect(gate({ ...ON, PUBLISHED: '' })).toBe('deploy=true');
  });

  it('harmonogram: inna głowa main niż w source.json (pominięte wdrożenie po pushu): wdrożenie', () => {
    expect(gate({ ...ON, PUBLISHED_MAIN: 'd'.repeat(40) })).toBe('deploy=true');
    expect(gate({ ...ON, BLOG_SHA: '', PUBLISHED_MAIN: '' })).toBe('deploy=true');
  });

  it('nieczytelny source.json (KNOWN różne od true): bez wdrożenia przy każdym zdarzeniu, także push i nowe dane', () => {
    for (const EVENT of ['schedule', 'push', 'workflow_dispatch']) {
      expect(gate({ ...ON, EVENT, KNOWN: 'false', CHANGED: 'true' }), EVENT).toBe('');
      expect(gate({ ...ON, EVENT, KNOWN: '' }), EVENT).toBe('');
    }
  });

  it('gałęzi nie ma albo GitHub nie odpowiada: bez wdrożenia z tego powodu; push i nowe dane jak dotąd', () => {
    expect(gate({ ...ON, BLOG_SHA: '' })).toBe('');
    expect(gate({ ...ON, CHANGED: 'true' })).toBe('deploy=true');
    expect(gate({ ...ON, EVENT: 'push' })).toBe('deploy=true');
  });
});
