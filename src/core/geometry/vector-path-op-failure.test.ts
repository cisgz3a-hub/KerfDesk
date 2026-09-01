import { differenceD, inflatePathsD, intersectD, unionD, xorD } from 'clipper2-ts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type ClipperFunctions = {
  readonly differenceD: typeof differenceD;
  readonly inflatePathsD: typeof inflatePathsD;
  readonly intersectD: typeof intersectD;
  readonly unionD: typeof unionD;
  readonly xorD: typeof xorD;
};

vi.mock('clipper2-ts', async (importOriginal) => {
  const actualModule = (await importOriginal()) as ClipperFunctions & Record<string, unknown>;
  return {
    ...actualModule,
    unionD: vi.fn(actualModule.unionD),
    differenceD: vi.fn(actualModule.differenceD),
    intersectD: vi.fn(actualModule.intersectD),
    xorD: vi.fn(actualModule.xorD),
    inflatePathsD: vi.fn(actualModule.inflatePathsD),
  };
});

import { IDENTITY_TRANSFORM, type ImportedSvg } from '../scene';
import { combineVectorObjects, offsetVectorObjects } from './vector-path-booleans';
import { dogboneVectorObject } from './dogbone';
import { weldVectorObjects } from './vector-path-weld';

const actual = (await vi.importActual('clipper2-ts')) as ClipperFunctions;

beforeEach(() => {
  vi.mocked(unionD).mockReset().mockImplementation(actual.unionD);
  vi.mocked(differenceD).mockReset().mockImplementation(actual.differenceD);
  vi.mocked(intersectD).mockReset().mockImplementation(actual.intersectD);
  vi.mocked(xorD).mockReset().mockImplementation(actual.xorD);
  vi.mocked(inflatePathsD).mockReset().mockImplementation(actual.inflatePathsD);
});

function boom(): never {
  throw new Error('clipper boom');
}

function rect(id: string, x0: number, y0: number, x1: number, y1: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: id,
    bounds: { minX: x0, minY: y0, maxX: x1, maxY: y1 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: true,
            points: [
              { x: x0, y: y0 },
              { x: x1, y: y0 },
              { x: x1, y: y1 },
              { x: x0, y: y1 },
            ],
          },
        ],
      },
    ],
  };
}

const A = rect('a', 0, 0, 10, 10);
const B = rect('b', 5, 0, 15, 10);
const C = rect('c', 7, 0, 12, 10);

function expectOperationFailed(result: ReturnType<typeof combineVectorObjects>): void {
  expect(result.kind).toBe('error');
  if (result.kind === 'error') expect(result.error.kind).toBe('operation-failed');
}

describe('vector operations contain each individual clipper failure', () => {
  it('contains union failure during Weld normalization', () => {
    vi.mocked(unionD).mockImplementationOnce(boom);
    const result = weldVectorObjects([A, B], 'welded');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error.kind).toBe('operation-failed');
  });

  it('contains Weld final-union failure after successful batch normalization', () => {
    let calls = 0;
    vi.mocked(unionD).mockImplementation((...args) => {
      calls += 1;
      if (calls === 3) return boom();
      return actual.unionD(...args);
    });
    const result = weldVectorObjects([A, B], 'welded');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error.kind).toBe('operation-failed');
    expect(calls).toBe(3);
  });

  it('contains cross-batch object-union failure after each batch normalizes', () => {
    const multiBatch: ImportedSvg = {
      ...A,
      paths: [A.paths[0]!, { ...B.paths[0]!, color: '#0000ff' }],
    };
    let calls = 0;
    vi.mocked(unionD).mockImplementation((...args) => {
      calls += 1;
      if (calls === 3) return boom();
      return actual.unionD(...args);
    });

    expectOperationFailed(combineVectorObjects([multiBatch, C], 'intersect', 'out'));
    expect(calls).toBe(3);
  });

  it('contains difference failure after successful normalization', () => {
    vi.mocked(differenceD).mockImplementationOnce(boom);
    expectOperationFailed(combineVectorObjects([A, B], 'subtract', 'out'));
  });

  it('contains intersect failure after successful normalization', () => {
    vi.mocked(intersectD).mockImplementationOnce(boom);
    expectOperationFailed(combineVectorObjects([A, B], 'intersect', 'out'));
  });

  it('contains xor failure after successful normalization', () => {
    vi.mocked(xorD).mockImplementationOnce(boom);
    expectOperationFailed(combineVectorObjects([A, B], 'exclude', 'out'));
  });

  it('contains failure on a later n-ary reduction', () => {
    let calls = 0;
    vi.mocked(intersectD).mockImplementation((...args) => {
      calls += 1;
      if (calls === 2) return boom();
      return actual.intersectD(...args);
    });
    expectOperationFailed(combineVectorObjects([A, B, C], 'intersect', 'out'));
    expect(calls).toBe(2);
  });

  it('contains inflate failure after successful normalization', () => {
    vi.mocked(inflatePathsD).mockImplementationOnce(boom);
    const result = offsetVectorObjects([A], 2, 'out');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error.kind).toBe('operation-failed');
  });

  it('contains dogbone union failure independently', () => {
    vi.mocked(unionD).mockImplementationOnce(boom);
    const result = dogboneVectorObject(A, 6.35);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error.kind).toBe('operation-failed');
  });
});
