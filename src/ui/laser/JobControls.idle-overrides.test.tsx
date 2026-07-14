import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useLaserStore } from '../state/laser-store';
import { JobControls } from './JobControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalCapabilities = useLaserStore.getState().capabilities;

afterEach(() => {
  useLaserStore.setState({
    capabilities: originalCapabilities,
    ovCache: null,
    streamer: null,
    motionOperation: null,
    controllerOperation: null,
  });
});

async function renderJobControls(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<JobControls disabled={false} onStartJob={() => undefined} />);
  });
  return {
    host,
    unmount: async () => {
      await act(async () => root?.unmount());
      host.remove();
    },
  };
}

describe('idle controller override recovery', () => {
  it('shows reset controls while Idle when a capable controller reports a non-default override', async () => {
    useLaserStore.setState({
      capabilities: { ...originalCapabilities, overrides: true },
      ovCache: { feed: 120, rapid: 50, spindle: 90 },
    });
    const view = await renderJobControls();
    try {
      expect(view.host.querySelector('[aria-label="Job overrides"]')).not.toBeNull();
      expect(view.host.textContent).toContain('120%');
      expect(view.host.textContent).toContain('90%');
      expect(view.host.textContent).toContain('50%');
    } finally {
      await view.unmount();
    }
  });

  it('stays hidden at the exact baseline and on controllers without realtime overrides', async () => {
    useLaserStore.setState({
      capabilities: { ...originalCapabilities, overrides: true },
      ovCache: { feed: 100, rapid: 100, spindle: 100 },
    });
    const baseline = await renderJobControls();
    try {
      expect(baseline.host.querySelector('[aria-label="Job overrides"]')).toBeNull();
    } finally {
      await baseline.unmount();
    }

    useLaserStore.setState({
      capabilities: { ...originalCapabilities, overrides: false },
      ovCache: { feed: 120, rapid: 50, spindle: 90 },
    });
    const unsupported = await renderJobControls();
    try {
      expect(unsupported.host.querySelector('[aria-label="Job overrides"]')).toBeNull();
    } finally {
      await unsupported.unmount();
    }
  });
});
