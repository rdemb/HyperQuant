import React, { useEffect, useState } from 'react';
import { DATA_BASE, LEDGER_BASE } from '../../state/usePublished';
import { verifyLedgerRemote, type RemoteVerification } from '../../utils/ledgerVerify';
import { locale, tr } from '../../i18n';

const STORE_KEY = 'hq.ledgerVerify.v1';
const DAY = 86_400_000;
const dateTimeFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

interface Saved extends RemoteVerification {
  at: number;
}

/** Codzienna niezależna weryfikacja w GitHub Actions (gałąź health repo danych) */
interface Daily {
  ok: boolean;
  at: number;
  run: string;
  lines: string[];
}

const isDaily = (x: unknown): x is Daily => {
  const d = x as Partial<Daily> | null;
  return !!d && typeof d.ok === 'boolean' && typeof d.at === 'number' && Number.isFinite(d.at) && typeof d.run === 'string' && /^https:\/\/github\.com\//.test(d.run) && Array.isArray(d.lines);
};

/** Wynik ostatniej weryfikacji z GitHub Actions; null = brak / błąd. */
function useDaily(): Daily | null {
  const [d, setD] = useState<Daily | null>(null);
  useEffect(() => {
    const base = DATA_BASE.replace(/\/main$/, '/health');
    if (!/^https:\/\//.test(base)) return;
    let live = true;
    fetch(`${base}/verify/latest.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((x) => live && isDaily(x) && setD(x))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return d;
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
  const daily = useDaily();
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
          <span className="text-ink-1 font-medium">{tr('Sprawdź sam, w tej przeglądarce', 'Check it yourself, in this browser')}</span>
          {fresh && (
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-wide ${
                saved.ok ? 'text-buy-ink border-buy/40 bg-buy/10' : 'text-warn border-warn/40 bg-warn/10'
              }`}
              title={tr(`Wynik weryfikacji z ${dateTimeFmt.format(saved.at)} — liczonej w tej przeglądarce`, `Verification result from ${dateTimeFmt.format(saved.at)}, computed in this browser`)}
            >
              {saved.ok ? tr('zweryfikowano', 'verified') : tr('problem', 'problem')} · {dateTimeFmt.format(saved.at)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="px-2.5 py-1 rounded-md border border-line-strong text-ink-1 hover:border-accent hover:text-accent disabled:opacity-60 disabled:cursor-wait"
        >
          {running ? tr('Sprawdzam…', 'Checking…') : saved ? tr('Sprawdź ponownie', 'Check again') : tr('Zweryfikuj dziennik', 'Verify the ledger')}
        </button>
      </div>
      {daily && (
        <div className={daily.ok && Date.now() - daily.at < 2 * DAY ? 'text-ink-2' : 'text-warn'}>
          {tr('Niezależna weryfikacja w GitHub Actions (codziennie, infrastruktura GitHuba — nie serwer desku):', 'Independent verification in GitHub Actions (daily, on GitHub infrastructure, not the desk server):')}{' '}
          <span className="text-ink-1">{daily.ok ? tr('zgodna', 'consistent') : tr('wykryła problem', 'found a problem')}</span> · {dateTimeFmt.format(daily.at)} ·{' '}
          <a className="text-accent hover:underline" href={daily.run} target="_blank" rel="noopener noreferrer">
            {tr('przebieg i pełny raport', 'run and full report')}
          </a>
          {Date.now() - daily.at >= 2 * DAY && tr(' (starsza niż 2 dni)', ' (older than 2 days)')}
        </div>
      )}
      {running && progress && <div className="text-ink-3">{progress}</div>}
      {error && <div className="text-warn">{tr('Weryfikacja przerwana', 'Verification aborted')}: {error}</div>}
      {saved && !running && (
        <ul className="space-y-0.5">
          <Check ok={saved.days > 0 && !saved.problems.some((p) => /linia|pobrać|line|fetch/.test(p))}>
            {tr(
              <>
                łańcuch hashy: {saved.lines.toLocaleString(locale)} linii z {saved.days} {saved.days === 1 ? 'dnia' : 'dni'} {saved.fromGenesis ? 'od pierwszej linii (GENESIS)' : '(ostatnie 31 dni — pełna historia: skrypt)'}
              </>,
              <>
                hash chain: {saved.lines.toLocaleString(locale)} lines from {saved.days} {saved.days === 1 ? 'day' : 'days'} {saved.fromGenesis ? 'from the first line (GENESIS)' : '(last 31 days; full history: script)'}
              </>
            )}
          </Check>
          <Check ok={!saved.problems.some((p) => /podsumowani|summary/.test(p))}>{tr('głowa publikowanego podsumowania należy do łańcucha', 'the head of the published summary belongs to the chain')}</Check>
          <Check ok={saved.receipts.checked > 0 && saved.receipts.ok === saved.receipts.checked}>
            {tr('pokwitowania OpenTimestamps ostatnich slotów', 'OpenTimestamps receipts of recent slots')}: {saved.receipts.ok}/{saved.receipts.checked} {tr('zgodnych z hashem ostatniej prognozy', 'match the hash of the last forecast')}
          </Check>
          {saved.preregs.length > 0 && (
            <Check ok={saved.preregs.every((p) => p.ok)}>
              {tr('prerejestracje (katalog laboratorium, plan A/B)', 'pre-registrations (lab catalog, A/B plan)')}: {saved.preregs.map((p) => p.id).join(', ')} — {tr('hash zgodny z treścią', 'hash matches the content')}
            </Check>
          )}
          {saved.problems.length > 0 && <li className="text-warn">{tr('Problemy', 'Problems')}: {saved.problems.slice(0, 5).join('; ')}</li>}
        </ul>
      )}
      <div className="text-ink-3 leading-relaxed">
        {tr(
          'Przeglądarka pobiera pliki dzienne prosto z gałęzi ledger repo danych i sama liczy SHA-256 każdej linii (WebCrypto) — bez udziału serwera desku. Czas zapisu w Bitcoinie, historia git, ceny rozstrzygnięć i przeliczenie wyników: skrypt ',
          'The browser fetches the daily files straight from the ledger branch of the data repo and computes the SHA-256 of every line itself (WebCrypto), without the desk server. Timestamp in Bitcoin, git history, settlement prices and recomputed results: script '
        )}
        <code className="font-mono text-ink-1">verify-ledger.mjs</code>.
      </div>
    </div>
  );
};

const Check: React.FC<{ ok: boolean; children: React.ReactNode }> = ({ ok, children }) => (
  <li className="flex gap-1.5">
    <span className={ok ? 'text-buy-ink' : 'text-warn'} aria-hidden="true">
      {ok ? '✓' : '✗'}
    </span>
    <span className="sr-only">{ok ? tr('zgodne:', 'passed:') : tr('niezgodne:', 'failed:')}</span>
    <span>{children}</span>
  </li>
);
