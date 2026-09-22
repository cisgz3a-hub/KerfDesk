import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type ImportedSvg,
  type PathSegment,
  type Polyline,
  type Project,
  type RasterImage,
} from '../core/scene';
import {
  isPackedProjectMessage,
  PACK_MIN_POINTS,
  packProjectMessage,
  unpackProjectMessage,
} from './packed-project-transfer';

const coordinate = fc
  .double({ noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6 })
  .map((value) => (Object.is(value, -0) ? 0 : value));
const vec2 = fc.record({ x: coordinate, y: coordinate });
const polyline: fc.Arbitrary<Polyline> = fc.record({
  points: fc.array(vec2, { maxLength: 6 }),
  closed: fc.boolean(),
});
const segment: fc.Arbitrary<PathSegment> = fc.oneof(
  fc.record({ kind: fc.constant('line' as const), to: vec2 }),
  fc.record({ kind: fc.constant('cubic' as const), control1: vec2, control2: vec2, to: vec2 }),
  fc.record({
    kind: fc.constant('elliptical-arc' as const),
    radiusX: coordinate,
    radiusY: coordinate,
    rotationDeg: coordinate,
    largeArc: fc.boolean(),
    sweep: fc.boolean(),
    to: vec2,
  }),
);
const curve: fc.Arbitrary<CurveSubpath> = fc.record({
  start: vec2,
  segments: fc.array(segment, { maxLength: 4 }),
  closed: fc.boolean(),
});
const coloredPath: fc.Arbitrary<ColoredPath> = fc
  .record({
    color: fc.constantFrom('#000000', '#ff0000'),
    polylines: fc.array(polyline, { maxLength: 4 }),
    curves: fc.option(fc.array(curve, { maxLength: 3 }), { nil: undefined }),
    fillRule: fc.option(fc.constantFrom('nonzero' as const, 'evenodd' as const), {
      nil: undefined,
    }),
    strokeWidthMm: fc.option(fc.double({ noNaN: true, min: 0, max: 10 }), { nil: undefined }),
    operationIds: fc.option(fc.array(fc.constantFrom('op-a', 'op-b'), { maxLength: 2 }), {
      nil: undefined,
    }),
  })
  .map(({ curves, fillRule, strokeWidthMm, operationIds, ...rest }) => ({
    ...rest,
    ...(curves === undefined ? {} : { curves }),
    ...(fillRule === undefined ? {} : { fillRule }),
    ...(strokeWidthMm === undefined ? {} : { strokeWidthMm }),
    ...(operationIds === undefined ? {} : { operationIds }),
  }));

function densePolyline(points: number): Polyline {
  return {
    closed: true,
    points: Array.from({ length: points }, (_, index) => ({ x: index * 0.5, y: (index * 7) % 13 })),
  };
}

function vectorObject(id: string, paths: ReadonlyArray<ColoredPath>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: { ...IDENTITY_TRANSFORM, x: 12.5, rotationDeg: 30 },
    paths,
  };
}

function raster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'raster',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,AAAA',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}

function projectWith(objects: Project['scene']['objects']): Project {
  return {
    ...createProject(),
    scene: { layers: [createLayer({ id: '#000000', color: '#000000' })], objects },
  };
}

// A big polyline on its own pushes every generated project over the packing
// threshold, so the random paths always take the packed route too.
const dense = vectorObject('dense', [
  { color: '#000000', polylines: [densePolyline(PACK_MIN_POINTS + 1)] },
]);

describe('packed project transfer', () => {
  it('round-trips random vector geometry exactly through a transferred message', () => {
    fc.assert(
      fc.property(fc.array(coloredPath, { maxLength: 3 }), (paths) => {
        const project = projectWith([dense, vectorObject('random', paths), raster()]);
        const before = JSON.stringify(project);
        const packed = packProjectMessage(project);
        expect(isPackedProjectMessage(packed.message)).toBe(true);
        expect(packed.transfer.length).toBeGreaterThan(0);
        // What postMessage would do: clone the message and detach the buffers.
        const received = structuredClone(packed.message, { transfer: packed.transfer });
        expect(unpackProjectMessage(received)).toEqual(project);
        expect(JSON.stringify(project)).toBe(before);
      }),
      { numRuns: 60 },
    );
  });

  it('sends small projects untouched, without a transfer list', () => {
    const project = projectWith([vectorObject('small', [{ color: '#000000', polylines: [] }])]);
    const packed = packProjectMessage(project);
    expect(packed.message).toBe(project);
    expect(packed.transfer).toEqual([]);
    expect(unpackProjectMessage(project)).toBe(project);
  });

  it('sends canonical straight-line curves as a flag and rebuilds them exactly', () => {
    const polylines = [densePolyline(PACK_MIN_POINTS + 1), { closed: false, points: [] }];
    const trace = vectorObject('trace', [
      { color: '#000000', polylines, curves: polylines.map(polylineToCurveSubpath) },
    ]);
    const packed = packProjectMessage(projectWith([trace]));
    if (!isPackedProjectMessage(packed.message)) throw new Error('expected packed geometry');
    // The empty polyline cannot be derived (its rebuilt start would be 0,0),
    // so the whole path takes the generic encoding; the dense path alone is
    // flagged as derived.
    expect(packed.message.geometry[0]?.paths[0]?.curves).toEqual(
      expect.objectContaining({ derived: false }),
    );
    const derivedOnly = vectorObject('trace', [
      {
        color: '#000000',
        polylines: [polylines[0]!],
        curves: [polylineToCurveSubpath(polylines[0]!)],
      },
    ]);
    const flagged = packProjectMessage(projectWith([derivedOnly]));
    if (!isPackedProjectMessage(flagged.message)) throw new Error('expected packed geometry');
    expect(flagged.message.geometry[0]?.paths[0]?.curves).toEqual({ derived: true });
    expect(unpackProjectMessage(flagged.message)).toEqual(projectWith([derivedOnly]));
    expect(unpackProjectMessage(packed.message)).toEqual(projectWith([trace]));
  });

  it('keeps an absent curves field absent and leaves non-vector objects as the same objects', () => {
    const photo = raster();
    const project = projectWith([dense, photo]);
    const packed = packProjectMessage(project);
    if (!isPackedProjectMessage(packed.message)) throw new Error('expected packed geometry');
    expect(packed.message.project.scene.objects[1]).toBe(photo);
    expect(packed.message.project.scene.objects[0]).toEqual({ ...dense, paths: [] });
    const unpacked = unpackProjectMessage(packed.message);
    const path = (unpacked.scene.objects[0] as ImportedSvg).paths[0];
    expect(path !== undefined && 'curves' in path).toBe(false);
    expect(unpacked.scene.objects[1]).toBe(photo);
  });

  it('transfers fresh copies each time, so a detached message does not break the next send', () => {
    const project = projectWith([dense]);
    const first = packProjectMessage(project);
    structuredClone(first.message, { transfer: first.transfer });
    expect(first.transfer.every((buffer) => buffer.byteLength === 0)).toBe(true);
    const second = packProjectMessage(project);
    expect(
      unpackProjectMessage(structuredClone(second.message, { transfer: second.transfer })),
    ).toEqual(project);
  });
});
