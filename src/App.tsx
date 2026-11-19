import { DeskProvider } from './state/DeskContext';
import { AppShell } from './shell/AppShell';

export default function App() {
  return (
    <DeskProvider>
      <AppShell />
    </DeskProvider>
  );
}
