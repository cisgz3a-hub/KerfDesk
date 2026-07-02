import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type Project,
  type RasterImage,
  type ReliefObject,
  type SceneObject,
  type ShapeObject,
  type TextObject,
  type TracedImage,
} from '../../core/scene';
import { useToastStore } from './toast-store';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

const BLACK_PATH: ColoredPath = {
  color: '#000000',
  polylines: [
    {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 3 },
      ],
    },
  ],
};

describe('scene clipboard actions', () => {
  beforeEach(() => resetStore());

  it('copies all selected SceneObject variants without dirtying the project', () => {
    useStore.setState({ project: projectWithVariants(), dirty: false, undoStack: [] });
    useStore.getState().selectAllObjects();
    const beforeProject = useStore.getState().project;

    useStore.getState().copySelection();

    const state = useStore.getState();
    expect(state.project).toBe(beforeProject);
    expect(state.dirty).toBe(false);
    expect(state.undoStack).toHaveLength(0);
    expect(state.sceneClipboard?.objects.map((object) => object.kind)).toEqual([
      'imported-svg',
      'text',
      'traced-image',
      'raster-image',
      'shape',
    ]);
  });

  it('pastes copied objects with fresh ids, offset transforms, selection, and layers', () => {
    useStore.setState({ project: projectWithVariants(), dirty: false, undoStack: [] });
    useStore.getState().selectAllObjects();
    useStore.getState().copySelection();
    useStore.setState({
      project: createProject(),
      selectedObjectId: null,
      additionalSelectedIds: new Set(),
      dirty: false,
      undoStack: [],
    });

    useStore.getState().pasteClipboard();

    const state = useStore.getState();
    const pasted = state.project.scene.objects;
    expect(pasted).toHaveLength(5);
    expect(pasted.map((object) => object.id)).not.toEqual([
      'svg-1',
      'text-1',
      'trace-1',
      'raster-1',
      'shape-1',
    ]);
    expect(pasted[0]?.transform).toMatchObject({ x: 10, y: 10 });
    expect(state.selectedObjectId).toBe(pasted[0]?.id);
    expect(state.additionalSelectedIds.size).toBe(4);
    expect(state.project.scene.layers.map((layer) => layer.color).sort()).toEqual([
      '#000000',
      '#123456',
      '#808080',
      '#ff0000',
    ]);
    expect(state.undoStack).toHaveLength(1);
    expect(state.dirty).toBe(true);
  });

  it('cut copies the selection, removes it as one undoable edit, and can paste it back', () => {
    useStore.setState({ project: projectWithVariants(), dirty: false, undoStack: [] });
    useStore.getState().selectObjects(['svg-1', 'raster-1']);

    useStore.getState().cutSelection();

    expect(useStore.getState().sceneClipboard?.objects.map((object) => object.id)).toEqual([
      'svg-1',
      'raster-1',
    ]);
    expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual([
      'text-1',
      'trace-1',
      'shape-1',
    ]);
    expect(useStore.getState().undoStack).toHaveLength(1);

    useStore.getState().pasteClipboard();

    const state = useStore.getState();
    expect(state.project.scene.objects).toHaveLength(5);
    expect(state.project.scene.layers.some((layer) => layer.color === '#808080')).toBe(true);
  });
});

describe('relief paste gate (CNC-only geometry)', () => {
  beforeEach(() => {
    resetStore();
    useToastStore.setState({ toasts: [] });
  });

  it('pastes reliefs normally in CNC mode', () => {
    useStore.setState({ project: cncProjectWithRelief() });
    useStore.getState().selectAllObjects();
    useStore.getState().copySelection();

    useStore.getState().pasteClipboard();

    expect(
      useStore.getState().project.scene.objects.filter((object) => object.kind === 'relief'),
    ).toHaveLength(2);
  });

  it('skips reliefs (with a toast) when pasting into a laser project, keeping the rest', () => {
    useStore.setState({ project: cncProjectWithRelief() });
    useStore.getState().selectAllObjects();
    useStore.getState().copySelection();
    useStore.getState().setMachineKind('laser');

    useStore.getState().pasteClipboard();

    const objects = useStore.getState().project.scene.objects;
    expect(objects.filter((object) => object.kind === 'relief')).toHaveLength(1); // the original only
    expect(objects.filter((object) => object.kind === 'imported-svg')).toHaveLength(2);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('CNC mode');
  });

  it('is a no-op when the clipboard holds only reliefs in laser mode', () => {
    useStore.setState({ project: cncProjectWithRelief() });
    useStore.getState().selectObject('relief-1');
    useStore.getState().copySelection();
    useStore.getState().setMachineKind('laser');
    const before = useStore.getState().project;

    useStore.getState().pasteClipboard();

    expect(useStore.getState().project).toBe(before);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('reliefs only paste');
  });
});

