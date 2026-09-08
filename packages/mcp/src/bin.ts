#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DesignStore, DiagramStore, NodeDiagramFs, findProjectRoot } from '@diagram-plus/core';
import { createMcpServer, DEFAULT_EDITOR_PORT } from './server.js';

/**
 * stdio entry point. Claude Code launches this; everything it prints on stdout
 * is protocol, so diagnostics go to stderr only.
 */
export async function runStdioServer(): Promise<void> {
  const root = process.env['DIAGRAM_PLUS_ROOT']
    ? process.env['DIAGRAM_PLUS_ROOT']
    : await findProjectRoot(process.cwd());

  // One filesystem, two stores: the graph and the screen designs beside it.
  const fs = new NodeDiagramFs({ root });
  const store = new DiagramStore({ root });
  const designs = new DesignStore(fs);
  await store.ensureDir();

  const port = process.env['DIAGRAM_PLUS_PORT'] ?? String(DEFAULT_EDITOR_PORT);
  const editorUrl = process.env['DIAGRAM_PLUS_URL'] ?? `http://localhost:${port}`;

  const server = createMcpServer({ store, designs, editorUrl });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(`diagram-plus MCP server ready — diagrams in ${store.dir}\n`);
}

const invokedDirectly =
  process.argv[1] !== undefined && /bin\.(js|ts)$/.test(process.argv[1]);

if (invokedDirectly) {
  runStdioServer().catch((err) => {
    process.stderr.write(`diagram-plus MCP server failed to start: ${String(err)}\n`);
    process.exit(1);
  });
}
