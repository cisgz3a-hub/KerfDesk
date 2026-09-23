import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, operationIdsForObject, type Layer } from '../../core/scene';
import { effectiveOperationForObject } from '../../core/effective-output';
import { createRectangle } from '../../core/shapes/primitives';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { useUiStore, type CutsLayersView } from '../state/ui-store';
import { CutsLayersPanel } from './CutsLayersPanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const mockPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => false, requestPort: async () => null },
};

beforeEach(() => {
  resetStore();
  useUiStore.getState().setRailPanelVisible('layers', true);
  useUiStore.getState().setCutsLayersView('layers');
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.useRealTimers();
  resetStore();
  useUiStore.getState().setCutsLayersView('layers');
});

describe('Artwork panel navigation', () => {
  it.each(['laser', 'cnc'] as const)(
    'supports outer tab arrow, Home and End keys with the available %s views',
    async (machineKind) => {
      if (machineKind === 'cnc') {
        useStore.getState().setMachineKind('cnc');
        // A remembered Materials view remains selected as CNC Recipes.
        useUiStore.getState().setCutsLayersView('materials');
      }
      const before = useStore.getState();
      const host = await renderPanel();
      const tablist = required(host, '[role="tablist"][aria-label="Artwork panel view"]');
      expect([...tablist.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(
        machineKind === 'laser'
          ? ['Settings', 'Run order', 'Materials']
          : ['Settings', 'Run order', 'Recipes'],
      );
      const lastView = 'materials';
      const first = required<HTMLButtonElement>(tablist, '#cuts-layers-layers-tab');
      if (machineKind === 'cnc') {
        const remembered = required<HTMLButtonElement>(tablist, '#cuts-layers-materials-tab');
        expect(remembered.getAttribute('aria-selected')).toBe('true');
        expect(remembered.tabIndex).toBe(0);
        expect(tablist.querySelectorAll('[role="tab"][tabindex="0"]')).toHaveLength(1);
        expect(useUiStore.getState().cutsLayersView).toBe('materials');
        const panel = required(host, '#cuts-layers-materials-panel');
        expect(panel.getAttribute('aria-labelledby')).toBe(remembered.id);
        await act(async () => remembered.focus());
        await pressKey(remembered, 'Home');
      } else {
        await act(async () => first.focus());
      }
      expect(document.activeElement).toBe(first);
      expect(first.getAttribute('aria-selected')).toBe('true');
      expect(first.tabIndex).toBe(0);
      const steps: ReadonlyArray<readonly [string, CutsLayersView]> = [
        ['ArrowRight', 'run-order'],
        ['End', lastView],
        ['ArrowRight', 'layers'],
        ['ArrowLeft', lastView],
        ['Home', 'layers'],
        ['End', lastView],
      ];
      for (const [key, expected] of steps) {
        await pressKey(document.activeElement as HTMLElement, key);
        const selected = required<HTMLButtonElement>(tablist, `#cuts-layers-${expected}-tab`);
        expect(document.activeElement).toBe(selected);
        expect(selected.getAttribute('aria-selected')).toBe('true');
        expect(selected.tabIndex).toBe(0);
        expect(tablist.querySelectorAll('[role="tab"][tabindex="0"]')).toHaveLength(1);
        expect(useUiStore.getState().cutsLayersView).toBe(expected);
        const panel = required(host, `#${selected.getAttribute('aria-controls')}`);
        expect(panel.getAttribute('aria-labelledby')).toBe(selected.id);
      }
      expect(useStore.getState().project).toBe(before.project);
      expect(useStore.getState().undoStack).toEqual(before.undoStack);
      expect(selection()).toEqual({ primary: before.selectedObjectId, additional: [] });
    },
  );

  it.each(['operation', 'artwork'] as const)(
    'retains the mounted %s numeric draft while switching inner tabs',
    async (editorView) => {
      vi.useFakeTimers();
      seedIndependentArtwork();
      const before = useStore.getState();
      const beforeSelection = selection();
      const host = await renderPanel();
      const tablist = required(host, '[role="tablist"][aria-label="Edit artwork or operation"]');
      const sourceTab = innerTab(tablist, editorView === 'operation' ? 'Operation' : 'Artwork');
      const otherTab = innerTab(tablist, editorView === 'operation' ? 'Artwork' : 'Operation');
      await act(async () => sourceTab.click());
      const ariaLabel =
        editorView === 'operation'
          ? 'Power for selected objects'
          : 'Power scale for selected objects';
      const input = required<HTMLInputElement>(host, `input[aria-label="${ariaLabel}"]`);
      const sourcePanel = input.closest('[role="tabpanel"]');
      if (!(sourcePanel instanceof HTMLElement)) throw new Error('Editor panel missing');
      expect(sourcePanel.hidden).toBe(false);
      await act(async () => {
        input.value = '47';
        Simulate.change(input);
        otherTab.click();
      });
      expect(sourcePanel.hidden).toBe(true);
      expect(input.isConnected).toBe(true);
      expect(input.value).toBe('47');
      expect(useStore.getState().project).toBe(before.project);
      expect(useStore.getState().undoStack).toHaveLength(0);
      expect(useStore.getState().dirty).toBe(false);
      expect(selection()).toEqual(beforeSelection);
      await act(async () => sourceTab.click());
      expect(sourcePanel.hidden).toBe(false);
      expect(required(host, `input[aria-label="${ariaLabel}"]`)).toBe(input);
      expect(input.value).toBe('47');
      await act(async () => vi.advanceTimersByTime(300));
      const expectedScene =
        editorView === 'operation'
          ? {
              ...before.project.scene,
              layers: before.project.scene.layers.map((layer) =>
                layer.name === 'chosen' ? { ...layer, power: 47 } : layer,
              ),
            }
          : {
              ...before.project.scene,
              objects: before.project.scene.objects.map((object) =>
                object.id === 'chosen' ? { ...object, powerScale: 47 } : object,
              ),
            };
      expect(useStore.getState().project).toEqual({ ...before.project, scene: expectedScene });
      expect(useStore.getState().undoStack).toEqual([before.project]);
      expect(selection()).toEqual(beforeSelection);
      // A second view switch must not replay the committed draft.
      await act(async () => {
        otherTab.click();
        vi.advanceTimersByTime(600);
      });
      expect(useStore.getState().undoStack).toHaveLength(1);
    },
  );

  it.each([false, true])(
    'immediately edits the added operation only (artwork override: %s)',
    async (override) => {
      const source = seedSharedArtwork(override);
      const before = useStore.getState();
      const beforeSelection = selection();
      const host = await renderPanel();
      await act(async () => buttonByText(host, 'Add operation').click());
      const sceneAfterAdd = useStore.getState().project.scene;
      const added = sceneAfterAdd.layers.find((layer) => layer.id !== source.id);
      if (added === undefined) throw new Error('New operation missing');
      const chooser = required<HTMLSelectElement>(
        host,
        'select[aria-label="Operation to inspect"]',
      );
      expect(chooser.value).toBe(added.id);
      expect(required<HTMLInputElement>(host, 'input[aria-label="Operation name"]').value).toBe(
        added.name,
      );
      const power = required<HTMLInputElement>(
        host,
        'input[aria-label="Power for selected objects"]',
      );
      expect(power.value).toBe(override ? '17' : '30');
      await act(async () => {
        power.value = '23';
        Simulate.change(power);
      });
      await act(async () => Simulate.blur(power));
      const state = useStore.getState();
      const chosen = state.project.scene.objects.find((object) => object.id === 'chosen')!;
      const peer = state.project.scene.objects.find((object) => object.id === 'peer')!;
      const original = state.project.scene.layers.find((layer) => layer.id === source.id)!;
      const edited = state.project.scene.layers.find((layer) => layer.id === added.id)!;
      expect(original).toEqual(source);
      expect(peer).toEqual(before.project.scene.objects[1]);
      expect(operationIdsForObject(chosen, state.project.scene.layers)).toEqual([
        source.id,
        added.id,
      ]);
      expect(operationIdsForObject(peer, state.project.scene.layers)).toEqual([source.id]);
      expect(effectiveOperationForObject(edited, chosen).power).toBe(23);
      expect(effectiveOperationForObject(original, chosen).power).toBe(override ? 17 : 30);
      expect(effectiveOperationForObject(original, peer).power).toBe(30);
      expect(chooser.value).toBe(added.id);
      expect(selection()).toEqual(beforeSelection);
      expect(state.undoStack).toHaveLength(2);
    },
  );

  it('explains shared visibility and output while editing a selected artwork override', async () => {
    const source = seedSharedArtwork(true);
    const before = useStore.getState();
    const host = await renderPanel();
    const outputGroup = required(host, '.lf-operation-output');
    expect(outputGroup.textContent).toContain(
      'Visibility and output apply to all 2 artworks using this operation.',
    );
    expect(outputGroup.textContent).toContain('Show on canvas');
    expect(outputGroup.textContent).toContain('Include in output');
    expect(host.textContent).toContain('Editing settings for 1 artwork.');
    expect(host.textContent).toContain('This artwork has its own settings.');
    expect(host.textContent).not.toContain('Shared by 2 artworks. Edits apply to all of them.');
    const output = required<HTMLInputElement>(
      outputGroup,
      `input[aria-label="Output ${source.name}"]`,
    );
    await act(async () => output.click());
    expect(useStore.getState().project.scene.layers[0]).toEqual({ ...source, output: false });
    expect(useStore.getState().project.scene.objects).toEqual(before.project.scene.objects);
    expect(outputGroup.querySelector('[role="status"]')?.textContent).toContain(
      'excluded from output',
    );
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(selection()).toEqual({ primary: 'chosen', additional: [] });
  });

  it('keeps the Artwork view and chosen offset distance when the new copy becomes selected', async () => {
    seedClosedArtwork();
    const before = useStore.getState();
    const host = await renderPanel();
    const tablist = required(host, '[role="tablist"][aria-label="Edit artwork or operation"]');
    await act(async () => innerTab(tablist, 'Artwork').click());
    const distance = required<HTMLInputElement>(host, 'input[aria-label="Offset distance"]');
    await editNumber(distance, '3.5');
    expect(useStore.getState().project).toBe(before.project);
    await act(async () => buttonByText(host, 'Outward copy').click());
    const after = useStore.getState();
    const created = after.project.scene.objects.find(
      (object) => !before.project.scene.objects.some((original) => original.id === object.id),
    );
    expect(created).toBeDefined();
    expect(after.selectedObjectId).toBe(created?.id);
    expect(after.project.scene.objects).toHaveLength(3);
    expect(after.undoStack).toHaveLength(1);
    const artworkTab = innerTab(
      required(host, '[role="tablist"][aria-label="Edit artwork or operation"]'),
      'Artwork',
    );
    expect(artworkTab.getAttribute('aria-selected')).toBe('true');
    expect(required<HTMLElement>(host, '[id$="-artwork-panel"]').hidden).toBe(false);
    expect(required(host, 'input[aria-label="Offset distance"]')).toBe(distance);
    expect(distance.value).toBe('3.5');
    expect(after.project.scene.objects.slice(0, 2)).toEqual(before.project.scene.objects);
  });

  it('keeps a custom dogbone diameter across artwork selection without changing the active cutter', async () => {
    seedClosedArtwork();
    useStore.getState().setMachineKind('cnc');
    useStore.setState({ undoStack: [], redoStack: [], dirty: false });
    const before = useStore.getState();
    const host = await renderPanel();
    const tablist = required(host, '[role="tablist"][aria-label="Edit artwork or operation"]');
    await act(async () => innerTab(tablist, 'Artwork').click());
    const diameter = required<HTMLInputElement>(host, 'input[aria-label="Dogbone bit diameter"]');
    await editNumber(diameter, '2.5');
    expect(useStore.getState().project).toBe(before.project);
    await act(async () => useStore.getState().selectObject('peer'));
    const artworkTab = innerTab(
      required(host, '[role="tablist"][aria-label="Edit artwork or operation"]'),
      'Artwork',
    );
    expect(artworkTab.getAttribute('aria-selected')).toBe('true');
    expect(required(host, 'input[aria-label="Dogbone bit diameter"]')).toBe(diameter);
    expect(diameter.value).toBe('2.5');
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().dirty).toBe(false);
    expect(selection()).toEqual({ primary: 'peer', additional: [] });
  });
});

function seedIndependentArtwork(): void {
  useStore.getState().importSvgObject(svgObj('chosen', ['#000000']));
  useStore.getState().importSvgObject(svgObj('peer', ['#000000']));
  useStore.getState().selectObject('chosen');
  useStore.setState({ undoStack: [], redoStack: [], dirty: false });
}

function seedClosedArtwork(): void {
  for (const id of ['chosen', 'peer']) {
    useStore.getState().drawShape(
      createRectangle({
        id,
        color: '#000000',
        spec: { widthMm: 40, heightMm: 20, cornerRadiusMm: 0 },
      }),
    );
  }
  useStore.getState().selectObject('chosen');
  useStore.setState({ undoStack: [], redoStack: [], dirty: false });
}

async function editNumber(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    input.value = value;
    Simulate.change(input);
  });
  await act(async () => Simulate.blur(input));
}

