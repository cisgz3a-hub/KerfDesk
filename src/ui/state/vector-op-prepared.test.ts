import { beforeEach, describe, expect, it } from 'vitest';
import type { VectorSceneObject } from '../../core/geometry';
import type { OffsetShapesOptions } from '../../core/geometry/offset-shapes';
import {
  createLayer,
  createProject,
  type ImportedSvg,
  type Project,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import { parityObjects, throughWorkerBoundary } from '../commands/vector-op-worker.test-fixture';
import {
  offsetShapesResultIds,
  offsetShapesTargets,
  type OffsetShapesRequest,
} from './offset-shapes-actions';
import { selectedObjectIds } from './scene-group-actions';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import {
  reusableCombine,
  type PreparedOffsetShapes,
  type PreparedVectorCombine,
} from './vector-op-prepared';
import { objectIdStillFree, uniqueObjectId, uniqueWeldId } from './vector-path-selection';
import { finishWeldSelection, prepareWeldSelection } from './vector-path-weld-plan';

const REQUEST: OffsetShapesRequest = {
  distanceMm: 1.5,
  direction: 'both',
  cornerStyle: 'round',
  outerShapesOnly: false,
  deleteOriginals: false,
};

function load(objects: ReadonlyArray<VectorSceneObject> = parityObjects()): void {
  resetStore();
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects,
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        groups: [],
      },
    },
    selectedObjectId: 'dense',
    additionalSelectedIds: new Set(['plate', 'square']),
    dirty: false,
  });
}

function targets(): ReadonlyArray<VectorSceneObject> {
  const state = useStore.getState();
  return offsetShapesTargets(state.project.scene, selectedObjectIds(state), false).targets;
}

// The committed document after an action. Equal documents compile to equal
// toolpaths and G-code, since compilation is a pure function of the project.
function committed(run: () => void, setup: () => void = () => load()): string {
  setup();
  run();
  const project: Project = useStore.getState().project;
  return JSON.stringify(project);
}

function preparedOffset(options: OffsetShapesOptions = REQUEST): PreparedOffsetShapes {
  const sources = targets();
  const ids = offsetShapesResultIds(useStore.getState().project.scene);
  const result = throughWorkerBoundary(sources, { kind: 'offset-shapes', options, ids });
  if (result.kind !== 'ok') throw new Error(result.error.message);
  return { sources, options, ids, result: result.value };
}

// The parity objects with shared output settings, so their overlapping outlines
// fall in one Weld operation and actually merge.
function loadWeldable(): void {
  load(
    parityObjects().map(
      ({ powerScale: _power, operationOverride: _override, ...object }) => object,
    ),
  );
}

function sourceOf(object: SceneObject | undefined): string | undefined {
  return object !== undefined && 'source' in object ? object.source : undefined;
}

function marked(object: ImportedSvg | null): ImportedSvg | null {
  return object === null ? null : { ...object, source: 'worker result' };
}

