import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { StatusBar } from '../common/StatusBar';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { useWorkspaceLayoutStore } from '../state/workspace-layout-store';
import { PlatformProvider } from './platform-context';
import { useShortcuts } from './use-shortcuts';
import { WorkspaceSidePanels } from './WorkspaceSidePanels';

vi.mock('../layers', () => ({ CutsLayersPanel: () => <div>Artwork settings</div> }));
vi.mock('../laser', () => ({ LaserWindow: () => <div>Machine settings</div> }));
vi.mock('../laser/WorkspaceJobActions', () => ({ WorkspaceJobActions: () => null }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => false, requestPort: async () => null },
};
let host: HTMLDivElement;
let root: Root | null = null;

function Harness(): JSX.Element {
  useShortcuts();
  return (
    <>
      <WorkspaceSidePanels />
      <StatusBar />
    </>
  );
}

beforeEach(async () => {
  resetStore();
  const project = useStore.getState().project;
  useStore.setState({
    project: { ...project, scene: { ...project.scene, objects: [svgObj('artwork', ['#000000'])] } },
    selectedObjectId: 'artwork',
  });
  useUiStore.setState({
    railPanelVisibility: { layers: true, machine: true },
    railPanelFocusRequest: null,
    modalDepth: 0,
  });
  useWorkspaceLayoutStore.setState({ preference: 'compact', resetRevision: 0 });
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={platform}>
        <Harness />
      </PlatformProvider>,
    );
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host.remove();
  root = null;
  resetStore();
  vi.unstubAllGlobals();
});

describe('Workspace chrome keyboard ownership', () => {
  it.each([false, true])(
    'switches sidebar tabs without editing selected artwork (Shift=%s)',
    async (shiftKey) => {
      const before = useStore.getState().project;
      const artwork = required<HTMLElement>('[role="tab"][aria-selected="true"]');
      artwork.focus();
      for (const [key, selected] of [
        ['ArrowRight', 'Machine'],
        ['ArrowLeft', 'Artwork'],
        ['End', 'Machine'],
        ['Home', 'Artwork'],
      ] as const) {
        await press(document.activeElement as HTMLElement, key, shiftKey);
        expect(document.activeElement?.textContent).toBe(selected);
        expect(document.activeElement?.getAttribute('aria-selected')).toBe('true');
        expect(useStore.getState().project).toBe(before);
        expect(useStore.getState().selectedObjectId).toBe('artwork');
        expect(useStore.getState().undoStack).toHaveLength(0);
        expect(useStore.getState().dirty).toBe(false);
      }
      // Prove the actual workspace shortcut was installed and still works away
      // from the tabs, rather than passing because this harness disabled it.
      await press(document.body, 'ArrowRight');
      expect(useStore.getState().project.scene.objects[0]?.transform.x).toBe(1);
      expect(useStore.getState().undoStack).toHaveLength(1);
    },
  );

  it('lets native status scrolling handle navigation keys without changing artwork', async () => {
    const before = useStore.getState().project;
    const telemetry = required<HTMLElement>('[aria-label="Workspace status details"]');
    telemetry.focus();
    for (const key of [
      'ArrowRight',
      'ArrowLeft',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      ' ',
    ]) {
      const event = await press(telemetry, key);
      expect(event.defaultPrevented).toBe(false);
      expect(useStore.getState().project).toBe(before);
      expect(useStore.getState().undoStack).toHaveLength(0);
      expect(useStore.getState().dirty).toBe(false);
    }
    await press(document.body, 'ArrowRight');
    expect(useStore.getState().project.scene.objects[0]?.transform.x).toBe(1);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });
});

function required<T extends HTMLElement>(selector: string): T {
  const element = host.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing ${selector}`);
  return element;
}

async function press(target: HTMLElement, key: string, shiftKey = false): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  await act(async () => target.dispatchEvent(event));
  return event;
}
