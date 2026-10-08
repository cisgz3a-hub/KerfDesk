import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
} from '../../core/scene';
import { setActiveEdition, UNRESTRICTED_EDITION } from '../licensing/edition';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { BooleanDialogHost } from './BooleanDialogHost';
import {
  openBooleanDialog,
  useBooleanDialogStore,
  type BooleanPreviewOperation,
} from './boolean-dialog-store';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  resetStore();
  useBooleanDialogStore.setState({ session: null });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  setActiveEdition(null);
});
function square(id: string, x: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    transform: { ...IDENTITY_TRANSFORM, x },
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    operationIds: ['cut'],
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
            ],
          },
        ],
      },
    ],
  };
}
async function open(operation: BooleanPreviewOperation = 'subtract', apart = false) {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [square('back', 0), square('front', apart ? 20 : 5)],
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        groups: [{ id: 'pair', name: 'Pair', objectIds: ['back', 'front'] }],
      },
    },
    selectedObjectId: 'back',
    additionalSelectedIds: new Set(['front']),
  });
  const before = useStore.getState().project;
  await act(async () => {
    root.render(<BooleanDialogHost />);
    openBooleanDialog(operation);
  });
  return before;
}
function button(label: string): HTMLButtonElement {
  return [...document.querySelectorAll('button')].find((entry) => entry.textContent === label)!;
}
describe('Boolean review dialog', () => {
  it('previews without changing the scene, and Cancel leaves history untouched', async () => {
    const before = await open();
    expect(document.querySelector('[data-testid="comparison-original"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="comparison-result"]')).not.toBeNull();
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
    await act(async () => button('Cancel').click());
    expect(useBooleanDialogStore.getState().session).toBeNull();
    expect(useStore.getState().project).toBe(before);
  });
  it.each(['weld', 'subtract', 'intersect', 'exclude'] as const)(
    'applies %s with retained sources and one undo step',
    async (operation) => {
      const before = await open(operation);
      const keep = [...document.querySelectorAll('label')]
        .find((label) => label.textContent?.includes('Keep source objects'))!
        .querySelector<HTMLInputElement>('input')!;
      await act(async () => {
        keep.checked = true;
        Simulate.change(keep);
      });
      await act(async () => button('Apply').click());
      const state = useStore.getState();
      expect(state.project.scene.objects).toHaveLength(3);
      expect(state.project.scene.objects.slice(0, 2)).toEqual(before.scene.objects);
      expect(state.project.scene.groups).toEqual(before.scene.groups);
      expect(state.undoStack).toHaveLength(1);
      expect(useBooleanDialogStore.getState().session).toBeNull();
      state.undo();
      expect(useStore.getState().project).toBe(before);
    },
  );
  it('replaces operands only after explicit Apply', async () => {
    const before = await open();
    await act(async () => button('Apply').click());
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  });
  it.each([
    'cancel',
    'change operation',
    'change selection',
    'change result mode',
    'apply',
  ] as const)('honours review ownership after pending Pro admission: %s', async (outcome) => {
    await open('weld');
    const current = useStore.getState().project;
    useStore.setState({
      project: {
        ...current,
        scene: {
          ...current.scene,
          layers: current.scene.layers.map((layer) => ({
            ...layer,
            cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' },
          })),
        },
      },
    });
    await act(async () => openBooleanDialog('weld'));
    const before = useStore.getState().project;
    const asked = vi.fn((_feature: string, _allowed?: () => void) => false);
    setActiveEdition({ ...UNRESTRICTED_EDITION, licensed: true, pro: false, requestPro: asked });
    const keep = [...document.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Keep source objects'))!
      .querySelector<HTMLInputElement>('input')!;
    await act(async () => {
      keep.checked = true;
      Simulate.change(keep);
    });
    await act(async () => button('Apply').click());
    expect(asked).toHaveBeenCalledExactlyOnceWith('vcarve', expect.any(Function));
    expect(useStore.getState().project).toBe(before);
    if (outcome === 'cancel') await act(async () => button('Cancel').click());
    if (outcome === 'change operation') {
      const select = document.querySelector<HTMLSelectElement>('[aria-label="Boolean operation"]')!;
      await act(async () => {
        select.value = 'subtract';
        Simulate.change(select);
      });
    }
    if (outcome === 'change result mode') {
      const retained = [...document.querySelectorAll('label')]
        .find((label) => label.textContent?.includes('Create live compound'))
        ?.querySelector<HTMLInputElement>('input');
      if (retained === undefined || retained === null) throw new Error('Missing compound option');
      await act(async () => {
        retained.checked = true;
        Simulate.change(retained);
      });
    }
    if (outcome === 'change selection')
      await act(async () => useStore.setState({ additionalSelectedIds: new Set() }));
    setActiveEdition(UNRESTRICTED_EDITION);
    await act(async () => asked.mock.calls[0]?.[1]?.());
    expect(useStore.getState().project === before).toBe(outcome !== 'apply');
    expect(useStore.getState().undoStack).toHaveLength(outcome === 'apply' ? 1 : 0);
    if (outcome === 'apply') expect(useBooleanDialogStore.getState().session).toBeNull();
  });

  it('reports empty results and prevents Apply', async () => {
    const before = await open('intersect', true);
    expect(document.querySelector('[role="status"]')?.textContent).toContain('empty');
    expect(button('Apply').disabled).toBe(true);
    expect(useStore.getState().project).toBe(before);
  });
  it('invalidates a changed selection without applying to new operands', async () => {
    const before = await open();
    await act(async () => useStore.setState({ additionalSelectedIds: new Set() }));
    expect(button('Apply').disabled).toBe(true);
    expect(document.querySelector('[role="status"]')?.textContent).toContain('selection changed');
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});
