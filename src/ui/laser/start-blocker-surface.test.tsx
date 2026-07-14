import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { JobControls } from './JobControls';
import { runStartJobFlow } from './start-job-flow';
import { useStartBlockerStore } from './start-blocker-store';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  resetStore();
  useStore.setState({ project: createProject() });
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 0, y: 0, z: 0 },
      wPos: null,
      feed: 0,
      spindle: 0,
      wco: null,
    },
    controllerSettings: {
      maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
      minPowerS: DEFAULT_DEVICE_PROFILE.minPowerS,
      laserModeEnabled: DEFAULT_DEVICE_PROFILE.laserModeEnabled,
    },
  });
  useStartBlockerStore.getState().clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = null;
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host.remove();
});

describe('Start blocker surface', () => {
  it('keeps the exact failed Start preparation messages beside the Start button', async () => {
    await runStartJobFlow();
    await act(async () => {
      root = createRoot(host);
      root.render(<JobControls disabled={false} onStartJob={() => undefined} />);
    });

    expect(useStartBlockerStore.getState().messages).toContain(
      'No output layers. Enable Output on at least one layer.',
    );
    expect(host.textContent).toContain('Last Start attempt blocked');
    expect(host.textContent).toContain('No output layers. Enable Output on at least one layer.');
  });
});
