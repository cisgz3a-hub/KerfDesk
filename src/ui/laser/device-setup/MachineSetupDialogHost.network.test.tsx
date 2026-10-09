import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { createProject } from '../../../core/scene';
import type { PlatformAdapter, SerialConnection, SerialOpenRequest } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { useStore } from '../../state';
import { DEVICE_SETUP_CONFIGURED_STORAGE_KEY } from '../../state/device-setup-configured-persistence';
import { useLaserStore } from '../../state/laser-store';
import { initialLaserState } from '../../state/laser-store-helpers';
import { MachineConnectionToolbar } from '../MachineConnectionToolbar';
import { MachineSetupDialogHost } from './MachineSetupDialogHost';
import { connectionForMachineSetup } from './machine-setup-connection';
import {
  closeMachineSetup,
  openMachineSetup,
  useMachineSetupDialogStore,
} from './machine-setup-dialog-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const fluidNcProfile = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'fluidnc' as const };
let root: Root | undefined;
let host: HTMLDivElement | undefined;

beforeEach(() => {
  localStorage.clear();
  useStore.setState({ project: createProject(fluidNcProfile) });
  useLaserStore.setState(initialLaserState());
  useMachineSetupDialogStore.setState({ state: { kind: 'idle' }, configuredRevision: 0 });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  await useLaserStore.getState().disconnect();
  localStorage.clear();
});

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

function controlsText(): string {
  return document.querySelector('.lf-setup-find')?.textContent ?? '';
}

function testPlatform() {
  const usbRequest = vi.fn(async () => null);
  const tcpRequest = vi.fn<PlatformAdapter['serial']['requestPort']>(async () => {
    throw new Error('Mock TCP target unreachable');
  });
  const serial = { isSupported: () => true, requestPort: tcpRequest };
  const target = vi.fn(() => serial);
  const platform: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: { isSupported: () => true, requestPort: usbRequest },
    machineNetwork: { serialForTarget: target },
  };
  return { platform, usbRequest, tcpRequest, serial, target };
}

async function renderFirstNetworkConnect(platform: PlatformAdapter): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <PlatformProvider adapter={platform}>
        <MachineConnectionToolbar />
        <MachineSetupDialogHost />
      </PlatformProvider>,
    ),
  );
  const trigger = document.querySelector<HTMLButtonElement>(
    'button[aria-label^="Machine details:"]',
  );
  if (!trigger) throw new Error('Missing machine details');
  await act(async () => trigger.click());
  for (const [label, value] of [
    ['FluidNC machine IP or hostname', '192.0.2.5'],
    ['FluidNC Telnet port', '23'],
  ]) {
    const field = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    if (!field) throw new Error(`Missing ${label}`);
    await act(async () => {
      field.value = value ?? '';
      Simulate.change(field);
    });
  }
  await act(async () => button('Connect FluidNC network').click());
}

