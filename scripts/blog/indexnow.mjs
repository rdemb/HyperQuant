#!/usr/bin/env node
// IndexNow (Bing, Yandex, Seznam, Naver): zgłoszenie nowych i zmienionych wpisów bloga zaraz po wdrożeniu.
// Użycie w GitHub Actions (po `npm run build`):
//   git diff --name-only --diff-filter=AM <przed> HEAD | node scripts/blog/indexnow.mjs >> "$GITHUB_OUTPUT"
//   node scripts/blog/indexnow.mjs --all >> "$GITHUB_OUTPUT"     → wszystkie adresy z dist/sitemap.xml (ręczne zgłoszenie)
// Wypisuje `body=<JSON zgłoszenia>` albo nic, gdy nie ma czego zgłosić.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { siteFromPackage } from './build.mjs';

/** Klucz IndexNow; ten sam tekst leży w public/<klucz>.txt, czyli pod adresem strony (klucz jest jawny z założenia). */
export const INDEXNOW_KEY = '8365203363394d4aa575b5d1e62bcbc9';
const POST_FILE = /^content\/blog\/(\d{4}-\d{2}-\d{2}-[a-z0-9-]+)\.md$/;

/**
 * Adresy wpisów z listy zmienionych plików (i strona główna bloga, gdy jest choć jeden).
 * `published(id)` mówi, czy wpis jest w zbudowanej stronie (pomija szkice).
 */
export function changedPostUrls(files, site, published) {
  const ids = [...new Set(files.map((f) => POST_FILE.exec(f.trim())?.[1]))].filter((id) => id && published(id)).sort();
  return ids.length ? [`${site.url}blog/`, ...ids.map((id) => `${site.url}blog/${id}/`)] : [];
}

/** Adresy z mapy strony. */
export function sitemapUrls(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replaceAll('&amp;', '&'));
}

/** Treść zgłoszenia IndexNow albo null, gdy lista jest pusta. */
export function indexNowBody(urls, site) {
  if (!urls.length) return null;
  return { host: new URL(site.url).host, key: INDEXNOW_KEY, keyLocation: `${site.url}${INDEXNOW_KEY}.txt`, urlList: urls };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
  const site = await siteFromPackage();
  const urls = process.argv.includes('--all')
    ? sitemapUrls(readFileSync(path.join(dist, 'sitemap.xml'), 'utf8'))
    : changedPostUrls(readFileSync(0, 'utf8').split('\n'), site, (id) => existsSync(path.join(dist, 'blog', id, 'index.html')));
  const body = indexNowBody(urls, site);
  if (body) console.log(`body=${JSON.stringify(body)}`);
}
