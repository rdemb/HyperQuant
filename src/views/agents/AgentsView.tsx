import React from 'react';
import { Download, ExternalLink } from 'lucide-react';
import { AGENT_TEMPLATES, type AgentTemplate } from '../../../integrations/agents/index';
import { Badge, DASH, Panel } from '../../ui';
import { lang, tr } from '../../i18n';
import { BTN_SECONDARY, CopyButton } from './CopyButton';
import { MCP_README_FILE, SKILL_FILE, SKILL_RECIPES, TOOL_META, githubUrl } from './catalog';
import {
  BUNDLE_PATH,
  MCPB_URL,
  MCP_STATUS,
  REPO_DIR,
  REPO_STEPS,
  claudeDesktopJson,
  cursorLink,
  type McpStatus,
  openbotConfig,
  vscodeLink,
} from './installLinks';
import { profileText } from './profiles';

/** Cytat w języku strony: „…” po polsku, "…" po angielsku. */
const quote = (s: string) => (lang === 'en' ? `"${s}"` : `„${s}”`);

const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-1.5 min-h-11 sm:min-h-9 px-4 rounded-lg bg-accent text-page text-sm font-semibold hover:brightness-110 transition-[filter] duration-150';
// Bloki kodu zawijają się (bez przewijania w bok); ścieżki łamią się tylko po „/” (`Path`)
const CODE_BLOCK = 'font-mono text-xs leading-relaxed text-ink-1 bg-page border border-line rounded-lg px-3 py-2.5 whitespace-pre-wrap break-words';
const TOOL_CHIP = 'font-mono text-[11px] text-ink-2 border border-line rounded px-1.5 py-0.5';

/**
 * Tekst ze ścieżką: wiersz łamie się tylko po „/” (`<wbr>`) albo na odstępie, nigdy w środku nazwy pliku (także nie po
 * „-”); odstępy i końce wierszy zostają zwykłym tekstem (formatowanie JSON-a w `pre`). Zaznaczony tekst kopiuje się bez zmian.
 */
const Path: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split('/').map((part, i, all) => (
      <React.Fragment key={i}>
        {part.split(/(\s+)/).map((tok, j) => (tok === '' || /^\s+$/.test(tok) ? tok : <span key={j} className="whitespace-nowrap">{tok}</span>))}
        {i < all.length - 1 && (
          <>
            /<wbr />
          </>
        )}
      </React.Fragment>
    ))}
  </>
);

/** Link zewnętrzny (nowa karta) z ikoną i opisem dla czytnika ekranu. */
const A: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline">
    {children}
    <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
    <span className="sr-only">{tr('(otwiera się w nowej karcie)', '(opens in a new tab)')}</span>
  </a>
);

/** Nagłówek sekcji strony: tytuł i jedno zdanie, po co ta sekcja jest. */
const SectionHead: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="flex flex-col gap-1 max-w-prose">
    <h2 className="font-display text-lg font-semibold text-ink-1 leading-tight">{title}</h2>
    <p className="text-sm text-ink-2 leading-relaxed">{children}</p>
  </div>
);

const ToolChips: React.FC<{ names: string[] }> = ({ names }) => (
  <ul className="flex flex-wrap gap-1.5" aria-label={tr('Narzędzia', 'Tools')}>
    {names.map((n) => (
      <li key={n} className={TOOL_CHIP}>
        {n}
      </li>
    ))}
  </ul>
);

