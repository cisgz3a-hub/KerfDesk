import { deepStrictEqual } from 'node:assert/strict';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type ImportedSvg,
  type Project,
} from '../core/scene';
import {
  isPackedProjectMessage,
  packProjectMessage,
  unpackProjectMessage,
  type PackedProjectMessage,
} from './packed-project-transfer';

function curvedPath(index: number): ColoredPath {
  const x = index + 0.125;
  const y = index === 0 ? Number.MIN_VALUE : -index / 7;
  return {
    color: '#123456',
    fillRule: 'evenodd',
    strokeWidthMm: 0.17,
    operationIds: ['operation-a', 'operation-b'],
    polylines: [
      {
        closed: true,
        points: [
          { x, y },
          { x: x + 3, y: -0 },
          { x, y },
        ],
      },
    ],
    curves: [
      {
        start: { x, y },
        closed: true,
        segments: [
          {
            kind: 'cubic',
            control1: { x: x + 1, y },
            control2: { x: x + 3, y },
            to: { x: x + 3, y },
          },
          {
            kind: 'elliptical-arc',
            radiusX: 0.75,
            radiusY: 1.125,
            rotationDeg: 17.3,
            largeArc: index % 2 === 0,
            sweep: index % 3 === 0,
            to: { x, y },
          },
        ],
      },
    ],
  };
}

function denseProject(): Project {
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'curved',
    source: 'curved.svg',
    bounds: { minX: 0, minY: -1000, maxX: 2000, maxY: 1000 },
    transform: IDENTITY_TRANSFORM,
    paths: Array.from({ length: 1100 }, (_, index) => curvedPath(index)),
  };
  const empty: ColoredPath = { color: '#654321', polylines: [], curves: [] };
  return {
    ...createProject(),
    scene: {
      layers: [],
      objects: [object, { ...object, id: 'second', paths: [empty, curvedPath(10000)] }],
    },
  };
}

function arraysOf(message: PackedProjectMessage): (Float64Array | Uint32Array | Uint8Array)[] {
  return message.geometry.flatMap((entry) =>
    entry.paths.flatMap((path) => {
      const { polylines, curves } = path;
      const arrays: (Float64Array | Uint32Array | Uint8Array)[] = [
        polylines.xy,
        polylines.starts,
        polylines.closed,
      ];
      if (curves !== undefined && !curves.derived) {
        arrays.push(
          curves.start,
          curves.closed,
          curves.segmentStarts,
          curves.kinds,
          curves.flags,
          curves.values,
        );
      }
      return arrays;
    }),
  );
}

describe('coalesced packed geometry transfer', () => {
  it('round-trips thousands of paths through a native worker with one aligned transferable', async () => {
    const project = denseProject();
    const packed = packProjectMessage(project);
    if (!isPackedProjectMessage(packed.message)) throw new Error('expected packed geometry');
    expect(packed.transfer).toHaveLength(1);
    const arrays = arraysOf(packed.message);
    expect(new Set(arrays.map((array) => array.buffer)).size).toBe(1);
    for (const array of arrays) expect(array.byteOffset % array.BYTES_PER_ELEMENT).toBe(0);
    const worker = new Worker(
      `
      const { parentPort } = require('node:worker_threads');
      parentPort.on('message', message => {
        const buffer = message.geometry[0].paths[0].polylines.xy.buffer;
        parentPort.postMessage(message, [buffer]);
      });
    `,
      { eval: true },
    );
    try {
      const received = once(worker, 'message');
      worker.postMessage(packed.message, packed.transfer);
      expect(packed.transfer[0]?.byteLength).toBe(0);
      const [message] = await received;
      deepStrictEqual(unpackProjectMessage(message as PackedProjectMessage), project);
      expect(
        new Set(arraysOf(message as PackedProjectMessage).map((array) => array.buffer)).size,
      ).toBe(1);
    } finally {
      await worker.terminate();
    }
  });

  it('isolates outbound edits and detachment from immutable source geometry and the cached next send', () => {
    const project = denseProject();
    const sourceBefore = structuredClone(project);
    const first = packProjectMessage(project);
    if (!isPackedProjectMessage(first.message)) throw new Error('expected packed geometry');
    const path = first.message.geometry[0]?.paths[0];
    if (path === undefined || path.curves === undefined || path.curves.derived)
      throw new Error('expected curves');
    path.polylines.xy[0] = 987654.321;
    path.curves.values[0] = -765432.1;
    const second = packProjectMessage(project);
    expect(second.transfer[0]).not.toBe(first.transfer[0]);
    const sent = structuredClone(second.message, { transfer: second.transfer });
    expect(second.transfer[0]?.byteLength).toBe(0);
    deepStrictEqual(unpackProjectMessage(sent), sourceBefore);
    deepStrictEqual(project, sourceBefore);
    const third = packProjectMessage(project);
    const sentAgain = structuredClone(third.message, { transfer: third.transfer });
    deepStrictEqual(unpackProjectMessage(sentAgain), sourceBefore);
    // The earlier unsent buffer still belongs to its caller.
    expect(path.polylines.xy[0]).toBe(987654.321);
  });
});
