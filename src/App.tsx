import { MotionConfig } from 'motion/react';
import { DeskProvider } from './state/DeskContext';
import { AppShell } from './shell/AppShell';

export default function App() {
  return (
    <MotionConfig reducedMotion={document.documentElement.dataset.motion === 'reduced' ? 'always' : 'user'}>
      <DeskProvider>
        <AppShell />
      </DeskProvider>
    </MotionConfig>
  );
}
