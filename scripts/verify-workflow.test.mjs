// Niezależna weryfikacja dziennika w repo HyperQuant: workflow z harmonogramem, gałąź wyników, jeden adres wyników.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { VERIFY_BADGE_URL, VERIFY_BASE, VERIFY_BRANCH, VERIFY_LATEST_URL } from '../src/utils/verifyFreshness.ts';

const ROOT = path.join(import.meta.dirname, '..');
const WF_DIR = path.join(ROOT, '.github', 'workflows');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const wfText = read('.github', 'workflows', 'ledger-verify.yml');
const wf = parse(wfText);
const steps = wf.jobs.verify.steps;
const step = (name) => steps.find((s) => s.name === name);

describe('jeden adres wyników weryfikacji', () => {
  it('gałąź weryfikacja-dziennika w repo HyperQuant; latest.json i znaczek z tej samej bazy', () => {
    expect(VERIFY_BRANCH).toBe('weryfikacja-dziennika');
    expect(VERIFY_BASE).toBe('https://raw.githubusercontent.com/rdemb/HyperQuant/weryfikacja-dziennika/');
    expect(VERIFY_LATEST_URL).toBe(`${VERIFY_BASE}verify/latest.json`);
    expect(VERIFY_BADGE_URL).toBe('https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/rdemb/HyperQuant/weryfikacja-dziennika/badge/ledger.json');
  });

  it('karta na stronie czyta wynik ze stałej, nie z gałęzi health repo danych', () => {
    const card = read('src', 'views', 'after', 'LedgerVerifyCard.tsx');
    expect(card).toMatch(/import \{[^}]*\bVERIFY_LATEST_URL\b[^}]*\} from '\.\.\/\.\.\/utils\/verifyFreshness'/);
    expect(card).toMatch(/fetch\(VERIFY_LATEST_URL/);
    expect(card).not.toMatch(/\/health|verify\/latest\.json/);
  });

  it('README: znaczek z gałęzi wyników, bez starego znaczka repo danych', () => {
    const readme = read('README.md');
    expect(readme).toContain(`(${VERIFY_BADGE_URL})`);
    expect(readme).not.toMatch(/hyperquant-data%2Fhealth|hyperquant-data\/health/);
  });
});