describe('committing a background vector result (ADR-609)', () => {
  beforeEach(() => load());

  it('Offset Shapes commits the same document as the in-thread offset', () => {
    const inThread = committed(() => useStore.getState().offsetShapesSelection(REQUEST));
    const viaWorker = committed(() =>
      useStore.getState().offsetShapesSelection(REQUEST, preparedOffset()),
    );
    expect(viaWorker).toBe(inThread);
    expect(useStore.getState().project.scene.objects).toHaveLength(5);
  });

  it('Offset Shapes reuses a matching result and recomputes a stale one', () => {
    const prepared = preparedOffset();
    const sentinel = {
      ...prepared,
      result: { outward: marked(prepared.result.outward), inward: marked(prepared.result.inward) },
    };
    useStore.getState().offsetShapesSelection(REQUEST, sentinel);
    expect(sourceOf(useStore.getState().project.scene.objects[3])).toBe('worker result');

    load();
    const otherDistance = { ...sentinel, options: { ...sentinel.options, distanceMm: 2 } };
    useStore.getState().offsetShapesSelection(REQUEST, otherDistance);
    expect(sourceOf(useStore.getState().project.scene.objects[3])).toBe('Offset outward (1.5 mm)');

    load();
    const otherSources = { ...sentinel, sources: sentinel.sources.slice(1) };
    useStore.getState().offsetShapesSelection(REQUEST, otherSources);
    expect(sourceOf(useStore.getState().project.scene.objects[3])).toBe('Offset outward (1.5 mm)');
  });

  it.each(['subtract', 'intersect', 'exclude'] as const)(
    'Combine %s commits the same document as the in-thread combine',
    (op) => {
      const inThread = committed(() => useStore.getState().booleanSelection(op));
      const viaWorker = committed(() => {
        const scene = useStore.getState().project.scene;
        const sources = targets();
        const result = throughWorkerBoundary(sources, {
          kind: 'combine',
          op,
          id: uniqueObjectId(scene, op),
        });
        if (result.kind !== 'ok') throw new Error(result.error.message);
        const prepared: PreparedVectorCombine = {
          kind: 'combine',
          sources,
          op,
          object: result.value,
        };
        useStore.getState().booleanSelection(op, { prepared });
      });
      expect(viaWorker).toBe(inThread);
    },
  );

  it('Combine ignores a result prepared for another operation', () => {
    const sources = targets();
    const scene = useStore.getState().project.scene;
    const result = throughWorkerBoundary(sources, {
      kind: 'combine',
      op: 'intersect',
      id: uniqueObjectId(scene, 'subtract'),
    });
    if (result.kind !== 'ok') throw new Error(result.error.message);
    const object = { ...result.value, source: 'worker result' };
    useStore.getState().booleanSelection('subtract', {
      prepared: { kind: 'combine', sources, op: 'intersect', object },
    });
    expect(sourceOf(useStore.getState().project.scene.objects.at(-1))).toBe('Subtracted paths');
  });

  it('Weld commits the same document as the in-thread weld', () => {
    const inThread = committed(() => useStore.getState().weldSelection(), loadWeldable);
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
    const viaWorker = committed(() => {
      const scene = useStore.getState().project.scene;
      const sources = targets();
      const weld = prepareWeldSelection(scene, sources, uniqueWeldId(scene));
      const welded = throughWorkerBoundary(weld.operands, { kind: 'weld', id: weld.resultId });
      const plan = finishWeldSelection(weld, welded);
      if (plan.kind !== 'ok') throw new Error(plan.error.message);
      useStore
        .getState()
        .weldSelection({ prepared: { kind: 'weld', scene, sources, plan: plan.value } });
    }, loadWeldable);
    expect(viaWorker).toBe(inThread);
  });

  it('Weld ignores a plan prepared for another scene', () => {
    loadWeldable();
    const scene = useStore.getState().project.scene;
    const sources = targets();
    const weld = prepareWeldSelection(scene, sources, uniqueWeldId(scene));
    const plan = finishWeldSelection(
      weld,
      throughWorkerBoundary(weld.operands, { kind: 'weld', id: weld.resultId }),
    );
    if (plan.kind !== 'ok') throw new Error(plan.error.message);
    const stale = { ...plan.value, object: { ...plan.value.object, source: 'worker result' } };
    useStore.getState().weldSelection({
      prepared: { kind: 'weld', scene: { ...scene }, sources, plan: stale },
    });
    expect(sourceOf(useStore.getState().project.scene.objects.at(-1))).toBe('Welded paths');
  });
});

describe('background result ids (ADR-609)', () => {
  const sceneWith = (ids: ReadonlyArray<string>): Scene =>
    ({ objects: ids.map((id) => ({ id })), layers: [], groups: [] }) as unknown as Scene;
  const exhausted = sceneWith([
    'subtract-paths',
    ...Array.from({ length: 999 }, (_, index) => `subtract-paths-${index + 2}`),
  ]);

  it('accepts the numbered id the scene would give, and only that one', () => {
    const scene = sceneWith(['subtract-paths']);
    expect(objectIdStillFree(scene, 'subtract', 'subtract-paths-2')).toBe(true);
    expect(objectIdStillFree(scene, 'subtract', 'subtract-paths')).toBe(false);
    expect(objectIdStillFree(scene, 'subtract', 'subtract-paths-3')).toBe(false);
  });

  it('accepts an unused random id once the numbered ids run out', () => {
    expect(uniqueObjectId(exhausted, 'subtract')).not.toBe(uniqueObjectId(exhausted, 'subtract'));
    expect(objectIdStillFree(exhausted, 'subtract', 'subtract-paths-1a2b')).toBe(true);
    expect(objectIdStillFree(exhausted, 'subtract', 'subtract-paths-1000')).toBe(false);
    expect(objectIdStillFree(exhausted, 'subtract', 'offset-paths-1a2b')).toBe(false);
  });

  it('reuses a combine result carrying a random id instead of recomputing', () => {
    const [subject] = parityObjects();
    const sources = parityObjects();
    const object = { ...(subject as ImportedSvg), id: 'subtract-paths-1a2b' };
    const prepared: PreparedVectorCombine = { kind: 'combine', sources, op: 'subtract', object };
    expect(reusableCombine(prepared, exhausted, sources, 'subtract')).toBe(object);
    expect(reusableCombine(prepared, exhausted, sources, 'intersect')).toBeUndefined();
  });
});
