/**
 * Punkt wejścia `hyperquant-mcp` (STDIO). stdout to wyłącznie protokół MCP: zanim załaduje się reszta kodu, wypisywanie
 * na konsolę idzie na stderr, a strefa czasu procesu jest ustalona (`HQ_TZ`, domyślnie UTC). Dlatego moduły serwera
 * są importowane dynamicznie, dopiero po tych dwóch krokach.
 */
for (const k of ['log', 'info', 'debug', 'dir', 'table'] as const) console[k] = console.error.bind(console);
process.env.TZ = process.env.HQ_TZ ?? 'UTC';

try {
  const { StdioServerTransport } = await import('@modelcontextprotocol/server/stdio');
  const { createServer } = await import('./server');
  const { Sources, configFromEnv } = await import('./sources');
  const server = createServer(new Sources(configFromEnv(process.env, fetch)));
  await server.connect(new StdioServerTransport());
} catch (e) {
  console.error(`hyperquant-mcp: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
