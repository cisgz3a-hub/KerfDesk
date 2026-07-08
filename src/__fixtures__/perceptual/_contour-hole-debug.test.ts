// TEMPORARY stage-by-stage debug of the contour finisher on the two loops
// that die on the arch-house logo (the HOUSE "O" counter and a wide flat
// hatch hole). Gated on TRACE_AUDIT=1; delete once the defect is fixed.

import { it } from 'vitest';
import type { Vec2 } from '../../core/scene';
import { compareMasks } from './compare';
import { rasterizeColoredPaths } from './rasterize';
import { PERCEPTUAL_FIXTURES } from './shapes';
import {
  inkMaskFromPrepared,
  refineChainForOutput,
  sharpenChainBends,
  simplifyChain,
  smoothChainCurvature,
  smoothRawChain,
  squaredDistanceField,
} from '../../core/trace/centerline';
import { midCrackChain, traceBoundaryLoops } from '../../core/trace/contour-boundary';
import type { TraceOptions } from '../../core/trace';
import { TRACE_PRESETS } from '../../core/trace';
import { preprocessForTrace } from '../../core/trace/trace-image';
import { decodePngFile } from './png-decode';
import { requiredArchHouseFixtureStatus } from './trace-artifact-runner';

const RUN_TRACE_AUDIT = process.env['TRACE_AUDIT'] === '1';
const LINE_ART = TRACE_PRESETS['Line Art'] as TraceOptions;

const TARGETS = [
  { label: 'O-counter', x0: 600, y0: 565, x1: 665, y1: 655 },
  { label: 'wide-hatch', x0: 698, y0: 455, x1: 870, y1: 498 },
];

it.skipIf(!RUN_TRACE_AUDIT)('stage timing over all arch-house loops', { timeout: 240_000 }, () => {
  const fixture = requiredArchHouseFixtureStatus();
  if (fixture.path === null) throw new Error('missing fixture');
  const image = decodePngFile(fixture.path);
  const t0 = performance.now();
  const prepared = preprocessForTrace(image, LINE_ART);
  const t1 = performance.now();
  const mask = inkMaskFromPrepared(prepared);
  const distSq = squaredDistanceField(mask);
  const t2 = performance.now();
  const loops = traceBoundaryLoops(mask);
  const t3 = performance.now();
  const stages = { mid: 0, smooth: 0, sharpen: 0, even: 0, simplify: 0, refine: 0 };
  let points = 0;
  for (const loop of loops) {
    points += loop.points.length;
    let s = performance.now();
    const mid = midCrackChain(loop.points);
    stages.mid += performance.now() - s;
    s = performance.now();
    const dense = smoothRawChain(mid, true);
    stages.smooth += performance.now() - s;
    s = performance.now();
    const sharpened = sharpenChainBends(dense, true, distSq, mask.width);
    stages.sharpen += performance.now() - s;
    s = performance.now();
    const evened = smoothChainCurvature(sharpened.points, true, sharpened.corners);
    stages.even += performance.now() - s;
    s = performance.now();
    const simplified = simplifyChain(evened, true, 0.45);
    stages.simplify += performance.now() - s;
    s = performance.now();
    refineChainForOutput(simplified, true, sharpened.corners, 0.45);
    stages.refine += performance.now() - s;
  }
  process.stdout.write(
    `\npreprocess ${(t1 - t0).toFixed(0)}ms  mask+dist ${(t2 - t1).toFixed(0)}ms  ` +
      `walk ${(t3 - t2).toFixed(0)}ms  loops ${loops.length}  staircase pts ${points}\n` +
      `stages: ${Object.entries(stages)
        .map(([k, v]) => `${k} ${v.toFixed(0)}ms`)
        .join('  ')}\n`,
  );
});