const Intro: React.FC = () => (
  <section className="grid grid-cols-1 lg:grid-cols-12 gap-x-8 gap-y-4 items-start pt-2">
    <div className="lg:col-span-7 flex flex-col gap-3 max-w-prose">
      <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-ink-1">{tr('Agenci AI', 'AI agents')}</h1>
      <p className="text-[15px] text-ink-1 leading-relaxed">
        {tr(
          'Podłącz HyperQuant do swojego asystenta AI: OpenBota, Claude, Cursora, VS Code albo innego klienta MCP. Serwer hyperquant-mcp daje mu 10 narzędzi z kontekstem rynku BTC na Hyperliquid, liczonym tymi samymi funkcjami co ta strona. Cena to ostatnie zamknięcie świecy 1m, więc liczby mogą się nieco różnić od strony w tej samej chwili.',
          'Connect HyperQuant to your AI assistant: OpenBot, Claude, Cursor, VS Code or another MCP client. The hyperquant-mcp server gives it 10 tools with BTC market context on Hyperliquid, computed with the same functions as this site. The price is the latest 1-minute close, so values can differ slightly from the site at the same moment.'
        )}
      </p>
      <p className="text-sm text-ink-2 leading-relaxed">
        {tr(
          'Tylko odczyt danych publicznych. Bez kluczy, kont, handlu i zleceń; asystent opisuje rynek, nie doradza.',
          'Public data, read-only. No keys, accounts, trading or orders; the assistant describes the market and gives no advice.'
        )}
      </p>
    </div>
    <dl className="lg:col-span-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm bg-surface-1 border border-line rounded-xl px-4 py-3.5">
      <dt className="text-ink-3">{tr('Dziś', 'Today')}</dt>
      <dd className="text-ink-1">
        {MCP_STATUS === 'npm'
          ? tr('paczka npm hyperquant-mcp (STDIO); Claude Desktop: plik .mcpb', 'npm package hyperquant-mcp (STDIO); Claude Desktop: the .mcpb file')
          : tr('serwer STDIO uruchamiany z repozytorium; Claude Desktop: plik .mcpb', 'STDIO server run from the repository; Claude Desktop: the .mcpb file')}
      </dd>
      <dt className="text-ink-3">{tr('Wkrótce', 'Coming')}</dt>
      <dd className="text-ink-2">
        {MCP_STATUS === 'npm'
          ? tr('wpis w Marketplace OpenBota', 'a listing in the OpenBot Marketplace')
          : tr(
              'paczka w npm (z nią instalacja jednym kliknięciem w Cursorze i VS Code) i wpis w Marketplace OpenBota',
              'the npm package (with it, one-click install in Cursor and VS Code) and a listing in the OpenBot Marketplace'
            )}
      </dd>
      <dt className="text-ink-3">{tr('W planach', 'Planned')}</dt>
      <dd className="text-ink-2">
        {tr('tryb HTTP: połączenie przez adres URL, bez uruchamiania serwera u siebie', 'HTTP mode: connect by URL, without running the server yourself')}
      </dd>
    </dl>
  </section>
);

const TemplateCard: React.FC<{ t: AgentTemplate }> = ({ t }) => {
  const profile = profileText(t.file);
  const prompts = tr(t.prompts.pl, t.prompts.en);
  return (
    <Panel title={tr(t.name.pl, t.name.en)} bodyClassName="px-4 py-3 flex flex-col gap-3.5 h-full">
      <p className="text-sm text-ink-2 leading-relaxed">{tr(t.role.pl, t.role.en)}</p>
      <ToolChips names={t.tools} />
      <div className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium text-ink-3">{tr('Przykładowe polecenia', 'Example prompts')}</h3>
        <ul className="flex flex-col gap-1 text-sm text-ink-1 leading-snug">
          {prompts.map((p) => (
            <li key={p}>{quote(p)}</li>
          ))}
        </ul>
      </div>
      <div className="mt-auto flex flex-wrap items-start gap-x-4 gap-y-2 pt-1">
        {profile && (
          <CopyButton
            text={profile}
            label={tr('Kopiuj profil', 'Copy profile')}
            fallback={tr('Schowek niedostępny: skopiuj profil z pliku na GitHubie.', 'Clipboard unavailable: copy the profile from the file on GitHub.')}
          />
        )}
        <span className="inline-flex items-center min-h-11 sm:min-h-9 text-sm">
          <A href={githubUrl(t.file)}>{tr('Plik na GitHubie', 'File on GitHub')}</A>
        </span>
      </div>
    </Panel>
  );
};

