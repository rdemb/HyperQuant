/**
 * Odroczone zatwierdzenie wyboru (strzałki w przełączniku, którego zmiana jest kosztowna, np. przebudowa wykresów):
 * każde `push` przesuwa termin o `ms` od nowa, więc przytrzymana strzałka daje jedno wywołanie `run` z ostatnią wartością;
 * `cancel` porzuca oczekujący wybór (kliknięcie zatwierdza od razu, odmontowanie).
 */
export function deferred<T>(ms: number, run: (v: T) => void): { push(v: T): void; cancel(): void } {
  let id: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (id !== undefined) clearTimeout(id);
    id = undefined;
  };
  return {
    push(v: T) {
      cancel();
      id = setTimeout(() => {
        id = undefined;
        run(v);
      }, ms);
    },
    cancel,
  };
}

/** Następna opcja grupy radio po strzałce w prawo albo w lewo (z zawinięciem); inny klawisz albo pusta lista — null. */
export function radioStep<T>(ids: readonly T[], current: T, key: string): T | null {
  if (ids.length === 0 || (key !== 'ArrowRight' && key !== 'ArrowLeft')) return null;
  const i = Math.max(0, ids.indexOf(current));
  return ids[(i + (key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
}

/**
 * Grupa radio z kosztowną zmianą (przełącznik zestawu paneli: zmiana przebudowuje wykresy). Strzałka od razu przenosi
 * zaznaczenie (`setPending`) i fokus (`focus`) na sąsiednie radio, a `change` woła dopiero `ms` po ostatniej strzałce —
 * raz, z ostatnim wyborem; powrót strzałkami na bieżącą wartość niczego nie zmienia. Kliknięcie zatwierdza od razu.
 * `key` zwraca, czy klawisz był strzałką grupy (wtedy widok blokuje domyślną akcję).
 */
export function debouncedRadio(
  ms: number,
  o: { focus: (id: string) => void; change: (id: string) => void; setPending: (id: string | null) => void }
): { key(key: string, ids: readonly string[], value: string): boolean; click(id: string, value: string): void; cancel(): void } {
  let pending: string | null = null;
  const settle = (id: string | null) => {
    pending = id;
    o.setPending(id);
  };
  const commit = deferred<string>(ms, (id) => {
    settle(null);
    o.change(id);
  });
  return {
    key(key, ids, value) {
      const next = radioStep(ids, pending ?? value, key);
      if (next === null) return false;
      settle(next === value ? null : next);
      o.focus(next);
      if (next === value) commit.cancel();
      else commit.push(next);
      return true;
    },
    click(id, value) {
      commit.cancel();
      settle(null);
      if (id !== value) o.change(id);
    },
    cancel: commit.cancel,
  };
}
