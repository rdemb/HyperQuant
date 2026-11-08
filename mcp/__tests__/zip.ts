/**
 * Odczyt archiwum ZIP w testach, niezależny od skryptu, który je zapisuje: koniec katalogu centralnego, wpisy katalogu,
 * nagłówki lokalne zgodne z katalogiem, rozpakowanie (deflate albo bez kompresji) i suma CRC-32 z `node:zlib`.
 * Każda niezgodność to wyjątek z powodem.
 */
import { crc32, inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  data: Buffer;
  /** 0 — bez kompresji, 8 — deflate. */
  method: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export function readZip(buf: Buffer): ZipEntry[] {
  // Koniec katalogu centralnego: od końca pliku (komentarz archiwum do 64 KiB)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip: brak końca katalogu centralnego');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt16LE(eocd + 8) !== count) throw new Error('zip: archiwum wieloczęściowe');

  const out: ZipEntry[] = [];
  let p = cdOffset;
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== CENTRAL) throw new Error(`zip: zły wpis katalogu centralnego nr ${k}`);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (flags & 0x0001) throw new Error(`zip: zaszyfrowany wpis ${name}`);
    if (flags & 0x0008) throw new Error(`zip: deskryptor danych po wpisie ${name}`);

    if (buf.readUInt32LE(local) !== LOCAL) throw new Error(`zip: brak nagłówka lokalnego ${name}`);
    const lnlen = buf.readUInt16LE(local + 26);
    const lelen = buf.readUInt16LE(local + 28);
    if (buf.toString('utf8', local + 30, local + 30 + lnlen) !== name) throw new Error(`zip: inna nazwa w nagłówku lokalnym ${name}`);
    if (buf.readUInt16LE(local + 8) !== method || buf.readUInt32LE(local + 14) !== crc || buf.readUInt32LE(local + 18) !== csize || buf.readUInt32LE(local + 22) !== usize) {
      throw new Error(`zip: nagłówek lokalny niezgodny z katalogiem ${name}`);
    }
    const start = local + 30 + lnlen + lelen;
    const raw = buf.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`zip: nieznana metoda ${method} (${name})`);
    if (data.length !== usize) throw new Error(`zip: zły rozmiar ${name}`);
    if (crc32(data) !== crc) throw new Error(`zip: zła suma CRC-32 ${name}`);
    out.push({ name, data, method });
    p += 46 + nlen + elen + clen;
  }
  if (p !== cdOffset + cdSize) throw new Error('zip: rozmiar katalogu centralnego niezgodny z wpisami');
  return out;
}
