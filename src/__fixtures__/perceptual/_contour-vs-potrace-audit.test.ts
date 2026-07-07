// Contour-vs-potrace head-to-head — the ADR-120 release-blocker experiment.
//
// Runs the SAME Line Art options through (a) the potrace-* backend and
// (b) the new contour backend built on the in-house centerline machinery,
// on every analytic perceptual fixture. Prints IoU / precision / recall,
// vertex counts, and disc roundness (radial RMS against the best-fit
// circle — the ADR-100 fidelity metric), and dumps side-by-side PNGs when
// PERCEPTUAL_ARTIFACTS is set. Gated on TRACE_AUDIT=1; run explicitly:
//   TRACE_AUDIT=1 PERCEPTUAL_ARTIFACTS=1 pnpm vitest run _contour-vs-potrace
//
// This harness DECIDES NOTHING — it produces the numbers and pixels the
// maintainer compares before choosing whether contour-trace replaces the
// potrace lane (ADR-120 blocker options a/b/c).

import { it } from 'vitest';
import type { ColoredPath } from '../../core/scene';
import type { TraceOptions } from '../../core/trace';
import { TRACE_PRESETS } from '../../core/trace';
import { traceImageToContourColoredPaths } from '../../core/trace/contour-trace';
import { traceImageToPotraceColoredPaths } from '../../core/trace/potrace-trace';
import { preprocessForTrace } from '../../core/trace/trace-image';
import { compareMasks } from './compare';
import { writePerceptualArtifact } from './png';
import { decodePngFile } from './png-decode';
import { rasterizeColoredPaths, type Mask } from './rasterize';
import { PERCEPTUAL_FIXTURES } from './shapes';
import { requiredArchHouseFixtureStatus } from './trace-artifact-runner';

const RUN_TRACE_AUDIT = process.env['TRACE_AUDIT'] === '1';
const LINE_ART = TRACE_PRESETS['Line Art'] as TraceOptions;

type BackendResult = {
  readonly iou: number;
  readonly precision: number;
  readonly recall: number;
  readonly loops: number;
  readonly vertices: number;
  readonly radialRmsPx: number | null;
};

function measure(
  paths: ColoredPath[],
  width: number,
  height: number,
  truth: Parameters<typeof compareMasks>[1],
  roundness: boolean,
): BackendResult {
  const mask = rasterizeColoredPaths(paths, width, height);
  const metrics = compareMasks(mask, truth);
  const polylines = paths.flatMap((p) => p.polylines);
  return {
    iou: metrics.iou,
    precision: metrics.precision,
    recall: metrics.recall,
    loops: polylines.length,
    vertices: polylines.reduce((n, p) => n + p.points.length, 0),
    radialRmsPx: roundness ? largestLoopRadialRms(paths) : null,
  };
}

// Radial RMS of the LARGEST loop against its own best-fit circle (centroid
// center, mean radius). Self-referential on purpose: it scores roundness —
// facets and flats — independently of sub-pixel centering.
function largestLoopRadialRms(paths: ColoredPath[]): number | null {
  const loops = paths.flatMap((p) => p.polylines);
  if (loops.length === 0) return null;
  const largest = loops.reduce((a, b) => (a.points.length >= b.points.length ? a : b));
  const pts = largest.points;
  if (pts.length < 8) return null;
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const radii = pts.map((p) => Math.hypot(p.x - cx, p.y - cy));
  const mean = radii.reduce((s, r) => s + r, 0) / radii.length;
  const variance = radii.reduce((s, r) => s + (r - mean) * (r - mean), 0) / radii.length;
  return Math.sqrt(variance);
}

function fmt(r: BackendResult): string {
  const rms = r.radialRmsPx === null ? '    –' : r.radialRmsPx.toFixed(3);
  return (
    `IoU ${r.iou.toFixed(4)}  P ${r.precision.toFixed(3)}  R ${r.recall.toFixed(3)}  ` +
    `loops ${String(r.loops).padStart(2)}  verts ${String(r.vertices).padStart(4)}  rms ${rms}`
  );
}

