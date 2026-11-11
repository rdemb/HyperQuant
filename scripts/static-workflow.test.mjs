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
  it('głowa gałęzi bez uwierzytelnienia (git ls-remote) i sha opublikowany na stronie, przed bramką', () => {
    const s = step('Blog Branch Head');
    expect(s['continue-on-error']).toBe(true);
    expect(s.run).toMatch(/GIT_TERMINAL_PROMPT=0 timeout 30 git ls-remote --heads "\$BLOG_REPO" refs\/heads\/blog/);
    expect(s.run).toMatch(/node scripts\/blog\/intake\.mjs published >> "\$GITHUB_OUTPUT"/);
    expect(build.env.BLOG_REPO).toBe('https://github.com/rdemb/hyperquant-data.git');
    expect(index('Blog Branch Head')).toBeLessThan(index('Decide Deploy'));
  });

  it('klon pełnej historii poza repo (katalog tymczasowy runnera), bez poświadczeń; filtr przed npm ci i przed buildem', () => {
    const s = step('Blog Intake');
    expect(s.if).toBe("steps.gate.outputs.deploy == 'true'");
    expect(s.run).toMatch(/GIT_TERMINAL_PROMPT=0 git clone -q --no-tags --single-branch --branch blog "\$BLOG_REPO" "\$RUNNER_TEMP\/blog"/);
    expect(s.run).not.toMatch(/--depth/);
    expect(s.run).toMatch(/node scripts\/blog\/intake\.mjs filter --src "\$src" --dest content\/blog --prev "\$PUBLISHED" --out "\$RUNNER_TEMP\/blog-intake\.json"/);
    expect(s.run).toMatch(/BLOG_INTAKE=\$RUNNER_TEMP\/blog-intake\.json" >> "\$GITHUB_ENV"/);
    expect(index('Blog Intake')).toBeLessThan(index('Install Dependencies'));
    expect(index('Blog Intake')).toBeGreaterThan(index('Decide Deploy'));
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
  const gate = (env) => {
    const out = path.join(mkdtempSync(path.join(tmpdir(), 'hq-gate-')), 'out');
    const r = spawnSync('bash', ['-e', '-c', `: > "$GITHUB_OUTPUT"\n${step('Decide Deploy').run}`], { env: { ...process.env, EVENT: 'schedule', CHANGED: 'false', BLOG_SHA: '', PUBLISHED: '', KNOWN: 'true', ...env, GITHUB_OUTPUT: out }, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    return readFileSync(out, 'utf8').trim();
  };

  it('zmienne kroku z wyjść kroków blog i feeds', () => {
    expect(step('Decide Deploy').env).toEqual({
      EVENT: '${{ github.event_name }}',
      CHANGED: '${{ steps.feeds.outputs.changed }}',
      BLOG_SHA: '${{ steps.blog.outputs.sha }}',
      PUBLISHED: '${{ steps.blog.outputs.published }}',
      KNOWN: '${{ steps.blog.outputs.known }}',
    });
  });

  it('harmonogram: ten sam sha co opublikowany i dane bez zmian: bez wdrożenia', () => {
    expect(gate({ BLOG_SHA: SHA, PUBLISHED: SHA })).toBe('');
  });

  it('harmonogram: inny sha gałęzi blog: wdrożenie; pierwszy sha (na stronie jeszcze brak): wdrożenie', () => {
    expect(gate({ BLOG_SHA: SHA, PUBLISHED: 'b'.repeat(40) })).toBe('deploy=true');
    expect(gate({ BLOG_SHA: SHA, PUBLISHED: '' })).toBe('deploy=true');
  });

  it('gałęzi nie ma albo GitHub nie odpowiada, albo stan strony nieznany: bez wdrożenia z tego powodu', () => {
    expect(gate({ BLOG_SHA: '', PUBLISHED: SHA })).toBe('');
    expect(gate({ BLOG_SHA: SHA, PUBLISHED: '', KNOWN: 'false' })).toBe('');
  });

  it('jak dotąd: nowe dane albo push i ręczne uruchomienie zawsze wdrażają', () => {
    expect(gate({ CHANGED: 'true' })).toBe('deploy=true');
    expect(gate({ EVENT: 'push' })).toBe('deploy=true');
    expect(gate({ EVENT: 'workflow_dispatch', BLOG_SHA: SHA, PUBLISHED: SHA })).toBe('deploy=true');
  });
});
