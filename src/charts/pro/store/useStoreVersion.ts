import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { ProStore } from './proStore';

/** Odświeżanie widoku z magazynu — najwyżej co `ms` (taśma bywa bardzo szybka). */
export function useStoreVersion(store: ProStore, ms: number): number {
  const ref = useRef({ version: store.version, last: 0, timer: 0 as ReturnType<typeof setTimeout> | 0 });
  const subscribe = useCallback(
    (notify: () => void) => {
      const st = ref.current;
      const unsub = store.subscribe(() => {
        if (st.timer) return;
        const wait = Math.max(0, st.last + ms - Date.now());
        st.timer = setTimeout(() => {
          st.timer = 0;
          st.last = Date.now();
          st.version = store.version;
          notify();
        }, wait);
      });
      return () => {
        unsub();
        if (st.timer) clearTimeout(st.timer);
        st.timer = 0;
      };
    },
    [store, ms]
  );
  return useSyncExternalStore(subscribe, () => ref.current.version);
}
