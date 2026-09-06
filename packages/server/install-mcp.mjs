#!/usr/bin/env node
/**
 * diagram-plus MCP installer.
 *
 * Registers the diagram-plus MCP server with every AI coding tool on this
 * machine that speaks MCP. Deliberately dependency-free plain JavaScript so it
 * runs before anything is built — including when its job is to build first.
 *
 * Run it with:  npm run install-mcp     (or:  dgp install-mcp)
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';

const SERVER_NAME = 'diagram-plus';
const HOME = homedir();
const PLATFORM = platform();
const WINDOWS = PLATFORM === 'win32';
const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The script that builds everything the MCP server needs: core, mcp, server.
 * Deliberately not the full `build` — the browser editor is a separate concern
 * and its bundler brings platform-specific binaries that have nothing to do
 * with registering a stdio server.
 */
const BUILD_SCRIPT = 'build:libs';

/* ------------------------------------------------------------------ *
 * Terminal output
 * ------------------------------------------------------------------ */

const ESC = '\x1b[';
const useColor = Boolean(process.stdout.isTTY) && !process.env['NO_COLOR'];
const paint = (code, text) => (useColor ? `${ESC}${code}m${text}${ESC}0m` : text);
const bold = (t) => paint('1', t);
const dim = (t) => paint('2', t);
const green = (t) => paint('32', t);
const yellow = (t) => paint('33', t);
const blue = (t) => paint('36', t);
const red = (t) => paint('31', t);

const say = (text = '') => process.stdout.write(`${text}\n`);
const warn = (text) => process.stdout.write(`${yellow('!')} ${text}\n`);
const fail = (text) => process.stderr.write(`${red('x')} ${text}\n`);

/* ------------------------------------------------------------------ *
 * Small filesystem and process helpers
 * ------------------------------------------------------------------ */

