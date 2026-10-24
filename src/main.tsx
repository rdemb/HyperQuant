import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { lang, tr } from './i18n';
import { UpdateBanner } from './shell/UpdateBanner';
import { registerServiceWorker } from './shell/usePwa';
import './index.css';

// Osłona reconcilera React 19 przed zmianami DOM z zewnątrz (tłumacz Google, rozszerzenia).
// Każde odstępstwo jest logowane — nie połykamy błędów po cichu.
if (typeof Node === 'function' && Node.prototype) {
  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(child: T): T {
    if (child.parentNode !== this) {
      console.error('[HyperQuant] removeChild: węzeł nie jest dzieckiem tego rodzica (DOM zmieniony z zewnątrz?) — pominięto.', {
        parent: this,
        child,
      });
      return child;
    }
    return originalRemoveChild.call(this, child) as T;
  };

  const originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(newNode: T, referenceNode: Node | null): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      console.error('[HyperQuant] insertBefore: węzeł odniesienia ma innego rodzica (DOM zmieniony z zewnątrz?) — dopinam na końcu.', {
        parent: this,
        newNode,
        referenceNode,
      });
      // Nie gubimy węzła: dopięcie na końcu zamiast cichego porzucenia
      return this.appendChild(newNode);
    }
    return originalInsertBefore.call(this, newNode, referenceNode) as T;
  };
}

class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[HyperQuant] Błąd renderowania', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="min-h-dvh bg-page text-ink-1 flex items-center justify-center p-4">
        <div role="alert" className="max-w-md w-full bg-surface-1 border border-line-strong rounded-xl p-5 space-y-3">
          <h1 className="font-display text-lg font-semibold text-ink-1">{tr('Coś poszło nie tak', 'Something went wrong')}</h1>
          <p className="text-sm text-ink-2 leading-relaxed">
            {tr(
              'Interfejs napotkał nieoczekiwany błąd i został zatrzymany. Odśwież stronę. Jeśli błąd wraca, a masz włączony tłumacz strony lub rozszerzenia modyfikujące stronę, spróbuj bez nich.',
              'The interface hit an unexpected error and was stopped. Reload the page. If the error comes back and you use a page translator or extensions that modify the page, try without them.'
            )}
          </p>
          <details className="text-xs text-ink-3">
            <summary className="cursor-pointer text-ink-2">{tr('Szczegóły błędu', 'Error details')}</summary>
            <pre className="mt-2 p-2 bg-page border border-line rounded-lg font-mono whitespace-pre-wrap break-words text-ink-2">
              {error.name}: {error.message || tr('brak opisu', 'no description')}
            </pre>
          </details>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-11 px-4 rounded-lg text-sm font-semibold bg-accent text-page hover:brightness-110 transition-[filter] duration-150"
          >
            {tr('Odśwież stronę', 'Reload page')}
          </button>
        </div>
      </div>
    );
  }
}

document.documentElement.lang = lang;

createRoot(document.getElementById('root')!).render(
  <RootErrorBoundary>
    <App />
    <UpdateBanner />
  </RootErrorBoundary>
);

// Service worker tylko w buildzie produkcyjnym (w dev przeszkadzałby HMR)
if (import.meta.env.PROD) registerServiceWorker();
