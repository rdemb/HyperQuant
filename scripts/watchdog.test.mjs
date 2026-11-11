import { describe, expect, it } from 'vitest';
import { assessHealth } from './check-data-health.mjs';
import { alertState, assessRun, dataBaseFromRemote, decide, decideAlerts, episodeRestarts, gitEnv, parsePulse, shouldPush } from './watchdog.mjs';

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 22, 14, 0);
const ok = { ok: true, problems: [], facts: [] };
const stale = { ok: false, problems: ['status.json: dane sprzed 45 min (próg 30 min) — skaner nie publikuje'], facts: [] };
/** Domyślnie: usługa działa od 2 h, bez wcześniejszych restartów strażnika */
const base = { now: NOW, localAsOf: NOW - MIN, serviceState: 'active', activeForMs: 120 * MIN, lastRestart: null, restarts: 0, publicCheck: true, health: ok };

describe('strażnik: decyzja o restarcie skanera', () => {
  it('skaner nie publikuje lokalnie > 10 min → restart; świeży → nic', () => {
    expect(decide({ ...base, localAsOf: NOW - 12 * MIN, health: stale })).toMatchObject({ restart: true, category: 'stall' });
    expect(decide(base)).toMatchObject({ restart: false, reason: null, category: null });
  });
  it('lokalnie świeży, ale publikacja / dziennik / rejestrator płynności stoją → restart', () => {
    for (const p of [
      stale.problems[0],
      'rejestrator płynności nie zapisuje minut od 40 min (brak arkusza z WebSocket?)',
      'dziennik prognoz: ostatnia aktualizacja 75 min temu (próg 60 min)',
      'profil płynności: ostatnia aktualizacja 45 min temu (próg 30 min)',
    ]) {
      expect(decide({ ...base, health: { ok: false, problems: [p], facts: [] } })).toMatchObject({ restart: true, category: 'stall' });
    }
  });
  it('błąd pobrania (sieć, GitHub), problem jakości (pokrycie OI) i stojące laboratorium nie restartują skanera', () => {
    for (const p of [
      'status.json: nie udało się pobrać (HTTP 503)',
      'pokrycie open interest 3% < 5% — skanowanie pozycji nie nadąża',
      'laboratorium folkloru: ostatnia aktualizacja 200 min temu (próg 180 min)',
    ]) {
      expect(decide({ ...base, health: { ok: false, problems: [p], facts: [] } })).toMatchObject({ restart: false, reason: null });
    }
  });
  it('usługa w stanie failed → restart najwyżej raz na godzinę', () => {
    expect(decide({ ...base, serviceState: 'failed', activeForMs: null })).toMatchObject({ restart: true, category: 'failed' });
    expect(decide({ ...base, serviceState: 'failed', activeForMs: null, lastRestart: NOW - 20 * MIN })).toMatchObject({ restart: false, category: 'failed' });
  });
  it('usługa zatrzymana ręcznie (inactive) → alarm bez restartu; stany przejściowe → nic', () => {
    expect(decide({ ...base, serviceState: 'inactive', activeForMs: null })).toMatchObject({ restart: false, category: 'inactive' });
    expect(decide({ ...base, serviceState: 'activating', activeForMs: null, health: stale })).toMatchObject({ restart: false, reason: null, category: null });
  });
  it('pierwsze 10 min działania usługi → nic; restart dopiero po godzinie działania (także po wdrożeniu właściciela)', () => {
    expect(decide({ ...base, localAsOf: NOW - 60 * MIN, activeForMs: 3 * MIN, health: stale })).toMatchObject({ restart: false, reason: null });
    const held = decide({ ...base, localAsOf: NOW - 30 * MIN, activeForMs: 40 * MIN, health: stale });
    expect(held).toMatchObject({ restart: false, category: 'stall' });
    expect(held.reason).toMatch(/godzin/);
  });
  it('stojące pliki publiczne liczą się dopiero po 30 min działania (opóźnienie publikacji i CDN)', () => {
    const h = { ok: false, problems: ['profil płynności: ostatnia aktualizacja 45 min temu (próg 30 min)'], facts: [] };
    expect(decide({ ...base, activeForMs: 20 * MIN, health: h })).toMatchObject({ restart: false, reason: null });
  });
  it('po 3 restartach w epizodzie bez poprawy → koniec restartów, kategoria giveup', () => {
    expect(decide({ ...base, localAsOf: NOW - 30 * MIN, restarts: 3, health: stale })).toMatchObject({ restart: false, category: 'giveup' });
    expect(decide({ ...base, serviceState: 'failed', activeForMs: null, restarts: 3 })).toMatchObject({ restart: false, category: 'giveup' });
  });
  it('bez repo danych (HQ_GIT_REMOTE puste) — tylko kontrole lokalne', () => {
    expect(decide({ ...base, publicCheck: false, health: stale })).toMatchObject({ restart: false, reason: null });
    expect(decide({ ...base, publicCheck: false, localAsOf: NOW - 30 * MIN })).toMatchObject({ restart: true });
  });
});

