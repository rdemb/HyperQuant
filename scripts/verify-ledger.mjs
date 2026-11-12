/**
 * Niezależna weryfikacja dziennika prognoz HyperQuant — bez zaufania do serwera ani strony.
 *
 *   node scripts/verify-ledger.mjs --dir ./ledger [--bitcoin] [--market]   # pełna kontrola (zalecane):
 *       git clone -b ledger https://github.com/rdemb/hyperquant-data ledger
 *       --bitcoin: czas z bloków Bitcoina (poświadczenia OTS + nagłówki bloków); --market: ceny vs świece 1m HL
 *       --anchor <hash>: kotwica — commit ostatniej udanej weryfikacji musi nadal należeć do historii gałęzi
 *       --summary <plik>: miary podsumowania (summary.json z gałęzi main repo danych) przeliczone z rekordów do jego głowy
 *   node scripts/verify-ledger.mjs [RRRR-MM-DD]     # szybka kontrola ostatnich dni pobranych z GitHuba
 *
 * Sprawdza:
 *  1. łańcuch hashy: każda linia w postaci kanonicznej, hash = SHA-256 kanonicznego JSON z polem prev, prev = hash
 *     poprzedniej linii (także między dniami); w trybie --dir od GENESIS;
 *  2. wyniki: CRPS, PIT i pokrycia przeliczone z zapisanych kwantyli i zwrotu (nie przepisane z zapisu); Brier dotknięć
 *     i jego baza odległości (wzór odbicia ze stałą σ godzinową benchmarku z `bq` prognozy 1 h tego slotu, bssDist);
 *  3. historię git (--dir): każdy commit tylko dopisuje do plików dziennika;
 *     kot (Schrödi): p przeliczone z zapisanych cech i publicznego modelu public/schrodi/model-v1.json (hash modelu
 *     = `mh` rekordu), wzrost i duży ruch z cen i max/min okna; szanse dotknięcia poziomów i stożek zasięgu
 *     przeliczone modelem public/schrodi/touch-v1.json (hash = `th`); plan oceny zaufania kota zgodny z kodem
 *     (src/utils/schrodiTrust.ts), a dowód przewagi, rozkład trafności i alarm dryfu przeliczone z rekordów;
 *     godzina na żywo (zapisy o :15 i :30): cena, próg i szanse startowe z prognozy kota z początku godziny, p przeliczone
 *     modelem public/schrodi/hour-v1.json (hash = `mh`), wynik z godziny zegara, plan i dowód przewagi przeliczone;
 *     kalibracja kota `cat-cal-v1` (pole `cal`): plan zgodny z kodem (src/utils/catCal.ts), żadne `cal` przed planem,
 *     a, d, p, n i nT przeliczone tu, osobną implementacją, z par rozstrzygniętych wcześniej w dzienniku;
 *     prognoza `hrel-v1` (duży ruch jak na tę godzinę): plan zgodny z kodem (src/utils/hourRel.ts), żaden rekord przed
 *     planem, wydanie najpóźniej 15 min po pełnej godzinie, p przeliczone z cech i wag planu, y z zakresów i progów;
 *     z --market progi, cechy i zakresy przeliczone ze świec 1h Hyperliquid;
 *  3b. A/B: wariant C (plan `ab-v2`) przeliczony niezależnie z kwantyli A i zapisanych rv60, σA (własna implementacja
 *     przekształcenia: AS241, regula falsi), stałe zgodne z planem, plan zgodny z kodem, żaden rekord C przed planem;
 *     z --market rv60 wobec świec 5m Hyperliquid;
 *  3a. miary podsumowania (test Kupca przedziału 60%, jednostajność PIT, przedziały CRPSS, BSS dotknięć i BSS sezonowy
 *     dużego ruchu kota z bootstrapu blokowego po dobach UTC, udział nieskończonych przedziałów ACI) przeliczone z rekordów
 *     do głowy podsumowania (`--summary <plik>` przy --dir; w trybie szybkim podsumowanie ze strony, gdy pobrane dni
 *     sięgają początku dziennika). Sumy dobowe liczone tu, wspólna jest tylko procedura losowania
 *     (src/utils/ledgerBootstrap.ts: mulberry32, ziarno 20261111, 1000 losowań, 25. i 975. wartość);
 *  4. pokwitowania OpenTimestamps: skrót w `ots/<dzień>.jsonl.ots` = SHA-256 pliku dnia; w `ots/slots/<slot>.ots`
 *     = hash ostatniej prognozy tego slotu (prognozy istniały w chwili znakowania). Sam czas potwierdza klient OTS:
 *     `ots upgrade <plik>.ots` i `ots verify -f <plik danych> <plik>.ots` (dla slotu: skrót podaj przez `-d <hash>`).
 * Implementacja celowo niezależna od kodu skanera (ten sam format, inny kod).
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { AB_DESIGN, AB_DESIGN_C, abBlocks, abFirstBlock } from '../src/utils/abTest.ts';
import { fitEnsemble } from '../src/utils/ensemble.ts';
import { FEATURES, TOUCH_MAX_R, scoreHead, touchCone, touchProb } from '../src/utils/schrodi.ts';
import { HOUR_DESIGN, TRUST_DESIGN, catTrust, hourRow, hourTrust, trustHour } from '../src/utils/schrodiTrust.ts';
import { HOUR_FEATURES, hourProbs, hourX, logit } from '../src/utils/schrodiHour.ts';
import { addDaySum, daySkillCi } from '../src/utils/ledgerBootstrap.ts';
import { CAT_CAL_DESIGN } from '../src/utils/catCal.ts';
import { HREL_DESIGN } from '../src/utils/hourRel.ts';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const LEDGER_BASE = 'https://raw.githubusercontent.com/rdemb/hyperquant-data/ledger';
export const SUMMARY_URL = 'https://raw.githubusercontent.com/rdemb/hyperquant-data/main/ledger/BTC/summary.json';
export const GENESIS = '0'.repeat(64);
const OTS_MAGIC = Buffer.concat([Buffer.from([0]), Buffer.from('OpenTimestamps'), Buffer.from([0, 0]), Buffer.from('Proof'), Buffer.from([0, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94])]);

export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
    .join(',')}}`;
}

/** Weryfikacja linii od poprzednika; zwraca głowę albo pierwszą złą linię. */
export function verifyChain(lines, prev) {
  let expected = prev;
  for (let i = 0; i < lines.length; i++) {
    let o;
    try {
      o = JSON.parse(lines[i]);
    } catch {
      return { ok: false, head: expected, badLine: i, reason: 'niepoprawny JSON' };
    }
    if (canonical(o) !== lines[i]) return { ok: false, head: expected, badLine: i, reason: 'linia nie jest w postaci kanonicznej' };
    const { hash, ...rest } = o;
    if (rest.prev !== expected) return { ok: false, head: expected, badLine: i, reason: 'prev nie wskazuje poprzedniej linii' };
    if (createHash('sha256').update(canonical(rest)).digest('hex') !== hash) return { ok: false, head: expected, badLine: i, reason: 'hash nie zgadza się z treścią' };
    expected = hash;
  }
  return { ok: true, head: expected, badLine: null, reason: null };
}

const pinball = (q, y, t) => (y >= q ? t * (y - q) : (1 - t) * (q - y));
function crps(taus, qs, y) {
  let s = 0;
  for (let i = 1; i < taus.length; i++) s += ((pinball(qs[i - 1], y, taus[i - 1]) + pinball(qs[i], y, taus[i])) / 2) * (taus[i] - taus[i - 1]);
  return 2 * s;
}
function quantileAt(taus, qs, tau) {
  if (tau <= taus[0]) return qs[0];
  const last = taus.length - 1;
  if (tau >= taus[last]) return qs[last];
  let i = 1;
  while (taus[i] < tau) i++;
  return qs[i - 1] + ((tau - taus[i - 1]) / (taus[i] - taus[i - 1])) * (qs[i] - qs[i - 1]);
}

/** Φ(x) przez erf z rozwinięcia Abramowitza i Steguna 7.1.26 (błąd < 1,5e-7) — inna metoda niż w skanerze */
function normCdf(x) {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}
const Z975 = 1.959963984540054;
/**
 * Baza odległości dla dotknięć: σ godzinowa benchmarku z kwantyli `bq` prognozy 1 h slotu (σ_h = (q₀,₉₇₅ − q₀,₀₂₅) / 2z),
 * P = 2(1 − Φ(|ln(poziom/cena)| / (σ·√(h/60)))); brak prognozy 1 h albo σ ≤ 0 → null.
 */
function distTouchProb(fc, l, ret60) {
  if (!ret60 || !Array.isArray(ret60.bq)) return null;
  const s = (quantileAt(ret60.taus, ret60.bq, 0.975) - quantileAt(ret60.taus, ret60.bq, 0.025)) / (2 * Z975);
  if (!(s > 0)) return null;
  return Math.min(1, 2 * (1 - normCdf(Math.abs(Math.log(fc.lv[l] / fc.px0)) / (s * Math.sqrt(fc.h / 60)))));
}

const r6 = (x) => Math.round(x * 1e6) / 1e6;
/** „Blisko progu” rynku HIP-4 (względnie, 5 bp) — jak w skanerze */
const MKT_NEAR = 0.0005;
/** Płynność notowania jak w skanerze: spread ≤ 5 pp i ≥ 50 USDC w ±5 pp od środka po obu stronach */
const MKT_MAX_SPREAD = 0.05;
const MKT_MIN_DEPTH = 50;
const SLOT_LEN_MS = 15 * 60_000;

/** Niezmienniki rekordu „model vs rynek” (niezależnie od rozstrzygnięcia) — lista problemów. */
function mktRecordProblems(fc) {
  const out = [];
  if (fc.t + fc.h * 60_000 !== fc.expiry) out.push(`${fc.id}: t + h ≠ termin rynku`);
  if (fc.expiry !== fc.slot + SLOT_LEN_MS) out.push(`${fc.id}: termin rynku ≠ koniec slotu`);
  if (!(fc.p >= 0 && fc.p <= 1)) out.push(`${fc.id}: p poza [0, 1]`);
  if (fc.bid !== null && fc.ask !== null && !(fc.bid <= fc.ask)) out.push(`${fc.id}: bid > ask`);
  if (typeof fc.depthBid === 'number' || typeof fc.depthAsk === 'number') {
    // Jak bookQuote w src/utils/hip4.ts, bez tolerancji: spread 0,503–0,553 to w liczbach zmiennoprzecinkowych > 0,05
    const liquid =
      fc.bid !== null && fc.ask !== null && fc.ask - fc.bid <= MKT_MAX_SPREAD && fc.depthBid >= MKT_MIN_DEPTH && fc.depthAsk >= MKT_MIN_DEPTH;
    if (liquid !== fc.liquid) out.push(`${fc.id}: liquid = ${fc.liquid} ≠ przeliczone ze spreadu i głębokości ${liquid}`);
  }
  return out;
}

/** Wynik dotknięć z max/min okna (ta sama reguła co w skanerze: D-EQ od strony ceny przy wydaniu). */
function touchOutcome(fc, hi, lo) {
  const deqBelow = fc.lv.deq <= fc.px0;
  return { pdh: hi >= fc.lv.pdh ? 1 : 0, pdl: lo <= fc.lv.pdl ? 1 : 0, deq: (deqBelow ? lo <= fc.lv.deq : hi >= fc.lv.deq) ? 1 : 0 };
}

/**
 * Rozbieżności między zapisanymi a przeliczonymi wynikami — pusta lista = zgodne. Wynik musi wynikać z cen źródłowych
 * (zwrot: y = ln(c1/c0); dotknięcia: yv z max/min okna), a te sprawdza z rynkiem `checkMarket` (--market).
 */
export function checkResolutions(records) {
  const f = new Map(records.filter((o) => o.k === 'f').map((o) => [o.id, o]));
  const out = [];
  for (const r of records) {
    if (r.k !== 'r' || r.void) continue;
    const fc = f.get(r.id);
    if (!fc) continue;
    if (fc.kind === 'mkt') {
      out.push(...mktRecordProblems(fc));
      if (!(r.c1 > 0)) {
        out.push(`${r.id}: brak cen źródłowych (c1)`);
        continue;
      }
      const y = r.c1 >= fc.K ? 1 : 0;
      const near = Math.abs(r.c1 - fc.K) <= MKT_NEAR * fc.K ? 1 : 0;
      if (r.y !== y) out.push(`${r.id}: y = ${r.y} ≠ [c1 ≥ K] = ${y}`);
      if (r.near !== near) out.push(`${r.id}: near = ${r.near} ≠ przeliczone ${near}`);
      continue;
    }
    if (fc.kind === 'cat' || fc.kind === 'hour') {
      if (!(r.c0 > 0 && r.c1 > 0 && r.hi > 0 && r.lo > 0)) {
        out.push(`${r.id}: brak cen źródłowych (c0/c1/hi/lo)`);
        continue;
      }
      const yDir = r.c1 > r.c0 ? 1 : 0;
      const yBig = Math.log(r.hi / r.lo) * 1e4 > fc.thr ? 1 : 0;
      if (r.yDir !== yDir) out.push(`${r.id}: yDir = ${r.yDir} ≠ [c1 > c0] = ${yDir}`);
      if (r.yBig !== yBig) out.push(`${r.id}: yBig = ${r.yBig} ≠ [ln(hi/lo) > próg] = ${yBig}`);
      continue;
    }
    if (fc.kind === 'touch') {
      if (!(typeof r.hi === 'number' && typeof r.lo === 'number')) {
        out.push(`${r.id}: brak cen źródłowych (hi/lo)`);
        continue;
      }
      const want = touchOutcome(fc, r.hi, r.lo);
      for (const l of ['pdh', 'pdl', 'deq']) if (r.yv?.[l] !== want[l]) out.push(`${r.id}: yv.${l} = ${r.yv?.[l]} ≠ z max/min okna ${want[l]}`);
      continue;
    }
    if (fc.kind !== 'ret') continue;
    if (!(r.c0 > 0 && r.c1 > 0)) {
      out.push(`${r.id}: brak cen źródłowych (c0/c1)`);
      continue;
    }
    const y = r6(Math.log(r.c1 / r.c0));
    if (typeof r.y !== 'number' || Math.abs(y - r.y) > 1e-9) {
      out.push(`${r.id}: y = ${r.y} ≠ ln(c1/c0) = ${y}`);
      continue;
    }
    const c = crps(fc.taus, fc.q, r.y);
    if (typeof r.crps === 'number' && Math.abs(c - r.crps) > 2e-6) out.push(`${r.id}: CRPS ${r.crps} ≠ przeliczony ${c.toFixed(6)}`);
    if (typeof r.crpsB === 'number' && Array.isArray(fc.bq)) {
      const cb = crps(fc.taus, fc.bq, r.y);
      if (Math.abs(cb - r.crpsB) > 2e-6) out.push(`${r.id}: CRPS benchmarku ${r.crpsB} ≠ przeliczony ${cb.toFixed(6)}`);
    }
    if (typeof r.pit === 'number') {
      // PIT zapisany z niezaokrąglonego zwrotu ln(c1/c0) (y w rekordzie ma 6 miejsc)
      const p = pitOf(fc.taus, fc.q, Math.log(r.c1 / r.c0));
      if (Math.abs(p - r.pit) > 1e-4 + 1e-9) out.push(`${r.id}: PIT ${r.pit} ≠ przeliczony ${p.toFixed(4)}`);
    }
    for (const [key, lo, hi] of [
      ['in90', 0.05, 0.95],
      ['in60', 0.2, 0.8],
    ]) {
      if (typeof r[key] !== 'number') continue;
      const inside = r.y >= quantileAt(fc.taus, fc.q, lo) && r.y <= quantileAt(fc.taus, fc.q, hi) ? 1 : 0;
      if (inside !== r[key]) out.push(`${r.id}: ${key} = ${r[key]} ≠ przeliczone ${inside}`);
    }
  }
  return out;
}

