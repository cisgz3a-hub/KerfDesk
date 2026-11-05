import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { JobPlacementControls, START_FROM_HINTS } from './JobPlacementControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => resetStore());
afterEach(() => {
  document.body.innerHTML = '';
});

// UX audit U2-P3-7: the four Start from modes were explained by one combined
// tooltip, so nothing said User Origin ignores the design's canvas place.
describe('Start from mode hint', () => {
  it('says what the chosen mode does with the canvas place, and follows the choice', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<JobPlacementControls streaming={false} />));
      const hint = () => host.querySelector('.lf-placement-mode-hint')?.textContent;
      const select = host.querySelector<HTMLSelectElement>('select[aria-label="Start from"]')!;
      await act(async () => {
        select.value = 'user-origin';
        Simulate.change(select);
      });
      expect(hint()).toContain('Where the design sits on the canvas does not matter');
      await act(async () => {
        select.value = 'absolute';
        Simulate.change(select);
      });
      expect(hint()).toBe(START_FROM_HINTS.absolute);
      const options = [...select.options].map((option) => option.title);
      expect(options.every((title) => title.length > 0)).toBe(true);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
