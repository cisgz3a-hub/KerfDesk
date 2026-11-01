// ADR-677 (rolling v2 08-P3-3, re-rated P1 by rolling v7 L2): a turned object
// is measured by its outline, not by the turned corners of its own bounds.

import { describe, expect, it } from 'vitest';
import { createPolyline } from '../shapes';
import { createEllipse, createPolygon, createRectangle } from '../shapes/primitives';
import { arrayPlacements } from './array-layout';
import { flattenColoredPathCurves } from './curve-path';
import { combinedBBox, transformedBBox } from './hit-test';
import { buildSelectionAlignEdit } from './selection-align';
import {
  buildSelectionFlipEdit,
  selectionMetrics,
  selectionMetricsInFrame,
} from './selection-transform';
import { applyTransform } from './transform';
import { IDENTITY_TRANSFORM, type SceneObject, type Transform } from './scene-object';

const FINE_MM = 0.0005;

function turned<T extends SceneObject>(object: T, transform: Partial<Transform>): T {
  return { ...object, transform: { ...object.transform, ...transform } };
}

// Reference: flatten the outline finely, then transform every point.
function flattenedWorldBox(object: SceneObject): { width: number; height: number; minX: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  if (!('paths' in object)) throw new Error('vector object expected');
  for (const path of object.paths) {
    const flat = flattenColoredPathCurves(path, { toleranceMm: FINE_MM });
    if (flat.kind !== 'ok') throw new Error('flattening failed');
    for (const polyline of flat.polylines) {
      for (const point of polyline.points) {
        const world = applyTransform(point, object.transform);
        xs.push(world.x);
        ys.push(world.y);
      }
    }
  }
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    minX: Math.min(...xs),
  };
}

const circle = createEllipse({ id: 'c', color: '#000000', spec: { widthMm: 50, heightMm: 50 } });

describe('objectGeometryExtent through transformedBBox (ADR-677)', () => {
  it('measures a 50 mm circle at 45° as 50 wide, not 70.711', () => {
    const box = transformedBBox(turned(circle, { x: 100, y: 100, rotationDeg: 45 }));
    expect(box.maxX - box.minX).toBeCloseTo(50, 2);
    expect(box.maxY - box.minY).toBeCloseTo(50, 2);
  });

  it('matches the flattened outline of a turned ellipse, hexagon and rounded rectangle', () => {
    const shapes: SceneObject[] = [
      createEllipse({ id: 'e', color: '#000000', spec: { widthMm: 80, heightMm: 20 } }),
      createPolygon({ id: 'h', color: '#000000', spec: { sides: 6, radiusMm: 25 } }),
      createRectangle({
        id: 'r',
        color: '#000000',
        spec: { widthMm: 60, heightMm: 30, cornerRadiusMm: 15 },
      }),
      createPolygon({ id: 'b', color: '#000000', spec: { sides: 7, radiusMm: 30, bulge: 0.33 } }),
    ];
    for (const shape of shapes) {
      for (const rotationDeg of [45, 30, 333]) {
        const object = turned(shape, { x: 40, y: 70, rotationDeg, scaleX: 1.5, mirrorX: true });
        const box = transformedBBox(object);
        const reference = flattenedWorldBox(object);
        expect(box.maxX - box.minX).toBeCloseTo(reference.width, 2);
        expect(box.maxY - box.minY).toBeCloseTo(reference.height, 2);
        expect(box.minX).toBeCloseTo(reference.minX, 2);
      }
    }
  });

  it('reads the hexagon the audit burned at 48.296 mm', () => {
    const hexagon = createPolygon({ id: 'h', color: '#000000', spec: { sides: 6, radiusMm: 25 } });
    const box = transformedBBox(turned(hexagon, { rotationDeg: 45 }));
    expect(box.maxX - box.minX).toBeCloseTo(48.296, 3);
  });

  it('follows a move of a turned object without re-measuring a different box', () => {
    const at = turned(circle, { x: 10, y: 20, rotationDeg: 45 });
    const moved = turned(at, { x: 110, y: 220 });
    const first = transformedBBox(at);
    const second = transformedBBox(moved);
    expect(second.minX - first.minX).toBeCloseTo(100, 9);
    expect(second.minY - first.minY).toBeCloseTo(200, 9);
    expect(second.maxX - second.minX).toBeCloseTo(first.maxX - first.minX, 9);
  });

  it('leaves an object square to the bed on its own bounds', () => {
    const square = turned(circle, { x: 5, y: 6, rotationDeg: 90 });
    const box = transformedBBox(square);
    expect([box.minX, box.minY, box.maxX, box.maxY].map((v) => Number(v.toFixed(9)))).toEqual([
      -45, 6, 5, 56,
    ]);
  });

  it('keeps an image footprint on its rectangle', () => {
    const image: SceneObject = {
      kind: 'raster-image',
      id: 'img',
      source: 'photo.png',
      pixelWidth: 10,
      pixelHeight: 10,
      bounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
      transform: { ...IDENTITY_TRANSFORM, rotationDeg: 45 },
      color: '#808080',
      dither: 'threshold',
      linesPerMm: 10,
    };
    const box = transformedBBox(image);
    expect(box.maxX - box.minX).toBeCloseTo(50 * Math.SQRT2, 9);
  });

  it('gives the toolbar and the in-frame measure the outline too', () => {
    const object = turned(circle, { rotationDeg: 45 });
    expect(selectionMetrics([object])?.width).toBeCloseTo(50, 2);
    expect(selectionMetricsInFrame([object], 45)?.width).toBeCloseTo(50, 9);
    expect(selectionMetricsInFrame([object], 10)?.width).toBeCloseTo(50, 2);
    const pair = [object, turned(circle, { x: 100, rotationDeg: 45 })];
    const both = combinedBBox(pair);
    expect(both === null ? 0 : both.maxX - both.minX).toBeCloseTo(150, 2);
  });
});

