#!/usr/bin/env node
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DiagramStore,
  createBundle,
  exportDiagram,
  findProjectRoot,
  generateSpec,
  importDiagram,
  isExportFormat,
  parseTransfer,
  parseTreeOptions,
  planImport,
  serializeBundle,
  validateDiagram,
  type Diagram,
  type ExportFormat,
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
  dgp export <diagram>    Print the diagram
                          (--format mermaid|markdown|json|tree|tree-markdown)
  dgp tree <diagram>      Print the client view: a plain tree of what the app
                          does, with the plumbing folded away
  dgp import <file>...    Bring in diagrams exported from another project
  dgp validate <diagram>  Report problems with a diagram
  dgp install-mcp         Register the MCP server with your AI tools
                          (Claude Code, Claude Desktop, Codex, Cursor, ...)

Options
  --port <n>              Port for the editor (default ${DEFAULT_PORT})
  --host <h>              Host to bind (default 127.0.0.1)
  --root <path>           Project root holding .diagrams (default: nearest project)
  --format <f>            Export format for \`export\` (default mermaid,
                          or json when --out is given)

Options for \`tree\` (and for --format tree / tree-markdown)
  --audience <a>          client (default) hides endpoints, services and
                          tables; technical keeps every block
  --markdown              Write the tree as Markdown rather than plain text
  --depth <n>             How deep to follow a flow (default 8)
  --no-conditions         Leave out decisions and conditional branches
  --data                  Include data models and datastores
  --types <t,...>         Only these block types
  --groups <g,...>        Only blocks in these groups
  --tags <t,...>          Only blocks carrying one of these tags
  --status <s,...>        Only blocks in these implementation states
  --search <text>         Only blocks whose name or summary matches
  --out <path>            Write \`export\` to a file rather than stdout
  --all                   Export every diagram in the project as one bundle
  --replace, --copy       What \`import\` does with a diagram already here.
                          Without one, it reports the clash and writes nothing.
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

/**
 * Flags into tree options. `--no-conditions` is spelled the way a shell user
 * expects, so it is translated rather than passed straight through.
 */
function treeOptionsFrom(args: Args) {
  return parseTreeOptions((key) => {
    if (key === 'conditions' && args.flags['no-conditions']) return 'false';
    const value = args.flags[key];
    if (value === undefined) return undefined;
    return typeof value === 'string' ? value : 'true';
  });
}

async function resolveRoot(flags: Args['flags']): Promise<string> {
  if (typeof flags['root'] === 'string') return path.resolve(flags['root']);
  if (process.env['DIAGRAM_PLUS_ROOT']) return path.resolve(process.env['DIAGRAM_PLUS_ROOT']);
  return findProjectRoot(process.cwd());
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

    /**
     * The client view. `export --format tree` reaches the same renderer, but
     * this is the name someone reaches for when the diagram has to go in front
     * of a person who did not draw it.
     */
    case 'tree': {
      const ref = requireArg(args, 'tree <diagram>');
      const format: ExportFormat = args.flags['markdown'] ? 'tree-markdown' : 'tree';
      const contents = exportDiagram(await store.read(ref), format, treeOptionsFrom(args));
      const out = typeof args.flags['out'] === 'string' ? args.flags['out'] : null;
      if (!out) {
        process.stdout.write(contents);
        return;
      }
      await writeFile(out, contents, 'utf8');
      process.stdout.write(`Wrote the client view of ${ref} to ${path.resolve(out)}
`);
      return;
    }

    case 'export': {
      const out = typeof args.flags['out'] === 'string' ? args.flags['out'] : null;

      // A bundle is the whole project in one file, for handing the design to
      // someone who has the app but not the repository.
      if (args.flags['all']) {
        const summaries = await store.list();
        if (!summaries.length) throw new Error(`No diagrams in ${store.dir}.`);
        const diagrams: Diagram[] = [];
        for (const summary of summaries) diagrams.push(await store.readBySlug(summary.slug));
        const contents = serializeBundle(
          createBundle(diagrams, { source: path.basename(root) }),
        );
        if (!out) {
          process.stdout.write(contents);
          return;
        }
        await writeFile(out, contents, 'utf8');
        process.stdout.write(`Exported ${diagrams.length} diagrams to ${path.resolve(out)}\n`);
        return;
      }

      const ref = requireArg(args, 'export <diagram>');
      // Writing to a file usually means sending it somewhere, and JSON is the
      // only one of the three that can be imported again.
      const fallback = out ? 'json' : 'mermaid';
      const format = typeof args.flags['format'] === 'string' ? args.flags['format'] : fallback;
      if (!isExportFormat(format)) {
        throw new Error(
          `Unknown format "${format}". Use mermaid, markdown, json, tree or tree-markdown.`,
        );
      }
      const contents = exportDiagram(await store.read(ref), format, treeOptionsFrom(args));
      if (!out) {
        process.stdout.write(contents);
        return;
      }
      await writeFile(out, contents, 'utf8');
      process.stdout.write(`Exported ${ref} to ${path.resolve(out)}\n`);
      return;
    }

    /**
     * The other half of `export`: a diagram that has been round the houses and
     * needs to come back in. It never overwrites without being told to, because
     * the thing it would overwrite is a file in the user's repository.
     */
    case 'import': {
      if (!args.positional.length) {
        throw new Error('Missing argument. Usage: dgp import <file>...');
      }
      if (args.flags['replace'] && args.flags['copy']) {
        throw new Error('Pass --replace or --copy, not both.');
      }
      const mode = args.flags['replace'] ? 'replace' : args.flags['copy'] ? 'copy' : null;

      const incoming: { diagram: Diagram; file: string }[] = [];
      for (const file of args.positional) {
        const resolved = path.resolve(file);
        const text = await readFile(resolved, 'utf8');
        for (const diagram of parseTransfer(text, path.basename(resolved)).diagrams) {
          incoming.push({ diagram, file: path.basename(resolved) });
        }
      }

      const plan = planImport(incoming, await store.list());
      const clashes = plan.filter((candidate) => candidate.existing);
      if (clashes.length && !mode) {
        process.stderr.write(
          `${clashes.length} of these ${clashes.length === 1 ? 'is' : 'are'} already in ${store.dir}:\n\n`,
        );
        for (const clash of clashes) {
          process.stderr.write(
            `  ${clash.incoming.name.padEnd(28)} matches ${clash.existing?.slug} ` +
              `(${clash.existing?.blockCount} blocks, edited ${clash.existing?.updatedAt})\n`,
          );
        }
        process.stderr.write(
          `\nNothing was written. Re-run with --replace to overwrite them, ` +
            `or --copy to add them alongside.\n`,
        );
        process.exitCode = 1;
        return;
      }

      for (const candidate of plan) {
        const action = candidate.existing ? mode! : 'copy';
        const outcome = await importDiagram(store, {
          incoming: candidate.incoming,
          action,
          target: candidate.existing?.slug,
        });
        process.stdout.write(
          `${action === 'replace' ? 'Replaced' : 'Added'} ${outcome.diagram.name} -> ${outcome.file}\n`,
        );
      }
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
      // The installer is plain JavaScript so it runs before anything is built.
      const script = path.resolve(fileURLToPath(import.meta.url), '..', '..', 'install-mcp.mjs');
      const result = spawnSync(process.execPath, [script, ...process.argv.slice(3)], {
        stdio: 'inherit',
      });
      process.exitCode = result.status ?? 1;
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
