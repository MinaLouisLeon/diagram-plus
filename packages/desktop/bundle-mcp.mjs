#!/usr/bin/env node
/**
 * Bundle the MCP server into one file for the desktop app to ship.
 *
 * The installed app has no `node_modules` to resolve against, so the server it
 * registers with Claude Code has to be self-contained: core, the MCP SDK and
 * zod all folded into a single `.mjs` that any Node 20+ can run.
 */

import { build } from 'esbuild';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(HERE, '..', 'mcp', 'dist', 'bin.js');
const OUT = path.resolve(HERE, 'resources', 'mcp-server.mjs');

if (!statSync(ENTRY, { throwIfNoEntry: false })?.isFile()) {
  console.error(
    `Cannot find ${ENTRY}.\nBuild the libraries first:  npm run build:libs`,
  );
  process.exit(1);
}

mkdirSync(path.dirname(OUT), { recursive: true });

/**
 * A wrapper rather than `bin.js` itself: that file only starts the server when
 * it can see it was invoked directly, which it decides from the filename in
 * `process.argv[1]`. The bundle is called something else, so it calls the
 * exported entry point explicitly.
 */
const STARTER = `
import { runStdioServer } from ${JSON.stringify(ENTRY.replace(/\\/g, '/'))};

runStdioServer().catch((err) => {
  process.stderr.write(\`diagram-plus MCP server failed to start: \${String(err)}\\n\`);
  process.exit(1);
});
`;

await build({
  stdin: {
    contents: STARTER,
    resolveDir: HERE,
    sourcefile: 'mcp-server.mjs',
    loader: 'js',
  },
  outfile: OUT,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  minify: true,
  sourcemap: false,
  // Node built-ins stay external; everything else is inlined.
  banner: {
    js: '// diagram-plus MCP server — bundled, do not edit.\n',
  },
});

const { size } = statSync(OUT);
console.log(`  mcp-server.mjs  ${(size / 1024).toFixed(0)} kB  ->  ${path.relative(process.cwd(), OUT)}`);