function seedSharedArtwork(override: boolean): Layer {
  const source = createLayer({ id: 'shared', name: 'Shared outline', color: '#000000' });
  const objects = ['chosen', 'peer'].map((id) => ({
    ...svgObj(id, ['#000000']),
    operationIds: [source.id],
    ...(override && id === 'chosen' ? { operationOverride: { power: 17, speed: 600 } } : {}),
  }));
  useStore.setState({
    project: { ...createProject(), scene: { layers: [source], objects } },
    selectedObjectId: 'chosen',
    additionalSelectedIds: new Set(),
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
  return source;
}

function selection() {
  const state = useStore.getState();
  return { primary: state.selectedObjectId, additional: [...state.additionalSelectedIds] };
}

function required<T extends HTMLElement>(host: HTMLElement, selector: string): T {
  const element = host.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing ${selector}`);
  return element;
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text,
  );
  if (button === undefined) throw new Error(`Missing ${text}`);
  return button;
}

function innerTab(host: HTMLElement, text: string): HTMLButtonElement {
  return buttonByText(host, text);
}

async function pressKey(target: HTMLElement, key: string): Promise<void> {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  await act(async () => target.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
}

async function renderPanel(): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <PlatformProvider adapter={mockPlatform}>
        <CutsLayersPanel />
      </PlatformProvider>,
    ),
  );
  return host;
}
