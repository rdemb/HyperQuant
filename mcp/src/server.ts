/**
 * Serwer MCP HyperQuant: rejestruje każde narzędzie z `TOOLS`. Wynik narzędzia przechodzi `toToolResult` (bezpieczniki
 * treści), a wyjątek w narzędziu kończy się odpowiedzią `isError` z krótkim komunikatem, nie zerwaniem połączenia.
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { tr } from '../../src/i18n';
import { blocked, guardedCut, toToolResult } from './envelope';
import type { Sources } from './sources';
import { TOOLS, type ToolDef } from './tools/index';

const MSG_MAX = 200;

/**
 * Komunikat wyjątku do 200 znaków; bezpieczniki na pełnym komunikacie przed przycięciem (`guardedCut`), więc adres
 * albo rada (np. cytat obcego JSON-a) nie przejdzie ucięta — zostaje sam znacznik blokady.
 */
function toolError(e: unknown): string {
  return `błąd narzędzia / tool error: ${guardedCut(e instanceof Error ? e.message : String(e), MSG_MAX)}`;
}

async function call(t: ToolDef, src: Sources, args: unknown): Promise<CallToolResult> {
  try {
    return toToolResult(await t.run(src, args));
  } catch (e) {
    const why = toolError(e);
    // stderr: dziennik klienta MCP (stdout to protokół)
    console.error(`hyperquant-mcp ${t.name}: ${why}`);
    return blocked(t.name, why);
  }
}

export function createServer(src: Sources): McpServer {
  const server = new McpServer(
    { name: 'hyperquant-mcp', version: src.cfg.version },
    {
      instructions: tr(
        'HyperQuant: kontekst rynku BTC z danych publicznych (blog HyperQuant, Hyperliquid, pliki skanera). Każda liczba ma oznaczenie LIVE, MODEL albo SIM, czas i źródło; brak danych to null z powodem. Opis rynku, nie porada inwestycyjna.',
        'HyperQuant: BTC market context from public data (the HyperQuant blog, Hyperliquid, scanner files). Every number carries a LIVE, MODEL or SIM badge, a time and a source; missing data is null with a reason. Market description, not investment advice.'
      ),
    }
  );
  // Tylko odczyt danych publicznych z sieci: podpowiedź dla klienta (np. bez pytania o zgodę na zapis)
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  for (const t of TOOLS) {
    const meta = { title: t.title, description: t.description, annotations };
    if (t.input) server.registerTool(t.name, { ...meta, inputSchema: t.input }, (args) => call(t, src, args));
    else server.registerTool(t.name, meta, () => call(t, src, {}));
  }
  return server;
}
