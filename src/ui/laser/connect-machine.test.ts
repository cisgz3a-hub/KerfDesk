import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import { DEVICE_SETUP_CONFIGURED_STORAGE_KEY } from '../state/device-setup-configured-persistence';
import { useLaserStore } from '../state/laser-store';
import { connectMachine } from './connect-machine';
import { deviceProfileSignature } from './device-setup/device-setup-nudge';
import {
  closeMachineSetup,
  openMachineSetup,
  useMachineSetupDialogStore,
} from './device-setup/machine-setup-dialog-store';

const originalConnect = useLaserStore.getState().connect;
const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => true, requestPort: async () => null },
};
const connect = vi.fn<typeof originalConnect>(async () => undefined);

beforeEach(() => {
  window.localStorage.removeItem(DEVICE_SETUP_CONFIGURED_STORAGE_KEY);
  closeMachineSetup();
  useStore.setState({ project: createProject() });
  useLaserStore.setState({ connection: { kind: 'disconnected' }, connect });
  connect.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  useLaserStore.setState({ connect: originalConnect });
  closeMachineSetup();
  window.localStorage.removeItem(DEVICE_SETUP_CONFIGURED_STORAGE_KEY);
});

function recordSetup(kind: 'laser' | 'cnc' = 'laser'): void {
  window.localStorage.setItem(
    DEVICE_SETUP_CONFIGURED_STORAGE_KEY,
    JSON.stringify([deviceProfileSignature(useStore.getState().project.device, kind)]),
  );
}

describe('explicit first machine connection', () => {
  it('opens the Machine stage before requesting a connection, in the original click', () => {
    connect.mockImplementationOnce(async () => {
      expect(useMachineSetupDialogStore.getState().state).toMatchObject({
        kind: 'open',
        target: { kind: 'step', step: 'capability' },
      });
    });
    const pending = connectMachine(platform);
    expect(connect).toHaveBeenCalledOnce();
    expect(connect.mock.calls[0]?.[0]).toBe(platform);
    expect(window.localStorage.getItem(DEVICE_SETUP_CONFIGURED_STORAGE_KEY)).toBeNull();
    return pending;
  });

  it('connects an already configured profile without reopening setup', async () => {
    recordSetup();
    await connectMachine(platform);
    expect(connect).toHaveBeenCalledOnce();
    expect(useMachineSetupDialogStore.getState().state.kind).toBe('idle');
  });

  it('reads the current profile and saved completion at click time', async () => {
    const ready = () => connectMachine(platform);
    recordSetup();
    useStore.setState((state) => ({
      project: {
        ...state.project,
        device: {
          ...state.project.device,
          profileId: 'new-machine',
          controllerKind: 'grblhal',
          baudRate: 230400,
          workerHostedStreaming: false,
        },
      },
    }));
    await ready();
    expect(useMachineSetupDialogStore.getState().state.kind).toBe('open');
    expect(connect.mock.calls[0]?.[1]).toEqual({
      controllerKind: 'grblhal',
      baudRate: 230400,
      hostedStreaming: false,
    });
    closeMachineSetup();
    recordSetup();
    await ready();
    expect(useMachineSetupDialogStore.getState().state.kind).toBe('idle');
  });

  it('keeps setup completion separate for laser and CNC', async () => {
    recordSetup('laser');
    useStore.getState().setMachineKind('cnc');
    await connectMachine(platform);
    expect(useMachineSetupDialogStore.getState().state.kind).toBe('open');
    closeMachineSetup();
    recordSetup('cnc');
    await connectMachine(platform);
    expect(useMachineSetupDialogStore.getState().state.kind).toBe('idle');
  });

  it('offers setup again after cancellation without recording completion', async () => {
    await connectMachine(platform);
    closeMachineSetup();
    await connectMachine(platform);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(useMachineSetupDialogStore.getState().state.kind).toBe('open');
    expect(window.localStorage.getItem(DEVICE_SETUP_CONFIGURED_STORAGE_KEY)).toBeNull();
  });

  it('retains an already open setup draft and its target on another Connect', async () => {
    openMachineSetup(
      { kind: 'cnc', field: 'stock' },
      { kind: 'fluidnc-network', serial: platform.serial, host: '192.0.2.5', port: 23 },
    );
    const originalDraft = useMachineSetupDialogStore.getState().state;
    await connectMachine(
      platform,
      {},
      {
        kind: 'fluidnc-network',
        serial: platform.serial,
        host: '192.0.2.6',
        port: 24,
      },
    );
    expect(useMachineSetupDialogStore.getState().state).toBe(originalDraft);
    expect(connect).toHaveBeenCalledOnce();
  });

  it.each(['connecting', 'connected'] as const)(
    'does not open setup for a stale explicit action when already %s',
    async (kind) => {
      useLaserStore.setState({ connection: { kind } });
      await connectMachine(platform);
      expect(useMachineSetupDialogStore.getState().state.kind).toBe('idle');
    },
  );

  it('keeps setup open and unsaved when the normal connection fails', async () => {
    connect.mockRejectedValueOnce(new Error('Port is busy'));
    await expect(connectMachine(platform)).rejects.toThrow('Port is busy');
    expect(useMachineSetupDialogStore.getState().state.kind).toBe('open');
    expect(window.localStorage.getItem(DEVICE_SETUP_CONFIGURED_STORAGE_KEY)).toBeNull();
  });

  it('preserves explicit port and network streaming options', async () => {
    await connectMachine(platform, { portSelection: 'choose', hostedStreaming: false });
    expect(connect.mock.calls[0]?.[1]).toMatchObject({
      portSelection: 'choose',
      hostedStreaming: false,
    });
  });

  it('still opens setup and requests the port if local storage cannot be read', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    await connectMachine(platform);
    expect(useMachineSetupDialogStore.getState().state.kind).toBe('open');
    expect(connect).toHaveBeenCalledOnce();
  });
});
