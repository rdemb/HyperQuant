import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LedgerStore, commitLedger, prepareLedgerRepo } from '../ledgerStore.ts';
import { verifyLines } from '../ledger.ts';

const T0 = Date.UTC(2026, 9, 22, 23, 50, 0);
const MIN = 60_000;
const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

describe('LedgerStore — pliki dzienne z łańcuchem hashy', () => {
  it('dopisuje do pliku dnia UTC; łańcuch ciągły między dniami; odczyt odtwarza prognozy, rozstrzygnięcia i głowę', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-ledger-'));
    const s = new LedgerStore({ dir, coin: 'BTC' });
    s.load(T0);
    s.append([{ k: 'f', id: 'a', t: T0, kind: 'ret', h: 60 }], T0);
    s.append([{ k: 'f', id: 'b', t: T0 + 15 * MIN, kind: 'ret', h: 60 }], T0 + 15 * MIN); // następny dzień UTC
    s.append([{ k: 'r', id: 'a', t: T0 + 61 * MIN, y: 0.001 }], T0 + 61 * MIN);
    const d1 = readFileSync(join(dir, 'BTC', '2026-10-22.jsonl'), 'utf8').trim().split('\n');
    const d2 = readFileSync(join(dir, 'BTC', '2026-10-23.jsonl'), 'utf8').trim().split('\n');
    expect(d1).toHaveLength(1);
    expect(d2).toHaveLength(2);
    const v1 = verifyLines(d1, '0'.repeat(64));
    expect(verifyLines(d2, v1.head).ok).toBe(true);

    const again = new LedgerStore({ dir, coin: 'BTC' });
    const st = again.load(T0 + 70 * MIN);
    expect(st.ok).toBe(true);
    expect([...st.forecasts.keys()].sort()).toEqual(['a', 'b']);
    expect([...st.resolutions.keys()]).toEqual(['a']);
    expect(again.head).toBe(s.head);
    expect(again.lines).toBe(3);
  });

  it('naruszony łańcuch → load zwraca ok = false i magazyn odmawia dopisywania (bez dokładania do zepsutej historii)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-ledger-'));
    const s = new LedgerStore({ dir, coin: 'BTC' });
    s.load(T0);
    s.append([{ k: 'f', id: 'a', t: T0, q: [0.1] }], T0);
    const f = join(dir, 'BTC', '2026-10-22.jsonl');
    writeFileSync(f, readFileSync(f, 'utf8').replace('0.1', '0.2'));
    const broken = new LedgerStore({ dir, coin: 'BTC' });
    expect(broken.load(T0 + MIN).ok).toBe(false);
    expect(() => broken.append([{ k: 'f', id: 'x', t: T0 }], T0 + MIN)).toThrow();
  });
});

describe('gałąź ledger — publikacja przyrostowa (bez --force)', () => {
  it('pierwsze uruchomienie zakłada gałąź; kolejne commity dokładają historię; ponowny klon ma wszystkie pliki', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'hq-remote-'));
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
    const base = mkdtempSync(join(tmpdir(), 'hq-state-'));
    const dir = join(base, 'ledger');
    expect(await prepareLedgerRepo({ remote, dir }, T0)).toBe(true);
    const s = new LedgerStore({ dir, coin: 'BTC' });
    s.load(T0);
    s.append([{ k: 'f', id: 'a', t: T0 }], T0);
    expect(await commitLedger({ remote, dir }, 'dziennik: a', T0)).toMatchObject({ ok: true, pushed: true });
    s.append([{ k: 'r', id: 'a', t: T0 + MIN }], T0 + MIN);
    expect(await commitLedger({ remote, dir }, 'dziennik: r', T0 + MIN)).toMatchObject({ ok: true });
    expect(await commitLedger({ remote, dir }, 'bez zmian', T0 + 2 * MIN)).toMatchObject({ ok: true }); // nic do zatwierdzenia
    expect(git(remote, 'rev-list', '--count', 'ledger')).toBe('2');
    expect(git(remote, 'log', '-1', '--format=%an <%ae>', 'ledger')).toBe('HyperQuant scanner <hyperquant-scanner@users.noreply.github.com>');

    const dir2 = join(mkdtempSync(join(tmpdir(), 'hq-state2-')), 'ledger');
    expect(await prepareLedgerRepo({ remote, dir: dir2 }, T0)).toBe(true);
    const s2 = new LedgerStore({ dir: dir2, coin: 'BTC' });
    expect(s2.load(T0 + 3 * MIN).ok).toBe(true);
    expect(s2.lines).toBe(2);
  });
});

describe('gałąź ledger — tylko dopisywanie', () => {
  async function setup() {
    const remote = mkdtempSync(join(tmpdir(), 'hq-remote-'));
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
    const dir = join(mkdtempSync(join(tmpdir(), 'hq-state-')), 'ledger');
    await prepareLedgerRepo({ remote, dir }, T0);
    const s = new LedgerStore({ dir, coin: 'BTC' });
    s.load(T0);
    s.append([{ k: 'f', id: 'a', t: T0, q: [0.1] }], T0);
    await commitLedger({ remote, dir }, 'a', T0);
    return { remote, dir, s };
  }

  it('zmiana zapisanej linii (nie dopisanie) → commit odrzucony, nic nie trafia do repo', async () => {
    const { remote, dir } = await setup();
    const f = join(dir, 'BTC', '2026-10-22.jsonl');
    writeFileSync(f, readFileSync(f, 'utf8').replace('0.1', '0.2'));
    const r = await commitLedger({ remote, dir }, 'zmiana wstecz', T0 + MIN);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/nie jest dopisaniem/);
    expect(git(remote, 'rev-list', '--count', 'ledger')).toBe('1');
  });

  it('usunięcie pliku dziennika → odrzucone', async () => {
    const { remote, dir } = await setup();
    execFileSync('git', ['-C', dir, 'rm', '-q', 'BTC/2026-10-22.jsonl']);
    expect((await commitLedger({ remote, dir }, 'usunięcie', T0 + MIN)).ok).toBe(false);
  });

  it('klon w tyle za origin (inny zapis w repo) → przygotowanie odmawia (bez dopisywania do starej głowy)', async () => {
    const { remote, dir } = await setup();
    const other = join(mkdtempSync(join(tmpdir(), 'hq-other-')), 'ledger');
    await prepareLedgerRepo({ remote, dir: other }, T0);
    const s2 = new LedgerStore({ dir: other, coin: 'BTC' });
    s2.load(T0);
    s2.append([{ k: 'r', id: 'a', t: T0 + MIN }], T0 + MIN);
    await commitLedger({ remote, dir: other }, 'inny', T0 + MIN);
    expect(await prepareLedgerRepo({ remote, dir }, T0 + 2 * MIN)).toBe(false);
  });
});
