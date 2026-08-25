import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { reliefObjectToHeightmap } from '../../core/relief/relief-object-to-heightmap';
import { transformedBBox, type Project, type ReliefObject } from '../../core/scene';
import type { HeightfieldReliefObject, ReliefHeightfieldMapping } from '../../core/scene/relief';
import { prepareProjectForAutosave, prepareProjectForPersistence } from '../../io/project';
import { resetStore } from './test-helpers';
import { factorReliefHeightfieldWidth } from './relief-heightfield-width-factorization';
import { useStore } from './store';

const RELIEF_ID = 'bounded-width-relief';
const SOURCE_NAME = 'bounded-width.png';
const INITIAL_REVISION = 7;
const LOCAL_COORDINATE_LIMIT_MM = 1_000_000;
const INTENDED_WIDTH_MM = 2_000_000;
const INTENDED_HEIGHT_MM = 1_000_000;
const DISPLAYED_WIDTH_MM = 1;
const INITIAL_SCALE_X = 5e-7;
const FACTOR = 2;
const ROTATION_DEG = 45;
const TRANSLATION_X_MM = 12;
const TRANSLATION_Y_MM = -3;
const COARSE_CELL_MM = 1_000_000;
const FULL_MASK_BYTE = 0xff;

describe('heightfield Width project-v4 factorization', () => {
  it('uses one exact common factor while preserving transformed geometry', () => {
    const intended = heightfieldRelief({
      widthMm: INTENDED_WIDTH_MM,
      heightMm: INTENDED_HEIGHT_MM,
      scaleX: -INITIAL_SCALE_X,
      scaleY: 1,
      rotationDeg: ROTATION_DEG,
    });

    const result = factorReliefHeightfieldWidth(intended);

    expect(result.kind).toBe('factored');
    expect(result.relief).toMatchObject({
      targetWidthMm: LOCAL_COORDINATE_LIMIT_MM,
      bounds: {
        minX: 0,
        minY: 0,
        maxX: LOCAL_COORDINATE_LIMIT_MM,
        maxY: INTENDED_HEIGHT_MM / FACTOR,
      },
      transform: { scaleX: -INITIAL_SCALE_X * FACTOR, scaleY: FACTOR },
      reliefSource: {
        physicalWidthMm: LOCAL_COORDINATE_LIMIT_MM,
        physicalHeightMm: INTENDED_HEIGHT_MM / FACTOR,
        mapping: { aspect: 'preserve' },
      },
    });
    expect(transformedBBox(result.relief)).toEqual(transformedBBox(intended));
  });

  it('retains an already bounded object by reference', () => {
    const relief = heightfieldRelief({ widthMm: 100, heightMm: 50, scaleX: 1, scaleY: 1 });

    expect(factorReliefHeightfieldWidth(relief)).toEqual({ kind: 'unchanged', relief });
  });

  it('keeps Stretch policy and materialized machine geometry unchanged', () => {
    const intended = heightfieldRelief({
      widthMm: INTENDED_WIDTH_MM * FACTOR,
      heightMm: INTENDED_HEIGHT_MM * FACTOR,
      scaleX: INITIAL_SCALE_X,
      scaleY: 1,
      aspect: 'stretch',
    });

    const result = factorReliefHeightfieldWidth(intended);

    expect(result).toMatchObject({
      kind: 'factored',
      relief: {
        transform: { scaleX: INITIAL_SCALE_X * FACTOR * FACTOR, scaleY: FACTOR * FACTOR },
        reliefSource: {
          physicalWidthMm: LOCAL_COORDINATE_LIMIT_MM,
          mapping: { aspect: 'stretch' },
        },
      },
    });
    expect(materialize(result.relief)).toEqual(materialize(intended));
  });

  it.each([
    ['exact-zero compatibility', 0, 1, 'zero-scale'],
    ['scale-domain exhaustion', 1, 100_000, 'scale-domain'],
  ] as const)(
    'reports %s without rewriting the intended edit',
    (_label, scaleX, scaleY, reason) => {
      const relief = heightfieldRelief({
        widthMm: INTENDED_WIDTH_MM,
        heightMm: INTENDED_HEIGHT_MM,
        scaleX,
        scaleY,
      });

      expect(factorReliefHeightfieldWidth(relief)).toEqual({ kind: 'unavailable', reason, relief });
    },
  );

  it('reports when a common factor would erase the other canonical axis', () => {
    const relief = heightfieldRelief({
      widthMm: INTENDED_WIDTH_MM,
      heightMm: Number.MIN_VALUE,
      scaleX: 1,
      scaleY: 1,
    });

    expect(factorReliefHeightfieldWidth(relief)).toEqual({
      kind: 'unavailable',
      reason: 'numeric-domain',
      relief,
    });
  });

  it('does not mistake equal underflowed corners for reversible canonical factors', () => {
    const relief = heightfieldRelief({
      widthMm: INTENDED_WIDTH_MM,
      heightMm: Number.MIN_VALUE * 3,
      scaleX: INITIAL_SCALE_X,
      scaleY: Number.MIN_VALUE,
    });

    expect(factorReliefHeightfieldWidth(relief)).toEqual({
      kind: 'unavailable',
      reason: 'factor-drift',
      relief,
    });
  });

  it('keeps the real Width edit valid for manual save and autosave preparation', () => {
    const initial = heightfieldRelief({
      widthMm: 1,
      heightMm: 0.5,
      scaleX: INITIAL_SCALE_X,
      scaleY: 1,
    });
    installRelief(initial);
    expectPersistence('ok');

    useStore.getState().setReliefParams(RELIEF_ID, {
      targetWidthMm: DISPLAYED_WIDTH_MM / INITIAL_SCALE_X,
    });

    const updated = storedHeightfieldRelief();
    expect(updated).toMatchObject({
      targetWidthMm: LOCAL_COORDINATE_LIMIT_MM,
      bounds: { maxX: LOCAL_COORDINATE_LIMIT_MM, maxY: INTENDED_HEIGHT_MM / FACTOR },
      transform: { scaleX: INITIAL_SCALE_X * FACTOR, scaleY: FACTOR },
      reliefSource: {
        physicalWidthMm: LOCAL_COORDINATE_LIMIT_MM,
        physicalHeightMm: INTENDED_HEIGHT_MM / FACTOR,
        revision: INITIAL_REVISION + 1,
      },
    });
    expect(updated.reliefSource.samplesBase64).toBe(initial.reliefSource.samplesBase64);
    expect(updated.reliefSource.inclusionMask).toBe(initial.reliefSource.inclusionMask);
    expect(updated.reliefSource.digest).toBe(initial.reliefSource.digest);
    expect(updated.reliefSource.provenance).toBe(initial.reliefSource.provenance);
    expect(useStore.getState()).toMatchObject({ dirty: true });
    expect(useStore.getState().undoStack).toHaveLength(1);
    expectPersistence('ok');
  });
});

