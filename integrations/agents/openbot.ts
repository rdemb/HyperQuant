/**
 * Pliki instalacji HyperQuant w OpenBocie, publikowane przez stronę pod `agents/openbot/…`: skill `hyperquant`
 * (SKILL.md i ikona) oraz dla każdego szablonu agenta pełny plik profilu do pobrania, opis profilu (pole „description”
 * agenta) i instrukcje (`AGENTS.md` w katalogu głównym workspace agenta). Agent OpenBota pobiera je według wiadomości
 * instalacyjnej z zakładki Agenci AI.
 *
 * Czysta funkcja nad czytnikiem plików repo, bez importów Node: wtyczka Vite używa jej przy budowie (zasoby w `dist`)
 * i w serwerze deweloperskim, a zakładka strony bierze stąd ścieżki plików.
 */
import { AGENT_TEMPLATES, type AgentTemplate } from './index.ts';

/** Katalog plików względem katalogu głównego strony. */
export const OPENBOT_DIR = 'agents/openbot';

/** Ścieżki plików względem `OPENBOT_DIR`; folder `hyperquant/` to gotowy folder skilla (agent kopiuje go bez zmian). */
export const OPENBOT_PATHS = {
  skill: 'hyperquant/SKILL.md',
  icon: 'hyperquant/assets/icon.png',
  /** Pełny plik szablonu (do pobrania). */
  profile: (id: AgentTemplate['id']) => `${id}.md`,
  /** Opis profilu: pole „description” agenta. */
  description: (id: AgentTemplate['id']) => `${id}/description.txt`,
  /** Instrukcje agenta: `AGENTS.md` w katalogu głównym jego workspace. */
  instructions: (id: AgentTemplate['id']) => `${id}/AGENTS.md`,
} as const;

/** Źródła w repo: skill i ikona PWA strony (PNG 512×512, rozmiar zalecany dla ikon). */
export const SKILL_SOURCE = 'integrations/skills/hyperquant/SKILL.md';
export const ICON_SOURCE = 'public/icons/icon-512.png';

/** Najdłuższy opis agenta, jaki przyjmuje OpenBot (`openbot.create_agent`, pole `description`). */
export const DESCRIPTION_MAX = 2000;

export interface OpenbotFile {
  /** Ścieżka względem `OPENBOT_DIR`. */
  path: string;
  content: Uint8Array;
}

/** Poziom nagłówka Markdown (1–6); zwykła linia — 0. */
const headingLevel = (line: string): number => /^(#{1,6})\s/.exec(line)?.[1].length ?? 0;

/**
 * Treść sekcji pod nagłówkiem `heading` (dokładnie ta linia, np. `### Description`) do następnego nagłówka tego samego
 * albo wyższego poziomu, przycięta. Brak nagłówka albo pusta sekcja — błąd z nazwą pliku.
 */
function sectionOf(md: string, heading: string, file: string): string {
  const lines = md.split('\n');
  const at = lines.findIndex((l) => l.trimEnd() === heading);
  const level = headingLevel(heading);
  const next = lines.findIndex((l, i) => i > at && headingLevel(l) > 0 && headingLevel(l) <= level);
  const body = at < 0 ? '' : lines.slice(at + 1, next < 0 ? undefined : next).join('\n').trim();
  if (body === '') throw new Error(`${file}: brak sekcji „${heading}”`);
  return body;
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * Pliki OpenBota z plików repo (`read` zwraca surowe bajty pliku po ścieżce względem katalogu repo): SKILL.md i ikona
 * bajt w bajt, dla każdego szablonu pełny plik, opis (sekcja `### Description`) i `AGENTS.md` (`# Instructions`
 * z sekcją `### Instructions` i `## Rules` z sekcją `## Rules`). Kolejność stała: skill, potem szablony jak w
 * `AGENT_TEMPLATES`.
 */
export function openbotFiles(read: (repoPath: string) => Uint8Array, templates: readonly AgentTemplate[] = AGENT_TEMPLATES): OpenbotFile[] {
  const out: OpenbotFile[] = [
    { path: OPENBOT_PATHS.skill, content: read(SKILL_SOURCE) },
    { path: OPENBOT_PATHS.icon, content: read(ICON_SOURCE) },
  ];
  for (const t of templates) {
    const file = read(t.file);
    // Końce linii `\n` (checkout na Windows może mieć `\r\n`)
    const md = new TextDecoder().decode(file).replace(/\r\n/g, '\n');
    const [description, instructions, rules] = ['### Description', '### Instructions', '## Rules'].map((h) => sectionOf(md, h, t.file));
    // Po odczycie wszystkich sekcji: brak nagłówka zgłasza się jako brak sekcji, nie jako za długi opis
    if (description.length > DESCRIPTION_MAX) throw new Error(`${t.file}: opis ma ${description.length} znaków, OpenBot przyjmuje do ${DESCRIPTION_MAX}`);
    out.push(
      { path: OPENBOT_PATHS.profile(t.id), content: file },
      { path: OPENBOT_PATHS.description(t.id), content: utf8(description) },
      { path: OPENBOT_PATHS.instructions(t.id), content: utf8(`# Instructions\n\n${instructions}\n\n## Rules\n\n${rules}\n`) }
    );
  }
  return out;
}
