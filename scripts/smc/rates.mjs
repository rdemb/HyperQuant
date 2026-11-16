// @ts-check
/**
 * Częstości bazowe wskaźnika „Struktura i płynność (SMC+HL)” (etap S2): pliki Backtestera `{5m,15m,1h,4h,1d}.json`
 * i `kontrola-zmiennosci.json` (folder `smc-czestosci`) → jeden zwięzły plik `src/charts/pro/data/smcRates.json`, który
 * aplikacja tylko czyta. Bierzemy wyłącznie okres sprawdzianu (`sprawdzian_2024`, poza próbą uczenia), miary pokazywane
 * w legendzie i zaokrąglenie: odsetki i punkty procentowe do 0,1, ruch w ATR do 0,01 (0,1 ATR to za mało przy różnicach
 * rzędu 0,25 ATR). Dla BOS na skali swingowej i sweepu wynik wobec kontroli dopasowanej do zmienności i pędu tam, gdzie
 * jest (Pionier, smc-hl.md §8), inaczej wobec zwykłej. Wniosek z przedziału 95% przed zaokrągleniem: przedział
 * obejmujący 0 to „bez wyraźnej różnicy”.
 *
 * Uruchomienie: node scripts/smc/rates.mjs <folder smc-czestosci> [--date RRRR-MM-DD]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const INTERVALS = /** @type {const} */ (['5m', '15m', '1h', '4h', '1d']);

/** Miary pokazywane w legendzie: [element, miara, jednostka]. */
export const MEASURES = /** @type {const} */ ([
  ['FVG', 'ce_24', 'pct'],
  ['FVG', 'fill_24', 'pct'],
  ['BOS_swing', 'dalszy_ruch_ATR', 'atr'],
  ['BOS_swing', 'powrot_24', 'pct'],
  ['CHoCH_swing', 'dalszy_ruch_ATR', 'atr'],
  ['CHoCH_swing', 'powrot_24', 'pct'],
  ['BOS_internal', 'dalszy_ruch_ATR', 'atr'],
  ['BOS_internal', 'powrot_24', 'pct'],
  ['CHoCH_internal', 'dalszy_ruch_ATR', 'atr'],
  ['CHoCH_internal', 'powrot_24', 'pct'],
  ['sweep', 'ponowne_wyjscie_24', 'pct'],
  ['EQH_EQL', 'sweep_lub_przelamanie_72', 'pct'],
]);

/** Klucze pliku kontroli dopasowanej → klucz miary. */
const MATCHED = /** @type {Record<string, string>} */ ({
  BOS_swing_dalszy_ruch_ATR: 'BOS_swing.dalszy_ruch_ATR',
  BOS_swing_powrot_24_proc: 'BOS_swing.powrot_24',
  sweep_ponowne_wyjscie_24_proc: 'sweep.ponowne_wyjscie_24',
});

/**
 * Zaokrąglenie połówek od zera (0,25 do 0,3), bez „−0”.
 * @param {number} x
 * @param {number} digits
 */
export function round(x, digits) {
  const k = 10 ** digits;
  const r = (Math.sign(x) * Math.round(Math.abs(x) * k + 1e-9)) / k;
  return r === 0 ? 0 : r;
}

/**
 * Wniosek z przedziału 95%: 1 (element wyżej), −1 (niżej), 0 (przedział obejmuje 0).
 * @param {number} lo
 * @param {number} hi
 */
export const verdict = (lo, hi) => (lo > 0 ? 1 : hi < 0 ? -1 : 0);

/** @type {Record<string, number>} */
const WNIOSEK = { 'element wyżej niż kontrola': 1, 'element niżej niż kontrola': -1, 'brak różnicy': 0 };

/**
 * Jedna miara: { n, v, c, d, ci, z } (+ amb: odsetek niejednoznacznych na 1m pominiętych w n, m: 1 — kontrola
 * dopasowana). Miara z samym n (Backtester podaje tylko n przy n < 10) zostaje z samym n.
 * @param {any} src
 * @param {'pct' | 'atr'} unit
 * @returns {Record<string, any>}
 */
