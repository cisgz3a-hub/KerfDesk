import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_CNC_LAYER_SETTINGS, operationIdsForObject } from '../../core/scene';
import { useStore } from '../state/store';
import { resetStore, svgObj } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { setActiveEdition, UNRESTRICTED_EDITION } from './edition';

let sourceId: string;
let targetId: string;
let onAllowed: (() => void) | undefined;
const asked = vi.fn((_feature: string, callback?: () => void) => {
  onAllowed = callback;
  return false;
});
const free = { ...UNRESTRICTED_EDITION, licensed: true, pro: false, requestPro: asked };

beforeEach(() => {
  resetStore();
  onAllowed = undefined;
  asked.mockClear();
  setActiveEdition(UNRESTRICTED_EDITION);
  useStore.getState().setMachineKind('cnc');
  useStore.getState().importSvgObject(svgObj('Pro artwork', ['#000000']));
  useStore.getState().importSvgObject(svgObj('Free artwork', ['#000000']));
  const [source, target] = useStore.getState().project.scene.layers;
  if (source === undefined || target === undefined) throw new Error('Missing artwork operations');
  sourceId = source.id;
  targetId = target.id;
  useStore.getState().setLayerParam(sourceId, {
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' },
  });
  useStore.setState({ selectedObjectId: 'Pro artwork', additionalSelectedIds: new Set() });
  setActiveEdition(free);
});

afterEach(() => {
  resetStore();
  setActiveEdition(null);
});

