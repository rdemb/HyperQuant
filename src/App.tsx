import { lazy, Suspense } from 'react';
import { DeskProvider, useDesk } from './state/DeskContext';
import { AppShell } from './shell/AppShell';
import { tr } from './i18n';

const OrderFlowView = lazy(() => import('./views/flow/OrderFlowView'));

function DeskScreen() {
  const { view } = useDesk();
  if (view !== 'orderflow') return <AppShell />;
  return (
    <Suspense fallback={<p role="status" className="p-5">{tr('Otwieram Order Flow…', 'Opening Order Flow…')}</p>}>
      <OrderFlowView />
    </Suspense>
  );
}

export default function App() {
  return (
    <DeskProvider>
      <DeskScreen />
    </DeskProvider>
  );
}
