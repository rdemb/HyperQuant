// Obrazek do podglądu linku (Open Graph / X), 1200×630: SVG → PNG przez resvg z fontami OFL z repozytorium.
// Bez fontów systemowych, więc obrazek wygląda tak samo w GitHub Actions i lokalnie.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { fmtPrice, ladderLayout } from './render.mjs';

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts');
const FONT_FILES = ['Outfit-SemiBold.ttf', 'PlusJakartaSans-Medium.ttf'].map((f) => path.join(FONT_DIR, f));

// Tokeny (src/index.css @theme)
const C = { page: '#070a11', surface: '#0b1019', lineStrong: '#283447', ink1: '#eef2f7', ink2: '#a9b4c4', ink3: '#7a889c', accent: '#3fc6dd', level: '#e0a045' };
const W = 1200;
const H = 630;
const X0 = 64;
const LADDER_MAX = 6;

const x = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/**
 * Łamanie tytułu na wiersze przy szacowanej szerokości znaku (Outfit SemiBold ≈ 0,56 em).
 * Dobiera największy rozmiar, przy którym tytuł mieści się w 3 wierszach; ostatni wiersz w razie potrzeby z wielokropkiem.
 */
export function wrapTitle(text, maxWidth, sizes = [60, 54, 48, 42], maxLines = 3) {
  for (const size of sizes) {
    const perLine = Math.floor(maxWidth / (size * 0.56));
    const lines = [];
    for (const w of text.split(/\s+/)) {
      const last = lines.at(-1);
      if (last !== undefined && (last + ' ' + w).length <= perLine) lines[lines.length - 1] = `${last} ${w}`;
      else lines.push(w);
    }
    if (lines.length <= maxLines || size === sizes.at(-1)) {
      if (lines.length > maxLines) {
        lines.length = maxLines;
        lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, perLine - 1).trimEnd()}…`;
      }
      return { size, lines };
    }
  }
  return { size: sizes.at(-1), lines: [text] };
}

/** Panel z mapą poziomów: najbliższe cenie poziomy (do 6) + cena, ta sama skala co na stronie wpisu. */
function ladderPanel(price, levels) {
  const near = [...levels].sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price)).slice(0, LADDER_MAX);
  const rows = [...near.map((l) => ({ ...l, current: false })), { label: 'Cena', price, current: true }].sort((a, b) => b.price - a.price || (a.current ? 1 : -1));
  const px = 752;
  const py = 64;
  const pw = 384;
  const ph = 452;
  const top = py + 64;
  const height = ph - 88;
  const { y, label } = ladderLayout(
    rows.map((r) => r.price),
    height
  );
  const out = [
    `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="16" fill="${C.surface}" stroke="${C.lineStrong}" stroke-width="2"/>`,
    `<text x="${px + 28}" y="${py + 44}" font-family="Plus Jakarta Sans" font-weight="500" font-size="18" letter-spacing="2" fill="${C.ink3}">MAPA POZIOMÓW</text>`,
    `<line x1="${px + 40}" y1="${top + 16}" x2="${px + 40}" y2="${top + height - 16}" stroke="${C.lineStrong}" stroke-width="2"/>`,
  ];
  rows.forEach((r, i) => {
    const color = r.current ? C.accent : C.level;
    const ty = top + y[i];
    const ly = top + label[i];
    out.push(`<line x1="${px + 30}" y1="${ty}" x2="${px + 50}" y2="${ty}" stroke="${color}" stroke-width="${r.current ? 4 : 3}"/>`);
    out.push(`<polyline points="${px + 50},${ty} ${px + 58},${ty} ${px + 70},${ly}" fill="none" stroke="${color}" stroke-opacity="0.5" stroke-width="1.5"/>`);
    const text = r.current ? C.accent : C.ink1;
    out.push(`<text x="${px + 80}" y="${ly + 7}" font-family="Plus Jakarta Sans" font-weight="500" font-size="21" fill="${text}">${x(r.label.length > 18 ? `${r.label.slice(0, 17)}…` : r.label)}</text>`);
    out.push(`<text x="${px + pw - 28}" y="${ly + 7}" text-anchor="end" font-family="Plus Jakarta Sans" font-weight="500" font-size="21" fill="${text}">${x(fmtPrice(r.price))}</text>`);
  });
  return out.join('');
}

/**
 * Zrzut ekranu w panelu z prawej (karty stron serwisu). `shot` = { href (data: URI JPEG/PNG), w, h, crop: [x, y, w, h] }:
 * wycinek obrazka w px obrazka, przeskalowany tak, żeby pokrył panel, który wychodzi za prawą krawędź karty.
 */
function shotPanel(shot) {
  const px = 640;
  const py = 64;
  const pw = W - px + 24;
  const ph = 452;
  const [cx, cy, cw, ch] = shot.crop;
  const k = Math.max(pw / cw, ph / ch);
  const r = (v) => Math.round(v * 100) / 100;
  return `<clipPath id="shot"><rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="16"/></clipPath>
<g clip-path="url(#shot)"><image href="${shot.href}" x="${r(px - cx * k)}" y="${r(py - cy * k)}" width="${r(shot.w * k)}" height="${r(shot.h * k)}"/></g>
<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="16" fill="none" stroke="${C.lineStrong}" stroke-width="2"/>`;
}

/** Stopka karty bloga: adres i zastrzeżenie (karty stron serwisu podają własne). */
const BLOG_FOOT = ['rdemb.github.io/HyperQuant/blog', 'prawdopodobieństwa, nie sygnały'];

/** SVG karty. `card` = { section, title, dateLine?, subtitle?, body?, price?, levels?, shot?, foot? }. */
export function ogSvg(card) {
  const levels = card.price ? (card.levels ?? []) : [];
  const textWidth = levels.length ? 640 : card.shot ? 560 : W - 2 * X0;
  const { size, lines } = wrapTitle(card.title, textWidth);
  const lh = Math.round(size * 1.14);
  const titleTop = 196;
  const title = lines.map((l, i) => `<tspan x="${X0}" y="${titleTop + i * lh}">${x(l)}</tspan>`).join('');
  const below = titleTop + (lines.length - 1) * lh + 58;
  const sub = card.dateLine ?? card.subtitle;
  // Podtytuł do dwóch wierszy (Plus Jakarta Sans 26 px)
  const subLines = sub ? wrapTitle(sub, textWidth, [26], 2).lines : [];
  const subtitle = subLines.map((l, i) => `<tspan x="${X0}" y="${below + i * 36}">${x(l)}</tspan>`).join('');
  // Dłuższy opis pod podtytułem (hasła atlasu): do trzech wierszy, 22 px
  const bodyTop = below + subLines.length * 36 + 28;
  const body = card.body ? wrapTitle(card.body, textWidth, [22], 3).lines.map((l, i) => `<tspan x="${X0}" y="${bodyTop + i * 32}">${x(l)}</tspan>`).join('') : '';
  const price = card.price
    ? `<text x="${X0}" y="476" font-family="Plus Jakarta Sans" font-weight="500" font-size="22" letter-spacing="2" fill="${C.ink3}">BTC-PERP</text><text x="${X0}" y="530" font-family="Plus Jakarta Sans" font-weight="500" font-size="48" fill="${C.ink1}">${x(fmtPrice(card.price))} USD</text>`
    : '';
  const [footLeft, footRight] = card.foot ?? BLOG_FOOT;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${C.page}"/>
<rect x="0" y="0" width="${W}" height="6" fill="${C.accent}"/>
<text x="${X0}" y="104" font-family="Outfit" font-weight="600" font-size="26" letter-spacing="3" fill="${C.accent}">HYPERQUANT<tspan dx="14" fill="${C.lineStrong}" letter-spacing="0">/</tspan><tspan dx="14" fill="${C.ink2}" font-family="Plus Jakarta Sans" font-weight="500" letter-spacing="0">${x(card.section)}</tspan></text>
<text font-family="Outfit" font-weight="600" font-size="${size}" fill="${C.ink1}">${title}</text>
${subtitle ? `<text font-family="Plus Jakarta Sans" font-weight="500" font-size="26" fill="${C.ink2}">${subtitle}</text>` : ''}
${body ? `<text font-family="Plus Jakarta Sans" font-weight="500" font-size="22" fill="${C.ink3}">${body}</text>` : ''}
${price}
${levels.length ? ladderPanel(card.price, levels) : ''}${card.shot ? shotPanel(card.shot) : ''}
<line x1="${X0}" y1="566" x2="${W - X0}" y2="566" stroke="${C.lineStrong}" stroke-width="2"/>
<text x="${X0}" y="604" font-family="Plus Jakarta Sans" font-weight="500" font-size="20" fill="${C.ink3}">${x(footLeft)}</text>
<text x="${W - X0}" y="604" text-anchor="end" font-family="Plus Jakarta Sans" font-weight="500" font-size="20" fill="${C.ink3}">${x(footRight)}</text>
</svg>`;
}

/** SVG → PNG (1200×630). */
export function renderPng(svg) {
  const r = new Resvg(svg, { font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Plus Jakarta Sans' } });
  return r.render().asPng();
}
