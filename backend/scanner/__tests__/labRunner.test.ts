import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LAB_CATALOG, isLabReport, type LabReport } from '../../../src/utils/folkloreLab.ts';
import { CandleArchive } from '../candleArchive.ts';
import type { InfoClient } from '../liqDetect.ts';
import { canonicalJson } from '../ledger.ts';
import { LAB_HASH, LabRunner } from '../labRunner.ts';

// Operacje git (klon, commit, push do repo lokalnego) przy pełnym, równoległym obciążeniu potrafią przekroczyć 5 s
vi.setConfig({ testTimeout: 30_000 });

const MIN = 60_000;
const H = 60 * MIN;
const NOW = Date.UTC(2026, 9, 22, 14, 7, 30);

/** API: świece 1m/1h/1d (błądzenie wokół 80 000) i finansowanie co godzinę */
function rest(clock: () => number): InfoClient {
  return {
    async info(body: unknown) {
      const b = body as { type: string; req?: { interval: string; startTime: number }; startTime?: number };
      const now = clock();
      if (b.type === 'candleSnapshot') {
        const iv = b.req!.interval === '1m' ? MIN : b.req!.interval === '1h' ? H : 24 * H;
        const first = Math.max(Math.ceil(b.req!.startTime / iv) * iv, Math.floor(now / iv) * iv - 4999 * iv);
        const out = [];
        for (let t = first; t <= now; t += iv) {
          const c = 80000 + 900 * Math.sin(t / (7 * H)) + 300 * Math.sin(t / (31 * MIN));
          out.push({ t, o: String(c - 20), c: String(c), h: String(c + 150), l: String(c - 150), v: '2', n: 5 });
        }
        return out;
      }
      if (b.type === 'fundingHistory') {
        const out = [];
        for (let t = Math.max(Math.ceil(b.startTime! / H) * H, now - 60 * 24 * H); t <= now && out.length < 500; t += H) out.push({ time: t, fundingRate: String(0.00001 * Math.sin(t / (13 * H))), premium: '0' });
        return out;
      }
      return null;
    },
  };
}

function setup(over: { register?: () => { at: number; added: boolean; hash: string } | null; repo?: boolean } = {}) {
  let now = NOW;
  const base = mkdtempSync(join(tmpdir(), 'hq-lab-'));
  let repo = null;
  let remote = '';
  if (over.repo) {
    remote = mkdtempSync(join(tmpdir(), 'hq-remote-'));
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
    repo = { remote, dir: join(base, 'archive'), branch: 'archive' };
  }
  const archive = new CandleArchive({ dir: repo ? repo.dir : join(base, 'archive'), coin: 'BTC', rest: rest(() => now), fundingPages: 20 });
  const reports: LabReport[] = [];
  const r = new LabRunner({ coin: 'BTC', archive, repo, register: over.register ?? (() => ({ at: NOW - 30 * 24 * H, added: false, hash: 'c'.repeat(64) })), publish: (x) => reports.push(x) });
  return { r, reports, remote, setNow: (t: number) => (now = t) };
}

describe('LabRunner', () => {
  it('hash katalogu = SHA-256 kanonicznego JSON katalogu', () => {
    expect(LAB_HASH).toBe(createHash('sha256').update(canonicalJson(LAB_CATALOG)).digest('hex'));
  });
  it('pierwszy przebieg: archiwum + ocena z rejestracją; kolejna ocena dopiero po godzinie', async () => {
    const { r, reports, setNow } = setup();
    const a = await r.tick(NOW);
    expect(a.added).toBeGreaterThan(5000);
    expect(a.evaluated).toBe(true);
    expect(reports).toHaveLength(1);
    expect(isLabReport(reports[0])).toBe(true);
    expect(reports[0]).toMatchObject({ catalogHash: LAB_HASH, registeredAt: NOW - 30 * 24 * H, coin: 'BTC' });
    expect(reports[0].data.hours).toBeGreaterThan(4000);
    setNow(NOW + 10 * MIN);
    expect((await r.tick(NOW + 10 * MIN)).evaluated).toBe(false);
    setNow(NOW + 61 * MIN);
    expect((await r.tick(NOW + 61 * MIN)).evaluated).toBe(true);
  });
  it('dziennik niegotowy (rejestracja null) → bez publikacji (nie nadpisuje wyników); po rejestracji ocena od razu', async () => {
    let reg: { at: number; added: boolean; hash: string } | null = null;
    const { r, reports, setNow } = setup({ register: () => reg });
    expect((await r.tick(NOW)).evaluated).toBe(false);
    expect(reports).toHaveLength(0);
    reg = { at: NOW + 5 * MIN, added: true, hash: 'e'.repeat(64) };
    setNow(NOW + 10 * MIN);
    expect((await r.tick(NOW + 10 * MIN)).evaluated).toBe(true);
    expect(reports.at(-1)).toMatchObject({ registeredAt: NOW + 5 * MIN, registrationHash: 'e'.repeat(64) });
    // Chwilowy brak odpowiedzi dziennika (przebieg w toku) nie kasuje znanej rejestracji
    reg = null;
    setNow(NOW + 80 * MIN);
    expect((await r.tick(NOW + 80 * MIN)).evaluated).toBe(true);
    expect(reports.at(-1)!.registeredAt).toBe(NOW + 5 * MIN);
  });
  it('gałąź archive: commit zaraz po zasiewie, potem najwyżej co godzinę', async () => {
    const { r, remote, setNow } = setup({ repo: true });
    expect((await r.tick(NOW)).committed).toBe(true);
    const count = () => execFileSync('git', ['-C', remote, 'rev-list', '--count', 'archive'], { encoding: 'utf8' }).trim();
    expect(count()).toBe('1');
    setNow(NOW + 10 * MIN);
    expect((await r.tick(NOW + 10 * MIN)).committed).toBe(false);
    setNow(NOW + 70 * MIN);
    expect((await r.tick(NOW + 70 * MIN)).committed).toBe(true);
    expect(count()).toBe('2');
  });
});
