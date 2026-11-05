import { describe, expect, it } from 'vitest';
import { combineVectorObjects, offsetVectorObjects, weldVectorObjects } from '../../core/geometry';
import { planCutShapes } from '../../core/geometry/cut-shapes';
import { offsetShapes, type OffsetShapesOptions } from '../../core/geometry/offset-shapes';
import { describeWeldChange } from '../../core/geometry/vector-path-weld-change';
import { ok } from '../../core/result';
import { createLayer, IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene';
import { packSceneObjectsMessage } from '../packed-scene-objects-transfer';
import { prepareWeldSelection } from '../state/vector-path-weld-plan';
import { packResultObject, unpackResultObject } from './vector-op-result-transfer';
import {
  openLineObject,
  parityObjects,
  ring,
  throughWorkerBoundary,
} from './vector-op-worker.test-fixture';
import { vectorOpResponse, vectorOpResult } from './vector-op-worker-runtime';

const IDS = { outward: 'offset-paths', inward: 'offset-inward-paths' };

const OFFSETS: ReadonlyArray<OffsetShapesOptions> = [
  { distanceMm: 1, direction: 'outward', cornerStyle: 'round', outerShapesOnly: false },
  { distanceMm: 0.5, direction: 'inward', cornerStyle: 'bevel', outerShapesOnly: false },
  { distanceMm: 0.75, direction: 'both', cornerStyle: 'corner', outerShapesOnly: true },
  { distanceMm: 2.5, direction: 'both', cornerStyle: 'round', outerShapesOnly: false },
];

// JSON equality also pins key order, so a committed result saves the same bytes.
function expectIdentical(worker: unknown, inThread: unknown): void {
  expect(JSON.stringify(worker)).toBe(JSON.stringify(inThread));
  expect(worker).toStrictEqual(inThread);
}

describe('vector worker parity with the in-thread core calls (ADR-609)', () => {
  it('packs the dense fixture instead of cloning every point', () => {
    const packed = packSceneObjectsMessage(parityObjects());
    expect(packed.message.kind).toBe('packed-scene-objects');
    expect(packed.transfer).toHaveLength(1);
    const { response, transfer } = vectorOpResponse(1, parityObjects(), {
      kind: 'offset-shapes',
      options: OFFSETS[0]!,
      ids: IDS,
    });
    expect(response.kind).toBe('objects');
    expect(transfer.length).toBeGreaterThan(0);
  });

  it.each(OFFSETS)('Offset Shapes $direction $cornerStyle $distanceMm mm', (options) => {
    const sources = [...parityObjects(), openLineObject()];
    const inThread = offsetShapes(sources, options, IDS);
    expect(inThread.kind).toBe('ok');
    expectIdentical(
      throughWorkerBoundary(sources, { kind: 'offset-shapes', options, ids: IDS }),
      inThread,
    );
  });

  it('returns the same Offset Shapes refusal', () => {
    const options: OffsetShapesOptions = {
      distanceMm: 1,
      direction: 'inward',
      cornerStyle: 'round',
      outerShapesOnly: false,
    };
    const sources = [openLineObject()];
    const inThread = offsetShapes(sources, options, IDS);
    expect(inThread.kind).toBe('error');
    expectIdentical(
      throughWorkerBoundary(sources, { kind: 'offset-shapes', options, ids: IDS }),
      inThread,
    );
  });

  it.each(['subtract', 'intersect', 'exclude'] as const)('Combine %s', (op) => {
    const sources = parityObjects();
    const inThread = combineVectorObjects(sources, op, `${op}-paths`);
    expect(inThread.kind).toBe('ok');
    expectIdentical(
      throughWorkerBoundary(sources, { kind: 'combine', op, id: `${op}-paths` }),
      inThread,
    );
  });

  it('returns the same Combine refusal', () => {
    const sources = parityObjects().slice(0, 1);
    const inThread = combineVectorObjects(sources, 'subtract', 'subtract-paths');
    expect(inThread.kind).toBe('error');
    expectIdentical(
      throughWorkerBoundary(sources, { kind: 'combine', op: 'subtract', id: 'subtract-paths' }),
      inThread,
    );
  });

  it.each([1, -0.6])('Offset outlines %s mm', (deltaMm) => {
    const sources = parityObjects();
    const inThread = offsetVectorObjects(sources, deltaMm, 'offset-paths');
    expect(inThread.kind).toBe('ok');
    expectIdentical(
      throughWorkerBoundary(sources, { kind: 'offset-paths', deltaMm, id: 'offset-paths' }),
      inThread,
    );
  });

  it('Cut Shapes', () => {
    const sources = parityObjects();
    const usedIds = sources.map((object) => object.id);
    const inThread = planCutShapes(sources, new Set(usedIds));
    expect(inThread.kind === 'ok' && inThread.value.cuts.length).toBe(2);
    expectIdentical(throughWorkerBoundary(sources, { kind: 'cut-shapes', usedIds }), inThread);
  });

  it('returns the same Cut Shapes refusal', () => {
    const sources = parityObjects().slice(0, 1);
    const inThread = planCutShapes(sources, new Set(['dense']));
    expect(inThread.kind).toBe('error');
    expectIdentical(
      throughWorkerBoundary(sources, { kind: 'cut-shapes', usedIds: ['dense'] }),
      inThread,
    );
  });

  it('Weld', () => {
    const sources = parityObjects();
    const inThread = weldVectorObjects(sources, 'welded-paths');
    expect(inThread.kind).toBe('ok');
    expectIdentical(throughWorkerBoundary(sources, { kind: 'weld', id: 'welded-paths' }), inThread);
  });

  // The dialog's Weld (ADR-609 Amendment 2): the operands are rebound by the
  // real weld plan, and the change is described against the selection.
  it.each([
    ['the parity fixture with an absorbed speck', [...parityObjects(), speck()], ['speck']],
    ['a scalloped plate', scallopedPlate(60), []],
  ] as const)('Weld review of %s', (_label, selection, absorbedIds) => {
    const scene = {
      objects: [...selection],
      layers: [createLayer({ id: 'cut', color: '#000000' })],
      groups: [],
    };
    const prepared = prepareWeldSelection(scene, selection, 'welded-paths');
    expect(prepared.operands).not.toStrictEqual(selection);
    const welded = weldVectorObjects(prepared.operands, 'welded-paths');
    if (welded.kind !== 'ok') throw new Error('the fixture must weld');
    const change = describeWeldChange(selection, welded.value);
    expect(change).toStrictEqual({ changed: true, absorbedIds });
    const task = {
      kind: 'weld-review',
      id: 'welded-paths',
      operandCount: prepared.operands.length,
    } as const;
    expectIdentical(
      throughWorkerBoundary([...prepared.operands, ...selection], task),
      ok({ object: welded.value, change }),
    );
  });

  it('refuses a Weld review reply without its change', () => {
    const task = { kind: 'weld-review', id: 'w', operandCount: 1 } as const;
    const { response } = vectorOpResponse(1, [speck(), speck()], task);
    if (response.kind !== 'objects') throw new Error('the speck must weld');
    const { weldChange: _dropped, ...withoutChange } = response;
    expect(() => vectorOpResult(task, withoutChange)).toThrow('no weld change');
  });
});

/** A small square inside the plate's ring, which Weld absorbs. */
function speck(): ImportedSvg {
  const square = [
    { x: 39, y: 8 },
    { x: 43, y: 8 },
    { x: 43, y: 12 },
    { x: 39, y: 12 },
    { x: 39, y: 8 },
  ];
  return {
    kind: 'imported-svg',
    id: 'speck',
    source: 'speck.svg',
    bounds: { minX: 39, minY: 8, maxX: 43, maxY: 12 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [{ color: '#000000', polylines: [{ closed: true, points: square }] }],
  };
}

/**
 * A 300 x 200 mm plate with circles over its edge all round (performance audit
 * S6-P2-1): every plate vertex is buried, so the plate is a candidate that is
 * not covered, and its check walks every circle.
 */
function scallopedPlate(circles: number): ReadonlyArray<ImportedSvg> {
  const closedRing = (cx: number, cy: number, radius: number, count: number) => {
    const points = ring(cx, cy, radius, count);
    return { closed: true, points: [...points, points[0]!] };
  };
  const object = (id: string, polyline: ReturnType<typeof closedRing>): ImportedSvg => ({
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 300, maxY: 200 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [{ color: '#000000', polylines: [polyline] }],
  });
  const plate = object('plate', {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 200 },
      { x: 0, y: 200 },
      { x: 0, y: 0 },
    ],
  });
  const perimeter = 1_000;
  const edge = Array.from({ length: circles }, (_, index) => {
    let along = (index / circles) * perimeter;
    let x = 0;
    let y = 0;
    if (along < 300) x = along;
    else if ((along -= 300) < 200) [x, y] = [300, along];
    else if ((along -= 200) < 300) [x, y] = [300 - along, 200];
    else [x, y] = [0, 200 - (along - 300)];
    return object(`scallop-${index}`, closedRing(x, y, 12, 48));
  });
  return [plate, ...edge];
}

