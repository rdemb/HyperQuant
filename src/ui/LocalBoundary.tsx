import React from 'react';
import { DASH } from './format';
import { tr } from '../i18n';

interface Props {
  /** Nazwa części strony w komunikacie i w konsoli, np. „Czwórka”. */
  what: string;
  /** Jedna linia (nagłówek układu nad wykresem) zamiast karty. */
  inline?: boolean;
  children: React.ReactNode;
}

/**
 * Lokalna osłona błędu: jeden zły ładunek z zewnątrz (plik skanera, bloga, odpowiedź API) wygasza tylko swoją część strony —
 * „—” z powodem i ponowną próbą — zamiast całej aplikacji (RootErrorBoundary w main.tsx). Błąd w konsoli raz na osłonę.
 */
export class LocalBoundary extends React.Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  private logged = false;

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (this.logged) return;
    this.logged = true;
    console.error(`[HyperQuant] ${this.props.what}: błąd renderowania — ta część wygaszona, reszta strony działa`, error, info.componentStack);
  }

  private retry = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    const { what, inline } = this.props;
    const why = tr('nie udało się pokazać tej części z bieżących danych; reszta strony działa', 'this part could not be shown from the current data; the rest of the page works');
    const button = (
      <button
        type="button"
        onClick={this.retry}
        className="shrink-0 inline-flex items-center h-11 sm:h-7 px-2.5 rounded-lg border border-line text-[11px] font-medium text-ink-2 hover:text-ink-1 hover:bg-surface-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {tr('Spróbuj ponownie', 'Try again')}
      </button>
    );
    if (inline) {
      return (
        <div role="alert" className="shrink-0 flex items-center gap-2 min-w-0 h-11 sm:h-8 px-2 sm:px-3 border-b border-line text-[11.5px] text-ink-3">
          <span className="min-w-0 truncate">{`${what}: ${DASH} ${why}`}</span>
          {button}
        </div>
      );
    }
    return (
      <section role="alert" className="bg-surface-1 border border-line rounded-xl min-w-0 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-ink-2">{`${what}: ${DASH}`}</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
            {tr(
              `Nie udało się pokazać tej części z bieżących danych (np. uszkodzony plik z zewnątrz) — reszta strony działa. Spróbuj ponownie; jeśli błąd wraca, odśwież stronę.`,
              `This part could not be shown from the current data (e.g. a broken external file) — the rest of the page works. Try again; if the error comes back, reload the page.`
            )}
          </p>
        </div>
        {button}
      </section>
    );
  }
}
