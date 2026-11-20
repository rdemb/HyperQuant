import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { chartKeyAction } from '../../charts/pro/chart/shortcuts';
import { resolveHash, subscribeHash } from '../../state/route';

type Mode = 'native' | 'page' | null;
const MODAL = 'dialog[open], [role="dialog"][aria-modal="true"]';

function capturePosition(section: HTMLElement) {
  return {
    left: window.scrollX,
    top: window.scrollY,
    panelTop: Math.max(0, -section.getBoundingClientRect().top),
    regions: Array.from(section.querySelectorAll<HTMLElement>('.dom-grid-scroll, .of-tape-table, .of-ladder, .ml-book-sides'),
      element => ({ element, top: element.scrollTop, left: element.scrollLeft })),
  };
}

export function useOrderFlowFullscreen() {
  const sectionRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<Mode>(null);
  const previous = useRef<Mode>(null);
  const position = useRef<ReturnType<typeof capturePosition> | null>(null);
  const requested = useRef(false);
  const onOrderFlow = useRef(true);

  useEffect(() => {
    const sync = () => {
      const section = sectionRef.current;
      if (section && document.fullscreenElement === section) {
        if (requested.current) setMode('native');
        else void document.exitFullscreen().catch(() => {});
        return;
      }
      if (previous.current !== 'native') return;
      const dialog = requested.current && section?.querySelector<HTMLDialogElement>('dialog[open]');
      if (dialog) {
        // Jeżeli przeglądarka przejmie Esc, zamknij dialog i utrzymaj powiększenie w karcie.
        dialog.close();
        setMode('page');
      } else {
        requested.current = false;
        setMode(null);
      }
    };
    document.addEventListener('fullscreenchange', sync);
    const unsubscribe = subscribeHash(() => {
      onOrderFlow.current = resolveHash(window.location.hash).view === 'orderflow';
      if (onOrderFlow.current) return;
      requested.current = false;
      position.current = null;
      const section = sectionRef.current;
      if (section && document.fullscreenElement === section) void document.exitFullscreen().catch(() => {});
      setMode(null);
    });
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      unsubscribe();
    };
  }, []);

  useLayoutEffect(() => {
    const last = previous.current;
    previous.current = mode;
    const saved = position.current;
    if (!saved) return;
    if (mode && !last) {
      if (sectionRef.current) sectionRef.current.scrollTop = saved.panelTop;
    } else if (!mode && last) {
      position.current = null;
      window.scrollTo({ left: saved.left, top: saved.top, behavior: 'instant' });
      if (document.activeElement === document.body) buttonRef.current?.focus({ preventScroll: true });
      // Zmiana szerokości może najpierw przewinąć drabinkę do wybranej ceny.
      let frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          saved.regions.forEach(({ element, top, left }) => element.scrollTo({ top, left, behavior: 'instant' }));
        });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [mode]);

  const toggle = useCallback(async () => {
    const section = sectionRef.current;
    if (!section || !onOrderFlow.current) return;
    if (document.fullscreenElement === section) {
      requested.current = false;
      try {
        await document.exitFullscreen();
        if (!requested.current && sectionRef.current === section) setMode(null);
      } catch {
        if (onOrderFlow.current && sectionRef.current === section && document.fullscreenElement === section) {
          requested.current = true;
          setMode('native');
        }
      }
      return;
    }
    if (requested.current) {
      requested.current = false;
      setMode(null);
      return;
    }
    if (document.fullscreenElement || document.querySelector(MODAL)) return;
    position.current = capturePosition(section);
    requested.current = true;
    setMode('page');
    if (document.fullscreenEnabled === false || typeof section.requestFullscreen !== 'function' ||
      typeof document.exitFullscreen !== 'function') return;
    try {
      await section.requestFullscreen();
      if ((!onOrderFlow.current || sectionRef.current !== section) && document.fullscreenElement === section) {
        await document.exitFullscreen();
      }
    } catch {
      // Panel wypełnia kartę, jeżeli system odmówi pełnego ekranu.
    }
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!onOrderFlow.current || event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey ||
        document.querySelector(MODAL)) return;
      const exit = mode !== null && event.key === 'Escape';
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('select')) return;
      if (!exit) {
        if (chartKeyAction(event)?.kind !== 'fullscreen') return;
        if (target instanceof HTMLElement &&
          (target.isContentEditable || target.closest('input, textarea, [role="textbox"]'))) return;
      }
      event.preventDefault();
      void toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, toggle]);

  return { sectionRef, buttonRef, mode, toggle };
}
