// Boot-bundle byte guard (performance audit S9-P3-2).
//
// The first visit downloads the entry chunk, everything it statically imports,
// and the workspace `main` chunk the entry imports at boot with its own static
// imports (the same closure as the S9 audit's static9.mjs). Nothing guarded
// that download: it grew 9 % over 1.0.23, a few percent a release, and
// worker-only libraries rode in it. This counts bytes, not time, so it is
// stable on any runner:
//
// - the closure's gzip size (level 6, summed per file) may grow at most 2 %
//   over scripts/boot-bundle-baseline.json; when it shrinks 2 % or more, the
//   baseline must be lowered in the same change (a ratchet, as
//   check-index-exports does);
// - no worker-only package may sit in a boot chunk.
//
// Run after `pnpm build:web`: node scripts/check-boot-bundle.mjs [distDir] [--update]
// The chunk graph comes from <distDir>-chunks.json (scripts/bundle-chunk-report.ts).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const BASELINE_PATH = 'scripts/boot-bundle-baseline.json';
export const GROWTH_TOLERANCE = 0.02;
export const WORKER_ONLY_PACKAGES = ['linkedom', 'saxes', 'tiff', 'fflate'];

/** The chunks the first visit downloads, from the chunk report and index.html's entries. */
export function bootClosure(chunks, entryFiles) {
  const boot = new Set();
  const pending = [...entryFiles];
  for (const entry of entryFiles) {
    for (const lazy of chunks[entry]?.dynamicImports ?? []) {
      if (chunks[lazy]?.name === 'main') pending.push(lazy);
    }
  }
  while (pending.length > 0) {
    const file = pending.pop();
    if (boot.has(file) || chunks[file] === undefined) continue;
    boot.add(file);
    pending.push(...chunks[file].imports);
  }
  return [...boot].sort();
}

/** Problems with this build against the baseline; empty when it passes. */
export function bootBundleProblems({ gzipBytes, packagesByFile }, baseline) {
  const problems = [];
  const ceiling = Math.floor(baseline.gzipBytes * (1 + GROWTH_TOLERANCE));
  if (gzipBytes > ceiling) {
    problems.push(
      `boot JavaScript is ${kib(gzipBytes)} gzip, over ${kib(ceiling)} ` +
        `(baseline ${kib(baseline.gzipBytes)} + ${GROWTH_TOLERANCE * 100} %). ` +
        'Load the new code lazily, or raise the baseline with a reason in the same change.',
    );
  }
  const floor = Math.ceil(baseline.gzipBytes * (1 - GROWTH_TOLERANCE));
  if (gzipBytes < floor) {
    problems.push(
      `boot JavaScript shrank to ${kib(gzipBytes)} gzip, under ${kib(floor)}: ` +
        `lower ${BASELINE_PATH} to ${gzipBytes} in this change (node scripts/check-boot-bundle.mjs --update).`,
    );
  }
  for (const [file, packages] of Object.entries(packagesByFile)) {
    for (const name of packages.filter((p) => WORKER_ONLY_PACKAGES.includes(p))) {
      problems.push(`${file} is downloaded at boot but holds ${name}, which only workers use.`);
    }
  }
  return problems;
}

function kib(bytes) {
  return `${(bytes / 1024).toFixed(0)} KiB`;
}

function entryFilesOf(html) {
  return [...html.matchAll(/<script[^>]*type="module"[^>]*src="\.?\/?([^"]+\.js)"/g)].map(
    (match) => match[1],
  );
}

function measure(distDir) {
  const reportPath = `${distDir}-chunks.json`;
  if (!existsSync(reportPath))
    throw new Error(`${reportPath} is missing: run pnpm build:web first.`);
  const { chunks } = JSON.parse(readFileSync(reportPath, 'utf8'));
  const entries = entryFilesOf(readFileSync(join(distDir, 'index.html'), 'utf8'));
  if (entries.length === 0) throw new Error('index.html names no module entry.');
  const files = bootClosure(chunks, entries);
  const rows = files.map((file) => ({
    file,
    gzip: gzipSync(readFileSync(join(distDir, file)), { level: 6 }).length,
  }));
  return {
    rows,
    gzipBytes: rows.reduce((sum, row) => sum + row.gzip, 0),
    packagesByFile: Object.fromEntries(files.map((file) => [file, chunks[file].packages])),
  };
}

function main() {
  const args = process.argv.slice(2);
  const distDir = args.find((arg) => !arg.startsWith('--')) ?? 'dist/web';
  const measured = measure(distDir);
  for (const row of measured.rows.sort((a, b) => b.gzip - a.gzip)) {
    console.log(`${kib(row.gzip).padStart(10)}  ${row.file}`);
  }
  console.log(
    `${kib(measured.gzipBytes).padStart(10)}  boot total (${measured.rows.length} files)`,
  );
  if (args.includes('--update')) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify({ gzipBytes: measured.gzipBytes }, null, 2)}\n`);
    console.log(`Wrote ${BASELINE_PATH}.`);
    return;
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const problems = bootBundleProblems(measured, baseline);
  for (const problem of problems) console.error(`check:boot-bundle: ${problem}`);
  if (problems.length > 0) process.exit(1);
  console.log(
    `check:boot-bundle: within ${GROWTH_TOLERANCE * 100} % of ${kib(baseline.gzipBytes)}.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
