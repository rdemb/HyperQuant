#!/usr/bin/env node
/**
 * Ikona aplikacji „Chronograf H”: grafitowa płytka, pierścień doby z trzema sesjami BTC (Azja 00–08 UTC, Londyn 08–13:30,
 * Nowy Jork 13:30–24, kolejno ciemny, szary, jasny), znak „teraz” w kolorze lume na otwarciu Nowego Jorku i „H” z dwóch
 * świec w środku. Jeden rysunek, kilka wariantów: płytka z zaokrągleniem (favicon, ikona „any”), pełne tło bez zaokrąglenia
 * (maskable, Apple — system sam przycina). Zapis: public/favicon.svg, public/icons/*.svg i *.png (resvg).
 * Użycie: node scripts/icons/ikona.mjs
 */
import { writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const K = { bg0: '#1d2025', bg1: '#0c0d0f', edge: '#2b2f35', asia: '#3a3f48', london: '#8c929a', ny: '#edeef0', ink: '#edeef0', lume: '#cfea5b' };
const C = 256;

const pt = (r, h) => {
  const a = (h / 24) * 2 * Math.PI - Math.PI / 2;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
};
/** Łuk pierścienia od godziny h0 do h1 (zegar 24 h, 00 u góry) */
const arc = (r, h0, h1) => {
  const [x0, y0] = pt(r, h0);
  const [x1, y1] = pt(r, h1);
  const large = (h1 - h0) / 24 > 0.5 ? 1 : 0;
  return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
};

/**
 * `full` — tło na całą płytkę bez zaokrąglenia (maskable, Apple); `scale` — rysunek w środku pomniejszony (strefa
 * bezpieczna maskable: koło o promieniu 40% boku).
 */
function svg({ full = false, scale = 1 } = {}) {
  const R = 178;
  const W = 30;
  const GAP = 0.32;
  const now = 13.5;
  const [dx, dy] = pt(R, now);
  const tile = full
    ? `<rect width="512" height="512" fill="url(#g)"/>`
    : `<rect x="8" y="8" width="496" height="496" rx="116" fill="url(#g)"/><rect x="8" y="8" width="496" height="496" rx="116" fill="none" stroke="${K.edge}" stroke-width="4"/>`;
  const art = `
  <g fill="none" stroke-linecap="round" stroke-width="${W}">
    <path d="${arc(R, 0 + GAP, 8 - GAP)}" stroke="${K.asia}"/>
    <path d="${arc(R, 8 + GAP, 13.5 - GAP)}" stroke="${K.london}"/>
    <path d="${arc(R, 13.5 + GAP, 24 - GAP)}" stroke="${K.ny}"/>
  </g>
  <g fill="${K.ink}">
    <rect x="183" y="150" width="14" height="212" rx="7"/>
    <rect x="160" y="184" width="60" height="132" rx="14"/>
    <rect x="315" y="138" width="14" height="196" rx="7"/>
    <rect x="292" y="166" width="60" height="122" rx="14"/>
    <rect x="214" y="238" width="84" height="26" rx="13"/>
  </g>
  <circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="34" fill="${K.lume}" stroke="${K.bg1}" stroke-width="12"/>`;
  const body = scale === 1 ? art : `<g transform="translate(${C} ${C}) scale(${scale}) translate(${-C} ${-C})">${art}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${K.bg0}"/><stop offset="1" stop-color="${K.bg1}"/></linearGradient></defs>
  ${tile}${body}
</svg>
`;
}

const png = (s, size) => new Resvg(s, { fitTo: { mode: 'width', value: size } }).render().asPng();

const any = svg();
const maskable = svg({ full: true, scale: 0.78 });
const apple = svg({ full: true, scale: 0.86 });
writeFileSync('public/favicon.svg', any);
writeFileSync('public/icons/icon.svg', any);
writeFileSync('public/icons/icon-192.png', png(any, 192));
writeFileSync('public/icons/icon-512.png', png(any, 512));
writeFileSync('public/icons/icon-maskable-512.png', png(maskable, 512));
writeFileSync('public/icons/apple-touch-icon.png', png(apple, 180));
console.log('Ikony: favicon.svg, icon.svg, icon-192, icon-512, icon-maskable-512, apple-touch-icon');
