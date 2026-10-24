#!/usr/bin/env node
// Blog: budowanie stron do dist/blog (po `vite build`) albo sprawdzenie wpisów przed publikacją.
// Użycie:
//   node scripts/blog/build.mjs                       → dist/blog/**, dist/sitemap.xml
//   node scripts/blog/build.mjs --drafts              → to samo razem z wpisami `draft: true` (podgląd lokalny)
//   node scripts/blog/build.mjs --check [plik.md …]   → walidacja wszystkich albo wskazanych wpisów, bez zapisu; kod 1 przy błędach
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPostFile, loadPosts } from './posts.mjs';
import { feedXml, fmtDay, fmtTime, indexPage, monthKey, monthPage, postPage, sitemapXml } from './render.mjs';
import { ogSvg, renderPng } from './og.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
export const CONTENT_DIR = path.join(ROOT, 'content', 'blog');

/** Adres strony i repozytorium z package.json (jedno źródło prawdy). */
export async function siteFromPackage() {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  return { url: pkg.homepage.replace(/\/?$/, '/'), repo: pkg.repository.url.replace(/\.git$/, '') };
}

/** Problemy z wpisami jako czytelny tekst (plik + lista błędów). */
export function formatProblems(problems) {
  return problems.map((p) => `${p.file}\n${p.errors.map((e) => `  - ${e}`).join('\n')}`).join('\n');
}

/**
 * Buduje blog do `outDir/blog` i `outDir/sitemap.xml`. Błędny wpis zatrzymuje build (nic nie trafia na stronę po cichu).
 * Zwraca liczbę opublikowanych wpisów.
 */
export async function buildBlog({ contentDir = CONTENT_DIR, outDir, site, drafts = false }) {
  const { posts, problems } = loadPosts(contentDir);
  if (problems.length) throw new Error(`Błędne wpisy bloga:\n${formatProblems(problems)}`);
  const visible = posts.filter((p) => drafts || !p.draft);

  const blogDir = path.join(outDir, 'blog');
  await rm(blogDir, { recursive: true, force: true });
  await mkdir(blogDir, { recursive: true });
  const css = await readFile(path.join(HERE, 'blog.css'));
  const s = { ...site, cssVersion: createHash('sha256').update(css).digest('hex').slice(0, 10) };
  await writeFile(path.join(blogDir, 'blog.css'), css);

  for (const [i, post] of visible.entries()) {
    const dir = path.join(blogDir, post.id);
    if (post.mediaDir) await cp(post.mediaDir, dir, { recursive: true });
    else await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), postPage(s, post, { newer: visible[i - 1], older: visible[i + 1] }));
    const card = { section: post.section, title: post.title, dateLine: `${fmtDay(post.ms)}, ${fmtTime(post.ms)}`, price: post.price, levels: post.levels };
    await writeFile(path.join(dir, 'og.png'), renderPng(ogSvg(card)));
  }

  await writeFile(path.join(blogDir, 'index.html'), indexPage(s, visible));
  const months = [...new Set(visible.map((p) => monthKey(p.ms)))];
  for (const m of months) {
    const dir = path.join(blogDir, 'archiwum', m);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'index.html'),
      monthPage(
        s,
        m,
        visible.filter((p) => monthKey(p.ms) === m),
        months
      )
    );
  }
  await writeFile(path.join(blogDir, 'feed.xml'), feedXml(s, visible));
  await writeFile(path.join(outDir, 'sitemap.xml'), sitemapXml(s, visible));
  await writeFile(
    path.join(blogDir, 'og.png'),
    renderPng(ogSvg({ section: 'Blog', title: 'Analizy BTC na Hyperliquid', subtitle: 'Mapa dnia, mapa przed Nowym Jorkiem, podsumowanie dnia' }))
  );
  return visible.length;
}

/** Walidacja wpisów (wszystkich albo wskazanych plików) przed publikacją, czyli przed commitem wpisu. */
export function checkPosts(files, contentDir = CONTENT_DIR) {
  if (!files.length) return loadPosts(contentDir).problems;
  return files.map((f) => ({ file: f, ...loadPostFile(path.resolve(f)) })).filter((r) => r.errors.length);
}

async function main(argv) {
  if (argv.includes('--check')) {
    const files = argv.filter((a) => !a.startsWith('--'));
    const problems = checkPosts(files);
    if (problems.length) {
      console.error(formatProblems(problems));
      process.exit(1);
    }
    console.log(files.length ? `Wpisy poprawne: ${files.length}` : 'Wszystkie wpisy poprawne');
    return;
  }
  const n = await buildBlog({ outDir: path.join(ROOT, 'dist'), site: await siteFromPackage(), drafts: argv.includes('--drafts') });
  console.log(`Blog: ${n} wpisów → dist/blog`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
