import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** „Wyniki” i „Co nowego” w nawigacji aplikacji: obok Blogu na komputerze (górny pasek) i w menu „Więcej” na telefonie. */
describe('nawigacja aplikacji: link „Co nowego”', () => {
  const src = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8');
  const link = "href={tr('./co-nowego/', './en/whats-new/')}";
  it('etykieta PL i EN, adres w języku interfejsu', () => {
    expect(src).toMatch(/const NEWS_LABEL = tr\('Co nowego', 'What['’]s new'\)/);
  });
  it('„Wyniki” (wyniki/, en/results/) przed „Co nowego”, oba po Blogu na pasku i w menu telefonu', () => {
    const res = "href={tr('./wyniki/', './en/results/')}";
    expect(src).toContain("const RESULTS_LABEL = tr('Wyniki', 'Results');");
    for (const part of [src.slice(src.indexOf("<nav aria-label={tr('Główna'")), src.slice(src.indexOf('{phoneMore && ('))]) {
      const b = part.indexOf('href="./blog/"');
      expect(part.indexOf(res)).toBeGreaterThan(b);
      expect(part.indexOf(res)).toBeLessThan(part.indexOf(link));
    }
  });
  it('górny pasek: zaraz po Blogu; menu telefonu: zaraz po Blogu', () => {
    const top = src.slice(src.indexOf('<nav aria-label={tr(\'Główna\''), src.indexOf('</nav>', src.indexOf('<nav aria-label={tr(\'Główna\'')));
    expect(top.indexOf(link)).toBeGreaterThan(top.indexOf('href="./blog/"'));
    const phone = src.slice(src.indexOf('{phoneMore && ('));
    const blog = phone.indexOf('href="./blog/"');
    expect(blog).toBeGreaterThan(0);
    expect(phone.indexOf(link)).toBeGreaterThan(blog);
    expect(phone.indexOf(link)).toBeLessThan(phone.indexOf('AGENTS.id'));
  });
});
