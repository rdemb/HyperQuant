#!/usr/bin/env node
// IndexNow (Bing, Yandex, Seznam, Naver): zgłoszenie nowych i zmienionych wpisów bloga zaraz po wdrożeniu.
// Użycie w GitHub Actions (push na main, po `npm run build`, lista commitów w zmiennej środowiska COMMITS):
//   node scripts/blog/indexnow.mjs >> "$GITHUB_OUTPUT"
// Wypisuje `body=<JSON zgłoszenia>` albo nic, gdy push nie dodał ani nie zmienił opublikowanego wpisu.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { siteFromPackage } from './build.mjs';

/** Klucz IndexNow; ten sam tekst leży w public/<klucz>.txt, czyli pod adresem strony (klucz jest jawny z założenia). */
export const INDEXNOW_KEY = '8365203363394d4aa575b5d1e62bcbc9';
const POST_FILE = /^content\/blog\/(\d{4}-\d{2}-\d{2}-[a-z0-9-]+)\.md$/;

/**
 * Treść zgłoszenia z listy commitów pusha: adresy wpisów dodanych albo zmienionych i strona główna bloga.
 * `published(id)` mówi, czy wpis jest w zbudowanej stronie (pomija szkice i wpisy usunięte w tym samym pushu).
 */
export function indexNowBody(commits, site, published) {
  const ids = new Set();
  for (const c of commits ?? []) for (const f of [...(c.added ?? []), ...(c.modified ?? [])]) ids.add(POST_FILE.exec(f)?.[1]);
  const posts = [...ids].filter((id) => id && published(id)).sort();
  if (!posts.length) return null;
  return {
    host: new URL(site.url).host,
    key: INDEXNOW_KEY,
    keyLocation: `${site.url}${INDEXNOW_KEY}.txt`,
    urlList: [`${site.url}blog/`, ...posts.map((id) => `${site.url}blog/${id}/`)],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
  const body = indexNowBody(JSON.parse(process.env.COMMITS || '[]'), await siteFromPackage(), (id) =>
    existsSync(path.join(dist, 'blog', id, 'index.html'))
  );
  if (body) console.log(`body=${JSON.stringify(body)}`);
}