const Templates: React.FC = () => (
  <section className="flex flex-col gap-3">
    <SectionHead title={tr('Szablony agentów', 'Agent templates')}>
      {tr(
        'Gotowe profile do wklejenia w kliencie z profilami agentów albo własnymi instrukcjami. Profile są po angielsku; ze skillem hyperquant agent odpowiada w języku pytania. Każdy wymaga serwera hyperquant-mcp i skilla hyperquant.',
        'Ready profiles to paste into a client with agent profiles or custom instructions. Each needs the hyperquant-mcp server and the hyperquant skill.'
      )}
    </SectionHead>
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
      {AGENT_TEMPLATES.map((t) => (
        <TemplateCard key={t.id} t={t} />
      ))}
    </div>
  </section>
);

const ClaudeCard: React.FC = () => (
  <Panel title="Claude Desktop" actions={<Badge tone="neutral">{tr('Jedno kliknięcie', 'One click')}</Badge>} hero bodyClassName="px-4 py-3 flex flex-col gap-3">
    <p className="text-sm text-ink-2 leading-relaxed">
      {tr(
        'Pobierz plik i otwórz go dwuklikiem: Claude Desktop pokaże okno instalacji. Serwer i jego zależności są w pliku, a Node.js jest wbudowany w Claude Desktop. macOS i Windows.',
        'Download the file and double-click it: Claude Desktop shows the install dialog. The server and its dependencies are inside the file, and Node.js ships with Claude Desktop. macOS and Windows.'
      )}
    </p>
    <div>
      <a href={MCPB_URL} download="hyperquant.mcpb" className={BTN_PRIMARY}>
        <Download className="w-4 h-4" aria-hidden="true" />
        {tr('Pobierz .mcpb', 'Download .mcpb')}
      </a>
    </div>
    {MCP_STATUS === 'repo' && (
      <p className="text-xs text-ink-3 leading-relaxed">
        {tr(
          'To jedyna instalacja jednym kliknięciem dostępna przed publikacją paczki w npm.',
          'This is the only one-click install available before the npm package is published.'
        )}
      </p>
    )}
  </Panel>
);

const ServerCard: React.FC = () =>
  MCP_STATUS === 'npm' ? (
    <Panel title={tr('Serwer z npm', 'Server from npm')} bodyClassName="px-4 py-3 flex flex-col gap-3">
      <p className="text-sm text-ink-2 leading-relaxed">
        {tr(
          'Pozostałe klienty uruchamiają serwer same poleceniem npx -y hyperquant-mcp. Wymaga Node.js 20 albo nowszego.',
          'Other clients start the server themselves with npx -y hyperquant-mcp. Requires Node.js 20 or later.'
        )}
      </p>
    </Panel>
  ) : (
    <Panel title={tr('Serwer z repozytorium', 'Server from the repository')} bodyClassName="px-4 py-3 flex flex-col gap-3">
      <p className="text-sm text-ink-2 leading-relaxed">
        {tr(
          'Pozostałe klienty uruchamiają serwer u Ciebie przez STDIO. Do czasu publikacji paczki w npm zbuduj go z repozytorium (Node.js 20 albo nowszy):',
          'Other clients run the server on your computer over STDIO. Until the npm package is published, build it from the repository (Node.js 20 or later):'
        )}
      </p>
      <pre className={CODE_BLOCK}>
        <Path text={REPO_STEPS.join('\n')} />
      </pre>
      <CopyButton
        text={REPO_STEPS.join('\n')}
        label={tr('Kopiuj polecenia', 'Copy commands')}
        fallback={tr('Schowek niedostępny: zaznacz polecenia i skopiuj je ręcznie.', 'Clipboard unavailable: select the commands and copy them by hand.')}
      />
      <p className="text-xs text-ink-3 leading-relaxed">
        {tr('W ustawieniach klienta polecenie to node, a argument to pełna ścieżka pliku ', 'In the client settings the command is node and the argument is the full path of ')}
        <code className="font-mono text-ink-2">
          <Path text={BUNDLE_PATH} />
        </code>
        {tr(' w Twojej kopii. W przykładach niżej zamień ', ' in your copy. In the examples below, replace ')}
        <code className="font-mono text-ink-2">
          <Path text={REPO_DIR} />
        </code>
        {tr(' na jej katalog.', ' with its folder.')}
      </p>
    </Panel>
  );

