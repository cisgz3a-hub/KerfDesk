// @vitest-environment jsdom
// Synthetic controller only: every socket connects to this test's ephemeral loopback server.
import { createServer, type Server, type Socket } from 'node:net';
import { clearTimeout as nativeClearTimeout, setTimeout as nativeSetTimeout } from 'node:timers';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MachineNetworkBridge } from './machine-network-bridge';
import { withMachineNetworkRoutes } from './machine-network-routes';
import { DEFAULT_DEVICE_PROFILE } from '../src/core/devices';
import { createProject } from '../src/core/scene';
import { useStore } from '../src/ui/state';
import { useLaserStore } from '../src/ui/state/laser-store';
import { initialLaserState } from '../src/ui/state/laser-store-helpers';
import { loadRememberedSerialPort, rememberSerialPort } from '../src/ui/state/serial-port-memory';
import { installAutoConnect } from '../src/ui/app/use-auto-connect-controller';
import type { PlatformAdapter } from '../src/platform/types';
import { createDesktopMachineNetwork } from '../src/platform/electron/desktop-machine-network';
import { machineNetworkRequest } from '../src/platform/electron/desktop-machine-network-api';

vi.mock('electron', () => ({ app: { once: vi.fn() } }));

const USB_ID = { usbVendorId: 0x1a86, usbProductId: 0x7523 };
const STATUS = '<Idle|MPos:12.000,34.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>\r\n';
const bridges: MachineNetworkBridge[] = [];
const sockets: Socket[] = [];
const servers: Server[] = [];
const autoConnectCleanups: Array<() => void> = [];

beforeEach(() => {
  // The native bridge uses Node timer handles; the renderer still runs in jsdom.
  vi.stubGlobal('setTimeout', nativeSetTimeout);
  vi.stubGlobal('clearTimeout', nativeClearTimeout);
  localStorage.clear();
  useStore.setState({
    project: createProject({ ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grblhal' }),
    cncLiveCaps: null,
  });
  useLaserStore.setState(initialLaserState());
});

afterEach(async () => {
  for (const cleanup of autoConnectCleanups.splice(0)) cleanup();
  for (const bridge of bridges.splice(0)) bridge.dispose();
  for (const socket of sockets.splice(0)) socket.destroy();
  await useLaserStore
    .getState()
    .disconnect()
    .catch(() => undefined);
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => server.close(() => resolve()));
  useLaserStore.setState(initialLaserState());
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loopbackController() {
  const commands: string[] = [];
  const realtime: number[] = [];
  let connectionCount = 0;
  const server = createServer((socket) => {
    connectionCount += 1;
    sockets.push(socket);
    let partial = '';
    socket.on('data', (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 63) {
          realtime.push(byte);
          socket.write(STATUS);
        } else if (byte === 10) {
          commands.push(partial);
          if (partial === '$$')
            socket.write(
              '$13=0\r\n$22=0\r\n$30=1000\r\n$31=0\r\n$32=1\r\n$110=3000\r\n$111=3000\r\n$130=400\r\n$131=400\r\n',
            );
          if (partial === '$G') socket.write('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]\r\n');
          socket.write('ok\r\n');
          partial = '';
        } else if (byte !== 13) partial += String.fromCharCode(byte);
      }
    });
    socket.write("GrblHAL 1.1f ['$' for help]\r\n");
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing loopback port');
  const bridge = new MachineNetworkBridge();
  bridges.push(bridge);
  const nativeOpen = vi.spyOn(bridge, 'open');
  const route = withMachineNetworkRoutes(
    async () => new Response('Not found', { status: 404 }),
    bridge,
  );
  const fetcher = vi.fn<typeof fetch>(async (input, options) => route(new Request(input, options)));
  const network = createDesktopMachineNetwork(machineNetworkRequest(fetcher));
  const usbOpen = vi.fn(async () => {
    throw new Error('USB must not open from this network flow');
  });
  const usbPort = { info: USB_ID, open: usbOpen };
  const usbPicker = vi.fn(async () => usbPort);
  const usbGranted = vi.fn(async () => [usbPort]);
  const platform: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: { isSupported: () => true, requestPort: usbPicker, grantedPorts: usbGranted },
    machineNetwork: network,
  };
  return {
    platform,
    networkPlatform: {
      ...platform,
      serial: network.serialForTarget('127.0.0.1', address.port, 'grblhal-raw'),
    },
    port: address.port,
    nativeOpen,
    commands,
    realtime,
    usbOpen,
    usbPicker,
    usbGranted,
    connectionCount: () => connectionCount,
  };
}

it('qualifies grblHAL through native routes and real TCP, then preserves network intent on loss', async () => {
  const fixture = await loopbackController();
  rememberSerialPort(localStorage, USB_ID);
  await useLaserStore.getState().connect(fixture.networkPlatform, {
    controllerKind: 'grblhal',
    portSelection: 'choose',
    hostedStreaming: false,
  });
  await vi.waitFor(
    () => {
      expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
      expect(useLaserStore.getState().controllerOperation).toBeNull();
      expect(useLaserStore.getState().statusReport?.mPos).toEqual({ x: 12, y: 34, z: 0 });
    },
    { timeout: 4000 },
  );
  expect(fixture.nativeOpen).toHaveBeenCalledExactlyOnceWith(
    '127.0.0.1',
    fixture.port,
    'grblhal-raw',
  );
  expect(useLaserStore.getState()).toMatchObject({
    connection: { kind: 'connected' },
    activeControllerKind: 'grblhal',
    detectedControllerKind: 'grblhal',
    lastConnectionTransport: 'tcp',
    serialPortInfo: { transport: 'tcp' },
    connectedBaudRate: null,
    statusReport: { state: 'Idle', mPos: { x: 12, y: 34, z: 0 } },
  });
  expect(fixture.commands).toEqual(['$$', '$G']);
  expect(fixture.realtime.length).toBeGreaterThan(0);
  expect(loadRememberedSerialPort(localStorage)).toEqual(USB_ID);

  const caps = useStore.getState().cncLiveCaps;
  expect(caps).not.toBeNull();
  const attempt = useLaserStore.getState().connectionAttempt;
  await useLaserStore.getState().connect(fixture.platform, { controllerKind: 'grblhal' });
  expect(useStore.getState().cncLiveCaps).toBe(caps);
  expect(useLaserStore.getState().connectionAttempt).toBe(attempt);
  expect(useLaserStore.getState().connection.kind).toBe('connected');
  expect(fixture.usbGranted).not.toHaveBeenCalled();

  for (const socket of sockets) socket.destroy();
  await vi.waitFor(() => expect(useLaserStore.getState().connection.kind).toBe('disconnected'));
  expect(useLaserStore.getState().lastConnectionTransport).toBe('tcp');
  expect(useLaserStore.getState().controllerQualification.kind).toBe('disconnected');
  autoConnectCleanups.push(installAutoConnect(fixture.platform));
  await useLaserStore
    .getState()
    .connect(fixture.platform, { controllerKind: 'grblhal', portSelection: 'automatic' });
  await useLaserStore.getState().connect(fixture.platform, { controllerKind: 'grblhal' });
  expect(fixture.usbGranted).not.toHaveBeenCalled();
  expect(fixture.usbPicker).not.toHaveBeenCalled();
  expect(fixture.usbOpen).not.toHaveBeenCalled();
  expect(fixture.connectionCount()).toBe(1);
  expect(fixture.nativeOpen).toHaveBeenCalledOnce();
});
