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

import { createLayer, createProject, IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const actual = (await vi.importActual('clipper2-ts')) as ClipperFunctions;

function boom(): never {
  throw new Error('clipper boom');
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
  vi.mocked(unionD).mockReset().mockImplementation(actual.unionD);
  vi.mocked(differenceD).mockReset().mockImplementation(actual.differenceD);
  vi.mocked(intersectD).mockReset().mockImplementation(actual.intersectD);
  vi.mocked(xorD).mockReset().mockImplementation(actual.xorD);
  vi.mocked(inflatePathsD).mockReset().mockImplementation(actual.inflatePathsD);
  const objects = [rectangle('a', 0), rectangle('b', 5)];
  const project = {
    ...createProject(),
    scene: {
      objects,
      layers: [createLayer({ id: 'operation', color: '#ff0000' })],
      groups: [],
      artworkOrder: ['a', 'b'],
    },
  };
  useStore.setState({
    project,
    selectedObjectId: 'a',
    additionalSelectedIds: new Set(['b']),
    undoStack: [createProject()],
    redoStack: [createProject()],
    dirty: false,
  });
});

describe('vector engine failure state containment', () => {
  it('contains Weld union failure', () => {
    vi.mocked(unionD).mockImplementationOnce(boom);
    expectNoMutation(() => useStore.getState().weldSelection());
  });

  it('contains Subtract difference failure', () => {
    vi.mocked(differenceD).mockImplementationOnce(boom);
    expectNoMutation(() => useStore.getState().booleanSelection('subtract'));
  });

  it('contains Intersect failure', () => {
    vi.mocked(intersectD).mockImplementationOnce(boom);
    expectNoMutation(() => useStore.getState().booleanSelection('intersect'));
  });

  it('contains Exclude xor failure', () => {
    vi.mocked(xorD).mockImplementationOnce(boom);
    expectNoMutation(() => useStore.getState().booleanSelection('exclude'));
  });

  it('contains Offset inflate failure', () => {
    vi.mocked(inflatePathsD).mockImplementationOnce(boom);
    useStore.setState({ additionalSelectedIds: new Set<string>() });
    expectNoMutation(() => useStore.getState().offsetSelection(1));
  });

  it('rolls back every Dogbone object when a later engine call fails', () => {
    let calls = 0;
    vi.mocked(unionD).mockImplementation((...args) => {
      calls += 1;
      if (calls === 3) return boom();
      return actual.unionD(...args);
    });
    expectNoMutation(() => useStore.getState().dogboneSelection(6.35));
    expect(calls).toBe(3);
  });
});

function expectNoMutation(run: () => void): void {
  const before = useStore.getState();
  run();
  const after = useStore.getState();
  expect(after.project).toBe(before.project);
  expect(after.selectedObjectId).toBe(before.selectedObjectId);
  expect(after.additionalSelectedIds).toBe(before.additionalSelectedIds);
  expect(after.undoStack).toBe(before.undoStack);
  expect(after.redoStack).toBe(before.redoStack);
  expect(after.dirty).toBe(before.dirty);
  expect(useToastStore.getState().toasts).toHaveLength(1);
  expect(useToastStore.getState().toasts[0]?.variant).toBe('warning');
}

function rectangle(id: string, x: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: id,
    bounds: { minX: x, minY: 0, maxX: x + 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['operation'],
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: true,
            points: [
              { x, y: 0 },
              { x: x + 10, y: 0 },
              { x: x + 10, y: 10 },
              { x, y: 10 },
              { x, y: 0 },
            ],
          },
        ],
      },
    ],
  };
}
