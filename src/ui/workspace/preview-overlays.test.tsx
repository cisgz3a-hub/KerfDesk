import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { Toolpath } from '../../core/job';
import { PreviewStatsPanel } from './preview-overlays';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const toolpath: Toolpath = {
  totalLength: 30,
  steps: [
    {
      kind: 'cut',
      color: '#000000',
      length: 20,
      polyline: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ],
    },
    {
      kind: 'travel',
      from: { x: 20, y: 0 },
      to: { x: 30, y: 0 },
      length: 10,
    },
  ],
};

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanup !== null) {
    await cleanup();
    cleanup = null;
  }
});

describe('PreviewStatsPanel', () => {
  it('shows the total estimated time when the live estimate is available', async () => {
    const host = await renderPanel({ kind: 'estimated', label: '47s' });

    expect(host.textContent).toContain('Time');
    expect(host.textContent).toContain('47s');
  });

  it('shows a clear large-job state when live estimation is paused', async () => {
    const host = await renderPanel({ kind: 'too-large' });

    expect(host.textContent).toContain('Time');
    expect(host.textContent).toContain('large job');
  });
});

async function renderPanel(
  estimate: React.ComponentProps<typeof PreviewStatsPanel>['estimate'],
): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<PreviewStatsPanel toolpath={toolpath} estimate={estimate} />);
  });
  cleanup = async () => {
    if (root !== null) await act(async () => root?.unmount());
    host.remove();
  };
  return host;
}
