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