const r4 = (x) => Math.round(x * 1e4) / 1e4;

/** PIT z siatki kwantyli: interpolacja liniowa, poza siatką połowa masy ogona (τ₀/2, 1 − (1 − τ_n)/2) */
function pitOf(taus, qs, y) {
  const last = qs.length - 1;
  if (y < qs[0]) return taus[0] / 2;
  if (y > qs[last]) return 1 - (1 - taus[last]) / 2;
  for (let i = 1; i <= last; i++) {
    if (y > qs[i]) continue;
    const span = qs[i] - qs[i - 1];
    return span > 0 ? taus[i - 1] + ((y - qs[i - 1]) / span) * (taus[i] - taus[i - 1]) : taus[i];
  }
  return taus[last];
}

/**
 * P(X > x) dla χ² o nieparzystej liczbie stopni swobody k, wzór zamknięty: 2(1 − Φ(√x)) + 2φ(√x)·Σ_{j=1}^{(k−1)/2}
 * x^{(2j−1)/2} / (1·3·…·(2j−1)) — inna metoda niż w skanerze (funkcja gamma); x ≤ 0 → 1.
 */
function chiSqSfOdd(x, k) {
  if (!(x > 0)) return 1;
  const s = Math.sqrt(x);
  let sum = 0;
  let term = s;
  for (let j = 1; j <= (k - 1) / 2; j++) {
    sum += term;
    term *= x / (2 * j + 1);
  }
  return Math.min(1, Math.max(0, 2 * (1 - normCdf(s)) + 2 * (Math.exp(-x / 2) / Math.sqrt(2 * Math.PI)) * sum));
}

const DAY_MS = 86_400_000;
/** Doba UTC o numerze d to weekend (sobota, niedziela); 1970-01-01 to czwartek */
const weekendDay = (d) => [0, 6].includes((d + 4) % 7);

/**
 * Baza sezonowa dużego ruchu: częstość yBig pełnych godzin tej samej godziny UTC w 20 poprzednich dobach tego samego
 * typu (od 8 rozstrzygnięć), inaczej wszystkich pełnych godzin tych dób; brak → null.
 */
function seasonBase(slot, hours) {
  const day = Math.floor(slot / DAY_MS);
  const hour = Math.floor((slot % DAY_MS) / HOUR_MS);
  const we = weekendDay(day);
  const same = [];
  const all = [];
  let days = 0;
  for (let d = day - 1; days < 20 && d > day - 400; d--) {
    if (weekendDay(d) !== we) continue;
    days++;
    for (let h = 0; h < 24; h++) {
      const y = hours.get(d * DAY_MS + h * HOUR_MS);
      if (y === undefined) continue;
      all.push(y);
      if (h === hour) same.push(y);
    }
  }
  const freq = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  if (same.length >= 8) return freq(same);
  return all.length ? freq(all) : null;
}

/**
 * Miary podsumowania przeliczone z rekordów w oknie 30 dni przed `asOf` (jak w podsumowaniu): na horyzont — test Kupca
 * przedziału 60% i jednostajność PIT na próbie rozłącznej (slot wielokrotnością horyzontu), CRPSS z przedziałem z sum
 * dobowych, udział nieskończonych przedziałów ACI; dotknięcia — BSS wobec częstości poziomu i wobec bazy odległości
 * z przedziałami; kot — BSS dużego ruchu wobec bazy sezonowej. Trafienia 60% i duży ruch z cen i kwantyli; PIT i CRPS
 * z zapisu, który `checkResolutions` porównuje z przeliczonym.
 */
export function measures(records, asOf) {
  const from = asOf - 30 * DAY_MS;
  const f = new Map();
  const r = new Map();
  for (const o of records) {
    if (o.k === 'f') f.set(o.id, o);
    else if (o.k === 'r') r.set(o.id, o);
  }
  const win = [...f.values()].filter((o) => o.t >= from).sort((a, b) => a.t - b.t);
  const ret = {};
  for (const h of [60, 240]) {
    const pairs = win
      .filter((o) => o.kind === 'ret' && !o.variant && o.h === h)
      .map((fc) => ({ fc, res: r.get(fc.id) }))
      .filter(({ res }) => res && !res.void && typeof res.crps === 'number');
    const disjoint = pairs.filter(({ fc }) => fc.slot % (h * 60_000) === 0);
    const n = disjoint.length;
    const x = disjoint.filter(({ fc, res }) => res.y >= quantileAt(fc.taus, fc.q, 0.2) && res.y <= quantileAt(fc.taus, fc.q, 0.8)).length;
    let kupiec60 = { n, x, cover: null, lr: null, p: null, reason: 'min-n' };
    if (n > 0) {
      const pi = x / n;
      const lr = Math.max(0, -2 * ((x > 0 ? x * Math.log(0.6 / pi) : 0) + (n - x > 0 ? (n - x) * Math.log(0.4 / (1 - pi)) : 0)));
      kupiec60 = { n, x, cover: r4(pi), lr: r4(lr), p: r4(chiSqSfOdd(lr, 1)) };
    }
    const bins = Array(10).fill(0);
    for (const { res } of disjoint) bins[Math.min(9, Math.max(0, Math.floor(res.pit * 10)))]++;
    let pit = { n, bins, chi2: null, p: null, reason: 'min-n' };
    if (n >= 50) {
      const chi2 = bins.reduce((s, o) => s + (o - n / 10) ** 2 / (n / 10), 0);
      pit = { n, bins, chi2: r4(chi2), p: r4(chiSqSfOdd(chi2, 9)) };
    }
    const days = new Map();
    for (const { fc, res } of pairs) addDaySum(days, fc.slot, res.crps, res.crpsB);
    const inf = pairs.filter(({ fc }) => !(fc.aci > 0 && fc.aci < 2)).length;
    ret[h] = { kupiec60, pit, crpssCi: daySkillCi(days.values()), aciInf: { n: pairs.length, inf, share: pairs.length ? r4(inf / pairs.length) : null } };
  }
  const levels = ['pdh', 'pdl', 'deq'];
  const touch = win.filter((o) => o.kind === 'touch').map((fc) => ({ fc, res: r.get(fc.id) })).filter(({ res }) => res && res.yv);
  const base = {};
  for (const l of levels) {
    const ys = touch.filter(({ fc }) => fc.p[l] !== null && fc.p[l] !== undefined).map(({ res }) => res.yv[l]);
    base[l] = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
  }
  const baseDays = new Map();
  const distDays = new Map();
  for (const { fc, res } of touch) {
    const ret60 = f.get(`${fc.slot}-ret60`);
    for (const l of levels) {
      const p = fc.p[l];
      if (p === null || p === undefined) continue;
      if (base[l] !== null) addDaySum(baseDays, fc.slot, (p - res.yv[l]) ** 2, (base[l] - res.yv[l]) ** 2);
      const pd = distTouchProb(fc, l, ret60 && !ret60.variant && ret60.t >= from ? ret60 : null);
      if (pd !== null) addDaySum(distDays, fc.slot, (p - res.yv[l]) ** 2, (pd - res.yv[l]) ** 2);
    }
  }
  // Pełne godziny kota z całego dziennika (do głowy) — baza sezonowa
  const hours = new Map();
  for (const fc of f.values()) {
    if (fc.kind !== 'cat' || fc.slot % HOUR_MS !== 0) continue;
    const res = r.get(fc.id);
    if (!res || res.void || typeof res.yBig !== 'number') continue;
    hours.set(fc.slot, Math.log(res.hi / res.lo) * 1e4 > fc.thr ? 1 : 0);
  }
  const seasonDays = new Map();
  let seasonN = 0;
  for (const fc of win) {
    if (fc.kind !== 'cat') continue;
    const res = r.get(fc.id);
    if (!res || res.void || typeof res.yBig !== 'number') continue;
    const b = seasonBase(fc.slot, hours);
    if (b === null) continue;
    const y = Math.log(res.hi / res.lo) * 1e4 > fc.thr ? 1 : 0;
    seasonN++;
    addDaySum(seasonDays, fc.slot, (fc.pBig - y) ** 2, (b - y) ** 2);
  }
  return {
    asOf,
    ret,
    touch: { bssCi: daySkillCi(baseDays.values()), bssDistCi: daySkillCi(distDays.values()) },
    catBig: { bssSeasonal: { ...daySkillCi(seasonDays.values()), n: seasonN } },
  };
}

/** Pola liczone inną metodą numeryczną niż w skanerze (p z χ², baza odległości) — zgodność do 1e-4, reszta dokładnie */
const APPROX = 1e-4 + 1e-9;

/**
 * Miary z podsumowania zgodne z przeliczonymi z rekordów do jego głowy (`head.hash`). Pole nieobecne w podsumowaniu
 * (starsza wersja) pomijane. Zwraca liczbę porównanych pól i listę rozbieżności.
 */
export function checkMeasures(summary, records) {
  const idx = records.findIndex((o) => o.hash === summary?.head?.hash);
  if (idx < 0) return { checked: 0, problems: ['głowa podsumowania nie występuje w rekordach'] };
  const m = measures(records.slice(0, idx + 1), summary.asOf);
  const problems = [];
  let checked = 0;
  const cmp = (label, got, want, approx = []) => {
    if (got === undefined || got === null || typeof got !== 'object') {
      if (got === null) problems.push(`${label}: brak (null) ≠ przeliczone`);
      return;
    }
    for (const [k, w] of Object.entries(want)) {
      checked++;
      const g = got[k];
      const tol = approx.includes(k) ? APPROX : 0;
      const same = typeof w === 'number' && typeof g === 'number' ? Math.abs(g - w) <= tol : canonical(g) === canonical(w);
      if (!same) problems.push(`${label}.${k}: ${canonical(g)} ≠ przeliczone ${canonical(w)}`);
    }
  };
  for (const h of [60, 240]) {
    const sc = summary.scores?.ret?.[h];
    if (!sc) continue;
    const w = m.ret[h];
    cmp(`ret ${h} kupiec60`, sc.kupiec60, w.kupiec60, ['lr', 'p']);
    cmp(`ret ${h} pit`, sc.pit, w.pit, ['p']);
    cmp(`ret ${h} crpssCi`, sc.crpssCi, w.crpssCi);
    cmp(`ret ${h} aciInf`, sc.aciInf, w.aciInf);
  }
  cmp('touch bssCi', summary.scores?.touch?.bssCi, m.touch.bssCi);
  cmp('touch bssDistCi', summary.scores?.touch?.bssDistCi, m.touch.bssDistCi, ['value', 'lo', 'hi']);
  cmp('kot big bssSeasonal', summary.cat?.scores?.big?.bssSeasonal, m.catBig.bssSeasonal);
  return { checked, problems };
}

/**
 * Kot (Schrödi): hash modelu w rekordzie = SHA-256 kanonicznego JSON publicznego modelu, p przeliczone z zapisanych cech
 * tym modelem (null = brak cechy), cechy na świecy 5m kończącej się z początkiem slotu, horyzont 1 h.
 */
export function checkCat(records, model, touchModel = null) {
  const mh = model ? createHash('sha256').update(canonical(model)).digest('hex') : null;
  const th = touchModel ? createHash('sha256').update(canonical(touchModel)).digest('hex') : null;
  const problems = [];
  let checked = 0;
  for (const fc of records) {
    if (fc.k !== 'f' || fc.kind !== 'cat') continue;
    const bad = [];
    if (fc.h !== 60) bad.push('horyzont ≠ 60');
    if (fc.bar !== fc.slot - 5 * 60_000) bad.push('świeca cech ≠ ostatnia 5m przed slotem');
    if (!Array.isArray(fc.x) || fc.x.length !== FEATURES.length || fc.x.some((v) => v !== null && !Number.isFinite(v))) bad.push('cechy');
    else if (!model) bad.push('brak publicznego modelu do przeliczenia');
    else if (fc.mh !== mh) bad.push('hash modelu ≠ public/schrodi/model-v1.json');
    else {
      const x = Object.fromEntries(FEATURES.map((f, i) => [f, fc.x[i] ?? Number.NaN]));
      const pUp = r4(scoreHead(model.dir, model.features, x).p);
      const pBig = r4(scoreHead(model.big, model.features, x).p);
      if (pUp !== fc.pUp) bad.push(`pUp ${fc.pUp} ≠ przeliczone ${pUp}`);
      if (pBig !== fc.pBig) bad.push(`pBig ${fc.pBig} ≠ przeliczone ${pBig}`);
      if (fc.tl !== undefined || fc.cone !== undefined) bad.push(...touchProblems(fc, x, touchModel, th));
    }
    if (bad.length) problems.push(`${fc.id}: ${bad.join(', ')}`);
    else checked++;
  }
  return { problems, checked };
}

/** Szanse dotknięcia poziomów (cena z rekordu, odległość od px0, próg = mediana zakresu godziny) i stożek zasięgu kota. */
function touchProblems(fc, x, touchModel, th) {
  if (!touchModel) return ['brak publicznego modelu dotknięć do przeliczenia'];
  if (fc.th !== th) return ['hash modelu dotknięć ≠ public/schrodi/touch-v1.json'];
  const bad = [];
  for (const l of fc.tl ?? []) {
    const d = Math.log(l.px / fc.px0) * 1e4;
    const p = Math.abs(d) > 0 && Math.abs(d) <= TOUCH_MAX_R * fc.thr ? r4(touchProb(touchModel, x, fc.thr, d)) : null;
    if (p !== l.p) bad.push(`dotknięcie ${l.k}: p ${l.p} ≠ przeliczone ${p}`);
  }
  if (canonical(touchCone(touchModel, x, fc.thr)) !== canonical(fc.cone ?? null)) bad.push('stożek zasięgu ≠ przeliczony');
  return bad;
}

const HOUR_MS = 60 * 60_000;
const hourVec = (x) => Object.fromEntries(HOUR_FEATURES.map((f, i) => [f, x[i]]));

/**
 * Godzina na żywo (Schrödi): zapis o :15 albo :30 (minuty od początku godziny = pierwsza cecha), cena, próg i szanse
 * startowe w cechach z prognozy kota z początku godziny, horyzont do końca godziny zegara, hash modelu = SHA-256
 * kanonicznego JSON public/schrodi/hour-v1.json, p przeliczone z zapisanych cech. Cechy drogi ceny vs świece: --market.
 */
export function checkHour(records, model) {
  const mh = model ? createHash('sha256').update(canonical(model)).digest('hex') : null;
  const cats = new Map(records.filter((o) => o.k === 'f' && o.kind === 'cat').map((o) => [o.id, o]));
  const problems = [];
  let checked = 0;
  for (const fc of records) {
    if (fc.k !== 'f' || fc.kind !== 'hour') continue;
    const bad = [];
    const hs = fc.slot - (fc.slot % HOUR_MS);
    const m = (fc.slot - hs) / 60_000;
    if (!HOUR_DESIGN.checkpoints.includes(m)) bad.push('slot poza :15 i :30');
    if (fc.id !== `${fc.slot}-hour` || fc.hs !== hs) bad.push('identyfikator albo początek godziny');
    if (fc.h !== (hs + HOUR_MS - fc.t) / 60_000) bad.push('horyzont ≠ do końca godziny');
    const cat = cats.get(`${hs}-cat`);
    if (!cat) bad.push('brak prognozy kota z początku godziny');
    else if (cat.px0 !== fc.px0 || cat.thr !== fc.thr) bad.push('cena albo próg ≠ prognoza kota');
    if (!Array.isArray(fc.x) || fc.x.length !== HOUR_FEATURES.length || !fc.x.every(Number.isFinite)) bad.push('cechy');
    else {
      if (fc.x[0] !== m) bad.push('m ≠ minuty od początku godziny');
      if (cat && (fc.x[6] !== r6(logit(cat.pBig, 1e-4)) || fc.x[7] !== r6(logit(cat.pUp, 1e-4)))) bad.push('szanse startowe ≠ prognoza kota');
      if (!model) bad.push('brak publicznego modelu godziny do przeliczenia');
      else if (fc.mh !== mh) bad.push('hash modelu ≠ public/schrodi/hour-v1.json');
      else {
        const p = hourProbs(model, hourVec(fc.x));
        for (const k of ['pBig', 'pBigRule', 'pUp']) if (r4(p[k]) !== fc[k]) bad.push(`${k} ${fc[k]} ≠ przeliczone ${r4(p[k])}`);
      }
    }
    if (bad.length) problems.push(`${fc.id}: ${bad.join(', ')}`);
    else checked++;
  }
  return { problems, checked };
}

