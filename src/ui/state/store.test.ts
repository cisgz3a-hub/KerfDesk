import { beforeEach, describe, expect, it } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  operationIdsForObject,
  PROJECT_SCHEMA_VERSION,
  type ImportedSvg,
  type RasterImage,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore as reset, svgObj as svgObjFromHelpers } from './test-helpers';

// Re-export under the original local names so the (large) body of this
// file doesn't have to change. Pure rename, no behaviour change.
const svgObj: (id: string, colors: ReadonlyArray<string>) => ImportedSvg = svgObjFromHelpers;

function rasterObj(id: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 1,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'grayscale',
    linesPerMm: 10,
    lumaBase64: 'gA==',
  };
}

function operationIdsFor(objectId: string): ReadonlyArray<string> {
  const { objects, layers } = useStore.getState().project.scene;
  const object = objects.find((candidate) => candidate.id === objectId);
  return object === undefined ? [] : operationIdsForObject(object, layers);
}

describe('useStore', () => {
  beforeEach(() => {
    reset();
  });

  it('starts with a default-shaped Project and no selection', () => {
    const s = useStore.getState();
    expect(s.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(s.project.scene.objects).toHaveLength(0);
    expect(s.project.scene.layers).toHaveLength(0);
    expect(s.selectedObjectId).toBeNull();
  });

  it('importSvgObject returns { kind: "added" } for a fresh import', () => {
    const outcome = useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    expect(outcome.kind).toBe('added');
  });

  it('importSvgObject creates path operations with automatic presentation colors', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000', '#0000ff']));
    const { scene } = useStore.getState().project;
    expect(scene.objects).toHaveLength(1);
    expect(scene.layers.map((operation) => operation.color)).toEqual(['#2563eb', '#dc2626']);
    expect(operationIdsFor('O1')).toEqual(scene.layers.map((operation) => operation.id));
  });

  it('importSvgObject auto-selects the new object (F-A3 step 5)', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    expect(useStore.getState().selectedObjectId).toBe('O1');
  });

  it('multi-import staggers subsequent objects by 10mm per batch index', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']), 0);
    useStore.getState().importSvgObject(svgObj('O2', ['#0000ff']), 1);
    useStore.getState().importSvgObject(svgObj('O3', ['#00ff00']), 2);
    const [a, b, c] = useStore.getState().project.scene.objects;
    if (a === undefined || b === undefined || c === undefined)
      throw new Error('expected 3 objects');
    expect(b.transform.x - a.transform.x).toBeCloseTo(10);
    expect(b.transform.y - a.transform.y).toBeCloseTo(10);
    expect(c.transform.x - a.transform.x).toBeCloseTo(20);
    expect(c.transform.y - a.transform.y).toBeCloseTo(20);
  });

  it('keeps operations independent when a second artwork reuses a source color', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#ff0000', '#0000ff']));
    const { scene } = useStore.getState().project;
    expect(scene.objects).toHaveLength(2);
    expect(scene.layers).toHaveLength(3);
    expect(new Set(operationIdsFor('O1'))).not.toEqual(new Set(operationIdsFor('O2')));
  });

  it('removeSceneObject deletes the object and clears matching selection', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().selectObject('O1');
    useStore.getState().removeSceneObject('O1');
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(useStore.getState().selectedObjectId).toBeNull();
  });

  it('removeSceneObject prunes orphan layers — last consumer of a color leaves no row behind', () => {
    // Phase E.1 fix: deleting the only object using a color should
    // also drop the auto-created layer for that color. Before this
    // fix the Cuts/Layers panel kept stale rows with the previous
    // power/speed/passes for the deleted object's color.
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000', '#0000ff']));
    expect(useStore.getState().project.scene.layers).toHaveLength(2);
    useStore.getState().removeSceneObject('O1');
    expect(useStore.getState().project.scene.layers).toHaveLength(0);
  });

  it('removeSceneObject keeps every operation owned by the remaining artwork', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#ff0000', '#00ff00']));
    const remainingOperationIds = operationIdsFor('O2');
    expect(useStore.getState().project.scene.layers).toHaveLength(3);
    useStore.getState().removeSceneObject('O1');
    expect(useStore.getState().project.scene.layers.map((operation) => operation.id)).toEqual(
      remainingOperationIds,
    );
  });

  // duplicateSelection tests live in duplicate.test.ts.

  it('setLayerParam patches the matching layer', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const [operationId] = operationIdsFor('O1');
    if (operationId === undefined) throw new Error('operation missing');
    useStore.getState().setLayerParam(operationId, { power: 75 });
    expect(useStore.getState().project.scene.layers[0]?.power).toBe(75);
  });

  it('moveLayer updates layer order and is undoable', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000', '#0000ff', '#00ff00']));
    const operationIds = operationIdsFor('O1');
    const [first, second, third] = operationIds;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('expected three operations');
    }
    useStore.setState({ dirty: false });

    useStore.getState().moveLayer(third, 'up');

    expect(useStore.getState().project.scene.layers.map((layer) => layer.id)).toEqual([
      first,
      third,
      second,
    ]);
    expect(useStore.getState().dirty).toBe(true);
    expect(useStore.getState().undoStack).toHaveLength(2);

    useStore.getState().undo();
    expect(useStore.getState().project.scene.layers.map((layer) => layer.id)).toEqual(operationIds);
  });

  it('setRasterImageAdjustments patches a raster image and pushes undo', () => {
    useStore.getState().importRasterImage(rasterObj('R1'));
    const undoBefore = useStore.getState().undoStack.length;

    useStore
      .getState()
      .setRasterImageAdjustments('R1', { brightness: 20, contrast: -10, gamma: 1.4 });

    const raster = useStore.getState().project.scene.objects.find((o) => o.id === 'R1');
    expect(raster).toMatchObject({
      kind: 'raster-image',
      brightness: 20,
      contrast: -10,
      gamma: 1.4,
    });
    expect(useStore.getState().undoStack).toHaveLength(undoBefore + 1);
    expect(useStore.getState().dirty).toBe(true);
  });

  it('newProject resets state', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().setJobPlacement({ startFrom: 'current-position', anchor: 'center' });
    useStore.getState().selectObject('O1');
    useStore
      .getState()
      .selectPathNode({ objectId: 'O1', pathIndex: 0, polylineIndex: 0, pointIndex: 0 });
    useStore
      .getState()
      .selectPathNode(
        { objectId: 'O1', pathIndex: 0, polylineIndex: 0, pointIndex: 1 },
        { additive: true },
      );
    useStore.getState().newProject();
    const s = useStore.getState();
    expect(s.project.scene.objects).toHaveLength(0);
    expect(s.selectedObjectId).toBeNull();
    expect(s.selectedPathNode).toBeNull();
    expect(s.selectedPathNodes).toEqual([]);
    expect(s.jobPlacement).toEqual({ startFrom: 'user-origin', anchor: 'front-left' });
  });

  it('newProject preserves the configured machine profile (DEV-01 / F-A13)', () => {
    // A user who configured a rear-left 300x200 machine must not silently
    // revert to the Default 400x400 profile on File -> New — that would emit
    // Y-mirrored G-code against the wrong bed with no warning.
    const base = useStore.getState().project.device;
    const custom = { ...base, bedWidth: 300, bedHeight: 200, origin: 'rear-left' as const };
    useStore.setState({ project: createProject(custom) });
    // sanity: the custom bed drove the workspace
    expect(useStore.getState().project.workspace).toEqual({ width: 300, height: 200, units: 'mm' });

    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().newProject();

    const s = useStore.getState();
    expect(s.project.scene.objects).toHaveLength(0); // scene still clears
    expect(s.project.device).toEqual(custom); // device PRESERVED, not reset to default
    expect(s.project.workspace).toEqual({ width: 300, height: 200, units: 'mm' });
  });

  it('setJobPlacement updates the start mode and anchor without marking the project dirty', () => {
    useStore.setState({ dirty: false });

    useStore.getState().setJobPlacement({ startFrom: 'user-origin', anchor: 'center' });

    expect(useStore.getState().jobPlacement).toEqual({
      startFrom: 'user-origin',
      anchor: 'center',
    });
    expect(useStore.getState().dirty).toBe(false);
  });
});

