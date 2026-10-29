import { type Env, cleanup, handle } from './box.ts';

/** Wejście Workera: moduł główny eksportuje wyłącznie obsługę zdarzeń (logika i testy: box.ts). */
export default {
  fetch: (req: Request, env: Env): Promise<Response> => handle(req, env),
  scheduled: (_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): void => ctx.waitUntil(cleanup(env, Date.now())),
};
