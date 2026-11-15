import React, { Suspense, lazy, useEffect, useState } from 'react';
import { MODEL_CARD_EVENT, type ModelCardRequest } from '../ui/modelCard';

const KartaModelu = lazy(() => import('./KartaModelu'));

/** Odbiera prośby plakietek MODEL (`openModelCard`) i pokazuje jedną kartę naraz; moduł karty ładuje się przy pierwszej. */
export const KartaModeluHost: React.FC = () => {
  const [req, setReq] = useState<ModelCardRequest | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<ModelCardRequest>).detail;
      // Drugie kliknięcie tej samej plakietki zamyka kartę
      setReq((cur) => (cur && cur.anchor === d.anchor ? null : d));
    };
    window.addEventListener(MODEL_CARD_EVENT, on);
    return () => window.removeEventListener(MODEL_CARD_EVENT, on);
  }, []);
  if (!req) return null;
  return (
    <Suspense fallback={null}>
      <KartaModelu key={`${req.id}`} id={req.id} anchor={req.anchor} onClose={() => setReq(null)} />
    </Suspense>
  );
};
