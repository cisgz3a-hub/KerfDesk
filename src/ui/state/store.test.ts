import { beforeEach, describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ImportedSvg, type RasterImage } from '../../core/scene';
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

describe('useStore', () => {
  beforeEach(() => {
    reset();
  });

  it('starts with a default-shaped Project and no selection', () => {
    const s = useStore.getState();
    expect(s.project.schemaVersion).toBe(1);
    expect(s.project.scene.objects).toHaveLength(0);
    expect(s.project.scene.layers).toHaveLength(0);
    expect(s.selectedObjectId).toBeNull();
  });

  it('importSvgObject returns { kind: "added" } for a fresh import', () => {
    const outcome = useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    expect(outcome.kind).toBe('added');
  });

  it('importSvgObject adds the object and auto-creates layers per unique color', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000', '#0000ff']));
    const { scene } = useStore.getState().project;
    expect(scene.objects).toHaveLength(1);
    expect(scene.layers.map((l) => l.color)).toEqual(['#ff0000', '#0000ff']);
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

  it("doesn't double-create a layer when a second object reuses a color", () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#ff0000', '#0000ff']));
    const { scene } = useStore.getState().project;
    expect(scene.objects).toHaveLength(2);
    expect(scene.layers).toHaveLength(2); // red + blue, not three rows
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

  it('removeSceneObject keeps layers still used by other objects', () => {
    // Two objects share '#ff0000'. Deleting one must NOT drop the
    // red layer; the other object still uses it.
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#ff0000', '#00ff00']));
    expect(useStore.getState().project.scene.layers).toHaveLength(2);
    useStore.getState().removeSceneObject('O1');
    const layerColors = useStore
      .getState()
      .project.scene.layers.map((l) => l.color)
      .sort();
    // Red stays (O2 uses it), green stays (O2 uses it). Two layers total.
    expect(layerColors).toEqual(['#00ff00', '#ff0000']);
  });

  // duplicateSelection tests live in duplicate.test.ts.

  it('setLayerParam patches the matching layer', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().setLayerParam('#ff0000', { power: 75 });
    expect(useStore.getState().project.scene.layers[0]?.power).toBe(75);
  });

  it('moveLayer updates layer order and is undoable', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000', '#0000ff', '#00ff00']));
    useStore.setState({ dirty: false });

    useStore.getState().moveLayer('#00ff00', 'up');

    expect(useStore.getState().project.scene.layers.map((layer) => layer.id)).toEqual([
      '#ff0000',
      '#00ff00',
      '#0000ff',
    ]);
    expect(useStore.getState().dirty).toBe(true);
    expect(useStore.getState().undoStack).toHaveLength(2);

    useStore.getState().undo();
    expect(useStore.getState().project.scene.layers.map((layer) => layer.id)).toEqual([
      '#ff0000',
      '#0000ff',
      '#00ff00',
    ]);
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
    expect(s.jobPlacement).toEqual({ startFrom: 'absolute', anchor: 'front-left' });
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
    useStore.getState().setLayerParam('#ff0000', { power: 85, speed: 1234, passes: 3 });
    const replacement: ImportedSvg = { ...svgObj('new', ['#ff0000']), source: 'O1.svg' };
    useStore.getState().importSvgObject(replacement);
    const red = useStore.getState().project.scene.layers.find((l) => l.color === '#ff0000');
    expect(red?.power).toBe(85);
    expect(red?.speed).toBe(1234);
    expect(red?.passes).toBe(3);
  });

  it('re-import adds layers for genuinely new colors', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const replacement: ImportedSvg = {
      ...svgObj('new', ['#ff0000', '#00ff00']),
      source: 'O1.svg',
    };
    const outcome = useStore.getState().importSvgObject(replacement);
    expect(useStore.getState().project.scene.layers.map((l) => l.color)).toContain('#00ff00');
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

  it('undo clears stale multi-selection ids along with the primary selection', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#0000ff']));
    useStore.setState({ selectedObjectId: 'O1', additionalSelectedIds: new Set(['O2']) });

    useStore.getState().undo();

    expect(useStore.getState().selectedObjectId).toBeNull();
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
