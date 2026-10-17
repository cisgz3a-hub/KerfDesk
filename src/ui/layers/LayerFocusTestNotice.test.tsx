import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { generateFocusTest } from '../../core/job/focus-test';
import { createLayer, createProject } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { LayerFocusTestNotice } from './LayerFocusTestNotice';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const done of cleanup.splice(0)) await done();
  resetStore();
});

async function render(element: JSX.Element): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  cleanup.push(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  await act(async () => root.render(element));
  return host;
}

describe('LayerFocusTestNotice', () => {
  it('shows the sample Z offset and removes it on request', async () => {
    const scene = generateFocusTest({
      steps: 2,
      minOffsetMm: -0.5,
      maxOffsetMm: 1.25,
      lineLengthMm: 20,
      spacingMm: 3,
      speed: 1200,
      power: 10,
      travelFeedMmPerMin: 300,
    });
    useStore.getState().setProject({ ...createProject(), scene });
    const layer = scene.layers[1];
    if (layer === undefined) throw new Error('sample missing');
    const host = await render(<LayerFocusTestNotice layer={layer} />);
    expect(host.textContent).toContain('Focus Test: Z +1.250 mm');
    const button = [...host.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Remove Focus Test Z',
    );
    await act(async () => button?.click());
    expect(useStore.getState().project.scene.layers[1]?.focusTest).toBeUndefined();
  });

  it('renders nothing for an ordinary operation', async () => {
    const ordinary = createLayer({ id: 'plain', color: '#000000' });
    const host = await render(<LayerFocusTestNotice layer={ordinary} />);
    expect(host.textContent).toBe('');
  });
});
