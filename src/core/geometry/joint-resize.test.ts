import { describe, expect, it } from 'vitest';
import { analyseJointResize, previewJointResize, type JointResizeRequest } from './joint-resize';
import {
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type ImportedSvg,
  type Polyline,
  type Vec2,
} from '../scene';
import { applyTransform } from '../scene/transform';

const request: JointResizeRequest = {
  currentWidthMm: 3,
  materialThicknessMm: 4,
  fitAllowanceMm: 0.2,
  detectionToleranceMm: 0.1,
};
const notch: ReadonlyArray<Vec2> = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 20 },
  { x: 13, y: 20 },
  { x: 13, y: 10 },
  { x: 10, y: 10 },
  { x: 10, y: 20 },
  { x: 0, y: 20 },
];
const rectangle = (x: number, y: number, w: number, h: number): ReadonlyArray<Vec2> => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
function artwork(polygons: ReadonlyArray<ReadonlyArray<Vec2>>, canonical = false): ImportedSvg {
  const polylines: ReadonlyArray<Polyline> = polygons.map((points) => ({
    closed: true,
    points: [...points, points[0]!],
  }));
  const path: ColoredPath = {
    color: '#000000',
    operationIds: ['cut'],
    fillRule: 'evenodd',
    strokeWidthMm: 0.2,
    polylines,
    ...(canonical
      ? {
          curves: polygons.map((points) => ({
            start: points[0]!,
            closed: true,
            segments: points.slice(1).map((to) => ({ kind: 'line' as const, to })),
          })),
        }
      : {}),
    subpathNesting: {
      parents: polygons.map((_, index) => (index === 0 ? -1 : 0)),
      geometryKey: 'old-geometry',
    },
  };
  return {
    kind: 'imported-svg',
    id: 'part',
    source: 'part.svg',
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    paths: [path],
    operationIds: ['cut'],
    operationOverride: { speed: 18 },
    laserTabAnchors: [{ layerColor: '#000000', pathIndex: 0, polylineIndex: 0, pathT: 0.25 }],
  };
}
function resized(object: ImportedSvg, options = request): ImportedSvg {
  const analysis = analyseJointResize([object], options);
  if (analysis.kind !== 'ok') throw new Error(analysis.error.message);
  const result = previewJointResize(
    [object],
    options,
    analysis.value.candidates.map((feature) => feature.id),
  );
  if (result.kind !== 'ok') throw new Error(result.error.message);
  return result.value.objects[0]! as ImportedSvg;
}
const length = (a: Vec2, b: Vec2): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
const midpoint = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

