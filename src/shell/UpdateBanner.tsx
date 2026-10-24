import React, { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { RefreshCw } from 'lucide-react';
import { DUR, EASE_IN, EASE_OUT } from '../ui';
import { usePwa } from './usePwa';
import { tr } from '../i18n';

/** Baner „Dostępna nowa wersja” — pojawia się, gdy nowy service worker czeka na aktywację. */
export const UpdateBanner: React.FC = () => {
  const { updateReady, applyUpdate } = usePwa();
  const [dismissed, setDismissed] = useState(false);
  const reduce = useReducedMotion();
  const show = updateReady && !dismissed;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: reduce ? 0 : 8 }}
          animate={{ opacity: 1, y: 0, transition: { duration: DUR.ui, ease: EASE_OUT } }}
          exit={{ opacity: 0, transition: { duration: DUR.uiExit, ease: EASE_IN } }}
          className="fixed z-50 left-4 right-4 bottom-20 sm:left-auto sm:right-6 lg:bottom-6 sm:w-[420px] mb-[env(safe-area-inset-bottom,0px)] bg-surface-2 border border-line-strong rounded-xl shadow-2xl p-3 flex items-center gap-3"
        >
          <RefreshCw className="w-4 h-4 text-accent shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-ink-1">{tr('Dostępna nowa wersja', 'New version available')}</div>
            <div className="text-xs text-ink-3">{tr('Odśwież, aby wczytać aktualizację desku.', 'Reload to load the Desk update.')}</div>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="min-h-11 sm:min-h-9 px-2.5 rounded-lg text-xs font-medium text-ink-2 hover:text-ink-1"
          >
            {tr('Później', 'Later')}
          </button>
          <button
            type="button"
            onClick={applyUpdate}
            className="min-h-11 sm:min-h-9 px-3 rounded-lg text-xs font-semibold bg-accent text-page hover:brightness-110 transition-[filter] duration-150"
          >
            {tr('Odśwież', 'Reload')}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
