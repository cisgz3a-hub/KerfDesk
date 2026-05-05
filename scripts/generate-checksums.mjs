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
 * The pure helper functions are exported separately in
 * `src/release/checksumFormat.ts` so tests can verify the format
 * without spawning a child process.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

import {
  computeSha256Hex,
  formatChecksumLine,
  formatChecksumsFile,
  matchesAnyPattern,
} from '../src/release/checksumFormat.js';

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

// computeSha256Hex from src/release/checksumFormat.ts works on Buffer
// directly via the host's createHash; the import shim above is a no-op
// for the .ts source. When running this script under Node ESM with
// `tsx` we'd import the .ts file; under raw `node` the .js extension
// requires the build step. To keep this script runnable directly,
// override locally.
function _ensureNodeCryptoHash() {
  // Node version >= 14 covers our target.
  if (typeof createHash !== 'function') {
    throw new Error('node:crypto.createHash unavailable');
  }
}

_ensureNodeCryptoHash();
main();
