import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { OriginRow } from './OriginRow';
import { DEFAULT_JOG_STEP_MM, useJogControlPreferences } from './jog-control-preferences';
import { DEFAULT_JOG_FEED_MM_PER_MIN } from './jog-control-policy';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalActions = {
  setOriginHere: useLaserStore.getState().setOriginHere,
  resetOrigin: useLaserStore.getState().resetOrigin,
  setPersistentOriginHere: useLaserStore.getState().setPersistentOriginHere,
  clearPersistentOrigin: useLaserStore.getState().clearPersistentOrigin,
  releaseMotors: useLaserStore.getState().releaseMotors,
  jogToMachinePosition: useLaserStore.getState().jogToMachinePosition,
};

type LaserStatusReport = NonNullable<ReturnType<typeof useLaserStore.getState>['statusReport']>;

function statusReport(state: LaserStatusReport['state']): LaserStatusReport {
  return { state } as LaserStatusReport;
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === text);
  if (button === undefined) throw new Error(`${text} button not rendered`);
  return button;
}

async function renderOriginRow(
  host: HTMLElement,
  props: { readonly disabled?: boolean; readonly streaming?: boolean } = {},
): Promise<Root> {
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <OriginRow disabled={props.disabled ?? false} streaming={props.streaming ?? false} />,
    );
  });
  if (root === null) throw new Error('OriginRow did not mount');
  return root;
}

afterEach(() => {
  useLaserStore.setState({
    ...originalActions,
    statusReport: null,
    wcoCache: null,
    workOriginActive: false,
    workOriginSource: 'none',
    frameVerification: null,
    streamer: null,
    motionOperation: null,
  });
  useStore.setState({ project: createProject() });
  useJogControlPreferences.setState({
    stepMm: DEFAULT_JOG_STEP_MM,
    requestedFeedMmPerMin: DEFAULT_JOG_FEED_MM_PER_MIN,
  });
  vi.restoreAllMocks();
});

describe('OriginRow persistent origin controls', () => {
  it('shows advanced persistent controls and disables transient reset for known G54 origin', async () => {
    useLaserStore.setState({
      statusReport: statusReport('Idle'),
      workOriginActive: true,
      workOriginSource: 'g54-persistent',
      wcoCache: { x: 12, y: 34, z: 0 },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      root = await renderOriginRow(host);

      expect(buttonByText(host, 'Reset origin').disabled).toBe(true);
      expect(buttonByText(host, 'Set persistent origin').disabled).toBe(false);
      expect(buttonByText(host, 'Clear persistent origin').disabled).toBe(false);
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('confirms before setting persistent G54 origin', async () => {
    const setPersistentOriginHere = vi.fn(async () => undefined);
    useLaserStore.setState({
      statusReport: statusReport('Idle'),
      setPersistentOriginHere,
      workOriginActive: false,
      workOriginSource: 'none',
      wcoCache: null,
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      root = await renderOriginRow(host);

      await act(async () => {
        buttonByText(host, 'Set persistent origin').dispatchEvent(
          new MouseEvent('click', { bubbles: true }),
        );
        await Promise.resolve();
      });

      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('G54'));
      expect(setPersistentOriginHere).toHaveBeenCalledTimes(1);
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('disables persistent origin controls until the machine is Idle', async () => {
    useLaserStore.setState({
      statusReport: statusReport('Run'),
      workOriginActive: true,
      workOriginSource: 'g54-persistent',
      wcoCache: { x: 12, y: 34, z: 0 },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      root = await renderOriginRow(host);

      expect(buttonByText(host, 'Set persistent origin').disabled).toBe(true);
      expect(buttonByText(host, 'Clear persistent origin').disabled).toBe(true);
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('returns to the known work zero with a beam-off jog', async () => {
    const jogToMachinePosition = vi.fn(async () => undefined);
    useLaserStore.setState({
      statusReport: statusReport('Idle'),
      workOriginActive: true,
      workOriginSource: 'g92',
      wcoCache: { x: 72, y: 31, z: 0 },
      jogToMachinePosition,
    });
    useStore.getState().updateDeviceProfile({ maxFeed: 6000 });
    useJogControlPreferences.setState({ requestedFeedMmPerMin: 1000 });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      root = await renderOriginRow(host);

      await act(async () => buttonByText(host, 'Go to work zero').click());

      expect(jogToMachinePosition).toHaveBeenCalledWith(72, 31, 1000);
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('disables return-to-zero until the origin position is known and Idle', async () => {
    useLaserStore.setState({
      statusReport: statusReport('Run'),
      workOriginActive: true,
      workOriginSource: 'unknown',
      wcoCache: null,
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      root = await renderOriginRow(host);
      expect(buttonByText(host, 'Go to work zero').disabled).toBe(true);
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});
