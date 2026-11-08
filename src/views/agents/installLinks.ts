/**
 * Instalacja serwera `hyperquant-mcp` ze strony: polecenie dla klientów MCP (STDIO), linki instalacji Cursora i VS Code,
 * ustawienia OpenBota, JSON `mcpServers` i adres paczki `.mcpb` dla Claude Desktop. Czyste funkcje bez importów.
 *
 * Formaty linków (sprawdzone w dokumentacji edytorów):
 * - Cursor (cursor.com/docs/context/mcp/install-links): `cursor://anysphere.cursor-deeplink/mcp/install?name=<nazwa>&config=<base64>`,
 *   gdzie base64 to JSON `{command, args}`; base64 kodujemy jeszcze w URL („+”, „/” i „=” psułyby parametr).
 * - VS Code (code.visualstudio.com/api/extension-guides/ai/mcp, „Create an MCP installation or lookup URL”):
 *   `vscode:mcp/install?<encodeURIComponent(JSON)>`, JSON z nazwą i konfiguracją serwera w formacie VS Code (`type: 'stdio'`);
 *   na stronie w opakowaniu `https://vscode.dev/redirect?url=<link vscode: w URL>` (zalecanym tam dla stron i dokumentacji).
 */

/** Skąd użytkownik bierze serwer: z repozytorium (dziś) albo z paczki npm (po publikacji). */
export type McpStatus = 'repo' | 'npm';

/** Paczki nie ma jeszcze w npm: na `'npm'` dopiero po pierwszej publikacji (razem z README paczki). */
export const MCP_STATUS: McpStatus = 'repo';

/** Nazwa serwera w konfiguracji klientów. */
export const SERVER_NAME = 'hyperquant';
export const NPM_PACKAGE = 'hyperquant-mcp';
export const REPO_URL = 'https://github.com/rdemb/HyperQuant';
/** Katalog repozytorium w przykładach: użytkownik wstawia pełną ścieżkę swojej kopii. */
export const REPO_DIR = '/path/to/HyperQuant';
/** Bundle serwera po `npm run mcp:build`, względem katalogu repozytorium. */
export const BUNDLE_PATH = 'mcp/dist/hyperquant-mcp.mjs';
/** Kroki przed uruchomieniem z repozytorium (Node.js 20 albo nowszy), jak w README paczki. */
export const REPO_STEPS: readonly string[] = [`git clone ${REPO_URL}.git`, 'cd HyperQuant', 'npm ci --legacy-peer-deps', 'npm run mcp:build'];
/** Paczka MCPB dla Claude Desktop, budowana przy wdrożeniu strony (`npm run mcp:mcpb`). */
export const MCPB_URL = './agents/hyperquant.mcpb';

export interface ServerConfig {
  command: string;
  args: string[];
}

/** Polecenie uruchamiające serwer przez STDIO. */
export function serverConfig(status: McpStatus): ServerConfig {
  return status === 'npm' ? { command: 'npx', args: ['-y', NPM_PACKAGE] } : { command: 'node', args: [`${REPO_DIR}/${BUNDLE_PATH}`] };
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