describe('vector worker result transfer', () => {
  const result = (polylines: ImportedSvg['paths'][number]['polylines']): ImportedSvg => ({
    kind: 'imported-svg',
    id: 'r',
    source: 'r',
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', operationIds: ['cut'], polylines }],
  });
  const roundTrip = (
    object: ImportedSvg,
  ): { readonly back: ImportedSvg; readonly packed: number } => {
    const transfer: ArrayBuffer[] = [];
    const message = structuredClone(packResultObject(object, transfer), { transfer });
    return { back: unpackResultObject(message), packed: transfer.length };
  };

  it.each([
    [
      'closed first',
      [
        {
          closed: true,
          points: [
            { x: 1, y: -0.5 },
            { x: 2, y: 3 },
          ],
        },
      ],
    ],
    ['points first', [{ points: [{ x: 1, y: 2 }], closed: false }]],
  ])('packs %s polylines and rebuilds their key order', (_label, polylines) => {
    const object = result(polylines);
    const { back, packed } = roundTrip(object);
    expect(packed).toBe(3);
    expectIdentical(back, object);
  });

  it('sends unusual polylines unchanged rather than dropping fields', () => {
    const extraPointField = result([{ closed: true, points: [{ x: 1, y: 2, z: 3 } as never] }]);
    const mixedOrder = result([
      { closed: true, points: [{ x: 1, y: 2 }] },
      { points: [{ x: 3, y: 4 }], closed: true },
    ]);
    for (const object of [extraPointField, mixedOrder]) {
      const { back, packed } = roundTrip(object);
      expect(packed).toBe(0);
      expectIdentical(back, object);
    }
  });
});
