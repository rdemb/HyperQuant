/**
 * Pełne profile szablonów agentów (pliki `.md` po angielsku z `integrations/agents`) dołączone do pakietu zakładki przy
 * budowie strony. „Kopiuj profil” kopiuje je bez sieci: działa offline (PWA), w wersji zgodnej ze stroną, a zapis do schowka
 * zostaje w geście użytkownika (Safari odrzuca zapis po oczekiwaniu na pobranie pliku).
 */
const FILES = import.meta.glob<string>('../../../integrations/agents/*.md', { query: '?raw', import: 'default', eager: true });

/** Klucze względem katalogu repo („integrations/agents/…”), końce linii `\n`. */
const BY_FILE = new Map(Object.entries(FILES).map(([k, text]) => [k.replace(/^(?:\.\.\/)+/, ''), text.replace(/\r\n/g, '\n')]));

/** Treść pliku profilu (`AgentTemplate.file`); brak pliku — null. */
export const profileText = (file: string): string | null => BY_FILE.get(file) ?? null;
