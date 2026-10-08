#!/usr/bin/env node
// Local fixed-fixture baseline: worker SVG import and pure-core Line Art trace.
// Run: node scripts/large-file-bench.mjs [--runs 3] [--out report.json]
// Measures these engines only, not file I/O, browser UI, CAM, controller or burn.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpus, totalmem, release } from 'node:os';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  rmdirSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { benchmarkImage, benchmarkSvg } from './large-file-benchmark-cases.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vite'));
const { build } = await import(pathToFileURL(viteRequire.resolve('esbuild')).href);
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const runs = Number(option('--runs') ?? 3);
if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('--runs must be 1 to 10');
const cache = join(root, 'node_modules', '.cache');
mkdirSync(cache, { recursive: true });
const temporary = mkdtempSync(join(cache, 'kerfdesk-large-bench-'));
const moduleFile = join(temporary, 'engine.mjs');
try {
  await build({
    stdin: {
      contents: [
        "export { parseSvgInWorker } from './src/io/svg/parse-svg-worker';",
        "export { traceImageToColoredPaths } from './src/core/trace/trace-to-paths';",
        "export { TRACE_PRESETS } from './src/core/trace/trace-presets';",
      ].join('\n'),
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
  const engine = await import(pathToFileURL(moduleFile).href);
  const svg = benchmarkSvg(),
    image = benchmarkImage();
  const results = [];
  results.push(
    await measure('svg50000', hash(svg), Buffer.byteLength(svg), () => {
      const parsed = engine.parseSvgInWorker({ svgText: svg, id: 'bench', source: 'fixed.svg' });
      if (parsed.object?.kind !== 'imported-svg')
        throw new Error('SVG benchmark produced no imported vector');
      return parsed.object.paths;
    }),
  );
  results.push(
    await measure('sparse4096', hash(image.data), image.data.byteLength, async () => {
      const paths = await engine.traceImageToColoredPaths(image, engine.TRACE_PRESETS['Line Art']);
      return paths;
    }),
  );
  const report = {
    format: 'kerfdesk.large-file-benchmark',
    schemaVersion: 1,
    fixtureVersion: 1,
    createdAt: new Date().toISOString(),
    gitHead: git(['rev-parse', 'HEAD']),
    workingTreeDirty: git(['status', '--porcelain']).length > 0,
    engineSha256: hash(readFileSync(moduleFile)),
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    cpu: cpus()[0]?.model ?? 'unknown',
    logicalCpuCount: cpus().length,
    systemMemoryBytes: totalmem(),
    osRelease: release(),
    warmups: 1,
    runs,
    scope:
      'Worker SVG parser and pure-core Line Art only; excludes browser rendering, source-file decoding, CAM, transport and material output. RSS is a before/after observation, not peak memory. No competitor comparison.',
    results,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (option('--out')) writeFileSync(resolve(option('--out')), json);
  process.stdout.write(json);
} finally {
  // Only the exact file and empty directory minted above are removed.
  try {
    unlinkSync(moduleFile);
  } catch {
    /* failed bundle may not have written it */
  }
  rmdirSync(temporary);
}

async function measure(name, inputSha256, inputBytes, run) {
  await run();
  const rssBefore = process.memoryUsage().rss;
  const samples = [];
  let output, outputHash;
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    output = await run();
    samples.push(performance.now() - started);
    const currentHash = hash(JSON.stringify(output));
    if (outputHash !== undefined && outputHash !== currentHash)
      throw new Error(`${name} output changed between runs`);
    outputHash = currentHash;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    name,
    inputSha256,
    inputBytes,
    samplesMs: samples,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    minMs: sorted[0],
    maxMs: sorted.at(-1),
    rssBefore,
    rssAfter: process.memoryUsage().rss,
    outputHash,
    paths: output.length,
    polylines: output.reduce((sum, path) => sum + path.polylines.length, 0),
  };
}
function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}
