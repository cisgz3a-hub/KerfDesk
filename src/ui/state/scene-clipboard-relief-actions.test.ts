import { beforeEach, describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import {
  createLayer,
  createProject,
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  operationIdsForObject,
  type Layer,
  type Project,
  type ReliefObject,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';
import { useToastStore } from './toast-store';

describe('machine-agnostic relief paste', () => {
  beforeEach(() => {
    resetStore();
    useToastStore.setState({ toasts: [] });
  });

  it('pastes a mesh relief normally in CNC mode', () => {
    useStore.setState({ project: cncProjectWithRelief(meshRelief()) });
    useStore.getState().selectObject('relief-1');
    useStore.getState().copySelection();

    useStore.getState().pasteClipboard();

    const reliefs = currentReliefs();
    expect(reliefs).toHaveLength(2);
    expect(reliefs[1]?.reliefSource).toEqual(reliefs[0]?.reliefSource);
    expect(reliefs[1]?.reliefSource).not.toBe(reliefs[0]?.reliefSource);
  });

  it('pastes a mixed selection including a depth-map relief in laser mode', () => {
    useStore.setState({ project: cncProjectWithRelief(depthMapRelief()) });
    useStore.getState().selectAllObjects();
    useStore.getState().copySelection();
    useStore.getState().setMachineKind('laser');

    useStore.getState().pasteClipboard();

    const objects = useStore.getState().project.scene.objects;
    expect(objects.filter((object) => object.kind === 'relief')).toHaveLength(2);
    expect(objects.filter((object) => object.kind === 'imported-svg')).toHaveLength(2);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('pastes a depth-map-relief-only clipboard in laser mode with undo and redo', () => {
    useStore.setState({ project: cncProjectWithRelief(depthMapRelief()) });
    useStore.getState().selectObject('relief-1');
    useStore.getState().copySelection();
    useStore.getState().setMachineKind('laser');
    const before = useStore.getState().project;
    useStore.setState({ dirty: false, undoStack: [], redoStack: [] });

    useStore.getState().pasteClipboard();

    const pastedState = useStore.getState();
    const reliefs = currentReliefs();
    const pasted = reliefs[1];
    expect(pastedState.project).not.toBe(before);
    expect(reliefs).toHaveLength(2);
    expect(pasted).toBeDefined();
    if (pasted === undefined) throw new Error('expected pasted relief');
    expect(pasted.id).not.toBe('relief-1');
    expect(pasted.transform).toMatchObject({ x: 10, y: 10 });
    expect(pasted.reliefSource).toEqual(reliefs[0]?.reliefSource);
    expect(pasted.reliefSource).not.toBe(reliefs[0]?.reliefSource);
    expectPastedOperationToRetainSettings(pasted, pastedState.project);
    expect(pastedState.selectedObjectId).toBe(pasted.id);
    expect(pastedState.undoStack).toHaveLength(1);
    expect(pastedState.dirty).toBe(true);
    expect(useToastStore.getState().toasts).toHaveLength(0);

    useStore.getState().undo();
    expect(currentReliefs()).toHaveLength(1);

    useStore.getState().redo();
    expect(currentReliefs().map((relief) => relief.id)).toContain(pasted.id);
  });
});

function expectPastedOperationToRetainSettings(pasted: ReliefObject, project: Project): void {
  const original = currentReliefs()[0];
  if (original === undefined) throw new Error('expected original relief');
  const originalOperation = operationFor(original, project.scene.layers);
  const pastedOperation = operationFor(pasted, project.scene.layers);
  // Same-project Paste keeps artwork in its existing operation. Cloning the
  // operation here would make one visible relief emit twice.
  expect(pastedOperation.id).toBe(originalOperation.id);
  expect(pastedOperation.cnc).toEqual(originalOperation.cnc);
  expect(pastedOperation.output).toBe(originalOperation.output);
}

function operationFor(relief: ReliefObject, layers: ReadonlyArray<Layer>): Layer {
  const [operationId] = operationIdsForObject(relief, layers);
  const operation = layers.find((candidate) => candidate.id === operationId);
  if (operation === undefined) throw new Error(`expected operation for relief ${relief.id}`);
  return operation;
}

function currentReliefs(): ReadonlyArray<ReliefObject> {
  return useStore
    .getState()
    .project.scene.objects.filter((object): object is ReliefObject => object.kind === 'relief');
}

function cncProjectWithRelief(relief: ReliefObject): Project {
  const base = createProject();
  const project: Project = {
    ...base,
    scene: {
      objects: [
        { ...svgObj('svg-1', ['#ff0000']), transform: { ...IDENTITY_TRANSFORM, x: 0, y: 0 } },
        relief,
      ],
      layers: [
        createLayer({ id: '#ff0000', color: '#ff0000', mode: 'line' }),
        createLayer({ id: DEFAULT_RELIEF_LAYER_COLOR, color: DEFAULT_RELIEF_LAYER_COLOR }),
      ],
    },
  };
  useStore.setState({ project });
  useStore.getState().setMachineKind('cnc');
  return useStore.getState().project;
}

function reliefCommon(): Omit<ReliefObject, 'reliefSource'> {
  return {
    kind: 'relief',
    id: 'relief-1',
    source: 'relief-source',
    targetWidthMm: 100,
    reliefDepthMm: 5,
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
  };
}

function meshRelief(): ReliefObject {
  return {
    ...reliefCommon(),
    source: 'model.stl',
    reliefSource: {
      kind: 'legacy-mesh',
      meshPositions: [0, 0, 0, 10, 0, 0, 0, 10, 5],
      emptyCells: 'floor',
    },
  };
}

function depthMapRelief(): ReliefObject {
  return {
    ...reliefCommon(),
    source: 'portrait-depth.png',
    reliefSource: testReliefHeightfield({
      width: 2,
      height: 2,
      physicalWidthMm: 100,
      physicalHeightMm: 100,
      maxDepthMm: 5,
      samplesU8: [0, 255, 128, 255],
      provenance: { sourceName: 'portrait-depth.png' },
    }),
  };
}
