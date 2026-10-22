import React, { useEffect, useState } from 'react';
import { DATA_BASE, LEDGER_BASE } from '../../state/usePublished';
import { verifyLedgerRemote, type RemoteVerification } from '../../utils/ledgerVerify';

const STORE_KEY = 'hq.ledgerVerify.v1';
const DAY = 86_400_000;
const dateTimeFmt = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

interface Saved extends RemoteVerification {
  at: number;
}

/** <konto>/<repo> z adresu surowych plików GitHuba; null = inne źródło danych (weryfikacja niedostępna). */
function repoOf(base: string): string | null {
  const m = base.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/[^/]+$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

function load(): Saved | null {
  try {
    const x = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Saved | null;
    return x && typeof x.at === 'number' && typeof x.ok === 'boolean' ? x : null;
  } catch {
    return null;
  }
}

function save(v: Saved): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(v));
  } catch {
    // tryb prywatny / zablokowany magazyn — wynik tylko na ekranie
  }
}

/**
 * Weryfikacja dziennika jednym kliknięciem — w przeglądarce czytelnika (WebCrypto), bez zaufania do serwera desku:
 * pliki prosto z gałęzi ledger repo danych, łańcuch hashy, głowa z podsumowania, pokwitowania ostatnich slotów,
 * prerejestracje. Wynik zapamiętany lokalnie (znaczek „zweryfikowano w tej przeglądarce” przez 24 h).
 */
export const LedgerVerifyCard: React.FC<{ summaryHead: string }> = ({ summaryHead }) => {
  const repo = repoOf(DATA_BASE);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setSaved(load()), []);
  if (!repo) return null;

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await verifyLedgerRemote({ ledgerBase: LEDGER_BASE, repo, summaryHead, onProgress: setProgress, maxDays: 31 });
      const v = { ...r, at: Date.now() };
      setSaved(v);
      save(v);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setProgress('');
    }
  };

  const fresh = saved && Date.now() - saved.at < DAY;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-2/50 px-3 py-2.5 text-xs text-ink-2" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-ink-1 font-medium">Sprawdź sam, w tej przeglądarce</span>
          {fresh && (
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-wide ${
                saved.ok ? 'text-buy-ink border-buy/40 bg-buy/10' : 'text-warn border-warn/40 bg-warn/10'
              }`}
              title={`Wynik weryfikacji z ${dateTimeFmt.format(saved.at)} — liczonej w tej przeglądarce`}
            >
              {saved.ok ? 'zweryfikowano' : 'problem'} · {dateTimeFmt.format(saved.at)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="px-2.5 py-1 rounded-md border border-line-strong text-ink-1 hover:border-accent hover:text-accent disabled:opacity-60 disabled:cursor-wait"
        >
          {running ? 'Sprawdzam…' : saved ? 'Sprawdź ponownie' : 'Zweryfikuj dziennik'}
        </button>
      </div>
      {running && progress && <div className="text-ink-3">{progress}</div>}
      {error && <div className="text-warn">Weryfikacja przerwana: {error}</div>}
      {saved && !running && (
        <ul className="space-y-0.5">
          <Check ok={saved.days > 0 && !saved.problems.some((p) => /linia|pobrać/.test(p))}>
            łańcuch hashy: {saved.lines.toLocaleString('pl-PL')} linii z {saved.days} {saved.days === 1 ? 'dnia' : 'dni'} {saved.fromGenesis ? 'od pierwszej linii (GENESIS)' : '(ostatnie 31 dni — pełna historia: skrypt)'}
          </Check>
          <Check ok={!saved.problems.some((p) => /podsumowani/.test(p))}>głowa publikowanego podsumowania należy do łańcucha</Check>
          <Check ok={saved.receipts.checked > 0 && saved.receipts.ok === saved.receipts.checked}>
            pokwitowania OpenTimestamps ostatnich slotów: {saved.receipts.ok}/{saved.receipts.checked} zgodnych z hashem ostatniej prognozy
          </Check>
          {saved.preregs.length > 0 && (
            <Check ok={saved.preregs.every((p) => p.ok)}>prerejestracje katalogów: {saved.preregs.map((p) => p.id).join(', ')} — hash zgodny z treścią</Check>
          )}
          {saved.problems.length > 0 && <li className="text-warn">Problemy: {saved.problems.slice(0, 5).join('; ')}</li>}
        </ul>
      )}
      <div className="text-ink-3 leading-relaxed">
        Przeglądarka pobiera pliki dzienne prosto z gałęzi ledger repo danych i sama liczy SHA-256 każdej linii (WebCrypto) — bez udziału serwera desku.
        Czas zapisu w Bitcoinie, historia git, ceny rozstrzygnięć i przeliczenie wyników: skrypt <code className="font-mono text-ink-1">verify-ledger.mjs</code>.
      </div>
    </div>
  );
};

const Check: React.FC<{ ok: boolean; children: React.ReactNode }> = ({ ok, children }) => (
  <li className="flex gap-1.5">
    <span className={ok ? 'text-buy-ink' : 'text-warn'} aria-hidden="true">
      {ok ? '✓' : '✗'}
    </span>
    <span className="sr-only">{ok ? 'zgodne:' : 'niezgodne:'}</span>
    <span>{children}</span>
  </li>
);