describe('useStore — SVG re-import (Phase C #7)', () => {
  beforeEach(() => {
    reset();
  });

  it('returns { kind: "replaced" } when an object with the same source already exists', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000', '#0000ff']));
    const replacement: ImportedSvg = { ...svgObj('NEW-id', ['#ff0000']), source: 'O1.svg' };
    const outcome = useStore.getState().importSvgObject(replacement);
    expect(outcome.kind).toBe('replaced');
    if (outcome.kind === 'replaced') {
      expect(outcome.source).toBe('O1.svg');
      expect(outcome.kept).toBe(1); // red survived
      expect(outcome.removed).toBe(1); // blue dropped
      expect(outcome.added).toBe(0); // nothing new
    }
  });

  it('re-import preserves the existing object id (so selection / refs stay valid)', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const original = useStore.getState().project.scene.objects[0];
    const replacement: ImportedSvg = { ...svgObj('different-id', ['#ff0000']), source: 'O1.svg' };
    useStore.getState().importSvgObject(replacement);
    const after = useStore.getState().project.scene.objects[0];
    expect(after?.id).toBe(original?.id);
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
  });

  it('re-import preserves the existing object transform (user-chosen position survives)', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    // Simulate the user dragging the object to (123, 45):
    const orig = useStore.getState().project.scene.objects[0];
    if (orig === undefined) throw new Error('expected object');
    useStore.getState().setObjectTransform(orig.id, { ...orig.transform, x: 123, y: 45 });
    const replacement: ImportedSvg = { ...svgObj('new', ['#ff0000']), source: 'O1.svg' };
    useStore.getState().importSvgObject(replacement);
    const after = useStore.getState().project.scene.objects[0];
    expect(after?.transform.x).toBe(123);
    expect(after?.transform.y).toBe(45);
  });

  it('re-import preserves layer settings for surviving colors', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const [operationId] = operationIdsFor('O1');
    if (operationId === undefined) throw new Error('operation missing');
    useStore.getState().setLayerParam(operationId, { power: 85, speed: 1234, passes: 3 });
    const replacement: ImportedSvg = { ...svgObj('new', ['#ff0000']), source: 'O1.svg' };
    useStore.getState().importSvgObject(replacement);
    const operation = useStore
      .getState()
      .project.scene.layers.find((candidate) => candidate.id === operationId);
    expect(operation?.power).toBe(85);
    expect(operation?.speed).toBe(1234);
    expect(operation?.passes).toBe(3);
  });

  it('re-import adds layers for genuinely new colors', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const [existingOperationId] = operationIdsFor('O1');
    const replacement: ImportedSvg = {
      ...svgObj('new', ['#ff0000', '#00ff00']),
      source: 'O1.svg',
    };
    const outcome = useStore.getState().importSvgObject(replacement);
    const operationIds = operationIdsFor('O1');
    expect(operationIds).toHaveLength(2);
    expect(operationIds).toContain(existingOperationId);
    expect(useStore.getState().project.scene.layers).toHaveLength(2);
    if (outcome.kind === 'replaced') {
      expect(outcome.added).toBe(1);
      expect(outcome.kept).toBe(1);
    }
  });

  it('different sources still add as new (no false re-import)', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const outcome = useStore.getState().importSvgObject(svgObj('O2', ['#0000ff'])); // different source ('O2.svg')
    expect(outcome.kind).toBe('added');
    expect(useStore.getState().project.scene.objects).toHaveLength(2);
  });
});

