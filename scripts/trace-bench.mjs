#!/usr/bin/env node
// Alternating base-vs-new tracer benchmark (ADR-438 amendment, speed wave 2).
//
// Bundles the tracer of two source trees (two worktrees, or a detached
// worktree of a commit) into two independent ES modules and times them in ONE
// process, alternating which tree runs first on every round, so machine load
// hits both sides alike. Reports best-of-N and median for each side, their
// ratio, and whether both sides produced the byte-identical canonical trace.
//
//   node scripts/trace-bench.mjs --base D:/LaserForge/tl-speed2-base --new .
//     [--cases owl,noise192] [--presets "Line Art,Sharp"] [--runs 5] [--out <dir>]
//
// Cases are the parity-oracle corpus of THIS tree (src/__fixtures__/perceptual/
// trace-parity-oracle.ts) plus the bench-only sparse4096 page; owl and
// hummingbird are read from TRACE_PARITY_DIR.
// A tree without node_modules resolves packages from this tree's node_modules.

import { mkdirSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// esbuild is Vite's dependency, not a direct one: resolve it through Vite.
const viteRequire = createRequire(createRequire(`${HERE}/package.json`).resolve('vite'));
const { build } = await import(pathToFileURL(viteRequire.resolve('esbuild')).href);

function parseArgs(argv) {
  const args = { runs: 5, cases: 'owl', presets: 'Line Art' };
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!args.base || !args.new)
    throw new Error('usage: --base <tree> --new <tree> [--cases] [--presets] [--runs]');
  return args;
}

const posix = (path) => resolve(path).replace(/\\/g, '/');

async function bundle(entrySource, resolveDir, outfile) {
  await build({
    stdin: { contents: entrySource, resolveDir, loader: 'ts', sourcefile: 'bench-entry.ts' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile,
    nodePaths: [posix(`${HERE}/node_modules`)],
    logLevel: 'error',
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
  });
  return import(pathToFileURL(outfile).href);
}

function engineSource(tree) {
  const root = posix(tree);
  return [
    `export { traceImageToColoredPaths } from '${root}/src/core/trace/trace-to-paths';`,
    `export { TRACE_PRESETS } from '${root}/src/core/trace/trace-presets';`,
  ].join('\n');
}

// Bench-only synthetic case (not in the oracle): a 4096 px white page with a
// solid disc, a ring and a few 6 px strokes, the sparse large-page regime
// where the whole-grid raster passes dominate.
function sparsePageImage(size) {
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  const ink = (x, y) => {
    const i = (y * size + x) * 4;
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
  };
  const c = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const r = Math.hypot(x - c * 0.6, y - c * 0.6);
      const ring = Math.hypot(x - c * 1.4, y - c * 1.3);
      if (r < size * 0.08 || (ring > size * 0.1 && ring < size * 0.12)) ink(x, y);
    }
  }
  for (let k = 0; k < 5; k += 1) {
    const y0 = Math.round(size * (0.15 + 0.15 * k));
    for (let x = Math.round(size * 0.1); x < size * 0.9; x += 1) {
      const y = y0 + Math.round(Math.sin(x / (40 + 10 * k)) * 30);
      for (let t = 0; t < 6; t += 1) ink(x, y + t);
    }
  }
  return { width: size, height: size, data };
}
const EXTRA_CASES = [{ name: 'sparse4096', image: () => sparsePageImage(4096) }];

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const lab = process.env.TRACE_PARITY_DIR ?? 'C:/Users/Asus/AppData/Local/Temp/lfbake';
  const out = posix(args.out ?? `${lab}/speed2/bench`);
  mkdirSync(out, { recursive: true });
  const oracle = await bundle(
    `export * from '${posix(HERE)}/src/__fixtures__/perceptual/trace-parity-oracle';`,
    HERE,
    `${out}/oracle.mjs`,
  );
  const sides = {
    base: await bundle(engineSource(args.base), posix(args.base), `${out}/engine-base.mjs`),
    new: await bundle(engineSource(args.new), posix(args.new), `${out}/engine-new.mjs`),
  };
  const wanted = new Set(args.cases.split(','));
  const cases = [...oracle.parityCases(), ...EXTRA_CASES].filter((entry) => wanted.has(entry.name));
  const runs = Number(args.runs);
  for (const entry of cases) {
    const image = entry.image();
    for (const preset of args.presets.split(',')) {
      const times = { base: [], new: [] };
      const hashes = {};
      const traceOnce = async (side) => {
        const engine = sides[side];
        const start = performance.now();
        const paths = await engine.traceImageToColoredPaths(image, engine.TRACE_PRESETS[preset]);
        const ms = performance.now() - start;
        hashes[side] = oracle.canonicalTraceHash(paths);
        return ms;
      };
      await traceOnce('base'); // warm both engines on this input
      await traceOnce('new');
      for (let round = 0; round < runs; round += 1) {
        const order = round % 2 === 0 ? ['base', 'new'] : ['new', 'base'];
        for (const side of order) times[side].push(await traceOnce(side));
      }
      const row = {
        at: new Date().toISOString(),
        case: entry.name,
        preset,
        runs,
        base: {
          tree: posix(args.base),
          bestMs: Math.min(...times.base),
          medianMs: median(times.base),
          ms: times.base.map(Math.round),
        },
        new: {
          tree: posix(args.new),
          bestMs: Math.min(...times.new),
          medianMs: median(times.new),
          ms: times.new.map(Math.round),
        },
        ratioBest: Math.min(...times.new) / Math.min(...times.base),
        identical: hashes.base === hashes.new,
      };
      appendFileSync(`${out}/bench-results.jsonl`, `${JSON.stringify(row)}\n`);
      console.log(
        `${entry.name} | ${preset} | base best ${row.base.bestMs.toFixed(0)} ms (med ${row.base.medianMs.toFixed(0)}) | ` +
          `new best ${row.new.bestMs.toFixed(0)} ms (med ${row.new.medianMs.toFixed(0)}) | ` +
          `new/base ${row.ratioBest.toFixed(3)} | identical ${row.identical}`,
      );
    }
  }
}

await main();
