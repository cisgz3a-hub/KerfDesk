import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, DEFAULT_CNC_LAYER_SETTINGS, IDENTITY_TRANSFORM } from '../../core/scene';
import { setActiveEdition } from '../licensing/edition';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const copyActions = [
  { name: 'Offset', run: () => useStore.getState().offsetSelection(1) },
  { name: 'Rubber-Band Outline', run: () => useStore.getState().addRubberBandOutline() },
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
    if (name === 'Rubber-Band Outline') expect(result).toBe(false);
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
    if (name === 'Rubber-Band Outline') expect(result).toBe(true);
  });
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
