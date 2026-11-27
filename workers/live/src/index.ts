import { type Env, LiveTail, handle } from './tail.ts';

/** Wejście Workera: obsługa żądań i klasa obiektu rynku (logika i testy: tail.ts). */
export { LiveTail };
export default {
  fetch: (req: Request, env: Env): Promise<Response> => handle(req, env),
};