function respondingChannel() {
  const handlers = new Set<(line: string) => void>();
  const emit = (line: string): void => handlers.forEach((handler) => handler(line));
  const close = vi.fn(async () => undefined);
  const write = vi.fn(async (data: string) => {
    if (data === '?') emit('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    if (data === '$$\n') {
      for (const line of ['$22=0', '$30=1000', '$32=1', '$130=400', '$131=400']) emit(line);
    }
    if (data === '$G\n') emit('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
    if (data.endsWith('\n')) emit('ok');
  });
  const connection: SerialConnection = {
    write,
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: () => () => undefined,
    close,
  };
  return { connection, emit, close, write };
}

describe('first FluidNC network Connect setup recovery', () => {
  it('retries the captured TCP target after failure without USB or baud scanning', async () => {
    const link = testPlatform();
    await renderFirstNetworkConnect(link.platform);
    expect(link.target).toHaveBeenCalledExactlyOnceWith('192.0.2.5', 23);
    expect(link.tcpRequest).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"][aria-label="Machine details"]')).toBeNull();
    expect(useMachineSetupDialogStore.getState().state.kind).toBe('open');
    expect(controlsText()).toContain('Network target: 192.0.2.5:23');
    expect(controlsText()).not.toMatch(
      /Use a different port|Try other speeds|baud|Background streaming/,
    );
    expect(document.querySelector('[aria-label="Serial baud rate"]')).toBeNull();
    expect(
      document.querySelector(
        '[aria-label="Read the serial port and refill the job stream in a worker"]',
      ),
    ).toBeNull();
    await act(async () => button('Try again').click());
    expect(link.tcpRequest).toHaveBeenCalledTimes(2);
    expect(link.target).toHaveBeenCalledOnce();
    expect(link.usbRequest).not.toHaveBeenCalled();
    expect(useLaserStore.getState().connection).toMatchObject({ kind: 'failed' });
    expect(localStorage.getItem(DEVICE_SETUP_CONFIGURED_STORAGE_KEY)).toBeNull();
  });

  it('retains the target after a cancelled retry but drops it when setup closes', async () => {
    const link = testPlatform();
    await renderFirstNetworkConnect(link.platform);
    link.tcpRequest.mockResolvedValueOnce(null);
    await act(async () => button('Try again').click());
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(controlsText()).toContain('Network target: 192.0.2.5:23');
    expect(controlsText()).not.toContain('Plug it in by USB');
    await act(async () => button('Find my machine').click());
    expect(link.tcpRequest).toHaveBeenCalledTimes(3);
    expect(link.usbRequest).not.toHaveBeenCalled();
    await act(async () => closeMachineSetup());
    expect(useMachineSetupDialogStore.getState().state).toEqual({ kind: 'idle' });
    await act(async () => openMachineSetup());
    expect(controlsText()).not.toContain('Network target:');
    await act(async () => button('Try again').click());
    expect(link.usbRequest).toHaveBeenCalledOnce();
    expect(link.tcpRequest).toHaveBeenCalledTimes(3);
  });

  it('keeps network retries on the window transport despite a saved worker preference', async () => {
    const link = testPlatform();
    const open = vi.fn(async (_request: SerialOpenRequest) => {
      throw new Error('Captured TCP open');
    });
    link.tcpRequest.mockResolvedValue({ open });
    useStore.setState({
      project: createProject({ ...fluidNcProfile, workerHostedStreaming: true }),
    });
    await renderFirstNetworkConnect(link.platform);
    await act(async () => button('Try again').click());
    expect(open).toHaveBeenCalledTimes(2);
    for (const [request] of open.mock.calls) expect(request).not.toHaveProperty('hostedStreaming');
    expect(link.usbRequest).not.toHaveBeenCalled();
  });

  it('retains safe reads and explicit disconnect on a connected FluidNC target', async () => {
    const link = testPlatform();
    const channel = respondingChannel();
    link.tcpRequest.mockResolvedValue({ open: async () => channel.connection });
    await renderFirstNetworkConnect(link.platform);
    await act(async () => {
      channel.emit("Grbl 3.7 [FluidNC v4.0.3 (synthetic) '$' for help]");
      channel.emit('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    });
    await act(async () => {
      await vi.waitFor(() => expect(button('Read again').disabled).toBe(false));
    });
    channel.write.mockClear();
    await act(async () => button('Read again').click());
    expect(channel.write).toHaveBeenCalledWith('$I\n');
    expect(channel.write).toHaveBeenCalledWith('$CD\n');
    expect(link.tcpRequest).toHaveBeenCalledOnce();
    const disconnect = [
      ...document.querySelectorAll<HTMLButtonElement>('.lf-setup-find button'),
    ].find((node) => node.textContent?.trim() === 'Disconnect');
    if (!disconnect) throw new Error('Missing setup Disconnect');
    await act(async () => disconnect.click());
    await act(async () => {
      await vi.waitFor(() => {
        expect(channel.close).toHaveBeenCalledOnce();
        expect(useLaserStore.getState().connection.kind).toBe('disconnected');
      });
    });
    expect(link.usbRequest).not.toHaveBeenCalled();
  });

  it.each([
    { controllerKind: 'grblhal' as const },
    { controllerKind: 'ruida' as const },
    { controllerKind: 'fluidnc' as const, controllerCommandSet: 'creality-falcon-a1-pro' as const },
  ])('refuses a non-native FluidNC draft before transport: %j', async (patch) => {
    const link = testPlatform();
    const connection = connectionForMachineSetup(
      link.platform,
      { ...fluidNcProfile, ...patch },
      115_200,
      { kind: 'fluidnc-network', serial: link.serial, host: '192.0.2.5', port: 23 },
    );
    await expect(connection.connect(useLaserStore.getState().connect)).rejects.toThrow(
      'Select the FluidNC protocol',
    );
    expect(link.tcpRequest).not.toHaveBeenCalled();
    expect(link.usbRequest).not.toHaveBeenCalled();
  });

  it('adopts late detected firmware without automatically reopening a network channel', async () => {
    const link = testPlatform();
    const channel = respondingChannel();
    await renderFirstNetworkConnect(link.platform);
    link.tcpRequest.mockResolvedValue({ open: async () => channel.connection });
    await act(async () => button('Try again').click());
    await act(async () => {
      channel.emit('GrblHAL 1.1f');
      channel.emit('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(
          document.querySelector<HTMLSelectElement>('[aria-label="Controller firmware"]')?.value,
        ).toBe('grblhal');
      });
    });
    expect(controlsText()).toContain('Select the FluidNC protocol before retrying');
    expect(channel.close).not.toHaveBeenCalled();
    expect(link.tcpRequest).toHaveBeenCalledTimes(2);
    expect(link.usbRequest).not.toHaveBeenCalled();
    expect(button('Reconnect using selected profile').disabled).toBe(true);
    expect(button('Disconnect').disabled).toBe(false);
  });
});
