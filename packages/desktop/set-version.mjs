#!/usr/bin/env node
/**
 * Stamp a version into the desktop app's manifests.
 *
 * Used by CI just before a build, and never committed: on the release branch
 * the version is decided by the git tag, not by a file, so nothing has to be
 * written back to a protected branch. See .github/workflows/release.yml.
 *
 *   node set-version.mjs 1.4.0
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const version = process.argv[2]?.trim().replace(/^v/, '');
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Usage: node set-version.mjs <x.y.z>\nGot: ${process.argv[2] ?? '(nothing)'}`);
  process.exit(1);
}

/** Cargo rejects a build metadata suffix that tauri.conf.json is happy with. */
const cargoVersion = version;

const conf = path.join(HERE, 'src-tauri', 'tauri.conf.json');
const json = JSON.parse(readFileSync(conf, 'utf8'));
json.version = version;
writeFileSync(conf, `${JSON.stringify(json, null, 2)}\n`);

const cargo = path.join(HERE, 'src-tauri', 'Cargo.toml');
const toml = readFileSync(cargo, 'utf8');
// Only the first `version =` — the one in [package], above any dependency.
const patched = toml.replace(/^version = ".*"$/m, `version = "${cargoVersion}"`);
if (patched === toml) {
  console.error(`Could not find a version line in ${cargo}.`);
  process.exit(1);
}
writeFileSync(cargo, patched);

const pkg = path.join(HERE, 'package.json');
const pkgJson = JSON.parse(readFileSync(pkg, 'utf8'));
pkgJson.version = version;
writeFileSync(pkg, `${JSON.stringify(pkgJson, null, 2)}\n`);

console.log(`Stamped version ${version} into tauri.conf.json, Cargo.toml and package.json.`);
