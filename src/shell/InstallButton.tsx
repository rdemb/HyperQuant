import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, Share, WifiOff, X } from 'lucide-react';
import { Badge, EASE_IN, EASE_OUT } from '../ui';
import { usePwa } from './usePwa';

/**
 * Instalacja PWA: przycisk „Zainstaluj” (Chromium, gdy przeglądarka udostępni zdarzenie),
 * instrukcja dla iOS (Udostępnij → Do ekranu początkowego) oraz znacznik offline.
 * Nic nie pokazuje w trybie standalone (aplikacja już zainstalowana) poza znacznikiem offline.
 */
export const InstallButton: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const { canInstall, isIos, isStandalone, online, install } = usePwa();
  const [iosOpen, setIosOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Zamknięcie instrukcji iOS: klik poza nią lub Escape
  useEffect(() => {
    if (!iosOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setIosOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setIosOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [iosOpen]);

  const offline = !online && (
    <Badge tone="warn" title="Brak połączenia — widzisz ostatnie zapisane dane i powłokę aplikacji" testId="offline-badge">
      <WifiOff className="w-3 h-3" aria-hidden="true" />
      Offline
    </Badge>
  );

  const showIos = isIos && !isStandalone && !canInstall;
  if (isStandalone || (!canInstall && !showIos)) return offline || null;

  const btnClass = compact
    ? 'inline-flex items-center justify-center w-9 h-9 rounded-lg text-ink-2 hover:text-ink-1 hover:bg-surface-2 border border-transparent hover:border-line transition-colors duration-150'
    : 'inline-flex items-center gap-1.5 min-h-11 sm:min-h-9 px-3 rounded-lg text-sm font-medium text-ink-1 bg-surface-2 border border-line hover:bg-surface-3 transition-colors duration-150';

  return (
    <div ref={wrapRef} className="relative flex items-center gap-2">
      {offline}
      <button
        type="button"
        aria-label="Zainstaluj aplikację"
        title="Zainstaluj aplikację"
        aria-expanded={showIos ? iosOpen : undefined}
        onClick={() => (canInstall ? void install() : setIosOpen((o) => !o))}
        className={btnClass}
      >
        <Download className="w-4 h-4" aria-hidden="true" />
        {!compact && <span>Zainstaluj</span>}
      </button>

      <AnimatePresence>
        {iosOpen && (
          <motion.div
            role="dialog"
            aria-label="Instalacja na iPhonie lub iPadzie"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.16, ease: EASE_OUT } }}
            exit={{ opacity: 0, transition: { duration: 0.1, ease: EASE_IN } }}
            className="absolute right-0 top-full mt-2 z-50 w-64 bg-surface-2 border border-line-strong rounded-xl p-3 shadow-2xl text-left"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-medium text-ink-1">Dodaj do ekranu początkowego</div>
              <button
                type="button"
                aria-label="Zamknij"
                onClick={() => setIosOpen(false)}
                className="-mr-1.5 -mt-1.5 inline-flex items-center justify-center w-9 h-9 rounded-lg text-ink-3 hover:text-ink-1"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <ol className="mt-1 space-y-1.5 text-xs text-ink-2 leading-relaxed list-decimal pl-4">
              <li>
                Stuknij <span className="inline-flex items-center gap-1 text-ink-1">Udostępnij <Share className="w-3.5 h-3.5" aria-hidden="true" /></span> na pasku przeglądarki.
              </li>
              <li>
                Wybierz <span className="text-ink-1">Do ekranu początkowego</span>.
              </li>
            </ol>
            <p className="mt-2 text-[11px] text-ink-3">Aplikacja otworzy się na pełnym ekranie, bez paska adresu.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
