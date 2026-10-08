import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ParametricPartControls } from './ParametricPartControls';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { generatedPart } from '../../core/parts/part-generator.test-fixture';
import type { ImportedSvg } from '../../core/scene';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  resetStore();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetStore();
});
async function click(text: string): Promise<void> {
  const button = Array.from(host.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === text,
  );
  if (button === undefined) throw new Error('Missing button ' + text);
  await act(async () => Simulate.click(button));
}
async function change(label: string, value: string): Promise<void> {
  const wrapper = Array.from(host.querySelectorAll('label')).find((candidate) =>
    candidate.textContent?.trim().startsWith(label),
  );
  const input = wrapper?.querySelector('input');
  if (input === null || input === undefined) throw new Error('Missing field ' + label);
  await act(async () => {
    input.value = value;
    Simulate.change(input);
  });
}
describe('parametric part operator review', () => {
  it('creates through reachable controls only after geometry and affected-operation review', async () => {
    const initial = useStore.getState().project;
    await act(async () => root.render(<ParametricPartControls />));
    await click('Create parametric part…');
    await change('Overall width', '75');
    await click('Preview geometry and operations');
    expect(host.textContent).toContain('75 × 40 mm');
    expect(host.textContent).toContain('Affected operations: Panel');
    expect(host.querySelector('svg')).not.toBeNull();
    expect(useStore.getState().project).toBe(initial);
    await click('Apply reviewed part');
    expect(useStore.getState().undoStack).toEqual([initial]);
    expect(
      (useStore.getState().project.scene.objects[0] as ImportedSvg).partGenerator?.definition
        .widthMm,
    ).toBe(75);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await click('Bake selected generated part');
    expect(
      (useStore.getState().project.scene.objects[0] as ImportedSvg).partGenerator,
    ).toBeUndefined();
    await act(async () => useStore.getState().undo());
    expect(
      (useStore.getState().project.scene.objects[0] as ImportedSvg).partGenerator,
    ).toBeDefined();
  });
  it('discloses manual geometry, rejects invalid dimensions and cancels without changing paths', async () => {
    const source = generatedPart();
    const object = { ...source, paths: source.paths.toReversed() };
    const initial = { ...useStore.getState().project, scene: { layers: [], objects: [object] } };
    useStore.setState({ project: initial, selectedObjectId: object.id });
    await act(async () => root.render(<ParametricPartControls />));
    await click('Edit generated part dimensions…');
    await click('Preview geometry and operations');
    expect(host.textContent).toContain('replaces those manual geometry edits');
    await change('Overall width', '0');
    await click('Preview geometry and operations');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    const apply = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'Apply reviewed part',
    );
    expect(apply?.disabled).toBe(true);
    await click('Cancel');
    expect(useStore.getState().project).toBe(initial);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
  it('discloses missing machining identity without an applicable preview, while Cancel and Bake preserve artwork', async () => {
    const source = generatedPart();
    const object = { ...source, paths: source.paths.slice(1) };
    const initial = { ...useStore.getState().project, scene: { layers: [], objects: [object] } };
    useStore.setState({ project: initial, selectedObjectId: object.id });
    await act(async () => root.render(<ParametricPartControls />));
    await click('Edit generated part dimensions…');
    await click('Preview geometry and operations');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Cannot safely recover');
    expect(host.textContent).toContain('Undo manual geometry edits or bake');
    expect(
      Array.from(host.querySelectorAll('button')).find(
        (button) => button.textContent === 'Apply reviewed part',
      )?.disabled,
    ).toBe(true);
    expect(useStore.getState().project).toBe(initial);
    expect(useStore.getState().undoStack).toHaveLength(0);
    await click('Cancel');
    expect(useStore.getState().project).toBe(initial);
    await click('Bake selected generated part');
    expect((useStore.getState().project.scene.objects[0] as ImportedSvg).paths).toBe(object.paths);
    await act(async () => useStore.getState().undo());
    expect(useStore.getState().project).toBe(initial);
  });
  it('disables a reviewed Apply after artwork changes until a fresh preview is made', async () => {
    await act(async () => root.render(<ParametricPartControls />));
    await click('Create parametric part…');
    await click('Preview geometry and operations');
    await act(async () =>
      useStore.setState({ project: { ...useStore.getState().project, notes: 'changed' } }),
    );
    expect(host.textContent).toContain('Artwork or setup changed');
    expect(
      Array.from(host.querySelectorAll('button')).find(
        (button) => button.textContent === 'Apply reviewed part',
      )?.disabled,
    ).toBe(true);
    await click('Preview geometry and operations');
    expect(
      Array.from(host.querySelectorAll('button')).find(
        (button) => button.textContent === 'Apply reviewed part',
      )?.disabled,
    ).toBe(false);
    await click('Cancel');
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
  });
});
