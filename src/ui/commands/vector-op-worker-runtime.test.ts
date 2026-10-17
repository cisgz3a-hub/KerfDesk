import { describe, expect, it } from 'vitest';
import { combineVectorObjects, offsetVectorObjects, weldVectorObjects } from '../../core/geometry';
import { planCutShapes } from '../../core/geometry/cut-shapes';
import { offsetShapes, type OffsetShapesOptions } from '../../core/geometry/offset-shapes';
import { IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene';
import { packSceneObjectsMessage } from '../packed-scene-objects-transfer';
import { packResultObject, unpackResultObject } from './vector-op-result-transfer';
import {
  openLineObject,
  parityObjects,
  throughWorkerBoundary,
} from './vector-op-worker.test-fixture';
import { vectorOpResponse } from './vector-op-worker-runtime';

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

describe('vector worker parity with the in-thread core calls (ADR-606)', () => {
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
});

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