/** Skrót (hex) zakotwiczony w pliku .ots — nagłówek, wersja 1, operacja SHA-256; inny format → null. */
export function otsDigestHex(bytes) {
  const b = Buffer.from(bytes);
  if (b.length < OTS_MAGIC.length + 2 + 32 || !b.subarray(0, OTS_MAGIC.length).equals(OTS_MAGIC)) return null;
  if (b[OTS_MAGIC.length] !== 1 || b[OTS_MAGIC.length + 1] !== 0x08) return null;
  return b.subarray(OTS_MAGIC.length + 2, OTS_MAGIC.length + 34).toString('hex');
}

const SLOT_MS = 15 * 60_000;
const MIN_MS = 60_000;
/** Unieważnienie (brak danych) dopuszczalne dopiero 6 h po końcu horyzontu — jak w skanerze */
const VOID_MS = 6 * 60 * MIN_MS;
/**
 * Zapas na swobodę znacznika czasu bloku Bitcoina: znacznik musi być tylko większy od mediany 11 poprzednich bloków,
 * więc bywa do ~1–2 h wcześniejszy niż faktyczne wydobycie. Blok liczy się jako dowód przed faktem z tym zapasem.
 */
const BLOCK_TIME_MARGIN_MS = 2 * 60 * MIN_MS;

/** Koniec horyzontu prognozy: t + h; `hrel-v1` — koniec godziny hs + 3 h */
const horizonEnd = (fc) => (fc.kind === 'hrel' ? fc.t + 4 * 60 * MIN_MS : fc.t + fc.h * MIN_MS);

/**
 * Kolejność i spójność rekordów w łańcuchu: unikalne prognozy, slot = slot chwili wydania, początek horyzontu = pełna
 * minuta po wydaniu, czasy niemalejące, rozstrzygnięcie nie przed końcem horyzontu, slot z prognozą albo skip — nie oba.
 */
export function checkOrdering(records, opts = {}) {
  const out = [];
  const f = new Map();
  const resolved = new Set();
  const skipped = [];
  let lastTime = -Infinity;
  for (const o of records) {
    if (o.k === 'f') {
      if (f.has(o.id)) out.push(`${o.id}: powtórzony identyfikator prognozy`);
      f.set(o.id, o);
      if (typeof o.ti === 'number') {
        if (o.slot !== Math.floor(o.ti / SLOT_MS) * SLOT_MS) out.push(`${o.id}: slot ${o.slot} nie jest slotem chwili wydania`);
        // hrel-v1: t = początek godziny (hs) — cechy ze świec zamkniętych do hs, wydanie w slocie po hs (checkHrel)
        if (o.kind === 'hrel') {
          if (o.t !== o.slot - (o.slot % (60 * MIN_MS))) out.push(`${o.id}: t nie jest początkiem godziny slotu`);
        } else if (o.t !== Math.floor(o.ti / MIN_MS) * MIN_MS + MIN_MS) out.push(`${o.id}: początek horyzontu nie jest pełną minutą po wydaniu`);
        if (o.ti < lastTime) out.push(`${o.id}: czas cofnięty względem poprzedniego rekordu`);
        lastTime = Math.max(lastTime, o.ti);
      }
    } else if (o.k === 'r') {
      const fc = f.get(o.id);
      // Tryb szybki (ostatnie dni): prognoza mogła paść przed pierwszym pobranym dniem
      const before = opts.since !== undefined && Number(String(o.id).split('-')[0]) < opts.since;
      if (!fc && !before) out.push(`${o.id}: rozstrzygnięcie bez wcześniejszej prognozy`);
      else if (fc && typeof o.t === 'number' && o.t < horizonEnd(fc)) out.push(`${o.id}: rozstrzygnięcie przed końcem horyzontu`);
      else if (fc && o.void && !(o.t >= horizonEnd(fc) + VOID_MS)) out.push(`${o.id}: unieważnienie przed upływem 6 h po horyzoncie`);
      if (resolved.has(o.id)) out.push(`${o.id}: powtórzone rozstrzygnięcie`);
      resolved.add(o.id);
      if (typeof o.t === 'number') {
        if (o.t < lastTime) out.push(`${o.id}: czas cofnięty względem poprzedniego rekordu`);
        lastTime = Math.max(lastTime, o.t);
      }
    } else if (o.k === 's') skipped.push([o.slot, o.until ?? o.slot]);
    else if (o.k === 'p' && typeof o.t === 'number') {
      // Prerejestracja: czas nie może się cofać względem wcześniejszych zapisów (od niego liczy się ocena do przodu)
      if (o.t < lastTime) out.push(`prerejestracja ${o.id}: czas cofnięty względem poprzedniego rekordu`);
      lastTime = Math.max(lastTime, o.t);
    }
  }
  const fSlots = new Set([...f.values()].map((x) => x.slot));
  for (const [a, b] of skipped) for (const s of fSlots) if (s >= a && s <= b) out.push(`slot ${s}: jednocześnie prognoza i pominięcie`);
  return out;
}

/** Wersja modelu wariantu B (A/B z reżimem BOCPD) — tylko horyzont 1 h */
const MODEL_B = 'ledger-har-fhs-bocpd-v1';

/**
 * A/B wersji modelu: wariant B prognozy zwrotu (`variant: 'B'`, id `<A>b`) musi mieć tę samą chwilę wydania, horyzont,
 * cenę, poziomy τ, benchmark i ACI co wersja A z tego samego slotu, a kwantyle = A × `scale` (±2·10⁻⁶ z zaokrągleń).
 * Skala wynika ze wzoru na zapisanych wielkościach: √(½ + ½·σ5²·(h/5)·seas / σ_A²) (±10⁻⁵ z zaokrągleń), więc ≥ √½;
 * horyzont 1 h, model MODEL_B. σ_A musi być wiarygodne względem kwantyli A: (q₀.₉₇₅ − q₀.₀₂₅) / (3,92·σ_A) ∈ [0,5; 2]
 * (rozkład FHS ma grubsze ogony niż normalny, ale nie dowolnie) — inaczej dowolne σ_A „zgadzałoby się” ze wzorem.
 */
export function checkVariants(records) {
  const byId = new Map(records.filter((o) => o.k === 'f').map((o) => [o.id, o]));
  const problems = [];
  let checked = 0;
  for (const b of byId.values()) {
    if (b.variant !== 'B') continue;
    const a = byId.get(String(b.id).slice(0, -1));
    if (!a || a.variant) {
      problems.push(`${b.id}: brak wersji A tego slotu`);
      continue;
    }
    const bad = [];
    for (const k of ['slot', 'ti', 't', 'h', 'px0', 'aci']) if (a[k] !== b[k]) bad.push(k);
    if (canonical(a.taus) !== canonical(b.taus) || canonical(a.bq) !== canonical(b.bq)) bad.push('taus/bq');
    if (b.kind !== 'ret') bad.push('kind');
    if (b.h !== 60) bad.push('horyzont ≠ 60');
    if (b.model !== MODEL_B) bad.push('model');
    if (!(typeof b.scale === 'number' && b.scale > 0 && Number.isFinite(b.scale))) bad.push('scale');
    else {
      if (!Array.isArray(b.q) || b.q.length !== a.q.length || b.q.some((v, i) => Math.abs(v - a.q[i] * b.scale) > 2e-6)) bad.push('kwantyle ≠ A × skala');
      if (b.scale < Math.SQRT1_2 - 1e-6) bad.push('skala < √½');
    }
    const regOk = !!b.regime && [b.regime.sigma5, b.regime.run, b.regime.pChange].every(Number.isFinite);
    if (!regOk) bad.push('reżim');
    if (!(typeof b.sigmaA === 'number' && b.sigmaA > 0) || !(typeof b.seas === 'number' && b.seas > 0)) bad.push('σ_A / seas');
    else if (regOk && typeof b.scale === 'number' && b.h === 60) {
      const want = Math.sqrt(0.5 + (0.5 * b.regime.sigma5 ** 2 * (b.h / 5) * b.seas) / b.sigmaA ** 2);
      if (Math.abs(want - b.scale) > 1e-5 * Math.max(1, want)) bad.push('skala ≠ wzór z zapisanych σ');
      const i025 = a.taus.indexOf(0.025);
      const i975 = a.taus.indexOf(0.975);
      if (i025 >= 0 && i975 >= 0) {
        const ratio = (a.q[i975] - a.q[i025]) / (3.92 * b.sigmaA);
        if (!(ratio >= 0.5 && ratio <= 2)) bad.push(`σ_A niezgodne z kwantylami A (stosunek ${ratio.toFixed(2)})`);
      }
    }
    if (bad.length) problems.push(`${b.id}: ${bad.join(', ')}`);
    else checked++;
  }
  return { problems, checked };
}

/** Wersja modelu wariantu C (plan `ab-v2`: świeży poziom zmienności i mieszanina skali) — tylko horyzont 1 h */
const MODEL_C = 'ledger-har-fhs-rvmix-v1';

/**
 * Φ⁻¹(p) algorytmem AS241 (Wichura 1988, PPND16, błąd względny ~1e-16) — inna metoda niż w skanerze (Acklam).
 */
function ppnd16(p) {
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return (
      (q *
        (((((((2509.0809287301226727 * r + 33430.575583588128105) * r + 67265.770927008700853) * r + 45921.953931549871457) * r + 13731.693765509461125) * r + 1971.5909503065514427) * r + 133.14166789178437745) * r +
          3.387132872796366608)) /
      (((((((5226.495278852545925 * r + 28729.085735721942674) * r + 39307.89580009271061) * r + 21213.794301586595867) * r + 5394.1960214247511077) * r + 687.1870074920579083) * r + 42.313330701600911252) * r + 1)
    );
  }
  let r = q < 0 ? p : 1 - p;
  r = Math.sqrt(-Math.log(r));
  let v;
  if (r <= 5) {
    r -= 1.6;
    v =
      (((((((7.7454501427834140764e-4 * r + 0.0227238449892691845833) * r + 0.24178072517745061177) * r + 1.27045825245236838258) * r + 3.64784832476320460504) * r + 5.7694972214606914055) * r + 4.6303378461565452959) * r +
        1.42343711074968357734) /
      (((((((1.05075007164441684324e-9 * r + 5.475938084995344946e-4) * r + 0.0151986665636164571966) * r + 0.14810397642748007459) * r + 0.68976733498510000455) * r + 1.6763848301838038494) * r + 2.05319162663775882187) * r + 1);
  } else {
    r -= 5;
    v =
      (((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r + 0.0012426609473880784386) * r + 0.026532189526576123093) * r + 0.29656057182850489123) * r + 1.7848265399172913358) * r + 5.4637849111641143699) * r +
        6.6579046435011037772) /
      (((((((2.04426310338993978564e-15 * r + 1.4215117583164458887e-7) * r + 1.8463183175100546818e-5) * r + 7.868691311456132591e-4) * r + 0.0148753612908506148525) * r + 0.13692988092273580531) * r + 0.59983220655588793769) * r + 1);
  }
  return q < 0 ? -v : v;
}

/**
 * Kwantyle wariantu C z rekordu, niezależnie od src/utils/rvMix.ts: x z zapisanych rv60 i σA (przycięte do ±1,5),
 * q1 = qA · exp(c + κ·x), dystrybuanta odcinkami liniowa w skali normalnej przez (q1[k], Φ⁻¹(τ[k])) z ekstrapolacją
 * skrajnych odcinków, mieszanina skali z węzłami i wagami planu, pierwiastek metodą Illinois (regula falsi).
 */
export function variantCQuantiles(qA, taus, { rv60, sigmaA, kappa, c, tau }, quad) {
  const x = Math.max(-1.5, Math.min(1.5, rv60 > 0 ? 0.5 * Math.log(rv60 / sigmaA ** 2) : -Infinity));
  const g = Math.exp(c + kappa * x);
  const q1 = qA.map((v) => v * g);
  const z = taus.map(ppnd16);
  const n = q1.length;
  const seg = (v) => {
    let i = 1;
    if (v > q1[n - 1]) i = n - 1;
    else if (v > q1[0]) while (q1[i] < v) i++;
    return z[i - 1] + ((v - q1[i - 1]) / (q1[i] - q1[i - 1])) * (z[i] - z[i - 1]);
  };
  const scales = quad.nodes.map((nj) => Math.exp((tau * nj - tau * tau / 2) / 2));
  const cdf = (v) => quad.weights.reduce((s, w, j) => s + w * normCdf(seg(v / scales[j])), 0);
  const span = 6 * Math.max(...q1.map((v) => Math.abs(v)));
  const q = taus.map((t) => {
    let a = -span;
    let b = span;
    let fa = cdf(a) - t;
    let fb = cdf(b) - t;
    let side = 0;
    let m = (a + b) / 2;
    for (let k = 0; k < 200 && b - a > 1e-13; k++) {
      m = (a * fb - b * fa) / (fb - fa);
      const fm = cdf(m) - t;
      if (fm === 0) break;
      if (fm * fb > 0) {
        b = m;
        fb = fm;
        if (side === -1) fa /= 2;
        side = -1;
      } else {
        a = m;
        fa = fm;
        if (side === 1) fb /= 2;
        side = 1;
      }
    }
    return m;
  });
  return { x, q };
}

/**
 * Wariant C prognozy zwrotu (`variant: 'C'`, id `<A>c`): te same chwila wydania, horyzont, cena, poziomy τ, benchmark
 * i ACI co A z tego samego slotu; model MODEL_C; stałe κ, c, τ równe stałym planu `ab-v2`; σA z rozpiętości skrajnych
 * kwantyli A (±1e-8), x z zapisanych rv60 i σA (±1e-6), kwantyle C z przekształcenia (±1e-5) i rosnące.
 */
export function checkVariantC(records) {
  const byId = new Map(records.filter((o) => o.k === 'f').map((o) => [o.id, o]));
  const k = AB_DESIGN_C.constants;
  const problems = [];
  let checked = 0;
  for (const cf of byId.values()) {
    if (cf.variant !== 'C') continue;
    const a = byId.get(String(cf.id).slice(0, -1));
    if (!a || a.variant || !String(cf.id).endsWith('c')) {
      problems.push(`${cf.id}: brak wersji A tego slotu`);
      continue;
    }
    const bad = [];
    for (const f of ['slot', 'ti', 't', 'h', 'px0', 'aci']) if (a[f] !== cf[f]) bad.push(f);
    if (canonical(a.taus) !== canonical(cf.taus) || canonical(a.bq) !== canonical(cf.bq)) bad.push('taus/bq');
    if (cf.kind !== 'ret') bad.push('kind');
    if (cf.h !== 60) bad.push('horyzont ≠ 60');
    if (cf.model !== MODEL_C) bad.push('model');
    if (cf.kappa !== k.kappa || cf.c !== k.c || cf.tau !== k.tau) bad.push('stałe ≠ plan ab-v2');
    const n = Array.isArray(a.q) ? a.q.length : 0;
    const aOk = n >= 2 && Array.isArray(a.taus) && a.taus.length === n && a.q.every((v, i) => Number.isFinite(v) && (i === 0 || v > a.q[i - 1]));
    if (!aOk) bad.push('kwantyle A nierosnące');
    else if (!(cf.rv60 >= 0 && Number.isFinite(cf.rv60))) bad.push('rv60');
    else {
      const sigmaA = (a.q[n - 1] - a.q[0]) / (ppnd16(a.taus[n - 1]) - ppnd16(a.taus[0]));
      if (!(typeof cf.sigmaA === 'number' && Math.abs(cf.sigmaA - sigmaA) <= 1e-8)) bad.push('σA ≠ rozpiętość kwantyli A');
      else {
        const want = variantCQuantiles(a.q, a.taus, { rv60: cf.rv60, sigmaA: cf.sigmaA, kappa: k.kappa, c: k.c, tau: k.tau }, AB_DESIGN_C.quadrature);
        if (!(typeof cf.x === 'number' && Math.abs(cf.x - want.x) <= 1e-6)) bad.push('x ≠ ½·ln(rv60/σA²)');
        if (!Array.isArray(cf.q) || cf.q.length !== n || cf.q.some((v, i) => !(Math.abs(v - want.q[i]) <= 1e-5))) bad.push('kwantyle C ≠ przekształcenie A');
        else if (cf.q.some((v, i) => i > 0 && !(v > cf.q[i - 1]))) bad.push('kwantyle C nierosnące');
      }
    }
    if (bad.length) problems.push(`${cf.id}: ${bad.join(', ')}`);
    else checked++;
  }
  return { problems, checked };
}