function isFile(target) {
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

function isDir(target) {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** Is this command on PATH? */
function onPath(command) {
  const probe = WINDOWS ? 'where' : 'which';
  const result = spawnSync(probe, [command], { stdio: 'ignore' });
  return result.status === 0;
}

/**
 * Quote one argument for cmd.exe. Two parsers read this line in turn, so it is
 * escaped twice: first the way the child's C runtime expects (double the
 * backslashes that run into a quote, then escape the quote), and then with a
 * caret in front of every character cmd.exe treats as syntax — the quotes
 * included, so cmd never enters a quoted state of its own and an `&` in a
 * project path cannot end up looking like a second command.
 */
function quoteForCmd(arg) {
  const text = String(arg);
  const quoted =
    text === ''
      ? '""'
      : /[\s"]/.test(text)
        ? `"${text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`
        : text;
  return quoted.replace(/[()%!^"<>&|]/g, '^$&');
}

/**
 * spawnSync that also works on Windows.
 *
 * `npm`, `code` and friends are `.cmd` shims there, so plain spawnSync cannot
 * find them (ENOENT) — and since the fix for CVE-2024-27980 Node refuses to
 * run a `.cmd` without a shell anyway. Windows therefore goes through cmd.exe
 * with the arguments quoted for it; everywhere else this is spawnSync.
 */
function runCommand(command, args, options = {}) {
  if (!WINDOWS) return spawnSync(command, args, options);
  const line = [command, ...args].map(quoteForCmd).join(' ');
  return spawnSync(line, { ...options, shell: true });
}

/**
 * Run an npm script. When npm started this script it exports `npm_execpath`,
 * and running that file with the node binary already in hand skips the shell
 * and the PATH lookup entirely — the most reliable route on every platform.
 */
function runNpm(args, options = {}) {
  const execPath = process.env['npm_execpath'];
  if (execPath && execPath.endsWith('.js') && isFile(execPath)) {
    return spawnSync(process.execPath, [execPath, ...args], options);
  }
  return runCommand('npm', args, options);
}

function readJson(file) {
  if (!isFile(file)) return { data: {}, existed: false };
  const text = readFileSync(file, 'utf8').trim();
  if (!text) return { data: {}, existed: true };
  try {
    return { data: JSON.parse(text), existed: true };
  } catch (err) {
    throw new Error(
      `${file} is not valid JSON (${err.message}). Fix or move it, then run this again.`,
    );
  }
}

/** Keep a timestamped copy the first time a run touches an existing file. */
const backedUp = new Set();
function backup(file, results) {
  if (!isFile(file) || backedUp.has(file)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const copy = `${file}.backup-${stamp}`;
  copyFileSync(file, copy, constants.COPYFILE_EXCL);
  backedUp.add(file);
  results.backups.push(copy);
}

function writeText(file, contents) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents, 'utf8');
}

function writeJson(file, data) {
  writeText(file, `${JSON.stringify(data, null, 2)}\n`);
}

function homePath(...parts) {
  return path.join(HOME, ...parts);
}

/** `~/...` rather than the full path, purely so output stays readable. */
function short(file) {
  return file.startsWith(HOME) ? `~${file.slice(HOME.length)}` : file;
}

/* ------------------------------------------------------------------ *
 * Where things live
 * ------------------------------------------------------------------ */

function claudeDesktopConfig() {
  if (PLATFORM === 'darwin') {
    return homePath('Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (PLATFORM === 'win32') {
    const appData = process.env['APPDATA'] ?? homePath('AppData', 'Roaming');
    return path.join(appData, 'Claude', 'claude_desktop_config.json');
  }
  return homePath('.config', 'Claude', 'claude_desktop_config.json');
}

function vscodeUserSettings() {
  if (PLATFORM === 'darwin') {
    return homePath('Library', 'Application Support', 'Code', 'User', 'settings.json');
  }
  if (PLATFORM === 'win32') {
    const appData = process.env['APPDATA'] ?? homePath('AppData', 'Roaming');
    return path.join(appData, 'Code', 'User', 'settings.json');
  }
  return homePath('.config', 'Code', 'User', 'settings.json');
}

/** Absolute path to the MCP server's stdio entry point. */
function resolveServerEntry() {
  const require = createRequire(import.meta.url);
  try {
    const entry = require.resolve('@diagram-plus/mcp');
    return path.join(path.dirname(entry), 'bin.js');
  } catch {
    // Source checkout: packages/server/install-mcp.mjs -> packages/mcp/dist/bin.js
    return path.resolve(HERE, '..', 'mcp', 'dist', 'bin.js');
  }
}

/** The repository root, when this is running from a source checkout. */
function resolveRepoRoot() {
  const candidate = path.resolve(HERE, '..', '..');
  const manifest = path.join(candidate, 'package.json');
  if (!isFile(manifest)) return null;
  try {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    return Array.isArray(pkg.workspaces) ? candidate : null;
  } catch {
    return null;
  }
}

/** Walk up looking for something that marks a project root. */
function findProjectRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    for (const marker of ['.diagrams', '.git', 'package.json']) {
      if (existsSync(path.join(dir, marker))) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

/* ------------------------------------------------------------------ *
 * The clients
 * ------------------------------------------------------------------ *
 *
 * `project` targets are per-repository config files, committed with the code.
 * `global` targets are per-user.
 *
 * `pinsRoot` marks a client that is not launched from a project directory — a
 * desktop app. Those need DIAGRAM_PLUS_ROOT baked in, because there is no
 * working directory to infer the project from. Terminal clients are better off
 * without it: one global install then works in every project.
 */

const CLIENTS = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    kind: 'terminal',
    project: (ctx) => ({ file: path.join(ctx.project, '.mcp.json'), format: 'mcpServers' }),
    global: () => ({ file: homePath('.claude.json'), format: 'mcpServers', cli: 'claude' }),
    detect: () => onPath('claude') || isDir(homePath('.claude')) || isFile(homePath('.claude.json')),
    after: 'Restart Claude Code, then check with /mcp.',
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    kind: 'desktop',
    pinsRoot: true,
    global: () => ({ file: claudeDesktopConfig(), format: 'mcpServers' }),
    detect: () => isDir(path.dirname(claudeDesktopConfig())),
    after: 'Quit Claude Desktop completely and reopen it.',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    kind: 'terminal',
    global: () => ({ file: homePath('.codex', 'config.toml'), format: 'toml' }),
    detect: () => onPath('codex') || isDir(homePath('.codex')),
    after: 'Start a new codex session.',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    kind: 'desktop',
    pinsRoot: true,
    project: (ctx) => ({ file: path.join(ctx.project, '.cursor', 'mcp.json'), format: 'mcpServers' }),
    global: () => ({ file: homePath('.cursor', 'mcp.json'), format: 'mcpServers' }),
    detect: () => isDir(homePath('.cursor')) || onPath('cursor'),
    after: 'Reload Cursor, then enable the server under Settings > MCP.',
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    kind: 'desktop',
    pinsRoot: true,
    global: () => ({
      file: homePath('.codeium', 'windsurf', 'mcp_config.json'),
      format: 'mcpServers',
    }),
    detect: () => isDir(homePath('.codeium', 'windsurf')),
    after: 'Reload Windsurf, then refresh the MCP server list.',
  },
  {
    id: 'vscode',
    label: 'VS Code (Copilot)',
    kind: 'desktop',
    pinsRoot: true,
    project: (ctx) => ({
      file: path.join(ctx.project, '.vscode', 'mcp.json'),
      format: 'vscodeServers',
    }),
    global: () => ({ file: vscodeUserSettings(), format: 'vscodeSettings' }),
    detect: () => onPath('code') || isFile(vscodeUserSettings()),
    after: 'Reload the window, then pick the server from the Copilot Chat tool list.',
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    kind: 'terminal',
    project: (ctx) => ({
      file: path.join(ctx.project, '.gemini', 'settings.json'),
      format: 'mcpServers',
    }),
    global: () => ({ file: homePath('.gemini', 'settings.json'), format: 'mcpServers' }),
    detect: () => onPath('gemini') || isDir(homePath('.gemini')),
    after: 'Start a new gemini session, then check with /mcp.',
  },
];

function clientById(id) {
  return CLIENTS.find((client) => client.id === id);
}

/** The target a client uses for this scope, or null if it has none. */
function targetFor(client, scope, ctx) {
  const build = client[scope];
  return build ? build(ctx) : null;
}

/* ------------------------------------------------------------------ *
 * Writing each config format
 * ------------------------------------------------------------------ *
 *
 * Every writer returns { action, detail } and never throws for the ordinary
 * "already correct" case — reinstalling should be boring.
 */

function serverEntry(entryPath, env) {
  const definition = { command: process.execPath, args: [entryPath] };
  if (env) definition.env = env;
  return definition;
}

function sameDefinition(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** `{ "mcpServers": { "diagram-plus": {...} } }` — the common shape. */
function writeMcpServers({ file, entryPath, env, remove, dryRun, results }) {
  const { data, existed } = readJson(file);
  const servers = (data.mcpServers && typeof data.mcpServers === 'object') ? data.mcpServers : {};

  if (remove) {
    if (!servers[SERVER_NAME]) return { action: 'absent' };
    if (!dryRun) {
      backup(file, results);
      delete servers[SERVER_NAME];
      data.mcpServers = servers;
      writeJson(file, data);
    }
    return { action: 'removed' };
  }

  const definition = serverEntry(entryPath, env);
  if (sameDefinition(servers[SERVER_NAME], definition)) return { action: 'unchanged' };

  if (!dryRun) {
    backup(file, results);
    servers[SERVER_NAME] = definition;
    data.mcpServers = servers;
    writeJson(file, data);
  }
  return { action: existed && servers[SERVER_NAME] ? 'updated' : 'added' };
}

/** `.vscode/mcp.json` — `{ "servers": { name: { type: "stdio", ... } } }`. */
function writeVscodeServers({ file, entryPath, env, remove, dryRun, results }) {
  const { data } = readJson(file);
  const servers = (data.servers && typeof data.servers === 'object') ? data.servers : {};

  if (remove) {
    if (!servers[SERVER_NAME]) return { action: 'absent' };
    if (!dryRun) {
      backup(file, results);
      delete servers[SERVER_NAME];
      data.servers = servers;
      writeJson(file, data);
    }
    return { action: 'removed' };
  }

  const definition = { type: 'stdio', ...serverEntry(entryPath, env) };
  if (sameDefinition(servers[SERVER_NAME], definition)) return { action: 'unchanged' };

  if (!dryRun) {
    backup(file, results);
    servers[SERVER_NAME] = definition;
    data.servers = servers;
    writeJson(file, data);
  }
  return { action: 'added' };
}

/**
 * VS Code user settings live in JSONC, and rewriting that file would strip the
 * user's comments. `code --add-mcp` does the edit properly, so use it when VS
 * Code is on PATH and hand over a snippet when it is not.
 */
function writeVscodeSettings({ file, entryPath, env, remove, dryRun, results }) {
  if (remove) {
    // Two places to look. Recent VS Code keeps MCP servers in User/mcp.json —
    // which is where `code --add-mcp` puts them, so it is where an install by
    // this script most likely landed — while older versions read an mcp.servers
    // key in settings.json. Clean out whichever one actually has the entry.
    const userMcpJson = path.join(path.dirname(file), 'mcp.json');
    const viaMcpJson = writeVscodeServers({
      file: userMcpJson,
      entryPath,
      env,
      remove: true,
      dryRun,
      results,
    });

    const { data } = readJson(file);
    const servers = data?.mcp?.servers;
    if (servers?.[SERVER_NAME]) {
      if (!dryRun) {
        backup(file, results);
        delete servers[SERVER_NAME];
        writeJson(file, data);
      }
      return { action: 'removed' };
    }

    if (viaMcpJson.action === 'removed') return { action: 'removed', detail: short(userMcpJson) };
    return { action: 'absent' };
  }

  const definition = { name: SERVER_NAME, type: 'stdio', ...serverEntry(entryPath, env) };

  if (onPath('code')) {
    if (dryRun) return { action: 'added', detail: 'via code --add-mcp' };
    const result = runCommand('code', ['--add-mcp', JSON.stringify(definition)], {
      stdio: 'ignore',
    });
    if (result.status === 0) return { action: 'added', detail: 'via code --add-mcp' };
  }

  const snippet = JSON.stringify(
    { mcp: { servers: { [SERVER_NAME]: { type: 'stdio', ...serverEntry(entryPath, env) } } } },
    null,
    2,
  );
  return {
    action: 'manual',
    detail:
      `VS Code user settings are JSONC and this installer will not rewrite them.\n` +
      `      Add this to ${short(file)} yourself:\n\n` +
      snippet
        .split('\n')
        .map((line) => `      ${line}`)
        .join('\n'),
  };
}

/**
 * Codex reads TOML. Rather than depend on a TOML library, find the existing
 * `[mcp_servers.diagram-plus]` table by scanning section headers and replace
 * just that block — every other line is left byte for byte as it was.
 */
function writeToml({ file, entryPath, env, remove, dryRun, results }) {
  const header = `[mcp_servers.${SERVER_NAME}]`;
  const original = isFile(file) ? readFileSync(file, 'utf8') : '';
  const lines = original.split('\n');

  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (start === -1) {
      if (trimmed === header) start = i;
      continue;
    }
    // The next top-level table header closes our block.
    if (trimmed.startsWith('[')) {
      end = i;
      break;
    }
  }

  if (remove) {
    if (start === -1) return { action: 'absent' };
    if (!dryRun) {
      backup(file, results);
      const kept = [...lines.slice(0, start), ...lines.slice(end)];
      writeText(file, `${kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`);
    }
    return { action: 'removed' };
  }

  const block = [header, `command = ${JSON.stringify(process.execPath)}`, `args = [${JSON.stringify(entryPath)}]`];
  if (env) {
    const pairs = Object.entries(env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`);
    block.push(`env = { ${pairs.join(', ')} }`);
  }
  const rendered = block.join('\n');

  if (start !== -1) {
    const existing = lines.slice(start, end).join('\n').trimEnd();
    if (existing === rendered) return { action: 'unchanged' };
    if (!dryRun) {
      backup(file, results);
      const next = [...lines.slice(0, start), rendered, '', ...lines.slice(end)];
      writeText(file, `${next.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`);
    }
    return { action: 'updated' };
  }

  if (!dryRun) {
    backup(file, results);
    const prefix = original.trim() ? `${original.trimEnd()}\n\n` : '';
    writeText(file, `${prefix}${rendered}\n`);
  }
  return { action: 'added' };
}

const WRITERS = {
  mcpServers: writeMcpServers,
  vscodeServers: writeVscodeServers,
  vscodeSettings: writeVscodeSettings,
  toml: writeToml,
};

/* ------------------------------------------------------------------ *
 * Arguments
 * ------------------------------------------------------------------ */

const HELP = `${bold('diagram-plus install-mcp')} — register the MCP server with your AI tools

${bold('Usage')}
  npm run install-mcp                    Interactive: pick scope and tools
  npm run install-mcp -- --global --yes  Install for every detected tool, no prompts

${bold('Options')}
  --scope <local|global>   local  = this project only (config committed with the repo)
                           global = every project on this machine
  --local, --global        Shorthand for the above
  --project <path>         Project root for a local install (default: nearest project)
  --clients <a,b,c>        Only these tools. Ids: ${CLIENTS.map((c) => c.id).join(', ')}
  --all                    Include tools that are not detected on this machine
  --uninstall              Remove the server from the selected tools instead
  --dry-run                Show what would change, write nothing
  --list                   List the supported tools and where each is configured
  --yes, -y                Take the defaults, ask nothing
  --no-build               Do not offer to build the server first
  --help, -h               This message

${bold('Local or global?')}
  ${bold('local')}   writes project config files (.mcp.json, .cursor/mcp.json, ...) that you
          commit, so anyone who clones the repo gets the server too. The project
          path is pinned, so diagrams always resolve to this repository.
  ${bold('global')}  writes your user config. Terminal tools then pick up the diagrams of
          whichever project you run them in. Desktop apps have no working
          directory, so they get a project path pinned in.
`;

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-y') {
      flags.yes = true;
    } else if (arg === '-h') {
      flags.help = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      rest.push(arg);
    }
  }
  return { flags, rest };
}

/* ------------------------------------------------------------------ *
 * Prompts
 * ------------------------------------------------------------------ */

/**
 * One readline interface per question. The list picker below drives stdin in
 * raw mode, and two things reading the same terminal at once is how prompts
 * start swallowing each other's keystrokes — so nothing holds it open between
 * questions.
 */
async function question(text) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(text)).trim();
  } finally {
    rl.close();
  }
}

async function ask(prompt, fallback) {
  const answer = await question(`${prompt} ${dim(`[${fallback}]`)} `);
  return answer || fallback;
}

async function confirm(prompt, fallback = true) {
  const hint = fallback ? 'Y/n' : 'y/N';
  const answer = (await question(`${prompt} ${dim(`(${hint})`)} `)).toLowerCase();
  if (!answer) return fallback;
  return answer.startsWith('y');
}

/* ------------------------------------------------------------------ *
 * The list picker
 * ------------------------------------------------------------------ *
 *
 * Arrow keys to move, space to tick, enter to confirm. Needs a real terminal
 * it can put into raw mode; every caller falls back to a typed answer when
 * `canPick()` says no (a pipe, a CI job, some IDE consoles).
 */

const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const CLEAR_LINE = `${ESC}2K`;

function canPick() {
  return Boolean(
    process.stdin.isTTY && process.stdout.isTTY && typeof process.stdin.setRawMode === 'function',
  );
}

/**
 * Join styled segments into a line no wider than the terminal. Truncating the
 * plain text before painting it keeps escape codes intact — and keeps every
 * frame exactly one terminal row per line, which is what lets the redraw below
 * count on moving up a fixed number of rows.
 */
function fit(segments, width) {
  let used = 0;
  let line = '';
  for (const [text, style] of segments) {
    if (used >= width) break;
    const piece = text.length > width - used ? text.slice(0, width - used) : text;
    line += style ? style(piece) : piece;
    used += piece.length;
  }
  return line;
}

/**
 * Show a list and return the chosen items, or null if the user backed out with
 * escape. `multiple` gives checkboxes; otherwise it is a radio list.
 *
 * Items are `{ label, note, lines, value }` — `note` is `[text, style]`, and
 * `lines` are dim detail rows shown under the label.
 */
function pick({ items, selected = [], multiple = false }) {
  return new Promise((resolve) => {
    const out = process.stdout;
    const stdin = process.stdin;
    const chosen = new Set(selected);
    let cursor = items.length ? Math.min(...(chosen.size ? [...chosen] : [0])) : 0;
    let height = 0;

    const help = multiple
      ? 'up/down move · space toggles · a all · n none · enter confirms'
      : 'up/down move · enter confirms';

    const pad = Math.max(...items.map((item) => item.label.length)) + 2;

    const draw = () => {
      const width = Math.max(40, (out.columns ?? 80) - 1);
      const lines = [];

      items.forEach((item, index) => {
        const active = index === cursor;
        const ticked = chosen.has(index);
        const box = multiple ? (ticked ? '[x]' : '[ ]') : ticked ? '(o)' : '( )';
        const [note, noteStyle] = item.note ?? ['', dim];
        lines.push(
          fit(
            [
              ['  ', null],
              [active ? '>' : ' ', blue],
              [' ', null],
              [box, ticked ? green : dim],
              [' ', null],
              [item.label.padEnd(pad), active ? bold : null],
              [note ? ` ${note}` : '', noteStyle],
            ],
            width,
          ),
        );
        for (const detail of item.lines ?? []) {
          lines.push(fit([['        ', null], [detail, dim]], width));
        }
      });

      lines.push('');
      lines.push(fit([['  ', null], [help, dim]], width));

      let frame = height ? `${ESC}${height}A` : '';
      for (const line of lines) frame += `${CLEAR_LINE}${line}\n`;
      height = lines.length;
      out.write(frame);
    };

    const release = () => {
      stdin.off('keypress', onKey);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      out.write(SHOW_CURSOR);
    };

    const onKey = (_char, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        release();
        out.write('\n');
        process.exit(130);
      }

      switch (key.name) {
        case 'up':
        case 'k':
          cursor = (cursor - 1 + items.length) % items.length;
          break;
        case 'down':
        case 'j':
        case 'tab':
          cursor = (cursor + 1) % items.length;
          break;
        case 'home':
          cursor = 0;
          break;
        case 'end':
          cursor = items.length - 1;
          break;
        case 'space':
          if (!multiple) chosen.clear();
          if (multiple && chosen.has(cursor)) chosen.delete(cursor);
          else chosen.add(cursor);
          break;
        case 'a':
          if (!multiple) return;
          items.forEach((_item, index) => chosen.add(index));
          break;
        case 'n':
          if (!multiple) return;
          chosen.clear();
          break;
        case 'return':
        case 'enter':
          if (!multiple) {
            chosen.clear();
            chosen.add(cursor);
          }
          draw();
          release();
          resolve([...chosen].sort((a, b) => a - b).map((index) => items[index]));
          return;
        case 'escape':
          draw();
          release();
          resolve(null);
          return;
        default:
          return;
      }
      draw();
    };

    if (!items.length) {
      resolve([]);
      return;
    }

    emitKeypressEvents(stdin);
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.on('keypress', onKey);
    out.write(HIDE_CURSOR);
    draw();
  });
}

/** "1,3" / "all" / "" -> the chosen clients. */
function parseSelection(answer, offered, defaults) {
  const trimmed = answer.trim().toLowerCase();
  if (!trimmed) return defaults;
  if (trimmed === 'all') return offered;
  if (trimmed === 'none') return [];

  const chosen = [];
  for (const piece of trimmed.split(/[,\s]+/).filter(Boolean)) {
    const index = Number(piece);
    if (Number.isInteger(index) && index >= 1 && index <= offered.length) {
      chosen.push(offered[index - 1]);
    } else {
      const byId = offered.find((client) => client.id === piece);
      if (byId) chosen.push(byId);
      else warn(`Ignoring "${piece}" — not one of the options.`);
    }
  }
  return [...new Set(chosen)];
}

/* ------------------------------------------------------------------ *
 * Build check
 * ------------------------------------------------------------------ */

async function ensureBuilt(entryPath, { interactive, yes, noBuild, dryRun }) {
  if (isFile(entryPath)) return true;

  const repoRoot = resolveRepoRoot();
  say();
  warn(`The MCP server is not built yet — ${short(entryPath)} does not exist.`);

  if (dryRun) {
    say(dim('  (dry run: continuing anyway)'));
    return true;
  }
  if (!repoRoot || noBuild) {
    fail(`Run \`npm run ${BUILD_SCRIPT}\` in the diagram-plus repository first.`);
    return false;
  }

  const shouldBuild = yes || !interactive || (await confirm('  Build it now?', true));
  if (!shouldBuild) {
    fail(`Nothing installed. Run \`npm run ${BUILD_SCRIPT}\`, then try again.`);
    return false;
  }

  // tsc builds incrementally. If dist was deleted but the .tsbuildinfo beside
  // it survived, tsc decides everything is up to date and emits nothing — the
  // build "succeeds" and the file we are waiting for never appears. Since we
  // are only here because dist is missing, drop those first.
  for (const pkg of ['core', 'mcp', 'server']) {
    const stale = path.join(repoRoot, 'packages', pkg, 'tsconfig.tsbuildinfo');
    if (isFile(stale)) rmSync(stale, { force: true });
  }

  say(dim(`  Building (npm run ${BUILD_SCRIPT} — this takes a few seconds)...`));
  const result = runNpm(['run', BUILD_SCRIPT], { cwd: repoRoot, stdio: 'inherit' });

  // Say which of the three ways this can go wrong actually happened: a bare
  // "the build failed" after a build that printed nothing sends people looking
  // for a compile error that is not there.
  if (result.error) {
    fail(`Could not start npm (${result.error.code ?? result.error.message}).`);
    say(dim(`  Run \`npm run ${BUILD_SCRIPT}\` in ${short(repoRoot)} yourself, then run this again.`));
    return false;
  }
  if (result.status !== 0) {
    fail(`\`npm run ${BUILD_SCRIPT}\` exited with code ${result.status}. Fix the errors above, then run this again.`);
    return false;
  }
  if (!isFile(entryPath)) {
    fail(`The build finished, but ${short(entryPath)} is still missing.`);
    say(dim('  Check that the build wrote to packages/mcp/dist, then run this again.'));
    return false;
  }

  say(`${green('OK')} Built.`);
  return true;
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

const ACTION_STYLE = {
  added: (t) => green(t),
  updated: (t) => green(t),
  removed: (t) => green(t),
  unchanged: (t) => dim(t),
  absent: (t) => dim(t),
  manual: (t) => yellow(t),
  skipped: (t) => dim(t),
  failed: (t) => red(t),
};

const ACTION_LABEL = {
  added: 'installed',
  updated: 'updated',
  removed: 'removed',
  unchanged: 'already set',
  absent: 'not present',
  manual: 'needs a manual step',
  skipped: 'skipped',
  failed: 'failed',
};

function listClients() {
  say();
  say(bold('Supported tools'));
  say();
  for (const client of CLIENTS) {
    const detected = client.detect() ? green('detected') : dim('not detected');
    say(`  ${bold(client.label.padEnd(20))} ${dim(client.id.padEnd(16))} ${detected}`);
    const ctx = { project: process.cwd() };
    for (const scope of ['project', 'global']) {
      const target = targetFor(client, scope, ctx);
      const name = scope === 'project' ? 'local ' : 'global';
      say(`    ${dim(name)}  ${target ? short(target.file) : dim('not supported')}`);
    }
    say();
  }
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));

  if (flags.help) {
    say(HELP);
    return 0;
  }
  if (flags.list) {
    listClients();
    return 0;
  }

  const dryRun = Boolean(flags['dry-run']);
  const uninstall = Boolean(flags.uninstall);
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !flags.yes;

  try {
    say();
    say(bold(`  diagram-plus  ${dim(uninstall ? 'uninstall' : 'MCP installer')}`));
    say(dim(`  Registers the diagram-plus MCP server with your AI coding tools.`));
    say();
    if (dryRun) warn('Dry run — nothing will be written.\n');

    /* ---- 1. scope ------------------------------------------------- */

    let scope = typeof flags.scope === 'string' ? flags.scope : null;
    if (flags.global) scope = 'global';
    if (flags.local) scope = 'local';

    if (scope && !['local', 'global'].includes(scope)) {
      fail(`Unknown scope "${scope}". Use local or global.`);
      return 1;
    }

    if (!scope) {
      if (!interactive) {
        fail('No scope given. Pass --local or --global (or run this in a terminal to be asked).');
        return 1;
      }
      say(bold('  Where should the server be installed?'));
      say();

      const scopes = [
        {
          label: 'local',
          note: ['this project only', dim],
          lines: [
            'writes .mcp.json, .cursor/mcp.json and friends into the',
            'repository, so anyone who clones it gets the server too',
          ],
          value: 'local',
        },
        {
          label: 'global',
          note: ['every project on this machine', dim],
          lines: [
            'writes your user config; terminal tools then pick up the',
            'diagrams of whichever project you run them in',
          ],
          value: 'global',
        },
      ];

      if (canPick()) {
        const picked = await pick({ items: scopes, selected: [1] });
        if (!picked?.length) {
          say(dim('  Cancelled.'));
          return 0;
        }
        scope = picked[0].value;
      } else {
        scopes.forEach((item, index) => {
          say(`    ${bold(`${index + 1}) ${item.label}`)}  ${item.note[0]}`);
          for (const line of item.lines) say(dim(`       ${line}`));
          say();
        });
        const answer = await ask('  Choose 1 or 2', '2');
        scope = answer.startsWith('1') || answer.toLowerCase().startsWith('l') ? 'local' : 'global';
      }
      say();
    }

    const scopeKey = scope === 'local' ? 'project' : 'global';

    /* ---- 2. project root ------------------------------------------ */

    const projectGiven = typeof flags.project === 'string';
    let project = projectGiven ? path.resolve(flags.project) : findProjectRoot(process.cwd());

    // A local install needs the project up front, because it decides where every
    // config file goes. A global install only needs one if a desktop app is
    // picked, so that question waits until we know what was selected.
    if (scope === 'local' && interactive && !projectGiven) {
      say(bold('  Which project is this for?'));
      project = path.resolve(await ask(' ', project));
      say();
    }
    if (scope === 'local' && !isDir(project)) {
      fail(`${project} is not a directory.`);
      return 1;
    }

    const ctx = { project };

    /* ---- 3. which tools ------------------------------------------- */

    const supported = CLIENTS.filter((client) => targetFor(client, scopeKey, ctx));
    const unsupported = CLIENTS.filter((client) => !targetFor(client, scopeKey, ctx));

    let offered = supported;
    let selection;

    if (typeof flags.clients === 'string') {
      const wanted = flags.clients.split(',').map((id) => id.trim()).filter(Boolean);
      selection = [];
      for (const id of wanted) {
        const client = clientById(id);
        if (!client) {
          fail(`Unknown tool "${id}". Known ids: ${CLIENTS.map((c) => c.id).join(', ')}`);
          return 1;
        }
        if (!targetFor(client, scopeKey, ctx)) {
          warn(`${client.label} has no ${scope} config — skipping it.`);
          continue;
        }
        selection.push(client);
      }
    } else {
      const detected = offered.filter((client) => client.detect());
      const defaults = flags.all ? offered : detected;

      if (!flags.all && detected.length === 0) {
        warn('None of the supported tools were detected on this machine.');
        say(dim('  Pass --all to configure them anyway, or --list to see what is supported.'));
        if (!interactive) return 1;
      }

      if (interactive && canPick()) {
        say(bold(`  Which tools should get the server? ${dim(`(${scope} install)`)}`));
        say(dim('  Detected tools are ticked already.'));
        say();
        const items = offered.map((client) => ({
          label: client.label,
          note: client.detect() ? ['detected', green] : ['not detected', dim],
          lines: [short(targetFor(client, scopeKey, ctx).file)],
          value: client,
        }));
        const picked = await pick({
          items,
          selected: defaults.map((client) => offered.indexOf(client)),
          multiple: true,
        });
        if (picked === null) {
          say(dim('  Cancelled.'));
          return 0;
        }
        selection = picked.map((item) => item.value);
        say();
      } else if (interactive) {
        // No raw-mode terminal to draw a list on — ask for numbers instead.
        say(bold(`  Which tools should get the server? ${dim(`(${scope} install)`)}`));
        say();
        offered.forEach((client, index) => {
          const mark = client.detect() ? green('detected') : dim('not detected');
          const target = targetFor(client, scopeKey, ctx);
          say(`    ${bold(String(index + 1))}) ${client.label.padEnd(20)} ${mark}`);
          say(dim(`       ${short(target.file)}`));
        });
        say();
        const fallback = defaults.length === offered.length
          ? 'all'
          : defaults.map((c) => String(offered.indexOf(c) + 1)).join(',') || 'all';
        say(dim('  Numbers separated by commas, or "all", or "none".'));
        const answer = await ask('  Install to', fallback);
        selection = parseSelection(answer, offered, defaults);
        say();
      } else {
        selection = defaults;
      }
    }

    if (selection.length === 0) {
      warn('No tools selected — nothing to do.');
      return 0;
    }

    /* ---- 4. a project path for the desktop apps, if any ------------ */

    const pinning = selection.filter((client) => scope === 'local' || client.pinsRoot);
    if (scope === 'global' && pinning.length && interactive && !projectGiven) {
      const names = pinning.map((c) => c.label).join(', ');
      say(`  ${names} ${pinning.length === 1 ? 'is a desktop app and has' : 'are desktop apps and have'} no working directory,`);
      say('  so they need a project pinned in. Which project should they open?');
      project = path.resolve(await ask(' ', project));
      ctx.project = project;
      say();
    }
    if (pinning.length && !isDir(project)) {
      fail(`${project} is not a directory.`);
      return 1;
    }

    /* ---- 5. resolve the server, build if needed -------------------- */

    const entryPath = resolveServerEntry();
    if (!uninstall) {
      const ready = await ensureBuilt(entryPath, {
        interactive,
        yes: Boolean(flags.yes),
        noBuild: Boolean(flags['no-build']),
        dryRun,
      });
      if (!ready) return 1;
    }

    /* ---- 6. confirm the plan --------------------------------------- */

    const verb = uninstall ? 'Removing from' : 'Installing to';
    say(bold(`  ${verb} ${selection.length} tool${selection.length === 1 ? '' : 's'}:`));
    say();
    for (const client of selection) {
      const target = targetFor(client, scopeKey, ctx);
      const pinned = scope === 'local' || client.pinsRoot;
      say(`    ${client.label.padEnd(20)} ${short(target.file)}`);
      if (!uninstall && pinned) say(dim(`${' '.repeat(24)}project: ${project}`));
      else if (!uninstall) say(dim(`${' '.repeat(24)}project: whichever directory you run it in`));
    }
    say();

    if (interactive && !dryRun) {
      if (!(await confirm('  Go ahead?', true))) {
        say(dim('  Cancelled.'));
        return 0;
      }
      say();
    }

    /* ---- 7. write --------------------------------------------------- */

    const results = { backups: [], rows: [] };

    for (const client of selection) {
      const target = targetFor(client, scopeKey, ctx);
      const writer = WRITERS[target.format];
      const pinned = scope === 'local' || client.pinsRoot;
      const env = pinned ? { DIAGRAM_PLUS_ROOT: project } : undefined;

      try {
        const outcome = writer({
          file: target.file,
          entryPath,
          env,
          remove: uninstall,
          dryRun,
          results,
        });
        results.rows.push({ client, target, ...outcome });
      } catch (err) {
        results.rows.push({ client, target, action: 'failed', detail: err.message });
      }
    }

    /* ---- 8. report --------------------------------------------------- */

    say(bold('  Result'));
    say();
    for (const row of results.rows) {
      const style = ACTION_STYLE[row.action] ?? ((t) => t);
      const label = ACTION_LABEL[row.action] ?? row.action;
      const prefix = ['added', 'updated', 'removed'].includes(row.action) ? green('OK') : ' ·';
      say(`  ${prefix} ${row.client.label.padEnd(20)} ${style(label)}`);
      say(dim(`     ${short(row.target.file)}`));
      if (row.detail) say(`     ${row.detail}`);
    }
    say();

    if (results.backups.length) {
      say(dim(`  Backed up ${results.backups.length} existing file(s):`));
      for (const file of results.backups) say(dim(`    ${short(file)}`));
      say();
    }

    if (unsupported.length && !uninstall) {
      const names = unsupported.map((c) => c.label).join(', ');
      say(dim(`  No ${scope} config for: ${names}. Try the other scope for those.`));
      say();
    }

    const changed = results.rows.filter((r) => ['added', 'updated', 'removed'].includes(r.action));
    if (changed.length && !uninstall) {
      say(bold('  Next'));
      say();
      for (const row of changed) say(`    ${bold(row.client.label)} — ${row.client.after}`);
      say();
      say(`    Then ask it: ${blue(`"use ${SERVER_NAME} to design a block diagram for my project"`)}`);
      say(`    And open the editor with ${blue('dgp')} to review what it draws.`);
      say();
    }

    if (dryRun) say(dim('  Dry run — nothing was written.\n'));

    return results.rows.some((r) => r.action === 'failed') ? 1 : 0;
  } finally {
    if (process.stdin.isTTY) process.stdout.write(SHOW_CURSOR);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    fail(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
