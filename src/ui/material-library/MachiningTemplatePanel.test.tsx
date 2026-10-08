import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, expect, it } from 'vitest';
import {
  namedProject,
  target,
} from '../../core/material-library/process-recipe-template.test-fixture';
import { PlatformProvider } from '../app/platform-context';
import { ProcessRecipePanel } from './ProcessRecipePanel';
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
it('authors, reviews missing roles, applies and reapplies a retained template through the operator panel', async () => {
  resetStore();
  useStore.setState({
    project: namedProject(),
    selectedObjectId: 'source',
    additionalSelectedIds: new Set(['cutout']),
  });
  useStore.getState().createLibrary('Workshop');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <PlatformProvider adapter={platform}>
          <ProcessRecipePanel />
        </PlatformProvider>,
      ),
    );
    const name = host.querySelector<HTMLInputElement>('[aria-label="Process recipe name"]')!;
    act(() => {
      name.value = 'Sign family';
      Simulate.change(name);
    });
    click(host, 'Save selected machining template');
    expect(host.querySelector('[aria-label="Machining template selectors"]')).not.toBeNull();
    const project = target();
    act(() =>
      useStore.setState({
        project: {
          ...project,
          scene: {
            ...project.scene,
            objects: project.scene.objects.map((object) =>
              object.id === 'cutout' ? { ...object, name: 'Renamed cutout' } : object,
            ),
          },
        },
      }),
    );
    expect(button(host, 'Apply machining template').disabled).toBe(true);
    click(host, 'Review template matches');
    expect(host.textContent).toContain('Required role missing');
    expect(host.textContent).toContain('unmatched artworks');
    click(host, 'Apply machining template');
    expect(useStore.getState().project.processRecipeApplications).toHaveLength(1);
    const count = useStore.getState().project.scene.layers.length;
    act(() =>
      useStore
        .getState()
        .deleteProcessRecipe(useStore.getState().materialLibrary!.processRecipes![0]!.id),
    );
    click(host, 'Review retained template');
    click(host, 'Reapply retained template');
    expect(useStore.getState().project.scene.layers).toHaveLength(count);
    expect(host.textContent).toContain('preserving operator edits');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
function button(host: HTMLElement, text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text,
  );
  if (found === undefined) throw new Error('Missing ' + text);
  return found;
}
function click(host: HTMLElement, text: string): void {
  const target = button(host, text);
  expect(target.disabled).toBe(false);
  act(() => Simulate.click(target));
}