/** Pole ustawień OpenBota: nazwa, wartość jak w formularzu i przycisk, który kopiuje dokładnie tę wartość. */
const OpenBotField: React.FC<{ field: string; label: string; value: string; copyLabel: string }> = ({ field, label, value, copyLabel }) => (
  <div data-field={field} className="flex flex-col gap-1.5">
    <dt className="text-xs text-ink-3">{label}</dt>
    <dd className="flex flex-wrap items-start gap-x-3 gap-y-1.5 min-w-0">
      <code data-value="" className="font-mono text-xs text-ink-1 bg-page border border-line rounded-lg px-2.5 py-2 min-w-0 max-w-full">
        <Path text={value} />
      </code>
      <CopyButton
        text={value}
        label={copyLabel}
        fallback={tr('Schowek niedostępny: zaznacz wartość obok i skopiuj ją ręcznie.', 'Clipboard unavailable: select the value and copy it by hand.')}
      />
    </dd>
  </div>
);

export const OpenBotCard: React.FC<{ status?: McpStatus }> = ({ status = MCP_STATUS }) => {
  const cfg = openbotConfig(status);
  return (
    <Panel title="OpenBot" bodyClassName="px-4 py-3 flex flex-col gap-3">
      <ol className="flex flex-col gap-1.5 text-sm text-ink-1 leading-snug list-decimal pl-5 marker:text-ink-3">
        <li>{tr('Otwórz Marketplace → Aplikacje.', 'Open Marketplace → Apps.')}</li>
        <li>{tr('Wybierz „Dodaj własną” i transport STDIO.', 'Choose "Add your own" and the STDIO transport.')}</li>
        <li>
          {tr(
            'Skopiuj polecenie i argumenty przyciskami poniżej i wklej każde w jego pole formularza.',
            'Copy the command and the arguments with the buttons below and paste each into its field of the form.'
          )}
        </li>
      </ol>
      <dl className="flex flex-col gap-2.5">
        <div className="flex items-baseline gap-2 text-xs">
          <dt className="text-ink-3">{tr('Transport', 'Transport')}</dt>
          <dd className="font-mono text-ink-1">{cfg.transport}</dd>
        </div>
        <OpenBotField field="command" label={tr('Polecenie', 'Command')} value={cfg.command} copyLabel={tr('Kopiuj polecenie', 'Copy command')} />
        <OpenBotField field="args" label={tr('Argumenty', 'Arguments')} value={cfg.args.join(' ')} copyLabel={tr('Kopiuj argumenty', 'Copy arguments')} />
      </dl>
      <p className="text-xs text-ink-3 leading-relaxed">
        {tr(
          'Przycisk instalacji w OpenBocie pojawi się tutaj, gdy OpenBot go udostępni. Wpis HyperQuant w Marketplace OpenBota jest w przygotowaniu.',
          'A one-click install button for OpenBot will appear here once OpenBot offers one. A HyperQuant listing in the OpenBot Marketplace is in preparation.'
        )}
      </p>
    </Panel>
  );
};

const NPM_PENDING_ID = 'agents-npm-pending';

/**
 * Przycisk linku instalacji: aktywny link albo przycisk niedostępny przed publikacją paczki w npm. Niedostępny ma
 * `aria-disabled` zamiast `disabled`: zostaje osiągalny klawiaturą, a czytnik ekranu czyta przy nim powód z podpisu.
 */
