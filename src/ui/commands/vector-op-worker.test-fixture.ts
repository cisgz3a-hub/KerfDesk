// Shared fixtures for the vector worker parity tests (ADR-609). The largest
// object passes the packing threshold, so these cases exercise the packed
// transfer rather than the plain clone.

import type { VectorSceneObject } from '../../core/geometry';
import {
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type ImportedSvg,
  type Polyline,
  type Vec2,
} from '../../core/scene';
import {
  packSceneObjectsMessage,
  unpackSceneObjectsMessage,
} from '../packed-scene-objects-transfer';
import type { VectorOpTask } from './vector-op-worker-protocol';
import {
  vectorOpResponse,
  vectorOpResult,
  type VectorOpResultFor,
} from './vector-op-worker-runtime';

export const DENSE_RING_POINTS = 6_000;
// Scene data (the artwork's own colour), not UI chrome.
// eslint-disable-next-line no-restricted-syntax
const ARTWORK_COLOR = '#000000';

export function ring(cx: number, cy: number, radius: number, count: number, wobble = 0): Vec2[] {
  const points: Vec2[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const r = radius + wobble * Math.sin(angle * 7);
    points.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return points;
}

function closed(points: ReadonlyArray<Vec2>): Polyline {
  return { closed: true, points: [...points, points[0] ?? { x: 0, y: 0 }] };
}

function vector(id: string, polylines: Polyline[], patch: Partial<ImportedSvg> = {}): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: -60, minY: -60, maxX: 60, maxY: 60 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [{ color: ARTWORK_COLOR, polylines }],
    ...patch,
  };
}

/** A dense traced-style ring with exact curve twins, a holed plate and a transformed square. */
export function parityObjects(): ReadonlyArray<VectorSceneObject> {
  const dense = closed(ring(0, 0, 40, DENSE_RING_POINTS, 1.5));
  return [
    vector('dense', [], {
      paths: [
        { color: ARTWORK_COLOR, polylines: [dense], curves: [polylineToCurveSubpath(dense)] },
      ],
      powerScale: 80,
    }),
    vector('plate', [closed(ring(20, 10, 30, 90)), closed(ring(20, 10, 12, 60))], {
      paths: [
        {
          color: ARTWORK_COLOR,
          fillRule: 'evenodd',
          polylines: [closed(ring(20, 10, 30, 90)), closed(ring(20, 10, 12, 60))],
        },
      ],
    }),
    vector(
      'square',
      [
        closed([
          { x: -10, y: -10 },
          { x: 25, y: -10 },
          { x: 25, y: 25 },
          { x: -10, y: 25 },
        ]),
      ],
      {
        transform: { ...IDENTITY_TRANSFORM, x: 4, y: -3, rotationDeg: 17, mirrorX: true },
        operationOverride: { power: 55 },
      },
    ),
  ];
}

/** An open line, which Offset Shapes outlines outward and refuses inward. */
export function openLineObject(): VectorSceneObject {
  return vector('line', [
    {
      closed: false,
      points: [
        { x: -30, y: 0 },
        { x: 0, y: 12 },
        { x: 30, y: -4 },
      ],
    },
  ]);
}

/**
 * The full worker round trip without a Worker: pack and clone the sources with
 * transfer, run the task, pack and clone the reply with transfer, decode it.
 */
export function throughWorkerBoundary<T extends VectorOpTask>(
  sources: ReadonlyArray<VectorSceneObject>,
  task: T,
): VectorOpResultFor<T> {
  const packed = packSceneObjectsMessage(sources);
  const request = structuredClone(
    { id: 1, task, sources: packed.message },
    { transfer: packed.transfer },
  );
  const received = unpackSceneObjectsMessage(request.sources);
  const { response, transfer } = vectorOpResponse(request.id, received, request.task);
  const reply = structuredClone(response, { transfer });
  if (reply.kind === 'fatal') throw new Error(reply.message);
  return vectorOpResult(task, reply);
}