describe('strażnik: serwer powiadomień o alarmach', () => {
  const pulse = { at: NOW - MIN, syncAt: NOW - 5_000, wsAt: NOW - 2_000 };
  const svc = { now: NOW, pulse, serviceState: 'active', activeForMs: 120 * MIN, lastRestart: null, restarts: 0 };
  it('świeży puls → nic; stary puls, brak synchronizacji albo cisza Hyperliquid → restart', () => {
    expect(decideAlerts(svc)).toMatchObject({ restart: false, reason: null, category: null });
    expect(decideAlerts({ ...svc, pulse: { ...pulse, at: NOW - 6 * MIN } })).toMatchObject({ restart: true, category: 'stall' });
    expect(decideAlerts({ ...svc, pulse: { ...pulse, syncAt: NOW - 11 * MIN } }).reason).toMatch(/skrzynką od 11 min/);
    expect(decideAlerts({ ...svc, pulse: { ...pulse, wsAt: NOW - 6 * MIN } }).reason).toMatch(/Hyperliquid od 6 min/);
    expect(decideAlerts({ ...svc, pulse: null })).toMatchObject({ restart: true, category: 'stall' });
  });
  it('bez skrzynki i bez alarmów (null) cisza tych źródeł nie jest problemem', () => {
    expect(decideAlerts({ ...svc, pulse: { at: NOW - MIN, syncAt: null, wsAt: null } })).toMatchObject({ restart: false, reason: null });
  });
  it('te same zasady co dla skanera: 10 min po starcie, raz na godzinę, 3 restarty, zatrzymanej nie uruchamia', () => {
    expect(decideAlerts({ ...svc, pulse: null, activeForMs: 5 * MIN })).toMatchObject({ restart: false, reason: null });
    expect(decideAlerts({ ...svc, serviceState: 'failed', activeForMs: null })).toMatchObject({ restart: true, category: 'failed' });
    expect(decideAlerts({ ...svc, serviceState: 'failed', activeForMs: null, lastRestart: NOW - 20 * MIN })).toMatchObject({ restart: false, category: 'failed' });
    expect(decideAlerts({ ...svc, pulse: null, restarts: 3 })).toMatchObject({ restart: false, category: 'giveup' });
    expect(decideAlerts({ ...svc, serviceState: 'inactive', activeForMs: null })).toMatchObject({ restart: false, category: 'inactive' });
    expect(decideAlerts({ ...svc, serviceState: 'activating', pulse: null })).toMatchObject({ restart: false, reason: null });
  });
  it('puls z pliku: bez liczby czasu zapisu = brak pliku; pole bez liczby = brak źródła', () => {
    expect(parsePulse({ v: 1, at: NOW, syncAt: NOW - 1, wsAt: null })).toEqual({ at: NOW, syncAt: NOW - 1, wsAt: null });
    expect(parsePulse({ v: 1, at: 'x' })).toBeNull();
    expect(parsePulse(null)).toBeNull();
    expect(parsePulse({ at: NOW, syncAt: 'x' })).toEqual({ at: NOW, syncAt: null, wsAt: null });
  });
  it('problem serwera powiadomień w raporcie i w kluczu; bez niego klucz jak dawniej', () => {
    const none = { restart: false, reason: null, category: null };
    const da = { restart: true, reason: 'serwer powiadomień nie zapisał pulsu od 7 min', category: 'stall' };
    const a = alertState(ok, none, da);
    expect(a.ok).toBe(false);
    expect(a.problems).toEqual(['Strażnik zrestartował serwer powiadomień: serwer powiadomień nie zapisał pulsu od 7 min.']);
    expect(a.key).toBe('-|alarmy:stall');
    expect(alertState(stale, none, none).key).toBe(alertState(stale, none).key);
  });
});