function cncProjectWithRelief(): Project {
  const base = createProject();
  const machine = { kind: 'cnc' as const };
  const project: Project = {
    ...base,
    scene: {
      objects: [
        { ...svgObj('svg-1', ['#ff0000']), transform: { ...IDENTITY_TRANSFORM, x: 0, y: 0 } },
        reliefTestObject(),
      ],
      layers: [
        createLayer({ id: '#ff0000', color: '#ff0000', mode: 'line' }),
        createLayer({ id: DEFAULT_RELIEF_LAYER_COLOR, color: DEFAULT_RELIEF_LAYER_COLOR }),
      ],
    },
  };
  // Route through the store action so the machine config is a real
  // CncMachineConfig (not a hand-built partial).
  useStore.setState({ project });
  useStore.getState().setMachineKind(machine.kind);
  return useStore.getState().project;
}

function reliefTestObject(): ReliefObject {
  return {
    kind: 'relief',
    id: 'relief-1',
    source: 'model.stl',
    meshPositions: [0, 0, 0, 10, 0, 0, 0, 10, 5],
    targetWidthMm: 100,
    reliefDepthMm: 5,
    emptyCells: 'floor',
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
  };
}

function projectWithVariants(): Project {
  const objects: ReadonlyArray<SceneObject> = [
    { ...svgObj('svg-1', ['#ff0000']), transform: { ...IDENTITY_TRANSFORM, x: 0, y: 0 } },
    textObject(),
    tracedObject(),
    rasterObject(),
    shapeObject(),
  ];
  const project = createProject();
  return {
    ...project,
    scene: {
      objects,
      layers: [
        createLayer({ id: '#ff0000', color: '#ff0000', mode: 'line' }),
        createLayer({ id: '#123456', color: '#123456', mode: 'line' }),
        createLayer({ id: '#000000', color: '#000000', mode: 'fill' }),
        createLayer({ id: '#808080', color: '#808080', mode: 'image' }),
      ],
    },
  };
}

function textObject(): TextObject {
  return {
    kind: 'text',
    id: 'text-1',
    content: 'Text',
    fontKey: 'Roboto',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1,
    letterSpacing: 0,
    color: '#123456',
    bounds: { minX: 0, minY: 0, maxX: 8, maxY: 4 },
    transform: { ...IDENTITY_TRANSFORM, x: 1, y: 1 },
    paths: [{ ...BLACK_PATH, color: '#123456' }],
  };
}

function tracedObject(): TracedImage {
  return {
    kind: 'traced-image',
    id: 'trace-1',
    source: 'trace.png',
    bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
    transform: { ...IDENTITY_TRANSFORM, x: 2, y: 2 },
    paths: [BLACK_PATH],
  };
}

function rasterObject(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'raster-1',
    source: 'raster.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
    transform: { ...IDENTITY_TRANSFORM, x: 3, y: 3 },
    color: '#808080',
    dither: 'grayscale',
    linesPerMm: 10,
    lumaBase64: 'gA==',
  };
}

function shapeObject(): ShapeObject {
  return {
    kind: 'shape',
    id: 'shape-1',
    spec: { kind: 'rect', widthMm: 5, heightMm: 5, cornerRadiusMm: 0 },
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
    transform: { ...IDENTITY_TRANSFORM, x: 4, y: 4 },
    paths: [BLACK_PATH],
  };
}
