/**
 * Pliki instalacji w OpenBocie publikowane przez stronę (`agents/openbot/…`): skill `hyperquant` bajt w bajt z repo
 * (SKILL.md i ikona PWA 512×512 jako `assets/icon.png`), a dla każdego szablonu agenta pełny plik profilu, opis profilu
 * (pole „description” agenta w OpenBocie, do 2000 znaków) i instrukcje `AGENTS.md` z sekcji Instructions i Rules.
 * Fiksturami są prawdziwe pliki repo; brak sekcji w szablonie to błąd z nazwą pliku.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENT_TEMPLATES } from '../agents/index';
import { DESCRIPTION_MAX, OPENBOT_DIR, OPENBOT_PATHS, openbotFiles } from '../agents/openbot';
import { ROOT, section } from './markdown';
import { publishHits } from './publishPatterns';

/** Surowe bajty pliku repo (bez zmiany końców linii). */
const raw = (p: string): Buffer => readFileSync(path.join(ROOT, p));
const files = openbotFiles(raw);
const byPath = new Map(files.map((f) => [f.path, f.content]));
const bytes = (p: string): Buffer => Buffer.from(byPath.get(p) ?? new Uint8Array());
const text = (p: string): string => bytes(p).toString('utf8');
const md = (file: string) => raw(file).toString('utf8').replace(/\r\n/g, '\n');
/** Nagłówki Markdown pliku (linie od „#”). */
const headings = (s: string) => s.split('\n').filter((l) => /^#{1,6}\s/.test(l));

describe('pliki OpenBota na stronie', () => {
  it('lista: skill (SKILL.md, assets/icon.png), potem dla każdego szablonu <id>.md, <id>/description.txt i <id>/AGENTS.md', () => {
    expect(OPENBOT_DIR).toBe('agents/openbot');
    expect(files.map((f) => f.path)).toEqual([
      'hyperquant/SKILL.md',
      'hyperquant/assets/icon.png',
      'desk.md',
      'desk/description.txt',
      'desk/AGENTS.md',
      'big-hands.md',
      'big-hands/description.txt',
      'big-hands/AGENTS.md',
      'session-review.md',
      'session-review/description.txt',
      'session-review/AGENTS.md',
    ]);
    expect(OPENBOT_PATHS.skill).toBe('hyperquant/SKILL.md');
    expect(OPENBOT_PATHS.icon).toBe('hyperquant/assets/icon.png');
    expect(AGENT_TEMPLATES.map((t) => [OPENBOT_PATHS.profile(t.id), OPENBOT_PATHS.description(t.id), OPENBOT_PATHS.instructions(t.id)])).toEqual([
      ['desk.md', 'desk/description.txt', 'desk/AGENTS.md'],
      ['big-hands.md', 'big-hands/description.txt', 'big-hands/AGENTS.md'],
      ['session-review.md', 'session-review/description.txt', 'session-review/AGENTS.md'],
    ]);
  });

  it('SKILL.md bajt w bajt z integrations/skills/hyperquant; ikona bajt w bajt public/icons/icon-512.png (PNG 512×512)', () => {
    expect(bytes('hyperquant/SKILL.md').equals(raw('integrations/skills/hyperquant/SKILL.md'))).toBe(true);
    const icon = bytes('hyperquant/assets/icon.png');
    expect(icon.equals(raw('public/icons/icon-512.png'))).toBe(true);
    // Sygnatura PNG, potem nagłówek IHDR: szerokość i wysokość
    expect(icon.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect([icon.readUInt32BE(16), icon.readUInt32BE(20)]).toEqual([512, 512]);
  });

  it('<id>.md: pełny plik szablonu bajt w bajt', () => {
    for (const t of AGENT_TEMPLATES) expect(bytes(`${t.id}.md`).equals(raw(t.file)), t.id).toBe(true);
  });

  it('<id>/description.txt: treść sekcji Description bez nagłówka, przycięta, do 2000 znaków', () => {
    expect(DESCRIPTION_MAX).toBe(2000);
    for (const t of AGENT_TEMPLATES) {
      const d = text(`${t.id}/description.txt`);
      expect(d, t.id).toBe(section(md(t.file), 'Description'));
      expect(d, t.id).toBe(d.trim());
      expect(d.length, t.id).toBeGreaterThan(300);
      expect(d.length, t.id).toBeLessThanOrEqual(2000);
      expect(d, t.id).not.toContain('###');
    }
  });

  it('<id>/AGENTS.md: # Instructions z sekcją Instructions i ## Rules z sekcją Rules, bez profilu, wymagań, narzędzi i przykładów', () => {
    for (const t of AGENT_TEMPLATES) {
      const a = text(`${t.id}/AGENTS.md`);
      const src = md(t.file);
      expect(a, t.id).toBe(`# Instructions\n\n${section(src, 'Instructions')}\n\n## Rules\n\n${section(src, 'Rules')}\n`);
      expect(headings(a), t.id).toEqual(['# Instructions', '## Rules']);
      for (const s of ['How to use', 'Profile', 'Requires', 'Example prompts', '**Name:**', '**Title:**', '| Tool |']) expect(a, `${t.id}: ${s}`).not.toContain(s);
    }
  });

  it('treści tekstowe bez trafień wzorców publikacji', () => {
    const texts = files.filter((f) => /\.(?:md|txt)$/.test(f.path));
    expect(texts).toHaveLength(files.length - 1);
    expect(texts.flatMap((f) => publishHits(Buffer.from(f.content).toString('utf8')).map((h) => `${f.path}: ${h}`))).toEqual([]);
  });

  it('wynik nie zależy od końców linii w kopii repo (CRLF po checkoutcie na Windows daje te same opisy i instrukcje)', () => {
    const crlf = openbotFiles((p) => (p.endsWith('.md') ? Buffer.from(raw(p).toString('utf8').replace(/\n/g, '\r\n')) : raw(p)));
    for (const t of AGENT_TEMPLATES) {
      for (const p of [`${t.id}/description.txt`, `${t.id}/AGENTS.md`]) {
        expect(Buffer.from(crlf.find((f) => f.path === p)?.content ?? []).equals(bytes(p)), p).toBe(true);
      }
    }
  });

  it('brak sekcji w szablonie: błąd z nazwą pliku i nagłówkiem; opis ponad 2000 znaków: błąd z nazwą pliku', () => {
    const desk = AGENT_TEMPLATES[0];
    const without = (heading: string) => (p: string) => (p === desk.file ? Buffer.from(md(p).replace(`\n${heading}\n`, '\n')) : raw(p));
    for (const h of ['### Description', '### Instructions', '## Rules']) {
      expect(() => openbotFiles(without(h)), h).toThrow(desk.file);
      expect(() => openbotFiles(without(h)), h).toThrow(h);
    }
    const long = (p: string) => (p === desk.file ? Buffer.from(md(p).replace('### Description\n', `### Description\n\n${'x'.repeat(DESCRIPTION_MAX)}\n`)) : raw(p));
    expect(() => openbotFiles(long)).toThrow(desk.file);
  });
});
