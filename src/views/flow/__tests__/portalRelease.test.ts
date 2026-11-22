import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { resolveChronographAnchor } from '../chronographAnchor';

const portal = readFileSync('public/nowy/index.html', 'utf8');
const terminal = readFileSync('public/nowy/desk.html', 'utf8');
const releaseRoot = 'https://example.test/';

function destination(url: URL) {
  if (url.pathname === '/') return 'index.html';
  if (url.pathname === '/stanowisko/') return 'stanowisko/index.html';
  return resolve('public', '.' + url.pathname.replace(/\/$/, '/index.html'));
}

describe('Cross-section portal release entry points', () => {
  it('registers page initialization with the default sound threshold when storage is blocked', () => {
    const ready: Array<() => void> = [];
    const HQ: { ready: (callback: () => void) => void; sound?: { min: number; on: boolean; setMin: (amount: number) => void } } = {
      ready: (callback) => { ready.push(callback); },
    };
    const page = {
      window: { HQ },
      document: {
        documentElement: {},
        addEventListener: () => {},
      },
      matchMedia: () => ({ matches: false }),
      get localStorage() { throw new DOMException('Storage blocked', 'SecurityError'); },
    };
    runInNewContext(readFileSync('public/nowy/assets/portal.js', 'utf8'), page);
    expect(ready).toEqual([expect.any(Function)]);
    expect(HQ.sound).toMatchObject({ min: 50_000, on: false });
    HQ.sound?.setMin(10_000);
    expect(HQ.sound?.min).toBe(10_000);
  });

  it('offers a language-aware link from the app and builds the direct Workbench entry', () => {
    const shell = readFileSync('src/shell/AppShell.tsx', 'utf8');
    const workbench = readFileSync('stanowisko/index.html', 'utf8');
    const config = readFileSync('vite.config.ts', 'utf8');
    expect(shell).toContain('./nowy/?lang=');
    expect(portal).toContain('../stanowisko/?lang=');
    expect(workbench).toContain('id="workbench-root"');
    expect(config).toContain("path.join(ROOT, 'stanowisko/index.html')");
  });

  it('ships all directly linked local documents and assets and keeps review pages private', () => {
    for (const [content, name] of [[portal, 'index.html'], [terminal, 'desk.html']]) {
      const entry = new URL('/nowy/' + name, releaseRoot);
      for (const [, link] of content.matchAll(/(?:href|src)="([^"\s]+)"/g)) {
        if (link.startsWith('#')) continue;
        const url = new URL(link.replaceAll('&amp;', '&'), entry);
        if (url.origin === entry.origin) expect(existsSync(destination(url)), url.pathname).toBe(true);
      }
    }
    for (const path of ['stany.html', 'm4-testy.html', 'pierwsze.html']) {
      expect(existsSync('public/nowy/' + path)).toBe(false);
    }
  });

  it('ships every relative document reached directly from the terminal command palette', () => {
    const desk = readFileSync('public/nowy/assets/desk.js', 'utf8');
    const targets = [...desk.matchAll(/location\.href\s*=\s*['"]([^'"]+\.html)['"]/g)].map(([, link]) => link);
    expect(targets).toContain('index.html');
    const entry = new URL('/nowy/desk.html', releaseRoot);
    for (const target of targets) {
      const url = new URL(target, entry);
      if (url.origin === entry.origin) expect(existsSync(destination(url)), url.pathname).toBe(true);
    }
  });

  it('resolves the published observation to the checked-in clip, trade and book pair', () => {
    const href = portal.match(/id="event-open" href="([^"]+)"/)?.[1];
    expect(href).toBeDefined();
    const url = new URL(href!.replaceAll('&amp;', '&'), releaseRoot + 'nowy/');
    const query = new URLSearchParams(url.hash.split('?')[1]);
    expect(url.pathname).toBe('/');
    expect(query.get('m')).toBe('BTC');
    expect(query.get('w')).toBe('level');
    const anchor: unknown = JSON.parse(Buffer.from(query.get('a') ?? '', 'base64url').toString('utf8'));
    expect(resolveChronographAnchor(anchor)).toMatchObject({
      kind: 'resolved', trade: { tid: 978, px: 61611 },
      drop: { before: { t: 1795159781528 }, after: { t: 1795159794009 } },
    });
  });
});
