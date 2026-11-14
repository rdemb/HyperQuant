import { Suspense, lazy } from 'react';
import { DeskProvider } from './state/DeskContext';
import { AppShell } from './shell/AppShell';
import type { Interfejs } from './shell/interfejs';

// Nowy wygląd za przełącznikiem ?ui=nowy: osobny pakiet ładowany tylko wtedy (stara powłoka go nie pobiera)
const NowaPowloka = lazy(() => import('./nowy/NowaPowloka'));

/** Korzeń aplikacji: stan desku (dane + analityka) i powłoka z widokami (stara albo nowy wygląd). */
export default function App({ ui = 'stary' }: { ui?: Interfejs }) {
  return (
    <DeskProvider>
      {ui === 'nowy' ? (
        <Suspense fallback={null}>
          <NowaPowloka />
        </Suspense>
      ) : (
        <AppShell />
      )}
    </DeskProvider>
  );
}
