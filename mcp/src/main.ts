/**
 * Punkt wejścia `hyperquant-mcp` (STDIO). stdout to wyłącznie protokół MCP: wypisywanie na konsolę idzie na stderr,
 * a strefa czasu procesu jest ustalona (`HQ_TZ`, domyślnie UTC), zanim wykona się kod serwera. Moduły serwera
 * (`./server`, `./sources` i kod `src/`) są importowane dynamicznie, więc ich kod rusza dopiero po tych dwóch krokach.
 * Wyjątek: zewnętrzne zależności z importów statycznych w tych modułach, czyli SDK `@modelcontextprotocol/server` i zod,
 * w jednoplikowym bundlu stają się importami na początku pliku i ładują się wcześniej, przed przekierowaniem konsoli.
 * To nieszkodliwe: przy ładowaniu nic nie wypisują i nie formatują czasu; pilnuje tego test dymny przez prawdziwe stdio
 * (`mcp/scripts/stdio-smoke.mjs`: każda linia stdout to JSON-RPC).
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
