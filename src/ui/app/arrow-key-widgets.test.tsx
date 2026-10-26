// Audit 08-P2-3: an arrow key on an Artwork-panel tab switched the tab and also
// nudged the selected artwork. Plain buttons keep nudging (ADR-493 decision 6).
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import type { PlatformAdapter } from '../../platform/types';
import { ArtworkEditorTabs, type ArtworkEditorView } from '../layers/ArtworkEditorTabs';
import { ArtworkPanelTabs } from '../layers/ArtworkPanelTabs';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import type { CutsLayersView } from '../state/ui-store';
import { PlatformProvider } from './platform-context';
import { useShortcuts } from './use-shortcuts';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: vi.fn(async () => []),
  pickFileForSave: vi.fn(async () => null),
  serial: { isSupported: () => false, requestPort: vi.fn(async () => null) },
};

let root: Root | null = null;

beforeEach(() => {
  resetStore();
  const rectangle = (id: string, x: number) =>
    createRectangle({
      id,
      color: '#000000',
      spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x, y: 40 },
    });
  useStore.getState().setProject({
    ...createProject(),
    scene: {
      objects: [rectangle('a', 30), rectangle('b', 80)],
      layers: [createLayer({ id: '#000000', color: '#000000' })],
      groups: [],
    },
  });
  useStore.getState().selectObject('a');
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('arrow keys on Artwork-panel widgets', () => {
  it('switch the tab without nudging the selection', async () => {
    const host = await render();
    const editorTab = tab(host, 'ed-operation-tab');

    await press(editorTab, 'ArrowRight');
    expect(state(host)).toBe('layers/artwork');
    await press(tab(host, 'cuts-layers-layers-tab'), 'ArrowRight', { shiftKey: true });
    expect(state(host)).not.toMatch(/^layers\//);

    expect(transformOf('a')).toMatchObject({ x: 30, y: 40 });
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('do not align the selection when Alt+arrow switches a tab', async () => {
    useStore.getState().selectObjects(['a', 'b']);
    const host = await render();

    await press(tab(host, 'ed-operation-tab'), 'ArrowRight', { altKey: true });

    expect(state(host)).toBe('layers/artwork');
    expect(transformOf('a').x).toBe(30);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('still nudge the selection from a plain button (ADR-493)', async () => {
    const host = await render();
    const plain = host.querySelector<HTMLButtonElement>('#plain');
    if (plain === null) throw new Error('plain button missing');

    await press(plain, 'ArrowDown');

    expect(transformOf('a')).toMatchObject({ x: 30, y: 41 });
    expect(useStore.getState().undoStack).toHaveLength(1);
  });
});

function Harness(): JSX.Element {
  useShortcuts();
  const [editor, setEditor] = useState<ArtworkEditorView>('operation');
  const [panel, setPanel] = useState<CutsLayersView>('layers');
  return (
    <div className="lf-artwork-panel">
      <ArtworkPanelTabs active={panel} showMaterials onSelect={setPanel} />
      <ArtworkEditorTabs id="ed" active={editor} onSelect={setEditor} />
      <button type="button" id="plain">
        Plain panel button
      </button>
      <span data-testid="state">{`${panel}/${editor}`}</span>
    </div>
  );
}

async function render(): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={platform}>
        <Harness />
      </PlatformProvider>,
    );
  });
  return host;
}

async function press(
  target: HTMLElement,
  key: string,
  modifiers: { readonly shiftKey?: boolean; readonly altKey?: boolean } = {},
): Promise<void> {
  target.focus();
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }),
    );
  });
}

function tab(host: HTMLElement, id: string): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>(`#${id}`);
  if (found === null) throw new Error(`${id} missing`);
  return found;
}

function state(host: HTMLElement): string {
  return host.querySelector('[data-testid="state"]')?.textContent ?? '';
}

function transformOf(id: string): { readonly x: number; readonly y: number } {
  const object = useStore.getState().project.scene.objects.find((item) => item.id === id);
  if (object === undefined) throw new Error(`${id} missing`);
  return object.transform;
}
