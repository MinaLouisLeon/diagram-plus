import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The installer is exercised as a subprocess with a sandboxed HOME, because
 * what matters is the bytes it leaves in each tool's config file — including
 * that it leaves everyone else's entries alone.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = path.join(REPO, 'packages', 'server', 'install-mcp.mjs');
const MCP_ENTRY = path.join(REPO, 'packages', 'mcp', 'dist', 'bin.js');

let home: string;
let project: string;

function run(args: string[]): { status: number; stdout: string } {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1' },
    encoding: 'utf8',
  });
  return { status: result.status ?? 1, stdout: `${result.stdout}${result.stderr}` };
}

const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>;

beforeAll(() => {
  // The installer registers a path to the built server, so it has to exist.
  if (!existsSync(MCP_ENTRY)) {
    execFileSync('npm', ['run', 'build', '-w', '@diagram-plus/mcp'], { cwd: REPO, stdio: 'ignore' });
  }
}, 120_000);

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'dgp-home-'));
  project = await mkdtemp(path.join(os.tmpdir(), 'dgp-project-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(project, { recursive: true, force: true });
});

describe('the installer', () => {
  it('lists every supported tool and where it is configured', () => {
    const { status, stdout } = run(['--list']);
    expect(status).toBe(0);
    for (const id of ['claude-code', 'claude-desktop', 'codex', 'cursor', 'windsurf', 'vscode', 'gemini-cli']) {
      expect(stdout).toContain(id);
    }
  });

  it('refuses to guess a scope when it cannot ask', () => {
    const { status, stdout } = run([]);
    expect(status).toBe(1);
    expect(stdout).toContain('--local or --global');
  });

  it('rejects an unknown tool by name', () => {
    const { status, stdout } = run(['--global', '--clients', 'notepad', '--yes']);
    expect(status).toBe(1);
    expect(stdout).toContain('Unknown tool "notepad"');
  });

  it('writes project config for a local install, pinned to the project', () => {
    const { status } = run(['--local', '--project', project, '--all', '--yes']);
    expect(status).toBe(0);

    const claude = readJson(path.join(project, '.mcp.json'));
    expect(claude.mcpServers['diagram-plus'].args[0]).toBe(MCP_ENTRY);
    expect(claude.mcpServers['diagram-plus'].env.DIAGRAM_PLUS_ROOT).toBe(project);

    // Cursor and Gemini use the same shape; VS Code uses a different one.
    expect(readJson(path.join(project, '.cursor', 'mcp.json')).mcpServers['diagram-plus']).toBeDefined();
    expect(readJson(path.join(project, '.gemini', 'settings.json')).mcpServers['diagram-plus']).toBeDefined();
    expect(readJson(path.join(project, '.vscode', 'mcp.json')).servers['diagram-plus'].type).toBe('stdio');
  });

  it('pins a project for desktop apps but not for terminal tools on a global install', () => {
    run(['--global', '--project', project, '--all', '--yes']);

    // Claude Code runs in a directory, so it resolves diagrams per project.
    const claudeCode = readJson(path.join(home, '.claude.json')).mcpServers['diagram-plus'];
    expect(claudeCode.env).toBeUndefined();

    // Claude Desktop has no working directory, so the project is baked in.
    const desktopConfig = path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
    expect(readJson(desktopConfig).mcpServers['diagram-plus'].env.DIAGRAM_PLUS_ROOT).toBe(project);
  });

  it('keeps other people\'s servers and unrelated settings', () => {
    writeFileSync(
      path.join(home, '.claude.json'),
      JSON.stringify({ numStartups: 42, mcpServers: { other: { command: 'node', args: ['/x.js'] } } }),
    );
    mkdirSync(path.join(home, '.codex'), { recursive: true });
    writeFileSync(
      path.join(home, '.codex', 'config.toml'),
      'model = "gpt-5"\n\n[mcp_servers.something-else]\ncommand = "npx"\n',
    );

    run(['--global', '--project', project, '--clients', 'claude-code,codex', '--yes']);

    const claude = readJson(path.join(home, '.claude.json'));
    expect(claude.numStartups).toBe(42);
    expect(claude.mcpServers.other).toBeDefined();
    expect(claude.mcpServers['diagram-plus']).toBeDefined();

    const toml = readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
    expect(toml).toContain('model = "gpt-5"');
    expect(toml).toContain('[mcp_servers.something-else]');
    expect(toml).toContain('[mcp_servers.diagram-plus]');
  });

  it('backs a file up before changing it', () => {
    const file = path.join(project, '.mcp.json');
    writeFileSync(file, JSON.stringify({ mcpServers: { existing: { command: 'uvx' } } }));

    const { stdout } = run(['--local', '--project', project, '--clients', 'claude-code', '--yes']);
    expect(stdout).toContain('Backed up 1 existing file');
    expect(readJson(file).mcpServers.existing).toBeDefined();
  });

  it('says nothing changed when run twice', () => {
    run(['--global', '--project', project, '--all', '--yes']);
    const { stdout } = run(['--global', '--project', project, '--all', '--yes']);
    expect(stdout).toContain('already set');
    expect(stdout).not.toContain('installed');
  });

  it('writes nothing on a dry run', () => {
    const { stdout } = run(['--local', '--project', project, '--all', '--yes', '--dry-run']);
    expect(stdout).toContain('nothing was written');
    expect(existsSync(path.join(project, '.mcp.json'))).toBe(false);
  });

  it('removes only its own entry when uninstalling', () => {
    writeFileSync(
      path.join(home, '.claude.json'),
      JSON.stringify({ numStartups: 7, mcpServers: { other: { command: 'node' } } }),
    );
    run(['--global', '--project', project, '--all', '--yes']);
    run(['--global', '--all', '--yes', '--uninstall']);

    const claude = readJson(path.join(home, '.claude.json'));
    expect(claude.mcpServers['diagram-plus']).toBeUndefined();
    expect(claude.mcpServers.other).toBeDefined();
    expect(claude.numStartups).toBe(7);
  });

  it('refuses to rewrite VS Code user settings and hands over a snippet instead', () => {
    const settings = path.join(home, '.config', 'Code', 'User', 'settings.json');
    mkdirSync(path.dirname(settings), { recursive: true });
    writeFileSync(settings, '{\n  // a comment the user wants to keep\n  "editor.fontSize": 13\n}');

    const { stdout } = run(['--global', '--project', project, '--clients', 'vscode', '--yes']);
    expect(stdout).toContain('needs a manual step');
    expect(stdout).toContain('"mcp"');
    expect(readFileSync(settings, 'utf8')).toContain('a comment the user wants to keep');
  });

  it('reports a config file it cannot parse instead of overwriting it', () => {
    writeFileSync(path.join(project, '.mcp.json'), '{ this is not json');
    const { stdout } = run(['--local', '--project', project, '--clients', 'claude-code', '--yes']);
    expect(stdout).toContain('not valid JSON');
    expect(readFileSync(path.join(project, '.mcp.json'), 'utf8')).toBe('{ this is not json');
  });
});
