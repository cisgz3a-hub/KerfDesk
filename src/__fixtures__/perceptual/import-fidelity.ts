// Perceptual fidelity harness - SVG-import geometry.
//
// The trace harness renders TRACE output and diffs it against analytic truth.
// This is the same instrument pointed at the SVG IMPORT path: run a known shape
// through the real parseSvg pipeline, flatten the materialized paths to
// world-space polylines, and hand them to the shared rasterizer/comparator.
// The sagitta helper measures circle faceting that IoU alone can hide.
//
// Test-only helper: lives under src/__fixtures__ (boundary- and coverage-exempt
// per eslint.config.mjs). Pure and deterministic.

import { applyTransform } from '../../core/scene';
import type { ColoredPath, Polyline, Transform, Vec2 } from '../../core/scene';
import { parseSvg } from '../../io/svg';

// Flatten an object's colored paths into world-space polylines by applying its
// transform to every vertex. This mirrors the geometry compileJob and draw-scene
// consume. Works for any variant carrying paths plus transform.
export function objectWorldPolylines(
  paths: ReadonlyArray<ColoredPath>,
  transform: Transform,
): Polyline[] {
  const out: Polyline[] = [];
  for (const path of paths) {
    for (const pl of path.polylines) {
      out.push({ closed: pl.closed, points: pl.points.map((p) => applyTransform(p, transform)) });
    }
  }
  return out;
}

// Run SVG text through the real import pipeline and return its world polylines.
export function importSvgPolylines(svgText: string): Polyline[] {
  const result = parseSvg({ svgText, id: 'perceptual', source: 'perceptual.svg' });
  if (result.object === null) {
    throw new Error('parseSvg produced no object for the perceptual fixture');
  }
  return objectWorldPolylines(result.object.paths, result.object.transform);
}

// A centered circle on an N x N mm canvas whose user units equal millimeters.
export function circleSvg(sizeMm: number, radiusMm: number): string {
  const c = sizeMm / 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sizeMm}mm" height="${sizeMm}mm" ` +
    `viewBox="0 0 ${sizeMm} ${sizeMm}">` +
    `<circle cx="${c}" cy="${c}" r="${radiusMm}" fill="none" stroke="#000000"/>` +
    `</svg>`
  );
}

export function vertexCount(polylines: ReadonlyArray<Polyline>): number {
  return polylines.reduce((sum, pl) => sum + pl.points.length, 0);
}

// Deepest inward facet: how far each chord midpoint falls short of the true
// circle. For an inscribed N-gon this is r * (1 - cos(pi/N)); at fixed N it
// grows with radius, which is the visual faceting this fixture protects.
export function maxChordSagittaMm(
  polylines: ReadonlyArray<Polyline>,
  center: Vec2,
  radiusMm: number,
): number {
  let maxSag = 0;
  for (const pl of polylines) {
    const pts = pl.points;
    const n = pts.length;
    for (let i = 0; i < n; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if (a === undefined || b === undefined) continue;
      const midDist = Math.hypot((a.x + b.x) / 2 - center.x, (a.y + b.y) / 2 - center.y);
      const sag = radiusMm - midDist;
      if (sag > maxSag) maxSag = sag;
    }
  }
  return maxSag;
}
