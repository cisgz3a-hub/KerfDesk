#!/usr/bin/env node
/**
 * T1-258: release SBOM generator for installer workflows.
 *
 * Keep this as a tiny Node wrapper instead of shell redirection so
 * Windows/macOS workflows write the same UTF-8 CycloneDX JSON file.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const output = resolve(process.argv[2] ?? 'release/sbom.cdx.json');
const args = [
  'sbom',
  '--omit=dev',
  '--sbom-format=cyclonedx',
  '--sbom-type=application',
];
const npmCli = resolveNpmCli();

const result = npmCli
  ? spawnSync(process.execPath, [npmCli, ...args], spawnOptions())
  : spawnSync('npm', args, spawnOptions());

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, result.stdout, 'utf8');
console.log(`Wrote SBOM to ${output}`);

function spawnOptions() {
  return {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  };
}

function resolveNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}
