/**
 * Wiadomość instalacyjna dla OpenBota: użytkownik wkleja ją dowolnemu swojemu agentowi, a ten narzędziami OpenBota
 * (`openbot.tool_call`) dodaje serwer `hyperquant-mcp` z wersją przypiętą, skill `hyperquant` z plików strony
 * i opcjonalnie agenta z szablonu (opis i instrukcje z plików strony). Kroki, które już są zrobione, agent pomija.
 *
 * Czysta funkcja: język przez `tr()`, proza po polsku albo po angielsku, a nazwy narzędzi i wartości w cudzysłowach
 * w obu językach te same (z jednych stałych). Adresy bezwzględne, bo wiadomość trafia do innej aplikacji.
 */
import type { AgentTemplate } from '../../../integrations/agents/index';
import { OPENBOT_DIR, OPENBOT_PATHS } from '../../../integrations/agents/openbot';
import { tr } from '../../i18n';
import { TOOL_META } from './catalog';
import { NPM_PACKAGE, SERVER_NAME, serverConfig } from './installLinks';

/** Adres plików instalacji na stronie (jedyne miejsce z domeną). */
export const OPENBOT_BASE_URL = `https://hyperquant.tech/${OPENBOT_DIR}/`;

/** Adres bezwzględny pliku z `OPENBOT_PATHS` (do wiadomości). */
export const openbotUrl = (file: string): string => `${OPENBOT_BASE_URL}${file}`;
/** Adres względny pliku z `OPENBOT_PATHS` (linki pobrania na stronie: ten sam plik w buildzie i w `npm run dev`). */
export const openbotHref = (file: string): string => `./${OPENBOT_DIR}/${file}`;

/** Narzędzia OpenBota, nazwy dokładnie jak w OpenBocie. */
const OB = {
  listServers: 'openbot.list_mcp_servers',
  saveServer: 'openbot.save_mcp_server',
  testServer: 'openbot.test_mcp_server',
  listSkills: 'openbot.list_local_skills',
  createSkill: 'openbot.create_skill',
  listAgents: 'openbot.list_agents',
  createAgent: 'openbot.create_agent',
  installSkill: 'openbot.install_local_skill',
} as const;

/** Nazwa skilla z frontmattera SKILL.md. */
const SKILL_NAME = 'hyperquant';
/** Folder skilla w workspace agenta: ten sam układ co na stronie (`hyperquant/SKILL.md`, `hyperquant/assets/icon.png`). */
const SKILL_DIR = OPENBOT_PATHS.skill.split('/')[0];

const q = (s: string) => `"${s}"`;

/**
 * Wiadomość do wklejenia agentowi w OpenBocie: serwer MCP, skill, opcjonalnie agent z szablonu `t` (nazwa i tytuł
 * po angielsku, jak profile) i krótki raport. Numeracja kroków ciągła.
 */
