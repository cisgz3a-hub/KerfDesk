import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  createRegistrationLayer,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  operationIdsForObject,
  type Layer,
  type LayerMode,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { artworkRunOrderRows } from '../layers/artwork-run-order-view-model';
import { sortCutsLastMessage } from './operation-list-actions';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';
import { useToastStore } from './toast-store';

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});
afterEach(() => useToastStore.setState({ toasts: [] }));

describe('operation list bulk output and visibility', () => {
  it('turns output off for all in one undo step and never writes parkedOutput', () => {
    importArtworks('A', 'B');
    parkOutput(0, false);
    const undoBefore = useStore.getState().undoStack.length;

    useStore.getState().setAllLayersOutput(false);

    expect(layers().map((layer) => layer.output)).toEqual([false, false]);
    expect(layers()[0]?.parkedOutput).toBe(false);
    expect(layers()[1]).not.toHaveProperty('parkedOutput');
    expect(useStore.getState().undoStack).toHaveLength(undoBefore + 1);
    useStore.getState().undo();
    expect(layers().map((layer) => layer.output)).toEqual([true, true]);
  });

  it('adds no undo step when output already matches', () => {
    importArtworks('A', 'B');
    const undoBefore = useStore.getState().undoStack.length;

    useStore.getState().setAllLayersOutput(true);
    useStore.getState().setAllLayersVisible(true);

    expect(useStore.getState().undoStack).toHaveLength(undoBefore);
  });

  it('inverts each output independently', () => {
    importArtworks('A', 'B');
    useStore.getState().setLayerParam(layerId(1), { output: false });
    parkOutput(1, true);
    const undoBefore = useStore.getState().undoStack.length;

    useStore.getState().setAllLayersOutput('invert');

    expect(layers().map((layer) => layer.output)).toEqual([false, true]);
    expect(layers()[1]?.parkedOutput).toBe(true);
    expect(layers().map((layer) => layer.visible)).toEqual([true, true]);
    expect(useStore.getState().undoStack).toHaveLength(undoBefore + 1);
  });

  it('leaves the registration jig off when turning output on or inverting it', () => {
    importArtworks('A');
    addRegistrationJig(false);

    useStore.getState().setAllLayersOutput(true);
    expect(layers().map((layer) => [layer.id, layer.output])).toEqual([
      [layerId(0), true],
      ['registration', false],
    ]);

    useStore.getState().setAllLayersOutput('invert');
    expect(layers().map((layer) => layer.output)).toEqual([false, false]);
  });

  it('turns the registration jig off with everything else', () => {
    importArtworks('A');
    addRegistrationJig(true);

    useStore.getState().setAllLayersOutput(false);

    expect(layers().map((layer) => layer.output)).toEqual([false, false]);
  });

  it('hides all operations in one step and prunes the hidden selection', () => {
    importArtworks('A', 'B');
    useStore.getState().selectObjects(['A', 'B']);
    const undoBefore = useStore.getState().undoStack.length;

    useStore.getState().setAllLayersVisible(false);

    expect(layers().map((layer) => [layer.visible, layer.output])).toEqual([
      [false, true],
      [false, true],
    ]);
    expect(useStore.getState().selectedObjectId).toBeNull();
    expect(useStore.getState().additionalSelectedIds.size).toBe(0);
    expect(useStore.getState().undoStack).toHaveLength(undoBefore + 1);
    useStore.getState().setAllLayersVisible('invert');
    expect(layers().map((layer) => layer.visible)).toEqual([true, true]);
  });

  it('shows only one operation and keeps only its artwork selected', () => {
    importArtworks('A', 'B', 'C');
    useStore.getState().selectObjects(['A', 'B', 'C']);
    const undoBefore = useStore.getState().undoStack.length;

    useStore.getState().showOnlyLayer(layerId(1));

    expect(layers().map((layer) => layer.visible)).toEqual([false, true, false]);
    expect(useStore.getState().selectedObjectId).toBe('B');
    expect(useStore.getState().additionalSelectedIds.size).toBe(0);
    expect(useStore.getState().undoStack).toHaveLength(undoBefore + 1);

    useStore.getState().showOnlyLayer(layerId(1));
    useStore.getState().showOnlyLayer('missing');
    expect(useStore.getState().undoStack).toHaveLength(undoBefore + 1);
    expect(layers().map((layer) => layer.visible)).toEqual([false, true, false]);
  });
});

