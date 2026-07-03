// Direct 1:1 match measurement: OUR trace output vs the official potrace 1.16
// reference, on the IDENTICAL preprocessed bitmap. This is the literal
// "1:1 match against a reference" number — not a per-axis score. Both vector
// outputs are rasterized at high resolution and compared area-for-area (IoU +
// pixel agreement). Reference GeoJSON is produced out-of-process by the GPL
// potrace binary (its code never enters this repo); we consume only its
// geometry as data.
//   1. TRACE_AUDIT=1 vitest run _reference-export.test.ts   (writes ref/*.bmp)
//   2. potrace -b geojson --alphamax 1 --opttolerance 0.2 --turdsize 2  on each bmp
//   3. TRACE_AUDIT=1 vitest run _reference-iou.test.ts       (this file)
// Disc + star only: both are >3px-stroked, so auto-upscale never fires and our
// tracer sees the exact bitmap potrace did. (Small text intentionally diverges
// — we upscale, the reference cannot.)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import type { ColoredPath, Polyline, Vec2 } from '../../core/scene';
import { TRACE_PRESETS, traceImageToColoredPaths } from '../../core/trace';
import type { RawImageData, TraceOptions } from '../../core/trace/trace-image';
import { compareMasks } from './compare';
import { inkDisc, paper, toRawImage } from './procedural-ink';
import { rasterizeColoredPaths } from './rasterize';

const OUT_DIR = join(process.cwd(), 'trace-audit-artifacts', 'ref');
const LINE_ART = TRACE_PRESETS['Line Art'] as TraceOptions;
const SUPERSAMPLE = 4;
const STAR_TIPS = 12;

type Fixture = { readonly name: string; readonly image: RawImageData; readonly height: number };

it('measures our-vs-reference IoU on identical bitmaps', { timeout: 240000 }, async () => {
  if (process.env['TRACE_AUDIT'] !== '1') return;
  const fixtures: ReadonlyArray<Fixture> = [
    { name: 'disc', image: discImage(), height: 180 },
    { name: 'star', image: starImage(), height: 200 },
  ];
  const lines: string[] = ['=== our-output vs reference potrace 1.16 (identical bitmap) ==='];
  for (const fixture of fixtures) {
    const refPath = join(OUT_DIR, `${fixture.name}.json`);
    if (!existsSync(refPath)) {
      lines.push(`${fixture.name}: MISSING ${fixture.name}.json — run potrace step first`);
      continue;
    }
    const ours = await traceImageToColoredPaths(fixture.image, LINE_ART);
    const reference = referenceGeoJsonToColoredPaths(refPath, fixture.height);
    const w = fixture.image.width * SUPERSAMPLE;
    const h = fixture.image.height * SUPERSAMPLE;
    const ourMask = rasterizeColoredPaths(scalePaths(ours, SUPERSAMPLE), w, h);
    const refMask = rasterizeColoredPaths(scalePaths(reference, SUPERSAMPLE), w, h);
    const m = compareMasks(ourMask, refMask);
    lines.push(
      `${fixture.name}: IoU=${m.iou.toFixed(4)} agreement=${m.agreement.toFixed(5)} ` +
        `precision=${m.precision.toFixed(4)} recall=${m.recall.toFixed(4)} ` +
        `mismatchPx=${m.falsePositive + m.falseNegative} of ${w * h}`,
    );
  }
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'our-vs-reference-iou.txt'), `${lines.join('\n')}\n`);
});

// potrace GeoJSON: y-up in image units. Each Polygon has an outer ring then
// hole rings — map straight to closed polylines (even-odd fill handles holes).
function referenceGeoJsonToColoredPaths(path: string, height: number): ColoredPath[] {
  const geo = JSON.parse(readFileSync(path, 'utf8')) as {
    features: ReadonlyArray<{
      geometry: { type: string; coordinates: unknown };
    }>;
  };
  const polylines: Polyline[] = [];
  for (const feature of geo.features) {
    const polygons =
      feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates as number[][][]]
        : (feature.geometry.coordinates as number[][][][]);
    for (const polygon of polygons) {
      for (const ring of polygon) {
        const points: Vec2[] = ring.map(([x, y]) => ({ x: x ?? 0, y: height - (y ?? 0) }));
        if (points.length >= 3) polylines.push({ points, closed: true });
      }
    }
  }
  return [{ color: '#000000', polylines }];
}

function scalePaths(paths: ReadonlyArray<ColoredPath>, factor: number): ColoredPath[] {
  return paths.map((path) => ({
    color: path.color,
    polylines: path.polylines.map((pl) => ({
      closed: pl.closed,
      points: pl.points.map((p) => ({ x: p.x * factor, y: p.y * factor })),
    })),
  }));
}

function discImage(): RawImageData {
  const luma = paper(180, 180);
  inkDisc(luma, 90, 90, 60, 2);
  return toRawImage(luma);
}

function starImage(): RawImageData {
  const size = 200;
  const corners: Vec2[] = [];
  for (let k = 0; k < STAR_TIPS * 2; k += 1) {
    const angle = (k / (STAR_TIPS * 2)) * 2 * Math.PI;
    const radius = k % 2 === 0 ? 80 : 45;
    corners.push({ x: 100 + radius * Math.cos(angle), y: 100 + radius * Math.sin(angle) });
  }
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const v = pointInPolygon(x + 0.5, y + 0.5, corners) ? 0 : 255;
      const o = (y * size + x) * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

function pointInPolygon(px: number, py: number, polygon: ReadonlyArray<Vec2>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    const intersects = a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}