export function openbotSetupMessage(t?: AgentTemplate): string {
  const server = serverConfig('npm');
  const args = `[${server.args.map(q).join(', ')}]`;
  const tools = TOOL_META.length;
  // Narzędzia, po których agent rozpozna serwer HyperQuant pod inną nazwą (pierwsze trzy z listy strony)
  const known = TOOL_META.slice(0, 3).map((m) => m.name).join(', ');
  const first = TOOL_META[0].name;
  const skillMd = openbotUrl(OPENBOT_PATHS.skill);
  const icon = openbotUrl(OPENBOT_PATHS.icon);

  // OpenBot nie pokazuje argumentów serwerów (list_mcp_servers podaje polecenie i liczbę argumentów), więc istniejący
  // serwer rozpoznaje się po nazwie albo po narzędziach; save_mcp_server z zajętą nazwą zmieniłby istniejący serwer
  const steps = [
    tr(
      `Serwer MCP. Wywołaj ${OB.listServers}. Jeśli jest serwer o nazwie ${q(SERVER_NAME)} albo masz już narzędzia ${NPM_PACKAGE} (${known}), nie dodawaj ani nie zmieniaj serwera. W przeciwnym razie wywołaj ${OB.saveServer} z name ${q(SERVER_NAME)}, transport ${q('stdio')}, command ${q(server.command)} i args ${args}. Potem wywołaj ${OB.testServer} z nazwą serwera HyperQuant i sprawdź, czy pokazuje ${tools} narzędzi, w tym ${first}.`,
      `MCP server. Call ${OB.listServers}. If a server named ${q(SERVER_NAME)} is listed, or you already have the ${NPM_PACKAGE} tools (${known}), do not add or change a server. Otherwise call ${OB.saveServer} with name ${q(SERVER_NAME)}, transport ${q('stdio')}, command ${q(server.command)} and args ${args}. Then call ${OB.testServer} with the name of the HyperQuant server and check that it lists ${tools} tools, ${first} among them.`
    ),
    tr(
      `Skill. Wywołaj ${OB.listSkills}. Jeśli nie ma skilla o nazwie ${q(SKILL_NAME)}, pobierz bez zmian te dwa pliki do nowego folderu ${SKILL_DIR} w swoim katalogu roboczym (workspace): ${skillMd} jako ${OPENBOT_PATHS.skill} i ${icon} jako ${OPENBOT_PATHS.icon}. Potem wywołaj ${OB.createSkill} z sourcePath ustawionym na ten folder ${SKILL_DIR}.`,
      `Skill. Call ${OB.listSkills}. If there is no skill named ${q(SKILL_NAME)}, download these two files unchanged into a new folder ${SKILL_DIR} in your workspace: ${skillMd} as ${OPENBOT_PATHS.skill} and ${icon} as ${OPENBOT_PATHS.icon}. Then call ${OB.createSkill} with sourcePath set to that ${SKILL_DIR} folder.`
    ),
  ];
  if (t) {
    const name = t.name.en;
    const description = openbotUrl(OPENBOT_PATHS.description(t.id));
    // Pierwsza wiadomość nowego agenta: po angielsku w obu wersjach, jak jego profil
    const initial = `Download ${openbotUrl(OPENBOT_PATHS.instructions(t.id))} and save it unchanged as AGENTS.md at the root of your workspace: these are your instructions. Then reply in one line that you are ready.`;
    steps.push(
      tr(
        `Agent ${q(name)}. Wywołaj ${OB.listAgents}. Jeśli nie ma agenta o tej nazwie, wywołaj ${OB.createAgent} z name ${q(name)}, title ${q(t.role.en)}, description równym treści pliku ${description} bez zmian i initialMessage: ${q(initial)} Potem wywołaj ${OB.installSkill}, żeby dać temu agentowi skill ${SKILL_NAME}.`,
        `Agent ${q(name)}. Call ${OB.listAgents}. If there is no agent with this name, call ${OB.createAgent} with name ${q(name)}, title ${q(t.role.en)}, description set to the text of ${description} unchanged, and initialMessage: ${q(initial)} Then call ${OB.installSkill} to give the ${SKILL_NAME} skill to that agent.`
      )
    );
  }
  steps.push(tr('Napisz mi w kilku linijkach, co zostało dodane, a co już było.', 'Tell me in a few lines what you added and what was already there.'));

  const intro = tr(
    'Skonfiguruj mi HyperQuant w OpenBocie: kontekst rynku BTC tylko do odczytu, z danych publicznych (hyperquant.tech), bez kluczy, kont i handlu. Pomiń każdy krok, który jest już zrobiony, i nie zmieniaj niczego, co już istnieje.',
    'Set up HyperQuant for me in OpenBot: read-only BTC market context from public data (hyperquant.tech), no keys, no accounts, no trading. Skip every step that is already done and do not change anything that already exists.'
  );
  return `${intro}\n\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
}
