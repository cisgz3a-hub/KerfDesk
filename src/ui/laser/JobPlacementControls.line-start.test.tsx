import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { JobPlacementControls } from './JobPlacementControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => resetStore());
afterEach(() => {
  document.body.innerHTML = '';
});

describe('Line start choice in Laser Placement', () => {
  it('works while disconnected, preserves Job origin, and locks during an operation', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const before = useStore.getState();
    try {
      await act(async () => {
        root.render(<JobPlacementControls streaming={false} />);
      });
      const select = host.querySelector<HTMLSelectElement>('select[name="lineStartRegion"]');
      if (select === null) throw new Error('Line preference missing');
      expect(select.disabled).toBe(false);
      expect(host.textContent).toContain('Fill/raster keep their scan order');
      await act(async () => {
        select.value = 'front-right';
        Simulate.change(select);
      });
      expect(useStore.getState().project.optimization).toEqual({
        ...before.project.optimization,
        lineStartRegion: 'front-right',
      });
      expect(useStore.getState().jobPlacement).toEqual(before.jobPlacement);
      await act(async () => {
        root.render(<JobPlacementControls streaming={true} />);
      });
      expect(select.disabled).toBe(true);
      await act(async () => {
        root.render(<JobPlacementControls streaming={false} />);
      });
      await act(async () => {
        select.value = '';
        Simulate.change(select);
      });
      expect(useStore.getState().project.optimization).toEqual(before.project.optimization);
      expect('lineStartRegion' in useStore.getState().project.optimization).toBe(false);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
