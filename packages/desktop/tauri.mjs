#!/usr/bin/env node
/**
 * Runs the Tauri CLI, working around one Windows toolchain problem first.
 *
 * On the `x86_64-pc-windows-gnu` toolchain the resource compiler (`windres`)
 * cannot handle a space in its output path, so a build under
 * `C:\Users\First Last\...` fails with "No such file or directory" pointing at
 * half a path. Nothing in the project can fix that, but moving Cargo's target
 * directory somewhere without spaces avoids it entirely.
 *
 * MSVC — the toolchain Tauri officially supports on Windows, and what CI
 * uses — has no such problem, so this leaves everything alone there.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_DIR = path.join(HERE, 'src-tauri');

/** The Rust host triple, or null when rustc cannot be reached. */
function hostTriple() {
  const result = spawnSync('rustc', ['-vV'], { encoding: 'utf8', shell: process.platform === 'win32' });
  if (result.status !== 0 || !result.stdout) return null;
  return result.stdout.match(/^host:\s*(\S+)$/m)?.[1] ?? null;
}

function targetDirOverride() {
  if (process.env['CARGO_TARGET_DIR']) return null;
  if (process.platform !== 'win32') return null;
  if (!MANIFEST_DIR.includes(' ')) return null;
  if (!hostTriple()?.includes('windows-gnu')) return null;

  // Somewhere writable, stable between builds, and free of spaces.
  const dir = path.join(path.parse(os.homedir()).root, 'dgp-target');
  mkdirSync(dir, { recursive: true });
  console.log(
    `note: building into ${dir}\n` +
      '      (the windows-gnu resource compiler cannot handle the space in this project\'s path)',
  );
  return dir;
}

const require = createRequire(import.meta.url);
let cli;
try {
  cli = require.resolve('@tauri-apps/cli/tauri.js');
} catch {
  console.error('The Tauri CLI is not installed. Run `npm install` at the repository root.');
  process.exit(1);
}

const override = targetDirOverride();
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: HERE,
  env: override ? { ...process.env, CARGO_TARGET_DIR: override } : process.env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
