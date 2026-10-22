/**
 * Wspólne klocki symulacji ścieżek: deterministyczny RNG, rozkład normalny, innowacje FHS.
 * Ten sam seed = te same ścieżki (powtarzalne wyniki między odświeżeniami i w testach).
 */

/** Generator Mulberry32 — jednostajny [0, 1). */
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller z buforem drugiej wartości. */
export function normalGen(u: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    const r = Math.sqrt(-2 * Math.log(u() + 1e-300));
    const th = 2 * Math.PI * u();
    spare = r * Math.sin(th);
    return r * Math.cos(th);
  };
}

/**
 * Innowacja kroku: bootstrap ze standaryzowanych reszt (FHS — empiryczne ogony i skoki)
 * albo N(0, 1), gdy reszt brak.
 */
export function makeInnovation(u: () => number, residuals: ArrayLike<number> | null): () => number {
  if (!residuals || residuals.length === 0) return normalGen(u);
  const n = residuals.length;
  return () => residuals[Math.min(n - 1, Math.floor(u() * n))];
}

/** Ziarno z liczb wejściowych (FNV-1a na zaokrąglonych wartościach) — stabilne dla tych samych wejść. */
export function seedFrom(...xs: number[]): number {
  let h = 0x811c9dc5;
  for (const x of xs) {
    const v = Math.round(Number.isFinite(x) ? x : 0);
    for (let k = 0; k < 4; k++) {
      h ^= (v >>> (k * 8)) & 0xff;
      h = Math.imul(h, 0x01000193);
    }
    h ^= v < 0 ? 0x9e : 0x37;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
