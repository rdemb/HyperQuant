/**
 * Wiadomość instalacyjna dla OpenBota: jedna wiadomość wklejona dowolnemu agentowi dodaje serwer `hyperquant-mcp`
 * z wersją przypiętą, skill `hyperquant` i opcjonalnie agenta z szablonu. Wzorcem jest treść angielska; polska ma te same
 * kroki, narzędzia OpenBota i wartości w cudzysłowach. Każdy adres prowadzi do pliku, który strona publikuje
 * (`openbotFiles`), więc wiadomość nie ma martwych linków.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { AGENT_TEMPLATES, type AgentTemplate } from '../../../../integrations/agents/index';
import { OPENBOT_DIR, openbotFiles } from '../../../../integrations/agents/openbot';
import { publishHits } from '../../../../integrations/__tests__/publishPatterns';
import { TITLE_GUARDS, guardHits } from '../../../utils/safeguards.mjs';
import { NPM_SPEC } from '../installLinks';
import { OPENBOT_BASE_URL, openbotHref, openbotSetupMessage, openbotUrl } from '../openbotSetup';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
/** Ścieżki plików, które strona publikuje pod `agents/openbot/`. */
const PUBLISHED = new Set(openbotFiles((p) => readFileSync(path.join(ROOT, p))).map((f) => f.path));
const DESK = AGENT_TEMPLATES[0];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** Funkcja wiadomości po angielsku: język strony ustalany przy imporcie i18n (zapisany wybór „en” w przeglądarce). */
async function english(): Promise<typeof openbotSetupMessage> {
  vi.stubGlobal('document', {});
  vi.stubGlobal('localStorage', { getItem: () => 'en' });
  vi.resetModules();
  const i18n = await import('../../../i18n');
  expect(i18n.lang).toBe('en');
  return (await import('../openbotSetup')).openbotSetupMessage;
}

