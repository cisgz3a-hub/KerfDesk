import { beforeEach, describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import {
  createLayer,
  createProject,
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type Project,
  type ReliefObject,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

// Natural import bounds: 100 wide, 50 tall (mesh aspect 0.5).
function relief(): ReliefObject {
  return {
    kind: 'relief',
    id: 'R1',
    source: 'model.stl',
    targetWidthMm: 100,
    reliefDepthMm: 5,
    reliefSource: {
      kind: 'legacy-mesh',
      meshPositions: [0, 0, 0, 10, 0, 0, 0, 5, 5],
      emptyCells: 'floor',
    },
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    transform: { ...IDENTITY_TRANSFORM, x: 20, y: 30 },
  };
}

function installReliefProject(): void {
  const project: Project = {
    ...createProject(),
    scene: {
      objects: [relief()],
      layers: [createLayer({ id: DEFAULT_RELIEF_LAYER_COLOR, color: DEFAULT_RELIEF_LAYER_COLOR })],
    },
  };
  useStore.setState({ project, dirty: false, undoStack: [], redoStack: [] });
}

beforeEach(() => {
  resetStore();
  installReliefProject();
});

function storedRelief(): ReliefObject {
  const found = useStore.getState().project.scene.objects.find((o) => o.id === 'R1');
  if (found?.kind !== 'relief') throw new Error('relief missing');
  return found;
}

describe('setReliefParams', () => {
  it('updates depth and background, marks dirty, and pushes one undo entry', () => {
    useStore.getState().setReliefParams('R1', { reliefDepthMm: 8, emptyCells: 'top' });

    const updated = storedRelief();
    expect(updated.reliefDepthMm).toBe(8);
    expect(
      updated.reliefSource.kind === 'legacy-mesh' ? updated.reliefSource.emptyCells : null,
    ).toBe('top');
    expect(useStore.getState().dirty).toBe(true);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('rescales the natural bounds by the mesh aspect when width changes', () => {
    useStore.getState().setReliefParams('R1', { targetWidthMm: 200 });

    const updated = storedRelief();
    expect(updated.targetWidthMm).toBe(200);
    expect(updated.bounds).toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 100 });
    // Placement is untouched — only the natural size changes.
    expect(updated.transform).toMatchObject({ x: 20, y: 30 });
  });

  it('accepts uncapped positive dimensions and ignores non-positive or non-finite values', () => {
    useStore.getState().setReliefParams('R1', { targetWidthMm: 99_999, reliefDepthMm: 500 });

    expect(storedRelief()).toMatchObject({ targetWidthMm: 99_999, reliefDepthMm: 500 });
    const acceptedProject = useStore.getState().project;
    useStore.setState({ dirty: false, undoStack: [] });

    useStore
      .getState()
      .setReliefParams('R1', { targetWidthMm: Number.POSITIVE_INFINITY, reliefDepthMm: 0 });

    expect(storedRelief()).toMatchObject({ targetWidthMm: 99_999, reliefDepthMm: 500 });
    expect(useStore.getState().project).toBe(acceptedProject);
    expect(useStore.getState().dirty).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('keeps canonical field dimensions, mapping, and revision synchronized', () => {
    const field = testReliefHeightfield({
      width: 2,
      height: 1,
      physicalWidthMm: 100,
      physicalHeightMm: 50,
      maxDepthMm: 5,
      samplesU8: [0, 255],
    });
    const current = useStore.getState().project;
    useStore.setState({
      project: {
        ...current,
        scene: {
          ...current.scene,
          objects: [{ ...relief(), source: 'depth.png', reliefSource: field }],
        },
      },
    });

    useStore.getState().setReliefParams('R1', {
      targetWidthMm: 200,
      reliefDepthMm: 8,
      polarity: 'light-is-deep',
    });

    const updated = storedRelief();
    expect(updated.bounds).toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 100 });
    expect(updated.reliefSource.kind).toBe('heightfield-v1');
    if (updated.reliefSource.kind !== 'heightfield-v1') return;
    expect(updated.reliefSource).toMatchObject({
      physicalWidthMm: 200,
      physicalHeightMm: 100,
      revision: 1,
      mapping: { maxDepthMm: 8, polarity: 'light-is-deep' },
    });
  });

  it('does not advance the field revision when canonical values are unchanged', () => {
    const field = testReliefHeightfield({
      width: 2,
      height: 1,
      physicalWidthMm: 100,
      physicalHeightMm: 50,
      maxDepthMm: 5,
      samplesU8: [0, 255],
    });
    const current = useStore.getState().project;
    useStore.setState({
      project: {
        ...current,
        scene: {
          ...current.scene,
          objects: [{ ...relief(), source: 'depth.png', reliefSource: field }],
        },
      },
    });

    useStore.getState().setReliefParams('R1', {
      targetWidthMm: 100,
      reliefDepthMm: 5,
      polarity: 'light-is-high',
    });

    const updated = storedRelief();
    expect(updated.reliefSource.kind).toBe('heightfield-v1');
    if (updated.reliefSource.kind !== 'heightfield-v1') return;
    expect(updated.reliefSource.revision).toBe(field.revision);
  });

  it('updates gamma exactly without rebuilding imported source data', () => {
    const field = testReliefHeightfieldFixture();
    installHeightfieldRelief(field);
    const before = storedRelief();

    useStore.getState().setReliefParams('R1', { gamma: 123456.75 });

    const updated = storedRelief();
    expect(updated.reliefSource.kind).toBe('heightfield-v1');
    if (updated.reliefSource.kind !== 'heightfield-v1') return;
    expect(updated.reliefSource.mapping.curve.gamma).toBe(123456.75);
    expect(updated.reliefSource.revision).toBe(field.revision + 1);
    expect(updated.reliefSource.samplesBase64).toBe(field.samplesBase64);
    expect(updated.reliefSource.inclusionMask).toBe(field.inclusionMask);
    expect(updated.reliefSource.provenance).toBe(field.provenance);
    expect(updated.bounds).toBe(before.bounds);
    expect(updated.transform).toBe(before.transform);
    expect(useStore.getState()).toMatchObject({ dirty: true });
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('does nothing for unchanged, invalid, or legacy-mesh gamma patches', () => {
    installHeightfieldRelief(testReliefHeightfieldFixture());
    const beforeHeightfield = useStore.getState().project;
    for (const gamma of [1, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      useStore.getState().setReliefParams('R1', { gamma });
    }
    expect(useStore.getState().project).toBe(beforeHeightfield);
    expect(useStore.getState()).toMatchObject({ dirty: false, undoStack: [] });

    installReliefProject();
    const beforeMesh = useStore.getState().project;
    useStore.getState().setReliefParams('R1', { gamma: 2 });
    expect(useStore.getState().project).toBe(beforeMesh);
    expect(useStore.getState()).toMatchObject({ dirty: false, undoStack: [] });
  });

  it.each([
    ['excluded', 'stock-top'],
    ['excluded', 'relief-floor'],
    ['stock-top', 'excluded'],
  ] as const)(
    'updates only outside-mask meaning from %s to %s for an imported masked heightfield',
    (initialOutsideMask, outsideMask) => {
      const sourceWidth = 5;
      const sourceHeight = 11;
      const sampleCount = sourceWidth * sourceHeight;
      const field = testReliefHeightfield({
        width: sourceWidth,
        height: sourceHeight,
        physicalWidthMm: 100,
        physicalHeightMm: 220,
        maxDepthMm: 5,
        samplesU8: Array.from({ length: sampleCount }, (_, index) => index),
        inclusionMask: Array.from({ length: sampleCount }, (_, index) =>
          index % 5 === 0 ? 0 : 255,
        ),
        mapping: {
          polarity: 'light-is-deep',
          curve: { kind: 'gamma-v1', gamma: 2.25 },
          crop: { kind: 'normalized-v1', x: 0.1, y: 0.2, width: 0.8, height: 0.7 },
          aspect: 'stretch',
          inclusionThreshold: 128,
          outsideMask: initialOutsideMask,
        },
        provenance: { sourceName: 'masked-source.png' },
        revision: 4,
      });
      installHeightfieldRelief(field);
      const before = storedRelief();

      useStore.getState().setReliefParams('R1', { outsideMask });

      const updated = storedRelief();
      expect(updated.reliefSource.kind).toBe('heightfield-v1');
      if (updated.reliefSource.kind !== 'heightfield-v1') return;
      expect(updated).toEqual({
        ...before,
        reliefSource: {
          ...field,
          mapping: { ...field.mapping, outsideMask },
          revision: 5,
        },
      });
      expect(updated.reliefSource.inclusionMask).toBe(field.inclusionMask);
      expect(updated.reliefSource.provenance).toBe(field.provenance);
      expect(updated.reliefSource.mapping.curve).toBe(field.mapping.curve);
      expect(updated.reliefSource.mapping.crop).toBe(field.mapping.crop);
      expect(updated.bounds).toBe(before.bounds);
      expect(updated.transform).toBe(before.transform);
      expect(useStore.getState()).toMatchObject({ dirty: true });
      expect(useStore.getState().undoStack).toHaveLength(1);
    },
  );

  it('does nothing when outside-mask meaning is unchanged or the relief is a mesh', () => {
    installHeightfieldRelief(testReliefHeightfieldFixture());
    const beforeHeightfield = useStore.getState().project;

    useStore.getState().setReliefParams('R1', { outsideMask: 'excluded' });

    expect(useStore.getState().project).toBe(beforeHeightfield);
    expect(useStore.getState()).toMatchObject({ dirty: false, undoStack: [] });
    installReliefProject();
    const beforeMesh = useStore.getState().project;

    useStore.getState().setReliefParams('R1', { outsideMask: 'stock-top' });

    expect(useStore.getState().project).toBe(beforeMesh);
    expect(useStore.getState()).toMatchObject({ dirty: false, undoStack: [] });
  });

  it('ignores outside-mask values outside the exact persisted enum', () => {
    installHeightfieldRelief(testReliefHeightfieldFixture());
    const before = useStore.getState().project;

    for (const outsideMask of ['floor', 'top', 'stock-top ', null, 0]) {
      Reflect.apply(useStore.getState().setReliefParams, undefined, ['R1', { outsideMask }]);
    }

    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState()).toMatchObject({ dirty: false, undoStack: [] });
  });

  it('is a no-op for unknown ids and non-relief objects', () => {
    const before = useStore.getState().project;
    useStore.getState().setReliefParams('nope', { reliefDepthMm: 9 });
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});

function testReliefHeightfieldFixture(): ReturnType<typeof testReliefHeightfield> {
  return testReliefHeightfield({
    width: 2,
    height: 1,
    physicalWidthMm: 100,
    physicalHeightMm: 50,
    maxDepthMm: 5,
    samplesU8: [0, 255],
  });
}

function installHeightfieldRelief(field: ReturnType<typeof testReliefHeightfield>): void {
  const current = useStore.getState().project;
  useStore.setState({
    project: {
      ...current,
      scene: {
        ...current.scene,
        objects: [
          {
            ...relief(),
            source: 'depth.png',
            targetWidthMm: field.physicalWidthMm,
            reliefDepthMm: field.mapping.maxDepthMm,
            bounds: {
              minX: 0,
              minY: 0,
              maxX: field.physicalWidthMm,
              maxY: field.physicalHeightMm,
            },
            reliefSource: field,
          },
        ],
      },
    },
    dirty: false,
    undoStack: [],
    redoStack: [],
  });
}