describe('strażnik: stan alarmu i wysyłka', () => {
  it('restart w problemach raportu; klucz bez słów o restarcie i bez liczb', () => {
    const restarted = alertState(stale, { restart: true, reason: 'skaner nie publikował lokalnie od 12 min', category: 'stall' });
    const held = alertState(stale, { restart: false, reason: 'skaner nie publikował lokalnie od 27 min (restart wstrzymany)', category: 'stall' });
    expect(restarted.problems.join(' ')).toMatch(/zrestartował/);
    expect(restarted.key).toBe(held.key);
    expect(alertState(ok, { restart: false, reason: null, category: null })).toMatchObject({ ok: true, key: 'ok' });
  });
  it('różne treści błędu pobrania tego samego pliku → ten sam klucz', () => {
    const a = alertState({ ok: false, problems: ['status.json: nie udało się pobrać (HTTP 503)'], facts: [] }, { restart: false, reason: null, category: null });
    const b = alertState({ ok: false, problems: ['status.json: nie udało się pobrać (fetch failed)'], facts: [] }, { restart: false, reason: null, category: null });
    expect(a.key).toBe(b.key);
  });
  it('problem wysyłany dopiero po potwierdzeniu w kolejnym przebiegu; prywatność — od razu', () => {
    expect(shouldPush({ prevKey: 'ok', seenKey: 'ok', key: 'x', lastPushAt: NOW - MIN, ok: false, urgent: false, now: NOW })).toBe(false);
    expect(shouldPush({ prevKey: 'ok', seenKey: 'x', key: 'x', lastPushAt: NOW - MIN, ok: false, urgent: false, now: NOW })).toBe(true);
    expect(shouldPush({ prevKey: 'ok', seenKey: 'ok', key: 'p', lastPushAt: NOW - MIN, ok: false, urgent: true, now: NOW })).toBe(true);
  });
  it('trwały problem — przypomnienie najwyżej co 6 h; powrót do „ok” od razu; „ok” — puls raz na dobę', () => {
    expect(shouldPush({ prevKey: 'x', seenKey: 'x', key: 'x', lastPushAt: NOW - 60 * MIN, ok: false, urgent: false, now: NOW })).toBe(false);
    expect(shouldPush({ prevKey: 'x', seenKey: 'x', key: 'x', lastPushAt: NOW - 7 * 60 * MIN, ok: false, urgent: false, now: NOW })).toBe(true);
    expect(shouldPush({ prevKey: 'x', seenKey: 'x', key: 'ok', lastPushAt: NOW - MIN, ok: true, urgent: false, now: NOW })).toBe(true);
    expect(shouldPush({ prevKey: 'ok', seenKey: 'ok', key: 'ok', lastPushAt: NOW - 23 * 60 * MIN, ok: true, urgent: false, now: NOW })).toBe(false);
    // Puls raz na dobę także przy „ok” — uruchamia niezależną weryfikację dziennika w GitHub Actions
    expect(shouldPush({ prevKey: 'ok', seenKey: 'ok', key: 'ok', lastPushAt: NOW - 24 * 60 * MIN, ok: true, urgent: false, now: NOW })).toBe(true);
    expect(shouldPush({ prevKey: null, seenKey: null, key: 'ok', lastPushAt: null, ok: true, urgent: false, now: NOW })).toBe(true);
  });
});

/**
 * Przebiegi strażnika co 15 min z medianą ważoną wieku odczytów pozycji `ages` (pozostałe pliki świeże), wysyłka jak w
 * `main`. `hysteresis: false` — ocena bez stanu (dawne zachowanie). Wynik: zmiany stanu wysłanego alarmu (ok ↔ problem)
 * na dobę UTC.
 */
function replay(ages, start, { hysteresis }) {
  const none = { restart: false, reason: null, category: null };
  const st = { prevKey: null, seenKey: null, lastPushAt: null };
  let ntl; // stary plik stanu: brak pola
  let sent = null;
  const changes = {};
  ages.forEach((age, i) => {
    const now = start + i * 15 * MIN;
    const fresh = { asOf: now - 2 * MIN };
    const input = { status: { ...fresh, coverage: 0.3, ageNtlP50Min: age }, liqMap: fresh, raw: {}, errors: {} };
    let health;
    if (hysteresis) ({ health, ntl } = assessRun(input, ntl, now));
    else health = assessHealth(input, now);
    const a = alertState(health, none);
    if (shouldPush({ prevKey: st.prevKey, seenKey: st.seenKey, key: a.key, lastPushAt: st.lastPushAt, ok: a.ok, urgent: false, now })) {
      if (sent !== null && sent !== a.ok) {
        const day = new Date(now).toISOString().slice(0, 10);
        changes[day] = (changes[day] ?? 0) + 1;
      }
      sent = a.ok;
      st.prevKey = a.key;
      st.lastPushAt = now;
    }
    st.seenKey = a.key;
  });
  return changes;
}