type ReliefGeometry = {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotationDeg?: number;
  readonly aspect?: ReliefHeightfieldMapping['aspect'];
};

function heightfieldRelief(geometry: ReliefGeometry): HeightfieldReliefObject {
  const reliefSource = testReliefHeightfield({
    width: 1,
    height: 1,
    physicalWidthMm: geometry.widthMm,
    physicalHeightMm: geometry.heightMm,
    maxDepthMm: 1,
    samplesU8: [0],
    inclusionMask: [FULL_MASK_BYTE],
    mapping: { aspect: geometry.aspect ?? 'preserve' },
    provenance: { sourceName: SOURCE_NAME },
    revision: INITIAL_REVISION,
  });
  return {
    kind: 'relief',
    id: RELIEF_ID,
    source: SOURCE_NAME,
    targetWidthMm: geometry.widthMm,
    reliefDepthMm: 1,
    reliefSource,
    color: '#a0522d',
    bounds: { minX: 0, minY: 0, maxX: geometry.widthMm, maxY: geometry.heightMm },
    transform: {
      x: TRANSLATION_X_MM,
      y: TRANSLATION_Y_MM,
      scaleX: geometry.scaleX,
      scaleY: geometry.scaleY,
      rotationDeg: geometry.rotationDeg ?? 0,
      mirrorX: false,
      mirrorY: true,
    },
  };
}

function materialize(relief: HeightfieldReliefObject) {
  return reliefObjectToHeightmap(relief, {
    targetWidthMm: relief.targetWidthMm,
    reliefDepthMm: relief.reliefDepthMm,
    targetScaleX: Math.abs(relief.transform.scaleX),
    targetScaleY: Math.abs(relief.transform.scaleY),
    mmPerCell: COARSE_CELL_MM,
  });
}

function installRelief(relief: HeightfieldReliefObject): void {
  resetStore();
  const current = useStore.getState().project;
  const project: Project = {
    ...current,
    scene: { ...current.scene, objects: [relief] },
  };
  useStore.setState({ project, dirty: false, undoStack: [], redoStack: [] });
}

function storedHeightfieldRelief(): HeightfieldReliefObject {
  const object = useStore
    .getState()
    .project.scene.objects.find((candidate) => candidate.id === RELIEF_ID);
  if (object?.kind !== 'relief' || !isHeightfieldRelief(object)) {
    throw new Error('heightfield relief missing');
  }
  return object;
}

function isHeightfieldRelief(relief: ReliefObject): relief is HeightfieldReliefObject {
  return relief.reliefSource.kind === 'heightfield-v1';
}

function expectPersistence(expected: 'ok'): void {
  const project = useStore.getState().project;
  expect(prepareProjectForPersistence(project).kind).toBe(expected);
  expect(prepareProjectForAutosave(project).kind).toBe(expected);
}
