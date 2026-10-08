import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConstrainedSketchControls } from './ConstrainedSketchControls';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
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
  if (button === undefined) throw new Error('Missing sketch button ' + text);
  await act(async () => Simulate.click(button));
}
async function field(label: string, value: string): Promise<void> {
  const wrapper = Array.from(host.querySelectorAll('label')).find((candidate) =>
    candidate.textContent?.trim().startsWith(label),
  );
  const input = wrapper?.querySelector('input,select');
  if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement))
    throw new Error('Missing sketch field ' + label);
  await act(async () => {
    input.value = value;
    Simulate.change(input);
  });
}
describe('reachable sketch review', () => {
  it('reviews named conflicting residuals, cancels without mutation, then applies a fresh dimensioned preview atomically', async () => {
    const initial = useStore.getState().project;
    await act(async () => root.render(<ConstrainedSketchControls />));
    await click('Create constrained sketch…');
    const summary = Array.from(host.querySelectorAll('summary')).find(
      (candidate) => candidate.textContent === 'Constraint relations',
    );
    if (summary === undefined) throw new Error('Missing relation disclosure');
    await act(async () => summary.click());
    await field('Constraint type', 'x');
    await field('First entity', 'b');
    await field('New constraint dimension', '5');
    await click('Add constraint');
    await click('Review solved geometry');
    expect(host.textContent).toContain('over-constrained');
    expect(host.textContent).toContain('constraint_1: residual');
    expect(host.textContent).toContain('Conflicting dimensions remain');
    expect(
      Array.from(host.querySelectorAll('button')).some(
        (button) => button.textContent === 'Apply reviewed sketch',
      ),
    ).toBe(false);
    await click('Cancel');
    expect(useStore.getState().project).toBe(initial);
    expect(useStore.getState().undoStack).toHaveLength(0);
    await click('Create constrained sketch…');
    const width = host.querySelector<HTMLInputElement>(
      'input[aria-label="width value or expression"]',
    );
    if (width === null) throw new Error('Missing width parameter');
    await act(async () => {
      width.value = '75';
      Simulate.change(width);
    });
    await click('Review solved geometry');
    expect(host.textContent).toContain('fully-constrained');
    expect(host.textContent).toContain('75.000 × 30.000 mm');
    expect(host.querySelector('svg[aria-label="Solved sketch outline"]')).not.toBeNull();
    expect(useStore.getState().project).toBe(initial);
    await click('Apply reviewed sketch');
    const object = useStore.getState().project.scene.objects[0] as ImportedSvg;
    expect(object.bounds.maxX).toBeCloseTo(75, 5);
    expect(
      object.constrainedSketch?.parameters.find((parameter) => parameter.name === 'width')?.value,
    ).toBe(75);
    expect(useStore.getState().undoStack).toEqual([initial]);
  });
});