/**
 * Seria odtworzona z publicznej historii wysyłek strażnika (gałąź `health` repo danych), 9.11.2026 03:37 – 11.11.2026
 * 06:07 UTC: pary [mediana ważona w min, liczba przebiegów]. Wartości z raportów wysyłek; przebieg przed wysyłką
 * problemu ma wartość tego problemu (potwierdzenie w dwóch przebiegach), „30,4” — raport „30 min” powyżej progu.
 */
const NOV9_START = Date.UTC(2026, 10, 9, 3, 37);
const NOV9_11 = [
  [27, 4], [31, 2], [23, 1], [33, 2], [27, 5], [30.4, 2], [24, 1], [37, 3], [24, 1], [36, 2], [27, 2], [39, 7], [29, 1], [41, 3], [29, 1],
  [40, 2], [28, 2], [39, 2], [28, 2], [40, 5], [30, 2], [35, 3], [26, 1], [36, 3], [29, 4], [32, 3], [25, 1], [37, 2], [26, 2], [32, 2],
  [24, 4], [34, 2], [22, 66], [33, 2], [25, 2], [37, 2], [23, 1], [32, 2], [27, 1], [33, 3], [25, 1], [38, 2], [27, 2], [35, 6], [27, 1],
  [39, 2], [28, 2], [37, 5], [26, 2], [33, 2], [29, 1], [32, 3], [23, 1], [38, 2], [27, 1], [36, 3], [25, 1], [37, 2], [26, 2], [33, 2],
  [25, 2],
].flatMap(([age, n]) => Array(n).fill(age));

describe('strażnik: histereza alarmu opóźnionych odczytów pozycji', () => {
  it('seria z 9–11.11 bez histerezy odtwarza miganie alarmu (32 / 15 / 13 zmian na dobę)', () => {
    expect(replay(NOV9_11, NOV9_START, { hysteresis: false })).toEqual({ '2026-11-09': 32, '2026-11-10': 15, '2026-11-11': 13 });
  });

  it('ta sama seria z histerezą: najwyżej 4 zmiany stanu na dobę', () => {
    const changes = replay(NOV9_11, NOV9_START, { hysteresis: true });
    for (const n of Object.values(changes)) expect(n).toBeLessThanOrEqual(4);
  });

  it('wiek oscylujący wokół 30 min (25–40 min) przez dobę: jeden alarm, bez migania', () => {
    const ages = Array.from({ length: 96 }, (_, i) => [33, 27, 31, 36, 26, 29, 40, 25][i % 8]);
    expect(Object.values(replay(ages, Date.UTC(2026, 10, 12), { hysteresis: false })).reduce((s, n) => s + n, 0)).toBeGreaterThan(4);
    expect(replay(ages, Date.UTC(2026, 10, 12), { hysteresis: true })).toEqual({ '2026-11-12': 1 });
  });

  it('stan histerezy przechodzi przez plik stanu (JSON) i bez repo danych nie powstaje', () => {
    const fresh = { asOf: NOW - 2 * MIN };
    const input = (age) => ({ status: { ...fresh, coverage: 0.3, ageNtlP50Min: age }, liqMap: fresh, raw: {}, errors: {} });
    const first = assessRun(input(33), undefined, NOW);
    const second = assessRun(input(33), JSON.parse(JSON.stringify(first.ntl)), NOW);
    expect(second.ntl.lag).toBe(true);
    expect(assessRun(input(27), JSON.parse(JSON.stringify(second.ntl)), NOW).health.ok).toBe(false);
    expect(assessRun(null, undefined, NOW)).toEqual({ health: ok, ntl: { lag: false, above: 0, below: 0 } });
  });
});