it.each([
  [
    'clone an operation',
    () => useStore.getState().makeOperationUniqueForObjects(['Pro artwork'], sourceId),
  ],
  ['add an operation', () => useStore.getState().addOperationForObjects(['Pro artwork'])],
  ['duplicate artwork', () => useStore.getState().duplicateSelection()],
  [
    'paste artwork',
    () => {
      useStore.getState().copySelection();
      useStore.getState().pasteClipboard();
    },
  ],
  [
    'paste artwork in place',
    () => {
      useStore.getState().copySelection();
      useStore.getState().pasteClipboardInPlace();
    },
  ],
  [
    'set a new Pro cut type',
    () =>
      useStore
        .getState()
        .setLayerParam(targetId, { cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' } }),
  ],
])('requires Pro to %s', (_name, action) => {
  const before = useStore.getState().project;
  const undo = useStore.getState().undoStack;
  action();
  expect(useStore.getState().project).toBe(before);
  expect(useStore.getState().undoStack).toBe(undo);
  expect(asked).toHaveBeenCalledExactlyOnceWith('vcarve', expect.any(Function));
});

it('continues the requested edit once Pro is unlocked', () => {
  useStore.getState().useOperationForObjects(['Free artwork'], sourceId);
  setActiveEdition(UNRESTRICTED_EDITION);
  onAllowed?.();
  const scene = useStore.getState().project.scene;
  const target = scene.objects.find((object) => object.id === 'Free artwork');
  if (target === undefined) throw new Error('Missing artwork');
  expect(operationIdsForObject(target, scene.layers)).toEqual([sourceId]);
});

it('never applies a delayed unlock over a changed project', () => {
  useStore.getState().useOperationForObjects(['Free artwork'], sourceId);
  useStore.getState().renameOperation(targetId, 'Changed while signing in');
  const before = useStore.getState().project;
  setActiveEdition(UNRESTRICTED_EDITION);
  onAllowed?.();
  expect(useStore.getState().project).toBe(before);
});

it('never applies a delayed unlock to another document epoch', () => {
  useStore.getState().useOperationForObjects(['Free artwork'], sourceId);
  useStore.setState({ projectDocumentEpoch: useStore.getState().projectDocumentEpoch + 1 });
  const before = useStore.getState().project;
  setActiveEdition(UNRESTRICTED_EDITION);
  onAllowed?.();
  expect(useStore.getState().project).toBe(before);
});

it('keeps existing desktop Pro settings editable and output selectable in Free', () => {
  const current = useStore.getState().project.scene.layers.find((layer) => layer.id === sourceId);
  if (current?.cnc === undefined) throw new Error('Missing CNC operation');
  useStore.getState().setLayerParam(sourceId, { cnc: { ...current.cnc, depthMm: 2 } });
  useStore.getState().setAllLayersOutput(false);
  useStore.getState().setAllLayersOutput(true);
  expect(
    useStore.getState().project.scene.layers.find((layer) => layer.id === sourceId)?.cnc?.depthMm,
  ).toBe(2);
  expect(asked).not.toHaveBeenCalled();
});

it('applies Pro authoring immediately for an unlocked desktop', () => {
  setActiveEdition(UNRESTRICTED_EDITION);
  useStore.getState().useOperationForObjects(['Free artwork'], sourceId);
  expect(asked).not.toHaveBeenCalled();
  expect(useStore.getState().project.scene.layers).toHaveLength(1);
});

it('requires Pro for arrays of existing Pro artwork and reports no copies placed', () => {
  const before = useStore.getState().project;
  const placed = useStore.getState().placeSelectionCopies([
    { dx: 0, dy: 0, rotationDeg: 0 },
    { dx: 20, dy: 0, rotationDeg: 0 },
  ]);
  expect(placed).toBe(false);
  expect(useStore.getState().project).toBe(before);
  expect(asked).toHaveBeenCalledExactlyOnceWith('vcarve', expect.any(Function));
});

it('requires Pro for recipe application through the store and reports it truthfully', () => {
  useStore.getState().createLibrary('Saved processes');
  const saved = useStore.getState().saveSelectedProcessRecipe('V-carve');
  if (saved.kind !== 'ok') throw new Error(saved.reason);
  useStore.setState({ selectedObjectId: 'Free artwork' });
  const before = useStore.getState().project;
  expect(useStore.getState().applyProcessRecipeToSelection(saved.value.id)).toEqual({
    kind: 'invalid',
    reason: 'This process needs Pro. Unlock Pro to apply it.',
  });
  expect(useStore.getState().project).toBe(before);
  expect(asked).toHaveBeenCalledExactlyOnceWith('vcarve', expect.any(Function));
});

it('keeps Free artwork copying unrestricted', () => {
  useStore.setState({ selectedObjectId: 'Free artwork' });
  useStore.getState().duplicateSelection();
  expect(useStore.getState().project.scene.objects).toHaveLength(3);
  expect(asked).not.toHaveBeenCalled();
});

it('does not announce successful Copy Along Path while it awaits Pro', () => {
  const project = useStore.getState().project;
  const objects = project.scene.objects.map((object) => {
    if (object.kind !== 'imported-svg') return object;
    const artwork = object.id === 'Pro artwork';
    return {
      ...object,
      paths: [
        {
          ...object.paths[0]!,
          polylines: [
            {
              closed: artwork,
              points: artwork
                ? [
                    { x: 0, y: 0 },
                    { x: 4, y: 0 },
                    { x: 4, y: 4 },
                    { x: 0, y: 0 },
                  ]
                : [
                    { x: 0, y: 0 },
                    { x: 100, y: 0 },
                  ],
            },
          ],
        },
      ],
    };
  });
  useStore.setState({
    project: { ...project, scene: { ...project.scene, objects } },
    additionalSelectedIds: new Set(['Free artwork']),
  });
  const before = useStore.getState().project;
  const toasts = useToastStore.getState().toasts;
  const placed = useStore.getState().copyAlongPath({
    mode: 'count',
    count: 3,
    spacingMm: 10,
    startOffsetMm: 0,
    endOffsetMm: 0,
    rotateCopies: false,
    keepOriginal: true,
  });
  expect(placed).toBe(false);
  expect(useStore.getState().project).toBe(before);
  expect(asked).toHaveBeenCalledExactlyOnceWith('vcarve', expect.any(Function));
  expect(useToastStore.getState().toasts).toBe(toasts);
});