describe('useStore — dirty / save tracking (F-A11)', () => {
  beforeEach(() => {
    reset();
  });

  it('starts clean with no savedName', () => {
    const s = useStore.getState();
    expect(s.dirty).toBe(false);
    expect(s.savedName).toBeNull();
    expect(s.lastSaveTarget).toBeNull();
  });

  it('importSvgObject flips dirty to true', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    expect(useStore.getState().dirty).toBe(true);
  });

  it('setLayerParam flips dirty', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.setState({ dirty: false });
    useStore.getState().setLayerParam('#ff0000', { power: 60 });
    expect(useStore.getState().dirty).toBe(true);
  });

  it('markSaved clears dirty and remembers the SaveTarget', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const target = {
      displayName: 'my-job.lf2',
      write: async () => {
        /* test stub — no-op */
      },
    };
    useStore.getState().markSaved(target);
    const s = useStore.getState();
    expect(s.dirty).toBe(false);
    expect(s.savedName).toBe('my-job.lf2');
    expect(s.lastSaveTarget).toBe(target);
  });

  it('markLoaded sets savedName and clears dirty + target', () => {
    useStore.getState().markLoaded('logo.lf2');
    const s = useStore.getState();
    expect(s.savedName).toBe('logo.lf2');
    expect(s.dirty).toBe(false);
    expect(s.lastSaveTarget).toBeNull();
  });

  it('newProject clears save tracking', () => {
    useStore.getState().markSaved({
      displayName: 'old.lf2',
      write: async () => {
        /* test stub — no-op */
      },
    });
    useStore.getState().newProject();
    const s = useStore.getState();
    expect(s.savedName).toBeNull();
    expect(s.lastSaveTarget).toBeNull();
    expect(s.dirty).toBe(false);
  });
});

