// Sharp-preset DESIGN CANDIDATES — renders three candidate parameterizations
// of the potrace backend so the maintainer can pick the Sharp look from
// pixels, not prose. Today Sharp reaches potrace with the same default curve
// params as Smooth (its imagetracerjs-era fields are ignored), so it is a
// mislabeled Smooth. Gated on TRACE_AUDIT=1; run explicitly.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import type { ColoredPath, Polyline } from '../../core/scene';
import { lightBurnTraceBitmapFromImage } from '../../core/trace/potrace-bitmap';
import {
  potraceCurveToPolylinePoints,
  smoothClosedPolygonToPotraceCurve,
} from '../../core/trace/potrace-curve';
import { optimizePotraceCurve } from '../../core/trace/potrace-curve-optimize';
import type { PotraceParams } from '../../core/trace/potrace-params';
import { traceBitmapToPotracePaths } from '../../core/trace/potrace-path-scanner';
import {
  adjustPotraceVertices,
  calculateBestPotracePolygon,
  calculatePotraceLongestStraightSegments,
} from '../../core/trace/potrace-polygon';
import {
  TRACE_PRESETS,
  preprocessForTrace,
  type RawImageData,
  type TraceOptions,
} from '../../core/trace/trace-image';
import { inkCellGlyph, inkDisc, inkRect, paper, paperRect, toRawImage } from './procedural-ink';
import { renderTraceOverlay } from './render-overlay';

const OUT_DIR = join(process.cwd(), 'trace-audit-artifacts');
const SCALE = 3;
const CUBIC_SAMPLES = 16;

// Candidate parameterizations. alphaMax is potrace's corner threshold:
// corners "flatter" than it become curves, sharper ones stay vertices.
const CANDIDATES: ReadonlyArray<{ name: string; params: PotraceParams }> = [
  {
    // What Sharp produces TODAY (same as Smooth): everything curve-fitted.
    name: 'a-today-smooth',
    params: { turdSize: 2, turnPolicy: 'minority', alphaMax: 1, optCurve: true, optTolerance: 0.2 },
  },
  {
    // Corner-faithful: genuine curves stay curves, drawn corners stay sharp.
    name: 'b-corner-faithful',
    params: {
      turdSize: 2,
      turnPolicy: 'minority',
      alphaMax: 0.55,
      optCurve: true,
      optTolerance: 0.15,
    },
  },
  {
    // Pure polygon: no curve fitting at all — angular blueprint/pixel look.
    name: 'c-polygon',
    params: { turdSize: 2, turnPolicy: 'minority', alphaMax: 0, optCurve: false, optTolerance: 0 },
  },
];

// The production potrace pipeline with explicit params (mirrors
// traceImageToPotraceColoredPaths, which derives params internally).
function tracePotraceWithParams(
  image: RawImageData,
  options: TraceOptions,
  params: PotraceParams,
): ColoredPath[] {
  const prepared = preprocessForTrace(image, options);
  const bitmap = lightBurnTraceBitmapFromImage(prepared, {
    cutoffLuma: 0,
    thresholdLuma: 128,
    ignoreLessThanPixels: 0,
  });
  const scanned = traceBitmapToPotracePaths(bitmap, {
    turdsize: params.turdSize,
    turnpolicy: params.turnPolicy,
  });
  const polylines: Polyline[] = [];
  for (const path of scanned) {
    const longest = calculatePotraceLongestStraightSegments(path.points);
    const polygon = calculateBestPotracePolygon(path.points, longest);
    let vertices = adjustPotraceVertices(path.points, polygon);
    if (path.sign === '-') vertices = [...vertices].reverse();
    if (vertices.length < 2) continue;
    const curve = smoothClosedPolygonToPotraceCurve(vertices, params.alphaMax);
    const optimized = params.optCurve ? optimizePotraceCurve(curve, params.optTolerance) : curve;
    const points = potraceCurveToPolylinePoints(optimized, CUBIC_SAMPLES);
    if (points.length >= 2) polylines.push({ points, closed: true });
  }
  return polylines.length === 0 ? [] : [{ color: '#000000', polylines }];
}

function fixtures(): Array<{ name: string; image: RawImageData }> {
  // 1. hard corners: the ring-with-notch from the main audit set.
  const hard = paper(180, 180);
  inkRect(hard, 30, 30, 150, 150);
  paperRect(hard, 62, 62, 118, 118);
  inkRect(hard, 84, 10, 96, 40);

  // 2. pixel art: chunky 8px-cell arrow — staircase diagonals every cell.
  const pixel = paper(180, 180);
  inkCellGlyph(pixel, 26, 26, 8, [
    '.......#........',
    '......###.......',
    '.....#####......',
    '....#######.....',
    '...#########....',
    '..###########...',
    '.....#####......',
    '.....#####......',
    '.....#####......',
    '.....#####......',
    '.....#####......',
    '.....#####......',
  ]);

  // 3. genuine curves: a hard-edged disc and a thick ring segment.
  const curves = paper(180, 180);
  inkDisc(curves, 60, 90, 42);
  inkDisc(curves, 132, 90, 32);
  paperRect(curves, 110, 68, 155, 112);

  // 4. fine detail: 3px-cell glyph, small notched squares, thin slots — the
  // scale where curve fitting rounds away drawn corners.
  const fine = paper(180, 180);
  inkCellGlyph(fine, 20, 20, 3, [
    '#.#.###.#.#',
    '#.#.#...#.#',
    '###.##..###',
    '#.#.#...#.#',
    '#.#.###.#.#',
  ]);
  inkRect(fine, 20, 60, 60, 100); // square with small notches
  paperRect(fine, 36, 60, 44, 68); // 8px notch in the top edge
  paperRect(fine, 20, 76, 28, 84); // 8px notch in the left edge
  inkRect(fine, 80, 60, 84, 100); // 4px thin bar
  inkRect(fine, 92, 60, 132, 64); // 4px thin bar horizontal
  inkRect(fine, 92, 72, 96, 76); // 4px lone dot
  inkCellGlyph(fine, 20, 116, 4, [
    '####..####',
    '#..#..#..#',
    '#..#..#..#',
    '####..####',
  ]);

  return [
    { name: 'sharp1-hard-ring', image: toRawImage(hard) },
    { name: 'sharp2-pixel-arrow', image: toRawImage(pixel) },
    { name: 'sharp3-curves', image: toRawImage(curves) },
    { name: 'sharp4-fine-detail', image: toRawImage(fine) },
  ];
}

it('renders Sharp preset candidates for the maintainer to pick', () => {
  if (process.env['TRACE_AUDIT'] !== '1') return;
  mkdirSync(OUT_DIR, { recursive: true });
  const sharpOptions = TRACE_PRESETS['Sharp'];
  if (sharpOptions === undefined) throw new Error('Sharp preset missing');
  for (const fx of fixtures())
    for (const candidate of CANDIDATES) {
      const paths = tracePotraceWithParams(fx.image, sharpOptions, candidate.params);
      const png = renderTraceOverlay(fx.image, paths, SCALE);
      writeFileSync(join(OUT_DIR, `${fx.name}__${candidate.name}.png`), png);
    }
}, 60000);