describe('workflow .github/workflows/ledger-verify.yml', () => {
  it('harmonogram co 6 h i ręczne uruchomienie; bez anulowania trwającego przebiegu', () => {
    expect(wf.on.schedule).toEqual([{ cron: '23 */6 * * *' }]);
    expect(wf.on).toHaveProperty('workflow_dispatch');
    expect(Object.keys(wf.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    expect(wf.concurrency).toEqual({ group: 'ledger-verify', 'cancel-in-progress': false });
  });

  it('uprawnienia tylko contents: write, bez sekretów (wbudowany token)', () => {
    expect(wf.permissions).toEqual({ contents: 'write' });
    for (const job of Object.values(wf.jobs)) expect(job.permissions).toBeUndefined();
    expect(wfText).not.toMatch(/secrets\./);
  });

  it('gałąź wyników to stała z kodu; weryfikator z main, dziennik z repo danych bez zapisanych poświadczeń', () => {
    expect(wf.jobs.verify.env.BRANCH).toBe(VERIFY_BRANCH);
    expect(wfText.match(/weryfikacja-dziennika/g)).toHaveLength(1); // jedyne miejsce: env.BRANCH
    const checkouts = steps.filter((s) => String(s.uses).startsWith('actions/checkout@'));
    expect(checkouts).toHaveLength(2);
    expect(checkouts.map((s) => s.with)).toEqual([
      { ref: 'main', path: 'hq', 'persist-credentials': false },
      { repository: 'rdemb/hyperquant-data', ref: 'ledger', path: 'ledger', 'fetch-depth': 0, 'persist-credentials': false },
    ]);
  });

  it('limit 20 min na weryfikację, 30 min na job; znaczek także po limicie; przebieg z problemem czerwony', () => {
    expect(wf.jobs.verify['timeout-minutes']).toBe(30);
    expect(step('Weryfikacja')['timeout-minutes']).toBe(20);
    expect(step('Znaczek, podsumowanie i kotwica').if).toMatch(/always\(\)/);
    expect(step('Wynik')).toMatchObject({ if: '${{ always() }}', run: 'test "$CODE" = "0"' });
  });

  it('akcje przypięte do pełnego hasha commita (workflow ma zapis do repo)', () => {
    const uses = steps.filter((s) => s.uses).map((s) => s.uses);
    expect(uses.length).toBeGreaterThanOrEqual(3);
    for (const u of uses) expect(u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it('zawsze cała historia git; kotwica (ostatnio zweryfikowany commit) sprawdzana w każdym przebiegu', () => {
    expect(step('Kotwica').run).toMatch(/verify-status\.mjs anchor results/);
    expect(step('Weryfikacja').run).toMatch(/verify-ledger\.mjs --dir ledger --market \$\{ANCHOR:\+--anchor "\$ANCHOR"\}/);
    expect(wfText).not.toMatch(/since/i);
  });

  it('pierwszy przebieg tworzy gałąź wyników jako sierocą; push z ponowieniem po rebase', () => {
    const prep = step('Gałąź wyników').run;
    expect(prep).toMatch(/ls-remote --exit-code --heads origin "\$BRANCH"/);
    expect(prep).toMatch(/symbolic-ref HEAD "refs\/heads\/\$BRANCH"/);
    const pub = step('Znaczek, podsumowanie i kotwica').run;
    expect(pub).toMatch(/verify-status\.mjs publish results/);
    expect(pub).toMatch(/git add badge verify/);
    expect(pub).toMatch(/for i in 1 2 3; do git push -q origin "HEAD:refs\/heads\/\$BRANCH" && exit 0; git pull -q --rebase origin "\$BRANCH"; done/);
  });

  it('token z prawem zapisu dopiero w kroku publikacji: wcześniej żaden krok nie dostaje tokenu ani nagłówka', () => {
    const TOKEN = /github\.token|GITHUB_TOKEN|GH_TOKEN|extraheader|x-access-token|AUTHORIZATION/i;
    const pubIdx = steps.findIndex((s) => s.name === 'Znaczek, podsumowanie i kotwica');
    expect(pubIdx).toBeGreaterThan(0);
    expect(JSON.stringify(wf.jobs.verify.env ?? {})).not.toMatch(TOKEN);
    for (const s of steps.slice(0, pubIdx)) {
      expect(JSON.stringify(s), s.name).not.toMatch(TOKEN);
      if (s.with && 'persist-credentials' in s.with) expect(s.with['persist-credentials']).toBe(false);
    }
    const pub = steps[pubIdx];
    expect(pub.env.GH_TOKEN).toBe('${{ github.token }}');
    expect(pub.run).toMatch(/::add-mask::/);
    // nagłówek ustawiany po przetworzeniu danych (publish), przed pierwszym push
    expect(pub.run.indexOf('extraheader')).toBeGreaterThan(pub.run.indexOf('verify-status.mjs publish'));
    expect(pub.run.indexOf('extraheader')).toBeLessThan(pub.run.indexOf('git push'));
  });

  it('jedna prawda: wzorzec dla repo danych usunięty', () => {
    expect(existsSync(path.join(ROOT, 'backend', 'deploy', 'ledger-verify.yml'))).toBe(false);
  });
});

describe('gałąź wyników nie uruchamia innych workflow ani wdrożenia', () => {
  const others = readdirSync(WF_DIR).filter((f) => f.endsWith('.yml') && f !== 'ledger-verify.yml');

  it.each(others)('%s: push tylko na wskazane gałęzie (bez wzorców) albo z wykluczeniem gałęzi wyników', (f) => {
    const on = parse(readFileSync(path.join(WF_DIR, f), 'utf8')).on;
    const triggers = typeof on === 'string' ? { [on]: null } : Array.isArray(on) ? Object.fromEntries(on.map((t) => [t, null])) : on;
    for (const event of ['push', 'create']) {
      if (!(event in triggers)) continue;
      const t = triggers[event] ?? {};
      if (t['branches-ignore']) expect(t['branches-ignore']).toContain(VERIFY_BRANCH);
      else {
        expect(Array.isArray(t.branches)).toBe(true); // bez listy gałęzi push z każdej gałęzi uruchamia workflow
        for (const b of t.branches) {
          expect(b).not.toMatch(/[*?[!]/);
          expect(b).not.toBe(VERIFY_BRANCH);
        }
      }
    }
  });
});

describe('weryfikacja z podsumowaniem dziennika (miary, kalibracja wariantu C, bloki hrel)', () => {
  it('podsumowanie pobierane z main repo danych przed klonem dziennika, bez tokenu, i podawane przez --summary, gdy jest', () => {
    const i = steps.findIndex((s) => s.name === 'Podsumowanie dziennika (przed dziennikiem)');
    const iLedger = steps.findIndex((s) => s.with?.ref === 'ledger');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(iLedger);
    const run = String(steps[i].run);
    expect(run).toContain('https://raw.githubusercontent.com/rdemb/hyperquant-data/main/ledger/BTC/summary.json');
    expect(run).not.toMatch(/token|GH_TOKEN|secrets/i);
    expect(steps[i].env).toBeUndefined();
    expect(String(step('Weryfikacja').run)).toMatch(/--summary summary.json/);
  });
});
