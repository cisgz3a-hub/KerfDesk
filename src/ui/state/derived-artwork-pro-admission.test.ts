import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, DEFAULT_CNC_LAYER_SETTINGS, IDENTITY_TRANSFORM } from '../../core/scene';
import { setActiveEdition } from '../licensing/edition';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { dependentText } from './testing/scene-clipboard-fixtures';
import { useToastStore } from './toast-store';

const offsetRequest = {
  distanceMm: 1,
  direction: 'outward' as const,
  cornerStyle: 'corner' as const,
  outerShapesOnly: false,
  deleteOriginals: false,
};

const copyActions = [
  { name: 'Offset', run: () => useStore.getState().offsetSelection(1) },
  { name: 'Rubber-Band Outline', run: () => useStore.getState().addRubberBandOutline() },
  {
    name: 'Offset Shapes dialog',
    run: () => useStore.getState().offsetShapesSelection(offsetRequest),
  },
] as const;

function edition(pro = false) {
  const request = vi.fn((_feature: string, _allowed?: () => void) => false);
  setActiveEdition({
    status: null,
    licensed: true,
    pro,
    requestPro: request,
    openLicence: vi.fn(),
  });
  return request;
}

function load(proOperation = true) {
  useStore.getState().setMachineKind('cnc');
  const layer = createLayer({ id: 'source-operation', color: '#000000' });
  const operation = proOperation
    ? { ...layer, cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' as const } }
    : layer;
  const object = {
    kind: 'imported-svg' as const,
    id: 'source',
    source: 'rectangle.svg',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    operationIds: [operation.id],
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
              { x: 20, y: 20 },
              { x: 0, y: 20 },
              { x: 0, y: 0 },
            ],
          },
        ],
      },
    ],
  };
  useStore.setState({
    project: {
      ...useStore.getState().project,
      scene: { objects: [object], layers: [operation], groups: [], artworkOrder: [object.id] },
    },
    selectedObjectId: object.id,
    additionalSelectedIds: new Set(),
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
  return useStore.getState().project;
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});
afterEach(() => setActiveEdition(null));

describe.each(copyActions)('$name Pro operation admission', ({ name, run }) => {
  it('holds a new V-carve copy in Free without changing the document or claiming success', () => {
    const request = edition();
    const before = load();
    const result = run();
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState()).toMatchObject({
      selectedObjectId: 'source',
      dirty: false,
      undoStack: [],
      redoStack: [],
    });
    expect(request).toHaveBeenCalledWith('vcarve', expect.any(Function));
    expect(useToastStore.getState().toasts.some((toast) => toast.variant === 'success')).toBe(
      false,
    );
    if (name !== 'Offset') expect(result).toBe(false);
  });

  it('allows the same derived Pro copy after unlocking, only once', () => {
    const request = edition();
    const before = load();
    run();
    expect(useStore.getState().project).toBe(before);
    const allow = request.mock.calls[0]?.[1];
    expect(allow).toBeTypeOf('function');
    edition(true);
    allow?.();
    const after = useStore.getState().project;
    expect(after.scene.objects).toHaveLength(2);
    expect(after.scene.objects[0]).toBe(before.scene.objects[0]);
    expect(after.scene.layers).toHaveLength(2);
    expect(after.scene.layers[1]?.cnc?.cutType).toBe('v-carve');
    expect(after.scene.layers[1]?.id).not.toBe(before.scene.layers[0]?.id);
    expect(useStore.getState().undoStack).toEqual([before]);
    allow?.();
    expect(useStore.getState().project).toBe(after);
  });

  it.each(['project', 'epoch'] as const)(
    'discards a deferred copy after the %s changes',
    (changed) => {
      const request = edition();
      load();
      run();
      const allow = request.mock.calls[0]?.[1];
      expect(allow).toBeTypeOf('function');
      if (changed === 'project')
        useStore.setState({
          project: { ...useStore.getState().project, notes: 'Changed while prompt was open' },
        });
      else useStore.setState({ projectDocumentEpoch: 1 });
      const beforeUnlock = useStore.getState().project;
      edition(true);
      allow?.();
      expect(useStore.getState().project).toBe(beforeUnlock);
      expect(useStore.getState().project.scene.objects).toHaveLength(1);
    },
  );

  it('keeps ordinary outlines available in Free', () => {
    const request = edition();
    load(false);
    run();
    expect(useStore.getState().project.scene.objects).toHaveLength(2);
    expect(request).not.toHaveBeenCalled();
  });

  it('lets Pro create an independent V-carve copy immediately', () => {
    const request = edition(true);
    load();
    const result = run();
    expect(useStore.getState().project.scene.objects).toHaveLength(2);
    expect(useStore.getState().project.scene.layers[1]?.cnc?.cutType).toBe('v-carve');
    expect(request).not.toHaveBeenCalled();
    if (name !== 'Offset') expect(result).toBe(true);
  });
});

