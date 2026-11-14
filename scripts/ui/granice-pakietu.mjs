#!/usr/bin/env node
/**
 * Kontrola zbudowanego pakietu (po `npm run build`, manifest Vite w dist/.vite/manifest.json):
 * 1. Stara powłoka nie ładuje kodu nowego wyglądu: domknięcie statycznych importów wejścia (index.html) nie zawiera
 *    plików src/nowy/; nowa powłoka to osobny moduł dynamiczny (src/nowy/NowaPowloka.tsx).
 * 2. Wersja service workera: rejestracja (src/shell/usePwa.ts, wersja z import.meta.url) siedzi w pliku wejściowym
 *    wskazanym przez dist/index.html — inaczej każde sprawdzenie wdrożenia widziałoby „nową wersję”.
 * Kod wyjścia 1 i opis przy złamaniu.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = process.argv[2] ?? 'dist';
const manifest = JSON.parse(readFileSync(join(DIST, '.vite', 'manifest.json'), 'utf8'));
const bledy = [];

const wejscie = Object.entries(manifest).find(([, v]) => v.isEntry && v.src === 'index.html');
if (!wejscie) bledy.push('brak wejścia index.html w manifeście');
else {
  // Domknięcie importów statycznych (bez dynamicImports): to, co pobiera każda wizyta w starej powłoce
  const widziane = new Set();
  const stos = [wejscie[0]];
  while (stos.length) {
    const k = stos.pop();
    if (widziane.has(k)) continue;
    widziane.add(k);
    for (const i of manifest[k]?.imports ?? []) stos.push(i);
  }
  const nowe = [...widziane].filter((k) => k.startsWith('src/nowy/') || (manifest[k]?.src ?? '').startsWith('src/nowy/'));
  if (nowe.length) bledy.push(`wejście statycznie importuje nowy wygląd: ${nowe.join(', ')}`);

  const powloka = manifest['src/nowy/NowaPowloka.tsx'];
  if (!powloka?.isDynamicEntry) bledy.push('src/nowy/NowaPowloka.tsx nie jest osobnym modułem dynamicznym');

  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const skrypt = html.match(/<script[^>]+src="\.\/(assets\/[^"]+\.js)"/)?.[1];
  if (!skrypt || !existsSync(join(DIST, skrypt))) bledy.push('brak skryptu wejściowego w dist/index.html');
  else {
    if (skrypt !== manifest[wejscie[0]].file) bledy.push(`skrypt z index.html (${skrypt}) to nie plik wejścia z manifestu (${manifest[wejscie[0]].file})`);
    const wejscieJs = readFileSync(join(DIST, skrypt), 'utf8');
    if (!wejscieJs.includes('sw.js?v=')) bledy.push('rejestracja service workera (usePwa) poza plikiem wejściowym: wersja SW rozjedzie się z wdrożeniem');
    // Moduł nowego wyglądu wklejony statycznie do wejścia (bez osobnego wpisu w manifeście): po znaczniku powłoki
    if (wejscieJs.includes('data-nowa-powloka')) bledy.push('plik wejściowy zawiera kod nowej powłoki (data-nowa-powloka)');
  }
}

if (bledy.length) {
  console.error(`Granice pakietu złamane:\n- ${bledy.join('\n- ')}`);
  process.exit(1);
}
console.log('Granice pakietu: wejście bez src/nowy, nowa powłoka osobno, rejestracja SW w pliku wejściowym');
