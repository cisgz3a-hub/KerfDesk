import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { AdjustmentControls, DEFAULT_ADJUSTMENTS } from './AdjustmentControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('AdjustmentControls', () => {
  it('does not expose raster dither modes inside Trace Image', async () => {
    const { host, root } = await renderControls();
    try {
      expect(host.textContent).not.toContain('Dither');
      expect(host.querySelector('select')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

async function renderControls(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<AdjustmentControls values={DEFAULT_ADJUSTMENTS} onChange={vi.fn()} />);
  });
  if (root === null) throw new Error('root did not mount');
  return { host, root };
}