it.each([false, true])(
  'reports offset dependency changes only after immediate admission (Pro=%s)',
  (pro) => {
    const request = edition(pro);
    const project = load();
    const text = dependentText('dependent-text', 'source');
    useStore.setState({
      project: {
        ...project,
        scene: { ...project.scene, objects: [...project.scene.objects, text] },
      },
    });
    const before = useStore.getState().project;
    const applied = useStore.getState().offsetShapesSelection({
      ...offsetRequest,
      direction: 'both',
      distanceMm: 1,
      deleteOriginals: true,
    });
    expect(applied).toBe(pro);
    if (pro) {
      expect(useToastStore.getState().toasts.map((toast) => toast.variant)).toEqual(['warning']);
      expect(
        useStore.getState().project.scene.objects.find((object) => object.id === text.id),
      ).not.toHaveProperty('pathText');
    } else {
      expect(useStore.getState().project).toBe(before);
      expect(useToastStore.getState().toasts).toEqual([]);
      edition(true);
      request.mock.calls[0]?.[1]?.();
      expect(
        useStore.getState().project.scene.objects.find((object) => object.id === text.id),
      ).not.toHaveProperty('pathText');
      expect(useStore.getState().undoStack).toEqual([before]);
    }
  },
);

it.each([
  { direction: 'outward' as const, distanceMm: 1 },
  { direction: 'inward' as const, distanceMm: 1 },
  { direction: 'both' as const, distanceMm: 21 },
])('keeps a single $direction replacement of existing V-carve work editable in Free', (options) => {
  const request = edition();
  const before = load();
  expect(
    useStore
      .getState()
      .offsetShapesSelection({ ...offsetRequest, ...options, deleteOriginals: true }),
  ).toBe(true);
  const after = useStore.getState();
  expect(request).not.toHaveBeenCalled();
  expect(after.project.scene.objects).toHaveLength(1);
  expect(after.project.scene.objects[0]?.id).not.toBe('source');
  expect(after.project.scene.layers).toHaveLength(1);
  expect(after.project.scene.layers[0]?.cnc?.cutType).toBe('v-carve');
  expect(after.undoStack).toEqual([before]);
  after.undo();
  expect(useStore.getState().project).toBe(before);
});

it('does not mistake a collapsed retained-source offset for an existing-work replacement', () => {
  const request = edition();
  const before = load();
  expect(
    useStore
      .getState()
      .offsetShapesSelection({ ...offsetRequest, direction: 'both', distanceMm: 21 }),
  ).toBe(false);
  expect(useStore.getState().project).toBe(before);
  expect(request).toHaveBeenCalledWith('vcarve', expect.any(Function));
  expect(useToastStore.getState().toasts).toEqual([]);
});

it('reports committed collapsed replacement and dependency changes in Free', () => {
  const request = edition();
  const project = load();
  const text = dependentText('dependent-text', 'source');
  useStore.setState({
    project: { ...project, scene: { ...project.scene, objects: [...project.scene.objects, text] } },
  });
  expect(
    useStore
      .getState()
      .offsetShapesSelection({
        ...offsetRequest,
        direction: 'both',
        distanceMm: 21,
        deleteOriginals: true,
      }),
  ).toBe(true);
  expect(request).not.toHaveBeenCalled();
  expect(
    useStore.getState().project.scene.objects.find((object) => object.id === text.id),
  ).not.toHaveProperty('pathText');
  expect(useToastStore.getState().toasts.map((toast) => toast.variant)).toEqual([
    'info',
    'warning',
  ]);
});

it('keeps existing desktop V-carve operation edits available in Free', () => {
  const request = edition();
  load();
  useStore.getState().setLayerParam('source-operation', {
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve', depthMm: 3 },
  });
  expect(useStore.getState().project.scene.layers[0]?.cnc?.depthMm).toBe(3);
  expect(request).not.toHaveBeenCalled();
});
