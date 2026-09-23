import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, expect, it } from 'vitest';
import {
  recipeProject,
  freshRecipeProject,
} from '../../core/material-library/process-recipe.test-fixture';
import { PlatformProvider } from '../app/platform-context';
import { MaterialLibraryPanel } from '../layers/MaterialLibraryPanel';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import type { PlatformAdapter } from '../../platform/types';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(resetStore);
const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => false, requestPort: async () => null },
};

it.each([false, true])(
  'captures and applies a complete process through the library UI (CNC=%s)',
  async (cnc) => {
    resetStore();
    const source = recipeProject(cnc);
    useStore.setState({ project: source, selectedObjectId: 'source' });
    useStore.getState().createLibrary('Workshop recipes');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <PlatformProvider adapter={platform}>
            <MaterialLibraryPanel />
          </PlatformProvider>,
        ),
      );
      const input = host.querySelector<HTMLInputElement>('[aria-label="Process recipe name"]')!;
      act(() => {
        input.value = 'Complete process';
        Simulate.change(input);
      });
      click(host, 'Save selected process');
      expect(host.querySelector('[aria-label="Recipe operation order"]')?.textContent).toContain(
        'Optional score',
      );
      expect(host.querySelector('[aria-label="Recipe operation order"]')?.textContent).toContain(
        '(disabled)',
      );
      expect(useStore.getState().materialLibrary?.processRecipes).toHaveLength(1);
      act(() =>
        useStore.setState({ project: freshRecipeProject(source), selectedObjectId: 'fresh' }),
      );
      click(host, 'Apply recipe to selection');
      expect(useStore.getState().project.scene.layers.map((layer) => layer.name)).toEqual([
        'Engrave',
        'Optional score',
        'Cut',
      ]);
      expect(host.textContent).toContain('Applied Complete process to 1 artwork.');
      if (cnc)
        expect(host.querySelector('[aria-label="Material library target layer"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  },
);

function click(host: HTMLElement, text: string): void {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text,
  );
  if (button === undefined) throw new Error(`Missing ${text}`);
  expect(button.disabled).toBe(false);
  act(() => Simulate.click(button));
}
