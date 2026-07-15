import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { GrblLaserSetupPanel } from './GrblLaserSetupPanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('legacy GRBL laser setup panel', () => {
  it('contains no fixed-value firmware action', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    await act(async () => {
      root = createRoot(host);
      root.render(<GrblLaserSetupPanel disabled={false} />);
    });
    try {
      expect(host.querySelector('button')).toBeNull();
      expect(host.textContent).toContain('Fixed-value GRBL setup batches are unavailable');
      expect(host.textContent).toContain('one supported setting at a time');
      expect(host.textContent).not.toContain('$130=400');
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});
