import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  IDENTITY_TRANSFORM,
  operationIdsForObject,
  type CncCutType,
  type ImportedSvg,
} from '../../core/scene';
import { setActiveEdition } from '../licensing/edition';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';
import { dependentText } from './testing/scene-clipboard-fixtures';
import { recordUndoStepName, undoStepName, withUndoStepName } from './undo-step-names';

const actions = [
  { name: 'Break Apart', run: () => useStore.getState().breakApartSelection() },
  { name: 'Cut Shapes', run: () => useStore.getState().cutSelectedShapes() },
] as const;
const features = [
  { cutType: 'v-carve', feature: 'vcarve' },
  { cutType: 'relief-rough', feature: 'relief' },
  { cutType: 'pocket', feature: 'adaptive-clearing' },
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

function square(x: number, y: number, size: number) {
  return {
    color: '#000000',
    polylines: [
      {
        closed: true,
        points: [
          { x, y },
          { x: x + size, y },
          { x: x + size, y: y + size },
          { x, y: y + size },
        ],
      },
    ],
  };
}

function load(action: (typeof actions)[number]['name'], cutType?: CncCutType) {
  useStore.getState().setMachineKind('cnc');
  const layer = createLayer({ id: 'source-operation', color: '#000000' });
  const operation =
    cutType === undefined
      ? layer
      : {
          ...layer,
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType, pocketStrategy: 'adaptive' as const },
        };
  const source: ImportedSvg = {
    kind: 'imported-svg',
    id: 'source',
    source: 'source.svg',
    bounds: { minX: 0, minY: 0, maxX: 30, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    operationIds: [operation.id],
    paths: action === 'Break Apart' ? [square(0, 0, 10), square(20, 0, 10)] : [square(0, 0, 20)],
  };
  const cutter: ImportedSvg = {
    ...source,
    id: 'cutter',
    source: 'cutter.svg',
    operationIds: ['cutter-operation'],
    paths: [square(10, 10, 20)],
  };
  const objects = action === 'Break Apart' ? [source] : [source, cutter];
  const layers =
    action === 'Break Apart'
      ? [operation]
      : [operation, createLayer({ id: 'cutter-operation', color: '#ff0000' })];
  useStore.setState({
    project: {
      ...useStore.getState().project,
      scene: { objects, layers, groups: [], artworkOrder: objects.map((object) => object.id) },
    },
    selectedObjectId: source.id,
    additionalSelectedIds: new Set(action === 'Break Apart' ? [] : [cutter.id]),
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

describe.each(actions)('$name independent Pro artwork admission', ({ name, run }) => {
  it.each(features)('holds new $feature artwork in Free', ({ cutType, feature }) => {
    const request = edition();
    const before = load(name, cutType);
    const result = run();
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState()).toMatchObject({ dirty: false, undoStack: [], redoStack: [] });
    expect(request).toHaveBeenCalledExactlyOnceWith(feature, expect.any(Function));
    expect(useToastStore.getState().toasts).toEqual([]);
    if (name === 'Cut Shapes') expect(result).toBe(false);
  });

  it.each(features)('commits $feature artwork once after unlocking', ({ cutType, feature }) => {
    const request = edition();
    const before = load(name, cutType);
    run();
    expect(request).toHaveBeenCalledExactlyOnceWith(feature, expect.any(Function));
    expect(useStore.getState().project).toBe(before);
    const allow = request.mock.calls[0]?.[1];
    edition(true);
    allow?.();
    const after = useStore.getState().project;
    expect(after.scene.objects).toHaveLength(2);
    expect(after.scene.objects.every((object) => object.id !== 'source')).toBe(true);
    expect(
      after.scene.objects.map((object) => operationIdsForObject(object, after.scene.layers)),
    ).toEqual([['source-operation'], ['source-operation']]);
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(useStore.getState().dirty).toBe(true);
    const messages = useToastStore.getState().toasts;
    if (name === 'Cut Shapes') expect(messages.map((toast) => toast.variant)).toEqual(['success']);
    allow?.();
    expect(useStore.getState().project).toBe(after);
    expect(useToastStore.getState().toasts).toBe(messages);
  });

  it.each(['project', 'epoch'] as const)(
    'discards a deferred split after the %s changes',
    (changed) => {
      const request = edition();
      load(name, 'v-carve');
      run();
      const allow = request.mock.calls[0]?.[1];
      expect(allow).toBeTypeOf('function');
      if (changed === 'project')
        useStore.setState({
          project: { ...useStore.getState().project, notes: 'Changed while deciding' },
        });
      else useStore.setState({ projectDocumentEpoch: 1 });
      const current = useStore.getState().project;
      const history = useStore.getState().undoStack;
      edition(true);
      allow?.();
      expect(useStore.getState().project).toBe(current);
      expect(useStore.getState().undoStack).toBe(history);
      expect(useToastStore.getState().toasts).toEqual([]);
    },
  );

  it('cannot replay a consumed approval after Undo restores the original project', () => {
    const request = edition();
    const before = load(name, 'v-carve');
    const epoch = useStore.getState().projectDocumentEpoch;
    run();
    const allow = request.mock.calls[0]?.[1];
    edition(true);
    allow?.();
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().projectDocumentEpoch).toBe(epoch);
    const restored = useStore.getState();
    const messages = useToastStore.getState().toasts;
    allow?.();
    expect(useStore.getState()).toBe(restored);
    expect(useToastStore.getState().toasts).toBe(messages);
  });

  it('keeps ordinary Free splits available', () => {
    const request = edition();
    const before = load(name);
    const result = run();
    expect(useStore.getState().project.scene.objects).toHaveLength(2);
    expect(request).not.toHaveBeenCalled();
    expect(useStore.getState().undoStack).toEqual([before]);
    if (name === 'Cut Shapes') expect(result).toBe(true);
  });

  it('keeps the existing undo label until the admitted split commits', () => {
    const request = edition();
    const before = load(name, 'v-carve');
    recordUndoStepName(before, 'Existing redo step');
    withUndoStepName(name, run);
    expect(undoStepName(before, before)).toBe('Existing redo step');
    edition(true);
    request.mock.calls[0]?.[1]?.();
    expect(undoStepName(before, useStore.getState().project)).toBe(name);
  });

  it('reports dependency repair only after the split commits', () => {
    const request = edition();
    const project = load(name, 'v-carve');
    const text = dependentText('dependent-text', 'source');
    useStore.setState({
      project: {
        ...project,
        scene: { ...project.scene, objects: [...project.scene.objects, text] },
      },
    });
    const before = useStore.getState().project;
    run();
    expect(useStore.getState().project).toBe(before);
    expect(useToastStore.getState().toasts).toEqual([]);
    edition(true);
    request.mock.calls[0]?.[1]?.();
    const after = useStore.getState().project;
    expect(after.scene.objects.find((object) => object.id === text.id)).not.toHaveProperty(
      'pathText',
    );
    const messages = useToastStore.getState().toasts;
    expect(messages.map((toast) => toast.variant)).toEqual(
      name === 'Cut Shapes' ? ['warning', 'success'] : ['warning'],
    );
    request.mock.calls[0]?.[1]?.();
    expect(useToastStore.getState().toasts).toBe(messages);
  });

  it('lets Pro split immediately and preserves undo and redo after returning to Free', () => {
    const request = edition(true);
    const before = load(name, 'v-carve');
    const result = run();
    const after = useStore.getState().project;
    expect(after.scene.objects).toHaveLength(2);
    expect(request).not.toHaveBeenCalled();
    if (name === 'Cut Shapes') expect(result).toBe(true);
    const free = edition();
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
    useStore.getState().redo();
    expect(useStore.getState().project).toBe(after);
    useStore.getState().setLayerParam('source-operation', {
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve', depthMm: 3 },
    });
    expect(useStore.getState().project.scene.layers[0]?.cnc?.depthMm).toBe(3);
    expect(free).not.toHaveBeenCalled();
  });
});