const InstallLink: React.FC<{ href: string | null; label: string }> = ({ href, label }) =>
  href ? (
    <a href={href} className={BTN_SECONDARY}>
      {label}
    </a>
  ) : (
    <button type="button" aria-disabled="true" aria-describedby={NPM_PENDING_ID} onClick={() => undefined} className={BTN_SECONDARY}>
      {label}
    </button>
  );

export const EditorsCard: React.FC<{ status?: McpStatus }> = ({ status = MCP_STATUS }) => {
  const cursor = cursorLink(status);
  const vscode = vscodeLink(status);
  return (
    <Panel title={tr('Cursor i VS Code', 'Cursor and VS Code')} bodyClassName="px-4 py-3 flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <InstallLink href={cursor} label={tr('Zainstaluj w Cursorze', 'Install in Cursor')} />
        <InstallLink href={vscode} label={tr('Zainstaluj w VS Code', 'Install in VS Code')} />
      </div>
      {cursor === null || vscode === null ? (
        <p id={NPM_PENDING_ID} className="text-xs text-ink-3 leading-relaxed">
          {tr(
            'Aktywne po publikacji paczki npm: link instalacji podaje edytorowi gotowe polecenie, a ścieżka repozytorium jest inna u każdego. Do tego czasu dodaj serwer ręcznie w ustawieniach MCP edytora: polecenie node i ścieżka bundla jak wyżej.',
            "Active after the npm package is published: an install link hands the editor a ready command, and the repository path differs for everyone. Until then, add the server by hand in the editor's MCP settings: the command node and the bundle path as above."
          )}
        </p>
      ) : (
        <p className="text-xs text-ink-3 leading-relaxed">
          {tr('Link otwiera edytor z gotową konfiguracją serwera do zatwierdzenia.', 'The link opens the editor with the server configuration ready to confirm.')}
        </p>
      )}
    </Panel>
  );
};

const OtherClientsCard: React.FC = () => {
  const json = claudeDesktopJson(MCP_STATUS);
  return (
    <Panel title={tr('Inne klienty MCP', 'Other MCP clients')} bodyClassName="px-4 py-3 flex flex-col gap-3">
      <p className="text-sm text-ink-2 leading-relaxed">
        {tr(
          'Każdy klient, który uruchamia serwery STDIO. JSON w formacie mcpServers, jak w pliku claude_desktop_config.json:',
          'Any client that launches STDIO servers. JSON in the mcpServers format, as in claude_desktop_config.json:'
        )}
      </p>
      <pre className={CODE_BLOCK}>
        <Path text={json} />
      </pre>
      <CopyButton
        text={json}
        label={tr('Kopiuj JSON', 'Copy JSON')}
        fallback={tr('Schowek niedostępny: zaznacz JSON i skopiuj go ręcznie.', 'Clipboard unavailable: select the JSON and copy it by hand.')}
      />
      <p className="text-xs text-ink-3 leading-relaxed">
        {tr(
          'Na Windows zapisz ścieżkę w JSON-ie ukośnikami zwykłymi (C:/path/to/HyperQuant/…) albo podwójnymi odwrotnymi (C:\\\\path\\\\to\\\\HyperQuant\\\\…).',
          'On Windows, write the path in JSON with forward slashes (C:/path/to/HyperQuant/…) or doubled backslashes (C:\\\\path\\\\to\\\\HyperQuant\\\\…).'
        )}
      </p>
      <p className="text-xs text-ink-3 leading-relaxed">
        {tr('Teksty odpowiedzi po polsku: dodaj ', 'Tool texts in Polish: add ')}
        <code className="font-mono text-ink-2">{'"env": { "HQ_LANG": "pl" }'}</code>
        {tr('. Pełna instrukcja w ', '. Full setup in the ')}
        <A href={githubUrl(MCP_README_FILE)}>{tr('README paczki', 'package README')}</A>.
      </p>
    </Panel>
  );
};

