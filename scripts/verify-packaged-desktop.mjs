// Checks an unpacked desktop package against its electron-builder config
// (ADR-483): the fuses in the executable are the ones the config asks for,
// and app.asar carries the main process, the renderer bundle and only the
// node_modules the config allows. electron-builder applies both settings
// silently, so a config it misreads would otherwise ship unnoticed.
//
// usage: node scripts/verify-packaged-desktop.mjs <executable> <app.asar> <builder config>

import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFile } from '@electron/asar';
import { packagedRuntimeProblems } from './desktop-runtime-graph.mjs';

// @electron/fuses marks the start of the fuse wire with this sentinel, then a
// version byte and a length byte. Schema 1 order, from Electron's fuses.json5.
const FUSE_SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX';
const FUSE_ORDER = [
  'runAsNode',
  'enableCookieEncryption',
  'enableNodeOptionsEnvironmentVariable',
  'enableNodeCliInspectArguments',
  'enableEmbeddedAsarIntegrityValidation',
  'onlyLoadAppFromAsar',
  'loadBrowserProcessSpecificV8Snapshot',
  'grantFileProtocolExtraPrivileges',
];
const REQUIRED_ENTRIES = [
  'package.json',
  'dist-electron/main.js',
  'dist/web/index.html',
  'public/desktop-release-manifest.mjs',
  'public/desktop-update-notes.mjs',
  'public/desktop-release-keys.json',
  'public/desktop-sandbox-contract.mjs',
];

export function readFuseWire(executable) {
  const binary = readFileSync(executable);
  const at = binary.indexOf(FUSE_SENTINEL);
  if (at === -1) throw new Error(`no fuse wire in ${executable}`);
  const position = at + FUSE_SENTINEL.length;
  const version = binary[position];
  const length = binary[position + 1];
  if (version !== 1) throw new Error(`unexpected fuse wire version ${version}`);
  return binary.subarray(position + 2, position + 2 + length).toString('latin1');
}

/** The `electronFuses:` block of a builder config as { name: boolean }. */
export function configuredFuses(configText) {
  const block = /^electronFuses:\n((?: {2}.*\n)+)/m.exec(configText);
  if (block?.[1] === undefined) throw new Error('config has no electronFuses block');
  const fuses = {};
  for (const [, name, value] of block[1].matchAll(/^ {2}([A-Za-z0-9]+): (true|false)$/gm)) {
    fuses[name] = value === 'true';
  }
  return fuses;
}

/** The node_modules names a builder config ships, from its allowlist line. */
export function allowedNodeModules(configText) {
  const match = /^ {2}- '\*\*\/node_modules\/\{([^}]+)\}\/\*\*\/\*'$/m.exec(configText);
  if (match?.[1] === undefined) throw new Error('config has no node_modules allowlist');
  return match[1].split(',').sort();
}

export function readAsarHeader(asarPath) {
  const descriptor = openSync(asarPath, 'r');
  try {
    const prefix = Buffer.alloc(16);
    readSync(descriptor, prefix, 0, 16, 0);
    const jsonLength = prefix.readUInt32LE(12);
    const json = Buffer.alloc(jsonLength);
    readSync(descriptor, json, 0, jsonLength, 16);
    return JSON.parse(json.toString('utf8'));
  } finally {
    closeSync(descriptor);
  }
}

export function asarEntries(header) {
  const entries = [];
  const walk = (node, prefix) => {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const path = prefix === '' ? name : `${prefix}/${name}`;
      if (child.files === undefined) entries.push(path);
      else walk(child, path);
    }
  };
  walk(header, '');
  return entries;
}

/** Resolve only files inside this archive, never ancestor checkout node_modules. */
export function asarFileReader(asarPath, entries = asarEntries(readAsarHeader(asarPath))) {
  const paths = new Set(entries);
  return (path) =>
    paths.has(path) ? extractFile(asarPath, join(...path.split('/'))).toString('utf8') : null;
}

export function requirePackagedRuntimeAsar(asarPath) {
  const problems = packagedRuntimeProblems({ readFile: asarFileReader(asarPath) });
  if (problems.length > 0)
    throw new Error(`Desktop runtime closure verification failed:\n${problems.join('\n')}`);
}

export function packagedDesktopProblems({ wire, fuses, allowed, entries, readFile }) {
  const problems = [];
  FUSE_ORDER.forEach((name, index) => {
    if (!(name in fuses)) {
      problems.push(`config does not set fuse ${name}`);
      return;
    }
    const expected = fuses[name] ? '1' : '0';
    if (wire[index] !== expected) {
      problems.push(`fuse ${name} is ${wire[index] ?? 'missing'}, config wants ${expected}`);
    }
  });
  const shipped = [
    ...new Set(
      entries.flatMap((entry) => {
        const match = /^node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(entry);
        return match?.[1] === undefined ? [] : [match[1]];
      }),
    ),
  ].sort();
  if (shipped.join(',') !== allowed.join(',')) {
    problems.push(
      `app.asar node_modules ${shipped.join(', ')} differ from the allowlist ${allowed.join(', ')}`,
    );
  }
  for (const required of REQUIRED_ENTRIES) {
    if (!entries.includes(required)) problems.push(`app.asar is missing ${required}`);
  }
  const maps = entries.filter(
    (entry) => entry.startsWith('dist-electron/') && entry.endsWith('.map'),
  );
  if (maps.length > 0) problems.push(`app.asar ships main-process source maps: ${maps.join(', ')}`);
  if (readFile !== undefined) problems.push(...packagedRuntimeProblems({ readFile }));
  return problems;
}

function runCli() {
  const [executable, asarPath, configPath] = process.argv.slice(2);
  if (executable === undefined || asarPath === undefined || configPath === undefined) {
    throw new Error('usage: verify-packaged-desktop.mjs <executable> <app.asar> <builder config>');
  }
  const configText = readFileSync(configPath, 'utf8');
  const entries = asarEntries(readAsarHeader(asarPath));
  const problems = packagedDesktopProblems({
    wire: readFuseWire(executable),
    fuses: configuredFuses(configText),
    allowed: allowedNodeModules(configText),
    entries,
    readFile: asarFileReader(asarPath, entries),
  });
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    process.exit(1);
  }
  process.stdout.write('PACKAGED_DESKTOP_OK=true\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runCli();
