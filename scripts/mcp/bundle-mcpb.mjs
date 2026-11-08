#!/usr/bin/env node
/**
 * Paczka MCPB `hyperquant.mcpb` dla Claude Desktop (instalacja dwuklikiem). Format: archiwum ZIP z `manifest.json`
 * (specyfikacja MANIFEST.md repo modelcontextprotocol/mcpb, wersja manifestu 0.3), licencją paczki (`LICENSE` z mcp/),
 * ikoną `icon.png` (ikona PWA strony 512×512), bundlem serwera jako `server/…` i `node_modules` z zależnościami wykonania
 * paczki `hyperquant-mcp` (`dependencies` z mcp/package.json, przechodnio: SDK serwera MCP z jego rdzeniem i zod), bez
 * map źródeł, deklaracji typów i dokumentacji. Obok archiwum plik `<archiwum>.sha256` z jego sumą SHA-256 w formacie
 * `sha256sum` (strona pokazuje ją przy przycisku pobrania).
 *
 * Własny zapis ZIP (deflate z node:zlib), bez nowych zależności: oficjalne CLI `@anthropic-ai/mcpb` ciągnie dziewięć
 * paczek (m.in. podpisy i interaktywne pytania), a tu wystarczy spakować gotowe pliki. Archiwum jak z oficjalnego
 * `mcpb pack` (deflate, prawa Unix w atrybutach, bez wpisów katalogów), ale ze stałą datą plików i stałą kolejnością
 * wpisów: ten sam bundle daje bajt w bajt to samo archiwum.
 *
 * Użycie (po `npm run mcp:build`): npm run mcp:mcpb
 *   node scripts/mcp/bundle-mcpb.mjs [--bundle mcp/dist/hyperquant-mcp.mjs] [--out dist/agents/hyperquant.mcpb]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_BUNDLE = 'mcp/dist/hyperquant-mcp.mjs';
export const DEFAULT_OUT = 'dist/agents/hyperquant.mcpb';
const MANIFEST = 'mcp/mcpb/manifest.json';
const MCP_PKG = 'mcp/package.json';
const MCP_LICENSE = 'mcp/LICENSE';
/**
 * Ikona paczki: ikona PWA strony (PNG 512×512, rozmiar zalecany przez specyfikację) jako `icon.png` w katalogu głównym
 * archiwum, wskazana polem `icon` manifestu (ścieżka względna w paczce). Bez kopii pliku w repozytorium.
 */
const ICON_SOURCE = 'public/icons/icon-512.png';
const ICON = 'icon.png';
/** Sygnatura pliku PNG (specyfikacja sprawdza ją przy ikonie lokalnej). */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Pliki zależności zbędne w czasie wykonania: mapy źródeł, deklaracje typów i źródła TypeScript, dokumentacja. */
const SKIP_FILE = /\.(?:map|[cm]?ts|md|markdown)$/i;
/** Licencje zostają zawsze, także w formacie .md. */
const KEEP_FILE = /^(?:licen[cs]e|notice|copying)(?:\.|$)/i;

/** Data i godzina każdego pliku w formacie DOS: 1980-01-01 00:00 (najwcześniejsza możliwa, stała). */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
/** Zwykły plik rw-r--r-- w górnych 16 bitach atrybutów zewnętrznych (twórca: Unix). */
const UNIX_FILE = (0o100644 << 16) >>> 0;
/** Bit 11 flag: nazwy w UTF-8. */
const UTF8 = 0x0800;

const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
/** Porządek po kodach znaków, niezależny od ustawień regionalnych. */
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (ZIP) bufora. */
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Archiwum ZIP z wpisów `{ name, data }` w podanej kolejności: deflate (albo bez kompresji, gdy deflate nie zmniejsza
 * pliku), CRC-32, rozmiary w nagłówku lokalnym (bez deskryptora danych), stała data. Bez ZIP64.
 * @param {{ name: string; data: Buffer }[]} entries
 */
