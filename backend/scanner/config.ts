/**
 * Konfiguracja skanera wyłącznie ze zmiennych środowiskowych (plik env istnieje tylko na serwerze).
 * W repo jest jedynie szablon z miejscami do uzupełnienia — żadnych adresów, ścieżek właściciela ani kluczy.
 */

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface ScannerConfig {
  coin: string;
  /** Budżet wag API Hyperliquid na minutę (limit giełdy 1200/min/IP — reszta zostaje dla innych usług) */
  weightPerMin: number;
  stateDir: string;
  outDir: string;
  publishEveryS: number;
  maxAddresses: number;
  /** Ile największych kont z publicznego rankingu dosiewać co 6 h (0 = wyłączone) */
  seedTop: number;
  /** Minimalna wartość konta do zasiewu, USD */
  seedMinUsd: number;
  r2: R2Config | null;
}

type Env = Record<string, string | undefined>;

function intIn(env: Env, key: string, def: number, lo: number, hi: number, errors: string[]): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return def;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < lo || v > hi) errors.push(`${key} musi być liczbą całkowitą w zakresie ${lo}–${hi}`);
  return v;
}

export function loadConfig(env: Env): { ok: true; config: ScannerConfig } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const stateDir = env.HQ_STATE_DIR ?? '';
  const outDir = env.HQ_OUT_DIR ?? '';
  if (!stateDir) errors.push('brak HQ_STATE_DIR (katalog stanu skanera)');
  if (!outDir) errors.push('brak HQ_OUT_DIR (katalog publikowanych plików)');
  const weightPerMin = intIn(env, 'HQ_WEIGHT_PER_MIN', 240, 30, 600, errors);
  const publishEveryS = intIn(env, 'HQ_PUBLISH_EVERY_S', 60, 15, 3600, errors);
  const maxAddresses = intIn(env, 'HQ_MAX_ADDRESSES', 50_000, 100, 500_000, errors);
  const seedTop = intIn(env, 'HQ_SEED_TOP', 5000, 0, 20_000, errors);
  const seedMinUsd = intIn(env, 'HQ_SEED_MIN_USD', 100_000, 0, 1_000_000_000, errors);
  const coin = (env.HQ_COIN ?? 'BTC').trim();
  if (!/^[A-Z0-9]{2,10}$/.test(coin)) errors.push('HQ_COIN: niepoprawny symbol rynku');

  const r2Keys = ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const;
  const present = r2Keys.filter((k) => (env[k] ?? '') !== '');
  let r2: R2Config | null = null;
  if (present.length === r2Keys.length) {
    r2 = {
      accountId: env.R2_ACCOUNT_ID!,
      bucket: env.R2_BUCKET!,
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    };
  } else if (present.length > 0) {
    errors.push(`R2: podaj wszystkie zmienne ${r2Keys.join(', ')} albo żadnej (tryb lokalny)`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: { coin, weightPerMin, stateDir, outDir, publishEveryS, maxAddresses, seedTop, seedMinUsd, r2 } };
}
