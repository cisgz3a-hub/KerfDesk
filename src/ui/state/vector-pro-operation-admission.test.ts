import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  IDENTITY_TRANSFORM,
  operationIdsForObject,
  type ImportedSvg,
} from '../../core/scene';
import { setActiveEdition } from '../licensing/edition';
import { operationProFeature } from '../licensing/pro-operation-policy';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const proOperations = [
  { feature: 'vcarve', cnc: { cutType: 'v-carve' as const } },
  { feature: 'relief', cnc: { cutType: 'relief-rough' as const } },
  { feature: 'relief', cnc: { cutType: 'relief-finish' as const } },
  {
    feature: 'adaptive-clearing',
    cnc: { cutType: 'pocket' as const, pocketStrategy: 'adaptive' as const },
  },
] as const;
const independentActions = [
  ...(['subtract', 'intersect', 'exclude'] as const).map((operation) => ({
    name: operation,
    run: () => useStore.getState().booleanSelection(operation),
  })),
  { name: 'Weld with object power', run: () => useStore.getState().weldSelection() },
  { name: 'Weld with object override', run: () => useStore.getState().weldSelection() },
];

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

function vector(id: string, operationId: string, x: number, color: string): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: 0, maxX: x + 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    operationIds: [operationId],
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x, y: 0 },
              { x: x + 20, y: 0 },
              { x: x + 20, y: 20 },
              { x, y: 20 },
              { x, y: 0 },
            ],
          },
        ],
      },
    ],
  };
}

function load(pro: (typeof proOperations)[number] | null, actionName = '') {
  useStore.getState().setMachineKind('cnc');
  const first = createLayer({ id: 'source-operation', color: '#000000' });
  const operation =
    pro === null ? first : { ...first, cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...pro.cnc } };
  const free = createLayer({ id: 'free-operation', color: '#ff0000' });
  const source = vector('source', operation.id, 0, operation.color);
  const second = vector('second', free.id, 10, free.color);
  useStore.setState({
    project: {
      ...useStore.getState().project,
      scene: {
        objects: [source, second],
        layers: [operation, free],
        groups: [],
        artworkOrder: [source.id, second.id],
      },
    },
    selectedObjectId: source.id,
    additionalSelectedIds: new Set(),
  });
  if (actionName === 'Weld with object power') useStore.getState().setSelectedObjectsPowerScale(50);
  if (actionName === 'Weld with object override')
    useStore.getState().setSelectedObjectsOperationOverride({ power: 19, speed: 123 });
  useStore.setState({
    additionalSelectedIds: new Set([second.id]),
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
  return useStore.getState().project;
}

beforeEach(resetStore);
afterEach(() => setActiveEdition(null));

describe.each(independentActions)('$name independent operation admission', ({ name, run }) => {
  it.each(proOperations)(
    'holds new $feature work in Free without publishing a partial edit',
    (pro) => {
      const request = edition();
      const before = load(pro, name);
      run();
      expect(useStore.getState().project).toBe(before);
      expect(useStore.getState()).toMatchObject({
        selectedObjectId: 'source',
        additionalSelectedIds: new Set(['second']),
        dirty: false,
        undoStack: [],
        redoStack: [],
      });
      expect(request).toHaveBeenCalledExactlyOnceWith(pro.feature, expect.any(Function));
    },
  );

  it('commits the captured independent operation once after an unlock', () => {
    const request = edition();
    const before = load(proOperations[0], name);
    run();
    expect(useStore.getState().project).toBe(before);
    const allow = request.mock.calls[0]?.[1];
    expect(allow).toBeTypeOf('function');
    edition(true);
    allow?.();
    const after = useStore.getState().project;
    const originalIds = new Set(before.scene.layers.map((operation) => operation.id));
    expect(after.scene.objects).toHaveLength(1);
    expect(
      after.scene.layers.some(
        (operation) =>
          !originalIds.has(operation.id) && operationProFeature(operation) === 'vcarve',
      ),
    ).toBe(true);
    expect(useStore.getState().undoStack).toEqual([before]);
    allow?.();
    expect(useStore.getState().project).toBe(after);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  });

  it.each(['project', 'epoch'] as const)(
    'discards a deferred edit after the %s changes',
    (change) => {
      const request = edition();
      load(proOperations[0], name);
      run();
      const allow = request.mock.calls[0]?.[1];
      expect(allow).toBeTypeOf('function');
      if (change === 'project')
        useStore.setState({ project: { ...useStore.getState().project, notes: 'New edit' } });
      else
        useStore.setState({ projectDocumentEpoch: useStore.getState().projectDocumentEpoch + 1 });
      const beforeUnlock = useStore.getState().project;
      edition(true);
      allow?.();
      expect(useStore.getState().project).toBe(beforeUnlock);
      expect(useStore.getState().project.scene.objects).toHaveLength(2);
    },
  );

  it('allows independent ordinary operations in Free', () => {
    const request = edition();
    load(null, name);
    run();
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
    expect(request).not.toHaveBeenCalled();
  });

  it('allows independent Pro operations immediately in Pro', () => {
    const request = edition(true);
    load(proOperations[0], name);
    run();
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
    expect(request).not.toHaveBeenCalled();
  });
});

it.each(proOperations)(
  'keeps ordinary Weld of existing $feature operations editable in Free',
  (pro) => {
    const request = edition();
    const before = load(pro);
    useStore.getState().weldSelection();
    const after = useStore.getState().project;
    expect(after.scene.objects).toHaveLength(1);
    expect(after.scene.layers.map((layer) => layer.id)).toEqual(
      before.scene.layers.map((layer) => layer.id),
    );
    expect(operationIdsForObject(after.scene.objects[0]!, after.scene.layers)).toContain(
      'source-operation',
    );
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(request).not.toHaveBeenCalled();
  },
);

it.each(proOperations)('recognises a copied $feature operation with a legacy binding ID', (pro) => {
  const request = edition();
  load(pro);
  const project = useStore.getState().project;
  const parent = createLayer({ id: 'legacy-parent', color: '#000000' });
  const source = project.scene.layers[0]!;
  useStore.setState({
    project: {
      ...project,
      scene: {
        ...project.scene,
        objects: [vector('source', parent.id, 0, parent.color)],
        layers: [parent, { ...source, bindingOperationId: parent.id }],
        artworkOrder: ['source'],
      },
    },
    additionalSelectedIds: new Set(),
  });
  const before = useStore.getState().project;
  useStore.getState().duplicateSelection();
  expect(useStore.getState().project).toBe(before);
  expect(request).toHaveBeenCalledExactlyOnceWith(pro.feature, expect.any(Function));
});
