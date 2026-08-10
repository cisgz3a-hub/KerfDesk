import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import {
  createLayer,
  createProject,
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type Project,
  type ReliefObject,
} from '../../core/scene';
import type { HeightfieldReliefObject, MeshReliefObject } from '../../core/scene/relief';
import { prepareProjectForPersistence } from '../../io/project';
import { resetStore } from './test-helpers';
import { reliefWidthBounds } from './relief-width-bounds';
import { useStore } from './store';

const RELIEF_ID = 'width-invariant-relief';
const SOURCE_NAME = 'width-invariant.png';
const INITIAL_REVISION = 4;
const EDITED_WIDTH_MM = 100;
const TOLERATED_WIDTH_MM = 1e-9;
const TOLERATED_HEIGHT_MM = 1e-9;
const TOLERATED_BOUNDS_HEIGHT_MM = 1e-18;
const FULL_MASK_BYTE = 0xff;
const LEGACY_WIDTH_MM = 100;
const LEGACY_HEIGHT_MM = 50;
const LEGACY_EDITED_WIDTH_MM = 200;
const LEGACY_EDITED_HEIGHT_MM = 100;

type ReliefDimensions = {
  readonly physicalWidthMm: number;
  readonly physicalHeightMm: number;
  readonly boundsHeightMm?: number;
};

