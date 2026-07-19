import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../../core/devices';
import { FALCON_COMPATIBLE_PROFILE } from '../../../core/devices/falcon-profiles';
import type { PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { useStore } from '../../state';
import { useLaserStore, type LaserState } from '../../state/laser-store';
import { SuperConsoleSettingsPane } from './SuperConsoleSettingsPane';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalReadMachineSettings = useLaserStore.getState().readMachineSettings;

function makePlatform(): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => null,
    },
  };
}

async function renderPane(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={makePlatform()}>
        <SuperConsoleSettingsPane />
      </PlatformProvider>,
    );
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

afterEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    controllerSessionEpoch: 0,
    fireActive: false,
    streamer: null,
    motionOperation: null,
    controllerOperation: null,
    autofocusBusy: false,
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
    readMachineSettings: originalReadMachineSettings,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('SuperConsoleSettingsPane', () => {
  it('reports whether the selected profile activates the 4040 fill-quality policy', async () => {
    const generic = await renderPane();
    expect(generic.host.textContent).toContain('4040 fill-quality policy inactive');
    await generic.unmount();

    useStore.getState().replaceDeviceProfile(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
    const neotronics = await renderPane();
    expect(neotronics.host.textContent).toContain('4040 fill-quality policy active');
    expect(neotronics.host.textContent).not.toContain('4040 fill-quality policy inactive');
    await neotronics.unmount();

    useStore.getState().replaceDeviceProfile(FALCON_COMPATIBLE_PROFILE);
    const falcon = await renderPane();
    expect(falcon.host.textContent).not.toContain('4040 fill-quality policy');
    await falcon.unmount();
  });

  it('auto-reads settings exactly once when connected', async () => {
    const readMachineSettings = vi.fn(async () => undefined);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: { state: 'Idle' } as LaserState['statusReport'],
      controllerSessionEpoch: 4,
      readMachineSettings,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, unmount } = await renderPane();
    expect(readMachineSettings).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Read / Backup Controller Settings');
    expect(host.textContent).not.toContain('Auto-read skipped');
    await unmount();
  });

  it('does not auto-read while disconnected and says why', async () => {
    const readMachineSettings = vi.fn(async () => undefined);
    useLaserStore.setState({
      connection: { kind: 'disconnected' },
      readMachineSettings,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, unmount } = await renderPane();
    expect(readMachineSettings).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Connect to the controller to auto-read its settings.');
    await unmount();
  });

  it('reuses a current-session settings read instead of issuing a duplicate query', async () => {
    const readMachineSettings = vi.fn(async () => undefined);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: { state: 'Idle' } as LaserState['statusReport'],
      controllerSessionEpoch: 6,
      lastSettingsReadAt: Date.now(),
      readMachineSettings,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { unmount } = await renderPane();
    expect(readMachineSettings).not.toHaveBeenCalled();
    await unmount();
  });

  it('waits while busy without dispatching or mutating the global error state', async () => {
    const readMachineSettings = vi.fn(async () => undefined);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: { state: 'Run' } as LaserState['statusReport'],
      controllerSessionEpoch: 7,
      lastWriteError: null,
      log: [],
      readMachineSettings,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, unmount } = await renderPane();
    expect(readMachineSettings).not.toHaveBeenCalled();
    expect(host.textContent).toContain(
      'Auto-read waiting: Controller must report Idle before reading machine settings.',
    );
    expect(useLaserStore.getState().lastWriteError).toBeNull();
    expect(useLaserStore.getState().log).toEqual([]);
    await unmount();
  });

  it('waits for a console-owned settings read without dispatching a duplicate query', async () => {
    const readMachineSettings = vi.fn(async () => undefined);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: { state: 'Idle' } as LaserState['statusReport'],
      controllerSessionEpoch: 71,
      controllerOperation: {
        kind: 'interactive-command',
        phase: 'command',
        label: 'Reading controller settings',
      },
      lastWriteError: null,
      log: [],
      readMachineSettings,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, unmount } = await renderPane();

    expect(readMachineSettings).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Auto-read waiting: A controller operation is active.');
    expect(useLaserStore.getState().lastWriteError).toBeNull();
    expect(useLaserStore.getState().log).toEqual([]);
    await unmount();
  });

  it('dispatches once when a busy controller becomes Idle', async () => {
    const readMachineSettings = vi.fn(async () => undefined);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: { state: 'Run' } as LaserState['statusReport'],
      controllerSessionEpoch: 8,
      readMachineSettings,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { unmount } = await renderPane();
    expect(readMachineSettings).not.toHaveBeenCalled();
    await act(async () => {
      useLaserStore.setState({
        statusReport: { state: 'Idle' } as LaserState['statusReport'],
      });
    });
    expect(readMachineSettings).toHaveBeenCalledTimes(1);
    await act(async () => {
      useLaserStore.setState({
        statusReport: { state: 'Idle' } as LaserState['statusReport'],
      });
    });
    expect(readMachineSettings).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it('surfaces an unexpected rejected auto-read inline instead of hiding it', async () => {
    const readMachineSettings = vi.fn(async () => {
      throw new Error('A jog or frame operation is active.');
    });
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: { state: 'Idle' } as LaserState['statusReport'],
      controllerSessionEpoch: 9,
      readMachineSettings,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, unmount } = await renderPane();
    expect(host.textContent).toContain(
      'Auto-read failed: A jog or frame operation is active. Use Read ($$) to retry.',
    );
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => {
      useLaserStore.setState({ lastSettingsReadAt: Date.now() });
    });
    expect(host.textContent).not.toContain('Auto-read failed:');
    await unmount();
  });

  it('ignores completion from an earlier controller session', async () => {
    const pending: Array<{
      readonly resolve: () => void;
      readonly reject: (error: Error) => void;
    }> = [];
    const readMachineSettings = vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          pending.push({ resolve, reject });
        }),
    );
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: { state: 'Idle' } as LaserState['statusReport'],
      controllerSessionEpoch: 10,
      readMachineSettings,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, unmount } = await renderPane();
    expect(readMachineSettings).toHaveBeenCalledTimes(1);

    await act(async () => {
      useLaserStore.setState({
        controllerSessionEpoch: 11,
        statusReport: { state: 'Run' } as LaserState['statusReport'],
      });
    });
    await act(async () => {
      pending[0]?.reject(new Error('stale session failure'));
      await Promise.resolve();
    });

    expect(host.textContent).not.toContain('stale session failure');
    expect(host.textContent).toContain('Auto-read waiting: Controller must report Idle');
    await act(async () => {
      useLaserStore.setState({
        statusReport: { state: 'Idle' } as LaserState['statusReport'],
      });
    });
    expect(readMachineSettings).toHaveBeenCalledTimes(2);
    await act(async () => {
      pending[1]?.resolve();
      await Promise.resolve();
    });
    await unmount();
  });

  it('does not impose an inline minimum width on the responsive settings pane', async () => {
    const { host, unmount } = await renderPane();
    const pane = host.querySelector<HTMLElement>('.lf-super-console-settings');
    expect(pane?.style.minWidth).toBe('');
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    await unmount();
  });
});
