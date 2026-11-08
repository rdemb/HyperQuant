#!/usr/bin/env node
/**
 * Test dymny serwera MCP przez prawdziwe stdio: uruchamia `node <bundle>`, wysyła `initialize` (protokół 2025-11-25)
 * i `tools/list`, bez wywołania żadnego narzędzia (bez sieci). Kod 0 tylko wtedy, gdy w ciągu 10 s:
 * - każda linia stdout serwera to wiadomość JSON-RPC 2.0 (jedno `console.log` w imporcie psuje klienta MCP);
 * - serwer odsyła wersję protokołu (tę samą albo wynegocjowaną);
 * - lista narzędzi to dokładnie 10 nazw poniżej.
 * Użycie: node mcp/scripts/stdio-smoke.mjs mcp/dist/hyperquant-mcp.mjs
 */
import { spawn } from 'node:child_process';

const PROTOCOL = '2025-11-25';
const TOOLS = ['day_map', 'session_context', 'session_review', 'liquidation_map', 'liquidation_tape', 'cohort_flow', 'whales', 'twaps', 'forecast_ledger', 'market_brief'];
const LIMIT_MS = 10_000;
/** Po liście narzędzi tyle czekamy na ewentualne spóźnione wypisy na stdout. */
const SETTLE_MS = 300;

const bundle = process.argv[2];
if (!bundle) {
  console.error('usage: node mcp/scripts/stdio-smoke.mjs <bundle.mjs>');
  process.exit(2);
}

const child = spawn(process.execPath, [bundle], { stdio: ['pipe', 'pipe', 'pipe'] });
// Zapis do zamkniętego wejścia (serwer już padł): powód podaje zdarzenie `exit`
child.stdin.on('error', () => undefined);
let stderr = '';
let buffer = '';
let done = false;
let protocol = null;
const pending = new Map();
const timer = setTimeout(() => finish(1, `no complete answer within ${LIMIT_MS / 1000} s`), LIMIT_MS);

function finish(code, message) {
  if (done) return;
  done = true;
  clearTimeout(timer);
  child.kill();
  if (code === 0) console.log(message);
  else console.error(`stdio smoke: ${message}${stderr ? `\n--- server stderr ---\n${stderr.slice(-2000)}` : ''}`);
  process.exitCode = code;
}

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

/** Żądanie z identyfikatorem; odpowiedź trafia do `onReply`. */
function request(id, method, params, onReply) {
  pending.set(id, onReply);
  send({ jsonrpc: '2.0', id, method, params });
}

const isRpc = (m) =>
  typeof m === 'object' &&
  m !== null &&
  !Array.isArray(m) &&
  m.jsonrpc === '2.0' &&
  (typeof m.method === 'string' || ('id' in m && ('result' in m || 'error' in m)));

function onLine(line) {
  if (line.trim() === '') return;
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    finish(1, `stdout line is not JSON-RPC 2.0: ${JSON.stringify(line.slice(0, 120))}`);
    return;
  }
  if (!isRpc(m)) {
    finish(1, `stdout line is not JSON-RPC 2.0: ${JSON.stringify(line.slice(0, 120))}`);
    return;
  }
  const onReply = 'id' in m ? pending.get(m.id) : undefined;
  if (!onReply) return;
  pending.delete(m.id);
  if (m.error) {
    finish(1, `request ${m.id} failed: ${JSON.stringify(m.error).slice(0, 200)}`);
    return;
  }
  onReply(m.result);
}

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let i;
  while (!done && (i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i).replace(/\r$/, '');
    buffer = buffer.slice(i + 1);
    onLine(line);
  }
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});
child.on('error', (e) => finish(1, `cannot start the server: ${e.message}`));
child.on('exit', (code, signal) => {
  if (!done) finish(1, `the server exited early (code ${code}, signal ${signal})`);
});

const names = [];
function listTools(cursor) {
  request(2 + names.length, 'tools/list', cursor ? { cursor } : {}, (result) => {
    if (!result || !Array.isArray(result.tools)) {
      finish(1, 'tools/list: no tools array');
      return;
    }
    for (const t of result.tools) names.push(t?.name);
    if (typeof result.nextCursor === 'string' && result.nextCursor !== '') {
      listTools(result.nextCursor);
      return;
    }
    const got = [...names].sort();
    const want = [...TOOLS].sort();
    if (got.length !== want.length || got.some((n, k) => n !== want[k])) {
      finish(1, `tools/list: expected ${want.length} tools [${want.join(', ')}], got ${got.length} [${got.join(', ')}]`);
      return;
    }
    // Spóźniony wypis na stdout po odpowiedzi też łamie protokół: chwila na jego wychwycenie
    setTimeout(() => {
      if (buffer.trim() !== '') finish(1, `stdout line is not JSON-RPC 2.0: ${JSON.stringify(buffer.slice(0, 120))}`);
      else finish(0, `ok: protocol ${protocol}, ${got.length} tools (${TOOLS.join(', ')}), every stdout line is JSON-RPC 2.0`);
    }, SETTLE_MS);
  });
}

request(1, 'initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'hyperquant-stdio-smoke', version: '0.0.0' } }, (result) => {
  // Serwer odsyła żądaną wersję albo inną, którą obsługuje (negocjacja); brak wersji to błąd
  if (!result || typeof result.protocolVersion !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(result.protocolVersion)) {
    finish(1, `initialize: no protocol version in ${JSON.stringify(result).slice(0, 200)}`);
    return;
  }
  protocol = result.protocolVersion;
  if (protocol !== PROTOCOL) console.error(`stdio smoke: requested protocol ${PROTOCOL}, the server negotiated ${protocol}`);
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  listTools();
});