const urls = (m: string) => [...m.matchAll(/https?:\/\/[^\s"]+/g)].map((x) => x[0].replace(/[.,;:)]+$/, ''));
const quoted = (m: string) => [...m.matchAll(/"([^"]*)"/g)].map((x) => x[1]);
const tools = (m: string) => [...m.matchAll(/openbot\.[a-z_]+/g)].map((x) => x[0]);
const stepNumbers = (m: string) => m.split('\n').flatMap((l) => /^(\d+)\. /.exec(l)?.[1] ?? []).map(Number);
const title = (t: AgentTemplate) => /^\*\*Title:\*\* (.+)$/m.exec(read(t.file))?.[1];

const V = NPM_SPEC;
const BASE = 'https://hyperquant.tech/agents/openbot';
const INTRO =
  'Set up HyperQuant for me in OpenBot: read-only BTC market context from public data (hyperquant.tech), no keys, no accounts, no trading. Skip every step that is already done and do not change anything that already exists.';
// OpenBot nie pokazuje argumentów serwerów (list_mcp_servers: polecenie i liczba argumentów), więc istniejący serwer
// rozpoznaje się po nazwie albo po narzędziach; save_mcp_server z zajętą nazwą zmieniłby istniejący serwer
const SERVER = `MCP server. Call openbot.list_mcp_servers. If a server named "hyperquant" is listed, or you already have the hyperquant-mcp tools (market_brief, session_context, day_map), do not add or change a server. Otherwise call openbot.save_mcp_server with name "hyperquant", transport "stdio", command "npx" and args ["-y", "${V}"]. Then call openbot.test_mcp_server with the name of the HyperQuant server and check that it lists 10 tools, market_brief among them.`;
const SKILL = `Skill. Call openbot.list_local_skills. If there is no skill named "hyperquant", download these two files unchanged into a new folder hyperquant in your workspace: ${BASE}/hyperquant/SKILL.md as hyperquant/SKILL.md and ${BASE}/hyperquant/assets/icon.png as hyperquant/assets/icon.png. Then call openbot.create_skill with sourcePath set to that hyperquant folder.`;
const AGENT = `Agent "HyperQuant Desk". Call openbot.list_agents. If there is no agent with this name, call openbot.create_agent with name "HyperQuant Desk", title "Pre-session brief and post-session market review for BTC", description set to the text of ${BASE}/desk/description.txt unchanged, and initialMessage: "Download ${BASE}/desk/AGENTS.md and save it unchanged as AGENTS.md at the root of your workspace: these are your instructions. Then reply in one line that you are ready." Then call openbot.install_local_skill to give the hyperquant skill to that agent.`;
const REPORT = 'Tell me in a few lines what you added and what was already there.';

describe('wiadomość instalacyjna OpenBota', () => {
  it('adresy bezwzględne pod https://hyperquant.tech/agents/openbot/, linki strony względne (./agents/openbot/…)', () => {
    expect(OPENBOT_BASE_URL).toBe(`https://hyperquant.tech/${OPENBOT_DIR}/`);
    expect(openbotUrl('desk.md')).toBe(`${BASE}/desk.md`);
    expect(openbotHref('desk.md')).toBe('./agents/openbot/desk.md');
  });

  it('EN (wzorzec): bez szablonu kroki serwera, skilla i raportu; z szablonem Desk także agent', async () => {
    const en = await english();
    expect(en()).toBe(`${INTRO}\n\n1. ${SERVER}\n2. ${SKILL}\n3. ${REPORT}`);
    expect(en(DESK)).toBe(`${INTRO}\n\n1. ${SERVER}\n2. ${SKILL}\n3. ${AGENT}\n4. ${REPORT}`);
  });

  it('PL: proza po polsku; te same kroki, narzędzia OpenBota, wartości w cudzysłowach i adresy co EN', async () => {
    const pl = [openbotSetupMessage(), ...AGENT_TEMPLATES.map((t) => openbotSetupMessage(t))];
    const en = await english();
    const ens = [en(), ...AGENT_TEMPLATES.map((t) => en(t))];
    pl.forEach((m, i) => {
      expect(m).toMatch(/Wywołaj/);
      expect(m).not.toMatch(/\bCall\b/);
      expect(stepNumbers(m), m).toEqual(stepNumbers(ens[i]));
      expect(tools(m), m).toEqual(tools(ens[i]));
      expect(quoted(m), m).toEqual(quoted(ens[i]));
      expect(urls(m), m).toEqual(urls(ens[i]));
    });
  });

  it('numeracja ciągła: bez szablonu 1–3 (bez kroku agenta), z szablonem 1–4', async () => {
    const en = await english();
    for (const m of [openbotSetupMessage(), en()]) {
      expect(stepNumbers(m)).toEqual([1, 2, 3]);
      expect(tools(m)).not.toContain('openbot.create_agent');
      expect(tools(m)).not.toContain('openbot.install_local_skill');
    }
    for (const t of AGENT_TEMPLATES) for (const m of [openbotSetupMessage(t), en(t)]) expect(stepNumbers(m), t.id).toEqual([1, 2, 3, 4]);
  });

  it('z szablonem: nazwa i tytuł po angielsku (t.name.en, t.role.en, jak „**Title:**” w pliku), adresy z t.id', async () => {
    const en = await english();
    for (const t of AGENT_TEMPLATES) {
      expect(title(t), t.id).toBe(t.role.en);
      for (const m of [openbotSetupMessage(t), en(t)]) {
        expect(m, t.id).toContain(`name "${t.name.en}"`);
        expect(m, t.id).toContain(`title "${title(t)}"`);
        expect(m, t.id).toContain(`${BASE}/${t.id}/description.txt`);
        expect(m, t.id).toContain(`${BASE}/${t.id}/AGENTS.md`);
        for (const other of AGENT_TEMPLATES.filter((o) => o.id !== t.id)) expect(m, `${t.id}: ${other.id}`).not.toContain(`${BASE}/${other.id}/`);
      }
    }
  });

  it('każda wiadomość: paczka z wersją przypiętą (NPM_SPEC), skill o nazwie z SKILL.md, adresy tylko do opublikowanych plików', async () => {
    const skillName = (parse(/^---\n([\s\S]*?)\n---\n/.exec(read('integrations/skills/hyperquant/SKILL.md'))?.[1] ?? '') as { name: string }).name;
    const en = await english();
    for (const m of [openbotSetupMessage(), en(), ...AGENT_TEMPLATES.flatMap((t) => [openbotSetupMessage(t), en(t)])]) {
      expect(m).toContain(`"${NPM_SPEC}"`);
      // Krok skilla (2.) szuka skilla po nazwie z frontmattera SKILL.md
      expect(m.split('\n').find((l) => l.startsWith('2. '))).toContain(`"${skillName}"`);
      const all = urls(m);
      expect(all.length).toBeGreaterThanOrEqual(2);
      for (const u of all) {
        expect(u.startsWith(OPENBOT_BASE_URL), u).toBe(true);
        expect(PUBLISHED.has(u.slice(OPENBOT_BASE_URL.length)), u).toBe(true);
      }
    }
  });

  it('bez trafień wzorców publikacji i strażnika treści; poniżej 2500 znaków; wynik deterministyczny', async () => {
    const en = await english();
    for (const make of [openbotSetupMessage, en]) {
      for (const t of [undefined, ...AGENT_TEMPLATES]) {
        const m = make(t);
        expect(publishHits(m), t?.id).toEqual([]);
        expect(guardHits(m, TITLE_GUARDS).map((h) => `${h.guard.en}: ${h.fragment}`), t?.id).toEqual([]);
        expect(m.length, t?.id).toBeLessThan(2500);
        expect(make(t), t?.id).toBe(m);
      }
    }
  });
});