describe('sort cuts last action', () => {
  it('reorders operations and artwork in one undo step and explains the result', () => {
    useStore.setState({ project: engraveAndCutProject() });
    const before = useStore.getState().project;

    useStore.getState().sortCutsLast();

    const scene = useStore.getState().project.scene;
    expect(scene.layers.map((layer) => layer.id)).toEqual([
      'engrave',
      'engrave-2',
      'cut-weak',
      'cut-mixed',
      'cut-strong',
    ]);
    expect(scene.artworkOrder).toEqual(['engrave-art', 'mixed-art', 'weak-art', 'strong-art']);
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(lastToast()).toEqual({
      message:
        'Cuts now run last: 2 cut operations moved after engraving and 1 artwork moved later in Run order. 1 artwork both engraves and cuts, so its cut runs right after its own engraving.',
      variant: 'success',
    });
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  });

  it('adds no undo step when cuts already run last', () => {
    useStore.setState({ project: engraveAndCutProject() });
    useStore.getState().sortCutsLast();
    const undoAfterFirst = useStore.getState().undoStack.length;

    useStore.getState().sortCutsLast();

    expect(useStore.getState().undoStack).toHaveLength(undoAfterFirst);
    expect(lastToast()).toEqual({
      message:
        'Cuts already run last. 1 artwork both engraves and cuts, so its cut runs right after its own engraving.',
      variant: 'info',
    });
  });

  it('leaves a CNC project untouched', () => {
    const project = engraveAndCutProject();
    useStore.setState({ project: { ...project, machine: DEFAULT_CNC_MACHINE_CONFIG } });
    const before = useStore.getState().project;

    useStore.getState().sortCutsLast();

    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(lastToast()?.message).toBe('CNC already runs profiles last.');
  });

  it('shows cuts after engraving in the Run order effective steps', () => {
    useStore.setState({ project: engraveAndCutProject() });
    const stepsBefore = effectiveSteps(useStore.getState().project);
    expect(Math.min(...(stepsBefore.get('strong-art') ?? []))).toBeLessThan(
      Math.min(...(stepsBefore.get('engrave-art') ?? [])),
    );

    useStore.getState().sortCutsLast();

    const steps = effectiveSteps(useStore.getState().project);
    const engraveSteps = [...(steps.get('engrave-art') ?? []), ...(steps.get('mixed-art') ?? [])];
    const cutOnlySteps = [...(steps.get('weak-art') ?? []), ...(steps.get('strong-art') ?? [])];
    expect(engraveSteps.length).toBeGreaterThan(0);
    expect(steps.get('weak-art')?.length).toBeGreaterThan(0);
    expect(steps.get('strong-art')?.length).toBeGreaterThan(0);
    expect(Math.max(...engraveSteps)).toBeLessThan(Math.min(...cutOnlySteps));
    expect(steps.get('weak-art')?.[0]).toBeLessThan(steps.get('strong-art')?.[0] ?? 0);
  });

  it('words single counts and cut-only projects plainly', () => {
    const base = { scene: createProject().scene, engraveAndCutArtwork: 0 };
    expect(
      sortCutsLastMessage({ ...base, movedCutOperations: 1, artworkMovedLater: 1 }, false),
    ).toBe(
      'Cuts now run last: 1 cut operation reordered weakest first and 1 artwork moved later in Run order.',
    );
    expect(
      sortCutsLastMessage(
        { ...base, movedCutOperations: 0, artworkMovedLater: 0, engraveAndCutArtwork: 2 },
        true,
      ),
    ).toBe(
      'Cuts already run last. 2 artworks both engrave and cut, so their cuts run right after their own engraving.',
    );
  });
});

function importArtworks(...ids: ReadonlyArray<string>): void {
  const colors = ['#ff0000', '#00ff00', '#0000ff'];
  ids.forEach((id, index) =>
    useStore.getState().importSvgObject(svgObj(id, [colors[index] ?? '#000000'])),
  );
  const scene = useStore.getState().project.scene;
  expect(scene.objects.map((object) => operationIdsForObject(object, scene.layers))).toEqual(
    scene.layers.map((layer) => [layer.id]),
  );
}

function layers(): ReadonlyArray<Layer> {
  return useStore.getState().project.scene.layers;
}

function layerId(index: number): string {
  const layer = layers()[index];
  if (layer === undefined) throw new Error(`operation ${index} missing`);
  return layer.id;
}

function parkOutput(index: number, parkedOutput: boolean): void {
  const project = useStore.getState().project;
  useStore.setState({
    project: {
      ...project,
      scene: {
        ...project.scene,
        layers: project.scene.layers.map((layer, current) =>
          current === index ? { ...layer, parkedOutput } : layer,
        ),
      },
    },
  });
}

function addRegistrationJig(output: boolean): void {
  const project = useStore.getState().project;
  useStore.setState({
    project: {
      ...project,
      scene: {
        ...project.scene,
        layers: [...project.scene.layers, { ...createRegistrationLayer(), output }],
      },
    },
  });
}

function lastToast(): { readonly message: string; readonly variant: string } | undefined {
  const toast = useToastStore.getState().toasts.at(-1);
  return toast === undefined ? undefined : { message: toast.message, variant: toast.variant };
}

function effectiveSteps(project: Project): ReadonlyMap<string, ReadonlyArray<number>> {
  return new Map(
    artworkRunOrderRows(project).flatMap((row) =>
      row.objectIds.map((id) => [id, row.effectiveSteps] as const),
    ),
  );
}

// Strong cut first, then an engraving, an engrave-and-cut artwork and a weak cut.
function engraveAndCutProject(): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      objects: [
        rectangle('strong-art', ['cut-strong'], 0),
        rectangle('engrave-art', ['engrave'], 20),
        rectangle('mixed-art', ['engrave-2', 'cut-mixed'], 40),
        rectangle('weak-art', ['cut-weak'], 60),
      ],
      layers: [
        operation('cut-strong', 'line', 80),
        operation('cut-weak', 'line', 20),
        operation('engrave', 'fill', 40),
        operation('cut-mixed', 'line', 50),
        operation('engrave-2', 'fill', 40),
      ],
      artworkOrder: ['strong-art', 'engrave-art', 'mixed-art', 'weak-art'],
    },
  };
}

function operation(id: string, mode: LayerMode, power: number): Layer {
  return { ...createLayer({ id, name: id, color: '#000000', mode }), power, hatchSpacingMm: 1 };
}

function rectangle(id: string, operationIds: ReadonlyArray<string>, x: number): SceneObject {
  return {
    ...createRectangle({
      id,
      color: '#000000',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    }),
    operationIds,
    transform: { ...IDENTITY_TRANSFORM, x, y: 10 },
  };
}
