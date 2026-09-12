import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
  type Transform,
  type Vec2,
} from '../scene';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { collectLayerPolylines } from '../cnc/collect-cnc-contours';
import { materializeVectorObject } from './vector-path-tools';
import { roundStrokeOutline } from './round-stroke-outline';
import { editPathsNodesByDelta } from '../../ui/state/path-node-edit-geometry';
import { materializedStrokeFields } from './stroke-transform';

const LAYER = {
  ...createLayer({ id: 'stroke-vcarve', color: '#000000' }),
  cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' as const },
};
const STROKE: ImportedSvg = {
  kind: 'imported-svg',
  id: 'stroke',
  source: 'stroke.svg',
  transform: IDENTITY_TRANSFORM,
  bounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
  paths: [
    {
      color: '#000000',
      strokeWidthMm: 0.5,
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 4 },
            { x: 0, y: 4 },
          ],
        },
      ],
    },
  ],
};

const TRANSFORMS: ReadonlyArray<Partial<Transform>> = [
  { scaleX: 2, scaleY: 0.5 },
  { scaleX: -2, scaleY: 0.5 },
  { scaleX: 2, scaleY: -0.5 },
  { scaleX: 2, scaleY: 0.5, rotationDeg: 31, mirrorX: true, x: 13.7, y: 6.2 },
  { scaleX: 0.6, scaleY: 2.3, rotationDeg: -74, mirrorY: true, x: 3.2, y: 12.7 },
];

function contours(object: ImportedSvg): ReadonlyArray<Polyline> {
  return collectLayerPolylines([object], LAYER, DEFAULT_DEVICE_PROFILE);
}

