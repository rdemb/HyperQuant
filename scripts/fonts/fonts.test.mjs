import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONTS, OUT, build } from './kopiuj-fonty.mjs';

const css = readFileSync(join(OUT, 'fonts.css'), 'utf8');
const faces = [...css.matchAll(/\/\* ([\w-]+) \*\/\s*@font-face\s*\{([^}]*)\}/g)].map(([, name, body]) => ({ name, body }));

/** Czy zakres unicode-range (np. „U+0000-00FF,U+2212”) obejmuje znak. */
function covers(range, cp) {
  return range.split(',').some((part) => {
    const [a, b] = part.trim().replace(/^U\+/, '').split('-');
    const lo = parseInt(a, 16);
    const hi = b ? parseInt(b, 16) : lo;
    return cp >= lo && cp <= hi;
  });
}

describe('fonty u nas (public/fonts)', () => {
  it('pliki zgodne z paczkami @fontsource (node scripts/fonts/kopiuj-fonty.mjs)', () => {
    const CR = String.fromCharCode(13);
    for (const [name, v] of Object.entries(build())) {
      const p = join(OUT, name);
      expect(existsSync(p), name).toBe(true);
      if (Buffer.isBuffer(v)) expect(readFileSync(p).equals(v), name).toBe(true);
      else expect(readFileSync(p, 'utf8').replaceAll(CR, ''), name).toBe(v.replaceAll(CR, ''));
    }
  });

  it('tylko lokalne woff2, każdy plik istnieje; licencja OFL każdej rodziny obok', () => {
    expect(css).not.toMatch(/https?:/);
    for (const f of faces) {
      const file = f.body.match(/src: url\(\.\/([\w-]+\.woff2)\) format\('woff2(?:-variations)?'\);/)?.[1];
      expect(file, f.name).toBeTruthy();
      expect(existsSync(join(OUT, file)), file).toBe(true);
    }
    for (const f of FONTS) expect(readFileSync(join(OUT, `LICENSE-${f.pkg}.txt`), 'utf8')).toMatch(/SIL Open Font License/);
  });

  it('każda odmiana każdej rodziny ma latin i latin-ext: „−0,04%”, spacja niełamiąca, € i polskie litery', () => {
    for (const f of FONTS) {
      for (const face of f.faces) {
        // Font zmienny: jedna odmiana z zakresem wag (np. „200 800”) zamiast pojedynczej wagi
        const [w, style = 'normal'] = f.variable ? ['200 800'] : face.split('-');
        const own = faces.filter((x) => x.body.includes(`font-family: '${f.family}'`) && x.body.includes(`font-weight: ${w};`) && x.body.includes(`font-style: ${style};`));
        const ranges = own.map((x) => x.body.match(/unicode-range: ([^;]+);/)?.[1] ?? '');
        expect(own.length, `${f.family} ${face}`).toBe(2);
        for (const ch of ['−', '\u00a0', '€', '0', ',', '%', 'ą', 'ę', 'ł', 'ś', 'ż', 'ź', 'Ł', 'Ż']) {
          expect(ranges.some((r) => covers(r, ch.codePointAt(0))), `${f.family} ${face}: U+${ch.codePointAt(0).toString(16)}`).toBe(true);
        }
      }
    }
  });

  it('aplikacja bez Google Fonts: index.html ładuje fonts.css z public/ (Vite zapisuje ścieżkę względem base)', () => {
    const html = readFileSync(join(OUT, '..', '..', 'index.html'), 'utf8');
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    expect(html).toContain('href="/fonts/fonts.css"');
  });
});
