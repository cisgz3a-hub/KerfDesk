import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  operationIdsForObject,
  type ArraySpec,
} from '../../core/scene';
import { setActiveEdition, UNRESTRICTED_EDITION } from '../licensing/edition';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

// Rolling audit v2, 02-P3-2: Regenerate ran on the document setter, which never
// asks, so a retained array of V-carve artwork gained copies in Free.

let onAllowed: (() => void) | undefined;
const requestPro = vi.fn((_feature: string, callback?: () => void) => {
  onAllowed = callback;
  return false;
});
const FREE = { ...UNRESTRICTED_EDITION, licensed: true, pro: false, requestPro };
const grid = (columns: number, spacingX = 4): ArraySpec => ({
  kind: 'grid',
  rows: 1,
  columns,
  spacingX,
  spacingY: 0,
});
let operationId: string;

beforeEach(() => {
  resetStore();
  setActiveEdition(UNRESTRICTED_EDITION);
  onAllowed = undefined;
  requestPro.mockClear();
  useStore.getState().setMachineKind('cnc');
  useStore.getState().importSvgObject(svgObj('sign', ['#000000']));
  const layer = useStore.getState().project.scene.layers[0];
  if (layer === undefined) throw new Error('Missing artwork operation');
  operationId = layer.id;
  useStore.getState().setLayerParam(operationId, {
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' },
  });
  useStore.setState({ selectedObjectId: 'sign', additionalSelectedIds: new Set() });
  useStore.getState().arraySelection(grid(2), undefined, undefined, { name: 'Signs' });
});
afterEach(() => {
  resetStore();
  setActiveEdition(null);
});

const vcarveCopies = () => {
  const { objects, layers } = useStore.getState().project.scene;
  return objects.filter((object) => operationIdsForObject(object, layers).includes(operationId))
    .length;
};

function layoutId(): string {
  const layout = useStore.getState().project.arrayLayouts?.[0];
  if (layout === undefined) throw new Error('The array was not retained');
  return layout.id;
}

it('asks for Pro before Regenerate adds V-carve copies in Free, then regenerates once unlocked', () => {
  expect(vcarveCopies()).toBe(2);
  setActiveEdition(FREE);
  const before = useStore.getState().project;

  const onCommitted = vi.fn();

  const result = useStore
    .getState()
    .regenerateArrayLayout(layoutId(), grid(6), undefined, before, () => true, onCommitted);

  expect(result).toBe('The array is waiting for its authoring tool approval.');
  expect(requestPro).toHaveBeenCalledExactlyOnceWith('vcarve', expect.any(Function));
  expect(useStore.getState().project).toBe(before);
  expect(onCommitted).not.toHaveBeenCalled();

  setActiveEdition(UNRESTRICTED_EDITION);
  onAllowed?.();
  expect(vcarveCopies()).toBe(6);
  // The editor closes once the held regeneration lands.
  expect(onCommitted).toHaveBeenCalledOnce();
});

it('never applies a held regeneration after its editor has closed', () => {
  setActiveEdition(FREE);
  let editorOpen = true;
  const onCommitted = vi.fn();

  useStore
    .getState()
    .regenerateArrayLayout(
      layoutId(),
      grid(6),
      undefined,
      undefined,
      () => editorOpen,
      onCommitted,
    );
  editorOpen = false;
  setActiveEdition(UNRESTRICTED_EDITION);
  onAllowed?.();

  expect(vcarveCopies()).toBe(2);
  expect(onCommitted).not.toHaveBeenCalled();
});

it('keeps re-spacing the existing copies free', () => {
  setActiveEdition(FREE);

  const result = useStore.getState().regenerateArrayLayout(layoutId(), grid(2, 9));

  expect(result).toBeNull();
  expect(requestPro).not.toHaveBeenCalled();
  expect(vcarveCopies()).toBe(2);
});
