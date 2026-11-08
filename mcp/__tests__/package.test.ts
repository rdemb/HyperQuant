/**
 * Pliki paczki `hyperquant-mcp`: licencja taka sama jak w repo, README zgodne z narzędziami serwera i z zasadami publikacji
 * (bez ścieżek lokalnych, danych osobowych i kluczy), uczciwe co do tego, czego jeszcze nie ma.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUARDS, guardHits } from '../../src/utils/safeguards.mjs';
import { VERSION } from '../src/sources';
import { TOOLS } from '../src/tools/index';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const README = read('mcp/README.md');
const PKG = JSON.parse(read('mcp/package.json')) as { name: string; version: string; license: string; files: string[]; bin: Record<string, string> };

describe('paczka hyperquant-mcp', () => {
  it('LICENSE w paczce to ta sama licencja MIT co w repo; package.json: pliki, licencja, polecenie', () => {
    expect(read('mcp/LICENSE')).toBe(read('LICENSE'));
    expect(PKG).toMatchObject({ name: 'hyperquant-mcp', version: VERSION, license: 'MIT', bin: { 'hyperquant-mcp': 'dist/hyperquant-mcp.mjs' } });
    expect(PKG.files).toEqual(['dist/hyperquant-mcp.mjs', 'README.md', 'LICENSE']);
  });

  it('README opisuje każde narzędzie serwera, uruchomienie i zmienne środowiska', () => {
    expect(TOOLS).toHaveLength(10);
    for (const t of TOOLS) expect(README, t.name).toContain(`\`${t.name}\``);
    for (const s of [`npx -y hyperquant-mcp@${VERSION}`, 'npm run mcp:build', 'node mcp/dist/hyperquant-mcp.mjs', 'HQ_LANG', 'HQ_TZ', 'OpenBot', 'Claude Desktop', 'STDIO']) expect(README, s).toContain(s);
  });

  it('README: każde polecenie i argument npx z wersją przypiętą (hyperquant-mcp@<wersja paczki>), także w JSON-ie konfiguracji', () => {
    const pinned = `hyperquant-mcp@${VERSION}`;
    // Nazwa paczki po „-y” (polecenie, argumenty, JSON) zawsze z wersją
    const loose = [...README.matchAll(/-y"?,?\s*"?(hyperquant-mcp(?:@[\w.-]+)?)/g)].map((m) => m[1]);
    expect(loose.length).toBeGreaterThanOrEqual(4);
    expect(loose.filter((x) => x !== pinned)).toEqual([]);
    expect(README).toContain(`"args": ["-y", "${pinned}"]`);
  });

  it('README: Claude Desktop najpierw przez plik .mcpb (pobranie ze strony, dwuklik), dopiero potem wariant npx', () => {
    const claude = README.slice(README.indexOf('### Claude Desktop'));
    const mcpb = claude.indexOf('https://hyperquant.tech/agents/hyperquant.mcpb');
    expect(mcpb).toBeGreaterThan(-1);
    expect(claude).toMatch(/double-click/i);
    expect(mcpb).toBeLessThan(claude.indexOf('npx'));
  });

  it('package.json paczki: prepack buduje bundle (npm pack i publish zawsze z aktualnym dist)', () => {
    const pkg = JSON.parse(read('mcp/package.json')) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.prepack).toBe('cd .. && npm run mcp:build');
  });

  it('README: argumenty narzędzi (session_review: session, market_brief: level) w zdaniu o argumentach i w tabeli', () => {
    const args = README.split('\n').find((l) => l.startsWith('All tools are read-only')) ?? '';
    for (const s of ['`session_review`', '`session`', '`market_brief`', '`level`']) expect(args, s).toContain(s);
    const row = README.split('\n').find((l) => l.startsWith('| `market_brief`')) ?? '';
    for (const s of ['`level`', 'fromPrice', 'vwapDistance', 'fuelToLevel']) expect(row, s).toContain(s);
  });

  it('README uczciwie: paczki nie ma jeszcze w npm, tryb HTTP w planach, RVOL jako MODEL, share60 null przy przerwie w nagraniu', () => {
    expect(README).toMatch(/## Status/);
    expect(README).toMatch(/not (?:yet )?(?:published|on npm)/i);
    expect(README).toMatch(/HTTP[^\n]*planned/i);
    expect(README).toMatch(/RVOL[^\n]*MODEL/);
    expect(README).toMatch(/share60[^\n]*null/);
    expect(README).toContain('## Polski');
    // Te same funkcje i metoda co strona, ale cena z ostatniego zamknięcia 1m — liczby mogą się nieco różnić
    expect(README).toMatch(/same functions and method[^\n]*1-minute close[^\n]*differ slightly/);
    expect(README).not.toMatch(/report the same values/);
  });

  it('README: wstrzymana etykieta albo tytuł z bloga opisane dla wszystkich trzech narzędzi z poziomami map', () => {
    const line = README.split('\n').find((l) => l.includes('labelWhy')) ?? '';
    for (const t of ['`day_map`', '`market_brief`', '`session_review`']) expect(line, t).toContain(t);
    expect(line).toContain('[label withheld]');
    expect(line).toContain('[title withheld]');
  });

  it('README zgodne z zasadami publikacji: bez ścieżek lokalnych, adresów, kluczy i wezwań do transakcji', () => {
    // Ścieżka w katalogu domowym dowolnego użytkownika (Windows, macOS, Linux); przykłady tylko z „/path/to/…”
    expect(README).not.toMatch(/(?<![A-Za-z])[A-Za-z]:[\\/]+Users[\\/]|\/Users\/[A-Za-z]|\/home\/[A-Za-z]/i);
    // Prywatność i rady jak we wpisach bloga (adres, IP, e-mail, klucz; tryb rozkazujący kup/sprzedaj)
    expect(guardHits(README, GUARDS.filter((g) => g.kind !== 'style')).map((h) => h.guard.why)).toEqual([]);
  });
});
