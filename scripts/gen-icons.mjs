// Generator ikon PWA (PNG) z prostego znaku SVG „H ze świec” w kolorach tokenów.
// Użycie: npm i --no-save sharp && node scripts/gen-icons.mjs   (`sharp` nie jest zależnością projektu)
// Wynik: public/icons/*.png — commitowane artefakty, skrypt służy do ich odtworzenia.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'icons');

// sharp: ze ścieżki SHARP_PATH (jeśli ustawiona), w przeciwnym razie z node_modules projektu
function loadSharp() {
  const candidates = [process.env.SHARP_PATH, 'sharp'].filter(Boolean);
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      // próbuj następnej lokalizacji
    }
  }
  throw new Error('Nie znaleziono pakietu sharp — uruchom `npm i --no-save sharp` lub ustaw SHARP_PATH na katalog pakietu.');
}

// Tokeny (src/index.css @theme)
const PAGE = '#070A11';
const SURFACE = '#0B1019';
const LINE = '#283447';
const ACCENT = '#3FC6DD';
const INK = '#EEF2F7';

/**
 * Znak na siatce 64×64: dwie świece (kreska + korpus) połączone poprzeczką tworzą literę „H”.
 * `rounded` — zaokrąglone tło z przezroczystymi rogami (ikona „any”); inaczej pełne tło (maskable/iOS).
 * `scale` — skala znaku względem środka (maskable musi zmieścić się w strefie bezpiecznej 80%).
 */
function markSvg({ rounded, scale = 1 }) {
  const bg = rounded
    ? `<rect width="64" height="64" rx="14" fill="${SURFACE}"/><rect x="0.75" y="0.75" width="62.5" height="62.5" rx="13.25" fill="none" stroke="${LINE}" stroke-width="1.5"/>`
    : `<rect width="64" height="64" fill="${PAGE}"/>`;
  const t = `translate(32 32) scale(${scale}) translate(-32 -32)`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  ${bg}
  <g transform="${t}">
    <path d="M22 13V51M42 13V51" stroke="${ACCENT}" stroke-width="2.5" stroke-linecap="round"/>
    <rect x="17" y="19" width="10" height="24" rx="2" fill="${ACCENT}"/>
    <rect x="37" y="23" width="10" height="22" rx="2" fill="${ACCENT}"/>
    <path d="M27 32H37" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>
  </g>
</svg>`;
}

const targets = [
  { file: 'icon-192.png', size: 192, rounded: true },
  { file: 'icon-512.png', size: 512, rounded: true },
  { file: 'icon-maskable-512.png', size: 512, rounded: false, scale: 0.78 },
  { file: 'apple-touch-icon.png', size: 180, rounded: false, scale: 0.9 },
];

const sharp = loadSharp();
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'icon.svg'), markSvg({ rounded: true }));
for (const t of targets) {
  const svg = Buffer.from(markSvg(t));
  await sharp(svg, { density: Math.ceil((72 * t.size) / 64) })
    .resize(t.size, t.size)
    .png({ compressionLevel: 9 })
    .toFile(path.join(outDir, t.file));
  console.log('ikona', t.file, `${t.size}×${t.size}`);
}