describe('bounded joint-opening resizing', () => {
  it('finds an inward slot and changes its physical width, retaining depth, centre and all other vertices', () => {
    const source = artwork([notch]);
    const analysis = analyseJointResize([source], request);
    expect(analysis.kind).toBe('ok');
    if (analysis.kind !== 'ok') return;
    expect(analysis.value.candidates.map((c) => c.kind)).toEqual(['inward-slot']);
    const result = resized(source);
    const p = result.paths[0]!.polylines[0]!.points;
    expect(length(p[4]!, p[5]!)).toBeCloseTo(4.2, 10);
    expect(length(p[3]!, p[4]!)).toBeCloseTo(10, 10);
    expect(length(p[5]!, p[6]!)).toBeCloseTo(10, 10);
    expect(midpoint(p[4]!, p[5]!)).toEqual(midpoint(notch[4]!, notch[5]!));
    for (const i of [0, 1, 2, 7]) expect(p[i]).toEqual(notch[i]);
    expect(source.paths[0]!.polylines[0]!.points[3]).toEqual({ x: 13, y: 20 });
  });
  it('resizes the matched enclosed rectangle dimension while retaining its centre and long dimension', () => {
    const source = artwork([rectangle(0, 0, 20, 20), rectangle(7, 5, 3, 10)]);
    const result = resized(source);
    const hole = result.paths[0]!.polylines[1]!.points;
    expect(length(hole[0]!, hole[1]!)).toBeCloseTo(4.2, 10);
    expect(length(hole[1]!, hole[2]!)).toBeCloseTo(10, 10);
    expect(midpoint(hole[0]!, hole[2]!)).toEqual({ x: 8.5, y: 10 });
    expect(result.paths[0]!.polylines[0]).toBe(source.paths[0]!.polylines[0]);
    for (const point of hole) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(20);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(20);
    }
  });
  it('accepts reversed winding, mirrors, rotation and nonuniform scale, measured in scene millimetres', () => {
    const source = {
      ...artwork([[...notch].reverse()], true),
      transform: {
        ...IDENTITY_TRANSFORM,
        x: 40,
        y: 55,
        rotationDeg: 37,
        scaleX: 2,
        scaleY: 1.5,
        mirrorX: true,
      },
    };
    const result = resized(source, { ...request, currentWidthMm: 6, materialThicknessMm: 7 });
    const before = source.paths[0]!.curves![0]!;
    const after = result.paths[0]!.curves![0]!;
    const scenePoints = [after.start, ...after.segments.map((s) => s.to)].map((p) =>
      applyTransform(p, result.transform),
    );
    // Reversed original indices 2 and 3 form the inner slot base.
    expect(length(scenePoints[2]!, scenePoints[3]!)).toBeCloseTo(7.2, 10);
    expect(length(scenePoints[1]!, scenePoints[2]!)).toBeCloseTo(15, 10);
    expect(result.transform).toBe(source.transform);
    expect(before).not.toBe(after);
    expect(result.paths[0]!.curves![0]!.segments.every((segment) => segment.kind === 'line')).toBe(
      true,
    );
  });
  it('keeps operations, stroke fields, anchors and identities while invalidating only derived nesting', () => {
    const source = artwork([notch], true);
    const result = resized(source);
    expect(result.id).toBe(source.id);
    expect(result.operationIds).toBe(source.operationIds);
    expect(result.operationOverride).toBe(source.operationOverride);
    expect(result.laserTabAnchors).toBe(source.laserTabAnchors);
    expect(result.paths[0]!.operationIds).toBe(source.paths[0]!.operationIds);
    expect(result.paths[0]!.strokeWidthMm).toBe(0.2);
    expect(result.paths[0]!.fillRule).toBe('evenodd');
    expect(result.paths[0]!.subpathNesting).toBeUndefined();
    const compatible = result.paths[0]!.polylines[0]!.points;
    const canonical = result.paths[0]!.curves![0]!;
    expect(compatible.slice(0, -1)).toEqual([
      canonical.start,
      ...canonical.segments.map((segment) => segment.to),
    ]);
  });
  it('allows a negative fit allowance to tighten an opening without applying kerf compensation', () => {
    const result = resized(artwork([notch]), {
      ...request,
      materialThicknessMm: 3,
      fitAllowanceMm: -0.3,
    });
    const points = result.paths[0]!.polylines[0]!.points;
    expect(length(points[4]!, points[5]!)).toBeCloseTo(2.7, 10);
    expect(result.operationOverride).toEqual({ speed: 18 });
  });
  it('excludes square ambiguity, isolated rectangles and outward tabs', () => {
    const tab = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 13, y: 20 },
      { x: 13, y: 25 },
      { x: 10, y: 25 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ];
    for (const source of [
      artwork([rectangle(0, 0, 3, 10)]),
      artwork([rectangle(0, 0, 20, 20), rectangle(5, 5, 3, 3)]),
      artwork([tab]),
    ]) {
      const analysis = analyseJointResize([source], request);
      expect(analysis.kind === 'ok' && analysis.value.candidates).toEqual([]);
    }
  });
  it('never flattens curved artwork, mutates locked artwork or repairs touching/invalid contours silently', () => {
    const source = artwork([notch], true);
    const curve = source.paths[0]!.curves![0]!;
    const curved = {
      ...source,
      paths: [
        {
          ...source.paths[0]!,
          curves: [
            {
              ...curve,
              segments: [
                {
                  kind: 'cubic' as const,
                  control1: { x: 0, y: 1 },
                  control2: { x: 1, y: 0 },
                  to: { x: 20, y: 0 },
                },
                ...curve.segments.slice(1),
              ],
            },
          ],
        },
      ],
    };
    for (const item of [
      curved,
      { ...source, locked: true },
      artwork([rectangle(0, 0, 20, 20), rectangle(0, 5, 3, 10)]),
    ]) {
      const analysis = analyseJointResize([item], request);
      expect(analysis.kind === 'ok' && analysis.value.candidates).toEqual([]);
      expect(analysis.kind === 'ok' && analysis.value.notices.length).toBeGreaterThan(0);
    }
    expect(curved.paths[0]!.curves[0]!.segments[0]!.kind).toBe('cubic');
  });
  it('refuses a resize that reaches another opening or crosses the part boundary', () => {
    const source = artwork([
      rectangle(0, 0, 20, 20),
      rectangle(5, 5, 3, 10),
      rectangle(9, 5, 3, 10),
    ]);
    const analysis = analyseJointResize([source], request);
    if (analysis.kind !== 'ok') throw new Error('unexpected invalid fixture');
    const result = previewJointResize([source], { ...request, materialThicknessMm: 6 }, [
      analysis.value.candidates[0]!.id,
    ]);
    expect(result.kind).toBe('error');
    const slot = artwork([notch]);
    const slotAnalysis = analyseJointResize([slot], request);
    if (slotAnalysis.kind !== 'ok') throw new Error('unexpected invalid fixture');
    expect(
      previewJointResize([slot], { ...request, materialThicknessMm: 50 }, [
        slotAnalysis.value.candidates[0]!.id,
      ]).kind,
    ).toBe('error');
  });
  it('requires an explicit current detection selection and finite positive resulting width', () => {
    const source = artwork([notch]);
    expect(previewJointResize([source], request, []).kind).toBe('error');
    expect(previewJointResize([source], request, ['untrusted-feature']).kind).toBe('error');
    for (const patch of [
      { currentWidthMm: 0 },
      { fitAllowanceMm: -5 },
      { materialThicknessMm: Number.NaN },
      { detectionToleranceMm: 2 },
    ])
      expect(analyseJointResize([source], { ...request, ...patch }).kind).toBe('error');
  });
});
