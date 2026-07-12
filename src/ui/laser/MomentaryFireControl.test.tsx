import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { MomentaryFireControl } from './MomentaryFireControl';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalProject = useStore.getState().project;
let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useStore.setState({
    project: {
      ...originalProject,
      machine: { kind: 'laser' },
      device: {
        ...originalProject.device,
        capabilities: [...(originalProject.device.capabilities ?? []), 'low-power-fire'],
        fireControl: { enabled: true, maxPowerPercent: 1 },
      },
    },
  });
  useExperimentalLaserFeatures.getState().resetFeatures();
  useExperimentalLaserFeatures.getState().setFeature('lowPowerFire', true);
  useLaserStore.setState({
    connection: { kind: 'connected' },
    capabilities: grblDriver.capabilities,
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 0, y: 0, z: 0 },
      wPos: null,
      wco: null,
      feed: 0,
      spindle: 0,
    },
    alarmCode: null,
    streamer: null,
    motionOperation: null,
    controllerOperation: null,
    autofocusBusy: false,
    probeBusy: false,
    pendingUntrackedAcks: 0,
    fireActive: false,
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useStore.setState({ project: originalProject });
  useExperimentalLaserFeatures.getState().resetFeatures();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    fireActive: false,
  });
  vi.restoreAllMocks();
});

async function renderControl(): Promise<HTMLButtonElement | null> {
  await act(async () => root.render(<MomentaryFireControl />));
  return host.querySelector('button');
}

describe('MomentaryFireControl', () => {
  it('starts on press and hard-offs on window blur', async () => {
    const setFireActive = vi.fn(async (active: boolean) => {
      useLaserStore.setState({ fireActive: active });
    });
    useLaserStore.setState({ setFireActive });
    const button = await renderControl();

    await act(async () => button?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(setFireActive).toHaveBeenCalledWith(true, 1);

    await act(async () => window.dispatchEvent(new Event('blur')));
    expect(setFireActive).toHaveBeenLastCalledWith(false);
  });

  it('hard-offs when unmounted while held', async () => {
    const setFireActive = vi.fn(async (active: boolean) => {
      useLaserStore.setState({ fireActive: active });
    });
    useLaserStore.setState({ setFireActive });
    const button = await renderControl();
    await act(async () => button?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));

    await act(async () => root.unmount());

    expect(setFireActive).toHaveBeenLastCalledWith(false);
  });

  it('does not mount without the Labs opt-in', async () => {
    useExperimentalLaserFeatures.getState().setFeature('lowPowerFire', false);
    expect(await renderControl()).toBeNull();
  });
});