/**
 * Plan oceny wariantu C (`ab-v2`): zapisany plan identyczny z planem w kodzie (src/utils/abTest.ts), jeden hash dla
 * identyfikatora, każdy rekord C wydany po rejestracji planu (rekord C bez planu w pełnym dzienniku — też błąd).
 */
export function checkAbPlanC(records, { full = false } = {}) {
  const problems = [];
  const plans = records.filter((o) => o.k === 'p' && o.id === AB_DESIGN_C.id);
  const want = canonical(AB_DESIGN_C);
  for (const p of plans) if (canonical(p.catalog) !== want) problems.push(`${p.id}: plan wariantu C różni się od kodu (src/utils/abTest.ts)`);
  if (new Set(plans.map((p) => p.catalogHash)).size > 1) problems.push(`${AB_DESIGN_C.id}: kilka różnych planów pod jednym identyfikatorem`);
  const registeredAt = plans.length && typeof plans[0].t === 'number' ? plans[0].t : null;
  const cs = records.filter((o) => o.k === 'f' && o.variant === 'C');
  if (registeredAt !== null) {
    const early = cs.filter((o) => o.ti < registeredAt);
    if (early.length) problems.push(`wariant C przed prerejestracją planu: ${early.length} (np. ${early[0].id})`);
  } else if (full && cs.length) problems.push(`wariant C bez planu ${AB_DESIGN_C.id} w dzienniku: ${cs.length} (np. ${cs[0].id})`);
  return { problems, registeredAt };
}

/**
 * rv60 rekordów C wobec świec 5m Hyperliquid (--market): suma kwadratów log-zwrotów zamknięcie do zamknięcia 12 świec
 * o początkach S − 60 min … S − 5 min (z zamknięciem świecy S − 65 min); sprawdzane tylko rekordy, dla których wszystkie
 * 13 świec jest w pobranym zakresie. Zgodność względna 1e-6.
 */
export function checkRv60(records, candles5m) {
  const close = new Map(candles5m.map((c) => [c.time, c.close]));
  const step = 5 * 60_000;
  const problems = [];
  let checked = 0;
  let eligible = 0;
  for (const o of records) {
    if (o.k !== 'f' || o.variant !== 'C') continue;
    eligible++;
    const ts = Array.from({ length: 13 }, (_, i) => o.slot - (13 - i) * step);
    if (!ts.every((t) => close.has(t))) continue;
    let rv = 0;
    for (let i = 1; i < 13; i++) rv += Math.log(close.get(ts[i]) / close.get(ts[i - 1])) ** 2;
    checked++;
    if (!(Math.abs(rv - o.rv60) <= 1e-6 * Math.max(rv, 1e-12))) problems.push(`${o.id}: rv60 ${o.rv60} ≠ ze świec 5m ${rv.toPrecision(10)}`);
  }
  return { problems, checked, eligible };
}

/**
 * Plan oceny A/B (rekord `k: 'p'`, id AB_DESIGN.id): zapisany plan musi być identyczny z planem w kodzie (te same stałe
 * oceny, więc publiczny kod liczy wynik tak, jak zarejestrowano), jeden hash dla identyfikatora, a każdy rekord
 * wariantu B wydany po prerejestracji. Zwraca też czas rejestracji (null — brak planu w rekordach).
 */
export function checkAbPlan(records) {
  const problems = [];
  const plans = records.filter((o) => o.k === 'p' && o.id === AB_DESIGN.id);
  const want = canonical(AB_DESIGN);
  for (const p of plans) if (canonical(p.catalog) !== want) problems.push(`${p.id}: plan A/B różni się od kodu (src/utils/abTest.ts)`);
  if (new Set(plans.map((p) => p.catalogHash)).size > 1) problems.push(`${AB_DESIGN.id}: kilka różnych planów pod jednym identyfikatorem`);
  const registeredAt = plans.length && typeof plans[0].t === 'number' ? plans[0].t : null;
  if (registeredAt !== null) {
    const early = records.filter((o) => o.k === 'f' && o.variant === 'B' && o.ti < registeredAt);
    if (early.length) problems.push(`wariant B przed prerejestracją planu: ${early.length} (np. ${early[0].id})`);
  }
  return { problems, registeredAt };
}

/**
 * Plan oceny zaufania kota (rekord `k: 'p'`, id TRUST_DESIGN.id): zapisany plan identyczny z planem w kodzie, jeden hash
 * dla identyfikatora. Gdy rekord planu jest wśród sprawdzanych (pełny klon albo plan z ostatnich dni), ocena jest
 * przeliczana z kompletu godzin po rejestracji: pełne godziny kota z rozstrzygnięciem, bez unieważnionych — ten sam,
 * publiczny kod co podsumowanie. Plan spoza zakresu → `trust` null (nie wszystkie godziny w rekordach).
 */
export function checkTrust(records) {
  const problems = [];
  const plans = records.filter((o) => o.k === 'p' && o.id === TRUST_DESIGN.id);
  const want = canonical(TRUST_DESIGN);
  for (const p of plans) if (canonical(p.catalog) !== want) problems.push(`${p.id}: plan zaufania różni się od kodu (src/utils/schrodiTrust.ts)`);
  if (new Set(plans.map((p) => p.catalogHash)).size > 1) problems.push(`${TRUST_DESIGN.id}: kilka różnych planów pod jednym identyfikatorem`);
  const p = plans[0];
  const plan = p && typeof p.t === 'number' ? { id: TRUST_DESIGN.id, hash: String(p.hash), at: p.t } : null;
  if (!plan) return { problems, plan: null, trust: null };
  const res = new Map();
  for (const o of records) if (o.k === 'r') res.set(o.id, o);
  const hours = [];
  for (const o of records) {
    if (o.k !== 'f' || o.kind !== 'cat') continue;
    const r = res.get(o.id);
    if (!r || r.void || typeof r.hi !== 'number') continue;
    const h = trustHour(o, r);
    if (h) hours.push(h);
  }
  return { problems, plan, trust: catTrust(hours, plan) };
}

/**
 * Plan oceny godziny na żywo (rekord `k: 'p'`, id HOUR_DESIGN.id): jak plan zaufania — zgodny z kodem, jeden hash;
 * ocena przeliczona z zapisów z rozstrzygnięciem (bez unieważnionych), gdy rekord planu jest wśród sprawdzanych.
 */
export function checkHourTrust(records) {
  const problems = [];
  const plans = records.filter((o) => o.k === 'p' && o.id === HOUR_DESIGN.id);
  const want = canonical(HOUR_DESIGN);
  for (const p of plans) if (canonical(p.catalog) !== want) problems.push(`${p.id}: plan godziny na żywo różni się od kodu (src/utils/schrodiTrust.ts)`);
  if (new Set(plans.map((p) => p.catalogHash)).size > 1) problems.push(`${HOUR_DESIGN.id}: kilka różnych planów pod jednym identyfikatorem`);
  const p = plans[0];
  const plan = p && typeof p.t === 'number' ? { id: HOUR_DESIGN.id, hash: String(p.hash), at: p.t } : null;
  if (!plan) return { problems, plan: null, trust: null };
  const res = new Map();
  for (const o of records) if (o.k === 'r') res.set(o.id, o);
  const rows = [];
  for (const o of records) {
    if (o.k !== 'f' || o.kind !== 'hour') continue;
    const r = res.get(o.id);
    if (r && !r.void && typeof r.hi === 'number') rows.push(hourRow(o, r));
  }
  return { problems, plan, trust: hourTrust(rows, plan) };
}

/**
 * Kalibracja kota `cat-cal-v1` (pole `cal` rekordów kota): plan zapisany w dzienniku identyczny ze stałymi w kodzie
 * (src/utils/catCal.ts), jeden hash, żaden rekord z `cal` przed planem; `cal` każdej prognozy przeliczone tutaj,
 * własną implementacją (nie kodem skanera), z par rozstrzygniętych wcześniej w dzienniku: prognozy kota z tym samym `mh`,
 * rekord rozstrzygnięcia w kolejności dziennika przed prognozą, bez `void`, t − 14 dni ≤ t_i < t. Zgodność: n i nT
 * dokładnie, a i d do 1e-5, p do 1e-4. Po planie przy co najmniej 96 parach rekord musi mieć `cal`. `since` (tryb szybki):
 * prognozy, których okno 14 dni sięga przed pierwszy pobrany dzień, są pomijane (pary sprzed niego nie są znane).
 */
export function checkCatCal(records, { since = null } = {}) {
  const problems = [];
  const D = CAT_CAL_DESIGN;
  const plans = records.map((o, i) => [o, i]).filter(([o]) => o.k === 'p' && o.id === D.id);
  const want = canonical(D);
  for (const [o] of plans) if (canonical(o.catalog) !== want) problems.push(`${o.id}: plan kalibracji różni się od kodu (src/utils/catCal.ts)`);
  if (new Set(plans.map(([o]) => o.catalogHash)).size > 1) problems.push(`${D.id}: kilka różnych planów pod jednym identyfikatorem`);
  const planIdx = plans.length ? plans[0][1] : null;
  const DAY = 86_400_000;
  const sig = (x) => 1 / (1 + Math.exp(-x));
  const lg = (p) => {
    const q = Math.min(1 - D.logitClip, Math.max(D.logitClip, p));
    return Math.log(q / (1 - q));
  };
  const weekendOf = (t) => [0, 6].includes((((Math.floor(t / DAY) + 4) % 7) + 7) % 7);
  const newton = (zs, ys, off, v) => {
    let x = 0;
    for (let k = 0; k < D.newtonSteps; k++) {
      let g = -x / v;
      let h = -1 / v;
      zs.forEach((z, i) => {
        const q = sig(z + off + x);
        g += ys[i] - q;
        h -= q * (1 - q);
      });
      x -= g / h;
    }
    return x;
  };
  const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
  const cats = new Map();
  /** Pary w kolejności dziennika: rozstrzygnięcia kota (bez void) z danymi prognozy */
  const pairs = [];
  let checked = 0;
  let skipped = 0;
  records.forEach((o, i) => {
    if (o.k === 'r' && cats.has(o.id)) {
      const f = cats.get(o.id);
      if (!o.void && (o.yBig === 0 || o.yBig === 1)) pairs.push({ t: f.t, pBig: f.pBig, mh: f.mh, y: o.yBig });
      return;
    }
    if (o.k !== 'f' || o.kind !== 'cat') return;
    cats.set(o.id, o);
    const afterPlan = planIdx !== null && i > planIdx;
    if (o.cal !== undefined && !afterPlan) {
      problems.push(`${o.id}: cal przed planem ${D.id}`);
      return;
    }
    if (!afterPlan) return;
    if (since !== null && o.t - D.windowDays * DAY < since) {
      skipped++;
      return;
    }
    const s = pairs.filter((x) => x.mh === o.mh && x.t >= o.t - D.windowDays * DAY && x.t < o.t);
    if (s.length < D.minPairs) {
      if (o.cal !== undefined) problems.push(`${o.id}: cal przy ${s.length} parach (min. ${D.minPairs}) — cal.n ${o.cal.n}`);
      return;
    }
    if (o.cal === undefined) {
      problems.push(`${o.id}: brak cal przy ${s.length} parach`);
      return;
    }
    const zs = s.map((x) => lg(x.pBig));
    const ys = s.map((x) => x.y);
    const a = round(newton(zs, ys, 0, D.priorVar.a), 6);
    const we = weekendOf(o.t);
    const sub = s.map((x, k) => [x, k]).filter(([x]) => weekendOf(x.t) === we);
    const d = sub.length ? round(newton(sub.map(([, k]) => zs[k]), sub.map(([, k]) => ys[k]), a, D.priorVar.d), 6) : 0;
    const p = round(sig(lg(o.pBig) + Math.max(-D.clip, Math.min(D.clip, a + d))), 4);
    const c = o.cal;
    const bad = [];
    if (c.v !== D.id) bad.push(`cal.v ${c.v}`);
    if (c.n !== s.length) bad.push(`cal.n ${c.n} ≠ ${s.length}`);
    if (c.nT !== sub.length) bad.push(`cal.nT ${c.nT} ≠ ${sub.length}`);
    if (!(Math.abs(c.a - a) <= 1e-5)) bad.push(`cal.a ${c.a} ≠ ${a}`);
    if (!(Math.abs(c.d - d) <= 1e-5)) bad.push(`cal.d ${c.d} ≠ ${d}`);
    if (!(Math.abs(c.p - p) <= 1e-4 + 1e-12)) bad.push(`cal.p ${c.p} ≠ ${p}`);
    if (bad.length) problems.push(`${o.id}: ${bad.join(', ')}`);
    else checked++;
  });
  return since === null ? { problems, checked } : { problems, checked, skipped };
}

/** Koniec ostatniej godziny docelowej `hrel-v1` (hs + 4 h) */
const hrelEnd = (fc) => fc.t + 4 * HOUR_MS;

/**
 * Prognoza `hrel-v1` (rekordy `kind: 'hrel'`): plan zapisany w dzienniku identyczny z kodem (src/utils/hourRel.ts),
 * jeden hash, żaden rekord przed planem; rekord raz na godzinę (hs = pełna godzina, wydany najpóźniej hs + 15 min),
 * p przeliczone tutaj z zapisanych cech i wag planu (do 1e-4); rozstrzygnięcie nie przed hs + 4 h, y = [rng > thr]
 * z wartości zapisanych, null tylko razem (rng i y) i dopiero 6 h po hs + 4 h. Progi i cechy ze świec — `checkHrelMarket`.
 * `since` (tryb szybki): bez planu w pobranych dniach kolejność wobec planu nie jest sprawdzana.
 */