const Install: React.FC = () => (
  <section className="flex flex-col gap-3">
    <SectionHead title={tr('Zainstaluj HyperQuant MCP', 'Install HyperQuant MCP')}>
      {tr(
        'Wybierz klienta. Serwer działa na Twoim komputerze i pobiera tylko dane publiczne; nie wysyła nic o Tobie poza zwykłym zapytaniem HTTP.',
        'Pick your client. The server runs on your computer and fetches public data only; it sends nothing about you beyond a plain HTTP request.'
      )}
    </SectionHead>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      <ClaudeCard />
      <ServerCard />
    </div>
    {/* Szersza kolumna na JSON (mieści się bez zawijania od 1280 px); na 1024–1279 px JSON pod spodem na całą szerokość */}
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-[1fr_1fr_1.45fr] gap-4 items-start">
      <OpenBotCard />
      <EditorsCard />
      <div className="lg:col-span-2 xl:col-span-1 min-w-0">
        <OtherClientsCard />
      </div>
    </div>
  </section>
);

const Skill: React.FC = () => (
  <Panel title={tr('Skill hyperquant', 'The hyperquant skill')} bodyClassName="px-4 py-3 flex flex-col gap-3">
    <p className="text-sm text-ink-2 leading-relaxed max-w-prose">
      {tr(
        'Skill (plik SKILL.md) zamienia narzędzia w pięć codziennych zadań tradera: które narzędzia wywołać, w jakiej kolejności i co podać w odpowiedzi. Dodaj go obok serwera MCP, np. w OpenBocie albo w Claude.',
        'The skill (a SKILL.md file) turns the tools into five everyday trader tasks: which tools to call, in what order and what to report. Add it next to the MCP server, for example in OpenBot or Claude.'
      )}
    </p>
    <ul className="flex flex-col divide-y divide-line">
      {SKILL_RECIPES.map((r) => (
        <li key={r.title.en} className="flex flex-col gap-1.5 py-2.5 first:pt-0">
          <div className="text-sm font-medium text-ink-1">{tr(r.title.pl, r.title.en)}</div>
          <div className="text-sm text-ink-2">{quote(tr(r.ask.pl, r.ask.en))}</div>
          <ToolChips names={r.tools} />
        </li>
      ))}
    </ul>
    <div className="text-sm">
      <A href={githubUrl(SKILL_FILE)}>{tr('SKILL.md na GitHubie', 'SKILL.md on GitHub')}</A>
    </div>
  </Panel>
);

const Tools: React.FC = () => (
  <Panel title={tr('10 narzędzi', '10 tools')} bodyClassName="px-4 py-3">
    <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
      {TOOL_META.map((m) => (
        // Bez linii pod ostatnim wierszem (na telefonie ostatnia pozycja, od md dwie ostatnie)
        <li key={m.name} className="flex flex-col gap-1 py-3 border-b border-line last:border-b-0 md:[&:nth-last-child(2)]:border-b-0 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <code className="font-mono text-[13px] text-accent">{m.name}</code>
            <span className="text-xs text-ink-3">{tr(m.title.pl, m.title.en)}</span>
          </div>
          <p className="text-sm text-ink-2 leading-relaxed">{tr(m.about.pl, m.about.en)}</p>
          <p className="text-sm text-ink-1">{quote(tr(m.ask.pl, m.ask.en))}</p>
        </li>
      ))}
    </ul>
  </Panel>
);

const RULES: { mark: React.ReactNode; text: string }[] = [
  { mark: <Badge tone="live">LIVE</Badge>, text: tr('zmierzone z bieżących danych publicznych', 'measured from current public data') },
  { mark: <Badge tone="model">MODEL</Badge>, text: tr('wynik modelu; metoda podana przy liczbie', 'a model output; the method is named with the number') },
  { mark: <Badge tone="sim">SIM</Badge>, text: tr('symulacja', 'a simulation') },
  {
    mark: <span className="font-mono text-ink-1 px-1.5">{DASH}</span>,
    text: tr('brak danych, zawsze z powodem; nigdy 0 ani wartość zastępcza', 'no data, always with the reason; never 0 or a placeholder'),
  },
];