describe('materialized stroke pens', () => {
  it.each(TRANSFORMS)('preserves transformed stroke boundaries for %j', (patch) => {
    const original = { ...STROKE, transform: { ...IDENTITY_TRANSFORM, ...patch } };
    const converted = materializeVectorObject(original);
    expect(contours(original)).toHaveLength(2);
    expect(contours(converted)).toHaveLength(2);
    expectBoundariesClose(contours(original), contours(converted));
  });

  it('composes a rotated, mirrored anisotropic pen through a second conversion and clone', () => {
    const first = materializeVectorObject({
      ...STROKE,
      transform: { ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 0.5, rotationDeg: 31 },
    });
    const edited = {
      ...structuredClone(first),
      transform: {
        ...IDENTITY_TRANSFORM,
        scaleX: 0.7,
        scaleY: 1.8,
        rotationDeg: -47,
        mirrorX: true,
        x: 10,
        y: 12,
      },
    };
    expectBoundariesClose(contours(edited), contours(materializeVectorObject(edited)));
  });

  it('does not manufacture filled material from a collapsed stroke', () => {
    const source = { ...STROKE, transform: { ...IDENTITY_TRANSFORM, scaleX: 0 } };
    const converted = materializeVectorObject(source);
    expect(contours(converted)).toEqual([]);
    expect(converted.paths[0]?.polylines[0]?.points.every((point) => point.x === 0)).toBe(true);
  });

  it('sweeps a rank-one pen after a converted centreline is edited across its collapsed axis', () => {
    const converted = materializeVectorObject({
      ...STROKE,
      transform: { ...IDENTITY_TRANSFORM, scaleX: 0 },
      paths: [
        {
          ...STROKE.paths[0]!,
          polylines: [
            {
              closed: false,
              points: [
                { x: 0, y: 0 },
                { x: 4, y: 0 },
              ],
            },
          ],
        },
      ],
    });
    const edit = editPathsNodesByDelta(
      converted.paths,
      [{ objectId: converted.id, pathIndex: 0, polylineIndex: 0, pointIndex: 1 }],
      4,
      0,
    );
    if (edit === null) throw new Error('Expected an edited endpoint');
    const path = edit.paths[0]!;
    expect(path.strokeTransform).toEqual({ a: 0, b: 0, c: 0, d: 1 });
    const expected = [
      {
        closed: true,
        points: [
          { x: 0, y: -0.25 },
          { x: 4, y: -0.25 },
          { x: 4, y: 0.25 },
          { x: 0, y: 0.25 },
        ],
      },
    ];
    expectBoundariesClose(
      roundStrokeOutline(path.polylines, 0.5, path.strokeTransform) ?? [],
      expected,
    );
    expect(contours({ ...converted, paths: edit.paths })).toHaveLength(1);
  });

  it('retains both collinear columns of a rotated rank-one pen', () => {
    const edge = Math.sqrt(5) / 4;
    const expected = [
      {
        closed: true,
        points: [
          { x: -edge, y: -edge },
          { x: 4 - edge, y: -edge },
          { x: 4 + edge, y: edge },
          { x: edge, y: edge },
        ],
      },
    ];
    const actual = roundStrokeOutline(
      [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
          ],
        },
      ],
      0.5,
      { a: 1, b: 1, c: 2, d: 2 },
    );
    expectBoundariesClose(actual ?? [], expected);
  });

  it('retains numerical rank through rotation, collapse, and a second rotated conversion', () => {
    let pen = materializedStrokeFields(STROKE.paths[0]!, {
      ...IDENTITY_TRANSFORM,
      rotationDeg: 31,
      scaleX: 2,
      scaleY: 0.5,
    });
    pen = materializedStrokeFields(
      { ...STROKE.paths[0]!, ...pen },
      { ...IDENTITY_TRANSFORM, scaleX: 0 },
    );
    pen = materializedStrokeFields(
      { ...STROKE.paths[0]!, ...pen },
      {
        ...IDENTITY_TRANSFORM,
        rotationDeg: 43,
        scaleX: 0.7,
        scaleY: 1.8,
      },
    );
    const radius =
      0.25 *
      1.8 *
      Math.hypot(2 * Math.sin((31 * Math.PI) / 180), 0.5 * Math.cos((31 * Math.PI) / 180));
    const x = -radius * Math.sin((43 * Math.PI) / 180);
    const y = radius * Math.cos((43 * Math.PI) / 180);
    const expected = [
      {
        closed: true,
        points: [
          { x: -x, y: -y },
          { x: 4 - x, y: -y },
          { x: 4 + x, y },
          { x, y },
        ],
      },
    ];
    const actual = roundStrokeOutline(
      [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
          ],
        },
      ],
      0.5,
      pen.strokeTransform,
    );
    expectBoundariesClose(actual ?? [], expected);
  });

  it('rebuilds the anisotropic outline from edited centreline nodes', () => {
    const source = {
      ...STROKE,
      transform: { ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 0.5 },
      paths: [
        {
          ...STROKE.paths[0]!,
          polylines: [
            {
              closed: false,
              points: [
                { x: 0, y: 0 },
                { x: 4, y: 0 },
              ],
            },
          ],
        },
      ],
    };
    const converted = materializeVectorObject(source);
    const edit = editPathsNodesByDelta(
      converted.paths,
      [{ objectId: converted.id, pathIndex: 0, polylineIndex: 0, pointIndex: 1 }],
      0,
      2,
    );
    if (edit === null) throw new Error('Expected an edited endpoint');
    const path = edit.paths[0]!;
    expect(path.strokeTransform).toEqual(converted.paths[0]?.strokeTransform);
    const actual = roundStrokeOutline(path.polylines, path.strokeWidthMm!, path.strokeTransform);
    // Independently authored source-space diagonal: inverse scales map the
    // edited endpoint (8,2) back to (4,4); preserve the original circular pen.
    const expected = roundStrokeOutline(
      [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 4, y: 4 },
          ],
        },
      ],
      0.5,
    )?.map((polyline) => ({
      ...polyline,
      points: polyline.points.map((point) => applyTransform(point, source.transform)),
    }));
    expect(actual).not.toBeNull();
    expectBoundariesClose(actual ?? [], expected ?? []);
  });
});

// Independent point-to-segment Hausdorff bound on both boundary point sets.
// Allow only the source/local Clipper rounding grid, not a visible shape change.
function expectBoundariesClose(
  left: ReadonlyArray<Polyline>,
  right: ReadonlyArray<Polyline>,
): void {
  expect(left.length).toBe(right.length);
  for (const [source, target] of [
    [left, right],
    [right, left],
  ]) {
    for (const polyline of source!)
      for (const point of polyline.points) {
        let nearest = Number.POSITIVE_INFINITY;
        for (const other of target!)
          for (let index = 0; index < other.points.length; index++) {
            nearest = Math.min(
              nearest,
              segmentDistance(
                point,
                other.points[index]!,
                other.points[(index + 1) % other.points.length]!,
              ),
            );
          }
        expect(nearest).toBeLessThan(0.004);
      }
  }
}

function segmentDistance(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}