export function checkHrel(records, { since = null } = {}) {
  const problems = [];
  const D = HREL_DESIGN;
  const plans = records.map((o, i) => [o, i]).filter(([o]) => o.k === 'p' && o.id === D.id);
  const want = canonical(D);
  for (const [o] of plans) if (canonical(o.catalog) !== want) problems.push(`${o.id}: plan różni się od kodu (src/utils/hourRel.ts)`);
  if (new Set(plans.map(([o]) => o.catalogHash)).size > 1) problems.push(`${D.id}: kilka różnych planów pod jednym identyfikatorem`);
  const planIdx = plans.length ? plans[0][1] : null;
  // Wagi z planu zapisanego w dzienniku (zgodność z kodem sprawdzona wyżej)
  const w = plans.length && Array.isArray(plans[0][0].catalog?.weights) ? plans[0][0].catalog.weights : D.weights;
  const prob = (x, wj) => {
    let s = wj[0];
    for (let i = 0; i < 3; i++) s += wj[i + 1] * x[i];
    return Math.round((1 / (1 + Math.exp(-s))) * 1e4) / 1e4;
  };
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const fcs = new Map();
  let checked = 0;
  let resolved = 0;
  records.forEach((o, i) => {
    if (o.k === 'f' && o.kind === 'hrel') {
      fcs.set(o.id, o);
      if (planIdx === null ? since === null : i < planIdx) {
        problems.push(`${o.id}: rekord przed planem ${D.id}`);
        return;
      }
      const bad = [];
      if (!isNum(o.t) || o.t % HOUR_MS !== 0 || o.id !== `${o.t}-hrel`) bad.push('t ≠ pełna godzina z identyfikatora');
      if (!(o.ti >= o.t && o.ti - o.t <= D.maxLateMin * MIN_MS)) bad.push(`wydanie ${Math.round((o.ti - o.t) / 1000)} s po hs (dozwolone 0–${D.maxLateMin} min)`);
      if (o.model !== D.model || o.plan !== D.id) bad.push('model / plan');
      const xOk = Array.isArray(o.x) && o.x.length === 3 && o.x.every((v) => isNum(v) && Math.abs(v) <= D.zClip + 1e-12);
      if (!xOk) bad.push('x');
      if (!(Array.isArray(o.thr) && o.thr.length === 4 && o.thr.every((v) => isNum(v) && v >= 0))) bad.push('thr');
      if (!(Array.isArray(o.p) && o.p.length === 4)) bad.push('p');
      else if (xOk) for (let j = 0; j < 4; j++) if (!(Math.abs(o.p[j] - prob(o.x, w[j])) <= 1e-4 + 1e-12)) bad.push(`p[${j}] ${o.p[j]} ≠ ${prob(o.x, w[j])}`);
      if (bad.length) problems.push(`${o.id}: ${bad.join(', ')}`);
      else checked++;
      return;
    }
    if (o.k !== 'r' || !fcs.has(o.id)) return;
    const fc = fcs.get(o.id);
    const end = hrelEnd(fc);
    if (!(o.t >= end)) {
      problems.push(`${o.id}: rozstrzygnięcie przed zamknięciem godziny hs + 3 h`);
      return;
    }
    if (o.void) {
      if (!(o.t >= end + VOID_MS)) problems.push(`${o.id}: unieważnienie przed upływem 6 h`);
      return;
    }
    if (!(Array.isArray(o.rng) && o.rng.length === 4 && Array.isArray(o.y) && o.y.length === 4)) {
      problems.push(`${o.id}: rng / y`);
      return;
    }
    const bad = [];
    for (let j = 0; j < 4; j++) {
      if (o.rng[j] === null || o.y[j] === null) {
        if (o.rng[j] !== null || o.y[j] !== null) bad.push(`y[${j}] / rng[${j}]: null tylko razem`);
        else if (!(o.t >= end + VOID_MS)) bad.push(`brak godziny ${j} przed upływem 6 h`);
        continue;
      }
      const y = o.rng[j] > fc.thr[j] ? 1 : 0;
      if (!(isNum(o.rng[j]) && o.rng[j] >= 0)) bad.push(`rng[${j}]`);
      else if (o.y[j] !== y) bad.push(`y[${j}] = ${o.y[j]} ≠ [rng > thr] = ${y}`);
    }
    if (bad.length) problems.push(`${o.id}: ${bad.join(', ')}`);
    else resolved++;
  });
  return { problems, checked, resolved };
}

/**
 * `hrel-v1` ze świecami 1h Hyperliquid (--market): progi (mediana zakresu tej samej godziny z 20 wcześniejszych dni
 * tego samego typu, do 80 dni wstecz), cechy r1, r3, r24 i zakresy godzin docelowych przeliczone tu ze świec.
 * `candles` — { time, high, low } (początek godziny). Prognozy, których okno (81 dni wstecz) wychodzi przed pobrane
 * świece, są pomijane. Zgodność: x do 1e-6, thr i rng do 1e-4 (zapis 6 i 4 miejsca).
 */
export function checkHrelMarket(records, candles) {
  const D = HREL_DESIGN;
  const bars = new Map(candles.filter((c) => c.time % HOUR_MS === 0).map((c) => [c.time, c]));
  const first = Math.min(...bars.keys());
  const last = Math.max(...bars.keys());
  const weekend = (t) => [0, 6].includes(new Date(t).getUTCDay());
  const range = (c) => Math.log(c.high / c.low) * 1e4;
  const thrOf = (u) => {
    const xs = [];
    for (let k = 1; k <= D.lookbackDays && xs.length < D.thresholdDays; k++) {
      const c = weekend(u - k * DAY_MS) === weekend(u) ? bars.get(u - k * DAY_MS) : undefined;
      if (c) xs.push(range(c));
    }
    if (xs.length < D.thresholdDays) return null;
    xs.sort((a, b) => a - b);
    return (xs[D.thresholdDays / 2 - 1] + xs[D.thresholdDays / 2]) / 2;
  };
  const problems = [];
  let checked = 0;
  let resolved = 0;
  const fcs = new Map();
  for (const o of records) {
    if (o.k === 'f' && o.kind === 'hrel') {
      fcs.set(o.id, o);
      if (o.t - 25 * HOUR_MS - D.lookbackDays * DAY_MS < first || o.t > last + HOUR_MS) continue;
      const z = [];
      for (let k = 1; k <= 24; k++) {
        const c = bars.get(o.t - k * HOUR_MS);
        const thr = thrOf(o.t - k * HOUR_MS);
        if (!c || thr === null) break;
        const r = range(c);
        z.push(r > 0 ? Math.max(-D.zClip, Math.min(D.zClip, Math.log(r / thr))) : -D.zClip);
      }
      checked++;
      if (z.length < 24) {
        problems.push(`${o.id}: ze świec rynku brak cech (brak świecy albo progu) — rekord nie powinien powstać`);
        continue;
      }
      const x = [z[0], (z[0] + z[1] + z[2]) / 3, z.reduce((s, v) => s + v, 0) / 24];
      const thr = [0, 1, 2, 3].map((j) => thrOf(o.t + j * HOUR_MS));
      const bad = [];
      x.forEach((v, i) => !(Math.abs(Math.round(v * 1e6) / 1e6 - o.x[i]) <= 1e-6 + 1e-12) && bad.push(`x[${i}] ${o.x[i]} ≠ ${v.toFixed(6)}`));
      thr.forEach((v, j) => !(v !== null && Math.abs(v - o.thr[j]) <= 1e-4 + 1e-12) && bad.push(`thr[${j}] ${o.thr[j]} ≠ ${v === null ? 'brak' : v.toFixed(4)}`));
      if (bad.length) problems.push(`${o.id}: ${bad.join(', ')}`);
    } else if (o.k === 'r' && fcs.has(o.id) && !o.void && Array.isArray(o.rng)) {
      const fc = fcs.get(o.id);
      if (fc.t < first || fc.t + 3 * HOUR_MS > last) continue;
      resolved++;
      const bad = [];
      for (let j = 0; j < 4; j++) {
        const c = bars.get(fc.t + j * HOUR_MS);
        if (o.rng[j] === null) {
          if (c) bad.push(`rng[${j}] null mimo świecy rynku`);
          continue;
        }
        if (!c || !(Math.abs(range(c) - o.rng[j]) <= 1e-4 + 1e-12)) bad.push(`rng[${j}] ${o.rng[j]} ≠ ${c ? range(c).toFixed(4) : 'brak świecy'}`);
      }
      if (bad.length) problems.push(`${o.id}: ${bad.join(', ')}`);
    }
  }
  return { problems, checked, resolved };
}

/**
 * Prerejestracje katalogów (laboratorium folkloru, rekordy `k: 'p'`): `catalogHash` = SHA-256 kanonicznego JSON
 * zapisanego katalogu, czasy niemalejące. Łańcuch hashy i pokwitowania OTS dowodzą, że katalog istniał przed oceną.
 */
export function checkPreregs(records) {
  const problems = [];
  const preregs = [];
  let last = -Infinity;
  for (const o of records) {
    if (o.k !== 'p') continue;
    const id = String(o.id);
    if (!o.catalog || typeof o.catalog !== 'object') problems.push(`${id}: brak katalogu w rekordzie prerejestracji`);
    else if (createHash('sha256').update(canonical(o.catalog)).digest('hex') !== o.catalogHash) problems.push(`${id}: hash katalogu nie zgadza się z treścią`);
    if (typeof o.t !== 'number') problems.push(`${id}: brak czasu prerejestracji`);
    else {
      if (o.t < last) problems.push(`${id}: czas cofnięty względem poprzedniej prerejestracji`);
      last = Math.max(last, o.t);
    }
    preregs.push({ id, t: o.t, catalogHash: o.catalogHash });
  }
  return { problems, preregs };
}

/**
 * Ensemble model + rynek (rekordy mkt z polami `pe`/`ens` i `pr`/`rec`): p = σ(a + bm·logit p_model + bk·logit środek)
 * z zapisanych wag (logit z obcięciem do [1e-4, 1 − 1e-4], zaokrąglenie do 4 miejsc). Przy pełnym dzienniku (`full`)
 * wagi są dopasowywane ponownie tym samym, publicznym kodem (src/utils/ensemble.ts) na parach rozstrzygniętych w 30 dniach
 * przed wydaniem (wąski spread, z dala od progu, kolejność: czas rozstrzygnięcia, id) i muszą się zgadzać z zapisanymi —
 * dowód, że wagi powstały z przeszłości tą procedurą. `refitDays` — ile ostatnich dni wydań dopasowywać ponownie.
 */
export function checkEnsemble(records, { full = false, refitDays = 30 } = {}) {
  const fcs = new Map();
  const res = new Map();
  for (const o of records) {
    if (o.k === 'f' && o.kind === 'mkt') fcs.set(o.id, o);
    else if (o.k === 'r') res.set(o.id, o);
  }
  const pairs = [];
  for (const [id, fc] of fcs) {
    const r = res.get(id);
    if (r && r.near === 0 && (r.y === 0 || r.y === 1) && fc.bid !== null && fc.ask !== null && fc.ask - fc.bid <= MKT_MAX_SPREAD + 1e-12)
      pairs.push({ pm: fc.p, pk: (fc.bid + fc.ask) / 2, y: r.y, t: r.t, id });
  }
  pairs.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const logit = (p) => {
    const q = Math.min(1 - 1e-4, Math.max(1e-4, p));
    return Math.log(q / (1 - q));
  };
  const formula = (w, p, mid) => Math.round((1 / (1 + Math.exp(-(w.a + w.bm * logit(p) + w.bk * logit(mid))))) * 1e4) / 1e4;
  const sameW = (w, v) => w && v && w.n === v.n && Math.abs(w.a - v.a) <= 2e-6 && Math.abs(w.bm - v.bm) <= 2e-6 && Math.abs(w.bk - v.bk) <= 2e-6;
  const lastTi = Math.max(...[...fcs.values()].map((f) => f.ti ?? 0));
  const problems = [];
  let checked = 0;
  let refitted = 0;
  for (const fc of fcs.values()) {
    if (fc.pe === undefined) continue; // rekordy sprzed ensemble
    const sets = [['p_e', fc.pe, fc.ens, 'full'], ...(fc.rec !== undefined ? [['p_r', fc.pr, fc.rec, 'market']] : [])];
    let ok = true;
    for (const [name, val, w] of sets) {
      if (!w || ![w.a, w.bm, w.bk, w.n].every(Number.isFinite)) {
        problems.push(`${fc.id}: brak wag (${name})`);
        ok = false;
        continue;
      }
      if (fc.bid === null || fc.ask === null) {
        if (val !== null) {
          problems.push(`${fc.id}: ${name} bez notowania rynku`);
          ok = false;
        }
        continue;
      }
      const want = formula(w, fc.p, (fc.bid + fc.ask) / 2);
      if (!(Math.abs(want - val) <= 1e-4 + 1e-12)) {
        problems.push(`${fc.id}: ${name} ${val} ≠ ${want} ze wzoru i zapisanych wag`);
        ok = false;
      }
    }
    if (full && fc.ti >= lastTi - refitDays * 86_400_000) {
      for (const [name, , w, mode] of sets) {
        const fit = fitEnsemble(pairs, fc.ti, { mode });
        if (!sameW(w, fit)) {
          problems.push(`${fc.id}: wagi ${name} ≠ ponowne dopasowanie (${JSON.stringify(fit)})`);
          ok = false;
        }
      }
      refitted++;
    }
    if (ok) checked++;
  }
  return { problems, checked, refitted };
}

/** Partia slotu: prognozy główne ('') i „model vs rynek” ('m', wydawane później w slocie — osobne pokwitowanie). */
export const batchOf = (o) => (o.kind === 'mkt' ? 'm' : '');

/**
 * Pokwitowania slotów: dla każdej partii slotu z prognozą musi istnieć `.ots`, a jego skrót = hash ostatniej prognozy
 * partii. `getReceipt(slot, batch)` → bajty pliku albo null.
 */
export function checkReceipts(records, getReceipt) {
  const last = new Map();
  for (const o of records) if (o.k === 'f') last.set(`${o.slot}|${batchOf(o)}`, { slot: o.slot, batch: batchOf(o), hash: o.hash });
  const out = [];
  for (const { slot, batch, hash } of last.values()) {
    const name = `slot ${new Date(slot).toISOString()}${batch ? ` (partia ${batch})` : ''}`;
    const bytes = getReceipt(slot, batch);
    if (!bytes) {
      out.push(`${name}: brak pokwitowania`);
      continue;
    }
    if (otsDigestHex(bytes) !== hash) out.push(`${name}: skrót pokwitowania ≠ hash ostatniej prognozy partii`);
  }
  return out;
}

const PENDING = Buffer.from('83dfe30d2ef90c8e', 'hex');
const BITCOIN = Buffer.from('0588960d73d71901', 'hex');

class R {
  constructor(b, i = 0) {
    this.b = b;
    this.i = i;
  }
  byte() {
    if (this.i >= this.b.length) throw new Error('koniec danych OTS');
    return this.b[this.i++];
  }
  bytes(n) {
    if (this.i + n > this.b.length) throw new Error('koniec danych OTS');
    const o = this.b.subarray(this.i, this.i + n);
    this.i += n;
    return o;
  }
  varuint() {
    let v = 0;
    let m = 1;
    for (;;) {
      const x = this.byte();
      v += (x & 0x7f) * m;
      if (!(x & 0x80)) return v;
      m *= 128;
    }
  }
  varbytes() {
    return this.bytes(this.varuint());
  }
}

const UNARY = {
  0x02: (m) => createHash('sha1').update(m).digest(),
  0x03: (m) => createHash('ripemd160').update(m).digest(),
  0x08: (m) => createHash('sha256').update(m).digest(),
  0xf2: (m) => Buffer.from(m).reverse(),
  0xf3: (m) => Buffer.from(m.toString('hex'), 'ascii'),
};

/**
 * Przechodzi drzewo znacznika od wiadomości `msg`, stosując operacje (SHA-256, SHA-1, RIPEMD-160, append, prepend,
 * reverse, hexlify); zwraca poświadczenia z wiadomością w ich węźle. Operacja nieobsługiwana (np. Keccak) → gałąź bez
 * wiadomości (msg = null), struktura nadal czytana.
 */
