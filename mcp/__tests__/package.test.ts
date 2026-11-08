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
    for (const s of ['npx -y hyperquant-mcp', 'npm run mcp:build', 'node mcp/dist/hyperquant-mcp.mjs', 'HQ_LANG', 'HQ_TZ', 'OpenBot', 'Claude Desktop', 'STDIO']) expect(README, s).toContain(s);
  });

  it('README uczciwie: paczki nie ma jeszcze w npm, tryb HTTP w planach, RVOL jako MODEL, share60 null przy przerwie w nagraniu', () => {
    expect(README).toMatch(/## Status/);
    expect(README).toMatch(/not (?:yet )?(?:published|on npm)/i);
    expect(README).toMatch(/HTTP[^\n]*planned/i);
    expect(README).toMatch(/RVOL[^\n]*MODEL/);
    expect(README).toMatch(/share60[^\n]*null/);
    expect(README).toContain('## Polski');
  });

  it('README zgodne z zasadami publikacji: bez ścieżek lokalnych, adresów, kluczy i wezwań do transakcji', () => {
    // Ścieżka w katalogu domowym dowolnego użytkownika (Windows, macOS, Linux); przykłady tylko z „/path/to/…”
    expect(README).not.toMatch(/(?<![A-Za-z])[A-Za-z]:[\\/]+Users[\\/]|\/Users\/[A-Za-z]|\/home\/[A-Za-z]/i);
    // Prywatność i rady jak we wpisach bloga (adres, IP, e-mail, klucz; tryb rozkazujący kup/sprzedaj)
    expect(guardHits(README, GUARDS.filter((g) => g.kind !== 'style')).map((h) => h.guard.why)).toEqual([]);
  });
});