describe('useStore — undo / redo (F-A14)', () => {
  beforeEach(() => {
    reset();
  });

  it('importSvgObject pushes the prior project onto undoStack', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('undo restores the previous project', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#0000ff']));
    expect(useStore.getState().project.scene.objects).toHaveLength(2);
    useStore.getState().undo();
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
    expect(useStore.getState().project.scene.objects[0]?.id).toBe('O1');
  });

  it('undo drops stale multi-selection ids but keeps the still-present primary (CNV-13)', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#0000ff']));
    useStore.setState({ selectedObjectId: 'O1', additionalSelectedIds: new Set(['O2']) });

    // Undo removes O2; O1 survives in the restored scene, so it stays selected
    // while the now-stale O2 id is dropped.
    useStore.getState().undo();

    expect(useStore.getState().selectedObjectId).toBe('O1');
    expect(useStore.getState().additionalSelectedIds.size).toBe(0);
  });

  it('redo replays an undone action', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().undo();
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    useStore.getState().redo();
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
  });

  it('redo clears stale multi-selection ids along with the primary selection', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().undo();
    useStore.setState({
      selectedObjectId: 'ghost',
      additionalSelectedIds: new Set(['also-ghost']),
    });

    useStore.getState().redo();

    expect(useStore.getState().selectedObjectId).toBeNull();
    expect(useStore.getState().additionalSelectedIds.size).toBe(0);
  });

  it('a new mutation after undo clears the redo stack', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().undo();
    useStore.getState().importSvgObject(svgObj('O2', ['#0000ff']));
    expect(useStore.getState().redoStack).toHaveLength(0);
  });

  it('undo on empty history is a no-op', () => {
    const before = useStore.getState().project;
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  });
});

describe('useStore — preview toggle (F-A8)', () => {
  beforeEach(() => {
    reset();
  });

  it('togglePreview flips the previewMode flag', () => {
    expect(useStore.getState().previewMode).toBe(false);
    useStore.getState().togglePreview();
    expect(useStore.getState().previewMode).toBe(true);
    useStore.getState().togglePreview();
    expect(useStore.getState().previewMode).toBe(false);
  });
});