function walk(r, msg, out) {
  for (;;) {
    let tag = r.byte();
    const more = tag === 0xff;
    if (more) tag = r.byte();
    const hex = msg ? msg.toString('hex') : null;
    if (tag === 0x00) {
      const t = Buffer.from(r.bytes(8));
      const payload = new R(Buffer.from(r.varbytes()));
      if (t.equals(PENDING)) out.push({ kind: 'pending', uri: payload.varbytes().toString('utf8'), msg: hex });
      else if (t.equals(BITCOIN)) out.push({ kind: 'bitcoin', height: payload.varuint(), msg: hex });
    } else if (tag === 0xf0 || tag === 0xf1) {
      const arg = Buffer.from(r.varbytes());
      walk(r, msg ? (tag === 0xf0 ? Buffer.concat([msg, arg]) : Buffer.concat([arg, msg])) : null, out);
    } else if (UNARY[tag]) {
      walk(r, msg ? UNARY[tag](msg) : null, out);
    } else if (tag === 0x67) {
      walk(r, null, out); // Keccak-256 — brak w bibliotece standardowej; gałąź pominięta przy weryfikacji
    } else throw new Error(`nieznany znacznik OTS 0x${tag.toString(16)}`);
    if (!more) return;
  }
}

/** Poświadczenia z pliku `.ots` (oczekujące — adres kalendarza; Bitcoin — wysokość bloku) z wiadomością w węźle. */
export function otsAttestations(bytes) {
  const b = Buffer.from(bytes);
  const hex = otsDigestHex(b);
  if (!hex) return [];
  const out = [];
  walk(new R(b, OTS_MAGIC.length + 34), Buffer.from(hex, 'hex'), out);
  return out;
}

/**
 * Ceny źródłowe rozstrzygnięć zgodne ze świecami 1m: zwrot — zamknięcia w t i t + h; dotknięcia — max/min w oknie.
 * `candles` — tablica { time, high, low, close } (czas otwarcia, ms).
 */
export function checkMarket(records, candles) {
  const byTime = new Map(candles.map((c) => [c.time, c]));
  const f = new Map(records.filter((o) => o.k === 'f').map((o) => [o.id, o]));
  const problems = [];
  let checked = 0;
  let eligible = 0;
  for (const r of records) {
    if (r.k !== 'r') continue;
    const fc = f.get(r.id);
    if (!fc || (fc.kind !== 'ret' && fc.kind !== 'touch' && fc.kind !== 'mkt' && fc.kind !== 'cat' && fc.kind !== 'hour')) continue;
    eligible++;
    let market = null; // ceny z rynku albo null, gdy poza zakresem pobranych świec
    if (fc.kind === 'ret') {
      const a = byTime.get(fc.t - MIN_MS);
      const b = byTime.get(fc.t + fc.h * MIN_MS - MIN_MS);
      if (a && b) market = { c0: a.close, c1: b.close };
    } else if (fc.kind === 'mkt') {
      const b = byTime.get(fc.t + fc.h * MIN_MS - MIN_MS);
      if (b) market = { c1: b.close };
    } else if (fc.kind === 'cat' || fc.kind === 'hour') {
      // Kot: okno od początku horyzontu; godzina na żywo: godzina zegara od `hs`
      const [s0, n] = fc.kind === 'cat' ? [fc.t, fc.h] : [fc.hs, 60];
      const a = byTime.get(s0 - MIN_MS);
      const b = byTime.get(s0 + n * MIN_MS - MIN_MS);
      const win = candles.filter((c) => c.time >= s0 && c.time + MIN_MS <= s0 + n * MIN_MS);
      if (a && b && win.length >= n) market = { c0: a.close, c1: b.close, hi: Math.max(...win.map((c) => c.high)), lo: Math.min(...win.map((c) => c.low)) };
    } else {
      const win = candles.filter((c) => c.time >= fc.t && c.time + MIN_MS <= fc.t + fc.h * MIN_MS);
      if (win.length >= fc.h) market = { hi: Math.max(...win.map((c) => c.high)), lo: Math.min(...win.map((c) => c.low)) };
    }
    if (!market) continue;
    checked++;
    if (r.void) problems.push(`${r.id}: unieważnione mimo kompletu świec rynku`);
    else if (fc.kind === 'ret' && (market.c0 !== r.c0 || market.c1 !== r.c1)) problems.push(`${r.id}: ceny ${r.c0}/${r.c1} ≠ świece ${market.c0}/${market.c1}`);
    else if (fc.kind === 'mkt' && market.c1 !== r.c1) problems.push(`${r.id}: cena ${r.c1} ≠ świeca ${market.c1}`);
    else if (fc.kind === 'touch' && (market.hi !== r.hi || market.lo !== r.lo)) problems.push(`${r.id}: max/min ${r.hi}/${r.lo} ≠ świece ${market.hi}/${market.lo}`);
    else if ((fc.kind === 'cat' || fc.kind === 'hour') && (market.c0 !== r.c0 || market.c1 !== r.c1 || market.hi !== r.hi || market.lo !== r.lo))
      problems.push(`${r.id}: ceny ${r.c0}/${r.c1}, max/min ${r.hi}/${r.lo} ≠ świece ${market.c0}/${market.c1}, ${market.hi}/${market.lo}`);
  }
  // Godzina na żywo: cechy drogi ceny (zakres, odległości od max/min, zmienność, zmiana) z pełnych minut przed slotem
  let hourFeatures = 0;
  for (const fc of f.values()) {
    if (fc.kind !== 'hour' || !Array.isArray(fc.x)) continue;
    const mins = [];
    for (let t = fc.hs; t < fc.slot; t += MIN_MS) {
      const c = byTime.get(t);
      if (!c) break;
      mins.push({ h: c.high, l: c.low, c: c.close });
    }
    if (mins.length !== (fc.slot - fc.hs) / MIN_MS) continue;
    const x = hourX(fc.px0, fc.thr, 0.5, 0.5, mins);
    hourFeatures++;
    if (!x || HOUR_FEATURES.slice(1, 6).some((k, i) => Math.abs(r6(x[k]) - fc.x[i + 1]) > 2e-6)) problems.push(`${fc.id}: cechy drogi ceny ≠ przeliczone ze świec`);
  }
  return { problems, checked, eligible, hourFeatures };
}

const NET_TIMEOUT_MS = 15_000;
const blockCache = new Map();
/** Dwa niezależne eksploratory z tym samym API (Esplora): blok liczy się tylko wtedy, gdy oba podają to samo. */
export const EXPLORERS = ['https://mempool.space/api', 'https://blockstream.info/api'];

