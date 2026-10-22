/**
 * Zasiew skanera największymi kontami z publicznego rankingu Hyperliquid (stats-data, ~40 MB JSON).
 * Duzi gracze trzymają większość open interest, a rzadko pojawiają się na taśmie — bez zasiewu mapa długo by ich nie widziała.
 * Adresy zostają wyłącznie na serwerze. Parsowanie wyrażeniem regularnym zamiast JSON.parse: bez budowania ~50 tys. obiektów
 * (zmieści się w limicie pamięci usługi).
 */

export const LEADERBOARD_URL = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';

const ROW = /"ethAddress":\s*"(0x[0-9a-fA-F]{40})",\s*"accountValue":\s*"([0-9.eE+-]+)"/g;

export function extractLeaderboardAccounts(text: string, minAccountValue: number, limit: number): { address: string; accountValue: number }[] {
  const out: { address: string; accountValue: number }[] = [];
  for (const m of text.matchAll(ROW)) {
    const v = Number(m[2]);
    if (Number.isFinite(v) && v >= minAccountValue) out.push({ address: m[1].toLowerCase(), accountValue: v });
  }
  out.sort((a, b) => b.accountValue - a.accountValue);
  return out.slice(0, limit);
}

/** Pobiera ranking (timeout 60 s); błąd → pusta lista. */
export async function fetchLeaderboardAccounts(
  minAccountValue: number,
  limit: number,
  fetchFn: typeof fetch = fetch
): Promise<{ address: string; accountValue: number }[]> {
  try {
    const res = await fetchFn(LEADERBOARD_URL, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return [];
    return extractLeaderboardAccounts(await res.text(), minAccountValue, limit);
  } catch {
    return [];
  }
}