// Can the contour lane skip sharpenChainBends (the 8s stage)? Measure corner
// fidelity and arch-house metrics with sharpen ON vs OFF.
it.skipIf(!RUN_TRACE_AUDIT)('sharpen ON vs OFF: corners and timing', { timeout: 240_000 }, () => {
  const noCorners: ReadonlySet<Vec2> = new Set();
  const finishWithoutSharpen = (staircase: ReadonlyArray<Vec2>): Vec2[] => {
    const dense = smoothRawChain(midCrackChain(staircase), true);
    const evened = smoothChainCurvature(dense, true, noCorners);
    const simplified = simplifyChain(evened, true, 0.45);
    return refineChainForOutput(simplified, true, noCorners, 0.45);
  };

  // Corner fidelity probe: 88×88 axis-aligned square (from the solid-square
  // fixture geometry) — report max distance from each true corner to the
  // nearest traced point.
  const square = PERCEPTUAL_FIXTURES.find((f) => f.name === 'solid-square');
  if (square === undefined) throw new Error('missing solid-square fixture');
  const prepared = preprocessForTrace(square.image, LINE_ART);
  const mask = inkMaskFromPrepared(prepared);
  const distSq = squaredDistanceField(mask);
  const loop = traceBoundaryLoops(mask)[0];
  if (loop === undefined) throw new Error('no square loop');
  const withSharpen = (() => {
    const dense = smoothRawChain(midCrackChain(loop.points), true);
    const sharpened = sharpenChainBends(dense, true, distSq, mask.width);
    const evened = smoothChainCurvature(sharpened.points, true, sharpened.corners);
    const simplified = simplifyChain(evened, true, 0.45);
    return refineChainForOutput(simplified, true, sharpened.corners, 0.45);
  })();
  const withoutSharpen = finishWithoutSharpen(loop.points);
  const xs = loop.points.map((p) => p.x);
  const ys = loop.points.map((p) => p.y);
  const trueCorners = [
    { x: Math.min(...xs), y: Math.min(...ys) },
    { x: Math.max(...xs), y: Math.min(...ys) },
    { x: Math.max(...xs), y: Math.max(...ys) },
    { x: Math.min(...xs), y: Math.max(...ys) },
  ];
  const cornerError = (pts: ReadonlyArray<{ x: number; y: number }>): number =>
    Math.max(
      ...trueCorners.map((c) => Math.min(...pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y)))),
    );
  process.stdout.write(
    `\nsquare corner max error: with sharpen ${cornerError(withSharpen).toFixed(3)}px, ` +
      `without ${cornerError(withoutSharpen).toFixed(3)}px\n`,
  );

  // Arch-house: full pipeline with sharpen skipped — IoU + band + time.
  const fixture = requiredArchHouseFixtureStatus();
  if (fixture.path === null) throw new Error('missing fixture');
  const image = decodePngFile(fixture.path);
  const aPrepared = preprocessForTrace(image, LINE_ART);
  const aMask = inkMaskFromPrepared(aPrepared);
  const start = performance.now();
  const polylines = traceBoundaryLoops(aMask)
    .filter((l) => Math.abs(l.area) >= 0)
    .map((l) => ({ points: finishWithoutSharpen(l.points), closed: true }))
    .filter((p) => p.points.length >= 3);
  const elapsed = performance.now() - start;
  const traced = rasterizeColoredPaths(
    [{ color: '#000000', polylines }],
    image.width,
    image.height,
  );
  const truth = maskFromMono(aPrepared);
  const whole = compareMasks(traced, truth);
  process.stdout.write(
    `arch-house sharpen-OFF: IoU ${whole.iou.toFixed(4)}  P ${whole.precision.toFixed(3)}  ` +
      `R ${whole.recall.toFixed(3)}  finish ${elapsed.toFixed(0)}ms\n`,
  );
});

function maskFromMono(image: {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(image.width * image.height);
  for (let pixel = 0; pixel < data.length; pixel += 1) {
    data[pixel] = (image.data[pixel * 4] ?? 255) < 128 ? 1 : 0;
  }
  return { width: image.width, height: image.height, data };
}

it.skipIf(!RUN_TRACE_AUDIT)('stage-by-stage on the dying loops', { timeout: 240_000 }, () => {
  const fixture = requiredArchHouseFixtureStatus();
  if (fixture.path === null) throw new Error('missing fixture');
  const image = decodePngFile(fixture.path);
  const prepared = preprocessForTrace(image, LINE_ART);
  const mask = inkMaskFromPrepared(prepared);
  const distSq = squaredDistanceField(mask);
  const loops = traceBoundaryLoops(mask);
  const lines: string[] = [''];
  for (const target of TARGETS) {
    const loop = loops.find((l) => {
      const xs = l.points.map((p) => p.x);
      const ys = l.points.map((p) => p.y);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      return x0 >= target.x0 && x1 <= target.x1 && y0 >= target.y0 && y1 <= target.y1 && l.area < 0;
    });
    if (loop === undefined) {
      lines.push(`${target.label}: NO staircase loop found in target box`);
      continue;
    }
    const dense = midCrackChain(loop.points);
    const sharpened = sharpenChainBends(dense, true, distSq, mask.width);
    const evened = smoothChainCurvature(sharpened.points, true, sharpened.corners);
    const simplified = simplifyChain(evened, true, 0.45);
    const refined = refineChainForOutput(simplified, true, sharpened.corners, 0.45);
    lines.push(
      `${target.label}: staircase ${loop.points.length} → mid ${dense.length} → ` +
        `sharpen ${sharpened.points.length} (corners ${sharpened.corners.size}) → ` +
        `evened ${evened.length} → simplified ${simplified.length} → refined ${refined.length}`,
    );
  }
  process.stdout.write(`${lines.join('\n')}\n`);
});