const Rules: React.FC = () => (
  <Panel title={tr('Zasady danych', 'Data rules')} bodyClassName="px-4 py-3 flex flex-col gap-3 text-sm leading-relaxed">
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-baseline">
      {RULES.map((r) => (
        <React.Fragment key={r.text}>
          <dt className="justify-self-start">{r.mark}</dt>
          <dd className="text-ink-2">{r.text}</dd>
        </React.Fragment>
      ))}
    </dl>
    <ul className="flex flex-col gap-2 text-ink-2 list-disc pl-5 marker:text-ink-3">
      <li>{tr('Każda odpowiedź ma czas danych (asOf, UTC) i źródła z adresami.', 'Every response has the data time (asOf, UTC) and its sources with URLs.')}</li>
      <li>
        {tr(
          'Bez rad: opis rynku, bez sygnałów kupna i sprzedaży, wejść, celów i stopów.',
          'No advice: a market description, with no buy or sell signals, entries, targets or stops.'
        )}
      </li>
      <li>
        {tr(
          'Bez adresów: tylko agregaty i pseudonimy ważne jedną dobę UTC, nigdy adresy portfeli ani hashe transakcji.',
          'No addresses: aggregates and pseudonyms valid for one UTC day only, never wallet addresses or transaction hashes.'
        )}
      </li>
      <li>{tr('Tylko odczyt i tylko BTC: bez kluczy, kont, handlu i zleceń.', 'Read-only and BTC only: no keys, accounts, trading or orders.')}</li>
      <li>
        {tr(
          'Te same funkcje co strona, ale cena to ostatnie zamknięcie świecy 1m, więc liczby mogą się nieco różnić od strony w tej samej chwili.',
          'The same functions as the site, but the price is the last 1-minute close, so numbers can differ slightly from the site at the same moment.'
        )}
      </li>
    </ul>
  </Panel>
);

/**
 * Zakładka „Agenci AI”: szablony agentów, instalacja serwera MCP (Claude Desktop jednym plikiem, OpenBot, Cursor i VS Code,
 * inne klienty), skill i 10 narzędzi z zasadami danych. Statyczna treść bez danych rynkowych; stan paczki z `MCP_STATUS`.
 */
const AgentsView: React.FC = () => (
  <div className="flex flex-col gap-8">
    <Intro />
    <Templates />
    <Install />
    <section className="flex flex-col gap-3">
      <SectionHead title={tr('Skill i narzędzia', 'Skill and tools')}>
        {tr(
          'Co asystent potrafi i jak podaje liczby. Pytaj zwykłym językiem; przykłady poniżej.',
          'What the assistant can do and how it reports numbers. Ask in plain language; examples below.'
        )}
      </SectionHead>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-8 min-w-0">
          <Tools />
        </div>
        <div className="lg:col-span-4 flex flex-col gap-4 min-w-0">
          <Skill />
          <Rules />
        </div>
      </div>
    </section>
    <p className="text-xs text-ink-3 leading-relaxed max-w-prose">
      {tr(
        'Opis rynku, nie porada inwestycyjna. HyperQuant to narzędzie edukacyjne: nie generuje sygnałów transakcyjnych, a asystent z jego narzędziami też nie. Handel instrumentami z dźwignią wiąże się z wysokim ryzykiem utraty kapitału.',
        'Market description, not investment advice. HyperQuant is an educational tool: it does not generate trading signals, and neither does an assistant using its tools. Trading leveraged instruments carries a high risk of losing capital.'
      )}
    </p>
  </div>
);
export default AgentsView;