it.skipIf(!RUN_TRACE_AUDIT)('contour backend vs potrace backend on analytic fixtures', () => {
  const lines: string[] = ['', 'fixture           backend   metrics'];
  for (const fixture of PERCEPTUAL_FIXTURES) {
    const round = fixture.name === 'filled-disc' || fixture.name === 'ring-annulus';
    const potrace = traceImageToPotraceColoredPaths(fixture.image, LINE_ART);
    const contour = traceImageToContourColoredPaths(fixture.image, LINE_ART);
    const p = measure(potrace, fixture.width, fixture.height, fixture.truth, round);
    const c = measure(contour, fixture.width, fixture.height, fixture.truth, round);
    lines.push(`${fixture.name.padEnd(16)}  potrace   ${fmt(p)}`);
    lines.push(`${''.padEnd(16)}  contour   ${fmt(c)}`);
    writePerceptualArtifact(
      `contour-audit-${fixture.name}-potrace`,
      rasterizeColoredPaths(potrace, fixture.width, fixture.height),
      fixture.truth,
    );
    writePerceptualArtifact(
      `contour-audit-${fixture.name}-contour`,
      rasterizeColoredPaths(contour, fixture.width, fixture.height),
      fixture.truth,
    );
  }
  process.stdout.write(`${lines.join('\n')}\n`);
});

// The real acceptance image: the Arch House / Langebaan logo, including the
// small-text band that historically broke tracers. Truth = the binarized
// preprocessing output, same convention as arch-house-baseline.test.ts.
const LANGEBAAN_BAND = { x0: 300, y0: 660, x1: 735, y1: 725 };

it.skipIf(!RUN_TRACE_AUDIT)(
  'contour vs potrace on the real arch-house logo',
  { timeout: 120_000 },
  () => {
    const fixture = requiredArchHouseFixtureStatus();
    if (fixture.path === null) throw new Error(`Missing fixture: ${fixture.expectedPathGlob}`);
    const image = decodePngFile(fixture.path);
    const truth = maskFromMonochrome(preprocessForTrace(image, LINE_ART));
    const lines: string[] = ['', 'arch-house 1024×1024   backend   metrics'];
    for (const [label, trace] of [
      ['potrace', traceImageToPotraceColoredPaths],
      ['contour', traceImageToContourColoredPaths],
    ] as const) {
      const start = performance.now();
      const paths = trace(image, LINE_ART);
      const elapsedMs = performance.now() - start;
      const mask = rasterizeColoredPaths(paths, image.width, image.height);
      const whole = compareMasks(mask, truth);
      const band = compareMasks(cropMask(mask, LANGEBAAN_BAND), cropMask(truth, LANGEBAAN_BAND));
      const verts = paths.flatMap((p) => p.polylines).reduce((n, p) => n + p.points.length, 0);
      lines.push(
        `  ${label}: IoU ${whole.iou.toFixed(4)}  P ${whole.precision.toFixed(3)}  ` +
          `R ${whole.recall.toFixed(3)}  band-IoU ${band.iou.toFixed(4)}  ` +
          `verts ${verts}  ${elapsedMs.toFixed(0)}ms`,
      );
      writePerceptualArtifact(`contour-audit-arch-house-${label}`, mask, truth);
    }
    process.stdout.write(`${lines.join('\n')}\n`);
  },
);

function cropMask(mask: Mask, band: { x0: number; y0: number; x1: number; y1: number }): Mask {
  const width = band.x1 - band.x0;
  const height = band.y1 - band.y0;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data[y * width + x] = mask.data[(band.y0 + y) * mask.width + (band.x0 + x)] ?? 0;
    }
  }
  return { width, height, data };
}

function maskFromMonochrome(image: {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}): Mask {
  const data = new Uint8Array(image.width * image.height);
  for (let pixel = 0; pixel < data.length; pixel += 1) {
    data[pixel] = (image.data[pixel * 4] ?? 255) < 128 ? 1 : 0;
  }
  return { width: image.width, height: image.height, data };
}
