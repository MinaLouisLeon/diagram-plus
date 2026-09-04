#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  DiagramStore,
  exportDiagram,
  findProjectRoot,
  generateSpec,
  validateDiagram,
} from '@diagram-plus/core';
import { startServer, DEFAULT_PORT } from './server.js';

/**
 * `dgp` — the one command a user runs. With no arguments it starts the editor,
 * which is what you want 95% of the time.
 */

const HELP = `diagram-plus — design an app as a block diagram, then build it with Claude.

Usage
  dgp [open]              Start the editor and print its URL (default)
  dgp mcp                 Run the MCP server on stdio (Claude Code launches this)
  dgp init                Create the .diagrams directory in this project
  dgp list                List the diagrams in this project
  dgp spec <diagram>      Print the implementation spec as Markdown
  dgp export <diagram>    Print the diagram (--format mermaid|markdown|json)
  dgp validate <diagram>  Report problems with a diagram
  dgp install-mcp         Register the MCP server in this project's .mcp.json

Options
  --port <n>              Port for the editor (default ${DEFAULT_PORT})
  --host <h>              Host to bind (default 127.0.0.1)
  --root <path>           Project root holding .diagrams (default: nearest project)
  --format <f>            Export format for \`export\`
  --help, -h              Show this help
`;

interface Args {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg === '-h') {
      flags['help'] = true;
    } else {
      positional.push(arg);
    }
  }

  const command = positional.shift() ?? 'open';
  return { command, positional, flags };
}

async function resolveRoot(flags: Args['flags']): Promise<string> {
  if (typeof flags['root'] === 'string') return path.resolve(flags['root']);
  if (process.env['DIAGRAM_PLUS_ROOT']) return path.resolve(process.env['DIAGRAM_PLUS_ROOT']);
  return findProjectRoot(process.cwd());
}

function mcpBinPath(): string {
  const require = createRequire(import.meta.url);
  try {
    const entry = require.resolve('@diagram-plus/mcp');
    return path.join(path.dirname(entry), 'bin.js');
  } catch {
    // Running from a source checkout.
    return path.resolve(process.cwd(), 'packages/mcp/dist/bin.js');
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags['help']) {
    process.stdout.write(HELP);
    return;
  }

  const root = await resolveRoot(args.flags);
  const store = new DiagramStore({ root });

  switch (args.command) {
    case 'open': {
      const port = args.flags['port'] ? Number(args.flags['port']) : DEFAULT_PORT;
      const host = typeof args.flags['host'] === 'string' ? args.flags['host'] : undefined;
      const running = await startServer({ root, port, host });
      const count = (await store.list()).length;
      process.stdout.write(
        `\n  diagram-plus is running\n\n` +
          `  Editor     ${running.url}\n` +
          `  Diagrams   ${running.store.dir} (${count} found)\n\n` +
          `  Ask Claude Code to design one, then reload this page to see it.\n` +
          `  Press Ctrl+C to stop.\n\n`,
      );
      const stop = () => {
        void running.close().then(() => process.exit(0));
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      return;
    }

    case 'mcp': {
      process.env['DIAGRAM_PLUS_ROOT'] = root;
      const { runStdioServer } = await import('@diagram-plus/mcp/bin');
      await runStdioServer();
      return;
    }

    case 'init': {
      await store.ensureDir();
      process.stdout.write(`Created ${store.dir}\n\nNext:\n  dgp install-mcp\n  dgp\n`);
      return;
    }

    case 'list': {
      const diagrams = await store.list();
      if (!diagrams.length) {
        process.stdout.write(`No diagrams in ${store.dir}.\n`);
        return;
      }
      for (const d of diagrams) {
        process.stdout.write(
          `${d.slug.padEnd(28)} ${d.status.padEnd(12)} ${String(d.blockCount).padStart(3)} blocks  ${d.name}\n`,
        );
      }
      return;
    }

    case 'spec': {
      const ref = requireArg(args, 'spec <diagram>');
      process.stdout.write(generateSpec(await store.read(ref)));
      return;
    }

    case 'export': {
      const ref = requireArg(args, 'export <diagram>');
      const format = (typeof args.flags['format'] === 'string' ? args.flags['format'] : 'mermaid') as
        | 'mermaid'
        | 'markdown'
        | 'json';
      if (!['mermaid', 'markdown', 'json'].includes(format)) {
        throw new Error(`Unknown format "${format}". Use mermaid, markdown or json.`);
      }
      process.stdout.write(exportDiagram(await store.read(ref), format));
      return;
    }

    case 'validate': {
      const ref = requireArg(args, 'validate <diagram>');
      const diagram = await store.read(ref);
      const result = validateDiagram(diagram);
      if (!result.issues.length) {
        process.stdout.write(`${diagram.name}: no issues.\n`);
        return;
      }
      for (const item of result.issues) {
        process.stdout.write(`${item.severity.padEnd(8)} ${item.message}\n`);
      }
      if (!result.valid) process.exitCode = 1;
      return;
    }

    case 'install-mcp': {
      const file = path.join(root, '.mcp.json');
      let config: Record<string, unknown> = {};
      try {
        config = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
      } catch {
        /* first time */
      }
      const servers = (config['mcpServers'] as Record<string, unknown>) ?? {};
      servers['diagram-plus'] = {
        command: 'node',
        args: [mcpBinPath()],
        env: { DIAGRAM_PLUS_ROOT: root },
      };
      config['mcpServers'] = servers;
      await fs.writeFile(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
      process.stdout.write(
        `Registered the diagram-plus MCP server in ${file}.\n` +
          `Restart Claude Code, then ask it to design a diagram for your project.\n`,
      );
      return;
    }

    default:
      process.stderr.write(`Unknown command "${args.command}".\n\n${HELP}`);
      process.exitCode = 1;
  }
}

function requireArg(args: Args, usage: string): string {
  const value = args.positional[0];
  if (!value) throw new Error(`Missing argument. Usage: dgp ${usage}`);
  return value;
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
