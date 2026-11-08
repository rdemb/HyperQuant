/**
 * Instalacja serwera `hyperquant-mcp` ze strony: polecenie dla klientów MCP (STDIO), linki instalacji Cursora i VS Code,
 * ustawienia OpenBota, JSON `mcpServers` i adres paczki `.mcpb` (z sumą SHA-256) dla Claude Desktop. Czyste funkcje;
 * jedyny import to wersja paczki z `mcp/package.json` (polecenie npx z wersją przypiętą, bez kodu serwera).
 *
 * Formaty linków (sprawdzone w dokumentacji edytorów):
 * - Cursor (cursor.com/docs/context/mcp/install-links): `cursor://anysphere.cursor-deeplink/mcp/install?name=<nazwa>&config=<base64>`,
 *   gdzie base64 to JSON `{command, args}`; base64 kodujemy jeszcze w URL („+”, „/” i „=” psułyby parametr).
 * - VS Code (code.visualstudio.com/api/extension-guides/ai/mcp, „Create an MCP installation or lookup URL”):
 *   `vscode:mcp/install?<encodeURIComponent(JSON)>`, JSON z nazwą i konfiguracją serwera w formacie VS Code (`type: 'stdio'`);
 *   na stronie w opakowaniu `https://vscode.dev/redirect?url=<link vscode: w URL>` (zalecanym tam dla stron i dokumentacji).
 */
import { version as MCP_VERSION } from '../../../mcp/package.json';

/** Skąd użytkownik bierze serwer: z paczki npm (główna droga) albo z repozytorium (gdyby paczki w npm zabrakło). */
export type McpStatus = 'repo' | 'npm';

/** Paczka `hyperquant-mcp` jest w npm: główna droga to `npx` z wersją przypiętą (README paczki mówi to samo, pilnuje test). */
export const MCP_STATUS: McpStatus = 'npm';

/** Nazwa serwera w konfiguracji klientów. */
export const SERVER_NAME = 'hyperquant';
export const NPM_PACKAGE = 'hyperquant-mcp';
/**
 * Paczka npm z wersją przypiętą (`hyperquant-mcp@<wersja z mcp/package.json>`): polecenie instalacji uruchamia dokładnie
 * tę wersję, którą opisuje strona, a nie najnowszą z rejestru.
 */
export const NPM_SPEC = `${NPM_PACKAGE}@${MCP_VERSION}`;
/** Polecenie uruchomienia z npm, jak w README paczki. */
export const NPX_COMMAND = `npx -y ${NPM_SPEC}`;
export const REPO_URL = 'https://github.com/rdemb/HyperQuant';
/** Katalog repozytorium w przykładach: użytkownik wstawia pełną ścieżkę swojej kopii. */
export const REPO_DIR = '/path/to/HyperQuant';
/** Bundle serwera po `npm run mcp:build`, względem katalogu repozytorium. */
export const BUNDLE_PATH = 'mcp/dist/hyperquant-mcp.mjs';
/** Kroki przed uruchomieniem z repozytorium (Node.js 20 albo nowszy), jak w README paczki. */
export const REPO_STEPS: readonly string[] = [`git clone ${REPO_URL}.git`, 'cd HyperQuant', 'npm ci --legacy-peer-deps', 'npm run mcp:build'];
/** Paczka MCPB dla Claude Desktop, budowana przy wdrożeniu strony (`npm run mcp:mcpb`). */
export const MCPB_URL = './agents/hyperquant.mcpb';
/** Suma SHA-256 paczki w formacie `sha256sum`, zapisywana przez `npm run mcp:mcpb` obok archiwum. */
export const MCPB_SHA256_URL = `${MCPB_URL}.sha256`;

/** Suma z pliku `sha256sum` („<64 znaki hex>  <nazwa>”): pierwsze pole małymi literami; inny format — null. */
export function parseSha256(text: string): string | null {
  const m = /^([0-9a-fA-F]{64})(?:\s|$)/.exec(text);
  return m ? m[1].toLowerCase() : null;
}

export interface ServerConfig {
  command: string;
  args: string[];
}

/** Polecenie uruchamiające serwer przez STDIO. */
export function serverConfig(status: McpStatus): ServerConfig {
  return status === 'npm' ? { command: 'npx', args: ['-y', NPM_SPEC] } : { command: 'node', args: [`${REPO_DIR}/${BUNDLE_PATH}`] };
}

/** Base64 tekstu UTF-8 (btoa przyjmuje tylko znaki jednobajtowe). */
function base64(text: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Link instalacji serwera w Cursorze dla dowolnej konfiguracji. */
export function cursorInstallLink(name: string, config: ServerConfig): string {
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(base64(JSON.stringify(config)))}`;
}

/** Link Cursora; przed publikacją w npm brak (ścieżka repozytorium jest inna u każdego). */
export function cursorLink(status: McpStatus): string | null {
  return status === 'npm' ? cursorInstallLink(SERVER_NAME, serverConfig(status)) : null;
}

/** Link VS Code przez vscode.dev (strona przekierowuje do edytora); przed publikacją w npm brak. */
export function vscodeLink(status: McpStatus): string | null {
  if (status !== 'npm') return null;
  const install = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: SERVER_NAME, type: 'stdio', ...serverConfig(status) }))}`;
  return `https://vscode.dev/redirect?url=${encodeURIComponent(install)}`;
}

/** Ustawienia własnej aplikacji w OpenBocie (transport STDIO, polecenie i argumenty). */
export function openbotConfig(status: McpStatus): { transport: 'STDIO'; command: string; args: string[] } {
  return { transport: 'STDIO', ...serverConfig(status) };
}

/** JSON `mcpServers` (Claude Desktop i większość klientów MCP). */
export function claudeDesktopJson(status: McpStatus): string {
  return JSON.stringify({ mcpServers: { [SERVER_NAME]: serverConfig(status) } }, null, 2);
}