describe('strażnik: licznik restartów w epizodzie według stanu usługi', () => {
  /** Otwarty alarm opóźnienia odczytów pozycji — nie dotyczy procesu skanera, ocena całości nigdy nie jest „ok” */
  const lagging = { ok: false, problems: ['odczyty pozycji opóźnione: mediana ważona 33 min (alarm powyżej 30 min, koniec po 2 przebiegach poniżej 25 min)'], facts: [] };

  /**
   * Przebiegi skanera co 15 min jak w `main`: `stalled(t)` — czy w chwili t skaner nie publikuje lokalnie (14 min ciszy).
   * Usługa działa od 2 h przed startem; restart zeruje czas działania. Zwraca decyzje kolejnych przebiegów.
   */
  function scannerRuns(runs, stalled) {
    let lastRestart = null;
    let restarts = 0;
    let upSince = NOW - 120 * MIN;
    const out = [];
    for (let i = 0; i < runs; i++) {
      const now = NOW + i * 15 * MIN;
      const activeForMs = now - upSince;
      const d = decide({ ...base, now, localAsOf: stalled(now) ? now - 14 * MIN : now - MIN, activeForMs, lastRestart, restarts, health: lagging });
      if (d.restart) {
        lastRestart = now;
        restarts += 1;
        upSince = now;
      }
      restarts = episodeRestarts({ now, d, serviceState: 'active', activeForMs: now - upSince, lastRestart, restarts });
      out.push({ now, d, restarts });
    }
    return out;
  }

  it('alarm opóźnienia otwarty przez całą serię: cztery zawieszenia co 6 h z powrotem między nimi → czwarte też kończy się restartem', () => {
    const stallAt = [0, 6, 12, 18].map((h) => NOW + h * 60 * MIN);
    const runs = scannerRuns(4 * 24 + 1, (t) => stallAt.includes(t));
    const atStalls = runs.filter((r) => stallAt.includes(r.now));
    expect(atStalls.map((r) => r.d.restart)).toEqual([true, true, true, true]);
    expect(atStalls.map((r) => r.d.category)).not.toContain('giveup');
  });

  it('trzy restarty w 3 h bez powrotu → strażnik się poddaje (limit prób w epizodzie zostaje)', () => {
    const runs = scannerRuns(13, () => true);
    expect(runs.filter((r) => r.d.restart)).toHaveLength(3);
    expect(runs.at(-1).now - NOW).toBe(180 * MIN);
    expect(runs.at(-1).d).toMatchObject({ restart: false, category: 'giveup' });
  });

  it('licznik zostaje tuż po restarcie, w stanie przejściowym i przy problemie usługi; zero po godzinie spokojnej pracy', () => {
    const none = { restart: false, reason: null, category: null };
    const calm = { now: NOW, d: none, serviceState: 'active', activeForMs: 61 * MIN, lastRestart: NOW - 61 * MIN, restarts: 2 };
    expect(episodeRestarts(calm)).toBe(0);
    expect(episodeRestarts({ ...calm, activeForMs: 20 * MIN, lastRestart: NOW - 20 * MIN })).toBe(2);
    expect(episodeRestarts({ ...calm, activeForMs: null, lastRestart: NOW - 20 * MIN })).toBe(2);
    expect(episodeRestarts({ ...calm, serviceState: 'activating', activeForMs: null })).toBe(2);
    expect(episodeRestarts({ ...calm, d: { restart: false, reason: 'serwer powiadomień nie zapisał pulsu od 7 min (restart wstrzymany)', category: 'stall' } })).toBe(2);
    // serwer powiadomień: ta sama zasada, niezależnie od skanera
    const da = decideAlerts({ now: NOW, pulse: { at: NOW - MIN, syncAt: null, wsAt: null }, serviceState: 'active', activeForMs: 90 * MIN, lastRestart: NOW - 90 * MIN, restarts: 2 });
    expect(episodeRestarts({ now: NOW, d: da, serviceState: 'active', activeForMs: 90 * MIN, lastRestart: NOW - 90 * MIN, restarts: 2 })).toBe(0);
    // stary plik stanu bez restartów strażnika
    expect(episodeRestarts({ ...calm, lastRestart: null, activeForMs: null, restarts: 0 })).toBe(0);
  });
});

describe('strażnik: git i źródło danych', () => {
  it('commity w UTC bez konfiguracji globalnej (bez strefy czasowej serwera)', () => {
    const env = gitEnv('/w', '/k', NOW);
    expect(env.TZ).toBe('UTC');
    expect(env.GIT_AUTHOR_DATE).toBe('2026-10-22T14:00:00+00:00');
    expect(env.GIT_COMMITTER_DATE).toBe(env.GIT_AUTHOR_DATE);
    expect(env.GIT_CONFIG_GLOBAL).toBe('/dev/null');
  });
  it('adres surowych plików z HQ_GIT_REMOTE (SSH i HTTPS); brak / nie-GitHub → null', () => {
    expect(dataBaseFromRemote('git@github.com:acme/hq-data.git')).toBe('https://raw.githubusercontent.com/acme/hq-data/main');
    expect(dataBaseFromRemote('https://github.com/acme/hq-data')).toBe('https://raw.githubusercontent.com/acme/hq-data/main');
    expect(dataBaseFromRemote('')).toBeNull();
    expect(dataBaseFromRemote('git@gitlab.com:a/b.git')).toBeNull();
  });
});
