import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { PlatformProvider } from './platform-context';
import { useShortcuts } from './use-shortcuts';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: vi.fn(async () => []),
  pickFileForSave: vi.fn(async () => null),
  serial: {
    isSupported: () => false,
    requestPort: vi.fn(async () => null),
  },
};

function ShortcutHarness(): null {
  useShortcuts();
  return null;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  useStore.getState().newProject();
  useStore.getState().drawShape(
    createRectangle({
      id: 'art',
      color: '#0000ff',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: 5, y: 5 },
    }),
  );
  useStore.getState().selectObject('art');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <PlatformProvider adapter={mockPlatform}>
        <ShortcutHarness />
      </PlatformProvider>,
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useUiStore.getState().closeRegistrationPanel();
  useStore.getState().newProject();
});

async function pressKey(init: KeyboardEventInit & { readonly key: string }): Promise<void> {
  await act(async () => {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
    );
    await Promise.resolve();
  });
}

function artX(): number | undefined {
  return useStore.getState().project.scene.objects.find((object) => object.id === 'art')?.transform
    .x;
}

describe('useShortcuts in jig mode', () => {
  it('leaves the canvas keys to the jig page, but keeps the project Undo', async () => {
    useUiStore.getState().openRegistrationPanel();
    const x = artX();
    await pressKey({ key: 'ArrowRight' });
    await pressKey({ key: 'Delete' });
    expect(artX()).toBe(x);

    useStore.getState().setLayerParam(useStore.getState().project.scene.layers[0]!.id, {
      power: 42,
    });
    const edited = useStore.getState().project;
    await pressKey({ key: 'z', ctrlKey: true });
    expect(useStore.getState().project).not.toBe(edited);
  });

  it('handles the canvas keys again once jig mode closes', async () => {
    const x = artX();
    await pressKey({ key: 'ArrowRight' });
    expect(artX()).not.toBe(x);
  });
});
