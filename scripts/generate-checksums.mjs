#!/usr/bin/env node
/**
 * T2-103: SHA256 checksum generator for release artifacts. Pre-T2-103
 * the build pipeline produced installers with no checksums — users
 * could not verify the download against tampering, no support workflow
 * existed to check "is this exe really a LaserForge build?". Audit 5B
 * Critical 6 + Required Priority 9.
 *
 * Generates a `SHA256SUMS` file in the standard format used by sha256sum
 * / shasum:
 *
 *     <64-char-lowercase-hex>  <filename>
 *
 * Two spaces between hash and filename — that's the format `sha256sum
 * -c` expects. Filenames are bare basenames (no directory) so the
 * verification command is `cd release && sha256sum -c SHA256SUMS`.
 *
 * Usage:
 *   node scripts/generate-checksums.mjs <dir> [--output <path>] [--patterns <glob,...>]
 *
 * Defaults:
 *   patterns = '*.exe,*.dmg,*.zip,*.AppImage,*.deb,*.rpm'
 *   output   = '<dir>/SHA256SUMS'
 *
 * The pure format helpers are exported separately in
 * `src/integrity/checksumFormat.ts` so tests can verify the format
 * without spawning a child process. This script keeps equivalent
 * tiny JS helpers inline because CI/release jobs invoke it directly
 * with `node`, not through the TypeScript test runner. The hashing primitive
 * `computeSha256Hex` lives in `scripts/checksumHash.mjs` because
 * `src/` must not statically import `node:*` (T1-89 renderer-
 * sandbox contract).
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

import { computeSha256Hex } from './checksumHash.mjs';

const HEX64 = /^[0-9a-f]{64}$/;

function formatChecksumLine(hashHex, filename) {
  if (!HEX64.test(hashHex)) {
    throw new Error(`Invalid SHA256 hex: '${hashHex}' (expected 64 lowercase hex chars)`);
  }
  if (filename.length === 0) throw new Error('filename must not be empty');
  if (/[\r\n]/.test(filename)) {
    throw new Error('filename must not contain newline characters');
  }
  return `${hashHex}  ${filename}`;
}

function formatChecksumsFile(lines) {
  const sorted = [...lines].sort((a, b) => {
    const fa = a.split(/\s+/, 2)[1] ?? '';
    const fb = b.split(/\s+/, 2)[1] ?? '';
    return fa.localeCompare(fb);
  });
  return sorted.join('\n') + '\n';
}

function matchesAnyPattern(name, patterns) {
  for (const p of patterns) {
    const re = new RegExp(
      '^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
    );
    if (re.test(name)) return true;
  }
  return false;
}

function parseArgs(argv) {
  let dir = null;
  let output = null;
  let patterns = '*.exe,*.dmg,*.zip,*.AppImage,*.deb,*.rpm';
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--output' && argv[i + 1]) {
      output = argv[++i];
    } else if (a === '--patterns' && argv[i + 1]) {
      patterns = argv[++i];
    } else if (!a.startsWith('--')) {
      dir = a;
    }
  }
  if (!dir) {
    console.error('Usage: node scripts/generate-checksums.mjs <dir> [--output <path>] [--patterns <glob,...>]');
    process.exit(2);
  }
  return {
    dir,
    output: output ?? join(dir, 'SHA256SUMS'),
    patterns: patterns.split(',').map((s) => s.trim()).filter(Boolean),
  };
}

function main() {
  const { dir, output, patterns } = parseArgs(process.argv);
  const stat = statSync(dir);
  if (!stat.isDirectory()) {
    console.error(`Not a directory: ${dir}`);
    process.exit(2);
  }
  const entries = readdirSync(dir)
    .filter((name) => matchesAnyPattern(name, patterns))
    .sort();
  if (entries.length === 0) {
    console.error(`No matching files in ${dir} (patterns: ${patterns.join(', ')})`);
    process.exit(2);
  }
  const lines = entries.map((name) => {
    const data = readFileSync(join(dir, name));
    const hex = computeSha256Hex(data);
    return formatChecksumLine(hex, basename(name));
  });
  const text = formatChecksumsFile(lines);
  writeFileSync(output, text, 'utf-8');
  console.log(`Wrote ${entries.length} checksum(s) to ${output}`);
  for (const line of lines) console.log('  ' + line);
}

main();