async function explorerGet(url, as) {
  const res = await fetch(url, { signal: AbortSignal.timeout(NET_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return as === 'json' ? res.json() : (await res.text()).trim();
}

/** Wysokość bloku → { hash, czas, korzeń Merkle } (ten sam wynik da każdy węzeł Bitcoina); niezgodność eksploratorów = błąd. */
function bitcoinBlock(height) {
  if (!blockCache.has(height)) {
    const p = (async () => {
      const got = await Promise.all(
        EXPLORERS.map(async (base) => {
          const hash = await explorerGet(`${base}/block-height/${height}`, 'text');
          const b = await explorerGet(`${base}/block/${hash}`, 'json');
          return { hash, time: b.timestamp * 1000, merkleRoot: b.merkle_root };
        })
      );
      if (got.some((b) => b.hash !== got[0].hash || b.merkleRoot !== got[0].merkleRoot || b.time !== got[0].time))
        throw new Error(`eksploratory podają różne bloki ${height}`);
      return got[0];
    })();
    p.catch(() => blockCache.delete(height)); // błąd sieci — bez zapamiętywania
    blockCache.set(height, p);
  }
  return blockCache.get(height);
}

/** Czas zakotwiczenia w Bitcoinie (ms) dla pliku .ots: poświadczenia z pliku i — dla oczekujących — z kalendarza; null = brak. */
export async function bitcoinTime(bytes) {
  let atts;
  try {
    atts = otsAttestations(bytes);
  } catch {
    return null; // uszkodzony albo nieobsługiwany plik — brak czasu z Bitcoina (nie przerywa weryfikacji)
  }
  const btc = atts.filter((a) => a.kind === 'bitcoin');
  for (const p of atts.filter((a) => a.kind === 'pending' && a.msg)) {
    try {
      // Adres kalendarza pochodzi z pliku — tylko https (odpowiedź i tak jest sprawdzana kryptograficznie)
      if (new URL(p.uri).protocol !== 'https:') continue;
      const res = await fetch(`${p.uri}/timestamp/${p.msg}`, {
        headers: { Accept: 'application/vnd.opentimestamps.v1' },
        signal: AbortSignal.timeout(NET_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const out = [];
      walk(new R(Buffer.from(await res.arrayBuffer())), Buffer.from(p.msg, 'hex'), out);
      btc.push(...out.filter((a) => a.kind === 'bitcoin'));
    } catch {
      // kalendarz niedostępny albo odpowiedź nieczytelna — próbujemy pozostałe
    }
  }
  let best = null;
  for (const a of btc) {
    if (!a.msg) continue;
    try {
      const blk = await bitcoinBlock(a.height);
      // Wiadomość w węźle poświadczenia = korzeń Merkle bloku (kolejność bajtów odwrócona względem zapisu w eksploratorze)
      if (Buffer.from(a.msg, 'hex').reverse().toString('hex') !== blk.merkleRoot) continue;
      if (best === null || blk.time < best) best = blk.time;
    } catch {
      // eksplorator niedostępny albo eksploratory się nie zgadzają — bez czasu z tego poświadczenia
    }
  }
  return best;
}

/** Wyniki opisowe przeliczone z rekordów. */
/**
 * Wyniki przeliczone z rekordów. `since` (tryb szybki — tylko ostatnie dni): okresy A/B zaczęte przed pierwszym
 * pobranym dniem oznaczone `partial` i bez przedziału (pełna ocena — z klonem `--dir`).
 */
export function recompute(records, { since } = {}) {
  const f = new Map();
  const r = new Map();
  for (const o of records) {
    if (o.k === 'f') f.set(o.id, o);
    else if (o.k === 'r') r.set(o.id, o);
  }
  const ret = {};
  /** Pary A/B (1 h): CRPS z kwantyli obu wersji na tym samym zwrocie; abRowsC — pary A i C */
  const abRows = [];
  const abRowsC = [];
  let lastT = 0;
  for (const o of records) if (typeof o.t === 'number' && o.t > lastT) lastT = o.t;
  let touchN = 0;
  let brierSum = 0;
  /** Dotknięcia z σ bazy odległości: Brier modelu i bazy na tych samych parach */
  const dist = { n: 0, model: 0, base: 0 };
  const cat = { n: 0, brierDir: 0, brierBig: 0, hitDir: 0, hitBig: 0 };
  const market = { n: 0, brierModel: 0, brierMarket: 0, nEns: 0, brierEns: 0 };
  const marketTight = { n: 0, brierModel: 0, brierMarket: 0, nEns: 0, brierEns: 0 };
  for (const [id, fc] of f) {
    const res = r.get(id);
    if (!res || res.void) continue;
    if (fc.kind === 'ret') {
      // Wariant B (A/B) osobno — wyniki wersji głównej bez niego, jak w podsumowaniu
      const s = (ret[fc.variant ? `${fc.h}-${fc.variant}` : fc.h] ??= { n: 0, crps: 0, crpsB: 0, in90: 0 });
      s.n++;
      s.crps += crps(fc.taus, fc.q, res.y);
      s.crpsB += crps(fc.taus, fc.bq, res.y);
      s.in90 += res.y >= quantileAt(fc.taus, fc.q, 0.05) && res.y <= quantileAt(fc.taus, fc.q, 0.95) ? 1 : 0;
      if (fc.variant === 'B' && fc.h === 60) {
        const a = f.get(String(id).slice(0, -1));
        const ra = a ? r.get(a.id) : undefined;
        if (a && ra && !ra.void) abRows.push({ slot: fc.slot, crpsA: crps(a.taus, a.q, ra.y), crpsB: crps(fc.taus, fc.q, res.y) });
      }
      if (fc.variant === 'C' && fc.h === 60) {
        const a = f.get(String(id).slice(0, -1));
        const ra = a ? r.get(a.id) : undefined;
        if (a && ra && !ra.void) abRowsC.push({ slot: fc.slot, crpsA: crps(a.taus, a.q, ra.y), crpsB: crps(fc.taus, fc.q, res.y) });
      }
    } else if (fc.kind === 'mkt') {
      if (res.near !== 0 || fc.bid === null || fc.ask === null) continue;
      const y = res.c1 >= fc.K ? 1 : 0;
      const add = (acc) => {
        acc.n++;
        acc.brierModel += (fc.p - y) ** 2;
        acc.brierMarket += ((fc.bid + fc.ask) / 2 - y) ** 2;
        if (typeof fc.pe === 'number') {
          acc.nEns++;
          acc.brierEns += (fc.pe - y) ** 2;
        }
      };
      if (fc.ask - fc.bid <= MKT_MAX_SPREAD + 1e-12) add(marketTight);
      if (fc.liquid) add(market);
    } else if (fc.kind === 'cat') {
      const yDir = res.c1 > res.c0 ? 1 : 0;
      const yBig = Math.log(res.hi / res.lo) * 1e4 > fc.thr ? 1 : 0;
      cat.n++;
      cat.brierDir += (fc.pUp - yDir) ** 2;
      cat.brierBig += (fc.pBig - yBig) ** 2;
      cat.hitDir += (fc.pUp > 0.5 ? 1 : 0) === yDir ? 1 : 0;
      cat.hitBig += (fc.pBig > 0.5 ? 1 : 0) === yBig ? 1 : 0;
    } else if (fc.kind === 'touch') {
      for (const l of ['pdh', 'pdl', 'deq']) {
        if (fc.p[l] === null) continue; // poziom już przekroczony przy wydaniu — nieoceniany
        brierSum += (fc.p[l] - res.yv[l]) ** 2;
        touchN++;
        const ret60 = f.get(`${fc.slot}-ret60`);
        const pd = distTouchProb(fc, l, ret60 && !ret60.variant ? ret60 : null);
        if (pd === null) continue;
        dist.n++;
        dist.model += (fc.p[l] - res.yv[l]) ** 2;
        dist.base += (pd - res.yv[l]) ** 2;
      }
    }
  }
  return {
    ret: Object.fromEntries(Object.entries(ret).map(([h, s]) => [h, { n: s.n, crps: s.crps / s.n, crpss: 1 - s.crps / s.crpsB, cov90: s.in90 / s.n }])),
    touch: {
      levels: touchN,
      brier: touchN ? brierSum / touchN : null,
      levelsDist: dist.n,
      brierDist: dist.n ? dist.base / dist.n : null,
      bssDist: dist.n && dist.base > 0 ? 1 - dist.model / dist.base : null,
    },
    cat: cat.n
      ? { n: cat.n, brierDir: cat.brierDir / cat.n, brierBig: cat.brierBig / cat.n, hitDir: cat.hitDir / cat.n, hitBig: cat.hitBig / cat.n }
      : { n: 0 },
    market: {
      n: market.n,
      brierModel: market.n ? market.brierModel / market.n : null,
      brierMarket: market.n ? market.brierMarket / market.n : null,
      nEns: market.nEns,
      brierEns: market.nEns ? market.brierEns / market.nEns : null,
    },
    marketTight: {
      n: marketTight.n,
      brierModel: marketTight.n ? marketTight.brierModel / marketTight.n : null,
      brierMarket: marketTight.n ? marketTight.brierMarket / marketTight.n : null,
      nEns: marketTight.nEns,
      brierEns: marketTight.nEns ? marketTight.brierEns / marketTight.nEns : null,
    },
    // Okresy oceny A/B (bloki 14 dni od AB_EPOCH) na chwilę ostatniego rekordu
    ab: (() => {
      const ab = abBlocks(abRows, lastT);
      const cut = (b) => (b && since !== undefined && b.start < since ? { ...b, diff: null, partial: true } : b);
      return { current: cut(ab.current), closing: cut(ab.closing), last: cut(ab.last) };
    })(),
    // Wariant C: okresy od pierwszej granicy po rejestracji planu ab-v2 (bez planu w rekordach — bez oceny)
    abC: (() => {
      const plan = records.find((o) => o.k === 'p' && o.id === AB_DESIGN_C.id && typeof o.t === 'number');
      if (!plan) return null;
      const first = abFirstBlock(plan.t);
      const ab = abBlocks(
        abRowsC.filter((x) => x.slot >= first),
        lastT
      );
      const keep = (b) => (b && b.start >= first ? (since !== undefined && b.start < since ? { ...b, diff: null, partial: true } : b) : null);
      return { firstBlock: first, current: keep(ab.current), closing: keep(ab.closing), last: keep(ab.last) };
    })(),
    // Jak w podsumowaniu: unieważnienia wersji głównej (warianty i hrel-v1 mają własne sekcje)
    voided: [...r.values()].filter((x) => x.void && !f.get(x.id)?.variant && f.get(x.id)?.kind !== 'hrel').length,
    skipped: records.filter((o) => o.k === 's').reduce((n, o) => n + (typeof o.until === 'number' ? Math.round((o.until - o.slot) / SLOT_MS) + 1 : 1), 0),
  };
}

/** Polska odmiana liczebnika: 1 linia, 2 linie, 5 linii (12–14 jak 5) */
export const plural = (n, one, few, many) =>
  `${n} ${n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? few : many}`;

const days = (from, to) => {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

/**
 * Czytnik obiektów git — jeden proces `git cat-file --batch` na cały przebieg, pytania po jednym obiekcie.
 * `pair(przed, po, fn)` czyta obie wersje pliku i oddaje je `fn` tylko na czas wywołania; następne pytanie idzie
 * dopiero po nim, więc naraz w pamięci jest najwyżej jedna para (stała pamięć względem długości historii).
 * `stats()` — szczyt bajtów trzymanych naraz (bufor wyjścia git + wypożyczona para), bajty łącznie, liczba par.
 */
export function catFileReader(dir) {
  const proc = spawn('git', ['-C', dir, 'cat-file', '--batch'], { stdio: ['pipe', 'pipe', 'ignore'] });
  /** Nieprzeczytane wyjście git (fragmenty) i ich łączna długość */
  const chunks = [];
  let queued = 0;
  let lentBytes = 0;
  let peakBytes = 0;
  let totalBytes = 0;
  let pairs = 0;
  let failure = null;
  let wake = null;
  const notify = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  proc.stdout.on('data', (d) => {
    chunks.push(d);
    queued += d.length;
    peakBytes = Math.max(peakBytes, queued + lentBytes);
    notify();
  });
  proc.stdout.on('end', () => {
    failure ??= new Error('git cat-file: koniec wyjścia');
    notify();
  });
  const fail = (e) => {
    failure = e;
    notify();
  };
  proc.on('error', fail);
  proc.stdin.on('error', fail); // git zakończony (EPIPE) — błąd przebiegu, nie nieobsłużony wyjątek
  const exited = new Promise((resolve) => proc.on('close', resolve));
  const waitFor = async (ready) => {
    while (!ready()) {
      if (failure) throw failure;
      await new Promise((r) => (wake = r));
    }
  };
  const take = (n) => {
    const out = Buffer.allocUnsafe(n);
    for (let off = 0; off < n; ) {
      const c = chunks[0];
      const k = Math.min(c.length, n - off);
      c.copy(out, off, 0, k);
      off += k;
      if (k === c.length) chunks.shift();
      else chunks[0] = c.subarray(k);
    }
    queued -= n;
    return out;
  };
  const newline = () => {
    let pos = 0;
    for (const c of chunks) {
      const i = c.indexOf(10);
      if (i >= 0) return pos + i;
      pos += c.length;
    }
    return -1;
  };
  /** Treść obiektu albo null („missing” — brak obiektu) */
  const read = async (oid) => {
    proc.stdin.write(`${oid}\n`);
    await waitFor(() => newline() >= 0);
    const header = take(newline() + 1).toString('utf8').trim();
    const [, type, size] = header.split(' ');
    if (type !== 'blob') return null;
    const n = Number(size);
    await waitFor(() => queued >= n + 1);
    const body = take(n);
    take(1); // znak nowej linii po treści
    lentBytes += n;
    totalBytes += n;
    return body;
  };
  return {
    async pair(before, after, fn) {
      const a = await read(before);
      const b = await read(after);
      pairs++;
      peakBytes = Math.max(peakBytes, queued + lentBytes);
      try {
        return fn(a, b);
      } finally {
        lentBytes = 0; // para oddana — następna czytana dopiero teraz
      }
    },
    async close() {
      if (!proc.stdin.writableEnded) proc.stdin.end();
      await exited;
    },
    stats: () => ({ peakBytes, totalBytes, pairs }),
  };
}

/**
 * Historia git (--dir): każdy kolejny commit tylko dopisuje do plików dziennika (`.jsonl`) poprzedniego commita —
 * zmieniony plik zaczyna się bajt w bajt od poprzedniej treści, żaden nie znika. Sprawdzane tylko pliki zmienione
 * w danym commicie (jeden `git diff-tree --stdin` dla wszystkich par), więc koszt rośnie z liczbą zmian, nie z liczbą
 * commitów × plików; zawsze cała historia. `anchor` — kotwica: commit ostatniej udanej weryfikacji, który musi nadal
 * należeć do historii gałęzi — inaczej historia została przepisana (nowa, sama w sobie spójna historia nie zdradza
 * podmiany). Wersje plików porównywane parami przez `reader` (domyślnie `catFileReader`) — pamięć nie rośnie z długością
 * historii.
 */
export async function checkGitAppendOnly(dir, { anchor = null, reader = null } = {}) {
  const git = (args, input) => execFileSync('git', ['-C', dir, ...args], { input, maxBuffer: 1024 * 1024 * 1024 });
  const commits = git(['log', '--format=%H', '--reverse']).toString('utf8').split('\n').filter(Boolean);
  const problems = [];
  if (anchor && !commits.includes(anchor)) problems.push(`kotwica ${anchor.slice(0, 10)} (ostatnio zweryfikowany commit): brak w historii gałęzi — historia przepisana`);
  const pairs = [];
  for (let i = 1; i < commits.length; i++) pairs.push(`${commits[i]} ${commits[i - 1]}`);
  /** Zmiany plików dziennika: [commit, status, blob przed, blob po, ścieżka] */
  const changes = [];
  if (pairs.length) {
    let cur = null;
    for (const l of git(['diff-tree', '--stdin', '-r', '--no-renames', '--no-abbrev'], `${pairs.join('\n')}\n`).toString('utf8').split('\n')) {
      if (/^[0-9a-f]{40}$/.test(l)) cur = l;
      else if (l.startsWith(':')) {
        const [meta, file] = l.split('\t');
        const [, , before, after, status] = meta.split(' ');
        if (file.endsWith('.jsonl') && status !== 'A') changes.push([cur, status, before, after, file]);
      }
    }
  }
  const blobs = reader ?? catFileReader(dir);
  try {
    for (const [commit, status, before, after, file] of changes) {
      if (status === 'D') {
        problems.push(`${commit.slice(0, 10)}: usunięto ${file}`);
        continue;
      }
      const appended = await blobs.pair(before, after, (a, b) => !!a && !!b && b.length >= a.length && b.subarray(0, a.length).equals(a));
      if (!appended) problems.push(`${commit.slice(0, 10)}: zmieniono zapisane linie w ${file}`);
    }
  } finally {
    if (!reader) await blobs.close(); // czytnik z zewnątrz zamyka wywołujący
  }
  return { commits: commits.length, checked: pairs.length, anchor, problems };
}

async function main() {
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf('--dir');
  const local = dirIdx >= 0 ? path.resolve(args[dirIdx + 1]) : null;
  const files = [];
  if (local) {
    const dir = path.join(local, 'BTC');
    for (const f of readdirSync(dir).filter((x) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(x)).sort()) files.push([f, readFileSync(path.join(dir, f), 'utf8')]);
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const from = args[0] ?? new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    for (const d of days(from, today)) {
      const res = await fetch(`${LEDGER_BASE}/BTC/${d}.jsonl`, { cache: 'no-store' });
      if (res.ok) files.push([`${d}.jsonl`, await res.text()]);
    }
  }
  if (files.length === 0) {
    console.log('Brak plików dziennika do sprawdzenia.');
    process.exitCode = 1;
    return;
  }
  const first = JSON.parse(files[0][1].split('\n').find(Boolean));
  // Pełny klon: łańcuch musi zaczynać się od GENESIS; tryb sieciowy (ostatnie dni) — od własnego prev pierwszego pliku
  let prev = local ? GENESIS : first.prev;
  const records = [];
  let ok = true;
  for (const [name, text] of files) {
    const lines = text.split('\n').filter(Boolean);
    const v = verifyChain(lines, prev);
    console.log(`${v.ok ? '✓' : '✗'} ${name}: ${plural(lines.length, 'linia', 'linie', 'linii')}${v.ok ? '' : ` — linia ${v.badLine + 1}: ${v.reason}`}`);
    if (!v.ok) {
      ok = false;
      break;
    }
    prev = v.head;
    for (const l of lines) records.push(JSON.parse(l));
  }
  // Tryb szybki: rozstrzygnięcia prognoz sprzed pierwszego pobranego dnia nie są błędem
  const order = checkOrdering(records, local ? {} : { since: Date.parse(`${files[0][0].slice(0, 10)}T00:00:00Z`) });
  console.log(order.length ? `✗ kolejność / spójność (${order.length}): ${order.slice(0, 5).join('; ')}` : '✓ kolejność i spójność rekordów');
  if (order.length) ok = false;
  const mismatch = checkResolutions(records);
  console.log(mismatch.length ? `✗ wyniki niezgodne z przeliczonymi (${mismatch.length}): ${mismatch.slice(0, 5).join('; ')}` : '✓ wyniki zgodne z przeliczonymi z kwantyli');
  if (mismatch.length) ok = false;
  const ens = checkEnsemble(records, { full: !!local });
  if (ens.checked || ens.problems.length)
    console.log(
      ens.problems.length
        ? `✗ ensemble (${ens.problems.length}): ${ens.problems.slice(0, 5).join('; ')}`
        : `✓ ensemble: ${plural(ens.checked, 'wydanie', 'wydania', 'wydań')} — p_e i p_r zgodne z zapisanymi wagami${ens.refitted ? `; wagi ostatnich wydań (${ens.refitted}) odtworzone ponownym dopasowaniem na pytaniach rozstrzygniętych przed wydaniem` : ''}`
    );
  if (ens.problems.length) ok = false;
  const ab = checkVariants(records);
  if (ab.checked || ab.problems.length)
    console.log(ab.problems.length ? `✗ wariant B (${ab.problems.length}): ${ab.problems.slice(0, 5).join('; ')}` : `✓ A/B: wariant B = wersja A × skala ze wzoru, te same chwile (${plural(ab.checked, 'prognoza', 'prognozy', 'prognoz')})`);
  if (ab.problems.length) ok = false;
  const plan = checkAbPlan(records);
  if (plan.registeredAt !== null || plan.problems.length)
    console.log(
      plan.problems.length
        ? `✗ plan A/B (${plan.problems.length}): ${plan.problems.slice(0, 5).join('; ')}`
        : `✓ plan A/B ${AB_DESIGN.id} prerejestrowany ${new Date(plan.registeredAt).toISOString().slice(0, 16)}Z, zgodny z kodem; wariant B wydawany po rejestracji`
    );
  if (plan.problems.length) ok = false;
  const vc = checkVariantC(records);
  if (vc.checked || vc.problems.length)
    console.log(
      vc.problems.length
        ? `✗ wariant C (${vc.problems.length}): ${vc.problems.slice(0, 5).join('; ')}`
        : `✓ A/B: wariant C = przekształcenie kwantyli A (świeży poziom zmienności, mieszanina skali) przeliczone niezależnie, te same chwile (${plural(vc.checked, 'prognoza', 'prognozy', 'prognoz')})`
    );
  if (vc.problems.length) ok = false;
  const planC = checkAbPlanC(records, { full: !!local });
  if (planC.registeredAt !== null || planC.problems.length)
    console.log(
      planC.problems.length
        ? `✗ plan wariantu C (${planC.problems.length}): ${planC.problems.slice(0, 5).join('; ')}`
        : `✓ plan A/B ${AB_DESIGN_C.id} prerejestrowany ${new Date(planC.registeredAt).toISOString().slice(0, 16)}Z, zgodny z kodem; wariant C wydawany po rejestracji`
    );
  if (planC.problems.length) ok = false;
  let catModel = null;
  try {
    catModel = JSON.parse(readFileSync(new URL('../public/schrodi/model-v1.json', import.meta.url), 'utf8'));
  } catch {
    // brak pliku modelu — rekordy kota zgłoszą brak przeliczenia
  }
  let touchModel = null;
  try {
    touchModel = JSON.parse(readFileSync(new URL('../public/schrodi/touch-v1.json', import.meta.url), 'utf8'));
  } catch {
    // brak pliku — rekordy z szansami dotknięcia zgłoszą brak przeliczenia
  }
  const cat = checkCat(records, catModel, touchModel);
  if (cat.checked || cat.problems.length)
    console.log(
      cat.problems.length
        ? `✗ Schrödi (${cat.problems.length}): ${cat.problems.slice(0, 5).join('; ')}`
        : `✓ Schrödi: ${plural(cat.checked, 'prognoza', 'prognozy', 'prognoz')} — p, szanse dotknięcia i stożek przeliczone z zapisanych cech publicznymi modelami, hashe modeli zgodne`
    );
  if (cat.problems.length) ok = false;
  const trust = checkTrust(records);
  if (trust.plan || trust.problems.length) {
    const e = (h) => `E = ${(10 ** h.lg).toPrecision(3)} (${plural(h.n, 'godzina', 'godziny', 'godzin')}${h.proofAt !== null ? `, dowód od ${new Date(h.proofAt).toISOString().slice(0, 13)}Z` : ''})`;
    const t = trust.trust;
    console.log(
      trust.problems.length
        ? `✗ plan zaufania kota (${trust.problems.length}): ${trust.problems.slice(0, 5).join('; ')}`
        : `✓ plan zaufania kota ${TRUST_DESIGN.id} prerejestrowany ${new Date(trust.plan.at).toISOString().slice(0, 16)}Z, zgodny z kodem` +
            (t
              ? `; przeliczone z rekordów — duży ruch ${e(t.big)}, kierunek ${e(t.dir)}, dotknięcia ${e(t.touch)}; dowód przy E ≥ ${TRUST_DESIGN.proof.threshold}; alarm dryfu: ${
                  ['big', 'dir', 'touch'].filter((k) => t[k].drift.alarm).join(', ') || 'brak'
                }`
              : '')
    );
  }
  if (trust.problems.length) ok = false;
  let hourModel = null;
  try {
    hourModel = JSON.parse(readFileSync(new URL('../public/schrodi/hour-v1.json', import.meta.url), 'utf8'));
  } catch {
    // brak pliku — zapisy godziny na żywo zgłoszą brak przeliczenia
  }
  const hour = checkHour(records, hourModel);
  if (hour.checked || hour.problems.length)
    console.log(
      hour.problems.length
        ? `✗ godzina na żywo (${hour.problems.length}): ${hour.problems.slice(0, 5).join('; ')}`
        : `✓ godzina na żywo: ${plural(hour.checked, 'zapis', 'zapisy', 'zapisów')} — cena, próg i szanse startowe z prognozy kota, p przeliczone z zapisanych cech publicznym modelem, hash zgodny`
    );
  if (hour.problems.length) ok = false;
  const hourPlan = checkHourTrust(records);
  if (hourPlan.plan || hourPlan.problems.length) {
    const b = hourPlan.trust?.big;
    console.log(
      hourPlan.problems.length
        ? `✗ plan godziny na żywo (${hourPlan.problems.length}): ${hourPlan.problems.slice(0, 5).join('; ')}`
        : `✓ plan godziny na żywo ${HOUR_DESIGN.id} prerejestrowany ${new Date(hourPlan.plan.at).toISOString().slice(0, 16)}Z, zgodny z kodem` +
            (b
              ? `; przeliczone z rekordów — duży ruch wobec samej drogi ceny E = ${(10 ** b.lg).toPrecision(3)} (${plural(b.n, 'godzina', 'godziny', 'godzin')}${b.proofAt !== null ? `, dowód od ${new Date(b.proofAt).toISOString().slice(0, 13)}Z` : ''}); alarm dryfu: ${b.drift.alarm ? 'tak' : 'brak'}`
              : '')
    );
  }
  if (hourPlan.problems.length) ok = false;
  const cal = checkCatCal(records, local ? {} : { since: Date.parse(`${files[0][0].slice(0, 10)}T00:00:00Z`) });
  if (cal.checked || cal.problems.length || cal.skipped)
    console.log(
      cal.problems.length
        ? `✗ kalibracja kota ${CAT_CAL_DESIGN.id} (${cal.problems.length}): ${cal.problems.slice(0, 5).join('; ')}`
        : `✓ kalibracja kota ${CAT_CAL_DESIGN.id}: ${plural(cal.checked, 'prognoza', 'prognozy', 'prognoz')} — a, d i p przeliczone z par rozstrzygniętych wcześniej w dzienniku, plan zgodny z kodem${cal.skipped ? `; pominięte (okno 14 dni sprzed pobranych dni): ${cal.skipped}` : ''}`
    );
  if (cal.problems.length) ok = false;
  const hrel = checkHrel(records, local ? {} : { since: Date.parse(`${files[0][0].slice(0, 10)}T00:00:00Z`) });
  if (hrel.checked || hrel.problems.length)
    console.log(
      hrel.problems.length
        ? `✗ prognoza ${HREL_DESIGN.id} (${hrel.problems.length}): ${hrel.problems.slice(0, 5).join('; ')}`
        : `✓ prognoza ${HREL_DESIGN.id}: ${plural(hrel.checked, 'rekord', 'rekordy', 'rekordów')} — p przeliczone z cech i wag planu, plan zgodny z kodem; rozstrzygnięcia: ${hrel.resolved}, y z rng i progów (progi i cechy ze świec: --market)`
    );
  if (hrel.problems.length) ok = false;
  const pre = checkPreregs(records);
  if (pre.preregs.length || pre.problems.length)
    console.log(
      pre.problems.length
        ? `✗ prerejestracje (${pre.problems.length}): ${pre.problems.slice(0, 5).join('; ')}`
        : `✓ prerejestracje (katalog laboratorium, plany ocen): ${pre.preregs.map((p) => `${p.id} ${new Date(p.t).toISOString().slice(0, 16)}Z (${String(p.catalogHash).slice(0, 12)}…)`).join(', ')}`
    );
  if (pre.problems.length) ok = false;
  console.log(`Głowa łańcucha: ${prev}`);
  const reportMeasures = (s) => {
    const mm = checkMeasures(s, records);
    if (!mm.checked && !mm.problems.length) console.log('ℹ podsumowanie bez miar z przedziałami (starsza wersja) — nic do porównania');
    else
      console.log(
        mm.problems.length
          ? `✗ miary podsumowania niezgodne z przeliczonymi (${mm.problems.length}): ${mm.problems.slice(0, 5).join('; ')}`
          : `✓ miary podsumowania (Kupiec 60%, PIT, przedziały CRPSS i BSS, BSS sezonowy kota, ACI) zgodne z przeliczonymi z rekordów: ${plural(mm.checked, 'pole', 'pola', 'pól')}`
      );
    if (mm.problems.length) ok = false;
  };
  const sumIdx = args.indexOf('--summary');
  if (local && sumIdx >= 0) {
    try {
      reportMeasures(JSON.parse(readFileSync(path.resolve(args[sumIdx + 1]), 'utf8')));
    } catch (e) {
      console.log(`✗ --summary: nie udało się wczytać podsumowania (${String(e?.message ?? e)})`);
      ok = false;
    }
  }

  if (local) {
    if (existsSync(path.join(local, '.git'))) {
      const anchorIdx = args.indexOf('--anchor');
      const anchor = anchorIdx >= 0 ? args[anchorIdx + 1] : null;
      if (anchor !== null && !/^[0-9a-f]{40}$/.test(anchor ?? '')) {
        console.log('✗ historia git: --anchor wymaga pełnego hasha commita (40 znaków hex)');
        ok = false;
      } else {
        const g = await checkGitAppendOnly(local, { anchor });
        const kept = g.anchor ? `; kotwica ${g.anchor.slice(0, 10)} (ostatnia weryfikacja) w historii` : '';
        console.log(g.problems.length ? `✗ historia git: ${g.problems.slice(0, 5).join('; ')}` : `✓ historia git: ${plural(g.commits, 'commit', 'commity', 'commitów')}, tylko dopisywanie${kept}`);
        if (g.problems.length) ok = false;
      }
    }
    const otsDir = path.join(local, 'BTC', 'ots');
    let daily = 0;
    let slots = 0;
    if (existsSync(otsDir)) {
      for (const f of readdirSync(otsDir).filter((x) => x.endsWith('.jsonl.ots'))) {
        const day = f.replace('.ots', '');
        const dataPath = path.join(local, 'BTC', day);
        if (!existsSync(dataPath)) continue;
        const want = createHash('sha256').update(readFileSync(dataPath)).digest('hex');
        if (otsDigestHex(readFileSync(path.join(otsDir, f))) !== want) {
          console.log(`✗ kotwica ${f}: skrót nie zgadza się z plikiem dnia`);
          ok = false;
        } else daily++;
      }
    }
    // Pokwitowania wymagane dla każdego slotu z prognozą (brak = problem, nie „0 zgodnych”)
    const receiptPath = (slot, batch = '') => path.join(otsDir, 'slots', new Date(slot).toISOString().slice(0, 10), `${slot}${batch ? `-${batch}` : ''}.ots`);
    const getReceipt = (slot, batch = '') => (existsSync(receiptPath(slot, batch)) ? readFileSync(receiptPath(slot, batch)) : null);
    const rec = checkReceipts(records, getReceipt);
    const groups = new Set(records.filter((o) => o.k === 'f').map((o) => `${o.slot}|${batchOf(o)}`)).size;
    slots = groups - rec.length;
    console.log(rec.length ? `✗ pokwitowania slotów (${rec.length}): ${rec.slice(0, 5).join('; ')}` : `✓ pokwitowania slotów (partie): ${slots}/${groups}`);
    if (rec.length) ok = false;
    console.log(`✓ kotwice dni zgodne: ${daily}`);

    if (args.includes('--bitcoin')) {
      // Czas z Bitcoina: poświadczenie (z pliku albo uzupełnione z kalendarza) → nagłówek bloku → czas; prognoza jest
      // dowiedziona blokiem, gdy blok jest wcześniejszy niż koniec jej horyzontu. Dla 1 h blok często przychodzi później —
      // wtedy dowodem przed faktem są kalendarze (niezależni operatorzy), a blok potwierdza je później.
      const bySlot = new Map();
      for (const o of records) if (o.k === 'f') bySlot.set(`${o.slot}|${batchOf(o)}`, [...(bySlot.get(`${o.slot}|${batchOf(o)}`) ?? []), o]);
      const stat = {};
      for (const fs of bySlot.values()) {
        const bytes = getReceipt(fs[0].slot, batchOf(fs[0]));
        if (!bytes) continue;
        const bt = await bitcoinTime(bytes);
        for (const fc of fs) {
          // Wariant B (A/B) dzieli pokwitowanie z wersją A — liczony raz, jako wersja główna
          if (fc.variant) continue;
          const key =
            fc.kind === 'mkt'
              ? 'rynek HIP-4 (15 min)'
              : fc.kind === 'cat'
                ? 'Schrödi (1 h)'
                : fc.kind === 'hour'
                  ? 'Schrödi, godzina na żywo'
                  : fc.kind === 'hrel'
                    ? `${HREL_DESIGN.id} (godziny hs … hs + 3 h)`
                    : `horyzont ${fc.h} min`;
          const s = (stat[key] ??= { n: 0, proven: 0, late: 0, pending: 0 });
          s.n++;
          if (bt === null) s.pending++;
          else if (bt + BLOCK_TIME_MARGIN_MS <= horizonEnd(fc)) s.proven++;
          else s.late++;
        }
      }
      for (const [label, s] of Object.entries(stat)) {
        console.log(
          `ℹ ${label} (${s.n}): blok Bitcoina przed rozstrzygnięciem (z zapasem 2 h na znacznik czasu bloku) ${s.proven}; ` +
            `blok później ${s.late} ` +
            `(przed faktem — tylko kalendarze OTS, zaufanie do ich operatorów); jeszcze bez bloku ${s.pending}`
        );
      }
    }
    if (args.includes('--market')) {
      // Ceny źródłowe vs publiczne świece 1m Hyperliquid (API udostępnia ok. 3.5 doby wstecz)
      const since = Date.now() - 3.4 * 86_400_000;
      let status = 'brak odpowiedzi';
      let candles = [];
      try {
        const res = await fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'candleSnapshot', req: { coin: 'BTC', interval: '1m', startTime: since } }),
          signal: AbortSignal.timeout(NET_TIMEOUT_MS),
        });
        status = `HTTP ${res.status}`;
        const raw = res.ok ? await res.json() : null;
        candles = (Array.isArray(raw) ? raw : []).map((c) => ({ time: c.t, high: Number(c.h), low: Number(c.l), close: Number(c.c) }));
      } catch (e) {
        status = String(e?.message ?? e);
      }
      if (candles.length === 0) {
        console.log(`✗ --market: nie udało się pobrać świec 1m z Hyperliquid (${status}) — ceny nie zostały sprawdzone`);
        ok = false;
      } else {
        const mk = checkMarket(records, candles);
        if (mk.problems.length) {
          console.log(`✗ ceny źródłowe niezgodne ze świecami (${mk.problems.length}): ${mk.problems.slice(0, 5).join('; ')}`);
          ok = false;
        } else if (mk.eligible === 0) console.log('ℹ --market: brak rozstrzygnięć do sprawdzenia');
        else if (mk.checked === 0) console.log(`ℹ --market: żadne z ${mk.eligible} rozstrzygnięć nie mieści się w zakresie świec 1m (~3.4 doby) — nic nie sprawdzono`);
        else console.log(`✓ ceny źródłowe zgodne ze świecami 1m: sprawdzone ${mk.checked}/${mk.eligible} (pozostałe starsze niż ~3.4 doby)${mk.hourFeatures ? `; cechy godziny na żywo ze świec: ${mk.hourFeatures}` : ''}`);
      }
      // hrel-v1: progi, cechy i zakresy ze świec 1h (API: do 5000 świec, tu ~104 dni)
      if (records.some((o) => o.k === 'f' && o.kind === 'hrel')) {
        let hours = [];
        let st = 'brak odpowiedzi';
        try {
          const res = await fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'candleSnapshot', req: { coin: 'BTC', interval: '1h', startTime: Date.now() - 2500 * HOUR_MS } }),
            signal: AbortSignal.timeout(NET_TIMEOUT_MS),
          });
          st = `HTTP ${res.status}`;
          const raw = res.ok ? await res.json() : null;
          // Świeca w toku pominięta (jej zakres jeszcze rośnie)
          hours = (Array.isArray(raw) ? raw : []).map((c) => ({ time: c.t, high: Number(c.h), low: Number(c.l) })).filter((c) => c.time + HOUR_MS <= Date.now());
        } catch (e) {
          st = String(e?.message ?? e);
        }
        if (hours.length === 0) {
          console.log(`✗ --market: nie udało się pobrać świec 1h z Hyperliquid (${st}) — ${HREL_DESIGN.id} nie sprawdzone ze świec`);
          ok = false;
        } else {
          const hm = checkHrelMarket(records, hours);
          if (hm.problems.length) {
            console.log(`✗ ${HREL_DESIGN.id} niezgodne ze świecami 1h (${hm.problems.length}): ${hm.problems.slice(0, 5).join('; ')}`);
            ok = false;
          } else console.log(`✓ ${HREL_DESIGN.id} ze świec 1h: progi i cechy ${hm.checked}, zakresy godzin ${hm.resolved} (starsze niż ~100 dni pominięte)`);
        }
      }
      // Wariant C: rv60 rekordów wobec świec 5m (API: do 5000 świec, ok. 17 dób)
      if (records.some((o) => o.k === 'f' && o.variant === 'C')) {
        let c5 = [];
        let st5 = 'brak odpowiedzi';
        try {
          const res = await fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'candleSnapshot', req: { coin: 'BTC', interval: '5m', startTime: Date.now() - 17 * 86_400_000 } }),
            signal: AbortSignal.timeout(NET_TIMEOUT_MS),
          });
          st5 = `HTTP ${res.status}`;
          const raw = res.ok ? await res.json() : null;
          c5 = (Array.isArray(raw) ? raw : []).map((c) => ({ time: c.t, close: Number(c.c) }));
        } catch (e) {
          st5 = String(e?.message ?? e);
        }
        if (c5.length === 0) {
          console.log(`✗ --market: nie udało się pobrać świec 5m z Hyperliquid (${st5}) — rv60 wariantu C nie zostało sprawdzone`);
          ok = false;
        } else {
          const rv = checkRv60(records, c5);
          if (rv.problems.length) {
            console.log(`✗ rv60 wariantu C niezgodne ze świecami 5m (${rv.problems.length}): ${rv.problems.slice(0, 5).join('; ')}`);
            ok = false;
          } else console.log(`✓ rv60 wariantu C zgodne ze świecami 5m: sprawdzone ${rv.checked}/${rv.eligible} (pozostałe poza zakresem świec)`);
        }
      }
    }
  } else {
    try {
      const s = await (await fetch(SUMMARY_URL, { cache: 'no-store' })).json();
      console.log(s?.head?.hash === prev ? '✓ głowa zgodna z podsumowaniem na stronie' : `ℹ podsumowanie wskazuje inną głowę (${String(s?.head?.hash).slice(0, 12)}…) — mogło zostać opublikowane przed/po ostatnim dopisaniu`);
      // Ta sama głowa = ten sam stan dziennika: ocena zaufania w podsumowaniu musi być identyczna z przeliczoną
      if (s?.head?.hash === prev && trust.trust && s?.cat?.trust) {
        const same = canonical(s.cat.trust) === canonical(trust.trust);
        console.log(same ? '✓ ocena zaufania kota w podsumowaniu zgodna z przeliczoną z rekordów' : '✗ ocena zaufania kota w podsumowaniu różni się od przeliczonej z rekordów');
        if (!same) ok = false;
      }
      if (s?.head?.hash === prev && hourPlan.trust && s?.cat?.hour) {
        const same = canonical(s.cat.hour) === canonical(hourPlan.trust);
        console.log(same ? '✓ ocena godziny na żywo w podsumowaniu zgodna z przeliczoną z rekordów' : '✗ ocena godziny na żywo w podsumowaniu różni się od przeliczonej z rekordów');
        if (!same) ok = false;
      }
      // Miary z oknem 30 dni i bazą sezonową (do ~70 dób wstecz): tylko gdy pobrane dni sięgają początku dziennika
      if (s?.head?.hash === prev) {
        if (first.prev === GENESIS || Date.parse(`${files[0][0].slice(0, 10)}T00:00:00Z`) <= s.asOf - 110 * 86_400_000) reportMeasures(s);
        else console.log('ℹ miary podsumowania nie porównane: potrzebny dziennik od początku (podaj datę pierwszego dnia albo użyj --dir … --summary)');
      }
    } catch {
      // brak podsumowania — nie wpływa na wynik
    }
  }
  const since = local ? undefined : Date.parse(`${files[0][0].slice(0, 10)}T00:00:00Z`);
  console.log('Wyniki przeliczone z rekordów:', JSON.stringify(recompute(records, { since }), null, 2));
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
