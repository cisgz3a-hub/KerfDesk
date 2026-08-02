// The operation name box is uncontrolled and re-seeds from its key, so a
// rename the store REJECTS (blank or whitespace) leaves the stored name
// identical — the key never changes and the emptied box keeps standing over an
// operation that still has its old name. Its own file because
// SelectedObjectProperties.test.tsx is at the 400-line cap.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { SelectedObjectProperties } from './SelectedObjectProperties';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => resetStore());

describe('operation name box', () => {
  it('restores the stored name when the rename is refused', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#000000']));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    await act(async () => root.render(<SelectedObjectProperties />));
    try {
      const nameBox = (): HTMLInputElement => {
        const found = host.querySelector('input[aria-label="Operation name"]');
        if (!(found instanceof HTMLInputElement)) throw new Error('operation name input missing');
        return found;
      };
      const storedName = nameBox().value;
      expect(storedName.length).toBeGreaterThan(0);

      const input = nameBox();
      await act(async () => {
        input.value = '   ';
        Simulate.change(input);
      });
      await act(async () => Simulate.blur(input));

      expect(nameBox().value).toBe(storedName);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
