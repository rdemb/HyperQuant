#!/usr/bin/env node
// Build strony do pomiaru układu (`npm run ui:check`): `vite build` z adresem danych skanera na hoście bez sieci
// (`DATA_BASE_URL` z fixtures.mjs). Strona pyta wtedy o rejestr rynków (`markets.json`), który `layout-check.mjs` podaje
// z danych stałych w przebiegu rynków (xyz:NVDA); pozostałe pliki danych — błąd jak bez połączenia. Zmienna środowiska
// ma pierwszeństwo przed plikami .env, więc lokalny adres danych nie zmienia pomiaru.
// Po lokalnym `npm run ui:check` katalog `dist` ma ten sztuczny adres danych; nie wdrażaj go ręcznie (strona idzie
// wyłącznie przez GitHub Actions, które budują ją od nowa z prawdziwym adresem).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { DATA_BASE_URL } from './fixtures.mjs';

const r = spawnSync(process.execPath, [path.resolve('node_modules/vite/bin/vite.js'), 'build'], { stdio: 'inherit', env: { ...process.env, VITE_DATA_BASE_URL: DATA_BASE_URL } });
process.exit(r.status ?? 1);
