import { DeskProvider } from './state/DeskContext';
import { AppShell } from './shell/AppShell';

/** Korzeń aplikacji: stan desku (dane + analityka) i powłoka z widokami. */
export default function App() {
  return (
    <DeskProvider>
      <AppShell />
    </DeskProvider>
  );
}
