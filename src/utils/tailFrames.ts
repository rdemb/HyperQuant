/**
 * Paczka gorących ogonów wielu rynków w jednym żądaniu (skaner → przekaźnik `workers/live`): ramki
 * [długość nazwy u16][nazwa UTF-8][długość treści u32][treść] w kolejności big-endian. Treść każdej ramki to ogon rynku
 * jako JSON w gzip — przekaźnik niczego nie rozpakowuje, tylko rozdziela i oddaje bajty. Jedno żądanie na takt zamiast
 * jednego na rynek mieści przekaźnik w darmowym planie Cloudflare (limit żądań na dobę na konto).
 */

const MAX_NAME = 64;

/** Ramki z par [rynek, bajty]. */
export function encodeTailFrames(entries: readonly (readonly [string, Uint8Array])[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const parts = entries.map(([coin, body]) => [enc.encode(coin), body] as const);
  const size = parts.reduce((n, [name, body]) => n + 2 + name.length + 4 + body.length, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  for (const [name, body] of parts) {
    if (name.length === 0 || name.length > MAX_NAME) throw new Error(`zła nazwa rynku w paczce ogonów (${name.length} B)`);
    view.setUint16(at, name.length);
    out.set(name, at + 2);
    at += 2 + name.length;
    view.setUint32(at, body.length);
    out.set(body, at + 4);
    at += 4 + body.length;
  }
  return out;
}

/** Ramki → pary [rynek, bajty] (widoki na bufor, bez kopiowania); ucięta albo zła paczka — null. */
export function decodeTailFrames(buf: Uint8Array): [string, Uint8Array][] | null {
  const dec = new TextDecoder('utf-8', { fatal: true });
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: [string, Uint8Array][] = [];
  let at = 0;
  try {
    while (at < buf.length) {
      if (at + 2 > buf.length) return null;
      const n = view.getUint16(at);
      if (n === 0 || n > MAX_NAME || at + 2 + n + 4 > buf.length) return null;
      const coin = dec.decode(buf.subarray(at + 2, at + 2 + n));
      at += 2 + n;
      const len = view.getUint32(at);
      if (at + 4 + len > buf.length) return null;
      out.push([coin, buf.subarray(at + 4, at + 4 + len)]);
      at += 4 + len;
    }
  } catch {
    return null;
  }
  return out;
}
