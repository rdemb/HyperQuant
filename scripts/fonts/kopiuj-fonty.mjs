#!/usr/bin/env node
/**
 * Fonty u nas: kopiuje pliki woff2 z paczek @fontsource (OFL 1.1) do public/fonts/ i składa jeden
 * fonts.css dla aplikacji, bloga i stron statycznych (blogu nie buduje Vite, więc stała ścieżka, nie import w pakiecie).
 * Tylko podzbiory latin i latin-ext (polskie znaki, „−” U+2212, spacja niełamiąca U+00A0, €), tylko woff2, pliki fontów
 * bez zmian (bez przycinania i konwersji). `--check`: nic nie zapisuje, kod 1, gdy public/fonts różni się od wyniku.
 *
 * Uruchomienie: node scripts/fonts/kopiuj-fonty.mjs [--check]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUT = join(ROOT, 'public', 'fonts');
const SUBSETS = ['latin-ext', 'latin'];
const CR = String.fromCharCode(13);

/** Rodziny i odmiany: suma tego, czego używa aplikacja (src/index.css) i blog (scripts/blog/render.mjs). */
export const FONTS = [
  { pkg: 'outfit', family: 'Outfit', faces: ['500', '600', '700'] },
  { pkg: 'plus-jakarta-sans', family: 'Plus Jakarta Sans', faces: ['400', '500', '600', '700', '400-italic'] },
  { pkg: 'ibm-plex-mono', family: 'IBM Plex Mono', faces: ['400', '500', '600', '400-italic'] },
  // Nowy wygląd: nagłówki Bricolage Grotesque (font zmienny z osią opsz, wagi 200–800) i liczby JetBrains Mono
  { pkg: 'bricolage-grotesque', scope: '@fontsource-variable', family: 'Bricolage Grotesque Variable', faces: ['opsz'], variable: true },
  { pkg: 'jetbrains-mono', family: 'JetBrains Mono', faces: ['400', '500', '600', '700'] },
];

/** Bloki @font-face z pliku odmiany @fontsource (np. 500.css), tylko wybrane podzbiory, z adresem woff2 obok fonts.css. */
export function faceBlocks(css, pkg) {
  const out = [];
  const re = /\/\* ([\w-]+) \*\/\s*@font-face\s*\{([^}]*)\}/g;
  for (const [, name, body] of css.matchAll(re)) {
    const subset = SUBSETS.find((s) => name.startsWith(`${pkg}-${s}-`));
    if (!subset || (subset === 'latin' && name.startsWith(`${pkg}-latin-ext-`))) continue;
    const [, woff2, format] = body.match(/url\(\.\/files\/([\w-]+\.woff2)\) format\('(woff2(?:-variations)?)'\)/) ?? [];
    if (!woff2) throw new Error(`Brak woff2 w ${name}`);
    const keep = body
      .split(';')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('src:'))
      .map((l) => `  ${l};`);
    out.push({ name, woff2, css: `/* ${name} */\n@font-face {\n${keep.join('\n')}\n  src: url(./${woff2}) format('${format}');\n}` });
  }
  return out;
}

/** Pliki do zapisania w public/fonts: { nazwa: zawartość (Buffer albo tekst) }. */
export function build() {
  const files = {};
  const css = [
    '/* Fonty HyperQuant hostowane u nas (SIL Open Font License 1.1, licencje w LICENSE-*.txt obok). */',
    '/* Plik generowany: node scripts/fonts/kopiuj-fonty.mjs (nie edytować ręcznie). */',
  ];
  for (const f of FONTS) {
    const dir = join(ROOT, 'node_modules', f.scope ?? '@fontsource', f.pkg);
    for (const face of f.faces) {
      for (const b of faceBlocks(readFileSync(join(dir, `${face}.css`), 'utf8'), f.pkg)) {
        css.push(b.css);
        files[b.woff2] = readFileSync(join(dir, 'files', b.woff2));
      }
    }
    files[`LICENSE-${f.pkg}.txt`] = readFileSync(join(dir, 'LICENSE'), 'utf8');
  }
  files['fonts.css'] = `${css.join('\n\n')}\n`;
  return files;
}

function main() {
  const check = process.argv.includes('--check');
  const files = build();
  const want = new Set(Object.keys(files));
  const have = existsSync(OUT) ? readdirSync(OUT) : [];
  const stale = have.filter((n) => !want.has(n));
  const diff = Object.entries(files).filter(([n, v]) => {
    const p = join(OUT, n);
    if (!existsSync(p)) return true;
    // Tekst porównywany bez CR (checkout na Windows może zamienić końce linii); pliki fontów bajt w bajt
    return Buffer.isBuffer(v) ? !readFileSync(p).equals(v) : readFileSync(p, 'utf8').replaceAll(CR, '') !== v.replaceAll(CR, '');
  });
  if (check) {
    if (diff.length || stale.length) {
      console.error(`public/fonts nieaktualne: różne ${diff.map(([n]) => n).join(', ') || '—'}; zbędne ${stale.join(', ') || '—'}`);
      process.exit(1);
    }
    console.log(`public/fonts aktualne (${want.size} plików)`);
    return;
  }
  if (stale.length) throw new Error(`Zbędne pliki w public/fonts (usuń ręcznie): ${stale.join(', ')}`);
  mkdirSync(OUT, { recursive: true });
  for (const [n, v] of diff) writeFileSync(join(OUT, n), v);
  console.log(`public/fonts: zapisano ${diff.length} z ${want.size} plików`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