function measure(src, unit, matched = false) {
  const dg = unit === 'atr' ? 2 : 1;
  const v = matched ? src.element : src.wartosc;
  if (typeof v !== 'number') return { n: src.n };
  const c = matched ? src.kontrola_dopasowana : src.kontrola;
  const d = matched ? src.roznica_dopasowana : src.roznica;
  const [lo, hi] = matched ? src.roznica_dopasowana_95 : src.roznica_95;
  return { n: src.n, v: round(v, dg), c: round(c, dg), d: round(d, dg), ci: [round(lo, dg), round(hi, dg)], z: verdict(lo, hi) };
}

/**
 * @param {Record<string, any>} files pliki interwałów (klucz: 5m, 15m, 1h, 4h, 1d)
 * @param {any} matched plik kontroli dopasowanej
 * @param {string} generated data wygenerowania (RRRR-MM-DD)
 * @param {(msg: string) => void} [warn]
 */
export function buildRates(files, matched, generated, warn = () => {}) {
  const first = files['5m'];
  const interwaly = /** @type {Record<string, Record<string, any>>} */ ({});
  for (const tf of INTERVALS) {
    const f = files[tf];
    if (!f) throw new Error(`brak pliku ${tf}.json`);
    if (f.interwal !== tf) throw new Error(`${tf}.json: interwał w pliku ${f.interwal}`);
    const s = f.okresy?.sprawdzian_2024;
    if (!s) throw new Error(`${tf}.json: brak okresu sprawdzian_2024`);
    const out = /** @type {Record<string, any>} */ ({});
    for (const [el, m, unit] of MEASURES) {
      const src = s[el]?.[m];
      if (!src) throw new Error(`${tf}.json: brak miary ${el}.${m}`);
      const x = measure(src, unit);
      if ('z' in x && src.wniosek in WNIOSEK && WNIOSEK[src.wniosek] !== x.z)
        warn(`${tf} ${el}.${m}: wniosek Backtestera „${src.wniosek}”, przedział [${src.roznica_95}] → ${x.z} (zostaje przedział)`);
      const amb = s[el].niejednoznaczne_proc;
      if (unit === 'atr' && typeof amb === 'number') x.amb = round(amb, 0);
      out[`${el}.${m}`] = x;
    }
    const mt = matched.interwaly?.[tf]?.sprawdzian_2024;
    for (const [k, key] of Object.entries(MATCHED)) {
      if (!mt?.[k]) continue;
      const unit = key.endsWith('ATR') ? 'atr' : 'pct';
      out[key] = { ...measure(mt[k], unit, true), ...(out[key].amb !== undefined ? { amb: out[key].amb } : {}), m: 1 };
    }
    interwaly[tf] = out;
  }
  return {
    wersja: 1,
    zrodlo: {
      dane: 'Binance BTCUSDT perp, świece 5m 2020–2026, kolejność w świecy z 1m',
      dane_en: 'Binance BTCUSDT perp, 5m candles 2020–2026, order within the candle from 1m',
      od: '2024-01-01',
      do: first.do,
      przedzial: first.przedzial.replace(/ \(.*\)/, ''),
      definicje: first.definicje,
      kontrola_dopasowana: matched.metoda,
      autor: 'Backtester, smc-czestosci (16.11.2026)',
      wygenerowano: generated,
    },
    interwaly,
  };
}

function main() {
  const args = process.argv.slice(2);
  const di = args.indexOf('--date');
  const date = di >= 0 ? args[di + 1] : new Date().toISOString().slice(0, 10);
  const dir = args.find((a, i) => !a.startsWith('--') && i !== di + 1);
  if (!dir) throw new Error('użycie: node scripts/smc/rates.mjs <folder smc-czestosci> [--date RRRR-MM-DD]');
  const read = (/** @type {string} */ name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
  const files = Object.fromEntries(INTERVALS.map((tf) => [tf, read(`${tf}.json`)]));
  const rates = buildRates(files, read('kontrola-zmiennosci.json'), date, (m) => console.warn(m));
  const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/charts/pro/data/smcRates.json');
  mkdirSync(dirname(out), { recursive: true });
  const text = `${JSON.stringify(rates)}\n`;
  writeFileSync(out, text);
  console.log(`${out}: ${Buffer.byteLength(text)} B`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