// Rolling v7 L4 re-observed 08-P3-3 in every arrange tool: each measured a turned
// object by its turned bounds rectangle.
describe('arrange tools follow the outline of turned artwork (ADR-677)', () => {
  const reference = createRectangle({
    id: 'ref',
    color: '#000000',
    spec: { widthMm: 20, heightMm: 20, cornerRadiusMm: 0 },
  });

  it('aligns a 45° circle flush with the reference edge, not 10.36 mm off', () => {
    const disc = turned(circle, { x: 100, y: 0, rotationDeg: 45 });
    const result = buildSelectionAlignEdit([reference, disc], { kind: 'left', referenceId: 'ref' });
    if (result.kind !== 'ok') throw new Error(result.reason);
    const moved = result.transforms.find((entry) => entry.id === 'c');
    if (moved === undefined) throw new Error('circle not moved');
    expect(flattenedWorldBox({ ...disc, transform: moved.transform }).minX).toBeCloseTo(0, 2);
  });

  it('leaves the typed grid gap between turned circles, not 22.72 mm', () => {
    const disc = turned(circle, { x: 100, y: 100, rotationDeg: 45 });
    const bounds = combinedBBox([disc]);
    if (bounds === null) throw new Error('no bounds');
    const [, second] = arrayPlacements(bounds, {
      kind: 'grid',
      rows: 1,
      columns: 2,
      spacingX: 2,
      spacingY: 2,
    });
    const outline = flattenedWorldBox(disc);
    expect((second?.dx ?? 0) - outline.width).toBeCloseTo(2, 2);
  });

  it('flips a turned triangle in place instead of moving it 10 mm', () => {
    const triangle = turned(
      createPolyline({
        id: 't',
        color: '#000000',
        spec: {
          points: [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 0, y: 20 },
          ],
          closed: true,
        },
        fairingMode: 'exact',
      }),
      { x: 50, y: 50, rotationDeg: 30 },
    );
    const result = buildSelectionFlipEdit([triangle], 'horizontal');
    if (result.kind !== 'ok') throw new Error(result.reason);
    const flipped = {
      ...triangle,
      transform: result.transforms[0]?.transform ?? triangle.transform,
    };
    const before = flattenedWorldBox(triangle);
    const after = flattenedWorldBox(flipped);
    expect(after.minX).toBeCloseTo(before.minX, 6);
    expect(after.width).toBeCloseTo(before.width, 6);
  });
});
