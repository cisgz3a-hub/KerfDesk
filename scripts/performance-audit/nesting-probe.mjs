#!/usr/bin/env node
// Audit only: node scripts/performance-audit/nesting-probe.mjs --out report.json
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, release, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureCounts = [1_000, 5_000, 10_000];

/** Supported rectangle placements, with positive padding and an explicit gap. */
export function createNestingValidationFixture(count) {
  assert(fixtureCounts.includes(count), 'Use a supported audit size: 1000, 5000 or 10000');
  const columns = 100;
  return {
    bin: { minX: 0, minY: 0, maxX: columns * 2 + 2, maxY: Math.ceil(count / columns) * 2 + 2 },
    items: Array.from({ length: count }, (_, index) => ({
      id: `rectangle-${index}`,
      width: 1,
      height: 1,
      canRotate: false,
    })),
    placements: Array.from({ length: count }, (_, index) => ({
      id: `rectangle-${index}`,
      x: (index % columns) * 2 + 1,
      y: Math.floor(index / columns) * 2 + 1,
      rotated90: false,
    })),
    options: { padding: 0.5 },
  };
}

/** One untimed warmup followed by three isolated validator samples per size. */
export async function runNestingProbe({ out } = {}) {
  const require = createRequire(import.meta.url);
  const viteRequire = createRequire(require.resolve('vite'));
  const { build } = await import(pathToFileURL(viteRequire.resolve('esbuild')).href);
  const cache = join(root, 'node_modules', '.cache');
  mkdirSync(cache, { recursive: true });
  const temporary = mkdtempSync(join(cache, 'kerfdesk-nesting-audit-'));
  const moduleFile = join(temporary, 'validator.mjs');
  try {
    await build({
      stdin: {
        contents: "export { validateNest } from './src/core/nesting/outline-compact-nest';",
        resolveDir: root,
        loader: 'ts',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      outfile: moduleFile,
      logLevel: 'error',
      banner: {
        js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
      },
    });
    const { validateNest } = await import(pathToFileURL(moduleFile).href);
    const results = fixtureCounts.map((count) => {
      const { bin, items, placements, options } = createNestingValidationFixture(count);
      assert.equal(validateNest(bin, items, placements, options), true, `${count}: warmup invalid`);
      const rssBefore = process.memoryUsage().rss;
      const samplesMs = [];
      for (let sample = 0; sample < 3; sample += 1) {
        const started = performance.now();
        const valid = validateNest(bin, items, placements, options);
        samplesMs.push(performance.now() - started);
        assert.equal(valid, true, `${count}: sample ${sample + 1} invalid`);
      }
      const rssAfter = process.memoryUsage().rss;
      const sorted = [...samplesMs].sort((left, right) => left - right);
      return {
        count,
        fixtureSha256: hash(JSON.stringify({ bin, items, placements, options })),
        potentialRectanglePairs: (count * (count - 1)) / 2,
        samplesMs,
        medianMs: sorted[1],
        minMs: sorted[0],
        maxMs: sorted[2],
        rssBefore,
        rssAfter,
        allValid: true,
      };
    });
    const report = {
      format: 'kerfdesk.nesting-validation-audit',
      schemaVersion: 1,
      fixtureVersion: 1,
      createdAt: new Date().toISOString(),
      gitHead: git(['rev-parse', 'HEAD']),
      workingTreeDirty: git(['status', '--porcelain']).length > 0,
      engineSha256: hash(readFileSync(moduleFile)),
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      osRelease: release(),
      cpu: cpus()[0]?.model ?? 'unknown',
      logicalCpuCount: cpus().length,
      systemMemoryBytes: totalmem(),
      warmups: 1,
      runs: 3,
      scope:
        'Pure production rectangle validator only. Excludes planning, workers, browser input latency, sheet materialisation and hardware. RSS observations are not peak memory.',
      results,
    };
    if (out) {
      const outputPath = resolve(out);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    }
    return report;
  } finally {
    rmSync(moduleFile, { force: true });
    rmdirSync(temporary);
  }
}
function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(
    args.length === 0 || (args.length === 2 && args[0] === '--out'),
    'Usage: --out report.json',
  );
  const report = await runNestingProbe({ out: args[1] });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
