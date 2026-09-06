import { expect, it } from 'vitest';
import { square } from '../../__fixtures__/square';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type Layer,
  type Polyline,
  type SceneObject,
  type TextObject,
  type TracedImage,
} from '../scene';
import { compileJob } from './compile-job';
import { collectFillSegmentsForLayer } from './layer-fill';

function trace(id: string, x = 0, operationIds = ['fill']): TracedImage {
  return {
    kind: 'traced-image',
    id,
    source: 'fixture.png',
    traceMode: 'filled-contours',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x },
    operationIds,
    paths: [{ color: '#000000', polylines: [square(10)] }],
  };
}
function text(polylines: ReadonlyArray<Polyline>): TextObject {
  return {
    kind: 'text',
    id: 'text',
    fontKey: 'roboto-regular',
    content: 'fixture',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color: '#000000',
    operationIds: ['fill'],
    bounds: { minX: 0, minY: 0, maxX: 15, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines }],
  };
}
const layer = {
  ...createLayer({ id: 'fill', color: '#000000', mode: 'fill' }),
  hatchSpacingMm: 0.5,
};
function localGeometry(objects: ReadonlyArray<SceneObject>, settings: Layer) {
  return compileJob({ objects, layers: [settings] }, DEFAULT_DEVICE_PROFILE)
    .groups.flatMap((g) => (g.kind === 'fill' ? g.segments : []))
    .filter((s) => s.polyline.every((p) => p.x < 50))
    .map((s) => s.polyline.map((p) => [Number(p.x.toFixed(8)), Number(p.y.toFixed(8))]).sort())
    .sort();
}
for (const fillStyle of ['scanline', 'island', 'offset'] as const)
  it(`${fillStyle}: distant text preserves the overlapping traces' local region`, () => {
    const objects = [trace('a'), trace('b', 5)],
      remote = {
        ...text([square(10), square(10, 5, 0)]),
        transform: { ...IDENTITY_TRANSFORM, x: 100 },
      };
    const settings = { ...layer, fillStyle, hatchAngleDeg: 31, fillCrossHatch: true };
    expect(localGeometry([...objects, remote], settings)).toEqual(localGeometry(objects, settings));
  });
it('distinguishes explicit operation identities in the layer cache, including virtual bindings', () => {
  const objects = [trace('a', 0, ['a']), trace('b', 30, ['b'])];
  const a = { ...layer, id: 'a' },
    b = { ...layer, id: 'b' };
  const minX = (l: Layer) =>
    Math.min(
      ...collectFillSegmentsForLayer(objects, l, DEFAULT_DEVICE_PROFILE).segments.flatMap((s) =>
        s.polyline.map((p) => p.x),
      ),
    );
  expect(minX(a)).toBe(0);
  expect(minX(b)).toBe(30);
  expect(minX(a)).toBe(0);
  expect(minX({ ...a, bindingOperationId: 'b' })).toBe(30);
  expect(minX({ ...b, bindingOperationId: 'a' })).toBe(0);
});
it('groups only text paths selected by explicit path bindings and uses canonical curves', () => {
  const shape = square(10),
    first = shape.points[0]!;
  const object = {
    ...text([]),
    operationIds: ['a', 'b'],
    paths: [
      {
        color: '#000000',
        operationIds: ['a'],
        polylines: [square(50)],
        curves: [
          {
            start: first,
            segments: shape.points.slice(1).map((to) => ({ kind: 'line' as const, to })),
            closed: true,
          },
        ],
      },
      { color: '#000000', operationIds: ['b'], polylines: [square(10, 5, 0)] },
    ],
  };
  const a = collectFillSegmentsForLayer(
    [object],
    { ...layer, id: 'a' },
    DEFAULT_DEVICE_PROFILE,
  ).segments;
  const b = collectFillSegmentsForLayer(
    [object],
    { ...layer, id: 'b' },
    DEFAULT_DEVICE_PROFILE,
  ).segments;
  expect(Math.max(...a.flatMap((s) => s.polyline.map((p) => p.x)))).toBe(10);
  expect(Math.min(...b.flatMap((s) => s.polyline.map((p) => p.x)))).toBe(5);
  expect(Math.max(...b.flatMap((s) => s.polyline.map((p) => p.x)))).toBe(15);
});
it('refreshes fill semantics on immutable object kind and geometry changes', () => {
  const paths = [square(10), square(10, 5, 0)],
    glyph = text(paths),
    vector = { ...trace('vector'), paths: glyph.paths };
  const length = (o: SceneObject) =>
    collectFillSegmentsForLayer([o], layer, DEFAULT_DEVICE_PROFILE).segments.reduce(
      (sum, s) => sum + Math.abs((s.polyline[1]?.x ?? 0) - (s.polyline[0]?.x ?? 0)),
      0,
    );
  expect(length(glyph)).toBe(300);
  expect(length(vector)).toBe(200);
  expect(length(glyph)).toBe(300);
  expect(length({ ...glyph, paths: [{ color: '#000000', polylines: [square(10)] }] })).toBe(200);
});