describe('relief Width bounds', () => {
  it('uses updated canonical dimensions instead of tolerated duplicate bounds', () => {
    const current = heightfieldRelief({
      physicalWidthMm: TOLERATED_WIDTH_MM,
      physicalHeightMm: TOLERATED_HEIGHT_MM,
      boundsHeightMm: TOLERATED_BOUNDS_HEIGHT_MM,
    });
    const updated: HeightfieldReliefObject = {
      ...current,
      targetWidthMm: EDITED_WIDTH_MM,
      reliefSource: {
        ...current.reliefSource,
        physicalWidthMm: EDITED_WIDTH_MM,
        physicalHeightMm: EDITED_WIDTH_MM,
      },
    };

    expect(reliefWidthBounds(current, updated)).toEqual({
      minX: 0,
      minY: 0,
      maxX: EDITED_WIDTH_MM,
      maxY: EDITED_WIDTH_MM,
    });
  });

  it('retains legacy mesh bounds-aspect behavior', () => {
    const current = legacyRelief();
    const updated: MeshReliefObject = { ...current, targetWidthMm: LEGACY_EDITED_WIDTH_MM };

    expect(reliefWidthBounds(current, updated)).toEqual({
      minX: 0,
      minY: 0,
      maxX: LEGACY_EDITED_WIDTH_MM,
      maxY: LEGACY_EDITED_HEIGHT_MM,
    });
  });

  it('keeps tolerated duplicate Width edits persistence-valid through the real store action', () => {
    installHeightfieldRelief({
      physicalWidthMm: TOLERATED_WIDTH_MM,
      physicalHeightMm: TOLERATED_HEIGHT_MM,
      boundsHeightMm: TOLERATED_BOUNDS_HEIGHT_MM,
    });
    const before = storedRelief();
    expectPersistenceToSucceed();

    useStore.getState().setReliefParams(RELIEF_ID, { targetWidthMm: EDITED_WIDTH_MM });

    const updated = storedRelief();
    expect(updated).toMatchObject({
      targetWidthMm: EDITED_WIDTH_MM,
      bounds: { minX: 0, minY: 0, maxX: EDITED_WIDTH_MM, maxY: EDITED_WIDTH_MM },
      reliefSource: {
        physicalWidthMm: EDITED_WIDTH_MM,
        physicalHeightMm: EDITED_WIDTH_MM,
        revision: INITIAL_REVISION + 1,
        mapping: { aspect: 'preserve' },
      },
    });
    expectUntouchedSourceIdentities(updated, before);
    expectPersistenceToSucceed();
    expect(useStore.getState()).toMatchObject({ dirty: true });
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it.each([
    ['underflow', 1, Number.MIN_VALUE, Number.MIN_VALUE],
    ['overflow', Number.MIN_VALUE, 1, 1],
  ])(
    'keeps the stored project valid after preserve-aspect %s',
    (_case, width, height, editedWidth) => {
      installHeightfieldRelief({ physicalWidthMm: width, physicalHeightMm: height });
      expectPersistenceToSucceed();

      useStore.getState().setReliefParams(RELIEF_ID, { targetWidthMm: editedWidth });

      expect(storedRelief()).toMatchObject({
        targetWidthMm: editedWidth,
        bounds: { minX: 0, minY: 0, maxX: editedWidth, maxY: height },
        reliefSource: {
          physicalWidthMm: editedWidth,
          physicalHeightMm: height,
          revision: INITIAL_REVISION + 1,
          mapping: { aspect: 'stretch' },
        },
      });
      expectPersistenceToSucceed();
      expect(useStore.getState()).toMatchObject({ dirty: true });
      expect(useStore.getState().undoStack).toHaveLength(1);
    },
  );
});

function heightfieldRelief(dimensions: ReliefDimensions): HeightfieldReliefObject {
  const reliefSource = testReliefHeightfield({
    width: 1,
    height: 1,
    physicalWidthMm: dimensions.physicalWidthMm,
    physicalHeightMm: dimensions.physicalHeightMm,
    maxDepthMm: 1,
    samplesU8: [0],
    inclusionMask: [FULL_MASK_BYTE],
    provenance: { sourceName: SOURCE_NAME },
    revision: INITIAL_REVISION,
  });
  return {
    kind: 'relief',
    id: RELIEF_ID,
    source: SOURCE_NAME,
    targetWidthMm: dimensions.physicalWidthMm,
    reliefDepthMm: reliefSource.mapping.maxDepthMm,
    reliefSource,
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: {
      minX: 0,
      minY: 0,
      maxX: dimensions.physicalWidthMm,
      maxY: dimensions.boundsHeightMm ?? dimensions.physicalHeightMm,
    },
    transform: IDENTITY_TRANSFORM,
  };
}

function legacyRelief(): MeshReliefObject {
  return {
    kind: 'relief',
    id: RELIEF_ID,
    source: 'legacy.stl',
    targetWidthMm: LEGACY_WIDTH_MM,
    reliefDepthMm: 1,
    reliefSource: {
      kind: 'legacy-mesh',
      meshPositions: [0, 0, 0, 1, 0, 0, 0, 1, 1],
      emptyCells: 'floor',
    },
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: LEGACY_WIDTH_MM, maxY: LEGACY_HEIGHT_MM },
    transform: IDENTITY_TRANSFORM,
  };
}

function installHeightfieldRelief(dimensions: ReliefDimensions): void {
  resetStore();
  const relief = heightfieldRelief(dimensions);
  const base = createProject();
  const project: Project = {
    ...base,
    scene: {
      objects: [relief],
      layers: [createLayer({ id: DEFAULT_RELIEF_LAYER_COLOR, color: DEFAULT_RELIEF_LAYER_COLOR })],
    },
  };
  useStore.setState({ project, dirty: false, undoStack: [], redoStack: [] });
}

function storedRelief(): HeightfieldReliefObject {
  const object = useStore
    .getState()
    .project.scene.objects.find((candidate) => candidate.id === RELIEF_ID);
  if (object?.kind !== 'relief' || !isHeightfieldRelief(object)) {
    throw new Error('canonical heightfield relief missing');
  }
  return object;
}

function isHeightfieldRelief(relief: ReliefObject): relief is HeightfieldReliefObject {
  return relief.reliefSource.kind === 'heightfield-v1';
}

function expectUntouchedSourceIdentities(
  updated: HeightfieldReliefObject,
  before: HeightfieldReliefObject,
): void {
  expect(updated.reliefSource.samplesBase64).toBe(before.reliefSource.samplesBase64);
  expect(updated.reliefSource.inclusionMask).toBe(before.reliefSource.inclusionMask);
  expect(updated.reliefSource.digest).toBe(before.reliefSource.digest);
  expect(updated.reliefSource.provenance).toBe(before.reliefSource.provenance);
  expect(updated.transform).toBe(before.transform);
}

function expectPersistenceToSucceed(): void {
  const result = prepareProjectForPersistence(useStore.getState().project);
  expect(result.kind, result.kind === 'invalid' ? result.reason : undefined).toBe('ok');
}