export function zip(entries) {
  if (entries.length > 0xffff) throw new Error(`za dużo plików w archiwum: ${entries.length} (ZIP64 nieobsługiwany)`);
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const method = stored ? 0 : 8;
    if (data.length >= 0xffffffff || offset + 30 + nameBuf.length + body.length >= 0xffffffff) throw new Error('za duże archiwum (ZIP64 nieobsługiwany)');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // wersja potrzebna do rozpakowania: 2.0 (deflate)
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE((3 << 8) | 20, 4); // utworzone na Unix, wersja 2.0 (prawa pliku w atrybutach)
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(UTF8, 8);
    record.writeUInt16LE(method, 10);
    record.writeUInt16LE(DOS_TIME, 12);
    record.writeUInt16LE(DOS_DATE, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(nameBuf.length, 28);
    // 30–37: długość pola dodatkowego i komentarza, numer dysku, atrybuty wewnętrzne — zera
    record.writeUInt32LE(UNIX_FILE, 38);
    record.writeUInt32LE(offset, 42);

    parts.push(local, nameBuf, body);
    central.push(record, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

/** Katalog paczki `name` widziany z katalogu `from` (jak Node: `node_modules` w nim i wyżej, najwyżej do katalogu repo). */
function findPackage(name, from) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', ...name.split('/'));
    if (existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (path.relative(ROOT, dir) === '' || path.dirname(dir) === dir) break;
  }
  throw new Error(`brak paczki ${name} w node_modules (najpierw npm ci --legacy-peer-deps)`);
}

/**
 * Zależności wykonania paczki MCP: `dependencies` z mcp/package.json i przechodnio ich `dependencies` (bez dev, peer
 * i opcjonalnych), posortowane po nazwie. Archiwum ma jeden poziom `node_modules`, więc dwie różne kopie tej samej
 * paczki to błąd.
 */
export function runtimePackages() {
  const found = new Map();
  const queue = [{ dir: path.join(ROOT, 'mcp'), pkg: readJson(MCP_PKG) }];
  while (queue.length > 0) {
    const { dir, pkg } = queue.shift();
    for (const name of Object.keys(pkg.dependencies ?? {}).sort(byCode)) {
      const at = findPackage(name, dir);
      const seen = found.get(name);
      if (seen && seen !== at) throw new Error(`dwie kopie paczki ${name}: ${rel(seen)} i ${rel(at)}`);
      if (seen) continue;
      found.set(name, at);
      queue.push({ dir: at, pkg: JSON.parse(readFileSync(path.join(at, 'package.json'), 'utf8')) });
    }
  }
  return [...found].sort(([a], [b]) => byCode(a, b)).map(([name, dir]) => ({ name, dir }));
}

/** Pliki paczki potrzebne w czasie wykonania, ścieżki względne z „/”, posortowane; bez zagnieżdżonych `node_modules`. */
function packageFiles(dir) {
  const out = [];
  const walk = (abs, prefix) => {
    for (const e of readdirSync(abs, { withFileTypes: true }).sort((a, b) => byCode(a.name, b.name))) {
      if (e.name === 'node_modules') continue;
      const p = path.join(abs, e.name);
      const r = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r);
      else if (e.isFile() && (KEEP_FILE.test(e.name) || !SKIP_FILE.test(e.name))) out.push({ rel: r, abs: p });
    }
  };
  walk(dir, '');
  return out;
}

/** Manifest z repo (końce linii `\n`) po sprawdzeniu zgodności z paczką i z miejscem bundla w archiwum. */
function readManifest() {
  const text = readFileSync(path.join(ROOT, MANIFEST), 'utf8').replace(/\r\n/g, '\n');
  const m = JSON.parse(text);
  const pkg = readJson(MCP_PKG);
  const fail = (why) => {
    throw new Error(`${MANIFEST}: ${why}`);
  };
  if (m.manifest_version !== '0.3') fail(`manifest_version ${m.manifest_version}, oczekiwane 0.3`);
  if (m.version !== pkg.version) fail(`wersja ${m.version} inna niż w ${MCP_PKG} (${pkg.version})`);
  if (m.server?.type !== 'node') fail('server.type musi być node');
  const entry = m.server.entry_point;
  if (typeof entry !== 'string' || !/^server\/[\w.-]+\.mjs$/.test(entry)) fail(`entry_point ${entry}: oczekiwane server/<plik>.mjs`);
  if (m.server.mcp_config?.command !== 'node' || m.server.mcp_config.args?.[0] !== `\${__dirname}/${entry}`) fail('mcp_config: node ${__dirname}/<entry_point>');
  if (m.icon !== ICON) fail(`icon ${m.icon}: oczekiwane ${ICON} (ikona z ${ICON_SOURCE})`);
  return { text, entry };
}

/** Ikona z repo po sprawdzeniu, że to PNG. */
function readIcon() {
  const data = readFileSync(path.join(ROOT, ICON_SOURCE));
  if (!data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw new Error(`${ICON_SOURCE}: to nie jest plik PNG`);
  return data;
}

/**
 * Wpisy archiwum: manifest, licencja paczki (końce linii `\n`, jak manifest: to samo archiwum na każdym systemie), ikona,
 * bundle jako `entry_point`, pliki zależności wykonania w `node_modules/<nazwa>/…`. Małe pliki opisu paczki na początku,
 * jak manifest; kolejność stała.
 * @param {{ bundle: string }} opts
 */
export function mcpbEntries({ bundle }) {
  if (!existsSync(bundle)) throw new Error(`brak bundla ${bundle}: najpierw npm run mcp:build`);
  const { text, entry } = readManifest();
  const packages = runtimePackages();
  const license = readFileSync(path.join(ROOT, MCP_LICENSE), 'utf8').replace(/\r\n/g, '\n');
  const entries = [
    { name: 'manifest.json', data: Buffer.from(text, 'utf8') },
    { name: 'LICENSE', data: Buffer.from(license, 'utf8') },
    { name: ICON, data: readIcon() },
    { name: entry, data: readFileSync(bundle) },
  ];
  for (const { name, dir } of packages) {
    for (const f of packageFiles(dir)) entries.push({ name: `node_modules/${name}/${f.rel}`, data: readFileSync(f.abs) });
  }
  return { entries, packages: packages.map((p) => p.name) };
}

/**
 * Buduje archiwum i zapisuje je w `out`, a obok `<out>.sha256` („<hex>  <nazwa pliku>”, jak `sha256sum`); zwraca liczbę
 * plików, rozmiar, sumę i dołączone paczki.
 */
export function packMcpb({ bundle = path.join(ROOT, DEFAULT_BUNDLE), out = path.join(ROOT, DEFAULT_OUT) } = {}) {
  const { entries, packages } = mcpbEntries({ bundle });
  const buf = zip(entries);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, buf);
  writeFileSync(`${out}.sha256`, `${sha256}  ${path.basename(out)}\n`);
  return { files: entries.length, bytes: buf.length, sha256, packages };
}

/** Argumenty `--bundle` i `--out` (ścieżki względem bieżącego katalogu). */
function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if ((flag !== '--bundle' && flag !== '--out') || !value) throw new Error(`użycie: node scripts/mcp/bundle-mcpb.mjs [--bundle <plik.mjs>] [--out <plik.mcpb>] (dostałem ${flag ?? 'nic'})`);
    opts[flag.slice(2)] = path.resolve(value);
  }
  return opts;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const out = opts.out ?? path.join(ROOT, DEFAULT_OUT);
    const r = packMcpb({ ...opts, out });
    console.log(`mcpb: ${path.relative(process.cwd(), out) || out}, ${r.files} plików, ${(r.bytes / 1024).toFixed(0)} KiB (node_modules: ${r.packages.join(', ')})`);
    console.log(`sha256: ${r.sha256}  ${path.basename(out)} → ${path.relative(process.cwd(), `${out}.sha256`) || `${out}.sha256`}`);
  } catch (e) {
    console.error(`mcpb: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
